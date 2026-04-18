/**
 * toolTimeout.ts — Sprint 27.2 (ROOT CAUSE FIX)
 *
 * Per-tool timeout with hard abort and subprocess cleanup.
 *
 * Root cause: bash_command uses execSync which BLOCKS the Node.js event loop.
 * No setTimeout-based wrapper can fire while execSync is running. Even when
 * execSync has its own timeout, it only sends SIGTERM which may not kill
 * the full process tree (subshells, piped commands, background jobs).
 *
 * Fix: Replace execSync with spawn-based async execution, wrap with
 * AbortController, and implement SIGTERM → SIGKILL escalation.
 *
 * This module provides:
 *   - withTimeout()   — generic async timeout wrapper with abort signal
 *   - spawnAsync()    — async shell exec that respects AbortSignal
 *   - DEFAULT_TIMEOUTS — per-tool timeout map
 */

import { spawn, type ChildProcess } from 'child_process';

// ─── Default Timeouts (ms) ───

export const DEFAULT_TIMEOUTS: Record<string, number> = {
  bash_command: 120_000,
  run_command: 120_000,
  file_read: 30_000,
  read_file: 30_000,
  write_file: 30_000,
  patch_file: 30_000,
  multi_edit: 30_000,
  list_files: 30_000,
  search_files: 60_000,
  parallel_search: 60_000,
  parallel_read: 60_000,
  grep_search: 60_000,
  summarize_large_document: 120_000,
  mcp_tool: 120_000,
  git_status: 30_000,
  git_diff: 30_000,
  git_log: 30_000,
  git_create_branch: 30_000,
  git_commit: 60_000,
  task_plan: 5_000,
  compare_file: 60_000,
  compare_folder: 60_000,
  todo_complete: 5_000,
  default: 60_000,
};

export function getTimeoutForTool(toolName: string): number {
  return DEFAULT_TIMEOUTS[toolName] ?? DEFAULT_TIMEOUTS.default;
}

// ─── Result Types ───

export type TimeoutResult<T> =
  | { ok: true; value: T; elapsed_ms: number }
  | { ok: false; is_error: true; error: string; elapsed_ms: number; timed_out: boolean };

// ─── Core: withTimeout ───

/**
 * Wrap any async invocation with a hard timeout + abort signal.
 *
 * - Creates an AbortController, passes signal to invocation
 * - If timeout fires first: aborts, optionally runs onKill, returns error
 * - If invocation resolves/rejects first: clears timeout, returns value/error
 *
 * Unlike the previous broken withToolTimeout (which only raced a timer
 * against a promise but couldn't abort execSync), this version:
 *   1. Passes an AbortSignal the invocation CAN listen to
 *   2. Calls onKill for subprocess cleanup (SIGTERM→SIGKILL)
 *   3. Returns a discriminated union instead of throwing
 */
export async function withTimeout<T>(
  toolName: string,
  timeoutMs: number,
  invocation: (signal: AbortSignal) => Promise<T>,
  onKill?: () => Promise<void>,
): Promise<TimeoutResult<T>> {
  const controller = new AbortController();
  const start = Date.now();

  return new Promise<TimeoutResult<T>>((resolve) => {
    let settled = false;

    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;

      // Abort the invocation
      controller.abort();

      // Run kill callback for subprocess cleanup
      if (onKill) {
        try {
          await onKill();
        } catch (killErr) {
          console.warn(`[toolTimeout] onKill for ${toolName} threw:`, killErr);
        }
      }

      const elapsed = Date.now() - start;
      resolve({
        ok: false,
        is_error: true,
        error: `Tool "${toolName}" timed out after ${Math.round(elapsed / 1000)}s (limit: ${Math.round(timeoutMs / 1000)}s). The operation was forcibly cancelled.`,
        elapsed_ms: elapsed,
        timed_out: true,
      });
    }, timeoutMs);

    invocation(controller.signal).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, value, elapsed_ms: Date.now() - start });
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const elapsed = Date.now() - start;
        const msg = err instanceof Error ? err.message : String(err);
        const isAbort = err?.name === 'AbortError' || msg.includes('aborted');
        resolve({
          ok: false,
          is_error: true,
          error: isAbort
            ? `Tool "${toolName}" was aborted after ${Math.round(elapsed / 1000)}s`
            : `Tool "${toolName}" failed: ${msg}`,
          elapsed_ms: elapsed,
          timed_out: isAbort,
        });
      },
    );
  });
}

// ─── Subprocess Helpers ───

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
  duration_ms: number;
}

/**
 * Async shell execution that respects AbortSignal.
 *
 * Unlike execSync, this:
 * - Does NOT block the event loop
 * - Responds to abort signal for clean cancellation
 * - Implements SIGTERM → wait 2s → SIGKILL escalation
 * - Captures stdout/stderr with buffer limits
 */
export function spawnAsync(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  maxBuffer: number = 2 * 1024 * 1024,
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;
    let exitCode: number | null = null;

    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

    const child = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Listen for abort signal
    const onAbort = () => {
      if (!killed) {
        killed = true;
        killProcess(child);
      }
    };

    if (signal) {
      if (signal.aborted) {
        // Already aborted before we started
        child.kill('SIGTERM');
        resolve({
          stdout: '', stderr: 'Aborted before start',
          exit_code: 1, timed_out: true, duration_ms: 0,
        });
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (data: Buffer) => {
      if (stdout.length < maxBuffer) {
        stdout += data.toString('utf-8');
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      if (stderr.length < maxBuffer) {
        stderr += data.toString('utf-8');
      }
    });

    child.on('close', (code) => {
      exitCode = code ?? 1;
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({
        stdout: stdout.substring(0, 100_000),
        stderr: stderr.substring(0, 100_000),
        exit_code: exitCode,
        timed_out: killed,
        duration_ms: Date.now() - start,
      });
    });

    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({
        stdout: stdout.substring(0, 100_000),
        stderr: `Process error: ${err.message}\n${stderr}`.substring(0, 100_000),
        exit_code: 1,
        timed_out: killed,
        duration_ms: Date.now() - start,
      });
    });
  });
}

/**
 * SIGTERM → wait 2s → SIGKILL escalation for a child process.
 * Also kills the entire process group (negative PID) to catch subshells.
 */
export function killProcess(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!child.pid || child.killed) {
      resolve();
      return;
    }

    // Try SIGTERM first (to the process group if possible)
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }

    // Check after 2 seconds if still alive → SIGKILL
    const escalateTimer = setTimeout(() => {
      try {
        // Check if process still exists
        process.kill(child.pid!, 0);
        // Still alive → force kill
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
      } catch {
        // Process already gone — good
      }
      resolve();
    }, 2000);

    // If process exits before escalation, clear timer
    child.once('exit', () => {
      clearTimeout(escalateTimer);
      resolve();
    });
  });
}
