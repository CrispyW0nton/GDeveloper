/**
 * AI Task Isolation via Worktrees — Sprint 17
 * Creates and manages dedicated worktrees for AI tasks.
 * Supports temporary task worktrees, permanent user-managed worktrees,
 * naming conventions, detached HEAD, branch creation, and handoff.
 */

import { resolve, join, basename } from 'path';
import { existsSync } from 'fs';
import {
  listWorktrees, addWorktree, removeWorktree, getWorktreeContext,
  generateTaskBranchName, generateWorktreePath, isBranchCheckedOut,
  getPathWarnings, WorktreeInfo, WorktreeResult,
} from '../git/worktree';

// ─── Types ───

export interface TaskWorktreeRequest {
  repoPath: string;
  taskDescription: string;
  sessionId: string;
  /** 'temporary' will auto-cleanup; 'permanent' stays until user removes */
  lifecycle: 'temporary' | 'permanent';
  /** Start from a specific branch or commit */
  baseBranch?: string;
  /** Use detached HEAD instead of creating a branch */
  detached?: boolean;
  /** Custom path override */
  customPath?: string;
  /** Custom branch name override */
  customBranch?: string;
}

export interface TaskWorktree {
  id: string;
  worktreePath: string;
  branchName: string | null;
  baseBranch: string | null;
  taskDescription: string;
  sessionId: string;
  lifecycle: 'temporary' | 'permanent';
  createdAt: string;
  status: 'active' | 'completed' | 'abandoned';
}

export interface HandoffResult {
  success: boolean;
  message: string;
  mergeCommand?: string;
  cherryPickCommand?: string;
  diffStat?: string;
}

// ─── In-memory registry (persisted to activity log) ───
const taskWorktrees = new Map<string, TaskWorktree>();

// ─── Core API ───

/**
 * Create an isolated worktree for an AI task.
 */
