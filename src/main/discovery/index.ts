/**
 * Repository Discovery — Sprint 13
 * Recursively scan a folder for Git repositories.
 * Returns metadata for each found repo.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, basename } from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { getDatabase } from '../db';

const SKIP_DIRS = new Set([
  'node_modules', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'target', '.git', '.hg', '.svn',
  '.worktrees', '.cache', '.tox', '.mypy_cache',
  '.pytest_cache', 'vendor', 'bower_components',
  'System Volume Information', '$RECYCLE.BIN',
]);

export interface DiscoveredRepo {
  name: string;
  path: string;
  remoteUrl: string;
  branch: string;
  isClean: boolean;
  alreadyManaged: boolean;
  /** number of modified + untracked files */
  dirtyCount: number;
}

export interface ScanProgress {
  scanned: number;
  found: number;
  currentDir: string;
}

/**
 * Recursively scan `rootPath` for git repositories up to `maxDepth`.
 * Invokes `onProgress` periodically.
 */
export async function scanForRepositories(
  rootPath: string,
  maxDepth: number = 5,
  onProgress?: (p: ScanProgress) => void
): Promise<DiscoveredRepo[]> {
  const absRoot = resolve(rootPath);
  if (!existsSync(absRoot)) throw new Error(`Path does not exist: ${rootPath}`);

  const db = getDatabase();
  db.logActivity('system', 'repo_scan_started', `Scanning: ${absRoot}`, '', { rootPath: absRoot, maxDepth });

  // Gather existing workspace paths for duplicate detection
  const existingWorkspaces = db.getWorkspaces();
  const managedPaths = new Set(existingWorkspaces.map((ws: any) => resolve(ws.local_path).toLowerCase()));

  const repos: DiscoveredRepo[] = [];
  let scanned = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    scanned++;
    if (onProgress && scanned % 20 === 0) {
      onProgress({ scanned, found: repos.length, currentDir: dir });
    }

    // Check if this directory IS a git repo (.git exists)
    const dotGit = join(dir, '.git');
    let hasDotGit = false;
    try {
      hasDotGit = existsSync(dotGit) && statSync(dotGit).isDirectory();
    } catch { /* permission error, skip */ }

    if (hasDotGit) {
      try {
        const git: SimpleGit = simpleGit(dir);
        const status = await git.status();
        const remotes = await git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');

        repos.push({
          name: basename(dir),
          path: dir,
          remoteUrl: origin?.refs?.fetch || '',
          branch: status.current || '(detached)',
          isClean: status.isClean(),
          dirtyCount: status.modified.length + status.not_added.length,
          alreadyManaged: managedPaths.has(resolve(dir).toLowerCase()),
        });
      } catch {
        // Not a valid git repo despite having .git dir
      }
      // Don't recurse into git repos (they're leaf nodes)
      return;
    }

    // Recurse into subdirectories
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // permission denied
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
      const fullPath = join(dir, entry);
      try {
        const st = statSync(fullPath);
        if (st.isDirectory()) {
          await walk(fullPath, depth + 1);
        }
      } catch { /* skip */ }
    }
  }

  await walk(absRoot, 0);

  db.logActivity('system', 'repo_scan_completed', `Scan complete: found ${repos.length} repos in ${scanned} dirs`, '', {
    rootPath: absRoot, found: repos.length, scanned
  });

  return repos;
}

/**
 * Import selected discovered repos into the workspace registry.
 * De-duplicates by canonical path.
 */
export async function importDiscoveredRepos(
  repos: DiscoveredRepo[]
): Promise<{ imported: number; skipped: number }> {
  const db = getDatabase();
  const existingWorkspaces = db.getWorkspaces();
  const managedPaths = new Set(existingWorkspaces.map((ws: any) => resolve(ws.local_path).toLowerCase()));

  let imported = 0;
  let skipped = 0;

  for (const repo of repos) {
    const canonical = resolve(repo.path).toLowerCase();
    if (managedPaths.has(canonical)) {
      skipped++;
      continue;
    }

    // Parse GitHub owner/repo from remote URL
    let ghOwner = '';
    let ghRepo = '';
    const ghMatch = repo.remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (ghMatch) {
      ghOwner = ghMatch[1];
      ghRepo = ghMatch[2];
    }

    db.saveWorkspace({
      name: repo.name,
      local_path: repo.path,
      remote_url: repo.remoteUrl,
      github_owner: ghOwner,
      github_repo: ghRepo,
      default_branch: repo.branch,
      status: 'active',
    });

    managedPaths.add(canonical);
    imported++;

    db.logActivity('system', 'workspace_imported', `Imported: ${repo.name}`, repo.path, {
      remoteUrl: repo.remoteUrl, branch: repo.branch
    });
  }

  return { imported, skipped };
}
