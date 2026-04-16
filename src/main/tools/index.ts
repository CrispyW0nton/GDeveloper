/**
 * Local Coding Tools — Real Implementations
 * All file tools resolve relative to active workspace root.
 * Refuse operations outside workspace boundary.
 * Log every operation to activity via DB.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative, isAbsolute, dirname, sep } from 'path';
import { execSync } from 'child_process';
import simpleGit, { SimpleGit } from 'simple-git';
import { getDatabase } from '../db';

// ─── Workspace State ───

let activeWorkspacePath: string | null = null;

export function setActiveWorkspace(path: string | null): void {
  activeWorkspacePath = path;
  console.log(`[Tools] Active workspace set to: ${path || '(none)'}`);
}

export function getActiveWorkspace(): string | null {
  return activeWorkspacePath;
}

// ─── Path Security ───

function resolveSafe(workspacePath: string, filePath: string): string {
  const base = resolve(workspacePath);
  const target = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(base, filePath);

  // Ensure resolved path is within workspace
  if (!target.startsWith(base + sep) && target !== base) {
    throw new Error(`Access denied: path "${filePath}" resolves outside workspace boundary`);
  }
  return target;
}

function requireWorkspace(): string {
  if (!activeWorkspacePath || !existsSync(activeWorkspacePath)) {
    throw new Error('No active workspace. Clone or open a repository first.');
  }
  return activeWorkspacePath;
}

// ─── Tool Definitions for Claude (Anthropic format) ───

export interface LocalToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export const LOCAL_TOOL_DEFINITIONS: LocalToolDef[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file from the workspace. Returns the file content as text.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace. Creates the file (and parent directories) if it does not exist, overwrites if it does.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
        content: { type: 'string', description: 'Content to write to the file' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'patch_file',
    description: 'Search and replace text in a file. Finds the first occurrence of `search` and replaces it with `replace`.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
        search: { type: 'string', description: 'Text to find in the file' },
        replace: { type: 'string', description: 'Replacement text' }
      },
      required: ['path', 'search', 'replace']
    }
  },
  {
    name: 'list_files',
    description: 'List files and directories in a directory. Returns names with trailing / for directories.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to workspace root (default: ".")' },
        recursive: { type: 'boolean', description: 'If true, list files recursively (max 500 entries)' }
      },
      required: []
    }
  },
  {
    name: 'search_files',
    description: 'Search for text across files in the workspace using grep. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or regex pattern to search for' },
        path: { type: 'string', description: 'Subdirectory to search within (default: ".")' },
        include: { type: 'string', description: 'File glob pattern to filter (e.g., "*.ts")' }
      },
      required: ['query']
    }
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the workspace directory. Returns stdout, stderr, and exit code. Timeout: 30 seconds.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory relative to workspace (default: workspace root)' }
      },
      required: ['command']
    }
  },
  {
    name: 'git_status',
    description: 'Get the git status of the workspace: current branch, staged/unstaged/untracked files, ahead/behind counts.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'git_diff',
    description: 'Get the git diff of the workspace. Shows changes between working tree and index (or staged changes).',
    input_schema: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: 'If true, show staged changes (--cached). Default: false (working tree changes).' }
      },
      required: []
    }
  },
  {
    name: 'git_log',
    description: 'Get recent git log entries.',
    input_schema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of log entries (default: 10, max: 50)' }
      },
      required: []
    }
  },
  {
    name: 'git_create_branch',
    description: 'Create a new git branch and switch to it.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Branch name to create' }
      },
      required: ['name']
    }
  },
  {
    name: 'git_commit',
    description: 'Stage all changes and create a commit.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' }
      },
      required: ['message']
    }
  }
];

// ─── Tool Executor ───

export async function executeLocalTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const ws = requireWorkspace();

  try {
    let result: string;

    switch (name) {
      case 'read_file':
        result = toolReadFile(ws, args);
        break;
      case 'write_file':
        result = toolWriteFile(ws, args);
        break;
      case 'patch_file':
        result = toolPatchFile(ws, args);
        break;
      case 'list_files':
        result = toolListFiles(ws, args);
        break;
      case 'search_files':
        result = toolSearchFiles(ws, args);
        break;
      case 'run_command':
        result = toolRunCommand(ws, args);
        break;
      case 'git_status':
        result = await toolGitStatus(ws);
        break;
      case 'git_diff':
        result = await toolGitDiff(ws, args);
        break;
      case 'git_log':
        result = await toolGitLog(ws, args);
        break;
      case 'git_create_branch':
        result = await toolGitCreateBranch(ws, args);
        break;
      case 'git_commit':
        result = await toolGitCommit(ws, args);
        break;
      default:
        throw new Error(`Unknown local tool: ${name}`);
    }

    // Log to activity
    try {
      const db = getDatabase();
      db.logActivity('system', 'tool_execute', `Tool: ${name}`, result.substring(0, 200), {
        toolName: name,
        source: 'local',
        success: true
      });
    } catch { /* ignore logging errors */ }

    return { content: [{ type: 'text', text: result }] };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    try {
      const db = getDatabase();
      db.logActivity('system', 'tool_error', `Tool failed: ${name}`, errMsg, {
        toolName: name,
        source: 'local'
      }, 'error');
    } catch { /* ignore */ }

    return { content: [{ type: 'text', text: `Error: ${errMsg}` }] };
  }
}

