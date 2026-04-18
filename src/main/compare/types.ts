/**
 * Compare Engine Types — Sprint 27
 * Data model for Compare Sessions, file diffs, folder comparisons,
 * 3-way merges, hunks, sync preview, and token-efficient summaries.
 */

// ─── Session & Mode ───

export type CompareMode = 'file' | 'merge3' | 'folder';
export type CompareStatus = 'analyzing' | 'comparing' | 'complete' | 'error';
export type HunkAction = 'none' | 'apply-left' | 'apply-right' | 'apply-base' | 'manual';
export type SyncDirection = 'left-to-right' | 'right-to-left';
export type FileState = 'identical' | 'different' | 'left-only' | 'right-only' | 'filtered' | 'error';

export interface CompareSession {
  id: string;
  mode: CompareMode;
  status: CompareStatus;
  createdAt: number;
  updatedAt: number;
  leftPath: string;
  rightPath: string;
  basePath?: string; // for 3-way merge
  filters?: CompareFilters;
  /** File compare result */
  fileResult?: FileCompareResult;
  /** Folder compare result */
  folderResult?: FolderCompareResult;
  /** 3-way merge result */
  mergeResult?: MergeResult;
  /** Sync preview (folder mode) */
  syncPreview?: SyncPreviewResult;
  /** Error message if status === 'error' */
  error?: string;
}

// ─── Filters ───

export interface CompareFilters {
  includePatterns?: string[];   // e.g. ["*.ts", "*.tsx"]
  excludePatterns?: string[];   // e.g. ["node_modules", "dist", "*.map"]
  recursive?: boolean;          // folder compare: recurse into subdirectories
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
  contextLines?: number;        // lines of context around each hunk (default 3)
}

// ─── File Compare ───

export interface FileCompareResult {
  leftPath: string;
  rightPath: string;
  leftSize: number;
  rightSize: number;
  leftLines: number;
  rightLines: number;
  identical: boolean;
  hunks: Hunk[];
  /** Compact summary (token-efficient for LLM) */
  summary: FileCompareSummary;
  /** Moved block detection results */
  movedBlocks?: MovedBlock[];
}

export interface FileCompareSummary {
  totalHunks: number;
  linesAdded: number;
  linesRemoved: number;
  linesModified: number;
  movedBlocks: number;
  riskFlags: string[]; // e.g. "large deletion", "binary detected", "encoding mismatch"
}

export interface Hunk {
  index: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Unified diff lines for this hunk */
  lines: DiffLine[];
  /** Optional word-level diff for modified lines */
  wordDiff?: WordDiffSegment[][];
  /** Action taken on this hunk (for merge operations) */
  action: HunkAction;
  /** Whether this hunk has a conflict (3-way) */
  conflict?: boolean;
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface WordDiffSegment {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface MovedBlock {
  /** Hunk index in left side */
  fromHunkIndex: number;
  /** Hunk index in right side */
  toHunkIndex: number;
  /** Number of matching lines */
  matchingLines: number;
  /** Similarity score 0-1 */
  similarity: number;
}

// ─── 3-Way Merge ───

export interface MergeResult {
  leftPath: string;
  rightPath: string;
  basePath: string;
  /** The merged content (with conflict markers if unresolved) */
  mergedContent: string;
  hunks: MergeHunk[];
  summary: MergeSummary;
  /** Whether all conflicts are resolved */
  allResolved: boolean;
}

export interface MergeHunk {
  index: number;
  conflict: boolean;
  /** Content from base */
  baseContent: string;
  /** Content from left */
  leftContent: string;
  /** Content from right */
  rightContent: string;
  /** Resolved content (if action taken) */
  resolvedContent?: string;
  action: HunkAction;
  oldStart: number;
  oldLines: number;
}

export interface MergeSummary {
  totalHunks: number;
  conflicts: number;
  resolved: number;
  autoMerged: number;
  riskFlags: string[];
}

// ─── Folder Compare ───

export interface FolderCompareResult {
  leftPath: string;
  rightPath: string;
  recursive: boolean;
  entries: FolderEntry[];
  summary: FolderCompareSummary;
}

export interface FolderEntry {
  relativePath: string;
  state: FileState;
  leftSize?: number;
  rightSize?: number;
  leftModified?: number;
  rightModified?: number;
  isDirectory: boolean;
  /** File-level diff summary (only for 'different' files, loaded on demand) */
  diffSummary?: FileCompareSummary;
}

export interface FolderCompareSummary {
  totalEntries: number;
  identical: number;
  different: number;
  leftOnly: number;
  rightOnly: number;
  filtered: number;
  errors: number;
  /** First N different files (compact for LLM) */
  topChangedFiles: Array<{ path: string; added: number; removed: number }>;
  riskFlags: string[];
}

// ─── Sync Preview ───

export interface SyncPreviewResult {
  direction: SyncDirection;
  actions: SyncAction[];
  summary: SyncSummary;
}

export interface SyncAction {
  relativePath: string;
  action: 'copy' | 'overwrite' | 'delete' | 'skip';
  danger: boolean;    // true for delete or overwrite
  sourceSize?: number;
  targetSize?: number;
}

export interface SyncSummary {
  totalActions: number;
  copies: number;
  overwrites: number;
  deletes: number;
  skips: number;
  dangerFlags: string[];
}

// ─── Token-Efficient Compact Output ───

export interface CompareToolOutput {
  sessionId: string;
  mode: CompareMode;
  status: CompareStatus;
  summary: FileCompareSummary | MergeSummary | FolderCompareSummary;
  /** Truncated first N hunks or entries */
  preview: any[];
  /** Total items available for on-demand fetch */
  totalItems: number;
  /** Actions available */
  actions: string[];
  error?: string;
}
