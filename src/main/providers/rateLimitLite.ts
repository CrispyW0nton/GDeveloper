/**
 * Minimal Anthropic TPM Survival Layer — Sprint 27.1 (Block 3)
 *
 * Lightweight rate-limit tracker that reads authoritative Anthropic
 * response headers and decides whether to throttle the next request.
 * Works alongside the existing RateLimiter (Sprint 21) but adds:
 *   - Parsing of anthropic-ratelimit-* headers
 *   - retry-after handling (429 responses)
 *   - shouldThrottle() predicate for the agent loop
 *
 * NOT a replacement for Sprint 21 RateLimiter — this is a focused
 * TPM survival shim for the D19 audit scenario.
 */

// ─── Types ───

export interface AnthropicRateLimitHeaders {
  /** Requests allowed per minute */
  requestLimit: number;
  /** Requests remaining in current window */
  requestsRemaining: number;
  /** When the request window resets (ISO 8601) */
  requestReset: string;
  /** Input tokens allowed per minute */
  tokensLimit: number;
  /** Input tokens remaining */
  tokensRemaining: number;
  /** When the token window resets */
  tokensReset: string;
  /** Retry-After seconds (only on 429) */
  retryAfterSec: number;
}

export interface ThrottleDecision {
  /** Whether the caller should wait before sending */
  shouldWait: boolean;
  /** How many ms to wait (0 if no wait needed) */
  waitMs: number;
  /** Human-readable reason */
  reason: string;
}

// ─── Thresholds ───

/** Start throttling when less than this fraction of tokens remain */
const TOKEN_THROTTLE_THRESHOLD = 0.15; // 15% remaining
/** Start throttling when less than this fraction of requests remain */
const REQUEST_THROTTLE_THRESHOLD = 0.10; // 10% remaining
/** Minimum wait time when throttling (ms) */
const MIN_THROTTLE_MS = 2000;
/** Maximum wait time (ms) */
const MAX_THROTTLE_MS = 60000;
/** Default retry-after when 429 but no header (ms) */
const DEFAULT_RETRY_MS = 30000;

// ─── State ───

let _lastHeaders: AnthropicRateLimitHeaders | null = null;
let _retryAfterUntil: number = 0; // timestamp when retry-after expires
let _consecutiveThrottles = 0;

// ─── Public API ───

/**
 * Parse Anthropic rate-limit headers from a fetch Response.
 * Call this after every API response (success or error).
 */
export function parseAnthropicHeaders(headers: Record<string, string>): AnthropicRateLimitHeaders {
  const parsed: AnthropicRateLimitHeaders = {
    requestLimit: parseInt(headers['anthropic-ratelimit-requests-limit'] || '0', 10),
    requestsRemaining: parseInt(headers['anthropic-ratelimit-requests-remaining'] || '0', 10),
    requestReset: headers['anthropic-ratelimit-requests-reset'] || '',
    tokensLimit: parseInt(headers['anthropic-ratelimit-tokens-limit'] || '0', 10),
    tokensRemaining: parseInt(headers['anthropic-ratelimit-tokens-remaining'] || '0', 10),
    tokensReset: headers['anthropic-ratelimit-tokens-reset'] || '',
    retryAfterSec: parseInt(headers['retry-after'] || '0', 10),
  };

  _lastHeaders = parsed;

  // If retry-after is set (429), record the expiry time
  if (parsed.retryAfterSec > 0) {
    _retryAfterUntil = Date.now() + parsed.retryAfterSec * 1000;
    _consecutiveThrottles++;
  } else {
    _consecutiveThrottles = 0;
  }

  return parsed;
}

/**
 * Record a 429 response with optional retry-after seconds.
 * Call this when the API returns HTTP 429.
 */
export function record429(retryAfterSec?: number): void {
  const waitSec = retryAfterSec || DEFAULT_RETRY_MS / 1000;
  _retryAfterUntil = Date.now() + waitSec * 1000;
  _consecutiveThrottles++;
}

