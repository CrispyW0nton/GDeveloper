import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  createAgentRunAccumulator,
  estimatePromptTokens,
  extractTestCommand,
  extractTouchedFiles,
  recordToolLineage,
  serializeAgentRunAccumulator,
} from '../../src/main/orchestration/agentRunTelemetry';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('Phase 5A agent run telemetry and lineage', () => {
  it('captures tools, touched files, test commands, and errors', () => {
    const acc = createAgentRunAccumulator();

    recordToolLineage(acc, 'write_file', { path: 'src/app.ts' }, false, 'local');
    recordToolLineage(acc, 'bash_command', { command: 'npm run typecheck' }, false, 'local');
    recordToolLineage(acc, 'bash_command', { command: 'npm run typecheck' }, true, 'local');
    recordToolLineage(acc, 'search_files', { query: 'todo' }, false, 'local');

    const serialized = serializeAgentRunAccumulator(acc);

    expect(serialized.filesTouched).toEqual(['src/app.ts']);
    expect(serialized.testsRun).toEqual(['npm run typecheck']);
    expect(serialized.tools.find(t => t.name === 'bash_command')).toMatchObject({ count: 2, errors: 1, source: 'local' });
  });

  it('extracts lineage without treating read-only paths as touched files', () => {
    expect(extractTouchedFiles('read_file', { path: 'src/app.ts' })).toEqual([]);
    expect(extractTouchedFiles('multi_edit', { file_path: 'src/app.ts' })).toEqual(['src/app.ts']);
    expect(extractTestCommand('run_command', { command: 'npx vitest run tests/unit/foo.test.ts' })).toContain('vitest');
    expect(extractTestCommand('run_command', { command: 'git status' })).toBeNull();
    expect(estimatePromptTokens('system', [{ content: 'hello' }], [{ name: 'tool' }])).toBeGreaterThan(0);
  });

  it('wires DB persistence, chat run finalization, IPC, preload, and Activity UI', () => {
    const dbSrc = readSrc('main/db/index.ts');
    const mainSrc = readSrc('main/index.ts');
    const ipcSrc = readSrc('main/ipc/index.ts');
    const preloadSrc = readSrc('preload/index.ts');
    const activitySrc = readSrc('renderer/components/activity/ActivityLog.tsx');

    expect(dbSrc).toContain('CREATE TABLE IF NOT EXISTS agent_runs');
    expect(dbSrc).toContain('createAgentRun');
    expect(dbSrc).toContain('setAgentRunFeedback');
    expect(mainSrc).toContain('db.createAgentRun');
    expect(mainSrc).toContain('recordToolLineage(runLineage');
    expect(mainSrc).toContain('db.updateAgentRun(agentRunId');
    expect(ipcSrc).toContain('AGENT_RUN_LIST');
    expect(ipcSrc).toContain('AGENT_RUN_FEEDBACK');
    expect(preloadSrc).toContain('listAgentRuns');
    expect(preloadSrc).toContain('setAgentRunFeedback');
    expect(activitySrc).toContain('Agent Run History');
  });
});
