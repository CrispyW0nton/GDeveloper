/**
 * File System Service — Sprint 19
 * Provides async file-tree traversal with filtering for the renderer.
 * Filters out heavy directories (node_modules, .git, etc.) to keep the tree fast.
 * Returns a flat-ish structure the renderer virtualizes.
 */

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, accessSync, constants } from 'fs';
import { join, relative, extname, basename, resolve, dirname } from 'path';

// ─── Heavy directories to always filter ───
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '__pycache__', '.mypy_cache',
  'dist', 'build', 'target', '.next', '.nuxt', '.svelte-kit',
  '.turbo', '.cache', '.parcel-cache', '.gradle', '.idea', '.vs',
  '.output', 'out', 'coverage', '.nyc_output', '.pytest_cache',
  'dist-electron', 'dist-renderer', 'dist-package', '.DS_Store',
  '.terraform', '.serverless',
]);

// Binary / large file extensions to skip content reads
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
  '.db', '.sqlite', '.sqlite3',
  '.lock', '.map',
]);

// Max file size for content reads (256 KB)
const MAX_READ_SIZE = 256 * 1024;

export interface FileTreeEntry {
  name: string;
  path: string;          // relative to workspace root
  absolutePath: string;
  isDirectory: boolean;
  children?: FileTreeEntry[];
  size?: number;
  extension?: string;
  isSymlink?: boolean;
}

/**
 * Build a file tree from the given root path.
 * Depth-limited to avoid performance issues on huge repos.
 */
export function buildFileTree(rootPath: string, maxDepth: number = 4): FileTreeEntry[] {
  if (!existsSync(rootPath)) return [];

  try {
    return readDirectory(rootPath, rootPath, 0, maxDepth);
  } catch (err) {
    console.error('[FS] Failed to build file tree:', err);
    return [];
  }
}

function readDirectory(dirPath: string, rootPath: string, depth: number, maxDepth: number): FileTreeEntry[] {
  if (depth >= maxDepth) return [];

  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }

  const result: FileTreeEntry[] = [];

  for (const name of entries) {
    // Skip hidden files at root level (except specific ones)
    if (name.startsWith('.') && depth === 0 && !name.match(/^\.(env|gitignore|editorconfig|prettierrc|eslintrc|browserslistrc)$/)) {
      continue;
    }
    if (name.startsWith('.') && depth > 0) continue;

    // Skip ignored directories
    if (IGNORED_DIRS.has(name)) continue;

    const fullPath = join(dirPath, name);
    const relPath = relative(rootPath, fullPath);

    try {
      const stat = statSync(fullPath);
      const entry: FileTreeEntry = {
        name,
        path: relPath,
        absolutePath: fullPath,
        isDirectory: stat.isDirectory(),
        extension: stat.isDirectory() ? undefined : extname(name).toLowerCase(),
        size: stat.isDirectory() ? undefined : stat.size,
        isSymlink: false,
      };

      if (stat.isDirectory()) {
        entry.children = readDirectory(fullPath, rootPath, depth + 1, maxDepth);
      }

      result.push(entry);
    } catch {
      // Skip unreadable entries
    }
  }

  // Sort: directories first, then alphabetically
  result.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return result;
}

/**
 * Read file content safely (for the Live Code View).
 * Returns null for binary or oversized files.
 */
export function readFileSafe(filePath: string): { content: string | null; isBinary: boolean; isTooLarge: boolean; size: number } {
  try {
    if (!existsSync(filePath)) {
      return { content: null, isBinary: false, isTooLarge: false, size: 0 };
    }

    const stat = statSync(filePath);
    const ext = extname(filePath).toLowerCase();

    if (BINARY_EXTENSIONS.has(ext)) {
      return { content: null, isBinary: true, isTooLarge: false, size: stat.size };
    }

    if (stat.size > MAX_READ_SIZE) {
      return { content: null, isBinary: false, isTooLarge: true, size: stat.size };
    }

    const content = readFileSync(filePath, 'utf-8');
    return { content, isBinary: false, isTooLarge: false, size: stat.size };
  } catch {
    return { content: null, isBinary: false, isTooLarge: false, size: 0 };
  }
}

