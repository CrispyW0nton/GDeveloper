import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getAgentBoardSnapshot } from '../../src/main/worktree/agentBoard';

const SRC = resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('Phase 4 agent Kanban board', () => {
  it('builds an empty board snapshot with stable columns', () => {
    const board = getAgentBoardSnapshot(resolve(__dirname, '../fixtures/does-not-exist'));

    expect(board.columns.map(column => column.id)).toEqual(['active', 'completed', 'abandoned']);
    expect(board.totals).toEqual({ active: 0, completed: 0, abandoned: 0 });
  });

  it('exposes board IPC through main and preload', () => {
    const ipcSrc = readSrc('main/ipc/index.ts');
    const mainSrc = readSrc('main/index.ts');
    const preloadSrc = readSrc('preload/index.ts');

    expect(ipcSrc).toContain('AGENT_BOARD_GET');
    expect(mainSrc).toContain('getAgentBoardSnapshot(ws)');
    expect(preloadSrc).toContain('getAgentBoard');
  });

  it('renders an agent Kanban board inside the worktree panel', () => {
    const panelSrc = readSrc('renderer/components/worktree/WorktreePanel.tsx');
    const boardSrc = readSrc('renderer/components/worktree/AgentKanbanBoard.tsx');
    const agentBoardSrc = readSrc('main/worktree/agentBoard.ts');

    expect(panelSrc).toContain('AgentKanbanBoard');
    expect(panelSrc).toContain('api.getAgentBoard');
    expect(panelSrc).toContain('handleCompleteTask');
    expect(panelSrc).toContain('handleAbandonTask');
    expect(agentBoardSrc).toContain('Active Agents');
    expect(agentBoardSrc).toContain('Ready for Handoff');
    expect(boardSrc).toContain('onHandoff');
  });
});
