/**
 * Managed Workspace Root & Safe Move — Sprint 13
 * Provides safe workspace migration with integrity verification.
 */

import { existsSync, mkdirSync, cpSync, rmSync, readdirSync, statSync } from 'fs';
import { join, resolve, basename } from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { getDatabase } from '../db';
import { setActiveWorkspace, getActiveWorkspace } from '../tools';

const DEFAULT_MANAGED_ROOT_SUFFIX = 'GDeveloper/Workspaces';

/**
 * Get managed workspace root.
 * Default: ~/Documents/GDeveloper/Workspaces (Windows) or ~/GDeveloper/Workspaces
 */
export function getManagedRoot(): string {
  const db = getDatabase();
  const saved = db.getSetting('managed_workspace_root');
  if (saved) return saved;

  const home = process.env.HOME || process.env.USERPROFILE || '';
  const docsDir = join(home, 'Documents');
  const defaultRoot = existsSync(docsDir)
    ? join(docsDir, DEFAULT_MANAGED_ROOT_SUFFIX)
    : join(home, DEFAULT_MANAGED_ROOT_SUFFIX);

  return defaultRoot;
}

export function setManagedRoot(path: string): void {
  const db = getDatabase();
  db.setSetting('managed_workspace_root', path);
}

/** Ensure managed root directory exists */
export function ensureManagedRoot(): string {
  const root = getManagedRoot();
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  return root;
}

export interface MoveResult {
  success: boolean;
  message: string;
  newPath?: string;
  error?: string;
}

/**
 * Safely move a workspace to a new location.
 * Steps:
 * 1. Validate source
 * 2. Copy to destination
 * 3. Verify git integrity at destination
 * 4. Update DB registry
 * 5. Optionally remove source only after verification
 */
export async function moveWorkspace(
  workspaceId: string,
  destinationDir: string,
  deleteOriginal: boolean = false
): Promise<MoveResult> {
  const db = getDatabase();
  const ws = db.getWorkspace(workspaceId);
  if (!ws) return { success: false, message: 'Workspace not found', error: 'NOT_FOUND' };

  const sourcePath = resolve(ws.local_path);
  if (!existsSync(sourcePath)) {
    return { success: false, message: `Source path does not exist: ${sourcePath}`, error: 'SOURCE_MISSING' };
  }

  const destPath = resolve(destinationDir, basename(sourcePath));
  if (existsSync(destPath)) {
    return { success: false, message: `Destination already exists: ${destPath}`, error: 'DEST_EXISTS' };
  }

  db.logActivity('system', 'workspace_move_started', `Moving: ${ws.name}`, `${sourcePath} -> ${destPath}`, {
    workspaceId, source: sourcePath, dest: destPath
  });

  try {
    // Step 1: Snapshot source git state for verification
    let sourceCommit = '';
    let sourceBranch = '';
    let sourceRemoteUrl = '';
    try {
      const srcGit: SimpleGit = simpleGit(sourcePath);
      const srcLog = await srcGit.log({ maxCount: 1 });
      sourceCommit = srcLog.latest?.hash || '';
      const srcStatus = await srcGit.status();
      sourceBranch = srcStatus.current || '';
      const remotes = await srcGit.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      sourceRemoteUrl = origin?.refs?.fetch || '';
    } catch {
      // Non-git directories can still be moved
    }

    // Step 2: Copy
    mkdirSync(destPath, { recursive: true });
    cpSync(sourcePath, destPath, { recursive: true, force: true });

    // Step 3: Verify git integrity at destination
    if (sourceCommit) {
      try {
        const destGit: SimpleGit = simpleGit(destPath);
        const isRepo = await destGit.checkIsRepo();
        if (!isRepo) throw new Error('Destination is not a valid git repo after copy');

        const destLog = await destGit.log({ maxCount: 1 });
        const destCommit = destLog.latest?.hash || '';
        if (destCommit !== sourceCommit) {
          throw new Error(`Commit hash mismatch: src=${sourceCommit.substring(0, 7)} dst=${destCommit.substring(0, 7)}`);
        }

        const destStatus = await destGit.status();
        if (destStatus.current !== sourceBranch) {
          throw new Error(`Branch mismatch: src=${sourceBranch} dst=${destStatus.current}`);
        }

        const destRemotes = await destGit.getRemotes(true);
        const destOrigin = destRemotes.find(r => r.name === 'origin');
        if (sourceRemoteUrl && destOrigin?.refs?.fetch !== sourceRemoteUrl) {
          throw new Error('Remote URL mismatch after copy');
        }
      } catch (verifyErr) {
        // Rollback: remove destination
        try { rmSync(destPath, { recursive: true, force: true }); } catch {}
        const errMsg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
        db.logActivity('system', 'workspace_move_failed', `Move failed: ${ws.name}`, errMsg, {
          workspaceId, error: errMsg
        }, 'error');
        return { success: false, message: `Verification failed: ${errMsg}`, error: 'VERIFY_FAIL' };
      }
    }

    // Step 4: Update DB
    db.updateWorkspacePath(workspaceId, destPath);

    // Update active workspace if this is the active one
    if (getActiveWorkspace() === sourcePath) {
      setActiveWorkspace(destPath);
    }

    // Step 5: Optionally delete original
    if (deleteOriginal) {
      try {
        rmSync(sourcePath, { recursive: true, force: true });
      } catch (delErr) {
        // Not fatal — the move succeeded, just couldn't delete original
        db.logActivity('system', 'workspace_move_cleanup_warn', `Could not delete original: ${sourcePath}`,
          delErr instanceof Error ? delErr.message : String(delErr));
      }
    }

    db.logActivity('system', 'workspace_move_succeeded', `Moved: ${ws.name}`, `${sourcePath} -> ${destPath}`, {
      workspaceId, oldPath: sourcePath, newPath: destPath, deleteOriginal
    });

    return { success: true, message: `Workspace moved to: ${destPath}`, newPath: destPath };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    db.logActivity('system', 'workspace_move_failed', `Move failed: ${ws.name}`, errMsg, {
      workspaceId, error: errMsg
    }, 'error');

    // Cleanup on failure
    try { if (existsSync(destPath)) rmSync(destPath, { recursive: true, force: true }); } catch {}

    return { success: false, message: `Move failed: ${errMsg}`, error: errMsg };
  }
}

/** Move workspace to the managed root */
export async function moveToManagedRoot(
  workspaceId: string,
  deleteOriginal: boolean = false
): Promise<MoveResult> {
  const root = ensureManagedRoot();
  return moveWorkspace(workspaceId, root, deleteOriginal);
}
