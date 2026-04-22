/**
 * Smart 429 Retry / Back-off Handler — Sprint 21
 *
 * Parses Anthropic rate-limit headers (retry-after, x-ratelimit-*),
 * uses server-suggested retry window or exponential backoff,
 * respects max retries, and emits state to the UI.
 */

import { RetryConfig, DEFAULT_RETRY_CONFIG } from './rateLimitConfig';
import { getRateLimiter } from './rateLimiter';

// ─── Types ───

export interface RetryState {
  isRetrying: boolean;
  attempt: number;
  maxAttempts: number;
  nextRetryMs: number;
  reason: string;
  gaveUp: boolean;
}

export type RetryListener = (state: RetryState) => void;

// ─── Rate-Limit Headers ───

interface ParsedRateLimitHeaders {
  retryAfterMs: number | null;
  inputTokensLimit: number | null;
  inputTokensRemaining: number | null;
  inputTokensReset: string | null;
  outputTokensLimit: number | null;
  outputTokensRemaining: number | null;
  requestsLimit: number | null;
  requestsRemaining: number | null;
  requestsReset: string | null;
}

export function parseRateLimitHeaders(headers: Record<string, string>): ParsedRateLimitHeaders {
  const get = (key: string): string | null => {
    // Headers may be lower-cased or mixed
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === key.toLowerCase()) return headers[k];
    }
    return null;
  };

  const toNum = (v: string | null): number | null => (v !== null ? Number(v) : null);

  // retry-after can be seconds or an HTTP-date
  let retryAfterMs: number | null = null;
  const retryAfter = get('retry-after');
  if (retryAfter !== null) {
    const secs = Number(retryAfter);
    if (!isNaN(secs)) {
      retryAfterMs = secs * 1000;
    } else {
      // HTTP-date
      const d = new Date(retryAfter);
      if (!isNaN(d.getTime())) {
        retryAfterMs = Math.max(0, d.getTime() - Date.now());
      }
    }
  }

  return {
    retryAfterMs,
    inputTokensLimit: toNum(get('x-ratelimit-limit-input-tokens') ?? get('anthropic-ratelimit-input-tokens-limit')),
    inputTokensRemaining: toNum(get('x-ratelimit-remaining-input-tokens') ?? get('anthropic-ratelimit-input-tokens-remaining')),
    inputTokensReset: get('x-ratelimit-reset-input-tokens') ?? get('anthropic-ratelimit-input-tokens-reset'),
    outputTokensLimit: toNum(get('x-ratelimit-limit-output-tokens') ?? get('anthropic-ratelimit-output-tokens-limit')),
    outputTokensRemaining: toNum(get('x-ratelimit-remaining-output-tokens') ?? get('anthropic-ratelimit-output-tokens-remaining')),
    requestsLimit: toNum(get('x-ratelimit-limit-requests') ?? get('anthropic-ratelimit-requests-limit')),
    requestsRemaining: toNum(get('x-ratelimit-remaining-requests') ?? get('anthropic-ratelimit-requests-remaining')),
    requestsReset: get('x-ratelimit-reset-requests') ?? get('anthropic-ratelimit-requests-reset'),
  };
}

// ─── Retry Handler ───

export class RetryHandler {
  private config: RetryConfig;
  private listeners: RetryListener[] = [];
  private currentState: RetryState = {
    isRetrying: false,
    attempt: 0,
    maxAttempts: DEFAULT_RETRY_CONFIG.maxRetries,
    nextRetryMs: 0,
    reason: '',
    gaveUp: false,
  };

  constructor(config?: RetryConfig) {
    this.config = config ?? { ...DEFAULT_RETRY_CONFIG };
  }

  updateConfig(config: RetryConfig): void {
    this.config = config;
    this.currentState.maxAttempts = config.maxRetries;
  }

  getState(): RetryState {
    return { ...this.currentState };
  }

