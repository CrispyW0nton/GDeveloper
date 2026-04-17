/**
 * Live Rate-Limit Tracker — Sprint 21
 *
 * Sliding-window counters for input tokens, output tokens, and requests
 * over the last 60 seconds. Emits state changes for the UI indicator.
 * Supports auto-slow-down (dynamic throttle) and hard-pause.
 */

import {
  TokenBudgetConfig,
  DEFAULT_TOKEN_BUDGET_CONFIG,
  ANTHROPIC_TIER_LIMITS,
  AnthropicTier,
} from './rateLimitConfig';

// ─── Types ───

export type RateLimitSeverity = 'green' | 'amber' | 'red';

export interface RateLimitSnapshot {
  inputTokensLast60s: number;
  outputTokensLast60s: number;
  requestsLast60s: number;
  severity: RateLimitSeverity;
  inputPercent: number;
  outputPercent: number;
  requestPercent: number;
  isPaused: boolean;
  isThrottled: boolean;
  /** Next recommended delay (ms) before sending.  0 = send immediately. */
  recommendedDelayMs: number;
  lastUpdated: number;
}

interface TimestampedEntry {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
}

// ─── Rate Limiter ───

const WINDOW_MS = 60_000; // 60 s sliding window
const AMBER_THRESHOLD = 0.75; // 75% of soft limit → amber
const RED_THRESHOLD = 0.90;   // 90% → red + auto-slow-down
const PAUSE_THRESHOLD = 0.98; // 98% → hard pause

export class RateLimiter {
  private entries: TimestampedEntry[] = [];
  private requestTimestamps: number[] = [];
  private config: TokenBudgetConfig;
  private _isPaused = false;
  private _isThrottled = false;
  private listeners: Array<(snapshot: RateLimitSnapshot) => void> = [];

  constructor(config?: TokenBudgetConfig) {
    this.config = config ?? { ...DEFAULT_TOKEN_BUDGET_CONFIG };
  }

  // ─── Configuration ───

  updateConfig(config: TokenBudgetConfig): void {
    this.config = config;
    this.evaluate();
  }

  getConfig(): TokenBudgetConfig {
    return { ...this.config };
  }

  // ─── Recording ───

  /** Call after every API response with actual usage from headers/body */
  recordUsage(inputTokens: number, outputTokens: number): void {
    const now = Date.now();
    this.entries.push({ timestamp: now, inputTokens, outputTokens });
    this.requestTimestamps.push(now);
    this.prune(now);
    this.evaluate();
  }

  /** Pre-check before sending: should we delay or pause? */
  preFlightCheck(): { ok: boolean; delayMs: number; reason?: string } {
    this.prune(Date.now());
    const snap = this.computeSnapshot();

    if (snap.isPaused) {
      return { ok: false, delayMs: 0, reason: 'Rate limit hard-pause active. Wait for the window to clear.' };
    }

    if (snap.recommendedDelayMs > 0) {
      return { ok: true, delayMs: snap.recommendedDelayMs, reason: `Throttled: waiting ${Math.round(snap.recommendedDelayMs / 1000)}s to stay under limits.` };
    }

    return { ok: true, delayMs: 0 };
  }

  /** Manually pause (e.g., after a 429 response) */
  pause(): void {
    this._isPaused = true;
    this.notifyListeners();
  }

  /** Resume after pause */
  resume(): void {
    this._isPaused = false;
    this._isThrottled = false;
    this.evaluate();
  }

  /** Reset all counters */
  reset(): void {
    this.entries = [];
    this.requestTimestamps = [];
    this._isPaused = false;
    this._isThrottled = false;
    this.notifyListeners();
  }

  // ─── Snapshot ───

  getSnapshot(): RateLimitSnapshot {
    this.prune(Date.now());
    return this.computeSnapshot();
  }

  // ─── Event Subscription ───

  onChange(listener: (snapshot: RateLimitSnapshot) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // ─── Internals ───

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    this.entries = this.entries.filter(e => e.timestamp > cutoff);
    this.requestTimestamps = this.requestTimestamps.filter(t => t > cutoff);
  }