// ─── Individual Tool Implementations ───

function toolReadFile(ws: string, args: Record<string, unknown>): string {
  const filePath = String(args.path || '');
  if (!filePath) throw new Error('path is required');

  const absPath = resolveSafe(ws, filePath);
  if (!existsSync(absPath)) throw new Error(`File not found: ${filePath}`);

  const stat = statSync(absPath);
  if (stat.isDirectory()) throw new Error(`Path is a directory: ${filePath}`);
  if (stat.size > 1024 * 1024) throw new Error(`File too large (${(stat.size / 1024).toFixed(0)} KB). Max: 1 MB.`);

  const content = readFileSync(absPath, 'utf-8');
  return content;
}

function toolWriteFile(ws: string, args: Record<string, unknown>): string {
  const filePath = String(args.path || '');
  const content = String(args.content ?? '');
  if (!filePath) throw new Error('path is required');

  const absPath = resolveSafe(ws, filePath);
  const dir = dirname(absPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const existed = existsSync(absPath);
  // Store old content for diff
  const oldContent = existed ? readFileSync(absPath, 'utf-8') : '';

  writeFileSync(absPath, content, 'utf-8');

  // Record diff
  try {
    const db = getDatabase();
    db.addDiff('system', null, filePath, oldContent, content);
  } catch { /* ignore */ }

  const bytes = Buffer.byteLength(content, 'utf-8');
  return `${existed ? 'Updated' : 'Created'} ${filePath} (${bytes} bytes)`;
}

function toolPatchFile(ws: string, args: Record<string, unknown>): string {
  const filePath = String(args.path || '');
  const search = String(args.search || '');
  const replace = String(args.replace ?? '');
  if (!filePath || !search) throw new Error('path and search are required');

  const absPath = resolveSafe(ws, filePath);
  if (!existsSync(absPath)) throw new Error(`File not found: ${filePath}`);

  const oldContent = readFileSync(absPath, 'utf-8');
  if (!oldContent.includes(search)) {
    throw new Error(`Search text not found in ${filePath}. Provide exact text including whitespace.`);
  }

  const newContent = oldContent.replace(search, replace);
  writeFileSync(absPath, newContent, 'utf-8');

  // Record diff
  try {
    const db = getDatabase();
    db.addDiff('system', null, filePath, oldContent, newContent);
  } catch { /* ignore */ }

  return `Patched ${filePath}: replaced ${search.length} chars with ${replace.length} chars`;
}

function toolListFiles(ws: string, args: Record<string, unknown>): string {
  const dirPath = String(args.path || '.');
  const recursive = Boolean(args.recursive);
  const absDir = resolveSafe(ws, dirPath);

  if (!existsSync(absDir)) throw new Error(`Directory not found: ${dirPath}`);
  if (!statSync(absDir).isDirectory()) throw new Error(`Not a directory: ${dirPath}`);

  const entries: string[] = [];
  const maxEntries = 500;

  function walk(dir: string, prefix: string): void {
    if (entries.length >= maxEntries) return;
    const items = readdirSync(dir);
    for (const item of items) {
      if (entries.length >= maxEntries) break;
      if (item === '.git' || item === 'node_modules' || item === '.worktrees') continue;

      const fullPath = join(dir, item);
      const relPath = prefix ? `${prefix}/${item}` : item;
      try {
        const s = statSync(fullPath);
        if (s.isDirectory()) {
          entries.push(`${relPath}/`);
          if (recursive) walk(fullPath, relPath);
        } else {
          entries.push(relPath);
        }
      } catch { /* skip inaccessible */ }
    }
  }

  walk(absDir, '');
  const truncated = entries.length >= maxEntries ? `\n... (truncated at ${maxEntries} entries)` : '';
  return entries.join('\n') + truncated;
}

function toolSearchFiles(ws: string, args: Record<string, unknown>): string {
  const query = String(args.query || '');
  const searchPath = String(args.path || '.');
  const include = args.include ? String(args.include) : '';
  if (!query) throw new Error('query is required');

  const absDir = resolveSafe(ws, searchPath);
  if (!existsSync(absDir)) throw new Error(`Directory not found: ${searchPath}`);

  try {
    let cmd = `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.json" --include="*.md" --include="*.css" --include="*.html"`;
    if (include) {
      cmd = `grep -rn --include="${include}"`;
    }
    cmd += ` "${query.replace(/"/g, '\\"')}" "${absDir}" 2>/dev/null || true`;

    const output = execSync(cmd, { maxBuffer: 512 * 1024, timeout: 10000 }).toString();

    // Relativize paths
    const lines = output.split('\n').filter(Boolean).slice(0, 100);
    const relLines = lines.map(line => {
      const replaced = line.replace(absDir + '/', '').replace(absDir + '\\', '');
      return replaced;
    });

    if (relLines.length === 0) return `No matches found for "${query}"`;
    return relLines.join('\n') + (lines.length >= 100 ? '\n... (truncated at 100 results)' : '');
  } catch (err) {
    return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function toolRunCommand(ws: string, args: Record<string, unknown>): string {
  const command = String(args.command || '');
  if (!command) throw new Error('command is required');

  // Block obviously dangerous commands
  const blocked = ['rm -rf /', 'format c:', 'del /f /s /q'];
  if (blocked.some(b => command.toLowerCase().includes(b))) {
    throw new Error('Command blocked for safety');
  }

  const cwdRel = args.cwd ? String(args.cwd) : '.';
  const cwd = resolveSafe(ws, cwdRel);

  try {
    const output = execSync(command, {
      cwd,
      maxBuffer: 1024 * 1024,
      timeout: 30000,
      encoding: 'utf-8',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
    });
    return output || '(no output)';
  } catch (err: any) {
    const stdout = err.stdout || '';
    const stderr = err.stderr || '';
    const code = err.status ?? 1;
    return `Exit code: ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
  }
}

async function toolGitStatus(ws: string): Promise<string> {
  const git: SimpleGit = simpleGit(ws);
  const status = await git.status();

  const lines = [
    `Branch: ${status.current || '(detached)'}`,
    `Tracking: ${status.tracking || '(none)'}`,
    `Ahead: ${status.ahead}, Behind: ${status.behind}`,
    `Staged: ${status.staged.length} files`,
    `Modified: ${status.modified.length} files`,
    `Untracked: ${status.not_added.length} files`,
    `Deleted: ${status.deleted.length} files`,
    `Conflicted: ${status.conflicted.length} files`,
    status.isClean() ? 'Working tree is clean' : 'Working tree has changes'
  ];

  if (status.staged.length > 0) lines.push('\nStaged:\n  ' + status.staged.join('\n  '));
  if (status.modified.length > 0) lines.push('\nModified:\n  ' + status.modified.join('\n  '));
  if (status.not_added.length > 0) lines.push('\nUntracked:\n  ' + status.not_added.join('\n  '));

  return lines.join('\n');
}

async function toolGitDiff(ws: string, args: Record<string, unknown>): Promise<string> {
  const git: SimpleGit = simpleGit(ws);
  const staged = Boolean(args.staged);

  const diff = staged
    ? await git.diff(['--cached'])
    : await git.diff();

  if (!diff) return staged ? 'No staged changes' : 'No changes in working tree';

  // Truncate very large diffs
  if (diff.length > 50000) {
    return diff.substring(0, 50000) + '\n\n... (diff truncated at 50 KB)';
  }
  return diff;
}

async function toolGitLog(ws: string, args: Record<string, unknown>): Promise<string> {
  const git: SimpleGit = simpleGit(ws);
  const count = Math.min(Number(args.count) || 10, 50);

  const log = await git.log({ maxCount: count });
  const entries = log.all.map(entry =>
    `${entry.hash.substring(0, 7)} ${entry.date.substring(0, 19)} ${entry.author_name}: ${entry.message}`
  );

  return entries.join('\n') || 'No commits found';
}

async function toolGitCreateBranch(ws: string, args: Record<string, unknown>): Promise<string> {
  const branchName = String(args.name || '');
  if (!branchName) throw new Error('name is required');

  const git: SimpleGit = simpleGit(ws);
  await git.checkoutLocalBranch(branchName);
  return `Created and switched to branch: ${branchName}`;
}

async function toolGitCommit(ws: string, args: Record<string, unknown>): Promise<string> {
  const message = String(args.message || '');
  if (!message) throw new Error('message is required');

  const git: SimpleGit = simpleGit(ws);
  await git.add('.');
  const result = await git.commit(message);
  return `Committed: ${result.commit || '(no changes)'}\nBranch: ${result.branch}\nSummary: ${result.summary.changes} changed, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions`;
}

// ─── Git Operations for Toolbar ───

export async function gitPull(ws: string): Promise<string> {
  const git: SimpleGit = simpleGit(ws);
  const result = await git.pull();
  return `Pulled: ${result.summary.changes} changes, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions`;
}

export async function gitPush(ws: string): Promise<string> {
  const git: SimpleGit = simpleGit(ws);
  await git.push();
  return 'Pushed successfully';
}

export async function gitFetch(ws: string): Promise<string> {
  const git: SimpleGit = simpleGit(ws);
  await git.fetch(['--all']);
  return 'Fetched all remotes';
}

export async function gitStash(ws: string, message?: string): Promise<string> {
  const git: SimpleGit = simpleGit(ws);
  const args = message ? ['push', '-m', message] : ['push'];
  await git.stash(args);
  return `Stashed changes${message ? `: ${message}` : ''}`;
}

export async function gitStashPop(ws: string): Promise<string> {
  const git: SimpleGit = simpleGit(ws);
  await git.stash(['pop']);
  return 'Applied stashed changes';
}

export async function gitBranches(ws: string): Promise<{ current: string; local: string[]; remote: string[] }> {
  const git: SimpleGit = simpleGit(ws);
  const summary = await git.branchLocal();
  const remoteSummary = await git.branch(['-r']);
  return {
    current: summary.current,
    local: summary.all,
    remote: remoteSummary.all
  };
}

export async function gitCheckout(ws: string, branch: string): Promise<string> {
  const git: SimpleGit = simpleGit(ws);
  await git.checkout(branch);
  return `Switched to branch: ${branch}`;
}

export async function gitGetStatus(ws: string) {
  const git: SimpleGit = simpleGit(ws);
  const status = await git.status();
  return {
    current: status.current || '',
    tracking: status.tracking || '',
    ahead: status.ahead,
    behind: status.behind,
    staged: status.staged.length,
    modified: status.modified.length,
    untracked: status.not_added.length,
    conflicted: status.conflicted.length,
    isClean: status.isClean(),
    files: {
      staged: status.staged,
      modified: status.modified,
      untracked: status.not_added,
      deleted: status.deleted,
      conflicted: status.conflicted
    }
  };
}

export async function gitClone(url: string, localPath: string): Promise<string> {
  const git: SimpleGit = simpleGit();
  await git.clone(url, localPath);
  return `Cloned ${url} to ${localPath}`;
}

// Check if a path is a git repository
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    const git: SimpleGit = simpleGit(path);
    await git.status();
    return true;
  } catch {
    return false;
  }
}
