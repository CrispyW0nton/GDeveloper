/**
 * agentLoop.ts — Sprint 27.3 (Canonical Agent Loop)
 *
 * Based on easy-agent step4.js and the Anthropic tool_use docs.
 * Uses stop_reason as the ONLY termination signal:
 *   - 'end_turn'     → assistant is done, exit loop
 *   - 'tool_use'     → execute tools, feed results back, continue
 *   - 'max_tokens'   → output was truncated, notify user, exit
 *   - 'stop_sequence' → custom stop sequence hit, exit
 *
 * NO timer-based auto-continue, NO nudge system, NO scheduleNextTurn.
 * The loop runs until the model says stop or a safety net fires.
 *
 * References:
 *   - https://github.com/anthropics/anthropic-cookbook/blob/main/misc/prompt_caching/easy-agent/step4.js
 *   - https://docs.anthropic.com/en/docs/build-with-claude/tool-use#the-tool-use-loop
 *   - Anthropic Messages API stop_reason docs
 */

import type { BrowserWindow } from 'electron';
import { streamChatToRenderer } from '../providers';
import type { ILLMProvider } from '../domain/interfaces';
import type { ToolDefinition } from '../domain/entities';
import {
  executeToolWithTimeout, executeMcpToolWithTimeout,
  type ToolExecResult,
} from '../tools/toolExecutor';
import {
  LOCAL_TOOL_DEFINITIONS, getActiveWorkspace, setToolSessionId, setActiveWorkspace,
} from '../tools';
import { setTaskPlanSessionId } from '../tools/taskPlan';
import { setTaskToolSessionId } from '../tools/taskTool';
import {
  getTodoProgress, isTodoComplete, getActiveTask,
  advanceToNextPending, blockActive,
} from '../orchestration/todoManager';
import { getTimeoutForTool } from '../tools/toolTimeout';
import { getDatabase } from '../db';
import { getRateLimiter } from '../providers/rateLimiter';
import { getSessionUsage, resetSessionUsage } from '../providers';
import {
  createCheckpoint,
} from '../orchestration/checkpoint';
import {
  WRITE_TOOL_NAMES, getExecutionMode,
} from '../commands';
import { join } from 'path';

// ─── Types ───

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown';

export interface AgentLoopOptions {
  mainWindow: BrowserWindow | null;
  provider: ILLMProvider;
  messages: Array<{ role: string; content: string }>;
  sessionId: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  mcpTools?: ToolDefinition[];
  mcpExecute?: (serverId: string, name: string, input: Record<string, unknown>) => Promise<any>;
  mcpToolMeta?: Array<{ name: string; serverId: string }>;
  maxTurns?: number;
  wsPath?: string;
  taskId?: string;
  mode?: string;
  /** Write-scope check function */
  isWriteAllowed?: (toolName: string, input: any, wsPath: string, isWrite: boolean, mode: string) => { allowed: boolean; reason?: string };
  /** Write-scope getter */
  getWriteScope?: () => { active: boolean };
  /** Sandbox event emitter */
  emitSandboxEvent?: (ev: any) => void;
  /** TPM throttle check */
  shouldThrottle?: () => { shouldWait: boolean; waitMs: number; reason: string };
}

export interface AgentLoopResult {
  content: string;
  toolCalls: any[];
  loopCount: number;
  stopReason: StopReason;
  msgId?: number | string;
}

// ─── Canonical Loop ───

