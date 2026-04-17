/**
 * Write-Scope Enforcement — Sprint 27.1 (Block 1)
 *
 * Plan mode normally blocks ALL write tools. This module adds an "allow-list"
 * mechanism so that `/mode plan --write-scope audit/` allows writes ONLY to
 * paths that begin with the specified prefix(es).
 *
 * Usage:
 *   /mode plan --write-scope audit/
 *   /mode plan --write-scope audit/,reports/
 *   /mode plan                         (resets to no writes allowed)
 *   /mode build                        (resets; all writes allowed)
 *
 * The agent loop and tool executor call `isWriteAllowed(toolName, toolInput)`
 * before each tool execution. If the tool is a write tool and we are in plan
 * mode, the allow-list is consulted.
 */

import { resolve, relative, sep, normalize } from 'path';

// ─── State ───

/** List of allowed path prefixes (relative to workspace root). Empty = no writes. */
let _writeAllowPrefixes: string[] = [];

/** Whether write-scope restriction is active (plan mode with --write-scope). */
let _writeScopeActive = false;

// ─── Public API ───

/**
 * Set the write-scope allow-list for plan mode.
 * Pass empty array to disallow all writes (default plan mode behavior).
 */
export function setWriteScope(prefixes: string[]): void {
  _writeAllowPrefixes = prefixes.map(p => normalizePrefixPath(p));
  _writeScopeActive = _writeAllowPrefixes.length > 0;
}

/** Get current write-scope configuration. */
export function getWriteScope(): { active: boolean; prefixes: string[] } {
  return { active: _writeScopeActive, prefixes: [..._writeAllowPrefixes] };
}

/** Clear write-scope (used when switching to build mode or resetting plan). */
export function clearWriteScope(): void {
  _writeAllowPrefixes = [];
  _writeScopeActive = false;
}

/**
 * Check whether a write tool invocation is allowed given the current mode and scope.
 *
 * @param toolName - The tool being invoked (e.g. 'write_file', 'run_command')
 * @param toolInput - The raw tool input object from the LLM
 * @param workspacePath - The workspace root (absolute)
 * @param isWriteTool - Whether this tool is classified as a write tool
 * @param mode - Current execution mode ('plan' | 'build')
 * @returns Object with `allowed` flag and optional `reason` string.
 */
export function isWriteAllowed(
  toolName: string,
  toolInput: Record<string, any>,
  workspacePath: string,
  isWriteTool: boolean,
  mode: 'plan' | 'build',
): { allowed: boolean; reason?: string } {
  // Build mode: everything allowed
  if (mode === 'build') {
    return { allowed: true };
  }

  // Plan mode, not a write tool: allowed
  if (!isWriteTool) {
    return { allowed: true };
  }

  // Plan mode, write tool, no write-scope: blocked
  if (!_writeScopeActive) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is disabled in Plan mode. Use /build to enable writes, or /mode plan --write-scope <path> to allow specific paths.`,
    };
  }

  // Plan mode, write tool, write-scope active: check path
  const targetPath = extractTargetPath(toolName, toolInput);
  if (!targetPath) {
    // For run_command / bash_command, we can't verify the path statically.
    // Block by default when write-scope is active — commands are too broad.
    if (toolName === 'run_command' || toolName === 'bash_command') {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is blocked in Plan mode with write-scope. Only file write tools (write_file, patch_file, multi_edit) targeting allowed paths are permitted.`,
      };
    }
    // git_commit, git_create_branch also blocked in scoped plan
    return {
      allowed: false,
      reason: `Tool "${toolName}" is blocked in Plan mode with write-scope. Cannot determine target path.`,
    };
  }

  // Resolve the path relative to workspace
  const absTarget = targetPath.startsWith('/')
    ? targetPath
    : resolve(workspacePath, targetPath);
  const relTarget = relative(workspacePath, absTarget);

  // Prevent path traversal
  if (relTarget.startsWith('..') || relTarget.startsWith(sep + sep)) {
    return {
      allowed: false,
      reason: `Write blocked: target path "${relTarget}" is outside the workspace.`,
    };
  }

  // Check against allow-list
  const normalizedRel = normalize(relTarget).replace(/\\/g, '/');
  for (const prefix of _writeAllowPrefixes) {
    if (normalizedRel.startsWith(prefix) || normalizedRel === prefix.replace(/\/$/, '')) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `Write blocked: "${normalizedRel}" is outside the allowed scope [${_writeAllowPrefixes.join(', ')}]. Use /mode plan --write-scope to adjust.`,
  };
}

/**
 * Parse the --write-scope flag from /mode plan arguments.
 * Returns array of path prefixes, or empty array if not specified.
 *
 * Examples:
 *   "--write-scope audit/"          => ["audit/"]
 *   "--write-scope audit/,reports/" => ["audit/", "reports/"]
 *   ""                              => []
 */
export function parseWriteScopeArgs(args: string): string[] {
  const match = args.match(/--write-scope\s+([^\s]+)/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => normalizePrefixPath(s));
}

// ─── Internals ───

/** Normalize a prefix path: remove leading ./ or /, ensure trailing / */
function normalizePrefixPath(p: string): string {
  let normalized = p.replace(/\\/g, '/');
  // Remove leading ./ or /
  normalized = normalized.replace(/^\.\//, '').replace(/^\//, '');
  // Ensure trailing /
  if (!normalized.endsWith('/')) {
    normalized += '/';
  }
  return normalized;
}

/** Extract the file path from a write-tool invocation's input. */
function extractTargetPath(toolName: string, input: Record<string, any>): string | null {
  // write_file, patch_file, multi_edit
  if (input.path) return String(input.path);
  if (input.file_path) return String(input.file_path);
  if (input.filePath) return String(input.filePath);

  // multi_edit may have an array of edits
  if (input.edits && Array.isArray(input.edits) && input.edits[0]?.path) {
    return String(input.edits[0].path);
  }

  return null;
}
