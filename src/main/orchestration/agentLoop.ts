/**
 * Canonical Agent Loop — Sprint 28 (Cline-style semantic tool-use loop)
 * Sprint 33: Added turn-start/turn-inspection/turn-end loop events,
 * hardened no-tools-used-nudge to not fire when toolUseCount > 0.
 *
 * Replaces the old regex-based autoContinue engine with a clean loop
 * driven entirely by Anthropic's stop_reason and the presence of
 * terminal tools (attempt_completion, ask_followup_question).
 *
 * Loop logic (mirrors Cline's recursivelyMakeClineRequests):
 *   1. Stream a turn from Claude.
 *   2. If stop_reason is 'end_turn' and no tools were used → inject noToolsUsed nudge.
 *   3. If stop_reason is 'tool_use' → execute tools, append results, continue.
 *   4. If a terminal tool was used → exit cleanly.
 *   5. Safety cap at maxTurns (default 25).
 *
 * References:
 *   - https://github.com/cline/cline/blob/main/src/core/task/index.ts
 *   - https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 */

import { BrowserWindow } from 'electron';
import { ILLMProvider, LLMResponse } from '../domain/interfaces';
import { ToolDefinition } from '../domain/entities';
import { streamChatToRenderer } from '../providers';
import { formatResponse } from './formatResponse';

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
  /** Rate-limit pre-flight check */
  rateLimitCheck?: () => { ok: boolean; reason?: string; delayMs: number };
}

export interface AgentLoopResult {
  content: string;
  toolCalls: any[];
  turns: number;
  reason: 'end_turn' | 'max_turns' | 'max_tokens' | 'stop_sequence' | 'error' | 'aborted' | 'no_tools' | 'attempt_completion' | 'ask_followup_question';
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

  while (turns < maxTurns) {
    // Check abort signal
    if (options.abortSignal?.aborted) {
      return { content: lastContent, toolCalls: totalToolCalls, turns, reason: 'aborted' };
    }

    // Rate-limit pre-flight check
    if (options.rateLimitCheck) {
      const check = options.rateLimitCheck();
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
