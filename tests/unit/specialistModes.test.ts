import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { BUILT_IN_SPECIALIST_MODES, listSpecialistModes } from '../../src/main/orchestration/specialistModes';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('Phase 4 specialist modes', () => {
  it('ships the expected built-in specialist roles', () => {
    const ids = BUILT_IN_SPECIALIST_MODES.map(mode => mode.id);

    expect(ids).toEqual(expect.arrayContaining(['code', 'architect', 'ask', 'audit', 'debug', 'test']));
    expect(BUILT_IN_SPECIALIST_MODES.every(mode => mode.prompt.length > 20)).toBe(true);
    expect(listSpecialistModes().map(mode => mode.id)).toEqual(expect.arrayContaining(ids));
  });

  it('injects specialist posture into the enhanced system prompt', () => {
    const promptBuilderSrc = readSrc('main/orchestration/promptBuilder.ts');

    expect(promptBuilderSrc).toContain('formatSpecialistModeForPrompt');
    expect(promptBuilderSrc).toContain('specialist mode controls role posture');
  });

  it('exposes specialist mode IPC and preload methods', () => {
    const ipcSrc = readSrc('main/ipc/index.ts');
    const mainSrc = readSrc('main/index.ts');
    const preloadSrc = readSrc('preload/index.ts');

    expect(ipcSrc).toContain('SPECIALIST_MODE_LIST');
    expect(ipcSrc).toContain('SPECIALIST_MODE_GET');
    expect(ipcSrc).toContain('SPECIALIST_MODE_SET');
    expect(mainSrc).toContain('listSpecialistModes(getActiveWorkspace())');
    expect(mainSrc).toContain('setActiveSpecialistMode(modeId, getActiveWorkspace())');
    expect(preloadSrc).toContain('listSpecialistModes');
    expect(preloadSrc).toContain('setSpecialistMode');
  });

  it('adds slash command and chat selector without replacing Plan/Build', () => {
    const commandsSrc = readSrc('main/commands/index.ts');
    const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');
    const storeSrc = readSrc('renderer/store/index.ts');

    expect(commandsSrc).toContain("name: 'mode'");
    expect(commandsSrc).toContain('ask|audit|debug');
    expect(commandsSrc).toContain('setActiveSpecialistMode(requested');
    expect(chatSrc).toContain('handleSpecialistModeChange');
    expect(chatSrc).toContain('api.listSpecialistModes');
    expect(chatSrc).toContain('executionMode ===');
    expect(storeSrc).toContain('api.setExecutionMode');
  });
});
