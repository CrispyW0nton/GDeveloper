/**
 * Auto-Continue Engine — Sprint 19 + Sprint 22 (Auto Mode Addendum)
 *
 * Sprint 22 fixes & enhancements:
 *  - shouldAutoContinue() logic that checks: Auto enabled, tasks remain, no final answer,
 *    no blocking confirmation, no safety/rate-limit caps
 *  - Improved completion detection using task ledger, intent patterns, pending checklist
 *  - Explicit scheduler with debounce (150-500ms) to prevent duplicates and race conditions
 *  - Pause for confirmations, high-risk tools, rate-limit backoffs, user input, modals
 *  - Activity logging for all auto-mode decisions
 *  - Configurable limits: max auto turns, max time, max retries, debounce delay,
 *    pause-on-risk, stop-on-rate-limit toggles
 *
 * Safety rails preserved from Sprint 19:
 *   - Configurable max iterations (default 10)
 *   - Max elapsed time (default 10 minutes)
 *   - Stop on repeated errors
 *   - Stop on destructive tool calls in plan mode
 *   - User can cancel at any time
 */

import { getActivePlan } from '../tools/taskPlan';

// ─── Types ───

export interface AutoContinueConfig {
  maxIterations: number;         // default 10
  maxElapsedMs: number;          // default 600_000 (10 min)
  pauseOnErrors: boolean;        // default true — stop after 2 consecutive errors
  debounceMs: number;            // default 300ms — debounce between auto-continue turns
  pauseOnHighRisk: boolean;      // default true — pause for destructive/risky tools
  stopOnRateLimit: boolean;      // default true — stop when rate-limited
  maxConsecutiveRetries: number;  // default 2
}

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

export interface AutoContinueState {
  active: boolean;
  phase: AutoContinuePhase;
  currentIteration: number;
  maxIterations: number;
  startedAt: number | null;
  maxElapsedMs: number;
  consecutiveErrors: number;
  lastStatus: string;
  pauseReason: string | null;
  cancelledBy: 'user' | 'safety' | 'completion' | 'error' | 'rate-limit' | null;
  /** Sprint 22: Task plan progress */
  tasksCompleted: number;
  tasksTotal: number;
  /** Sprint 22: Activity log */
  log: AutoContinueLogEntry[];
}

export interface AutoContinueLogEntry {
  timestamp: number;
  action: 'enabled' | 'scheduled' | 'skipped' | 'paused' | 'resumed' | 'stopped' | 'cancelled' | 'iteration' | 'error';
  reason: string;
}

export type ShouldContinueDecision = {
  shouldContinue: boolean;
  reason: string;
  phase: AutoContinuePhase;
};

export const DEFAULT_CONFIG: AutoContinueConfig = {
  maxIterations: 10,
  maxElapsedMs: 10 * 60 * 1000, // 10 minutes
  pauseOnErrors: true,
  debounceMs: 300,
  pauseOnHighRisk: true,
  stopOnRateLimit: true,
  maxConsecutiveRetries: 2,
};

// ─── Singleton state ───

let state: AutoContinueState = createInitialState();
let config: AutoContinueConfig = { ...DEFAULT_CONFIG };

// Debounce control
let scheduledTimeout: ReturnType<typeof setTimeout> | null = null;
let isSchedulePending = false;

function createInitialState(): AutoContinueState {
  return {
    active: false,
    phase: 'idle',
    currentIteration: 0,
    maxIterations: DEFAULT_CONFIG.maxIterations,
    startedAt: null,
    maxElapsedMs: DEFAULT_CONFIG.maxElapsedMs,
    consecutiveErrors: 0,
    lastStatus: 'idle',
    pauseReason: null,
    cancelledBy: null,
    tasksCompleted: 0,
    tasksTotal: 0,
    log: [],
  };
}

function logAction(action: AutoContinueLogEntry['action'], reason: string): void {
  state.log.push({ timestamp: Date.now(), action, reason });
  // Keep log bounded
  if (state.log.length > 100) {
    state.log = state.log.slice(-50);
  }
}