export function createTaskWorktree(request: TaskWorktreeRequest): WorktreeResult & { taskWorktree?: TaskWorktree } {
  const warnings: string[] = [];

  // Generate branch name and path
  const branchName = request.customBranch || generateTaskBranchName(request.taskDescription);
  const worktreePath = request.customPath || generateWorktreePath(request.repoPath, branchName);

  // Check path warnings
  warnings.push(...getPathWarnings(worktreePath));

  // Check if branch already exists
  if (!request.detached) {
    const branchCheck = isBranchCheckedOut(request.repoPath, branchName);
    if (branchCheck.checkedOut) {
      return {
        success: false,
        message: `Branch "${branchName}" is already checked out at ${branchCheck.worktreePath}`,
        warnings,
      };
    }
  }

  // Create the worktree
  const result = addWorktree(request.repoPath, {
    path: worktreePath,
    branchOrCommit: request.detached ? (request.baseBranch || 'HEAD') : branchName,
    newBranch: !request.detached,
    detach: request.detached,
    track: request.baseBranch || undefined,
  });

  if (!result.success) {
    return { ...result, warnings: [...(result.warnings || []), ...warnings] };
  }

  // Register the task worktree
  const taskId = `tw-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const taskWt: TaskWorktree = {
    id: taskId,
    worktreePath,
    branchName: request.detached ? null : branchName,
    baseBranch: request.baseBranch || null,
    taskDescription: request.taskDescription,
    sessionId: request.sessionId,
    lifecycle: request.lifecycle,
    createdAt: new Date().toISOString(),
    status: 'active',
  };

  taskWorktrees.set(taskId, taskWt);

  return {
    success: true,
    message: `Task worktree created:\n• Path: ${worktreePath}\n• Branch: ${request.detached ? `(detached at ${request.baseBranch || 'HEAD'})` : branchName}\n• Task: ${request.taskDescription}\n• Lifecycle: ${request.lifecycle}`,
    data: { taskId, worktreePath, branchName },
    warnings,
    taskWorktree: taskWt,
  };
}

/**
 * Complete a task worktree (mark as done, optionally clean up temporary ones).
 */
export function completeTaskWorktree(taskId: string, repoPath: string): WorktreeResult {
  const tw = taskWorktrees.get(taskId);
  if (!tw) {
    return { success: false, message: `Task worktree not found: ${taskId}` };
  }

  tw.status = 'completed';

  if (tw.lifecycle === 'temporary') {
    // Auto-cleanup: remove the worktree
    const removeResult = removeWorktree(repoPath, { path: tw.worktreePath, force: false });
    if (!removeResult.success) {
      return {
        success: false,
        message: `Task marked complete, but cleanup failed: ${removeResult.message}\nYou can manually remove it with /worktree-remove ${tw.worktreePath}`,
      };
    }
    taskWorktrees.delete(taskId);
    return {
      success: true,
      message: `Task worktree completed and cleaned up: ${tw.worktreePath}`,
    };
  }

  return {
    success: true,
    message: `Task worktree marked complete (permanent): ${tw.worktreePath}\nBranch "${tw.branchName}" is ready for merge/handoff.`,
  };
}

/**
 * Abandon a task worktree (force cleanup).
 */
export function abandonTaskWorktree(taskId: string, repoPath: string): WorktreeResult {
  const tw = taskWorktrees.get(taskId);
  if (!tw) {
    return { success: false, message: `Task worktree not found: ${taskId}` };
  }

  tw.status = 'abandoned';
  const removeResult = removeWorktree(repoPath, { path: tw.worktreePath, force: true });
  taskWorktrees.delete(taskId);

  return {
    success: removeResult.success,
    message: removeResult.success
      ? `Task worktree abandoned and removed: ${tw.worktreePath}`
      : `Task abandoned, but removal failed: ${removeResult.message}`,
  };
}

/**
 * Get handoff info for bringing work back to main.
 */
export function getHandoffInfo(repoPath: string, worktreePath: string, targetBranch = 'main'): HandoffResult {
  const context = getWorktreeContext(worktreePath);
  if (!context) {
    return { success: false, message: `Not a valid worktree: ${worktreePath}` };
  }

  const branch = context.branch;
  if (!branch) {
    return {
      success: false,
      message: 'Worktree is in detached HEAD state. You need to create a branch first to hand off:\n`git checkout -b my-branch`',
    };
  }

  // Check target branch exists
  let diffStat = '';
  try {
    const { execSync } = require('child_process');
    diffStat = execSync(`git diff --stat ${targetBranch}...${branch}`, {
      cwd: repoPath, encoding: 'utf-8', timeout: 10000,
    }).trim();
  } catch { /* ignore */ }

  return {
    success: true,
    message: `Handoff ready:\n• Source: ${branch} (${worktreePath})\n• Target: ${targetBranch}\n\nTo merge: \`git checkout ${targetBranch} && git merge ${branch}\`\nTo cherry-pick: \`git cherry-pick ${context.head}\``,
    mergeCommand: `git checkout ${targetBranch} && git merge ${branch}`,
    cherryPickCommand: `git cherry-pick ${context.head}`,
    diffStat,
  };
}

/**
 * List all registered task worktrees.
 */
export function getTaskWorktrees(): TaskWorktree[] {
  return Array.from(taskWorktrees.values());
}

/**
 * Get a single task worktree by ID.
 */
export function getTaskWorktree(taskId: string): TaskWorktree | undefined {
  return taskWorktrees.get(taskId);
}

/**
 * Recommend whether a task should use an isolated worktree.
 */
export function shouldRecommendWorktree(taskDescription: string, currentDirty: boolean): {
  recommend: boolean;
  reason: string;
} {
  const lower = taskDescription.toLowerCase();

  // Keywords suggesting isolation is beneficial
  const riskyKeywords = ['refactor', 'rewrite', 'migration', 'breaking', 'experiment', 'prototype', 'major', 'overhaul', 'restructure', 'replace'];
  const parallelKeywords = ['background', 'parallel', 'meanwhile', 'side task', 'separate', 'isolate'];
  const longRunningKeywords = ['long-running', 'extended', 'multi-step', 'complex', 'large-scale'];

  const isRisky = riskyKeywords.some(k => lower.includes(k));
  const isParallel = parallelKeywords.some(k => lower.includes(k));
  const isLongRunning = longRunningKeywords.some(k => lower.includes(k));

  if (isRisky) {
    return { recommend: true, reason: 'This task involves risky changes. An isolated worktree protects your main branch.' };
  }
  if (isParallel) {
    return { recommend: true, reason: 'This task can run in parallel. A worktree avoids stash/switch overhead.' };
  }
  if (isLongRunning) {
    return { recommend: true, reason: 'This is a long-running task. A worktree lets you continue other work on main.' };
  }
  if (currentDirty) {
    return { recommend: true, reason: 'Your working tree has uncommitted changes. A worktree avoids conflicts.' };
  }

  return { recommend: false, reason: '' };
}
