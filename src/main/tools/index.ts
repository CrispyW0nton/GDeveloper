/**
 * Local Coding Tools — Real Implementations
 * All file tools resolve relative to active workspace root.
 * Refuse operations outside workspace boundary.
 * Log every operation to activity via DB.
 *
 * Sprint 16: multi_edit, bash_command, parallel_search, parallel_read,
 * summarize_large_document, task_plan tools added.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative, isAbsolute, dirname, sep } from 'path';
import { execSync, execFileSync } from 'child_process';
import simpleGit, { SimpleGit } from 'simple-git';
import { getDatabase } from '../db';
import { executeMultiEdit, type MultiEditInput } from './multiEdit';
import { executeBashCommand, isDestructiveCommand, isBlockedCommand, type BashCommandInput } from './bashCommand';
import { executeParallelSearch, type ParallelSearchInput } from './parallelSearch';
import { executeParallelRead, type ParallelReadInput } from './parallelRead';
import { executeSummarizeLargeDocument, type SummarizeInput } from './summarizeLargeDocument';
import { executeTaskPlan, getActivePlan, type TaskPlanInput } from './taskPlan';
import { ATTEMPT_COMPLETION_TOOL_DEF, executeAttemptCompletion, type AttemptCompletionInput } from './attemptCompletion';
import { ASK_FOLLOWUP_QUESTION_TOOL_DEF, executeAskFollowupQuestion, type AskFollowupQuestionInput } from './askFollowupQuestion';
import * as compareEngine from '../compare';
import type { CompareFilters, HunkAction, SyncDirection } from '../compare';

// ─── Workspace State ───

let activeWorkspacePath: string | null = null;

export function setActiveWorkspace(path: string | null): void {
  activeWorkspacePath = path;
  console.log(`[Tools] Active workspace set to: ${path || '(none)'}`);
}

export function getActiveWorkspace(): string | null {
  return activeWorkspacePath;
}

// ─── Sprint 29: Programmatic Plan Mode Tool Filtering ───

/** Tool names that require write access (mutating tools) */
export const WRITE_ACCESS_TOOLS = new Set([
  'write_file', 'patch_file', 'run_command', 'git_commit',
  'git_create_branch', 'multi_edit', 'bash_command',
]);

/**
 * Get the filtered tool list for a given execution mode.
 * In 'plan' mode, write-access tools are excluded.
 * In 'build' mode, all tools are returned.
 */
export function getToolsForMode(mode: 'plan' | 'build'): LocalToolDef[] {
  if (mode === 'plan') {
    return LOCAL_TOOL_DEFINITIONS.filter(t => !WRITE_ACCESS_TOOLS.has(t.name));
  }
  return LOCAL_TOOL_DEFINITIONS;
}

