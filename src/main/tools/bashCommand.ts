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

// Absolutely blocked commands.
// BUG-02: Hardened far beyond the original nine patterns to cover the
// remote-code-execution and credential-exfiltration vectors flagged in the
// audit. This is defense-in-depth on top of running inside the workspace
// dir — the tool still executes with a real shell, so a clever enough
// payload will still escape. The goal here is to block the obvious,
// scripted-attack shapes without annoying legitimate shell work.
//
// Reference patterns drawn from: the audit (pipe-to-shell, subshell auth
// writes, `rm -rf .`), Cline's ShellExecutor blocklist, HackTricks'
// Electron-security guide, and common reverse-shell cheatsheets.
const BLOCKED_PATTERNS = [
  // Root-level rm — the classic
  /\brm\s+-rf?\s+\/\s*$/i,
  /\brm\s+-rf?\s+\/\*/i,
  // Wipe current workspace
  /\brm\s+-rf?\s+\.\s*$/i,
  /\brm\s+-rf?\s+\.\/?\s*(?:&|;|\|\||$)/i,
  // Privilege escalation
  /\bsudo\b/i,
  /\bsu\s+-\b/i,
  // Power / system control
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\binit\s+0\b/i,
  /\bpoweroff\b/i,
  // Fork bomb
  /:\(\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;/,
  // Filesystem-level destruction
  /\bmkfs(?:\.[a-z0-9]+)?\b/i,
  /\bdd\s+.*of=\/dev\/(?:sd[a-z]|nvme|mmcblk|hd[a-z])/i,
  /\bformat\s+[a-z]:/i,
  // Pipe-to-shell RCE (curl … | sh, wget … | bash, iwr … | iex, etc.)
  /(?:curl|wget|fetch|iwr|invoke-webrequest)\b[^|`;&]*\|\s*(?:sh|bash|zsh|ksh|dash|pwsh|powershell|iex\b)/i,
  // Same pattern via command substitution: bash -c "$(curl …)"
  /(?:sh|bash|zsh|ksh|dash)\s+-c\s+['"]?\$\(\s*(?:curl|wget)/i,
  /(?:sh|bash|zsh|ksh|dash)\s+-c\s+['"]?`\s*(?:curl|wget)/i,
  // Reverse shells
  /\/dev\/(?:tcp|udp)\//i,
  /\bnc(?:at)?\b[^|;&]*\s-(?:[a-z]*e[a-z]*)\b/i,
  /\bbash\s+-i\b/i,
  // Credential / config-store writes (ssh keys, cloud creds, shell rc files)
  /authorized_keys\b/i,
  />\s*(?:~|\$HOME|\$\{HOME\})[\/\\]\.(?:ssh|aws|gcloud|kube|docker|npmrc|pypirc|env|bashrc|zshrc|profile|bash_profile)\b/i,
  />>\s*(?:~|\$HOME|\$\{HOME\})[\/\\]\.(?:ssh|aws|gcloud|kube|docker|npmrc|pypirc|env|bashrc|zshrc|profile|bash_profile)\b/i,
  // Setuid / setgid escalation via chmod (u+s, g+s, 4xxx, 6xxx)
  /\bchmod\s+(?:[ugoa]*[+=][a-rwxXst]*s|[0-7]?[4-7]\d{3})\b/i,
  // chown to root
  /\bchown\s+(?:-R\s+)?(?:root|0)[:.]/i,
  // LD_PRELOAD / DYLD_INSERT_LIBRARIES library injection
  /\b(?:LD_PRELOAD|DYLD_INSERT_LIBRARIES)\s*=/i,
  // chmod 777 on any leading-slash absolute path
  /\bchmod\s+777\s+\//i,
  // eval of network or decoded content
  /\beval\s+.*(?:curl|wget|base64\s+-d|base64\s+--decode|xxd\s+-r|openssl\s+enc\s+-d)/i,
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
