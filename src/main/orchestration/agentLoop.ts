/**
 * Canonical Agent Loop — Sprint 27.5
 *
 * Mirrors easy-agent/step4.js exactly:
 *   while (stop_reason === "tool_use") { execute tools; send results; }
 *
 * Termination is governed SOLELY by Anthropic's stop_reason.
 * NO timers, NO step counters. Pure stop_reason-driven loop.
 *
 * Reference: https://github.com/ConardLi/easy-agent/blob/main/step/step4.js
 * Reference: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 */

import { BrowserWindow } from 'electron';
import { ToolDefinition } from '../domain/entities';
import { executeToolCall, type ToolCallResult } from '../tools/toolExecutor';

// ─── Types ───

export interface AgentLoopOptions {
  /** Maximum turns before forced exit (safety net) */
  maxTurns?: number;
  /** Electron BrowserWindow for streaming to renderer */
  win: BrowserWindow | null;
  /** Session ID for DB persistence */
  sessionId: string;
  /** System prompt */
  systemPrompt: string;
  /** Combined tool definitions (local + MCP) */
  tools: ToolDefinition[];
  /** MCP tool metadata for routing */
  mcpToolMeta?: Array<{ name: string; serverId: string }>;
  /** MCP tool executor */
  mcpExecute?: (serverId: string, toolName: string, input: Record<string, unknown>) => Promise<any>;
  /** Current workspace path */
  wsPath?: string;
  /** Execution mode */
  mode?: 'build' | 'plan';
  /** Tool execution callback (for local tools) */
  executeLocal: (name: string, input: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }> }>;
  /** Database helpers */
  db: {
    insertMessage: (sessionId: string, role: string, content: string, toolCalls?: any[]) => string;
    logActivity: (sessionId: string, type: string, summary: string, detail?: string, meta?: any, level?: string) => void;
  };
  /** Sandbox event emitter */
  emitSandboxEvent?: (event: any) => void;
  /** Write-tool names (blocked in plan mode) */
  writeToolNames?: string[];
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  /** Final text content from the last assistant turn */
  content: string;
  /** All tool calls made across all turns */
  toolCalls: any[];
  /** Number of turns executed */
  turns: number;
  /** Why the loop exited */
  reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'max_turns' | 'error' | 'aborted' | 'no_tools';
}

// ─── Stream + collect response ───

interface StreamResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
}

async function streamTurn(
  win: BrowserWindow | null,
  provider: any,
  messages: Array<{ role: string; content: string | any }>,
  sessionId: string,
  systemPrompt: string,
  tools?: ToolDefinition[],
): Promise<StreamResult> {
  let fullContent = '';
  const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  let stopReason = 'end_turn';

  for await (const chunk of provider.streamMessage(messages, tools, systemPrompt)) {
    if (chunk.type === 'text' && chunk.content) {
      fullContent += chunk.content;
      win?.webContents.send('chat:stream-chunk', {
        sessionId,
        type: 'text',
        content: chunk.content,
        fullContent,
      });
    } else if (chunk.type === 'tool_call' && chunk.toolCall) {
      toolCalls.push(chunk.toolCall);
      win?.webContents.send('chat:stream-chunk', {
        sessionId,
        type: 'tool_call',
        toolCall: chunk.toolCall,
      });
    } else if (chunk.type === 'done') {
      stopReason = chunk.stopReason || 'end_turn';
      win?.webContents.send('chat:stream-chunk', {
        sessionId,
        type: 'done',
        fullContent,
        stopReason,
      });
    }
  }

  return { content: fullContent, toolCalls, stopReason };
}

// ─── Canonical Agent Loop ───

export async function runAgentLoop(
  provider: any,
  messages: Array<{ role: string; content: string | any }>,
  opts: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const maxTurns = opts.maxTurns ?? 25;
  const currentMessages = [...messages];
  let allToolCalls: any[] = [];
  let lastContent = '';

  for (let turn = 0; turn < maxTurns; turn++) {
    // Check abort signal
    if (opts.signal?.aborted) {
      return { content: lastContent, toolCalls: allToolCalls, turns: turn, reason: 'aborted' };
    }

    // Stream one turn to the model
    const result = await streamTurn(
      opts.win,
      provider,
      currentMessages,
      opts.sessionId,
      opts.systemPrompt,
      opts.tools.length > 0 ? opts.tools : undefined,
    );

    lastContent = result.content;

    // ─── stop_reason check (THE termination signal) ───
    // Per Anthropic docs: only continue if stop_reason === "tool_use"

    if (result.stopReason === 'end_turn') {
      // Model is done. Exit immediately.
      return { content: lastContent, toolCalls: allToolCalls, turns: turn + 1, reason: 'end_turn' };
    }

    if (result.stopReason === 'max_tokens') {
      return { content: lastContent, toolCalls: allToolCalls, turns: turn + 1, reason: 'max_tokens' };
    }

    if (result.stopReason === 'stop_sequence') {
      return { content: lastContent, toolCalls: allToolCalls, turns: turn + 1, reason: 'stop_sequence' };
    }

    if (result.stopReason !== 'tool_use') {
      // Unknown stop_reason — treat as end
      return { content: lastContent, toolCalls: allToolCalls, turns: turn + 1, reason: 'end_turn' };
    }

    // ─── stop_reason === "tool_use" → execute tools ───

    if (result.toolCalls.length === 0) {
      // stop_reason says tool_use but no tool calls — treat as end
      return { content: lastContent, toolCalls: allToolCalls, turns: turn + 1, reason: 'no_tools' };
    }

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

    // Execute each tool call
    const toolResults: ToolCallResult[] = [];
    for (const tc of result.toolCalls) {
      // Check abort between tool calls
      if (opts.signal?.aborted) {
        return { content: lastContent, toolCalls: allToolCalls, turns: turn + 1, reason: 'aborted' };
      }

      const tcResult = await executeToolCall(tc, {
        executeLocal: opts.executeLocal,
        mcpToolMeta: opts.mcpToolMeta,
        mcpExecute: opts.mcpExecute,
        mode: opts.mode,
        writeToolNames: opts.writeToolNames,
        wsPath: opts.wsPath,
        emitSandboxEvent: opts.emitSandboxEvent,
        win: opts.win,
        sessionId: opts.sessionId,
        db: opts.db,
        turn,
      });

      toolResults.push(tcResult);

      // Send tool result to renderer
      opts.win?.webContents.send('chat:stream-chunk', {
        sessionId: opts.sessionId,
        type: tcResult.isError ? 'tool_error' : 'tool_result',
        toolCallId: tc.id,
        toolName: tc.name,
        result: tcResult.content.substring(0, 2000),
        timedOut: tcResult.timedOut,
      });
    }

    // Build tool results user message
    const toolResultMessage = toolResults.map(tr =>
      `[Tool Result: ${tr.toolName}]\n${tr.content.substring(0, 4000)}`
    ).join('\n\n');

    currentMessages.push({ role: 'user', content: toolResultMessage });

    // Persist messages
    opts.db.insertMessage(opts.sessionId, 'assistant', result.content || '(tool execution)', result.toolCalls);
    opts.db.insertMessage(opts.sessionId, 'user', toolResultMessage);
  }

  // Exhausted maxTurns — safety net
  return { content: lastContent, toolCalls: allToolCalls, turns: maxTurns, reason: 'max_turns' };
}