// ─── Public API ───

export function startAutoContinue(userConfig?: Partial<AutoContinueConfig>): AutoContinueState {
  const merged = { ...DEFAULT_CONFIG, ...userConfig };
  config = merged;
  state = {
    active: true,
    phase: 'enabled',
    currentIteration: 0,
    maxIterations: merged.maxIterations,
    startedAt: Date.now(),
    maxElapsedMs: merged.maxElapsedMs,
    consecutiveErrors: 0,
    lastStatus: 'Auto mode enabled',
    pauseReason: null,
    cancelledBy: null,
    tasksCompleted: 0,
    tasksTotal: 0,
    log: [],
  };
  logAction('enabled', `Auto-continue started (max ${merged.maxIterations} iterations, ${Math.round(merged.maxElapsedMs / 60000)} min)`);
  updateTaskProgress();
  return { ...state };
}

export function stopAutoContinue(reason: 'user' | 'safety' | 'completion' | 'error' | 'rate-limit'): AutoContinueState {
  cancelScheduled();
  state.active = false;
  state.cancelledBy = reason;

  switch (reason) {
    case 'user':
      state.phase = 'stopped-user';
      state.lastStatus = 'Stopped by user';
      break;
    case 'completion':
      state.phase = 'stopped-complete';
      state.lastStatus = 'Completed';
      break;
    case 'safety':
      state.phase = 'stopped-safety';
      state.lastStatus = 'Stopped (safety limit)';
      break;
    case 'error':
      state.phase = 'stopped-error';
      state.lastStatus = 'Stopped (errors)';
      break;
    case 'rate-limit':
      state.phase = 'stopped-safety';
      state.lastStatus = 'Stopped (rate limited)';
      break;
  }

  logAction('stopped', `Auto-continue stopped: ${reason}`);
  return { ...state };
}

export function pauseAutoContinue(reason: string): AutoContinueState {
  cancelScheduled();
  state.phase = 'paused';
  state.pauseReason = reason;
  state.lastStatus = `Paused: ${reason}`;
  logAction('paused', reason);
  return { ...state };
}

export function resumeAutoContinue(): AutoContinueState {
  if (state.phase !== 'paused' || !state.active) {
    return { ...state };
  }
  state.phase = 'continuing';
  state.pauseReason = null;
  state.lastStatus = 'Resumed';
  logAction('resumed', 'Auto-continue resumed by user');
  return { ...state };
}

export function getAutoContinueState(): AutoContinueState {
  updateTaskProgress();
  return { ...state };
}

export function getAutoContinueConfig(): AutoContinueConfig {
  return { ...config };
}

export function isAutoContinueActive(): boolean {
  return state.active;
}

export function getAutoContinueLog(): AutoContinueLogEntry[] {
  return [...state.log];
}

// ─── Sprint 22: shouldAutoContinue() — comprehensive decision logic ───

export interface AutoContinueContext {
  lastResponse: string;
  hadErrors: boolean;
  hasToolCallsPending: boolean;
  hasPendingConfirmation: boolean;
  hasHighRiskPendingTool: boolean;
  isRateLimited: boolean;
  isUserInputRequired: boolean;
  isModalOpen: boolean;
}

