/**
 * Programmable Verifier — Sprint 27 (Block 5)
 * Deterministic assertion DSL for /verify-last.
 *
 * Assertion syntax (one per line):
 *   FILE_EXISTS <path>
 *   FILE_CONTAINS <path> <regex>
 *   FILE_NOT_CONTAINS <path> <regex>
 *   FILE_LINE_COUNT <path> <op> <n>        (op: >, <, >=, <=, ==)
 *   COMMAND_SUCCEEDS <command>
 *   COMMAND_OUTPUT <command> <regex>
 *   GIT_BRANCH_IS <branch>
 *   GIT_CLEAN
 *   GIT_COMMITTED <message_regex>
 *
 * Returns { score: 0-1, passed: number, total: number, results: [...] }
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import simpleGit from 'simple-git';

export interface AssertionResult {
  assertion: string;
  passed: boolean;
  detail: string;
}

export interface VerifyReport {
  score: number;
  passed: number;
  total: number;
  results: AssertionResult[];
  timestamp: string;
}

// ─── Persisted results (in-memory, last 20) ───
const persistedReports: VerifyReport[] = [];
const MAX_PERSISTED = 20;

export function getPersistedReports(): VerifyReport[] {
  return [...persistedReports];
}

/**
 * Parse and execute a set of assertions against the given workspace.
 */
export async function runAssertions(
  assertionText: string,
  workspacePath: string,
): Promise<VerifyReport> {
  const lines = assertionText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));

  const results: AssertionResult[] = [];

  for (const line of lines) {
    const result = await executeAssertion(line, workspacePath);
    results.push(result);
  }

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const score = total > 0 ? passed / total : 0;

  const report: VerifyReport = {
    score: Math.round(score * 100) / 100,
    passed,
    total,
    results,
    timestamp: new Date().toISOString(),
  };

  // Persist
  persistedReports.push(report);
  if (persistedReports.length > MAX_PERSISTED) {
    persistedReports.splice(0, persistedReports.length - MAX_PERSISTED);
  }

  return report;
}

