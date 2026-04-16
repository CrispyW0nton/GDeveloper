/**
 * bash_command — Sprint 16
 * Scoped one-shot shell tool: executes a command, captures stdout/stderr/exit code.
 * No elevated privileges, no PTY. Destructive commands require confirmation.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, sep } from 'path';

export interface BashCommandInput {
  command: string;
  cwd?: string;
  timeout?: number;
  description?: string;
}

export interface BashCommandResult {
  success: boolean;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
  blocked: boolean;
  block_reason?: string;
  duration_ms: number;
}

// High-risk patterns that require confirmation
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\brm\s+-r\b/i,
  /\brmdir\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+push\s+-f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fd/i,
  /\bdrop\s+database\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\b/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
];

// Absolutely blocked commands
const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+\/\s*$/i,
  /\brm\s+-rf\s+\/\*/i,
  /\bsudo\b/i,
  /\bchmod\s+777\s+\//i,
  /\b:()\s*\{\s*:\|\:&\s*\}\s*;/,  // fork bomb
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\binit\s+0\b/i,
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some(p => p.test(command));
}

export function isBlockedCommand(command: string): boolean {
  return BLOCKED_PATTERNS.some(p => p.test(command));
}

/**
 * Execute a bash command in the workspace scope.
 */
export function executeBashCommand(
  workspacePath: string,
  resolveSafe: (ws: string, fp: string) => string,
  input: BashCommandInput
): BashCommandResult {
  const { command, cwd, timeout = 30000, description } = input;
  const defaultResult: BashCommandResult = {
    success: false,
    command,
    cwd: workspacePath,
    stdout: '',
    stderr: '',
    exit_code: 1,
    timed_out: false,
    blocked: false,
    duration_ms: 0,
  };

  if (!command || !command.trim()) {
    return { ...defaultResult, stderr: 'command is required', blocked: true, block_reason: 'Empty command' };
  }

  // Check blocked commands
  if (isBlockedCommand(command)) {
    return {
      ...defaultResult,
      blocked: true,
      block_reason: 'Command blocked for safety: contains dangerous system operations (sudo, rm -rf /, shutdown, etc.)',
      stderr: 'Command blocked for safety.',
    };
  }

  // Resolve CWD safely
  let effectiveCwd = workspacePath;
  if (cwd) {
    try {
      effectiveCwd = resolveSafe(workspacePath, cwd);
    } catch (err) {
      return { ...defaultResult, stderr: `Invalid cwd: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (!existsSync(effectiveCwd)) {
    return { ...defaultResult, stderr: `Working directory not found: ${effectiveCwd}` };
  }

  // Clamp timeout
  const effectiveTimeout = Math.max(1000, Math.min(timeout, 120000));

  const start = Date.now();
  try {
    const stdout = execSync(command, {
      cwd: effectiveCwd,
      maxBuffer: 2 * 1024 * 1024,
      timeout: effectiveTimeout,
      encoding: 'utf-8',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      env: { ...process.env, TERM: 'dumb' },
    });

    const duration = Date.now() - start;
    return {
      success: true,
      command,
      cwd: effectiveCwd,
      stdout: (stdout || '').substring(0, 100000),
      stderr: '',
      exit_code: 0,
      timed_out: false,
      blocked: false,
      duration_ms: duration,
    };
  } catch (err: any) {
    const duration = Date.now() - start;
    const timedOut = err.killed || (err.signal === 'SIGTERM');

    return {
      success: false,
      command,
      cwd: effectiveCwd,
      stdout: (err.stdout || '').substring(0, 100000),
      stderr: (err.stderr || '').substring(0, 100000),
      exit_code: err.status ?? 1,
      timed_out: timedOut,
      blocked: false,
      duration_ms: duration,
    };
  }
}