export function shouldAutoContinue(ctx: AutoContinueContext): ShouldContinueDecision {
  // Not active
  if (!state.active) {
    return { shouldContinue: false, reason: 'Auto-continue is not active', phase: state.phase };
  }

  // Paused state
  if (state.phase === 'paused') {
    return { shouldContinue: false, reason: `Paused: ${state.pauseReason}`, phase: 'paused' };
  }

  // Rate limit check
  if (ctx.isRateLimited && config.stopOnRateLimit) {
    stopAutoContinue('rate-limit');
    return { shouldContinue: false, reason: 'Rate limit active', phase: 'stopped-safety' };
  }

  // Pending confirmation — pause, don't stop
  if (ctx.hasPendingConfirmation) {
    pauseAutoContinue('Waiting for user confirmation');
    return { shouldContinue: false, reason: 'Waiting for user confirmation', phase: 'paused' };
  }

  // High-risk tool pause
  if (ctx.hasHighRiskPendingTool && config.pauseOnHighRisk) {
    pauseAutoContinue('High-risk tool requires approval');
    return { shouldContinue: false, reason: 'High-risk tool requires approval', phase: 'paused' };
  }

  // User input required
  if (ctx.isUserInputRequired) {
    pauseAutoContinue('Waiting for user input');
    return { shouldContinue: false, reason: 'Waiting for user input', phase: 'paused' };
  }

  // Modal open
  if (ctx.isModalOpen) {
    pauseAutoContinue('Modal dialog is open');
    return { shouldContinue: false, reason: 'Modal dialog is open', phase: 'paused' };
  }

  // Check iteration limit
  if (state.currentIteration >= state.maxIterations) {
    stopAutoContinue('safety');
    return { shouldContinue: false, reason: `Reached max iterations (${state.maxIterations})`, phase: 'stopped-safety' };
  }

  // Check time limit
  if (state.startedAt && (Date.now() - state.startedAt) > state.maxElapsedMs) {
    stopAutoContinue('safety');
    return { shouldContinue: false, reason: `Exceeded time limit (${Math.round(state.maxElapsedMs / 60000)} min)`, phase: 'stopped-safety' };
  }

  // Check consecutive errors
  if (ctx.hadErrors) {
    state.consecutiveErrors++;
    if (state.consecutiveErrors >= config.maxConsecutiveRetries) {
      stopAutoContinue('error');
      return { shouldContinue: false, reason: 'Too many consecutive errors', phase: 'stopped-error' };
    }
    logAction('error', `Error recorded (${state.consecutiveErrors}/${config.maxConsecutiveRetries})`);
  } else {
    state.consecutiveErrors = 0;
  }

  // Check completion signals
  if (detectCompletionSignal(ctx.lastResponse)) {
    // Double-check: if task plan has pending items, don't treat as complete
    const plan = getActivePlan();
    if (plan && plan.tasks.length > 0) {
      const pending = plan.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
      if (pending.length > 0) {
        // AI says done but tasks remain — this is an interim summary, not completion
        logAction('skipped', 'Completion signal detected but tasks remain in plan');
      } else {
        stopAutoContinue('completion');
        return { shouldContinue: false, reason: 'All tasks completed', phase: 'stopped-complete' };
      }
    } else {
      // No plan — trust the completion signal
      stopAutoContinue('completion');
      return { shouldContinue: false, reason: 'AI signaled task completion', phase: 'stopped-complete' };
    }
  }

  // Check task plan completion (even without completion text)
  const plan = getActivePlan();
  if (plan && plan.tasks.length > 0) {
    const allDone = plan.tasks.every(t => t.status === 'done' || t.status === 'skipped');
    if (allDone) {
      stopAutoContinue('completion');
      return { shouldContinue: false, reason: 'All task plan items completed', phase: 'stopped-complete' };
    }
  }

  // Waiting for tool results
  if (ctx.hasToolCallsPending) {
    state.phase = 'waiting-for-tools';
    state.lastStatus = 'Waiting for tools to complete';
    logAction('skipped', 'Waiting for pending tool calls');
    return { shouldContinue: false, reason: 'Waiting for tool calls to complete', phase: 'waiting-for-tools' };
  }

  // All checks passed — increment and continue
  state.currentIteration++;
  state.phase = 'continuing';
  state.lastStatus = `Continuing (${state.currentIteration}/${state.maxIterations})`;
  updateTaskProgress();
  logAction('iteration', `Iteration ${state.currentIteration}/${state.maxIterations}`);

  return { shouldContinue: true, reason: state.lastStatus, phase: 'continuing' };
}

// ─── Sprint 22: Debounced Scheduler ───

type SchedulerCallback = () => void;