// Re-export Sprint 16 types for consumers
export type { MultiEditInput, MultiEditResult, EditOp } from './multiEdit';
export type { BashCommandInput, BashCommandResult } from './bashCommand';
export type { ParallelSearchInput, ParallelSearchResult } from './parallelSearch';
export type { ParallelReadInput, ParallelReadResult } from './parallelRead';
export type { SummarizeInput, SummarizeResult } from './summarizeLargeDocument';
export type { TaskPlanInput, TaskPlanResult, TaskPlan, TaskItem, TaskStatus } from './taskPlan';
export { getActivePlan } from './taskPlan';
export { isDestructiveCommand, isBlockedCommand } from './bashCommand';

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
  },
  // ─── Sprint 16: New Agent Tools ───
  {
    name: 'multi_edit',
    description: 'Atomic multi-edit: apply a list of find-and-replace edits to a single file. All edits are applied sequentially; if any old_string is not found, no edits are applied (all-or-none). Returns a unified diff.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File path relative to workspace root' },
        edits: {
          type: 'array',
          description: 'List of edit operations to apply sequentially',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string', description: 'Text to find (empty string to append)' },
              new_string: { type: 'string', description: 'Replacement text' },
              replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' }
            },
            required: ['old_string', 'new_string']
          }
        }
      },
      required: ['file_path', 'edits']
    }
  },
  {
    name: 'bash_command',
    description: 'Execute a shell command in the workspace. Captures stdout, stderr, and exit code. Timeout: configurable up to 120s. Destructive commands are flagged.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory relative to workspace (default: workspace root)' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000, max: 120000)' },
        description: { type: 'string', description: 'Brief description of what this command does' }
      },
      required: ['command']
    }
  },
  {
    name: 'parallel_search',
    description: 'Run 2-6 web searches in parallel. Returns top results per query.',
    input_schema: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          description: 'List of 2-6 search queries',
          items: { type: 'string' }
        }
      },
      required: ['queries']
    }
  },
  {
    name: 'parallel_read',
    description: 'Fetch and read content from multiple URLs in parallel. Optionally answer per-URL questions.',
    input_schema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          description: 'List of URLs to read (string or {url, question} objects)',
          items: { type: 'string' }
        }
      },
      required: ['urls']
    }
  },
  {
    name: 'summarize_large_document',
    description: 'Answer a specific question from a long document/URL. Fetches the document, extracts relevant sections, and returns a structured answer with citations.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL of the document to analyze' },
        question: { type: 'string', description: 'Specific question to answer from the document' }
      },
      required: ['url', 'question']
    }
  },
  {
    name: 'task_plan',
    description: 'Create and manage a visible task plan. Actions: create (new plan with tasks), update (change task status), append (add tasks), get (view current plan). Statuses: pending, in_progress, done, skipped, failed.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'append', 'get'], description: 'Operation to perform' },
        plan_id: { type: 'string', description: 'Plan ID (optional, uses active plan if omitted)' },
        tasks: {
          type: 'array',
          description: 'Tasks to create or append',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Task ID (auto-generated if omitted)' },
              content: { type: 'string', description: 'Task description' },
              status: { type: 'string', description: 'Initial status (default: pending)' },
              priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Priority (default: medium)' }
            },
            required: ['content']
          }
        },
        task_id: { type: 'string', description: 'Task ID to update (for update action)' },
        new_status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'skipped', 'failed'], description: 'New status (for update action)' },
        notes: { type: 'string', description: 'Optional notes for update' }
      },
      required: ['action']
    }
  },
  // ─── Sprint 28: Cline-style terminal tools ───
  ATTEMPT_COMPLETION_TOOL_DEF,
  ASK_FOLLOWUP_QUESTION_TOOL_DEF,
  // ─── Sprint 27: Compare Agent Tools ───
  {
    name: 'compare_file',
    description: 'Compare two files deterministically. Returns a compact structured summary with session ID, hunk counts, added/removed lines, risk flags, and preview of first N hunks. Token-efficient: full hunk details are available on demand via compare_hunk_detail. Supports word-level diff, moved-block detection, and apply-left/right hunk actions.',
    input_schema: {
      type: 'object',
      properties: {
        left: { type: 'string', description: 'Path to left file (relative to workspace or absolute)' },
        right: { type: 'string', description: 'Path to right file (relative to workspace or absolute)' },
        ignore_whitespace: { type: 'boolean', description: 'Ignore whitespace differences (default: false)' },
        context_lines: { type: 'number', description: 'Lines of context around each hunk (default: 3)' },
      },
      required: ['left', 'right']
    }
  },
  {
    name: 'compare_folder',
    description: 'Compare two directories recursively. Returns compact summary with file state counts (identical, different, left-only, right-only), top changed files, and risk flags. Token-efficient: only summary and first N entries are included; detailed diffs for individual files available on demand. Supports include/exclude filters.',
    input_schema: {
      type: 'object',
      properties: {
        left: { type: 'string', description: 'Path to left directory' },
        right: { type: 'string', description: 'Path to right directory' },
        recursive: { type: 'boolean', description: 'Recurse into subdirectories (default: true)' },
        include: { type: 'string', description: 'Comma-separated include patterns (e.g. "*.ts,*.tsx")' },
        exclude: { type: 'string', description: 'Comma-separated exclude patterns (e.g. "node_modules,dist")' },
      },
      required: ['left', 'right']
    }
  },
  {
    name: 'merge_3way',
    description: 'Perform a 3-way merge with a common base file. Returns compact summary with conflict count, auto-merged hunks, and resolution status. Use this to detect and resolve merge conflicts between two file versions that share a common ancestor. Actions: apply-left, apply-right, apply-base for each conflicting hunk.',
    input_schema: {
      type: 'object',
      properties: {
        left: { type: 'string', description: 'Path to left (ours) file' },
        right: { type: 'string', description: 'Path to right (theirs) file' },
        base: { type: 'string', description: 'Path to base (ancestor) file' },
      },
      required: ['left', 'right', 'base']
    }
  },
  {
    name: 'compare_hunk_detail',
    description: 'Fetch full detail for a specific hunk in an existing compare session. Use this after compare_file or merge_3way to get line-by-line diff data for a specific hunk index. This is the token-efficient on-demand fetch pattern — only request hunks the user asks about.',
    input_schema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Compare session ID from a previous compare_file or merge_3way result' },
        hunk_index: { type: 'number', description: 'Zero-based hunk index to fetch' },
      },
      required: ['session_id', 'hunk_index']
    }
  },
  {
    name: 'compare_apply_hunk',
    description: 'Apply an action to a specific hunk in a compare session. Actions: apply-left (keep left/ours version), apply-right (keep right/theirs version), apply-base (keep base version for 3-way), none (reset). Returns updated session status.',
    input_schema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Compare session ID' },
        hunk_index: { type: 'number', description: 'Zero-based hunk index' },
        action: { type: 'string', enum: ['apply-left', 'apply-right', 'apply-base', 'none'], description: 'Action to apply to this hunk' },
      },
      required: ['session_id', 'hunk_index', 'action']
    }
  },
  {
    name: 'sync_preview',
    description: 'Generate a sync preview for a folder comparison session. Shows what files would be copied, overwritten, or deleted to synchronize the left and right directories. Includes danger flags for destructive operations. Does NOT apply changes — use this to review before syncing.',
    input_schema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Folder compare session ID from a previous compare_folder result' },
        direction: { type: 'string', enum: ['left-to-right', 'right-to-left'], description: 'Sync direction' },
      },
      required: ['session_id', 'direction']
    }
  },
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
      // ─── Sprint 16: New Agent Tools ───
      case 'multi_edit': {
        const meResult = executeMultiEdit(ws, resolveSafe, args as unknown as MultiEditInput);
        if (!meResult.success) throw new Error(meResult.error || 'multi_edit failed');
        result = JSON.stringify(meResult);
        break;
      }
      case 'bash_command': {
        const bcResult = executeBashCommand(ws, resolveSafe, args as unknown as BashCommandInput);
        result = JSON.stringify(bcResult);
        break;
      }
      case 'parallel_search': {
        const psResult = await executeParallelSearch(args as unknown as ParallelSearchInput);
        result = JSON.stringify(psResult);
        break;
      }
      case 'parallel_read': {
        const prResult = await executeParallelRead(args as unknown as ParallelReadInput);
        result = JSON.stringify(prResult);
        break;
      }
      case 'summarize_large_document': {
        const sdResult = await executeSummarizeLargeDocument(args as unknown as SummarizeInput);
        result = JSON.stringify(sdResult);
        break;
      }
      case 'task_plan': {
        const tpResult = executeTaskPlan(args as unknown as TaskPlanInput);
        result = JSON.stringify(tpResult);
        break;
      }
      // ─── Sprint 28: Cline-style terminal tools ───
      case 'attempt_completion': {
        const acResult = executeAttemptCompletion(args as unknown as AttemptCompletionInput);
        result = JSON.stringify(acResult);
        break;
      }
      case 'ask_followup_question': {
        const afResult = executeAskFollowupQuestion(args as unknown as AskFollowupQuestionInput);
        result = JSON.stringify(afResult);
        break;
      }
      // ─── Sprint 27: Compare Agent Tools ───
      case 'compare_file': {
        const leftPath = resolveSafe(ws, String(args.left || ''));
        const rightPath = resolveSafe(ws, String(args.right || ''));
        const filters: CompareFilters = {};
        if (args.ignore_whitespace) filters.ignoreWhitespace = true;
        if (args.context_lines) filters.contextLines = Number(args.context_lines);
        const cmpSession = compareEngine.compareFiles(leftPath, rightPath, filters);
        const compact = compareEngine.getCompactOutput(cmpSession.id);
        result = JSON.stringify({ compareSession: compact });
        break;
      }
      case 'compare_folder': {
        const leftDir = resolveSafe(ws, String(args.left || ''));
        const rightDir = resolveSafe(ws, String(args.right || ''));
        const fFilters: CompareFilters = { recursive: args.recursive !== false };
        if (args.include) fFilters.includePatterns = String(args.include).split(',').map(s => s.trim());
        if (args.exclude) fFilters.excludePatterns = String(args.exclude).split(',').map(s => s.trim());
        const fSession = compareEngine.compareFolders(leftDir, rightDir, fFilters);
        const fCompact = compareEngine.getCompactOutput(fSession.id);
        result = JSON.stringify({ compareSession: fCompact });
        break;
      }
      case 'merge_3way': {
        const mLeft = resolveSafe(ws, String(args.left || ''));
        const mRight = resolveSafe(ws, String(args.right || ''));
        const mBase = resolveSafe(ws, String(args.base || ''));
        const mSession = compareEngine.merge3Way(mLeft, mRight, mBase);
        const mCompact = compareEngine.getCompactOutput(mSession.id);
        result = JSON.stringify({ compareSession: mCompact });
        break;
      }
      case 'compare_hunk_detail': {
        const hunk = compareEngine.getHunkDetail(String(args.session_id || ''), Number(args.hunk_index || 0));
        if (!hunk) throw new Error(`Hunk not found: session=${args.session_id}, index=${args.hunk_index}`);
        result = JSON.stringify(hunk);
        break;
      }
      case 'compare_apply_hunk': {
        const ok = compareEngine.applyHunkAction(
          String(args.session_id || ''),
          Number(args.hunk_index || 0),
          String(args.action || 'none') as HunkAction
        );
        if (!ok) throw new Error(`Failed to apply action: session=${args.session_id}, hunk=${args.hunk_index}`);
        const updated = compareEngine.getCompactOutput(String(args.session_id || ''));
        result = JSON.stringify({ success: true, compareSession: updated });
        break;
      }
      case 'sync_preview': {
        const spResult = compareEngine.syncPreview(
          String(args.session_id || ''),
          String(args.direction || 'left-to-right') as SyncDirection
        );
        if (!spResult) throw new Error(`Sync preview failed: session=${args.session_id} not found or not a folder comparison`);
        result = JSON.stringify(spResult);
        break;
      }
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

  // Sprint 15.2: CRLF-aware search
  // Detect original EOL style
  const hasCRLF = oldContent.includes('\r\n');
  const hasLF = oldContent.includes('\n') && !hasCRLF;
  const originalEOL = hasCRLF ? '\r\n' : '\n';

  // Try exact match first
  let found = oldContent.includes(search);
  let effectiveSearch = search;

  if (!found) {
    // Try normalizing line endings: convert search to match file's EOL style
    const searchNorm = search.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const contentNorm = oldContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    if (contentNorm.includes(searchNorm)) {
      // Reconstruct search in the file's actual EOL style
      effectiveSearch = hasCRLF ? searchNorm.replace(/\n/g, '\r\n') : searchNorm;
      found = oldContent.includes(effectiveSearch);
      if (!found) {
        // Direct normalized replacement: operate on normalized content
        const newNormalized = contentNorm.replace(searchNorm, replace.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
        // Restore original EOL style
        const newContent = hasCRLF ? newNormalized.replace(/\n/g, '\r\n') : newNormalized;
        writeFileSync(absPath, newContent, 'utf-8');
        try {
          const db = getDatabase();
          db.addDiff('system', null, filePath, oldContent, newContent);
        } catch { /* ignore */ }
        return `Patched ${filePath}: replaced ${search.length} chars with ${replace.length} chars (EOL normalized: ${hasCRLF ? 'CRLF' : 'LF'})`;
      }
    }
  }

  if (!found) {
    // Sprint 15.2: Provide detailed failure snippet for debugging
    const searchPreview = search.substring(0, 60).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    const contentSnippet = oldContent.substring(0, 200).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    throw new Error(
      `Search text not found in ${filePath}. Provide exact text including whitespace.\n` +
      `Search (first 60 chars): "${searchPreview}"\n` +
      `File EOL: ${hasCRLF ? 'CRLF' : hasLF ? 'LF' : 'unknown'}\n` +
      `File start (first 200 chars): "${contentSnippet}"`
    );
  }

  const newContent = oldContent.replace(effectiveSearch, replace);
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
    // BUG-02 + BUG-08: Use execFileSync with an argv array instead of
    // composing a shell command string. Two wins:
    //   1. `query` is passed as its own argv element, so a malicious AI
    //      response containing "; rm -rf ." or backticks cannot escape into
    //      a shell. Previously the only escaping was .replace(/"/g, '\\"'),
    //      which left every shell metacharacter (backticks, $(), ;, &&,
    //      redirects) exploitable.
    //   2. The default extension list is no longer capped at eight
    //      web-centric extensions. `grep -I` skips binary files naturally,
    //      and --exclude-dir prunes the usual noisy build / dep dirs, so
    //      Python, Rust, Go, Java, Ruby, YAML, etc. are all visible.
    const args: string[] = ['-rnI'];
    if (include) {
      args.push(`--include=${include}`);
    } else {
      const EXCLUDE_DIRS = [
        'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
        '.next', '.nuxt', '.turbo', '.cache',
        '.venv', 'venv', '__pycache__',
        'target', // Rust
        'vendor', // Go / PHP / Ruby
      ];
      for (const d of EXCLUDE_DIRS) args.push(`--exclude-dir=${d}`);
    }
    args.push('--', query, absDir);

    let output = '';
    try {
      output = execFileSync('grep', args, {
        maxBuffer: 512 * 1024,
        timeout: 10000,
        encoding: 'utf-8',
      });
    } catch (err: any) {
      // grep exits 1 on "no matches" — that's not a real error, stdout is
      // empty. Re-throw any other failure shape (missing grep, timeout).
      if (err && typeof err.status === 'number' && err.status === 1) {
        output = err.stdout?.toString() || '';
      } else {
        throw err;
      }
    }

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

  // BUG-02: Previously run_command had its own 3-substring blocklist
  // ('rm -rf /', 'format c:', 'del /f /s /q') while the sibling bash_command
  // tool had a proper regex-based pipeline. Unify them: both tools now
  // share isBlockedCommand from bashCommand.ts, which enforces the
  // hardened pattern set (pipe-to-shell RCE, reverse shells, credential-
  // store writes, setuid escalation, LD_PRELOAD hijack, etc.).
  if (isBlockedCommand(command)) {
    throw new Error('Command blocked for safety — matched a high-risk pattern (see bashCommand BLOCKED_PATTERNS). If this is a false positive, use the multi_edit / write_file / git_* tools instead of shelling out.');
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
