import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  formatAgentRunScoreMarkdown,
  formatEvalScenariosMarkdown,
  listAgentEvalScenarios,
  scoreAgentRun,
} from '../../src/main/orchestration/agentEvals';

const SRC = resolve(__dirname, '../../src');
const DOCS = resolve(__dirname, '../../docs');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

function readDoc(relPath: string): string {
  return readFileSync(resolve(DOCS, relPath), 'utf-8');
}

describe('Phase 5A agent eval scenarios and run scoring', () => {
  it('ships a small practical scenario matrix for testers', () => {
    const scenarios = listAgentEvalScenarios();

    expect(scenarios.length).toBeGreaterThanOrEqual(4);
    expect(scenarios.map(s => s.category)).toEqual(expect.arrayContaining(['spec', 'safety', 'verification', 'workflow']));
    expect(formatEvalScenariosMarkdown(scenarios)).toContain('Spec-driven small feature slice');
  });

  it('scores runs from durable evidence rather than model confidence', () => {
    const score = scoreAgentRun({
      id: 'run-good',
      status: 'completed',
      reason: 'attempt_completion',
      tools: [{ name: 'write_file', count: 1, errors: 0 }],
      filesTouched: ['src/app.ts'],
      testsRun: ['npm run typecheck'],
      spec_id: 'spec-1',
      spec_title: 'Settings Import',
      contextSources: ['active-spec'],
      feedback: 'accepted',
    });

    expect(score.score).toBe(100);
    expect(score.grade).toBe('excellent');
    expect(formatAgentRunScoreMarkdown(score)).toContain('Agent Run Score');
  });

  it('penalizes runs missing verification, lineage, or feedback', () => {
    const score = scoreAgentRun({
      id: 'run-thin',
      status: 'completed',
      reason: 'attempt_completion',
      tools: [],
      filesTouched: [],
      testsRun: [],
      contextSources: [],
    });

    expect(score.score).toBeLessThan(60);
    expect(score.checks.filter(check => !check.passed).map(check => check.id)).toEqual(expect.arrayContaining(['lineage-tools', 'tests-run', 'feedback']));
  });

  it('wires slash commands, IPC, preload, Activity UI, and tester docs', () => {
    const commandsSrc = readSrc('main/commands/index.ts');
    const ipcSrc = readSrc('main/ipc/index.ts');
    const mainSrc = readSrc('main/index.ts');
    const preloadSrc = readSrc('preload/index.ts');
    const activitySrc = readSrc('renderer/components/activity/ActivityLog.tsx');
    const docs = readDoc('GDEVELOPER-TESTING-GUIDE.md');

    expect(commandsSrc).toContain("name: 'evals'");
    expect(commandsSrc).toContain('scoreAgentRun(run)');
    expect(ipcSrc).toContain('AGENT_EVAL_SCENARIOS');
    expect(ipcSrc).toContain('AGENT_RUN_SCORE');
    expect(mainSrc).toContain('IPC_CHANNELS.AGENT_RUN_SCORE');
    expect(preloadSrc).toContain('listAgentEvalScenarios');
    expect(preloadSrc).toContain('scoreAgentRun');
    expect(activitySrc).toContain('Score {score.score}/100');
    expect(docs).toContain('Manual Scenario Matrix');
  });
});
