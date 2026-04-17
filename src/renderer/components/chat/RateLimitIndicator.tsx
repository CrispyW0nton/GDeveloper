/**
 * RateLimitIndicator — Sprint 21
 *
 * Live rate-limit dashboard showing input/output tokens and request count
 * for the last 60 seconds. Displays green/amber/red severity states,
 * warnings, auto-slow-down indicator, and pause/retry status.
 *
 * Compact mode: shows a small pill in the chat header.
 * Expanded mode: shows full breakdown (click to toggle).
 */

import React, { useState, useEffect, useCallback } from 'react';

// ─── Types (mirrored from main process for renderer) ───

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
  recommendedDelayMs: number;
  lastUpdated: number;
}

export interface RetryState {
  isRetrying: boolean;
  attempt: number;
  maxAttempts: number;
  nextRetryMs: number;
  reason: string;
  gaveUp: boolean;
}

interface RateLimitIndicatorProps {
  /** Pass snapshot from main process via IPC or local state */
  snapshot?: RateLimitSnapshot | null;
  retryState?: RetryState | null;
  /** Soft limits for display */
  softInputLimit?: number;
  softOutputLimit?: number;
  softRequestLimit?: number;
  /** Callbacks */
  onPauseResume?: () => void;
  onReset?: () => void;
}

// ─── Severity Colors ───

const SEVERITY_COLORS: Record<RateLimitSeverity, { bg: string; border: string; text: string; dot: string }> = {
  green: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  amber: { bg: 'bg-yellow-500/5', border: 'border-yellow-500/20', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  red: { bg: 'bg-red-500/5', border: 'border-red-500/20', text: 'text-red-400', dot: 'bg-red-400' },
};

// ─── Format Helpers ───

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ─── Component ───

export default function RateLimitIndicator({
  snapshot,
  retryState,
  softInputLimit = 400_000,
  softOutputLimit = 14_000,
  softRequestLimit = 45,
  onPauseResume,
  onReset,
}: RateLimitIndicatorProps) {
  const [expanded, setExpanded] = useState(false);

  // Default snapshot when none provided
  const snap: RateLimitSnapshot = snapshot ?? {
    inputTokensLast60s: 0,
    outputTokensLast60s: 0,
    requestsLast60s: 0,
    severity: 'green',
    inputPercent: 0,
    outputPercent: 0,
    requestPercent: 0,
    isPaused: false,
    isThrottled: false,
    recommendedDelayMs: 0,
    lastUpdated: Date.now(),
  };

  const colors = SEVERITY_COLORS[snap.severity];

  // ─── Compact Pill ───
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all hover:opacity-80 ${colors.bg} ${colors.border} ${colors.text}`}
        title={`Rate Limit: ${snap.severity} | Input: ${formatTokens(snap.inputTokensLast60s)} | Output: ${formatTokens(snap.outputTokensLast60s)} | Requests: ${snap.requestsLast60s}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${colors.dot} ${snap.severity === 'red' ? 'animate-pulse' : snap.severity === 'amber' ? 'animate-pulseDot' : ''}`} />
        <span>{formatTokens(snap.inputTokensLast60s)}</span>
        {snap.isPaused && <span className="text-red-400 font-bold">PAUSED</span>}
        {snap.isThrottled && !snap.isPaused && <span className="text-yellow-400">SLOW</span>}
        {retryState?.isRetrying && <span className="text-yellow-300 animate-pulse">RETRY</span>}
      </button>
    );
  }

  // ─── Expanded Panel ───
  return (
    <div className={`rounded-lg border p-3 text-xs font-mono space-y-2 ${colors.bg} ${colors.border} ${colors.text}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${colors.dot} ${snap.severity !== 'green' ? 'animate-pulse' : ''}`} />
          <span className="font-bold uppercase tracking-wider text-[10px]">Rate Limit — {snap.severity}</span>
        </div>
        <button onClick={() => setExpanded(false)} className="text-matrix-text-muted/40 hover:text-matrix-text-dim transition-colors text-[10px]">
          Collapse
        </button>
      </div>

      {/* Bars */}
      <div className="space-y-1.5">
        <RateBar label="Input tokens" value={snap.inputTokensLast60s} limit={softInputLimit} percent={snap.inputPercent} />
        <RateBar label="Output tokens" value={snap.outputTokensLast60s} limit={softOutputLimit} percent={snap.outputPercent} />
        <RateBar label="Requests" value={snap.requestsLast60s} limit={softRequestLimit} percent={snap.requestPercent} />
      </div>

      {/* Status Messages */}
      {snap.isPaused && (
        <div className="text-red-400 text-[10px] bg-red-400/5 border border-red-400/20 rounded px-2 py-1">
          Hard pause active — waiting for usage to drop below 90%.
        </div>
      )}
      {snap.isThrottled && !snap.isPaused && (
        <div className="text-yellow-400 text-[10px] bg-yellow-400/5 border border-yellow-400/20 rounded px-2 py-1">
          Auto-throttle: adding ~{Math.round(snap.recommendedDelayMs / 1000)}s delay between requests.
        </div>
      )}

      {/* Retry State */}
      {retryState?.isRetrying && (
        <div className="text-yellow-300 text-[10px] bg-yellow-300/5 border border-yellow-300/20 rounded px-2 py-1 animate-pulse">
          {retryState.reason}
        </div>
      )}
      {retryState?.gaveUp && (
        <div className="text-red-400 text-[10px] bg-red-400/5 border border-red-400/20 rounded px-2 py-1">
          {retryState.reason}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {snap.isPaused && onPauseResume && (
          <button onClick={onPauseResume} className="matrix-btn text-[10px] px-2 py-0.5">
            Resume
          </button>
        )}
        {onReset && (
          <button onClick={onReset} className="matrix-btn text-[10px] px-2 py-0.5 opacity-50 hover:opacity-100">
            Reset Counters
          </button>
        )}
      </div>

      {/* Timestamp */}
      <div className="text-[9px] text-matrix-text-muted/25">
        Updated: {new Date(snap.lastUpdated).toLocaleTimeString()} | Window: 60s
      </div>
    </div>
  );
}

// ─── Rate Bar Sub-Component ───

function RateBar({ label, value, limit, percent }: { label: string; value: number; limit: number; percent: number }) {
  const pct = Math.min(percent * 100, 100);
  let barColor = 'bg-emerald-500';
  if (pct >= 90) barColor = 'bg-red-500';
  else if (pct >= 75) barColor = 'bg-yellow-500';

  return (
    <div>
      <div className="flex justify-between text-[9px] text-matrix-text-muted/50 mb-0.5">
        <span>{label}</span>
        <span>{formatTokens(value)} / {formatTokens(limit)} ({formatPercent(percent)})</span>
      </div>
      <div className="h-1 bg-matrix-bg-hover rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
