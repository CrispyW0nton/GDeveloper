import { getTaskWorktrees, type TaskWorktree } from './taskIsolation';
import { listWorktrees, type WorktreeInfo } from '../git/worktree';

export type AgentBoardColumnId = 'active' | 'completed' | 'abandoned';

export interface AgentBoardCard {
  id: string;
  title: string;
  worktreePath: string;
  branchName: string | null;
  sessionId: string;
  lifecycle: 'temporary' | 'permanent';
  status: TaskWorktree['status'];
  column: AgentBoardColumnId;
  createdAt: string;
  dirty: boolean;
  missing: boolean;
  head: string | null;
}

export interface AgentBoardColumn {
  id: AgentBoardColumnId;
  title: string;
  cards: AgentBoardCard[];
}

export interface AgentBoardSnapshot {
  generatedAt: string;
  columns: AgentBoardColumn[];
  totals: Record<AgentBoardColumnId, number>;
}

const COLUMN_TITLES: Record<AgentBoardColumnId, string> = {
  active: 'Active Agents',
  completed: 'Ready for Handoff',
  abandoned: 'Abandoned',
};

export function getAgentBoardSnapshot(repoPath: string): AgentBoardSnapshot {
  const worktrees = safeListWorktrees(repoPath);
  const cards = getTaskWorktrees().map(task => toBoardCard(task, worktrees));
  const columns = (Object.keys(COLUMN_TITLES) as AgentBoardColumnId[]).map(id => ({
    id,
    title: COLUMN_TITLES[id],
    cards: cards
      .filter(card => card.column === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  }));

  return {
    generatedAt: new Date().toISOString(),
    columns,
    totals: {
      active: columns.find(c => c.id === 'active')?.cards.length || 0,
      completed: columns.find(c => c.id === 'completed')?.cards.length || 0,
      abandoned: columns.find(c => c.id === 'abandoned')?.cards.length || 0,
    },
  };
}

function toBoardCard(task: TaskWorktree, worktrees: WorktreeInfo[]): AgentBoardCard {
  const worktree = worktrees.find(wt => wt.path === task.worktreePath);
  return {
    id: task.id,
    title: task.taskDescription,
    worktreePath: task.worktreePath,
    branchName: task.branchName,
    sessionId: task.sessionId,
    lifecycle: task.lifecycle,
    status: task.status,
    column: task.status === 'completed' ? 'completed' : task.status === 'abandoned' ? 'abandoned' : 'active',
    createdAt: task.createdAt,
    dirty: !!worktree?.dirty,
    missing: worktree ? !!worktree.missing : true,
    head: worktree?.head || null,
  };
}

function safeListWorktrees(repoPath: string): WorktreeInfo[] {
  try {
    return listWorktrees(repoPath);
  } catch {
    return [];
  }
}
