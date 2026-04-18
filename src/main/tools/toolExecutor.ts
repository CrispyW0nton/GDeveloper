/**
 * toolExecutor.ts — Sprint 27.3 (Canonical Agent Loop)
 *
 * Per-tool timeout executor with AbortController.
 * Extracted from the inline agent loop to match the easy-agent / Claude Code pattern.
 *
 * Each tool call gets:
 *   1. An AbortController-backed timeout (per DEFAULT_TIMEOUTS map)
 *   2. Structured result: { content, isError, timedOut, elapsedMs }
 *   3. Proper subprocess cleanup on abort (via toolTimeout.ts)
 */

import { withTimeout, getTimeoutForTool } from './toolTimeout';
import {
  executeLocalTool, LOCAL_TOOL_DEFINITIONS, getActiveWorkspace,
} from './index';
import type { ToolDefinition } from '../domain/entities';

// ─── Per-tool timeout defaults (ms) ───

export const DEFAULT_TIMEOUTS: Record<string, number> = {
  bash_command:   120_000,
  run_command:    120_000,
  read_file:      30_000,
  write_file:     30_000,
  patch_file:     30_000,
  multi_edit:     30_000,
  list_files:     30_000,
  search_files:   60_000,
  parallel_search: 60_000,
  parallel_read:  60_000,
  grep_search:    60_000,
  glob_search:    60_000,
  summarize_large_document: 120_000,
  mcp_tool:       120_000,
  git_status:     30_000,
  git_diff:       30_000,
  git_log:        30_000,
  git_create_branch: 30_000,
  git_commit:     60_000,
  task_plan:       5_000,
  todo_write:      5_000,
  compare_file:   60_000,
  compare_folder: 60_000,
  default:        60_000,
};

// ─── Result type ───

export interface ToolExecResult {
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
  timedOut: boolean;
  elapsedMs: number;
}

// ─── Execute a single tool with timeout ───

export async function executeToolWithTimeout(
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>,
): Promise<ToolExecResult> {
  const isLocalTool = LOCAL_TOOL_DEFINITIONS.some(t => t.name === toolName);
  const timeoutMs = getTimeoutForTool(toolName);
  const start = Date.now();

  if (!isLocalTool) {
    // Unknown tool — no MCP fallback in executor; caller handles MCP
    return {
      toolCallId,
      toolName,
      content: `Error: Unknown tool "${toolName}"`,
      isError: true,
      timedOut: false,
      elapsedMs: Date.now() - start,
    };
  }

  const result = await withTimeout(
    toolName,
    timeoutMs,
    (_signal) => executeLocalTool(toolName, input),
  );

  if (result.ok) {
    const localResult = result.value;
    const text = localResult.content
      .map((c: any) => c.text || JSON.stringify(c))
      .join('\n');
    return {
      toolCallId,
      toolName,
      content: text,
      isError: false,
      timedOut: false,
      elapsedMs: result.elapsed_ms,
    };
  } else {
    return {
      toolCallId,
      toolName,
      content: `Error: ${result.error}`,
      isError: true,
      timedOut: result.timed_out,
      elapsedMs: result.elapsed_ms,
    };
  }
}

/**
 * Execute an MCP tool with timeout.
 * MCP manager must be provided by caller.
 */
export async function executeMcpToolWithTimeout(
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>,
  mcpExecute: (name: string, input: Record<string, unknown>) => Promise<any>,
): Promise<ToolExecResult> {
  const timeoutMs = getTimeoutForTool('mcp_tool');
  const start = Date.now();

  const result = await withTimeout(
    toolName,
    timeoutMs,
    (_signal) => mcpExecute(toolName, input),
  );

  if (result.ok) {
    const mcpResult = result.value;
    const text = mcpResult?.content
      ? (Array.isArray(mcpResult.content)
          ? mcpResult.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
          : JSON.stringify(mcpResult.content))
      : JSON.stringify(mcpResult);
    return {
      toolCallId,
      toolName,
      content: text,
      isError: false,
      timedOut: false,
      elapsedMs: result.elapsed_ms,
    };
  } else {
    return {
      toolCallId,
      toolName,
      content: `Error: ${result.error}`,
      isError: true,
      timedOut: result.timed_out,
      elapsedMs: result.elapsed_ms,
    };
  }
}
