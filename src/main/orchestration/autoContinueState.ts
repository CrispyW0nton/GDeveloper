/**
 * Auto-Continue State Machine — Sprint 27.2
 *
 * Root-cause fix for 6 bugs observed in 3 stalled test sessions:
 *   Bug B  – step counter locked at 1/10 (currentIteration never incremented by nudge)
 *   Bug D  – no silent-stall circuit breaker
 *   Bug F  – no empty-turn self-check
 *   Bug H  – Auto-Continue fires on text-only turns (stateless timer)
 *   Bug I  – no user-pause state
 *
 * Design:
 *   AutoContinueMode  = 'idle' | 'running' | 'paused-user' | 'paused-stall' | 'done'
 *   shouldFireNudge() = the ONLY place the renderer should ask "should I send a nudge?"
 *   It returns { fire: false } when the last turn was text-only (no tool calls),
 *   when stall threshold is exceeded, or when user paused.
 */

// ─── Types ───

export type AutoContinueMode =
  | 'idle'
  | 'running'
  | 'paused-user'
  | 'paused-stall'
  | 'done';

export interface AutoContinueState {
  mode: AutoContinueMode;
  step: number;
  maxSteps: number;
  startedAt: number | null;
  /** Timestamp of last completed turn (tool or text) */
  lastTurnAt: number | null;
  /** True if the last assistant turn contained tool_use blocks */
  lastTurnHadTools: boolean;
  /** True if the last assistant turn contained text output */
  lastTurnHadText: boolean;
  /** Count of consecutive text-only turns (no tool calls) */
  consecutiveTextOnlyTurns: number;
  /** Count of consecutive empty turns (no text, no tools) */
  consecutiveEmptyTurns: number;
  /** Stall threshold in ms — if no turn completes within this window, pause */
  stallThresholdMs: number;
  /** Max consecutive text-only turns before pausing */
  maxTextOnlyTurns: number;
  /** Reason the loop paused/stopped */
  pauseReason: string | null;
  /** Task progress tracking */
  tasksCompleted: number;
  tasksTotal: number;
}

export interface ShouldFireResult {
  fire: boolean;
  reason: string;
  mode: AutoContinueMode;
  step: number;
  maxSteps: number;
}

// ─── Default config ───

export const DEFAULT_MAX_STEPS = 25;
export const DEFAULT_STALL_THRESHOLD_MS = 90_000; // 90 seconds
export const DEFAULT_MAX_TEXT_ONLY_TURNS = 2;

// ─── State Factory ───

export function createInitialState(maxSteps: number = DEFAULT_MAX_STEPS): AutoContinueState {
  return {
    mode: 'idle',
    step: 0,
    maxSteps,
    startedAt: null,
    lastTurnAt: null,
    lastTurnHadTools: false,
    lastTurnHadText: false,
    consecutiveTextOnlyTurns: 0,
    consecutiveEmptyTurns: 0,
    stallThresholdMs: DEFAULT_STALL_THRESHOLD_MS,
    maxTextOnlyTurns: DEFAULT_MAX_TEXT_ONLY_TURNS,
    pauseReason: null,
    tasksCompleted: 0,
    tasksTotal: 0,
  };
}

// ─── Singleton ───

let _state: AutoContinueState = createInitialState();

export function getState(): AutoContinueState {
  return { ..._state };
}

// ─── Lifecycle ───

export function startMachine(maxSteps: number = DEFAULT_MAX_STEPS): AutoContinueState {
  _state = {
    ...createInitialState(maxSteps),
    mode: 'running',
    startedAt: Date.now(),
    lastTurnAt: Date.now(),
  };
  return getState();
}

export function stopMachine(reason: string = 'stopped'): AutoContinueState {
  _state.mode = 'done';
  _state.pauseReason = reason;
  return getState();
}

export function pauseByUser(): AutoContinueState {
  if (_state.mode === 'running') {
    _state.mode = 'paused-user';
    _state.pauseReason = 'Paused by user';
  }
  return getState();
}

export function resumeByUser(): AutoContinueState {
  if (_state.mode === 'paused-user' || _state.mode === 'paused-stall') {
    _state.mode = 'running';
    _state.pauseReason = null;
    _state.lastTurnAt = Date.now(); // Reset stall timer on resume
    _state.consecutiveTextOnlyTurns = 0;
    _state.consecutiveEmptyTurns = 0;
  }
  return getState();
}

// ─── Turn Reporting ───

/**
 * Called by the agent loop after each completed turn.
 * Records whether the turn had tool calls, text output, or was empty.
 */
