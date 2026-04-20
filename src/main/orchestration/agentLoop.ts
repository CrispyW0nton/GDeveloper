/**
 * Canonical Agent Loop — Sprint 28 (Cline-style semantic tool-use loop)
 * Sprint 33: Added turn-start/turn-inspection/turn-end loop events,
 * hardened no-tools-used-nudge to not fire when toolUseCount > 0.
 * Sprint 27.5.1: Silent todo-continuation nudge + stuck_after_todo safety
 * exit for premature end_turn after todo-only turns.
 * BUG-05 (Sprint 39): Doom-loop detection — when the model calls the same
 * tool with identical input 3+ times in a row we inject a redirection
 * nudge once; if it keeps going (5+ identical calls) we exit with
 * reason 'stuck_repeat'. Port of Cline PR #9931/9933 + OpenCode PR #12623
 * repeated-tool-call guards.
 *
 * Replaces the old regex-based autoContinue engine with a clean loop
 * driven entirely by Anthropic's stop_reason and the presence of
 * terminal tools (attempt_completion, ask_followup_question).
 *
 * Loop logic (mirrors Cline's recursivelyMakeClineRequests):
 *   1. Stream a turn from Claude.
 *   2. If stop_reason is 'end_turn' and no tools were used → inject noToolsUsed nudge.
 *   3. If stop_reason is 'tool_use' → execute tools, append results, continue.
 *   4. If the same tool+input fires 3× in a row → inject doom-loop nudge;
 *      5× in a row → exit with 'stuck_repeat'.
 *   5. If a terminal tool was used → exit cleanly.
 *   6. Safety cap at maxTurns (default 25).
 *
 * Sprint 27.5.1 addition: when the previous turn only called the todo tool
 * and the list still has incomplete items, a user-role ephemeral nudge is
 * injected to force continuation. A safety limit of 3 consecutive nudges
 * prevents infinite loops (exits with reason 'stuck_after_todo').
 *
 * References:
 *   - https://github.com/cline/cline/blob/main/src/core/task/index.ts
 *   - https://github.com/cline/cline/pull/9931
 *   - https://github.com/anomalyco/opencode/pull/12623
 *   - https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 *   - https://github.com/anthropics/claude-code/issues/10980
 */

import { createHash } from 'crypto';

import { BrowserWindow } from 'electron';
import { ILLMProvider, LLMResponse } from '../domain/interfaces';
import { ToolDefinition } from '../domain/entities';
import { streamChatToRenderer } from '../providers';
import { formatResponse } from './formatResponse';
import { isTodoComplete } from './todoManager';

// ─── Sprint 27.5.1: Todo continuation constants ───

/** Maximum consecutive todo-only end_turn nudges before giving up. */
const MAX_TODO_NUDGES = 3;

/** The nudge message injected when the model prematurely ends after a todo-only turn. */
export const TODO_NUDGE_MESSAGE =
  'Continue executing the in_progress task from your todo list. Do not end your turn until all tasks are completed.';

/** Returns true iff the given tool calls are non-empty and all are the `todo` tool. */
export function onlyTodoCalled(toolCalls: Array<{ name: string }>): boolean {
  return toolCalls.length > 0 && toolCalls.every(tc => tc.name === 'todo');
}

// ─── BUG-05: Doom-loop guard constants ───

/** Number of consecutive identical tool-call batches before we intervene. */
const DOOM_LOOP_NUDGE_AT = 3;
/** Number of consecutive identical tool-call batches before we hard-stop. */
const DOOM_LOOP_EXIT_AT = 5;

/**
 * User-role message injected when repeated identical tool calls are detected.
 * Intentionally directive — tells the model EXACTLY what's happening and
 * gives it two acceptable next actions (change approach, or call
 * attempt_completion to report progress).
 */
export const DOOM_LOOP_NUDGE_MESSAGE =
  'You are calling the same tool repeatedly with identical arguments. This indicates you are stuck in a loop. Please try a different approach — use a different tool, call the same tool with different arguments, or call attempt_completion to report whatever progress you have made so far.';