export function scheduleNextTurn(callback: SchedulerCallback): boolean {
  // Prevent duplicate scheduling
  if (isSchedulePending) {
    logAction('skipped', 'Duplicate schedule prevented');
    return false;
  }

  if (!state.active || state.phase === 'paused') {
    return false;
  }

  isSchedulePending = true;
  scheduledTimeout = setTimeout(() => {
    isSchedulePending = false;
    scheduledTimeout = null;

    // Re-check active state before calling back
    if (state.active && state.phase !== 'paused') {
      logAction('scheduled', 'Executing scheduled turn');
      callback();
    }
  }, config.debounceMs);

  return true;
}

export function cancelScheduled(): void {
  if (scheduledTimeout) {
    clearTimeout(scheduledTimeout);
    scheduledTimeout = null;
  }
  isSchedulePending = false;
}

// ─── Legacy API (backward compat with Sprint 19) ───

/**
 * @deprecated Use shouldAutoContinue() instead.
 * Kept for backward compatibility with existing code paths.
 */
export function shouldContinueNext(lastResponse: string, hadErrors: boolean): { shouldContinue: boolean; reason: string } {
  const decision = shouldAutoContinue({
    lastResponse,
    hadErrors,
    hasToolCallsPending: false,
    hasPendingConfirmation: false,
    hasHighRiskPendingTool: false,
    isRateLimited: false,
    isUserInputRequired: false,
    isModalOpen: false,
  });
  return { shouldContinue: decision.shouldContinue, reason: decision.reason };
}

/**
 * Build the structured continue nudge message.
 */
export function buildContinueNudge(): string {
  const plan = getActivePlan();

  if (plan && plan.tasks.length > 0) {
    const done = plan.tasks.filter(t => t.status === 'done').length;
    const total = plan.tasks.length;
    const pending = plan.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
    const nextTask = pending[0];

    return [
      `Continue with the task plan (${done}/${total} completed).`,
      nextTask ? `Next task: "${nextTask.content}"` : '',
      `Step ${state.currentIteration} of ${state.maxIterations} max.`,
      'Please continue implementing. If you are finished, say "All tasks are complete."',
    ].filter(Boolean).join(' ');
  }

  return [
    `Continue working on the current task.`,
    `Step ${state.currentIteration} of ${state.maxIterations} max.`,
    'If you have completed everything, provide a final summary.',
  ].join(' ');
}

// ─── Internal Helpers ───

function updateTaskProgress(): void {
  const plan = getActivePlan();
  if (plan && plan.tasks.length > 0) {
    state.tasksTotal = plan.tasks.length;
    state.tasksCompleted = plan.tasks.filter(t => t.status === 'done' || t.status === 'skipped').length;
  }
}

// ─── Completion Detection ───

const COMPLETION_PATTERNS = [
  /all\s+(tasks?\s+)?(are\s+)?complete/i,
  /implementation\s+is\s+(now\s+)?complete/i,
  /everything\s+(has\s+been|is)\s+(implemented|done|complete)/i,
  /all\s+changes\s+(have\s+been|are)\s+(made|applied|committed)/i,
  /final\s+summary/i,
  /sprint\s+\d+\s+(is\s+)?(now\s+)?complete/i,
  /that\s+covers?\s+(all|everything)/i,
  /no\s+more\s+(pending\s+)?tasks/i,
  /finished\s+(implementing|all)/i,
];

// Patterns that look like completion but aren't (interim summaries)
const FALSE_COMPLETION_PATTERNS = [
  /let me continue/i,
  /next,?\s+I('ll| will)/i,
  /moving on to/i,
  /now let('s| us)/i,
  /the next step/i,
  /still (need|have) to/i,
  /remaining (tasks?|items?|work)/i,
];

function detectCompletionSignal(content: string): boolean {
  if (!content || content.length < 20) return false;

  // Check for false-positive patterns first
  if (FALSE_COMPLETION_PATTERNS.some(p => p.test(content))) {
    return false;
  }

  return COMPLETION_PATTERNS.some(pattern => pattern.test(content));
}