  onStateChange(listener: RetryListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Execute an async operation with smart retry on 429 errors.
   * The `fn` receives the attempt number (0-based) and should throw
   * a RateLimitError (or any error with status 429 / message containing '429')
   * when rate-limited.
   */
  async executeWithRetry<T>(
    fn: (attempt: number) => Promise<T>,
    options?: {
      /** Optional: response headers from the last failed request */
      getLastHeaders?: () => Record<string, string> | null;
    }
  ): Promise<T> {
    this.resetState();

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await fn(attempt);
        // Success — reset state
        if (attempt > 0) {
          this.setState({ isRetrying: false, attempt, reason: 'Succeeded after retry', gaveUp: false });
        }
        return result;
      } catch (err: any) {
        const is429 = this.isRateLimitError(err);
        if (!is429) throw err; // Re-throw non-rate-limit errors

        // Notify the rate limiter about the 429
        getRateLimiter().pause();

        if (attempt >= this.config.maxRetries) {
          this.setState({
            isRetrying: false,
            attempt,
            reason: `Gave up after ${attempt + 1} attempts: ${err.message || 'Rate limited'}`,
            gaveUp: true,
          });
          throw err;
        }

        // Compute delay
        let delayMs = this.computeDelay(attempt);

        // If we have response headers, prefer server-suggested delay
        if (options?.getLastHeaders) {
          const headers = options.getLastHeaders();
          if (headers) {
            const parsed = parseRateLimitHeaders(headers);
            if (parsed.retryAfterMs && parsed.retryAfterMs > 0) {
              delayMs = Math.min(parsed.retryAfterMs + 500, this.config.maxDelayMs);
            }
          }
        }

        this.setState({
          isRetrying: true,
          attempt: attempt + 1,
          nextRetryMs: delayMs,
          reason: `Rate limited (429). Retrying in ${Math.round(delayMs / 1000)}s... (${attempt + 1}/${this.config.maxRetries})`,
          gaveUp: false,
        });

        await this.sleep(delayMs);
      }
    }

    // Should not reach here, but just in case
    throw new Error('RetryHandler: exhausted retries');
  }

  // ─── Internals ───

  private computeDelay(attempt: number): number {
    switch (this.config.strategy) {
      case 'none':
        return 0;
      case 'linear':
        return Math.min(this.config.baseDelayMs * (attempt + 1), this.config.maxDelayMs);
      case 'exponential':
      default: {
        // Exponential with jitter
        const expDelay = this.config.baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * this.config.baseDelayMs * 0.3;
        return Math.min(expDelay + jitter, this.config.maxDelayMs);
      }
    }
  }

  private isRateLimitError(err: any): boolean {
    if (err?.status === 429) return true;
    if (err?.statusCode === 429) return true;
    const msg = String(err?.message || '');
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('too many requests')) return true;
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private setState(partial: Partial<RetryState>): void {
    this.currentState = { ...this.currentState, ...partial };
    for (const l of this.listeners) {
      try { l(this.currentState); } catch { /* swallow */ }
    }
  }

  private resetState(): void {
    this.currentState = {
      isRetrying: false,
      attempt: 0,
      maxAttempts: this.config.maxRetries,
      nextRetryMs: 0,
      reason: '',
      gaveUp: false,
    };
  }

  /**
   * AUDIT-ROUND-4 / FRESH-CHAT-DOES-NOT-RESET: public reset API so
   * CHAT_CLEAR / session switches can wipe any lingering retry state
   * (e.g. `isRetrying: true, gaveUp: true` from the previous chat's
   * last 429) before a fresh chat starts. Also notifies listeners so
   * the retry-countdown banner in the UI clears immediately.
   */
  reset(): void {
    this.resetState();
    for (const l of this.listeners) {
      try { l(this.currentState); } catch { /* swallow */ }
    }
  }
}

// ─── Singleton ───

let retryHandlerInstance: RetryHandler | null = null;

export function getRetryHandler(): RetryHandler {
  if (!retryHandlerInstance) {
    retryHandlerInstance = new RetryHandler();
  }
  return retryHandlerInstance;
}
