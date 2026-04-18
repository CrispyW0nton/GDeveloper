/**
 * Git Worktree Engine — Sprint 17
 * Full worktree lifecycle management: list, add, remove, prune, repair, lock, unlock, move.
 * Uses `git worktree list --porcelain` for reliable machine-readable output.
 * Handles main vs linked worktrees, detached HEAD, locked state, missing dirs, submodules.
 */

import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve, basename, normalize } from 'path';

// ─── Types ───

export interface WorktreeInfo {
  path: string;
  head: string;           // commit SHA
  branch: string | null;  // null if detached HEAD
  isMain: boolean;
  isLinked: boolean;
  isBare: boolean;
  isDetached: boolean;
  locked: boolean;
  lockReason: string;
  prunable: boolean;
  prunableReason: string;
  dirty: boolean;
  aheadBehind: { ahead: number; behind: number } | null;
  missing: boolean;       // directory doesn't exist
  hasSubmodules: boolean;
}

export interface WorktreeAddOptions {
  path: string;
  branchOrCommit?: string;
  newBranch?: boolean;       // create a new branch
  detach?: boolean;          // use detached HEAD
  force?: boolean;           // force even if branch is checked out elsewhere
  track?: string;            // track a remote branch
}

export interface WorktreeRemoveOptions {
  path: string;
  force?: boolean;
}

export interface WorktreeMoveOptions {
  from: string;
  to: string;
}

export interface WorktreeResult {
  success: boolean;
  message: string;
  data?: any;
  warnings?: string[];
}

export interface WorktreeCompareResult {
  worktreeA: { path: string; branch: string | null; head: string };
  worktreeB: { path: string; branch: string | null; head: string };
  commonAncestor: string | null;
  aAheadOfB: number;
  bAheadOfA: number;
  diffStat: string;
}

// ─── Helpers ───

function quotePath(p: string): string {
  // Windows-safe quoting for paths with spaces
  return `"${p.replace(/"/g, '\\"')}"`;
}

function execGit(args: string, cwd: string, timeout = 15000): string {
  const opts: ExecSyncOptionsWithStringEncoding = {
    cwd,
    encoding: 'utf-8',
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    // Use bash on unix, cmd on windows; git should be on PATH
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
  };
  return execSync(`git ${args}`, opts).trim();
}

function execGitSafe(args: string, cwd: string, timeout = 15000): { stdout: string; exitCode: number } {
  try {
    const stdout = execGit(args, cwd, timeout);
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout || err.stderr || '', exitCode: err.status ?? 1 };
  }
}

/**
 * Resolve the actual git directory (works for both main and linked worktrees).
 * In a linked worktree, .git is a file containing "gitdir: <path>".
 */
