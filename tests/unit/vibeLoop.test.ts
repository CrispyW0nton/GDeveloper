import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('Phase 2 Vibe Coding Loop', () => {
  const vibeSrc = readSrc('main/orchestration/vibeLoop.ts');
  const commandsSrc = readSrc('main/commands/index.ts');
  const promptBuilderSrc = readSrc('main/orchestration/promptBuilder.ts');
  const chatSrc = readSrc('renderer/components/chat/ChatWorkspace.tsx');
  const preloadSrc = readSrc('preload/index.ts');
  const ipcSrc = readSrc('main/ipc/index.ts');
  const mainSrc = readSrc('main/index.ts');

  it('defines the six book-faithful loop stages in order', () => {
    expect(vibeSrc).toContain("['frame', 'decompose', 'converse', 'review', 'test', 'refine']");
    for (const label of ['Frame', 'Decompose', 'Converse', 'Review', 'Test', 'Refine']) {
      expect(vibeSrc).toContain(`label: '${label}'`);
    }
  });

  it('registers /vibe and direct stage slash commands', () => {
    expect(commandsSrc).toContain("name: 'vibe'");
    expect(commandsSrc).toContain('for (const stageDef of VIBE_LOOP_STAGE_DEFINITIONS)');
    expect(commandsSrc).toContain('name: stageDef.id');
    expect(commandsSrc).toContain('vibeLoopCommandResult(ctx, stageDef.id');
  });

  it('injects active loop state into the enhanced system prompt', () => {
    expect(promptBuilderSrc).toContain('formatVibeLoopForPrompt');
    expect(promptBuilderSrc).toContain('getVibeLoopState(ctx.sessionId)');
  });

  it('exposes persistent loop state through IPC and preload', () => {
    expect(ipcSrc).toContain('VIBE_LOOP_GET');
    expect(preloadSrc).toContain('getVibeLoop');
    expect(mainSrc).toContain('IPC_CHANNELS.VIBE_LOOP_GET');
    expect(mainSrc).toContain('getVibeLoopState(sessionId');
  });

  it('renders the loop card and updates it from slash command results', () => {
    expect(chatSrc).toContain('VibeLoopCard');
    expect(chatSrc).toContain('activeVibeLoop');
    expect(chatSrc).toContain('result.data?.vibeLoop');
    expect(chatSrc).toContain('api.getVibeLoop(session.id)');
  });
});
