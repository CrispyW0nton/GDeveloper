import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type CardboardFindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CardboardFinding {
  ruleId: string;
  severity: CardboardFindingSeverity;
  filePath: string;
  line?: number;
  summary: string;
  evidence: string;
}

export interface CardboardScanReport {
  findings: CardboardFinding[];
  score: number;
  scannedFiles: number;
}

const SEVERITY_WEIGHT: Record<CardboardFindingSeverity, number> = {
  critical: 35,
  high: 20,
  medium: 10,
  low: 5,
};

const TEST_FILE_RE = /(^|[\\/])(__tests__|tests?|spec)([\\/]|$)|\.(test|spec)\.[jt]sx?$/i;
const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/i;
const SKIPPED_TEST_RE = /\b(describe|it|test)\.skip\s*\(|\bx(describe|it|test)\s*\(/;
const ONLY_TEST_RE = /\b(describe|it|test)\.only\s*\(/;
const HOLLOW_ASSERTION_RE =
  /expect\s*\(\s*(true|false|null|undefined|['"][^'"]*['"]|\d+)\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)|assert\.(ok|equal|strictEqual)\s*\(\s*true\s*(?:,|\))/;
const NOT_IMPLEMENTED_RE = /throw\s+new\s+Error\s*\(\s*['"`](not implemented|todo|stub|placeholder)/i;
const PLACEHOLDER_RETURN_RE = /return\s+(['"`](todo|stub|placeholder|mocked response)['"`]|null|undefined)\s*;?\s*$/i;
const DISABLED_LINT_RE = /eslint-disable|ts-ignore|ts-nocheck/i;

interface AddedLine {
  filePath: string;
  line?: number;
  content: string;
}

export function scanDiffForCardboardMuffins(diffText: string): CardboardScanReport {
  const addedLines = parseAddedLines(diffText);
  return scanAddedLines(addedLines, new Set(addedLines.map(l => l.filePath)).size);
}

export function scanWorkspaceChangesForCardboardMuffins(
  workspacePath: string,
  diffText: string,
  untrackedFiles: string[] = [],
): CardboardScanReport {
  const addedLines = parseAddedLines(diffText);
  const scannedFiles = new Set(addedLines.map(l => l.filePath));

  for (const relPath of untrackedFiles) {
    const absPath = join(workspacePath, relPath);
    if (!existsSync(absPath) || shouldSkipFile(relPath)) continue;
    scannedFiles.add(relPath);
    const content = readFileSync(absPath, 'utf-8');
    content.split(/\r?\n/).forEach((line, index) => {
      addedLines.push({ filePath: relPath, line: index + 1, content: line });
    });
  }

  return scanAddedLines(addedLines, scannedFiles.size);
}

export function formatCardboardScanReport(report: CardboardScanReport): string {
  const lines = [
    '### Cardboard-Muffin Safety Scan',
    `**Score:** ${report.score}%`,
    `**Findings:** ${report.findings.length}`,
  ];

  if (report.findings.length === 0) {
    lines.push('', 'No obvious skipped tests, hollow assertions, placeholder returns, or hidden TODO/FIXME markers were detected in changed lines.');
    return lines.join('\n');
  }

  lines.push('', '| Severity | Rule | Location | Evidence |', '|---|---|---|---|');
  for (const finding of report.findings.slice(0, 20)) {
    const location = `${finding.filePath}${finding.line ? `:${finding.line}` : ''}`;
    lines.push(`| ${finding.severity} | ${finding.ruleId} | \`${location}\` | ${escapeTableCell(finding.evidence.slice(0, 120))} |`);
  }
  if (report.findings.length > 20) {
    lines.push(`| medium | truncated | report | ${report.findings.length - 20} additional findings omitted |`);
  }
  lines.push('', '> Recommendation: resolve high/critical findings before trusting the agent claim or committing the change.');
  return lines.join('\n');
}

function scanAddedLines(addedLines: AddedLine[], scannedFiles: number): CardboardScanReport {
  const findings: CardboardFinding[] = [];

  for (const added of addedLines) {
    const trimmed = added.content.trim();
    if (!trimmed) continue;

    if (SKIPPED_TEST_RE.test(trimmed)) {
      findings.push(finding('baby-counting-skipped-test', 'critical', added, 'A test was skipped or disabled in the changed lines.'));
    }

    if (ONLY_TEST_RE.test(trimmed)) {
      findings.push(finding('baby-counting-focused-test', 'high', added, 'A focused-only test was added and can hide the rest of the suite.'));
    }

    if (TEST_FILE_RE.test(added.filePath) && HOLLOW_ASSERTION_RE.test(trimmed)) {
      findings.push(finding('cardboard-hollow-assertion', 'high', added, 'A test assertion appears tautological or too shallow to prove behavior.'));
    }

    if (TODO_RE.test(trimmed)) {
      findings.push(finding('litterbug-marker', 'medium', added, 'A TODO/FIXME-style marker was added in changed code.'));
    }

    if (NOT_IMPLEMENTED_RE.test(trimmed) || PLACEHOLDER_RETURN_RE.test(trimmed)) {
      findings.push(finding('cardboard-placeholder-implementation', 'high', added, 'A placeholder implementation was added.'));
    }

    if (DISABLED_LINT_RE.test(trimmed)) {
      findings.push(finding('guardrail-disabled', 'medium', added, 'A lint or type-check guardrail was disabled.'));
    }
  }

  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  return {
    findings,
    score: Math.max(0, 100 - penalty),
    scannedFiles,
  };
}

function finding(ruleId: string, severity: CardboardFindingSeverity, added: AddedLine, summary: string): CardboardFinding {
  return {
    ruleId,
    severity,
    filePath: added.filePath,
    line: added.line,
    summary,
    evidence: added.content.trim(),
  };
}

function parseAddedLines(diffText: string): AddedLine[] {
  const results: AddedLine[] = [];
  let currentFile = '';
  let newLine = 0;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length);
      continue;
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      results.push({ filePath: currentFile, line: newLine || undefined, content: line.slice(1) });
      newLine++;
    } else if (!line.startsWith('-')) {
      newLine++;
    }
  }

  return results;
}

function shouldSkipFile(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|exe|dll|sqlite|db)$/i.test(filePath);
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
