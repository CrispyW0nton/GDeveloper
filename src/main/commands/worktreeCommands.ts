/**
 * Worktree Slash Commands — Sprint 17
 * /worktree-list, /worktree-add, /worktree-remove, /worktree-prune,
 * /worktree-repair, /worktree-lock, /worktree-unlock, /compare-worktrees
 */

import { resolve } from 'path';
import {
  listWorktrees, addWorktree, removeWorktree, pruneWorktrees,
  repairWorktrees, lockWorktree, unlockWorktree, compareWorktrees,
  getWorktreeContext, WorktreeInfo,
} from '../git/worktree';
import {
  createTaskWorktree, getHandoffInfo, shouldRecommendWorktree,
} from '../worktree/taskIsolation';
import type { CommandResult, WorkspaceContext } from './index';

// ─── Helper: require workspace ───
function requireWorkspace(ctx: WorkspaceContext): string {
  if (!ctx.workspacePath) {
    throw new Error('No active workspace. Clone or open a repository first.');
  }
  return ctx.workspacePath;
}

// ─── Helper: format worktree for display ───
function formatWorktree(wt: WorktreeInfo, index: number): string {
  const badge = wt.isMain ? '🏠 Main' : '🔗 Linked';
  const branch = wt.isDetached ? `⚡ Detached: ${wt.head.substring(0, 7)}` : `🌿 ${wt.branch || '(unknown)'}`;
  const status = [
    wt.dirty ? '📝 dirty' : '✅ clean',
    wt.locked ? `🔒 locked${wt.lockReason ? ` (${wt.lockReason})` : ''}` : '',
    wt.missing ? '❌ missing' : '',
    wt.prunable ? '🗑️ prunable' : '',
    wt.hasSubmodules ? '⚠️ submodules' : '',
  ].filter(Boolean).join(' | ');
  const ab = wt.aheadBehind ? ` (↑${wt.aheadBehind.ahead} ↓${wt.aheadBehind.behind})` : '';

  return [
    `**${index + 1}. ${badge}**`,
    `   Path: \`${wt.path}\``,
    `   ${branch}${ab}`,
    `   Status: ${status}`,
  ].join('\n');
}

// ─── Slash Command Implementations ───

export async function worktreeList(_args: string, ctx: WorkspaceContext): Promise<CommandResult> {
  const ws = requireWorkspace(ctx);
  const worktrees = listWorktrees(ws);

  if (worktrees.length === 0) {
    return { success: true, message: '**No worktrees found.** This may not be a git repository.' };
  }

  // Current worktree context
  const current = getWorktreeContext(ws);
  const currentLabel = current
    ? `Current: \`${current.currentPath}\` (${current.isMain ? 'Main' : 'Linked'}, ${current.branch || `detached ${current.head.substring(0, 7)}`})`
    : '';

  const lines = [
    `## Git Worktrees (${worktrees.length})`,
    currentLabel ? `**${currentLabel}**` : '',
    '',
    ...worktrees.map((wt, i) => formatWorktree(wt, i)),
  ];

  return {
    success: true,
    message: lines.join('\n'),
    data: { worktrees },
  };
}

export async function worktreeAdd(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
  const ws = requireWorkspace(ctx);
  const parts = args.trim().split(/\s+/);

  if (parts.length === 0 || !parts[0]) {
    return {
      success: true,
      message: '**Usage:** `/worktree-add <path> [branch|commit]`\n\nOptions:\n- `--detach` — use detached HEAD\n- `--force` — force even if branch is checked out\n- `-b <name>` — create a new branch\n\nExamples:\n- `/worktree-add ../my-feature feature/auth`\n- `/worktree-add ../hotfix -b hotfix/critical main`\n- `/worktree-add ../experiment --detach HEAD~5`',
    };
  }

  // Parse options
  let path = '';
  let branchOrCommit: string | undefined;
  let detach = false;
  let force = false;
  let newBranch = false;
  let newBranchName: string | undefined;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '--detach') {
      detach = true;
    } else if (parts[i] === '--force') {
      force = true;
    } else if (parts[i] === '-b' && i + 1 < parts.length) {
      newBranch = true;
      newBranchName = parts[++i];
    } else if (!path) {
      path = parts[i];
    } else if (!branchOrCommit) {
      branchOrCommit = parts[i];
    }
  }

  if (!path) {
    return { success: false, message: 'Missing path argument. Usage: `/worktree-add <path> [branch]`' };
  }

  const resolvedPath = resolve(ws, path);
  const result = addWorktree(ws, {
    path: resolvedPath,
    branchOrCommit: newBranchName || branchOrCommit,
    newBranch,
    detach,
    force,
  });

  const warnings = result.warnings?.length ? `\n\n**Warnings:**\n${result.warnings.join('\n')}` : '';

  return {
    success: result.success,
    message: result.success
      ? `**Worktree created** ✅\n\n${result.message}${warnings}\n\nOpen it with the Worktree Manager or switch workspace.`
      : `**Failed** ❌\n\n${result.message}${warnings}`,
    data: result.data,
  };
}