const DEFAULT_MAX_TURNS = 25;
const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Run the canonical agent loop.
 * Keeps calling the LLM and executing tools until:
 *   1. stop_reason !== 'tool_use' (model is done)
 *   2. maxTurns safety net
 *   3. Consecutive error circuit-breaker
 *   4. Rate limit hard-pause
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    mainWindow, provider, sessionId, systemPrompt,
    tools, mcpTools = [], mcpToolMeta = [],
    mcpExecute,
    maxTurns = DEFAULT_MAX_TURNS,
    wsPath = '', taskId, mode = 'build',
    isWriteAllowed, getWriteScope, emitSandboxEvent,
    shouldThrottle,
  } = opts;

  const db = getDatabase();
  let currentMessages = [...opts.messages];
  let loopCount = 0;
  let fullContent = '';
  let allToolCalls: any[] = [];
  let consecutiveErrors = 0;
  let lastStopReason: StopReason = 'unknown';

  // Bind session IDs
  setTaskPlanSessionId(sessionId);
  setTaskToolSessionId(sessionId);
  setToolSessionId(sessionId);

  while (loopCount < maxTurns) {
    loopCount++;

    // ── Checkpoint every 5 loops ──
    if (loopCount > 1 && loopCount % 5 === 0) {
      const todoProgress = getTodoProgress(sessionId);
      createCheckpoint(sessionId, `loop-${loopCount}`, {
        todoProgress: { done: todoProgress.done, total: todoProgress.total },
        toolCallCount: allToolCalls.length,
        loopIteration: loopCount,
      });
    }

    // ── Consecutive error circuit-breaker ──
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      sendChunk(mainWindow, sessionId, {
        type: 'text',
        content: `\n**[Agent Loop]** Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive errors.\n`,
        fullContent: '',
      });
      break;
    }

    // ── TPM throttle ──
    if (shouldThrottle) {
      const tpmCheck = shouldThrottle();
      if (tpmCheck.shouldWait) {
        sendChunk(mainWindow, sessionId, {
          type: 'text',
          content: `\n*[TPM] ${tpmCheck.reason}*\n`,
          fullContent: '',
        });
        await sleep(tpmCheck.waitMs);
      }
    }

    // ── Rate-limit pre-flight ──
    const preCheck = getRateLimiter().preFlightCheck();
    if (!preCheck.ok) {
      sendChunk(mainWindow, sessionId, {
        type: 'text',
        content: `\n**[Rate Limit]** ${preCheck.reason}\n`,
        fullContent: preCheck.reason || '',
      });
      break;
    }
    if (preCheck.delayMs > 0) {
      sendChunk(mainWindow, sessionId, {
        type: 'text',
        content: `\n*Waiting ${Math.round(preCheck.delayMs / 1000)}s for rate-limit window...*\n`,
        fullContent: '',
      });
      await sleep(preCheck.delayMs);
    }

    // ── Stream LLM response ──
    const result = await streamChatToRenderer(
      mainWindow,
      provider,
      currentMessages,
      sessionId,
      systemPrompt,
      tools.length > 0 ? tools : undefined,
    );

    fullContent = result.content;
    lastStopReason = (result.stopReason as StopReason) || 'end_turn';

    // ── stop_reason check (the canonical decision) ──
    if (lastStopReason !== 'tool_use' || !result.toolCalls || result.toolCalls.length === 0) {
      // Model is done — send final text and exit
      const hasRealContent = !!(result.content && result.content.trim().length > 0);

      if (lastStopReason === 'max_tokens') {
        sendChunk(mainWindow, sessionId, {
          type: 'text',
          content: '\n**[Agent Loop]** Response was truncated (max_tokens). Consider increasing token budget.\n',
          fullContent: '',
        });
      }

      // Empty/whitespace turn = failure, stop looping
      if (!hasRealContent && lastStopReason === 'end_turn') {
        console.warn(`[AgentLoop] Empty end_turn at loop ${loopCount} — exiting to prevent infinite loop`);
      }

      // Send final text to ensure renderer displays it
      if (hasRealContent && mainWindow && !mainWindow.isDestroyed()) {
        sendChunk(mainWindow, sessionId, {
          type: 'text',
          content: result.content,
          fullContent: result.content,
          isFinal: true,
        });
      }

      break;
    }

    // ── Process tool calls ──
    allToolCalls.push(...result.toolCalls);

    // Build assistant message with tool_use blocks
    const assistantContent: any[] = [];
    if (result.content) {
      assistantContent.push({ type: 'text', text: result.content });
    }
    for (const tc of result.toolCalls) {
      assistantContent.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input || {},
      });
    }
    currentMessages.push({ role: 'assistant', content: JSON.stringify(assistantContent) });

    // Execute tools
    const toolResults: ToolExecResult[] = [];

    for (const tc of result.toolCalls) {
      // Log activity
      db.logActivity(sessionId, 'tool_call', `Tool call: ${tc.name}`,
        JSON.stringify(tc.input).substring(0, 200),
        { toolName: tc.name, toolCallId: tc.id, sessionId, loop: loopCount });

      // Write-scope enforcement
      const isWriteToolCall = WRITE_TOOL_NAMES.includes(tc.name);
      if (isWriteAllowed) {
        const writeCheck = isWriteAllowed(tc.name, tc.input || {}, wsPath, isWriteToolCall, mode);
        if (!writeCheck.allowed) {
          const blockedResult: ToolExecResult = {
            toolCallId: tc.id,
            toolName: tc.name,
            content: `Error: ${writeCheck.reason || 'Write operation blocked'}`,
            isError: true,
            timedOut: false,
            elapsedMs: 0,
          };
          toolResults.push(blockedResult);
          if (emitSandboxEvent) {
            emitSandboxEvent({
              type: 'error',
              tool: tc.name,
              summary: `Blocked ${tc.name} (${mode} mode${getWriteScope?.().active ? ' + write-scope' : ''})`,
              status: 'error',
            });
          }
          sendChunk(mainWindow, sessionId, {
            type: 'tool_error',
            toolName: tc.name,
            result: blockedResult.content,
          });
          continue;
        }
      }

      // Emit tool start event
      const isCommandTool = ['run_command', 'bash_command'].includes(tc.name);
      if (emitSandboxEvent) {
        emitSandboxEvent({
          type: isCommandTool ? 'command' : 'tool_call',
          tool: tc.name,
          summary: isCommandTool ? `$ ${(tc.input?.command || '').toString().substring(0, 100)}` : `Calling ${tc.name}`,
          detail: JSON.stringify(tc.input || {}).substring(0, 500),
          cwd: getActiveWorkspace() || undefined,
          status: 'running',
        });
      }

      // Execute
      const isLocalTool = LOCAL_TOOL_DEFINITIONS.some(t => t.name === tc.name);
      let execResult: ToolExecResult;

      if (isLocalTool) {
        execResult = await executeToolWithTimeout(tc.name, tc.id, tc.input || {});
      } else {
        // MCP tool
        const toolMeta = mcpToolMeta.find(t => t.name === tc.name);
        if (toolMeta && mcpExecute) {
          execResult = await executeMcpToolWithTimeout(
            tc.name, tc.id, tc.input || {},
            (name, input) => mcpExecute(toolMeta.serverId, name, input),
          );
        } else {
          execResult = {
            toolCallId: tc.id,
            toolName: tc.name,
            content: `Error: Unknown tool "${tc.name}"`,
            isError: true,
            timedOut: false,
            elapsedMs: 0,
          };
        }
      }

      toolResults.push(execResult);

      // Post-execution events
      if (emitSandboxEvent) {
        const isFileEdit = ['write_file', 'patch_file', 'multi_edit'].includes(tc.name);
        emitSandboxEvent({
          type: execResult.isError ? 'tool_result' : (isFileEdit ? 'file_edit' : 'tool_result'),
          tool: tc.name,
          summary: execResult.isError ? `${tc.name} failed` : `${tc.name} completed`,
          detail: execResult.content.substring(0, 300),
          cwd: getActiveWorkspace() || undefined,
          status: execResult.isError ? 'error' : 'success',
        });
      }

      // File change notification
      if (['write_file', 'patch_file', 'multi_edit'].includes(tc.name) && !execResult.isError) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const filePath = (tc.input?.path || tc.input?.file_path || '') as string;
          const absolutePath = filePath.startsWith('/') ? filePath : join(wsPath, filePath);
          mainWindow.webContents.send('filetree:file-changed', {
            filePath, absolutePath, toolName: tc.name, timestamp: Date.now(),
          });
        }
      }

      // Timeout → block active task
      if (execResult.timedOut) {
        blockActive(sessionId, `Tool ${tc.name} timed out after ${Math.round(execResult.elapsedMs / 1000)}s`);
      }

      // Log result
      db.logActivity(sessionId, execResult.isError ? 'tool_error' : 'tool_result',
        `Tool ${execResult.isError ? 'error' : 'result'}: ${tc.name}`,
        execResult.content.substring(0, 200),
        { toolName: tc.name, toolCallId: tc.id, success: !execResult.isError, loop: loopCount });

      // Send tool result to renderer
      sendChunk(mainWindow, sessionId, {
        type: execResult.isError ? 'tool_error' : 'tool_result',
        toolCallId: tc.id,
        toolName: tc.name,
        toolInput: tc.input,
        result: execResult.content.substring(0, 2000),
        timedOut: execResult.timedOut,
        elapsedMs: execResult.elapsedMs,
      });
    }

    // ── Task lifecycle ──
    for (const tc of result.toolCalls) {
      if (tc.name === 'task_plan' || tc.name === 'todo_write') {
        try {
          const input = tc.input || {};
          if (input.action === 'create' || input.todos) {
            advanceToNextPending(sessionId);
          } else if (input.action === 'update' && input.new_status === 'done') {
            advanceToNextPending(sessionId);
          } else if (input.action === 'update' && input.new_status === 'in_progress' && input.task_id) {
            // Handled by task tool
          }
        } catch { /* lifecycle sync is best-effort */ }
      }
    }

    // Auto-advance if no active task
    if (!getActiveTask(sessionId) && !isTodoComplete(sessionId)) {
      advanceToNextPending(sessionId);
    }

    // ── Track consecutive errors ──
    const errorCount = toolResults.filter(tr => tr.isError).length;
    if (errorCount > 0 && errorCount === toolResults.length) {
      consecutiveErrors++;
    } else {
      consecutiveErrors = 0;
    }

    // ── Build tool result user message ──
    const todoProgressInfo = getTodoProgress(sessionId);
    let taskProgressNote = '';
    if (todoProgressInfo.total > 0) {
      taskProgressNote = `\n[Task Progress: ${todoProgressInfo.done}/${todoProgressInfo.total} complete]`;
      const active = getActiveTask(sessionId);
      if (active) {
        taskProgressNote += ` Active task: "${active.content}"`;
      }
      if (isTodoComplete(sessionId)) {
        taskProgressNote += ' ALL TASKS COMPLETE — provide final summary.';
      }
    }

    const toolResultMessage = toolResults.map(tr =>
      `[Tool Result: ${tr.toolName}]\n${tr.content.substring(0, 4000)}`
    ).join('\n\n') + taskProgressNote;

    currentMessages.push({ role: 'user', content: toolResultMessage });

    // Persist messages
    db.insertMessage(sessionId, 'assistant', result.content || '(tool execution)', result.toolCalls);
    db.insertMessage(sessionId, 'user', toolResultMessage);
  }

  // ── Post-loop: usage update ──
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendChunk(mainWindow, sessionId, {
      type: 'usage-update',
      sessionUsage: getSessionUsage(),
      rateLimitSnapshot: getRateLimiter().getSnapshot(),
    });
  }

  // Save final response
  const msgId = db.insertMessage(sessionId, 'assistant', fullContent, allToolCalls.length > 0 ? allToolCalls : undefined);

  if (taskId) {
    db.updateTaskStatus(taskId, 'EXECUTING', 'AI response received');
  }

  db.logActivity(sessionId, 'chat_response',
    `AI responded (${fullContent.length} chars, ${loopCount} loops, ${allToolCalls.length} tool calls)`,
    fullContent.substring(0, 150),
    { sessionId, provider: provider.name, contentLength: fullContent.length, toolCalls: allToolCalls.length, loops: loopCount });

  return {
    content: fullContent,
    toolCalls: allToolCalls,
    loopCount,
    stopReason: lastStopReason,
    msgId,
  };
}

// ─── Helpers ───

function sendChunk(win: BrowserWindow | null, sessionId: string, data: Record<string, any>): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('chat:stream-chunk', { sessionId, ...data });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
