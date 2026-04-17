/**
 * AutoContinueToggle — Sprint 19 + Sprint 22 (Auto Mode Addendum)
 *
 * Sprint 22 enhancements:
 *  - Rich status indicator: Auto: On, Continuing, Waiting for tools,
 *    Paused (reason), Stopped (completion/safety), Stopped by user
 *  - Task plan progress sync (e.g., "2/6 tasks complete")
 *  - Phase-aware styling and icons
 *  - Pause reason display
 *  - Resume button when paused
 */

import React from 'react';

export type AutoContinuePhase =
  | 'idle'
  | 'enabled'
  | 'continuing'
  | 'waiting-for-tools'
  | 'paused'
  | 'stopped-complete'
  | 'stopped-safety'
  | 'stopped-user'
  | 'stopped-error';

export interface AutoContinueStatus {
  active: boolean;
  phase: AutoContinuePhase;
  currentIteration: number;
  maxIterations: number;
  lastStatus: string;
  pauseReason: string | null;
  cancelledBy: 'user' | 'safety' | 'completion' | 'error' | 'rate-limit' | null;
  tasksCompleted: number;
  tasksTotal: number;
}

interface AutoContinueToggleProps {
  enabled: boolean;
  status: AutoContinueStatus;
  onToggle: () => void;
  onCancel: () => void;
  onResume?: () => void;
}

export default function AutoContinueToggle({
  enabled,
  status,
  onToggle,
  onCancel,
  onResume,
}: AutoContinueToggleProps) {
  const isRunning = status.active && status.phase !== 'paused';
  const isPaused = status.active && status.phase === 'paused';
  const isStopped = !status.active && status.cancelledBy !== null;

  const phaseLabel = getPhaseLabel(status);
  const phaseIcon = getPhaseIcon(status);
  const phaseStyle = getPhaseStyle(status);

  return (
    <div className="flex items-center gap-1.5">
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold border cursor-pointer transition-all duration-150 ${phaseStyle}`}
        title={getTooltip(enabled, status)}
      >
        <span className={isRunning ? 'animate-spin-slow' : ''}>{phaseIcon}</span>
        <span>{phaseLabel}</span>
      </button>

      {/* Task progress (when active and has plan) */}
      {status.active && status.tasksTotal > 0 && (
        <span className="text-[9px] text-blue-400/60 font-mono" title={`${status.tasksCompleted} of ${status.tasksTotal} tasks completed`}>
          {status.tasksCompleted}/{status.tasksTotal}
        </span>
      )}

      {/* Resume button (visible when paused) */}
      {isPaused && onResume && (
        <button
          onClick={onResume}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-blue-400/20 text-blue-400/70 hover:bg-blue-400/10 transition-colors"
          title={`Resume auto-continue. Paused: ${status.pauseReason || 'unknown'}`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21" />
          </svg>
          <span>Resume</span>
        </button>
      )}

      {/* Cancel/Stop button (visible when running or paused) */}
      {(isRunning || isPaused) && (
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-matrix-danger/20 text-matrix-danger/70 hover:bg-matrix-danger/10 transition-colors"
          title="Stop auto-continue (Esc)"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
          <span>Stop</span>
        </button>
      )}

      {/* Pause reason badge */}
      {isPaused && status.pauseReason && (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400/70 max-w-[120px] truncate" title={status.pauseReason}>
          {status.pauseReason}
        </span>
      )}

      {/* Completion badge */}
      {isStopped && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${getStopBadgeStyle(status.cancelledBy)}`}>
          {getStopBadgeLabel(status.cancelledBy)}
        </span>
      )}
    </div>
  );
}

// ─── Style Helpers ───

function getPhaseLabel(status: AutoContinueStatus): string {
  if (!status.active) {
    return status.cancelledBy ? 'Auto: Off' : 'Auto';
  }

  switch (status.phase) {
    case 'enabled': return 'Auto: On';
    case 'continuing': return `Auto (${status.currentIteration}/${status.maxIterations})`;
    case 'waiting-for-tools': return 'Auto: Tools...';
    case 'paused': return 'Auto: Paused';
    default: return 'Auto';
  }
}

function getPhaseIcon(status: AutoContinueStatus): string {
  if (!status.active) return '\u27A1\uFE0F';

  switch (status.phase) {
    case 'enabled': return '\u2705';
    case 'continuing': return '\u267B\uFE0F';
    case 'waiting-for-tools': return '\u23F3';
    case 'paused': return '\u23F8\uFE0F';
    default: return '\u27A1\uFE0F';
  }
}

function getPhaseStyle(status: AutoContinueStatus): string {
  if (!status.active) {
    return 'border-matrix-border/20 text-matrix-text-muted/40 hover:text-matrix-text-dim hover:bg-matrix-bg-hover/30';
  }

  switch (status.phase) {
    case 'continuing':
      return 'border-blue-500/30 text-blue-400 bg-blue-500/10 hover:bg-blue-500/15';
    case 'enabled':
      return 'border-blue-500/20 text-blue-400/70 bg-blue-500/5 hover:bg-blue-500/10';
    case 'waiting-for-tools':
      return 'border-yellow-500/20 text-yellow-400/70 bg-yellow-500/5';
    case 'paused':
      return 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10';
    default:
      return 'border-matrix-border/20 text-matrix-text-muted/40';
  }
}

function getTooltip(enabled: boolean, status: AutoContinueStatus): string {
  if (!status.active && !enabled) {
    return 'Enable Auto-Continue: the AI will automatically keep working on multi-step tasks.';
  }
  if (status.phase === 'paused') {
    return `Auto-Continue is paused. Reason: ${status.pauseReason || 'unknown'}. Click to disable.`;
  }
  if (status.active) {
    return `Auto-Continue is running (${status.currentIteration}/${status.maxIterations}). Click to disable.`;
  }
  return 'Auto-Continue is enabled. The AI will keep working until the task is done.';
}

function getStopBadgeStyle(cancelledBy: string | null): string {
  switch (cancelledBy) {
    case 'completion': return 'bg-matrix-green/10 text-matrix-green/70';
    case 'safety': return 'bg-yellow-500/10 text-yellow-400/70';
    case 'error': return 'bg-red-500/10 text-red-400/70';
    case 'rate-limit': return 'bg-yellow-500/10 text-yellow-400/70';
    case 'user': return 'bg-matrix-text-muted/5 text-matrix-text-muted/30';
    default: return 'bg-matrix-text-muted/5 text-matrix-text-muted/30';
  }
}

function getStopBadgeLabel(cancelledBy: string | null): string {
  switch (cancelledBy) {
    case 'completion': return 'Done';
    case 'safety': return 'Safety limit';
    case 'error': return 'Errors';
    case 'rate-limit': return 'Rate limited';
    case 'user': return 'Cancelled';
    default: return 'Stopped';
  }
}
