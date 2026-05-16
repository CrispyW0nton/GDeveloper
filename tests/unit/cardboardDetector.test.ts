import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  formatCardboardScanReport,
  scanDiffForCardboardMuffins,
} from '../../src/main/orchestration/cardboardDetector';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('cardboardDetector', () => {
  it('detects skipped tests, TODO markers, hollow assertions, and placeholders in added lines', () => {
    const diff = [
      'diff --git a/tests/example.test.ts b/tests/example.test.ts',
      '+++ b/tests/example.test.ts',
      '@@ -0,0 +1,8 @@',
      '+it.skip("does the thing", () => {})',
      '+expect(true).toBe(true)',
      '+// TODO: add real coverage',
      'diff --git a/src/example.ts b/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -0,0 +1,5 @@',
      '+export function thing() {',
      '+  throw new Error("not implemented");',
      '+}',
    ].join('\n');

    const report = scanDiffForCardboardMuffins(diff);
    expect(report.score).toBeLessThan(100);
    expect(report.findings.map(f => f.ruleId)).toContain('baby-counting-skipped-test');
    expect(report.findings.map(f => f.ruleId)).toContain('cardboard-hollow-assertion');
    expect(report.findings.map(f => f.ruleId)).toContain('litterbug-marker');
    expect(report.findings.map(f => f.ruleId)).toContain('cardboard-placeholder-implementation');
  });

  it('formats a markdown section for verify-last', () => {
    const report = scanDiffForCardboardMuffins([
      '+++ b/tests/example.test.ts',
      '@@ -0,0 +1,1 @@',
      '+test.only("focused", () => {})',
    ].join('\n'));
    const markdown = formatCardboardScanReport(report);
    expect(markdown).toContain('Cardboard-Muffin Safety Scan');
    expect(markdown).toContain('baby-counting-focused-test');
  });

  it('wires the scan into /verify-last', () => {
    const commandsSrc = readSrc('main/commands/index.ts');
    expect(commandsSrc).toContain('scanWorkspaceChangesForCardboardMuffins');
    expect(commandsSrc).toContain('formatCardboardScanReport(cardboardScan)');
    expect(commandsSrc).toContain('cardboardScan');
  });
});