export async function worktreeRemove(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
  const ws = requireWorkspace(ctx);
  const parts = args.trim().split(/\s+/);

  if (parts.length === 0 || !parts[0]) {
    return { success: true, message: '**Usage:** `/worktree-remove <path> [--force]`' };
  }

  const force = parts.includes('--force');
  const path = parts.find(p => p !== '--force') || '';
  const resolvedPath = resolve(ws, path);

  const result = removeWorktree(ws, { path: resolvedPath, force });

  return {
    success: result.success,
    message: result.success
      ? `**Worktree removed** ✅\n${result.message}`
      : `**Failed** ❌\n${result.message}`,
    data: result.data,
  };
}

export async function worktreePrune(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
  const ws = requireWorkspace(ctx);
  const dryRun = args.trim().includes('--dry-run');
  const result = pruneWorktrees(ws, dryRun);

  return {
    success: result.success,
    message: `**Worktree Prune${dryRun ? ' (dry run)' : ''}**\n\n${result.message}`,
    data: result.data,
  };
}

export async function worktreeRepair(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
  const ws = requireWorkspace(ctx);
  const targetPath = args.trim() || undefined;
  const result = repairWorktrees(ws, targetPath ? resolve(ws, targetPath) : undefined);

  return {
    success: result.success,
    message: `**Worktree Repair**\n\n${result.message}`,
    data: result.data,
  };
}

export async function worktreeLock(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
  const ws = requireWorkspace(ctx);
  const parts = args.trim().split(/\s+/);

  if (parts.length === 0 || !parts[0]) {
    return { success: true, message: '**Usage:** `/worktree-lock <path> [reason]`' };
  }

  const path = parts[0];
  const reason = parts.slice(1).join(' ') || undefined;
  const result = lockWorktree(ws, resolve(ws, path), reason);

  return {
    success: result.success,
    message: result.success
      ? `**Worktree locked** 🔒\n${result.message}`
      : `**Failed** ❌\n${result.message}`,
    data: result.data,
  };
}

export async function worktreeUnlock(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
  const ws = requireWorkspace(ctx);
  const path = args.trim();

  if (!path) {
    return { success: true, message: '**Usage:** `/worktree-unlock <path>`' };
  }

  const result = unlockWorktree(ws, resolve(ws, path));

  return {
    success: result.success,
    message: result.success
      ? `**Worktree unlocked** 🔓\n${result.message}`
      : `**Failed** ❌\n${result.message}`,
    data: result.data,
  };
}

export async function compareWorktreesCmd(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
  const ws = requireWorkspace(ctx);
  const parts = args.trim().split(/\s+/);

  if (parts.length < 2) {
    return { success: true, message: '**Usage:** `/compare-worktrees <path1> <path2>`' };
  }

  const pathA = resolve(ws, parts[0]);
  const pathB = resolve(ws, parts[1]);
  const result = compareWorktrees(ws, pathA, pathB);

  if (!result) {
    return { success: false, message: 'Could not find both worktrees. Are they registered worktrees of this repo?' };
  }

  const lines = [
    '## Worktree Comparison',
    '',
    `**A:** \`${result.worktreeA.path}\` (${result.worktreeA.branch || 'detached'} @ ${result.worktreeA.head.substring(0, 7)})`,
    `**B:** \`${result.worktreeB.path}\` (${result.worktreeB.branch || 'detached'} @ ${result.worktreeB.head.substring(0, 7)})`,
    '',
    `**Common ancestor:** ${result.commonAncestor ? `\`${result.commonAncestor.substring(0, 7)}\`` : 'none'}`,
    `**A ahead of B:** ${result.aAheadOfB} commit(s)`,
    `**B ahead of A:** ${result.bAheadOfA} commit(s)`,
    '',
    result.diffStat ? `**Diff stat:**\n\`\`\`\n${result.diffStat}\n\`\`\`` : '**No diff** — trees are identical.',
  ];

  return {
    success: true,
    message: lines.join('\n'),
    data: result,
  };
}

export async function worktreeIsolate(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
  const ws = requireWorkspace(ctx);
  const description = args.trim();

  if (!description) {
    return {
      success: true,
      message: '**Usage:** `/worktree-isolate <task description>`\n\nCreates an isolated worktree for the described task.\nUse `--temporary` or `--permanent` to control lifecycle (default: temporary).',
    };
  }

  const isPermanent = description.includes('--permanent');
  const cleanDesc = description.replace('--permanent', '').replace('--temporary', '').trim();

  const result = createTaskWorktree({
    repoPath: ws,
    taskDescription: cleanDesc,
    sessionId: ctx.sessionId,
    lifecycle: isPermanent ? 'permanent' : 'temporary',
  });

  const warnings = result.warnings?.length ? `\n\n**Warnings:**\n${result.warnings.join('\n')}` : '';

  return {
    success: result.success,
    message: result.success
      ? `**Task Worktree Created** 🔬\n\n${result.message}${warnings}`
      : `**Failed** ❌\n\n${result.message}${warnings}`,
    data: result.data,
  };
}

export async function worktreeHandoff(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
  const ws = requireWorkspace(ctx);
  const parts = args.trim().split(/\s+/);
  const worktreePath = parts[0] ? resolve(ws, parts[0]) : ws;
  const targetBranch = parts[1] || 'main';

  const result = getHandoffInfo(ws, worktreePath, targetBranch);

  return {
    success: result.success,
    message: result.success
      ? `## Handoff Information\n\n${result.message}${result.diffStat ? `\n\n**Changes:**\n\`\`\`\n${result.diffStat}\n\`\`\`` : ''}`
      : `**Handoff failed** ❌\n\n${result.message}`,
    data: result,
  };
}