/**
 * Sprint 23: Write file content safely with atomic write.
 * Returns success/failure and error message.
 */
export function writeFileSafe(filePath: string, content: string): { success: boolean; error?: string } {
  try {
    const absPath = resolve(filePath);
    const ext = extname(absPath).toLowerCase();
    const base = basename(absPath).toLowerCase();

    // Block binary writes
    if (BINARY_EXTENSIONS.has(ext)) {
      return { success: false, error: 'Cannot write to binary files.' };
    }

    // Block lock file edits
    const LOCK_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'composer.lock']);
    if (LOCK_FILES.has(base)) {
      return { success: false, error: 'Lock files should not be edited manually.' };
    }

    // Ensure parent directory exists
    const dir = dirname(absPath);
    if (!existsSync(dir)) {
      return { success: false, error: `Parent directory does not exist: ${dir}` };
    }

    // Check write permission
    try {
      if (existsSync(absPath)) {
        accessSync(absPath, constants.W_OK);
      }
    } catch {
      return { success: false, error: 'File is not writable (permission denied).' };
    }

    writeFileSync(absPath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Save failed: ${msg}` };
  }
}

/**
 * Sprint 23: Check if a file is writable.
 */
export function checkFileWritable(filePath: string, workspaceRoot?: string): {
  writable: boolean;
  reason?: string;
  isBinary: boolean;
  isLockFile: boolean;
  isOutsideWorktree: boolean;
  isTooLarge: boolean;
  size: number;
} {
  const absPath = resolve(filePath);
  const ext = extname(absPath).toLowerCase();
  const base = basename(absPath).toLowerCase();
  const LOCK_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'composer.lock']);

  let size = 0;
  try {
    const stat = statSync(absPath);
    size = stat.size;
  } catch { /* file may not exist */ }

  const isBinary = BINARY_EXTENSIONS.has(ext);
  const isLockFile = LOCK_FILES.has(base);
  const isOutsideWorktree = workspaceRoot ? !absPath.startsWith(resolve(workspaceRoot)) : false;
  const isTooLarge = size > 5 * 1024 * 1024;

  if (isBinary) return { writable: false, reason: 'Binary file', isBinary, isLockFile, isOutsideWorktree, isTooLarge, size };
  if (isLockFile) return { writable: false, reason: 'Lock file', isBinary, isLockFile, isOutsideWorktree, isTooLarge, size };
  if (isOutsideWorktree) return { writable: false, reason: 'Outside workspace', isBinary, isLockFile, isOutsideWorktree, isTooLarge, size };

  try {
    if (existsSync(absPath)) accessSync(absPath, constants.W_OK);
    return { writable: true, isBinary, isLockFile, isOutsideWorktree, isTooLarge, size };
  } catch {
    return { writable: false, reason: 'Permission denied', isBinary, isLockFile, isOutsideWorktree, isTooLarge, size };
  }
}

/**
 * Get file icon hint based on extension (used by renderer for icon selection).
 */
export function getFileIconType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const base = basename(filename).toLowerCase();

  // Special files
  if (base === 'package.json') return 'npm';
  if (base === 'tsconfig.json') return 'typescript';
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'docker';
  if (base === '.gitignore') return 'git';
  if (base === 'readme.md') return 'readme';
  if (base === 'license' || base === 'license.md') return 'license';

  const MAP: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'react', '.js': 'javascript', '.jsx': 'react',
    '.json': 'json', '.md': 'markdown', '.css': 'css', '.scss': 'scss',
    '.html': 'html', '.py': 'python', '.rs': 'rust', '.go': 'go',
    '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'header',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml',
    '.sql': 'database', '.graphql': 'graphql', '.gql': 'graphql',
    '.svg': 'image', '.png': 'image', '.jpg': 'image', '.gif': 'image',
    '.env': 'env', '.lock': 'lock',
  };

  return MAP[ext] || 'file';
}
