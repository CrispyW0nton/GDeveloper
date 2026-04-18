/**
 * Tool Executor — Sprint 27.5
 *
 * Per-tool timeout via AbortController.
 * Each tool returns { type: "tool_result", tool_use_id, content, is_error }.
 * Pure timeout-based execution. No timers or polling.
 *
 * Reference: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 */

import { BrowserWindow } from 'electron';

// ─── Per-tool timeout defaults (ms) ───

export const DEFAULT_TIMEOUTS: Record<string, number> = {
  bash_command: 120_000,
  run_command: 120_000,
  read_file: 30_000,
  write_file: 30_000,
  patch_file: 30_000,
  multi_edit: 30_000,
  list_files: 30_000,
  parallel_read: 60_000,
  parallel_search: 60_000,
  grep: 60_000,
  glob: 60_000,
  todo: 5_000,
  task_plan: 5_000,
  summarize_large_document: 120_000,
  git_commit: 60_000,
  git_push: 60_000,
  default: 60_000,
};

export function getTimeoutForTool(toolName: string): number {
  return DEFAULT_TIMEOUTS[toolName] ?? DEFAULT_TIMEOUTS.default;
}

// ─── Types ───

export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
  timedOut?: boolean;
  elapsedMs?: number;
}

export interface ToolCallInput {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ExecuteToolOptions {
  executeLocal: (name: string, input: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }> }>;
  mcpToolMeta?: Array<{ name: string; serverId: string }>;
  mcpExecute?: (serverId: string, toolName: string, input: Record<string, unknown>) => Promise<any>;
  mode?: 'build' | 'plan';
  writeToolNames?: string[];
  wsPath?: string;
  emitSandboxEvent?: (event: any) => void;
  win?: BrowserWindow | null;
  sessionId?: string;
  db?: {
    logActivity: (sessionId: string, type: string, summary: string, detail?: string, meta?: any, level?: string) => void;
  };
  turn?: number;
}

// ─── Timeout wrapper ───

async function withTimeout<T>(
  toolName: string,
  promise: Promise<T>,
  timeoutMs?: number,
): Promise<{ result: T; timedOut: false } | { result: null; timedOut: true }> {
  const ms = timeoutMs ?? getTimeoutForTool(toolName);
  const controller = new AbortController();

  return Promise.race([
    promise.then(result => {
      controller.abort();
      return { result, timedOut: false as const };
    }),
    new Promise<{ result: null; timedOut: true }>((resolve) => {
      const timer = setTimeout(() => {
        resolve({ result: null, timedOut: true });
      }, ms);
      controller.signal.addEventListener('abort', () => clearTimeout(timer));
    }),
  ]);
}

// ─── Execute a single tool call ───