/**
 * Build a stable signature for a batch of tool calls.
 * Used to detect "identical batch repeated" patterns in the agent loop.
 * JSON.stringify on input is intentional: the Anthropic API emits consistent
 * key ordering for objects, so if the model produces the same object twice,
 * stringification will match byte-for-byte. Falling back to sha1 keeps the
 * in-memory history compact even if individual tool_use.input payloads are
 * large (patch_file / multi_edit can carry 10+ KB each).
 */
export function batchSignature(toolCalls: Array<{ name: string; input: any }>): string {
  const serialized = toolCalls
    .map(tc => `${tc.name}::${JSON.stringify(tc.input ?? {})}`)
    .join('||');
  return createHash('sha1').update(serialized).digest('hex');
}

// ─── Types ───

export interface AgentLoopOptions {
  provider: ILLMProvider;
  win: BrowserWindow | null;
  sessionId: string;
  systemPrompt: string;
  tools: any[];
  messages: Array<{ role: string; content: string }>;
  /** Maximum turns before safety exit (default: 25) */
  maxTurns?: number;
  /** Maximum consecutive no-tool-used nudges before giving up (default: 3) */
  maxConsecutiveMistakes?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Callback to execute a tool call — returns { content, isError } */
  executeTool: (toolCall: { id: string; name: string; input: any }) => Promise<{ content: string; isError: boolean }>;
  /** Callback for DB persistence */
  persistMessage?: (role: string, content: string, toolCalls?: any[]) => void;
  /** Sandbox event emitter */
  emitSandboxEvent?: (event: any) => void;
  /**
   * Rate-limit pre-flight check.
   *
   * MCP-429-02 (Slice 3) upgraded the callback signature to accept an
   * optional cost estimate for the request about to be sent. If the
   * caller passes `{ inputTokens }`, the rate limiter can project the
   * post-send state of the sliding window and either delay (to let
   * enough old tokens age out) or refuse outright when a tier hard
   * limit would be breached. Callbacks that don't use the estimate
   * see the original reactive behaviour.
   */
  rateLimitCheck?: (estimate?: { inputTokens?: number; outputTokens?: number }) => { ok: boolean; reason?: string; delayMs: number };
}

export interface AgentLoopResult {
  content: string;
  toolCalls: any[];
  turns: number;
  reason:
    | 'end_turn'
    | 'max_turns'
    | 'max_tokens'
    | 'stop_sequence'
    | 'error'
    | 'aborted'
    | 'no_tools'
    | 'attempt_completion'
    | 'ask_followup_question'
    /** Sprint 27.5.1: Gave up after MAX_TODO_NUDGES consecutive end_turn following a todo-only turn */
    | 'stuck_after_todo'
    /** BUG-05: Hard-stopped because the model kept calling the same tool with identical input */
    | 'stuck_repeat';
  completionResult?: string;
  followupQuestion?: string;
}

// Terminal tool names that cause loop exit
const TERMINAL_TOOLS = new Set(['attempt_completion', 'ask_followup_question']);

// ─── Main Loop ───