  private evaluate(): void {
    const snap = this.computeSnapshot();

    // Auto-slow-down
    if (snap.inputPercent >= RED_THRESHOLD || snap.outputPercent >= RED_THRESHOLD || snap.requestPercent >= RED_THRESHOLD) {
      this._isThrottled = true;
    } else if (snap.inputPercent < AMBER_THRESHOLD && snap.outputPercent < AMBER_THRESHOLD && snap.requestPercent < AMBER_THRESHOLD) {
      this._isThrottled = false;
    }

    // Hard pause
    if (snap.inputPercent >= PAUSE_THRESHOLD || snap.outputPercent >= PAUSE_THRESHOLD || snap.requestPercent >= PAUSE_THRESHOLD) {
      this._isPaused = true;
    }

    // Auto-resume from hard pause when usage drops below red threshold
    if (this._isPaused && snap.inputPercent < RED_THRESHOLD && snap.outputPercent < RED_THRESHOLD && snap.requestPercent < RED_THRESHOLD) {
      this._isPaused = false;
    }

    this.notifyListeners();
  }

  private computeSnapshot(): RateLimitSnapshot {
    const inputTokensLast60s = this.entries.reduce((s, e) => s + e.inputTokens, 0);
    const outputTokensLast60s = this.entries.reduce((s, e) => s + e.outputTokens, 0);
    const requestsLast60s = this.requestTimestamps.length;

    const inputPercent = this.config.softInputTokensPerMinute > 0
      ? inputTokensLast60s / this.config.softInputTokensPerMinute
      : 0;
    const outputPercent = this.config.softOutputTokensPerMinute > 0
      ? outputTokensLast60s / this.config.softOutputTokensPerMinute
      : 0;
    const requestPercent = this.config.softRequestsPerMinute > 0
      ? requestsLast60s / this.config.softRequestsPerMinute
      : 0;

    const maxPercent = Math.max(inputPercent, outputPercent, requestPercent);

    let severity: RateLimitSeverity = 'green';
    if (maxPercent >= RED_THRESHOLD) severity = 'red';
    else if (maxPercent >= AMBER_THRESHOLD) severity = 'amber';

    // Compute recommended delay when throttled
    let recommendedDelayMs = 0;
    if (this._isThrottled && !this._isPaused) {
      // Wait until enough of the window expires to drop below amber
      const targetPercent = AMBER_THRESHOLD - 0.05;
      const excessInput = inputTokensLast60s - this.config.softInputTokensPerMinute * targetPercent;
      const excessOutput = outputTokensLast60s - this.config.softOutputTokensPerMinute * targetPercent;
      if (excessInput > 0 || excessOutput > 0) {
        // Estimate how many seconds until oldest entries expire
        const oldestTs = this.entries.length > 0 ? this.entries[0].timestamp : Date.now();
        const timeUntilOldestExpires = Math.max(0, (oldestTs + WINDOW_MS) - Date.now());
        recommendedDelayMs = Math.min(timeUntilOldestExpires + 2000, 30000);
      } else {
        recommendedDelayMs = 2000; // Minimum cooldown
      }
    }

    return {
      inputTokensLast60s,
      outputTokensLast60s,
      requestsLast60s,
      severity,
      inputPercent: Math.min(inputPercent, 1),
      outputPercent: Math.min(outputPercent, 1),
      requestPercent: Math.min(requestPercent, 1),
      isPaused: this._isPaused,
      isThrottled: this._isThrottled,
      recommendedDelayMs,
      lastUpdated: Date.now(),
    };
  }

  private notifyListeners(): void {
    const snap = this.computeSnapshot();
    for (const l of this.listeners) {
      try { l(snap); } catch { /* swallow listener errors */ }
    }
  }
}

// ─── Singleton ───

let rateLimiterInstance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter();
  }
  return rateLimiterInstance;
}

export function resetRateLimiter(): void {
  rateLimiterInstance?.reset();
  rateLimiterInstance = null;
}