/**
 * Determine whether the agent loop should throttle (wait) before the next API call.
 * This is the main predicate used by the agent loop.
 */
export function shouldThrottle(): ThrottleDecision {
  const now = Date.now();

  // 1. Hard retry-after from a 429
  if (_retryAfterUntil > now) {
    const waitMs = _retryAfterUntil - now;
    return {
      shouldWait: true,
      waitMs: Math.min(waitMs, MAX_THROTTLE_MS),
      reason: `Rate-limited (429). Waiting ${Math.ceil(waitMs / 1000)}s for retry-after to expire.`,
    };
  }

  // 2. Check header-based remaining capacity
  if (_lastHeaders && _lastHeaders.tokensLimit > 0) {
    const tokenFraction = _lastHeaders.tokensRemaining / _lastHeaders.tokensLimit;
    const requestFraction = _lastHeaders.requestLimit > 0
      ? _lastHeaders.requestsRemaining / _lastHeaders.requestLimit
      : 1;

    if (tokenFraction < TOKEN_THROTTLE_THRESHOLD) {
      const resetTime = _lastHeaders.tokensReset ? new Date(_lastHeaders.tokensReset).getTime() : now + 60000;
      const waitMs = Math.max(MIN_THROTTLE_MS, Math.min(resetTime - now, MAX_THROTTLE_MS));
      return {
        shouldWait: true,
        waitMs,
        reason: `Token budget low (${Math.round(tokenFraction * 100)}% remaining). Waiting ${Math.ceil(waitMs / 1000)}s.`,
      };
    }

    if (requestFraction < REQUEST_THROTTLE_THRESHOLD) {
      const resetTime = _lastHeaders.requestReset ? new Date(_lastHeaders.requestReset).getTime() : now + 60000;
      const waitMs = Math.max(MIN_THROTTLE_MS, Math.min(resetTime - now, MAX_THROTTLE_MS));
      return {
        shouldWait: true,
        waitMs,
        reason: `Request budget low (${Math.round(requestFraction * 100)}% remaining). Waiting ${Math.ceil(waitMs / 1000)}s.`,
      };
    }
  }

  return { shouldWait: false, waitMs: 0, reason: 'OK' };
}

/**
 * Get the last parsed headers (for diagnostics / /status command).
 */
export function getLastHeaders(): AnthropicRateLimitHeaders | null {
  return _lastHeaders ? { ..._lastHeaders } : null;
}

/**
 * Get consecutive throttle count (for circuit-breaker decisions).
 */
export function getConsecutiveThrottles(): number {
  return _consecutiveThrottles;
}

/**
 * Reset state (for tests or manual recovery).
 */
export function resetRateLimitLiteState(): void {
  _lastHeaders = null;
  _retryAfterUntil = 0;
  _consecutiveThrottles = 0;
}

/**
 * Format a snapshot for display in /status command.
 */
export function formatRateLimitLiteSnapshot(): string {
  if (!_lastHeaders) {
    return 'No Anthropic rate-limit headers received yet.';
  }

  const h = _lastHeaders;
  const lines = [
    '**Anthropic Rate Limits (from headers):**',
    `| Metric | Limit | Remaining | % Used |`,
    `|--------|-------|-----------|--------|`,
    `| Requests/min | ${h.requestLimit} | ${h.requestsRemaining} | ${h.requestLimit > 0 ? Math.round((1 - h.requestsRemaining / h.requestLimit) * 100) : 0}% |`,
    `| Tokens/min | ${h.tokensLimit} | ${h.tokensRemaining} | ${h.tokensLimit > 0 ? Math.round((1 - h.tokensRemaining / h.tokensLimit) * 100) : 0}% |`,
  ];

  if (_retryAfterUntil > Date.now()) {
    lines.push(`\n**Retry-After active:** ${Math.ceil((_retryAfterUntil - Date.now()) / 1000)}s remaining`);
  }
  if (_consecutiveThrottles > 0) {
    lines.push(`**Consecutive throttles:** ${_consecutiveThrottles}`);
  }

  return lines.join('\n');
}
