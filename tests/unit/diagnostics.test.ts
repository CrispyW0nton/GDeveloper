import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  formatDiagnosticsForPrompt,
  parseTypeScriptDiagnostics,
  type DiagnosticsSnapshot,
} from '../../src/main/diagnostics';

describe('diagnostics bridge', () => {
  it('parses located TypeScript diagnostics', () => {
    const diagnostics = parseTypeScriptDiagnostics([
      "src/main/index.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/main/index.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/main/providers/index.ts(40,11): warning TS6133: 'unused' is declared but its value is never read.",
    ].join('\n'), resolve(__dirname, '../..'));

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      source: 'typescript',
      severity: 'error',
      code: 'TS2322',
      file: 'src/main/index.ts',
      line: 12,
      column: 7,
    });
    expect(diagnostics[1]).toMatchObject({
      severity: 'warning',
      code: 'TS6133',
      file: 'src/main/providers/index.ts',
    });
  });

  it('parses global TypeScript diagnostics', () => {
    const diagnostics = parseTypeScriptDiagnostics("error TS18003: No inputs were found in config file.");

    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'TS18003',
        message: 'No inputs were found in config file.',
      }),
    ]);
  });

  it('formats diagnostics for prompt context', () => {
    const snapshot: DiagnosticsSnapshot = {
      source: 'typescript',
      status: 'errors',
      command: 'npx --no-install tsc --noEmit --pretty false',
      generatedAt: '2026-05-16T00:00:00.000Z',
      durationMs: 50,
      diagnostics: [{
        source: 'typescript',
        severity: 'error',
        code: 'TS2322',
        message: "Type 'string' is not assignable to type 'number'.",
        file: 'src/main/index.ts',
        line: 12,
        column: 7,
      }],
    };

    const prompt = formatDiagnosticsForPrompt(snapshot);

    expect(prompt).toContain('## Workspace Diagnostics');
    expect(prompt).toContain('TypeScript reported 1 diagnostic');
    expect(prompt).toContain("src/main/index.ts:12:7 TS2322");
  });

  it('omits unavailable diagnostics from prompt context', () => {
    const snapshot: DiagnosticsSnapshot = {
      source: 'typescript',
      status: 'unavailable',
      command: 'npx --no-install tsc --noEmit --pretty false',
      generatedAt: '2026-05-16T00:00:00.000Z',
      durationMs: 2,
      diagnostics: [],
      error: 'No tsconfig.json or package.json found.',
    };

    expect(formatDiagnosticsForPrompt(snapshot)).toBe('');
  });
});

describe('diagnostics integration wiring', () => {
  it('prompt builder collects, formats, and persists diagnostics', () => {
    const promptBuilder = readFileSync(resolve(__dirname, '../../src/main/orchestration/promptBuilder.ts'), 'utf-8');

    expect(promptBuilder).toContain('collectWorkspaceDiagnostics');
    expect(promptBuilder).toContain('formatDiagnosticsForPrompt');
    expect(promptBuilder).toContain('saveDiagnosticsSnapshot');
  });

  it('database has diagnostics snapshot storage', () => {
    const dbSource = readFileSync(resolve(__dirname, '../../src/main/db/index.ts'), 'utf-8');

    expect(dbSource).toContain('workspace_diagnostics_snapshots');
    expect(dbSource).toContain('saveDiagnosticsSnapshot');
    expect(dbSource).toContain('getDiagnosticsSnapshot');
  });
});