/**
 * initiateTaskLoop — the top-level entry point.
 * Wraps recursivelyMakeRequests with safety cap and error handling.
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxTurns = options.maxTurns ?? 25;
  const maxConsecutiveMistakes = options.maxConsecutiveMistakes ?? 3;
  const currentMessages = [...options.messages];
  let totalToolCalls: any[] = [];
  let turns = 0;
  let consecutiveNoToolUse = 0;
  let lastContent = '';

  // ─── Sprint 27.5.1: Todo continuation state ───
  let consecutiveTodoNudges = 0;
  let lastTurnOnlyTodo = false;

  // ─── BUG-05: Doom-loop tracking ───
  // A "batch" is all tool calls from one turn, hashed together with
  // batchSignature(). We count how many consecutive turns produced the
  // same signature. Nudge once at threshold, hard-stop past the limit.
  // `doomLoopNudgeFired` guarantees the nudge is injected at most once
  // per repeat-run — if the nudge itself doesn't change the model's
  // behaviour, the EXIT_AT ceiling trips next.
  let lastBatchSignature: string | null = null;
  let consecutiveIdenticalBatches = 0;
  let doomLoopNudgeFired = false;

  while (turns < maxTurns) {
    // Check abort signal
    if (options.abortSignal?.aborted) {
      return { content: lastContent, toolCalls: totalToolCalls, turns, reason: 'aborted' };
    }

    // Rate-limit pre-flight check
    // MCP-429-02: Compute a chars/4 estimate of THIS turn's input cost so
    // the rate limiter can project the post-send window and either delay
    // or refuse. If we don't pass an estimate the limiter falls back to
    // the old reactive check. Estimate includes: system prompt + the
    // full tool schema payload (JSON-stringified) + the running
    // currentMessages tail. chars/4 is a known underestimate for JSON-
    // heavy content (PERF-03 / MCP-429-03) but good enough for
    // "would this push us off the cliff" gating — an underestimate
    // errs on the side of sending rather than blocking, which is the
    // fail-safe direction: false negatives = one 429, false positives
    // = agent hangs forever.
    const estimateTurnInputTokens = (): number => {
      const systemChars = options.systemPrompt?.length || 0;
      const historyChars = currentMessages.reduce(
        (s, m) => s + (m.content?.length || 0),
        0,
      );
      // JSON.stringify on the full tool array — schemas dominate cost.
      let toolsChars = 0;
      try {
        toolsChars = JSON.stringify(options.tools || []).length;
      } catch { /* noop */ }
      return Math.ceil((systemChars + historyChars + toolsChars) / 4);
    };

    if (options.rateLimitCheck) {
      const check = options.rateLimitCheck({ inputTokens: estimateTurnInputTokens() });
      if (!check.ok) {
        if (options.win && !options.win.isDestroyed()) {
          options.win.webContents.send('chat:stream-chunk', {
            sessionId: options.sessionId,
            type: 'text',
            content: `\n**[Rate Limit]** ${check.reason}\n`,
            fullContent: check.reason || '',
          });
        }
        return { content: lastContent, toolCalls: totalToolCalls, turns, reason: 'error' };
      }
      if (check.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, check.delayMs));
      }
    }

    turns++;

    // Sprint 33: Emit turn-start event for loop diagnostics
    if (options.win && !options.win.isDestroyed()) {
      options.win.webContents.send('agent:loop-event', {
        event: 'turn-start',
        turn: turns,
        maxTurns,
        messageCount: currentMessages.length,
        toolCount: options.tools.length,
      });
    }

    // ─── Stream a turn ───
    let result: { content: string; toolCalls?: any[]; stopReason: string };
    try {
      result = await streamChatToRenderer(
        options.win,
        options.provider,
        currentMessages,
        options.sessionId,
        options.systemPrompt,
        options.tools.length > 0 ? options.tools : undefined,
      );
    } catch (err) {
      const errMsg = `Error: ${err instanceof Error ? err.message : String(err)}`;
      return { content: errMsg, toolCalls: totalToolCalls, turns, reason: 'error' };
    }

    lastContent = result.content;
    const stopReason = result.stopReason;
    const toolCalls = result.toolCalls || [];

    // Sprint 33: Emit turn-inspection event with detailed content analysis
    if (options.win && !options.win.isDestroyed()) {
      options.win.webContents.send('agent:loop-event', {
        event: 'turn-inspection',
        turn: turns,
        stopReason,
        toolUseCount: toolCalls.length,
        toolNames: toolCalls.map((tc: any) => tc.name),
        textLen: result.content?.length || 0,
        hasContent: !!result.content,
      });
    }

    // ─── Case 1: No tool calls ───
    // Sprint 33: Only fire nudge when toolCalls is truly empty.
    // If stopReason is 'tool_use' but toolCalls is empty (shouldn't happen),
    // still treat as no-tool-use for safety.
    if (toolCalls.length === 0) {
      // Non-tool_use stop reasons → exit immediately
      if (stopReason === 'max_tokens') {
        return { content: lastContent, toolCalls: totalToolCalls, turns, reason: 'max_tokens' };
      }
      if (stopReason === 'stop_sequence') {
        return { content: lastContent, toolCalls: totalToolCalls, turns, reason: 'stop_sequence' };
      }

      // ─── Sprint 27.5.1: Silent todo-continuation check ───
      // If the previous turn only called the `todo` tool and the todo list
      // still has incomplete items, the model has prematurely ended its turn.
      // Inject a user-role ephemeral nudge and continue the loop.
      if (
        stopReason === 'end_turn' &&
        lastTurnOnlyTodo &&
        !isTodoComplete(options.sessionId)
      ) {
        consecutiveTodoNudges++;

        if (options.win && !options.win.isDestroyed()) {
          options.win.webContents.send('agent:loop-event', {
            event: 'todo-continuation-nudge',
            turn: turns,
            consecutiveNudges: consecutiveTodoNudges,
            maxNudges: MAX_TODO_NUDGES,
            ephemeral: true,
          });
        }

        if (consecutiveTodoNudges >= MAX_TODO_NUDGES) {
          // Safety: model is stuck in a todo → end_turn loop
          if (options.win && !options.win.isDestroyed()) {
            options.win.webContents.send('agent:loop-event', {
              event: 'stuck-after-todo',
              turn: turns,
              consecutiveNudges: consecutiveTodoNudges,
            });
          }
          options.persistMessage?.('assistant', result.content || '(stuck after todo)');
          return {
            content: lastContent,
            toolCalls: totalToolCalls,
            turns,
            reason: 'stuck_after_todo',
          };
        }

        // Sprint 35/36 pattern: persist the assistant response normally,
        // but the nudge itself is EPHEMERAL — lives only in currentMessages,
        // never persisted to DB or conversation history.
        options.persistMessage?.('assistant', result.content);
        currentMessages.push({ role: 'assistant', content: result.content });
        currentMessages.push({ role: 'user', content: TODO_NUDGE_MESSAGE });

        // Reset so we don't double-count if the very next turn also end_turns
        lastTurnOnlyTodo = false;
        continue;
      }

      // end_turn with no tools → inject noToolsUsed nudge (Cline pattern)
      consecutiveNoToolUse++;

      // Sprint 33: Log the no-tool situation for diagnostics
      console.warn(`[agentLoop] Turn ${turns}: no tool calls, stopReason=${stopReason}, consecutiveNoToolUse=${consecutiveNoToolUse}`);

      // Sprint 29: Emit nudge event so renderer can show instrumentation banner
      if (options.win && !options.win.isDestroyed()) {
        options.win.webContents.send('agent:loop-event', {
          event: 'no-tools-used-nudge',
          turn: turns,
          consecutiveMistakes: consecutiveNoToolUse,
          maxConsecutiveMistakes,
          stopReason,
        });
      }

      if (consecutiveNoToolUse >= maxConsecutiveMistakes) {
        // Sprint 29: Emit max-mistakes event
        if (options.win && !options.win.isDestroyed()) {
          options.win.webContents.send('agent:loop-event', {
            event: 'max-mistakes-reached',
            turn: turns,
            consecutiveMistakes: consecutiveNoToolUse,
          });
        }
        return { content: lastContent, toolCalls: totalToolCalls, turns, reason: 'no_tools' };
      }

      // Sprint 35 Fix 2 + Sprint 36 Fix 3: Nudge is EPHEMERAL — only lives
      // in currentMessages, never persisted to DB or conversationHistory.
      // Persisting it caused the "[ERROR] You did not use a tool…" string to
      // accumulate in history, bloating the 320k payload and confusing the
      // model on subsequent turns.
      // Sprint 36: Use an explicit ephemeralNudge variable to make the
      // transient intent unambiguous. The nudge is appended only to the
      // next API call array and immediately discarded.
      options.persistMessage?.('assistant', result.content);
      const ephemeralNudge = formatResponse.noToolsUsed();
      currentMessages.push({ role: 'assistant', content: result.content });
      currentMessages.push({ role: 'user', content: ephemeralNudge });
      // NOTE: ephemeralNudge is NOT persisted — options.persistMessage is
      // intentionally not called for the nudge. It only exists in currentMessages.

      // Sprint 36: Emit nudge event with ephemeral: true for DevConsole logging
      if (options.win && !options.win.isDestroyed()) {
        options.win.webContents.send('agent:loop-event', {
          event: 'no-tools-used-nudge',
          turn: turns,
          ephemeral: true,
          consecutiveMistakes: consecutiveNoToolUse,
          maxConsecutiveMistakes,
        });
      }
      continue;
    }

    // Reset no-tool counter on successful tool use
    consecutiveNoToolUse = 0;

    // ─── Case 2: Tool calls present ───
    totalToolCalls.push(...toolCalls);

    // Build assistant message with content + tool_use blocks
    const assistantContent: any[] = [];
    if (result.content) {
      assistantContent.push({ type: 'text', text: result.content });
    }
    for (const tc of toolCalls) {
      assistantContent.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input || {},
      });
    }
    currentMessages.push({ role: 'assistant', content: JSON.stringify(assistantContent) });

    // Execute each tool and collect results
    const toolResults: Array<{ toolCallId: string; toolName: string; content: string; isError: boolean }> = [];
    let terminalToolUsed: string | null = null;
    let completionResult: string | undefined;
    let followupQuestion: string | undefined;

    for (const tc of toolCalls) {
      // Check for terminal tools BEFORE execution
      if (TERMINAL_TOOLS.has(tc.name)) {
        terminalToolUsed = tc.name;
      }

      const toolResult = await options.executeTool(tc);
      toolResults.push({
        toolCallId: tc.id,
        toolName: tc.name,
        content: toolResult.content,
        isError: toolResult.isError,
      });

      // Capture terminal tool output
      if (tc.name === 'attempt_completion') {
        try {
          const parsed = JSON.parse(toolResult.content);
          completionResult = parsed.result || toolResult.content;
        } catch {
          completionResult = toolResult.content;
        }
      } else if (tc.name === 'ask_followup_question') {
        try {
          const parsed = JSON.parse(toolResult.content);
          followupQuestion = parsed.question || toolResult.content;
        } catch {
          followupQuestion = toolResult.content;
        }
      }
    }

    // Build tool results as user message (Anthropic tool_result format)
    // Sprint 29: Do not truncate structured results (task_plan, compare_*) —
    // truncation caused "No plan data" rendering bugs.
    const STRUCTURED_TOOLS = new Set(['task_plan', 'compare_file', 'compare_folder', 'merge_3way', 'attempt_completion', 'ask_followup_question']);
    const toolResultMessage = toolResults.map(tr => {
      const maxLen = STRUCTURED_TOOLS.has(tr.toolName) ? 16000 : 4000;
      return `[Tool Result: ${tr.toolName}]\n${tr.content.substring(0, maxLen)}`;
    }).join('\n\n');

    // Persist assistant + tool results
    options.persistMessage?.('assistant', result.content || '(tool execution)', toolCalls);
    options.persistMessage?.('user', toolResultMessage);

    currentMessages.push({ role: 'user', content: toolResultMessage });

    // ─── Sprint 27.5.1: Track whether this turn was todo-only ───
    // The flag is checked next iteration when stopReason === 'end_turn'.
    // Reset nudge counter on any non-todo-only turn so legitimate work
    // between todo calls doesn't trip the stuck_after_todo safety.
    const wasOnlyTodo = onlyTodoCalled(toolCalls);
    if (wasOnlyTodo && !isTodoComplete(options.sessionId)) {
      lastTurnOnlyTodo = true;
    } else {
      lastTurnOnlyTodo = false;
      consecutiveTodoNudges = 0;
    }

    // ─── Case 3: Terminal tool used → exit ───
    // Sprint 29: Emit terminal tool event
    if (terminalToolUsed && options.win && !options.win.isDestroyed()) {
      options.win.webContents.send('agent:loop-event', {
        event: 'terminal-tool-used',
        tool: terminalToolUsed,
        turn: turns,
      });
    }
    if (terminalToolUsed === 'attempt_completion') {
      return {
        content: completionResult || lastContent,
        toolCalls: totalToolCalls,
        turns,
        reason: 'attempt_completion',
        completionResult,
      };
    }
    if (terminalToolUsed === 'ask_followup_question') {
      return {
        content: followupQuestion || lastContent,
        toolCalls: totalToolCalls,
        turns,
        reason: 'ask_followup_question',
        followupQuestion,
      };
    }

    // ─── BUG-05: Doom-loop detection ───
    // Classify this turn's tool batch. If the signature matches the previous
    // turn's, we're watching the model invoke the exact same tools with the
    // exact same inputs again — it's stuck. Nudge once at the threshold;
    // hard-stop at the ceiling to bound wasted tokens.
    const thisBatchSig = batchSignature(toolCalls);
    if (thisBatchSig === lastBatchSignature) {
      consecutiveIdenticalBatches++;
    } else {
      consecutiveIdenticalBatches = 1;
      lastBatchSignature = thisBatchSig;
      doomLoopNudgeFired = false;
    }

    if (consecutiveIdenticalBatches >= DOOM_LOOP_EXIT_AT) {
      if (options.win && !options.win.isDestroyed()) {
        options.win.webContents.send('agent:loop-event', {
          event: 'doom-loop-hard-stop',
          turn: turns,
          consecutiveIdentical: consecutiveIdenticalBatches,
          threshold: DOOM_LOOP_EXIT_AT,
          toolNames: toolCalls.map((tc: any) => tc.name),
        });
      }
      return {
        content: lastContent,
        toolCalls: totalToolCalls,
        turns,
        reason: 'stuck_repeat',
      };
    }

    if (consecutiveIdenticalBatches >= DOOM_LOOP_NUDGE_AT && !doomLoopNudgeFired) {
      // Nudge is EPHEMERAL — it goes to currentMessages so the NEXT API turn
      // sees it, but is NOT persisted via options.persistMessage (same
      // pattern as the no-tools-used nudge — preserving DB/history hygiene
      // from Sprint 35/36 Fix 2+3).
      currentMessages.push({ role: 'user', content: DOOM_LOOP_NUDGE_MESSAGE });
      doomLoopNudgeFired = true;
      if (options.win && !options.win.isDestroyed()) {
        options.win.webContents.send('agent:loop-event', {
          event: 'doom-loop-detected',
          turn: turns,
          consecutiveIdentical: consecutiveIdenticalBatches,
          threshold: DOOM_LOOP_NUDGE_AT,
          toolNames: toolCalls.map((tc: any) => tc.name),
          ephemeral: true,
        });
      }
    }

    // ─── Case 4: stop_reason is not tool_use → something unexpected ───
    if (stopReason !== 'tool_use') {
      // The API returned tool calls but didn't set stop_reason to tool_use.
      // This shouldn't happen, but handle gracefully by continuing.
      console.warn(`[agentLoop] Turn ${turns}: tools present (${toolCalls.length}) but stopReason=${stopReason}`);
    }

    // Sprint 33: Emit turn-end event with tool execution summary
    if (options.win && !options.win.isDestroyed()) {
      options.win.webContents.send('agent:loop-event', {
        event: 'turn-end',
        turn: turns,
        stopReason,
        toolUseCount: toolCalls.length,
        toolNames: toolCalls.map((tc: any) => tc.name),
        terminalToolUsed: terminalToolUsed || null,
      });
    }

    // Continue to next turn
  }

  // Safety cap reached
  return { content: lastContent, toolCalls: totalToolCalls, turns, reason: 'max_turns' };
}
