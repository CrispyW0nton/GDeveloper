/**
 * TokenCounter — Sprint 24
 *
 * Live token usage display showing per-request input/output tokens,
 * cumulative session totals, context-window usage bar,
 * and rolling 60-second TPM from the rate-limit snapshot.
 *
 * Warns at >80% of Max Context Tokens.
 */

import React, { useState } from 'react';

export interface SessionUsage {
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeRequests: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  contextWindowUsed: number;
  contextWindowMax: number;
}

export interface RateLimitSnapshot {
  inputTokensLast60s: number;
  outputTokensLast60s: number;
  requestsLast60s: number;
  severity: 'green' | 'amber' | 'red';
  inputPercent: number;
  outputPercent: number;
  requestPercent: number;
  isPaused: boolean;
  isThrottled: boolean;
  recommendedDelayMs: number;
  lastUpdated: number;
}

interface TokenCounterProps {
  sessionUsage?: SessionUsage | null;
  rateLimitSnapshot?: RateLimitSnapshot | null;
  maxContextTokens?: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function TokenCounter({
  sessionUsage,
  rateLimitSnapshot,
  maxContextTokens = 200_000,
}: TokenCounterProps) {
  const [expanded, setExpanded] = useState(false);

  const usage: SessionUsage = sessionUsage ?? {
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    cumulativeRequests: 0,
    lastInputTokens: 0,
    lastOutputTokens: 0,
    contextWindowUsed: 0,
    contextWindowMax: maxContextTokens,
  };

  // AUDIT-ROUND-4 / TOKEN-CUMULATIVE-MISMATCH: use contextWindowUsed (the
  // CURRENT request's input-token size) instead of cumulativeInputTokens
  // (the running sum of every input ever sent in the session). The old
  // semantics caused the bar to report "context nearly full!" after a
  // multi-turn agent run even when each individual request was small.
  // Fallback to 0 if the main process hasn't reported yet.
  const contextMax = usage.contextWindowMax || maxContextTokens;
  const currentContext = usage.contextWindowUsed ?? 0;
  const contextPercent = contextMax > 0 ? currentContext / contextMax : 0;
  const contextPctClamped = Math.min(contextPercent, 1);
  const isContextWarning = contextPercent >= 0.8;
  const isContextCritical = contextPercent >= 0.95;

  // Compact pill
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all hover:opacity-80 ${
          isContextCritical
            ? 'bg-red-500/5 border-red-500/20 text-red-400'
            : isContextWarning
              ? 'bg-yellow-500/5 border-yellow-500/20 text-yellow-400'
              : 'bg-matrix-bg-hover/50 border-matrix-border/20 text-matrix-text-muted/50'
        }`}
        title={`Context: ${formatTokens(currentContext)} of ${formatTokens(contextMax)} (${Math.round(contextPercent * 100)}%)  |  Session totals: ${formatTokens(usage.cumulativeInputTokens)} in / ${formatTokens(usage.cumulativeOutputTokens)} out across ${usage.cumulativeRequests} request${usage.cumulativeRequests === 1 ? '' : 's'}`}
      >
        {isContextWarning && <span className="text-[8px]">{isContextCritical ? '\u26A0\uFE0F' : '\u26A0'}</span>}
        <span>{formatTokens(currentContext)}</span>
        <span className="text-matrix-text-muted/25">/</span>
        <span>{formatTokens(contextMax)}</span>
      </button>
    );
  }

  // Expanded panel
  return (
    <div className={`rounded-lg border p-3 text-xs font-mono space-y-2 ${
      isContextCritical
        ? 'bg-red-500/5 border-red-500/20'
        : isContextWarning
          ? 'bg-yellow-500/5 border-yellow-500/20'
          : 'bg-matrix-bg-hover/30 border-matrix-border/20'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-bold uppercase tracking-wider text-[10px] text-matrix-text-dim">Token Usage</span>
        <button onClick={() => setExpanded(false)} className="text-matrix-text-muted/40 hover:text-matrix-text-dim transition-colors text-[10px]">
          Collapse
        </button>
      </div>

      {/* Context Window Bar */}
      <div>
        <div className="flex justify-between text-[9px] text-matrix-text-muted/50 mb-0.5">
          <span>Current context (last request)</span>
          <span className={isContextWarning ? (isContextCritical ? 'text-red-400' : 'text-yellow-400') : ''}>
            {formatTokens(currentContext)} / {formatTokens(contextMax)} ({Math.round(contextPercent * 100)}%)
          </span>
        </div>
        <div className="h-1.5 bg-matrix-bg-hover rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isContextCritical ? 'bg-red-500' : isContextWarning ? 'bg-yellow-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${contextPctClamped * 100}%` }}
          />
        </div>
        {isContextWarning && (
          <div className={`text-[9px] mt-1 ${isContextCritical ? 'text-red-400' : 'text-yellow-400'}`}>
            {isContextCritical ? 'Context nearly full! Consider /clear or Compact.' : 'Context usage above 80%. Consider compacting history.'}
          </div>
        )}
      </div>

      {/* Per-request stats */}
      <div className="grid grid-cols-2 gap-2 text-[9px]">
        <div>
          <span className="text-matrix-text-muted/40">Last request in:</span>
          <span className="ml-1 text-matrix-text-dim">{formatTokens(usage.lastInputTokens)}</span>
        </div>
        <div>
          <span className="text-matrix-text-muted/40">Last request out:</span>
          <span className="ml-1 text-matrix-text-dim">{formatTokens(usage.lastOutputTokens)}</span>
        </div>
        <div>
          <span className="text-matrix-text-muted/40">Session in total:</span>
          <span className="ml-1 text-matrix-green">{formatTokens(usage.cumulativeInputTokens)}</span>
        </div>
        <div>
          <span className="text-matrix-text-muted/40">Session out total:</span>
          <span className="ml-1 text-matrix-green">{formatTokens(usage.cumulativeOutputTokens)}</span>
        </div>
        <div>
          <span className="text-matrix-text-muted/40">Requests:</span>
          <span className="ml-1 text-matrix-text-dim">{usage.cumulativeRequests}</span>
        </div>
      </div>

      {/* Rolling 60s TPM from rate-limit snapshot */}
      {rateLimitSnapshot && (
        <div className="pt-1 border-t border-matrix-border/20">
          <div className="text-[9px] text-matrix-text-muted/40 mb-1">Rolling 60s</div>
          <div className="grid grid-cols-3 gap-1 text-[9px]">
            <div>
              <span className="text-matrix-text-muted/30">In TPM:</span>
              <span className="ml-1 text-matrix-text-dim">{formatTokens(rateLimitSnapshot.inputTokensLast60s)}</span>
            </div>
            <div>
              <span className="text-matrix-text-muted/30">Out TPM:</span>
              <span className="ml-1 text-matrix-text-dim">{formatTokens(rateLimitSnapshot.outputTokensLast60s)}</span>
            </div>
            <div>
              <span className="text-matrix-text-muted/30">RPM:</span>
              <span className="ml-1 text-matrix-text-dim">{rateLimitSnapshot.requestsLast60s}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
