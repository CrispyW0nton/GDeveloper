import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join, relative, resolve } from 'path';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export type DiagnosticsStatus = 'ok' | 'errors' | 'unavailable' | 'timeout';

export interface WorkspaceDiagnostic {
  source: 'typescript';
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface DiagnosticsSnapshot {
  source: 'typescript';
  status: DiagnosticsStatus;
  command: string;
  generatedAt: string;
  durationMs: number;
  diagnostics: WorkspaceDiagnostic[];
  error?: string;
}

export interface DiagnosticsOptions {
  timeoutMs?: number;
  maxDiagnostics?: number;
  cacheTtlMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_DIAGNOSTICS = 12;
const DEFAULT_CACHE_TTL_MS = 90000;

const diagnosticsCache = new Map<string, { expiresAt: number; snapshot: DiagnosticsSnapshot }>();

export function collectWorkspaceDiagnostics(workspacePath: string, options: DiagnosticsOptions = {}): DiagnosticsSnapshot {
  const root = resolve(workspacePath);
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cached = diagnosticsCache.get(root);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.snapshot;
  }

  const snapshot = collectTypeScriptDiagnostics(root, options);
  diagnosticsCache.set(root, { expiresAt: Date.now() + cacheTtlMs, snapshot });
  return snapshot;
}

export function clearDiagnosticsCache(workspacePath?: string): void {
  if (!workspacePath) {
    diagnosticsCache.clear();
    return;
  }
  diagnosticsCache.delete(resolve(workspacePath));
}

export function collectTypeScriptDiagnostics(workspacePath: string, options: DiagnosticsOptions = {}): DiagnosticsSnapshot {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxDiagnostics = options.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS;
  const command = 'npx --no-install tsc --noEmit --pretty false';

  if (!hasTypeScriptProject(workspacePath)) {
    return {
      source: 'typescript',
      status: 'unavailable',
      command,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      diagnostics: [],
      error: 'No tsconfig.json or package.json found.',
    };
  }

  try {
    execFileSync(getNpxCommand(), ['--no-install', 'tsc', '--noEmit', '--pretty', 'false'], {
      cwd: workspacePath,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      encoding: 'utf-8',
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });

    return {
      source: 'typescript',
      status: 'ok',
      command,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      diagnostics: [],
    };
  } catch (err: any) {
    const timedOut = err?.signal === 'SIGTERM' || err?.code === 'ETIMEDOUT' || /timed out/i.test(String(err?.message || ''));
    const output = [err?.stdout, err?.stderr, err?.message].filter(Boolean).join('\n');
    const diagnostics = parseTypeScriptDiagnostics(output, workspacePath).slice(0, maxDiagnostics);

    return {
      source: 'typescript',
      status: timedOut ? 'timeout' : diagnostics.length > 0 ? 'errors' : 'unavailable',
      command,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      diagnostics,
      error: timedOut ? `Diagnostics timed out after ${timeoutMs}ms.` : diagnostics.length === 0 ? trimError(output) : undefined,
    };
  }
}

export function parseTypeScriptDiagnostics(output: string, workspacePath?: string): WorkspaceDiagnostic[] {
  const diagnostics: WorkspaceDiagnostic[] = [];
  const seen = new Set<string>();
  const root = workspacePath ? resolve(workspacePath) : '';

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const located = line.match(/^(.*?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/i);
    const global = line.match(/^(error|warning)\s+(TS\d+):\s+(.+)$/i);
    let diagnostic: WorkspaceDiagnostic | null = null;

    if (located) {
      const rawFile = located[1];
      diagnostic = {
        source: 'typescript',
        severity: located[4].toLowerCase() as DiagnosticSeverity,
        code: located[5],
        message: located[6],
        file: normalizeDiagnosticPath(rawFile, root),
        line: Number(located[2]),
        column: Number(located[3]),
      };
    } else if (global) {
      diagnostic = {
        source: 'typescript',
        severity: global[1].toLowerCase() as DiagnosticSeverity,
        code: global[2],
        message: global[3],
      };
    }

    if (!diagnostic) continue;
    const key = `${diagnostic.file || ''}:${diagnostic.line || 0}:${diagnostic.column || 0}:${diagnostic.code}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

export function formatDiagnosticsForPrompt(snapshot: DiagnosticsSnapshot, maxDiagnostics = DEFAULT_MAX_DIAGNOSTICS): string {
  if (snapshot.status === 'unavailable') return '';
  if (snapshot.status === 'ok') {
    return [
      '## Workspace Diagnostics',
      `TypeScript: no diagnostics from \`${snapshot.command}\` (${snapshot.durationMs}ms).`,
    ].join('\n');
  }
  if (snapshot.status === 'timeout') {
    return [
      '## Workspace Diagnostics',
      `TypeScript diagnostics timed out via \`${snapshot.command}\`. Treat this as incomplete signal and run targeted checks when needed.`,
    ].join('\n');
  }

  const lines = [
    '## Workspace Diagnostics',
    `TypeScript reported ${snapshot.diagnostics.length} diagnostic(s) via \`${snapshot.command}\`. Prioritize these when they overlap the task.`,
  ];

  for (const diagnostic of snapshot.diagnostics.slice(0, maxDiagnostics)) {
    const location = diagnostic.file
      ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}` : ''}`
      : '(project)';
    lines.push(`- ${location} ${diagnostic.code}: ${diagnostic.message}`);
  }

  return lines.join('\n');
}

function hasTypeScriptProject(workspacePath: string): boolean {
  if (existsSync(join(workspacePath, 'tsconfig.json'))) return true;
  if (existsSync(join(workspacePath, 'package.json'))) return true;
  return false;
}

function getNpxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function normalizeDiagnosticPath(filePath: string, workspaceRoot: string): string {
  const trimmed = filePath.trim();
  if (!workspaceRoot) return trimmed.replace(/\\/g, '/');

  const absolute = resolve(workspaceRoot, trimmed);
  const rel = absolute.startsWith(workspaceRoot)
    ? relative(workspaceRoot, absolute)
    : trimmed;
  return rel.replace(/\\/g, '/');
}

function trimError(output: string): string {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '').trim();
  return clean.length > 1000 ? clean.slice(0, 1000) + '...' : clean;
}