export async function executeToolCall(
  tc: ToolCallInput,
  opts: ExecuteToolOptions,
): Promise<ToolCallResult> {
  const startMs = Date.now();

  // Log tool start
  opts.db?.logActivity(
    opts.sessionId || 'unknown',
    'tool_call',
    `Tool call: ${tc.name}`,
    JSON.stringify(tc.input).substring(0, 200),
    { toolName: tc.name, toolCallId: tc.id, turn: opts.turn },
  );

  // Plan mode enforcement: block write tools
  if (opts.mode === 'plan' && opts.writeToolNames?.includes(tc.name)) {
    const msg = `Error: Tool "${tc.name}" is disabled in Plan mode. Switch to Build mode with /build.`;
    opts.emitSandboxEvent?.({ type: 'error', tool: tc.name, summary: `Blocked ${tc.name} (Plan mode)`, status: 'error' });
    return { toolCallId: tc.id, toolName: tc.name, content: msg, isError: true, elapsedMs: Date.now() - startMs };
  }

  // Emit sandbox start event
  const isCmd = ['run_command', 'bash_command'].includes(tc.name);
  opts.emitSandboxEvent?.({
    type: isCmd ? 'command' : 'tool_call',
    tool: tc.name,
    summary: isCmd ? `$ ${String(tc.input?.command || '').substring(0, 100)}` : `Calling ${tc.name}`,
    detail: JSON.stringify(tc.input || {}).substring(0, 500),
    cwd: opts.wsPath,
    status: 'running',
  });

  // Route: local tool or MCP tool
  const mcpMeta = opts.mcpToolMeta?.find(m => m.name === tc.name);

  try {
    let toolContent: string;

    if (mcpMeta && opts.mcpExecute) {
      // MCP tool
      opts.emitSandboxEvent?.({ type: 'mcp_call', tool: tc.name, summary: `MCP: ${tc.name}`, status: 'running' });

      const outcome = await withTimeout(tc.name, opts.mcpExecute(mcpMeta.serverId, tc.name, tc.input || {}));
      if (outcome.timedOut) {
        opts.emitSandboxEvent?.({ type: 'tool_result', tool: tc.name, summary: `MCP: ${tc.name} timed out`, status: 'error' });
        return { toolCallId: tc.id, toolName: tc.name, content: `Error: Tool "${tc.name}" timed out after ${getTimeoutForTool(tc.name)}ms`, isError: true, timedOut: true, elapsedMs: Date.now() - startMs };
      }

      const mcpResult = outcome.result;
      toolContent = mcpResult?.content
        ? (Array.isArray(mcpResult.content)
          ? mcpResult.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
          : JSON.stringify(mcpResult.content))
        : JSON.stringify(mcpResult);

      opts.emitSandboxEvent?.({ type: 'tool_result', tool: tc.name, summary: `MCP: ${tc.name} done`, detail: toolContent.substring(0, 300), status: 'success' });
    } else {
      // Local tool
      const outcome = await withTimeout(tc.name, opts.executeLocal(tc.name, tc.input || {}));
      if (outcome.timedOut) {
        opts.emitSandboxEvent?.({ type: 'tool_result', tool: tc.name, summary: `${tc.name} timed out`, status: 'error' });
        return { toolCallId: tc.id, toolName: tc.name, content: `Error: Tool "${tc.name}" timed out after ${getTimeoutForTool(tc.name)}ms`, isError: true, timedOut: true, elapsedMs: Date.now() - startMs };
      }

      const localResult = outcome.result;
      toolContent = localResult.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');

      // File edit notification
      const isFileEdit = ['write_file', 'patch_file', 'multi_edit'].includes(tc.name);
      opts.emitSandboxEvent?.({
        type: isFileEdit ? 'file_edit' : 'tool_result',
        tool: tc.name,
        summary: `${tc.name} completed${isFileEdit ? `: ${tc.input?.path || tc.input?.file_path || ''}` : ''}`,
        detail: toolContent.substring(0, 300),
        cwd: opts.wsPath,
        status: 'success',
      });

      // File change notification to renderer
      if (isFileEdit && opts.win && !opts.win.isDestroyed()) {
        const filePath = String(tc.input?.path || tc.input?.file_path || '');
        opts.win.webContents.send('filetree:file-changed', {
          filePath,
          toolName: tc.name,
          timestamp: Date.now(),
        });
      }
    }

    const elapsed = Date.now() - startMs;
    opts.db?.logActivity(
      opts.sessionId || 'unknown',
      'tool_result',
      `Tool result: ${tc.name}`,
      toolContent.substring(0, 200),
      { toolName: tc.name, toolCallId: tc.id, success: true, turn: opts.turn, elapsedMs: elapsed },
    );

    return { toolCallId: tc.id, toolName: tc.name, content: toolContent, isError: false, elapsedMs: elapsed };

  } catch (err) {
    const elapsed = Date.now() - startMs;
    const errMsg = `Error: ${err instanceof Error ? err.message : String(err)}`;
    opts.emitSandboxEvent?.({ type: 'tool_result', tool: tc.name, summary: `${tc.name} failed`, detail: errMsg, status: 'error' });
    opts.db?.logActivity(
      opts.sessionId || 'unknown',
      'tool_error',
      `Tool error: ${tc.name}`,
      errMsg.substring(0, 200),
      { toolName: tc.name, toolCallId: tc.id, success: false, turn: opts.turn, elapsedMs: elapsed },
      'error',
    );
    return { toolCallId: tc.id, toolName: tc.name, content: errMsg, isError: true, elapsedMs: elapsed };
  }
}
