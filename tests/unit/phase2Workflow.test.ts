import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('Phase 2 workflow commands', () => {
  const commandsSrc = readSrc('main/commands/index.ts');
  const mementoSrc = readSrc('main/orchestration/memento.ts');
  const tracerSrc = readSrc('main/orchestration/tracerBullet.ts');
  const dropdownSrc = readSrc('renderer/components/chat/SlashCommandDropdown.tsx');

  it('replaces the handoff stub with real memento writing', () => {
    expect(commandsSrc).toContain("name: 'handoff'");
    expect(commandsSrc).toContain('writeSessionMemento');
    expect(commandsSrc).not.toContain('Handoff generation** is coming');
  });

  it('registers /memento and /tracer workflow commands', () => {
    expect(commandsSrc).toContain("name: 'memento'");
    expect(commandsSrc).toContain("name: 'tracer'");
    expect(commandsSrc).toContain('createTracerBullet');
    expect(commandsSrc).toContain("setVibeLoopStage(ctx.sessionId, 'decompose'");
  });

  it('memento captures session continuity ingredients', () => {
    expect(mementoSrc).toContain("'.gd', 'memento'");
    expect(mementoSrc).toContain('getMessages(sessionId)');
    expect(mementoSrc).toContain('getTodoList(sessionId)');
    expect(mementoSrc).toContain('getCheckpoints(sessionId)');
    expect(mementoSrc).toContain('getVibeLoopState(sessionId)');
    expect(mementoSrc).toContain('Restart Prompt');
  });

  it('tracer writes an artifact and creates a task ladder', () => {
    expect(tracerSrc).toContain("'.gd', 'tracers'");
    expect(tracerSrc).toContain('createTodoList');
    expect(tracerSrc).toContain('Task Ladder');
    expect(tracerSrc).toContain('Expansion Gate');
  });

  it('surfaces new commands in slash command autocomplete metadata', () => {
    expect(dropdownSrc).toContain("'tracer'");
    expect(dropdownSrc).toContain("'memento'");
    expect(dropdownSrc).toContain("'handoff'");
    expect(dropdownSrc).toContain("'/tracer settings import flow'");
  });
});