async function executeAssertion(line: string, cwd: string): Promise<AssertionResult> {
  const parts = splitAssertionLine(line);
  const op = parts[0]?.toUpperCase();

  try {
    switch (op) {
      case 'FILE_EXISTS': {
        const path = resolvePath(parts[1], cwd);
        const exists = existsSync(path);
        return { assertion: line, passed: exists, detail: exists ? `✓ ${path} exists` : `✗ ${path} not found` };
      }

      case 'FILE_CONTAINS': {
        const path = resolvePath(parts[1], cwd);
        const regex = new RegExp(parts.slice(2).join(' '));
        if (!existsSync(path)) return { assertion: line, passed: false, detail: `✗ ${path} not found` };
        const content = readFileSync(path, 'utf-8');
        const match = regex.test(content);
        return { assertion: line, passed: match, detail: match ? `✓ pattern found` : `✗ pattern not found in ${parts[1]}` };
      }

      case 'FILE_NOT_CONTAINS': {
        const path = resolvePath(parts[1], cwd);
        const regex = new RegExp(parts.slice(2).join(' '));
        if (!existsSync(path)) return { assertion: line, passed: true, detail: `✓ ${path} not found (vacuously true)` };
        const content = readFileSync(path, 'utf-8');
        const match = regex.test(content);
        return { assertion: line, passed: !match, detail: !match ? `✓ pattern absent` : `✗ unwanted pattern found in ${parts[1]}` };
      }

      case 'FILE_LINE_COUNT': {
        const path = resolvePath(parts[1], cwd);
        const relOp = parts[2]; // >, <, >=, <=, ==
        const n = parseInt(parts[3], 10);
        if (!existsSync(path)) return { assertion: line, passed: false, detail: `✗ ${path} not found` };
        const count = readFileSync(path, 'utf-8').split('\n').length;
        const pass = compareOp(count, relOp, n);
        return { assertion: line, passed: pass, detail: `${pass ? '✓' : '✗'} ${parts[1]} has ${count} lines (expected ${relOp} ${n})` };
      }

      case 'COMMAND_SUCCEEDS': {
        const cmd = parts.slice(1).join(' ');
        try {
          execSync(cmd, { cwd, timeout: 30000, stdio: 'pipe' });
          return { assertion: line, passed: true, detail: `✓ command succeeded` };
        } catch {
          return { assertion: line, passed: false, detail: `✗ command failed: ${cmd}` };
        }
      }

      case 'COMMAND_OUTPUT': {
        // COMMAND_OUTPUT <command> | <regex>
        const rest = parts.slice(1).join(' ');
        const pipeIdx = rest.lastIndexOf('|');
        if (pipeIdx === -1) return { assertion: line, passed: false, detail: '✗ syntax: COMMAND_OUTPUT <cmd> | <regex>' };
        const cmd = rest.substring(0, pipeIdx).trim();
        const regex = new RegExp(rest.substring(pipeIdx + 1).trim());
        try {
          const output = execSync(cmd, { cwd, timeout: 30000, stdio: 'pipe' }).toString();
          const match = regex.test(output);
          return { assertion: line, passed: match, detail: match ? '✓ output matches' : `✗ output does not match regex` };
        } catch (err) {
          return { assertion: line, passed: false, detail: `✗ command failed: ${cmd}` };
        }
      }

      case 'GIT_BRANCH_IS': {
        const expected = parts[1];
        const git = simpleGit(cwd);
        const status = await git.status();
        const match = status.current === expected;
        return { assertion: line, passed: match, detail: match ? `✓ on branch ${expected}` : `✗ on branch ${status.current}, expected ${expected}` };
      }

      case 'GIT_CLEAN': {
        const git = simpleGit(cwd);
        const status = await git.status();
        return { assertion: line, passed: status.isClean(), detail: status.isClean() ? '✓ working tree clean' : `✗ ${status.modified.length} modified, ${status.not_added.length} untracked` };
      }

      case 'GIT_COMMITTED': {
        const regex = new RegExp(parts.slice(1).join(' '));
        const git = simpleGit(cwd);
        const log = await git.log({ maxCount: 5 });
        const match = log.all.some(c => regex.test(c.message));
        return { assertion: line, passed: match, detail: match ? '✓ matching commit found' : '✗ no recent commit matches pattern' };
      }

      default:
        return { assertion: line, passed: false, detail: `✗ unknown assertion: ${op}` };
    }
  } catch (err) {
    return { assertion: line, passed: false, detail: `✗ error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function resolvePath(p: string, cwd: string): string {
  if (!p) return cwd;
  if (p.startsWith('/')) return p;
  return require('path').resolve(cwd, p);
}

function compareOp(a: number, op: string, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '==': return a === b;
    default: return false;
  }
}

/**
 * Split an assertion line respecting quoted strings.
 */
function splitAssertionLine(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of line) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Format a verify report as Markdown for chat display.
 */
export function formatVerifyReport(report: VerifyReport): string {
  const lines: string[] = [
    `## Verification Report`,
    `**Score:** ${(report.score * 100).toFixed(0)}% (${report.passed}/${report.total} assertions passed)`,
    `**Timestamp:** ${report.timestamp}`,
    '',
    '| # | Status | Assertion | Detail |',
    '|---|--------|-----------|--------|',
  ];

  report.results.forEach((r, i) => {
    const status = r.passed ? '✅' : '❌';
    lines.push(`| ${i + 1} | ${status} | \`${r.assertion.substring(0, 50)}\` | ${r.detail} |`);
  });

  if (report.score < 0.95) {
    lines.push('');
    lines.push(`> ⚠️ **Score below 0.95 threshold.** Review failing assertions before proceeding.`);
  }

  return lines.join('\n');
}
