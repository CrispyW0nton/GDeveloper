import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  formatIntentInspectionMarkdown,
  inspectIntent,
} from '../../src/main/orchestration/intentInspector';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('Phase 5B intent inspector', () => {
  it('summarizes likely actions and medium risk for broad build prompts without a spec', () => {
    const inspection = inspectIntent({
      sessionId: 'intent-test',
      message: 'Refactor the whole app and update everything that needs cleanup',
      executionMode: 'build',
    });

    expect(inspection.summary).toContain('Build mode');
    expect(inspection.likelyActions).toContain('change files');
    expect(inspection.riskLevel).toBe('high');
    expect(inspection.riskNotes.join('\n')).toContain('broad edit language');
    expect(formatIntentInspectionMarkdown(inspection)).toContain('Intent Inspector');
  });

  it('keeps read-only specialist posture visible in plan mode', () => {
    const inspection = inspectIntent({
      sessionId: 'intent-test-plan',
      message: 'Explain where settings are loaded and how tests should cover it',
      executionMode: 'plan',
    });

    expect(inspection.executionMode).toBe('plan');
    expect(inspection.contextSources.map(source => source.id)).toContain('mode');
    expect(inspection.likelyActions).toEqual(expect.arrayContaining(['read and explain code', 'run verification commands']));
  });

  it('wires slash command, IPC, preload validation, and composer UI', () => {
    const commandsSrc = readSrc('main/commands/index.ts');
    const ipcSrc = readSrc('main/ipc/index.ts');
    const validatorsSrc = readSrc('main/ipc/validators.ts');
    const mainSrc = readSrc('main/index.ts');
    const preloadSrc = readSrc('preload/index.ts');
    const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');

    expect(commandsSrc).toContain("name: 'intent'");
    expect(commandsSrc).toContain('formatIntentInspectionMarkdown');
    expect(ipcSrc).toContain('INTENT_INSPECT');
    expect(validatorsSrc).toContain('IPC_CHANNELS.INTENT_INSPECT');
    expect(mainSrc).toContain('IPC_CHANNELS.INTENT_INSPECT');
    expect(preloadSrc).toContain('inspectIntent');
    expect(chatSrc).toContain('IntentInspectorCard');
    expect(chatSrc).toContain('api.inspectIntent');
  });
});