export function recordTurn(hadTools: boolean, hadText: boolean): AutoContinueState {
  if (_state.mode !== 'running') return getState();

  _state.lastTurnAt = Date.now();
  _state.lastTurnHadTools = hadTools;
  _state.lastTurnHadText = hadText;

  // Increment step on every turn
  _state.step++;

  if (!hadTools && !hadText) {
    // Empty turn
    _state.consecutiveEmptyTurns++;
    _state.consecutiveTextOnlyTurns = 0;
  } else if (!hadTools && hadText) {
    // Text-only turn
    _state.consecutiveTextOnlyTurns++;
    _state.consecutiveEmptyTurns = 0;
  } else {
    // Had tools — reset counters
    _state.consecutiveTextOnlyTurns = 0;
    _state.consecutiveEmptyTurns = 0;
  }

  return getState();
}

/**
 * Update task progress (called from todoManager / taskPlan sync).
 */
export function updateProgress(completed: number, total: number): AutoContinueState {
  _state.tasksCompleted = completed;
  _state.tasksTotal = total;
  return getState();
}

// ─── Core Decision: shouldFireNudge ───

/**
 * The ONLY function the renderer should call to decide whether to send a nudge.
 *
 * Returns { fire: false } with reason when:
 *   1. Machine is not running (idle, paused, done)
 *   2. Step limit reached
 *   3. Last turn was text-only (Bug H fix) — max N consecutive text-only turns
 *   4. Silent stall detected (Bug D fix) — no turn completed in stallThresholdMs
 *   5. Consecutive empty turns (Bug F fix) — 2+ empty turns = self-check
 */
export function shouldFireNudge(): ShouldFireResult {
  const base = { step: _state.step, maxSteps: _state.maxSteps };

  // 1. Not running
  if (_state.mode !== 'running') {
    return { fire: false, reason: `Not running (mode: ${_state.mode})`, mode: _state.mode, ...base };
  }

  // 2. Step limit
  if (_state.step >= _state.maxSteps) {
    _state.mode = 'done';
    _state.pauseReason = `Reached max steps (${_state.maxSteps})`;
    return { fire: false, reason: _state.pauseReason, mode: 'done', ...base };
  }

  // 3. Text-only turns (Bug H) — if last N turns had text but no tools, pause
  if (_state.consecutiveTextOnlyTurns >= _state.maxTextOnlyTurns) {
    _state.mode = 'paused-stall';
    _state.pauseReason = `${_state.consecutiveTextOnlyTurns} consecutive text-only turns (no tool calls). AI may be waiting for user input.`;
    return { fire: false, reason: _state.pauseReason, mode: 'paused-stall', ...base };
  }

  // 4. Silent stall (Bug D) — no turn completed within threshold
  if (_state.lastTurnAt !== null) {
    const elapsed = Date.now() - _state.lastTurnAt;
    if (elapsed > _state.stallThresholdMs) {
      _state.mode = 'paused-stall';
      _state.pauseReason = `Silent stall: no turn completed in ${Math.round(elapsed / 1000)}s (threshold: ${Math.round(_state.stallThresholdMs / 1000)}s)`;
      return { fire: false, reason: _state.pauseReason, mode: 'paused-stall', ...base };
    }
  }

  // 5. Empty turns (Bug F) — consecutive empty turns = self-check
  if (_state.consecutiveEmptyTurns >= 2) {
    _state.mode = 'paused-stall';
    _state.pauseReason = `${_state.consecutiveEmptyTurns} consecutive empty turns (no text, no tools). Possible loop or stall.`;
    return { fire: false, reason: _state.pauseReason, mode: 'paused-stall', ...base };
  }

  // All checks passed — fire the nudge
  return { fire: true, reason: 'OK', mode: 'running', ...base };
}

// ─── Serialization for IPC ───

export interface AutoContinueStateSnapshot {
  mode: AutoContinueMode;
  step: number;
  maxSteps: number;
  lastTurnHadTools: boolean;
  lastTurnHadText: boolean;
  consecutiveTextOnlyTurns: number;
  consecutiveEmptyTurns: number;
  pauseReason: string | null;
  tasksCompleted: number;
  tasksTotal: number;
  stallThresholdMs: number;
}

export function getSnapshot(): AutoContinueStateSnapshot {
  return {
    mode: _state.mode,
    step: _state.step,
    maxSteps: _state.maxSteps,
    lastTurnHadTools: _state.lastTurnHadTools,
    lastTurnHadText: _state.lastTurnHadText,
    consecutiveTextOnlyTurns: _state.consecutiveTextOnlyTurns,
    consecutiveEmptyTurns: _state.consecutiveEmptyTurns,
    pauseReason: _state.pauseReason,
    tasksCompleted: _state.tasksCompleted,
    tasksTotal: _state.tasksTotal,
    stallThresholdMs: _state.stallThresholdMs,
  };
}

/**
 * Reset state machine to idle (used on fresh chat, etc.)
 */
export function resetMachine(): AutoContinueState {
  _state = createInitialState();
  return getState();
}