function resolveGitDir(worktreePath: string): string | null {
  const gitPath = join(worktreePath, '.git');
  if (!existsSync(gitPath)) return null;

  const stat = statSync(gitPath);
  if (stat.isDirectory()) {
    return gitPath;
  }
  // It's a file — linked worktree
  try {
    const content = readFileSync(gitPath, 'utf-8').trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (match) {
      const gitDir = resolve(worktreePath, match[1]);
      return existsSync(gitDir) ? gitDir : null;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Find the main repository root from any worktree path.
 */
export function findMainWorktreeRoot(worktreePath: string): string | null {
  try {
    // `git worktree list` always returns the main worktree first
    const result = execGit('rev-parse --git-common-dir', worktreePath);
    // The common dir is inside the main worktree's .git directory
    const commonDir = resolve(worktreePath, result);
    // Go up from .git to the repo root
    if (commonDir.endsWith('.git')) {
      return resolve(commonDir, '..');
    }
    // Could be bare repo
    return commonDir;
  } catch {
    return null;
  }
}

/**
 * Check if a given path is inside a git repo (works with linked worktree .git files too).
 */
export function isGitWorktree(path: string): boolean {
  try {
    execGit('rev-parse --is-inside-work-tree', path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect if submodules exist in a worktree.
 */
function hasSubmodules(worktreePath: string): boolean {
  return existsSync(join(worktreePath, '.gitmodules'));
}

// ─── Core API ───

/**
 * List all worktrees for the repository at `repoPath`.
 * Uses --porcelain for machine-readable output.
 */
export function listWorktrees(repoPath: string): WorktreeInfo[] {
  const result = execGitSafe('worktree list --porcelain', repoPath);
  if (result.exitCode !== 0) {
    // May not be in a git repo
    return [];
  }

  const worktrees: WorktreeInfo[] = [];
  const blocks = result.stdout.split('\n\n').filter(b => b.trim());

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l);
    let path = '';
    let head = '';
    let branch: string | null = null;
    let isDetached = false;
    let isBare = false;
    let locked = false;
    let lockReason = '';
    let prunable = false;
    let prunableReason = '';

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.substring('worktree '.length);
      } else if (line.startsWith('HEAD ')) {
        head = line.substring('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        branch = line.substring('branch '.length).replace(/^refs\/heads\//, '');
      } else if (line === 'detached') {
        isDetached = true;
      } else if (line === 'bare') {
        isBare = true;
      } else if (line === 'locked') {
        locked = true;
      } else if (line.startsWith('locked ')) {
        locked = true;
        lockReason = line.substring('locked '.length);
      } else if (line === 'prunable') {
        prunable = true;
      } else if (line.startsWith('prunable ')) {
        prunable = true;
        prunableReason = line.substring('prunable '.length);
      }
    }

    if (!path) continue;

    const normalizedPath = normalize(path);
    const dirExists = existsSync(normalizedPath);

    worktrees.push({
      path: normalizedPath,
      head,
      branch,
      isMain: worktrees.length === 0, // first entry is always the main worktree
      isLinked: worktrees.length > 0,
      isBare,
      isDetached,
      locked,
      lockReason,
      prunable,
      prunableReason,
      dirty: false, // populated below
      aheadBehind: null, // populated below
      missing: !dirExists,
      hasSubmodules: dirExists && hasSubmodules(normalizedPath),
    });
  }

  // Enrich with dirty/ahead-behind status (only for existing dirs)
  for (const wt of worktrees) {
    if (wt.missing || wt.isBare) continue;
    try {
      const statusOut = execGit('status --porcelain', wt.path, 5000);
      wt.dirty = statusOut.length > 0;
    } catch { /* ignore */ }

    if (wt.branch) {
      try {
        const abOut = execGitSafe(`rev-list --left-right --count HEAD...@{upstream}`, wt.path, 5000);
        if (abOut.exitCode === 0) {
          const [ahead, behind] = abOut.stdout.split(/\s+/).map(Number);
          wt.aheadBehind = { ahead: ahead || 0, behind: behind || 0 };
        }
      } catch { /* no upstream */ }
    }
  }

  return worktrees;
}

/**
 * Add a new worktree.
 */
export function addWorktree(repoPath: string, options: WorktreeAddOptions): WorktreeResult {
  const warnings: string[] = [];
  const targetPath = resolve(options.path);

  // Validate target doesn't already exist
  if (existsSync(targetPath)) {
    return { success: false, message: `Path already exists: ${targetPath}` };
  }

  // Check for submodules warning
  if (hasSubmodules(repoPath)) {
    warnings.push('⚠️ This repository has submodules. Git\'s support for multiple worktree checkouts of a superproject with submodules is incomplete. Submodule state may not be correct in the new worktree.');
  }

  let cmd = `worktree add`;

  if (options.force) cmd += ' --force';
  if (options.detach) cmd += ' --detach';

  cmd += ` ${quotePath(targetPath)}`;

  if (options.newBranch && options.branchOrCommit) {
    cmd += ` -b ${quotePath(options.branchOrCommit)}`;
    if (options.track) {
      cmd += ` ${quotePath(options.track)}`;
    }
  } else if (options.branchOrCommit) {
    cmd += ` ${quotePath(options.branchOrCommit)}`;
  }

  const result = execGitSafe(cmd, repoPath, 30000);

  if (result.exitCode !== 0) {
    const output = result.stdout;
    // Check for "already checked out" error
    if (output.includes('already checked out') || output.includes('is already checked out')) {
      const existingMatch = output.match(/worktree '([^']+)'/);
      const existingPath = existingMatch ? existingMatch[1] : 'another worktree';
      return {
        success: false,
        message: `Branch is already checked out in ${existingPath}.\n\nAlternatives:\n• Open the existing worktree\n• Create a new branch: /worktree-add <path> -b new-branch-name\n• Use detached HEAD: /worktree-add <path> --detach <commit>\n• Force (risky): /worktree-add <path> --force`,
        data: { conflict: 'branch_checked_out', existingPath },
        warnings,
      };
    }
    return { success: false, message: `Failed to create worktree: ${output}`, warnings };
  }

  return {
    success: true,
    message: `Worktree created at ${targetPath}${options.branchOrCommit ? ` (${options.branchOrCommit})` : ''}`,
    data: { path: targetPath, branch: options.branchOrCommit || null },
    warnings,
  };
}

/**
 * Remove a worktree.
 */
export function removeWorktree(repoPath: string, options: WorktreeRemoveOptions): WorktreeResult {
  const targetPath = resolve(options.path);

  // Check for dirty state before removing (unless forced)
  if (!options.force && existsSync(targetPath)) {
    const statusResult = execGitSafe('status --porcelain', targetPath, 5000);
    if (statusResult.exitCode === 0 && statusResult.stdout.trim()) {
      const fileCount = statusResult.stdout.trim().split('\n').length;
      return {
        success: false,
        message: `Worktree at ${targetPath} has ${fileCount} uncommitted/untracked file(s).\nUse --force to remove anyway, or commit/stash changes first.`,
        data: { dirty: true, fileCount },
      };
    }
  }

  let cmd = `worktree remove ${quotePath(targetPath)}`;
  if (options.force) cmd += ' --force';

  const result = execGitSafe(cmd, repoPath, 15000);

  if (result.exitCode !== 0) {
    return { success: false, message: `Failed to remove worktree: ${result.stdout}` };
  }

  return {
    success: true,
    message: `Worktree removed: ${targetPath}`,
    data: { path: targetPath },
  };
}

/**
 * Prune stale worktrees.
 */
export function pruneWorktrees(repoPath: string, dryRun = false): WorktreeResult {
  const cmd = dryRun ? 'worktree prune --dry-run -v' : 'worktree prune -v';
  const result = execGitSafe(cmd, repoPath);

  return {
    success: result.exitCode === 0,
    message: result.stdout || (dryRun ? 'No stale worktrees found (dry run).' : 'Prune completed.'),
    data: { dryRun },
  };
}

/**
 * Repair worktrees.
 */
export function repairWorktrees(repoPath: string, targetPath?: string): WorktreeResult {
  const cmd = targetPath ? `worktree repair ${quotePath(targetPath)}` : 'worktree repair';
  const result = execGitSafe(cmd, repoPath);

  return {
    success: result.exitCode === 0,
    message: result.stdout || 'Repair completed. No issues found.',
    data: { target: targetPath || 'all' },
  };
}

/**
 * Lock a worktree.
 */
export function lockWorktree(repoPath: string, targetPath: string, reason?: string): WorktreeResult {
  let cmd = `worktree lock ${quotePath(resolve(targetPath))}`;
  if (reason) cmd += ` --reason ${quotePath(reason)}`;

  const result = execGitSafe(cmd, repoPath);

  if (result.exitCode !== 0) {
    if (result.stdout.includes('already locked')) {
      return { success: false, message: `Worktree is already locked: ${targetPath}` };
    }
    return { success: false, message: `Failed to lock worktree: ${result.stdout}` };
  }

  return {
    success: true,
    message: `Worktree locked: ${targetPath}${reason ? ` (${reason})` : ''}`,
    data: { path: resolve(targetPath), reason },
  };
}

/**
 * Unlock a worktree.
 */
export function unlockWorktree(repoPath: string, targetPath: string): WorktreeResult {
  const cmd = `worktree unlock ${quotePath(resolve(targetPath))}`;
  const result = execGitSafe(cmd, repoPath);

  if (result.exitCode !== 0) {
    if (result.stdout.includes('not locked')) {
      return { success: false, message: `Worktree is not locked: ${targetPath}` };
    }
    return { success: false, message: `Failed to unlock worktree: ${result.stdout}` };
  }

  return {
    success: true,
    message: `Worktree unlocked: ${targetPath}`,
    data: { path: resolve(targetPath) },
  };
}

/**
 * Move a worktree to a new path.
 */
export function moveWorktree(repoPath: string, options: WorktreeMoveOptions): WorktreeResult {
  const fromPath = resolve(options.from);
  const toPath = resolve(options.to);

  if (existsSync(toPath)) {
    return { success: false, message: `Destination already exists: ${toPath}` };
  }

  const cmd = `worktree move ${quotePath(fromPath)} ${quotePath(toPath)}`;
  const result = execGitSafe(cmd, repoPath, 30000);

  if (result.exitCode !== 0) {
    if (result.stdout.includes('main working tree')) {
      return { success: false, message: 'Cannot move the main worktree.' };
    }
    return { success: false, message: `Failed to move worktree: ${result.stdout}` };
  }

  return {
    success: true,
    message: `Worktree moved: ${fromPath} → ${toPath}`,
    data: { from: fromPath, to: toPath },
  };
}

/**
 * Compare two worktrees.
 */
export function compareWorktrees(repoPath: string, pathA: string, pathB: string): WorktreeCompareResult | null {
  const worktrees = listWorktrees(repoPath);
  const wtA = worktrees.find(w => normalize(w.path) === normalize(resolve(pathA)));
  const wtB = worktrees.find(w => normalize(w.path) === normalize(resolve(pathB)));

  if (!wtA || !wtB) return null;

  let commonAncestor: string | null = null;
  let aAheadOfB = 0;
  let bAheadOfA = 0;
  let diffStat = '';

  try {
    commonAncestor = execGit(`merge-base ${wtA.head} ${wtB.head}`, repoPath);
  } catch { /* no common ancestor */ }

  try {
    const revList = execGit(`rev-list --left-right --count ${wtA.head}...${wtB.head}`, repoPath);
    const [ahead, behind] = revList.split(/\s+/).map(Number);
    aAheadOfB = ahead || 0;
    bAheadOfA = behind || 0;
  } catch { /* ignore */ }

  try {
    diffStat = execGit(`diff --stat ${wtA.head} ${wtB.head}`, repoPath, 10000);
  } catch { /* ignore */ }

  return {
    worktreeA: { path: wtA.path, branch: wtA.branch, head: wtA.head },
    worktreeB: { path: wtB.path, branch: wtB.branch, head: wtB.head },
    commonAncestor,
    aAheadOfB,
    bAheadOfA,
    diffStat,
  };
}

/**
 * Detect worktree context for a given path.
 * Returns whether it's main/linked, the branch, and the main worktree root.
 */
export function getWorktreeContext(path: string): {
  isWorktree: boolean;
  isMain: boolean;
  isLinked: boolean;
  branch: string | null;
  head: string;
  mainRoot: string | null;
  currentPath: string;
} | null {
  if (!isGitWorktree(path)) return null;

  try {
    const head = execGit('rev-parse HEAD', path);
    const mainRoot = findMainWorktreeRoot(path);

    // Check if this is the main worktree
    let isMain = false;
    try {
      const toplevel = execGit('rev-parse --show-toplevel', path);
      const gitDir = execGit('rev-parse --git-dir', path);
      // Main worktree has .git as a directory; linked has .git as a file
      isMain = !gitDir.includes('worktrees');
    } catch { /* ignore */ }

    // Get branch
    let branch: string | null = null;
    try {
      branch = execGit('symbolic-ref --short HEAD', path);
    } catch {
      // Detached HEAD — branch stays null
    }

    return {
      isWorktree: true,
      isMain,
      isLinked: !isMain,
      branch,
      head,
      mainRoot,
      currentPath: normalize(path),
    };
  } catch {
    return null;
  }
}

/**
 * Get a safe branch name for task isolation worktrees.
 */
export function generateTaskBranchName(taskDescription: string, prefix = 'ai-task'): string {
  const sanitized = taskDescription
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
  const ts = Date.now().toString(36);
  return `${prefix}/${sanitized}-${ts}`;
}

/**
 * Generate a default worktree path based on the repo root and branch name.
 */
export function generateWorktreePath(mainRoot: string, branchName: string): string {
  const safeName = branchName.replace(/\//g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
  return join(mainRoot, '..', `${basename(mainRoot)}-wt-${safeName}`);
}

/**
 * Check if a branch is already checked out in any worktree.
 */
export function isBranchCheckedOut(repoPath: string, branchName: string): { checkedOut: boolean; worktreePath: string | null } {
  const worktrees = listWorktrees(repoPath);
  const match = worktrees.find(wt => wt.branch === branchName || wt.branch === `refs/heads/${branchName}`);
  return {
    checkedOut: !!match,
    worktreePath: match?.path || null,
  };
}

/**
 * Get Windows long path and UNC warnings if applicable.
 */
export function getPathWarnings(targetPath: string): string[] {
  const warnings: string[] = [];
  if (process.platform === 'win32') {
    if (targetPath.length > 260) {
      warnings.push('⚠️ Path exceeds Windows MAX_PATH (260 chars). Enable long paths in your system settings or use a shorter path.');
    }
    if (targetPath.startsWith('\\\\')) {
      warnings.push('⚠️ UNC/network paths may have unreliable behavior with git worktrees. Use a local drive if possible.');
    }
    if (targetPath.includes(' ')) {
      warnings.push('ℹ️ Path contains spaces. This is usually fine, but some tools may have issues.');
    }
  }
  return warnings;
}
