/**
 * Compare Engine — Sprint 27
 * Deterministic, local compare engine for file diff, 3-way merge,
 * and folder comparison. Uses the `diff` npm package.
 * All diffing is local — AI only explains/filters results.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join, relative, basename, extname } from 'path';
import * as Diff from 'diff';
// minimatch v5 exports the function as default; use default import.
// @ts-ignore - minimatch doesn't ship named types in this version
import minimatch from 'minimatch';
import type {
  CompareSession, CompareMode, CompareFilters, CompareStatus,
  FileCompareResult, FileCompareSummary, Hunk, DiffLine, WordDiffSegment,
  MovedBlock, MergeResult, MergeHunk, MergeSummary,
  FolderCompareResult, FolderEntry, FolderCompareSummary, FileState,
  SyncPreviewResult, SyncAction, SyncSummary, SyncDirection,
  CompareToolOutput, HunkAction,
} from './types';

// ─── Session Store ───

const sessions = new Map<string, CompareSession>();
let sessionCounter = 0;

function generateSessionId(): string {
  return `cmp-${Date.now()}-${++sessionCounter}`;
}

export function getSession(id: string): CompareSession | undefined {
  return sessions.get(id);
}

export function listSessions(): CompareSession[] {
  return Array.from(sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

// ─── File Compare ───

export function compareFiles(
  leftPath: string,
  rightPath: string,
  filters?: CompareFilters
): CompareSession {
  const session: CompareSession = {
    id: generateSessionId(),
    mode: 'file',
    status: 'comparing',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    leftPath,
    rightPath,
    filters,
  };
  sessions.set(session.id, session);

  try {
    const leftContent = readFileSafe(leftPath);
    const rightContent = readFileSafe(rightPath);
    const leftStat = statSync(leftPath);
    const rightStat = statSync(rightPath);
    const leftLines = leftContent.split('\n');
    const rightLines = rightContent.split('\n');

    const options: any = {};
    if (filters?.ignoreWhitespace) options.stripTrailingCr = true;

    const structDiff = Diff.structuredPatch(
      basename(leftPath),
      basename(rightPath),
      leftContent,
      rightContent,
      undefined,
      undefined,
      { context: filters?.contextLines ?? 3 }
    );

    const hunks: Hunk[] = structDiff.hunks.map((h, idx) => {
      const lines: DiffLine[] = [];
      let oldLine = h.oldStart;
      let newLine = h.newStart;

      for (const rawLine of h.lines) {
        const prefix = rawLine[0];
        const content = rawLine.slice(1);

        if (prefix === '-') {
          lines.push({ type: 'remove', content, oldLineNumber: oldLine++ });
        } else if (prefix === '+') {
          lines.push({ type: 'add', content, newLineNumber: newLine++ });
        } else {
          lines.push({ type: 'context', content, oldLineNumber: oldLine++, newLineNumber: newLine++ });
        }
      }

      // Compute word-level diff for adjacent remove/add pairs
      const wordDiff = computeWordDiff(lines);

      return {
        index: idx,
        oldStart: h.oldStart,
        oldLines: h.oldLines,
        newStart: h.newStart,
        newLines: h.newLines,
        lines,
        wordDiff: wordDiff.length > 0 ? wordDiff : undefined,
        action: 'none' as HunkAction,
        conflict: false,
      };
    });

    // Detect moved blocks
    const movedBlocks = detectMovedBlocks(hunks);

    // Compute summary
    let linesAdded = 0, linesRemoved = 0, linesModified = 0;
    for (const hunk of hunks) {
      const added = hunk.lines.filter(l => l.type === 'add').length;
      const removed = hunk.lines.filter(l => l.type === 'remove').length;
      linesAdded += added;
      linesRemoved += removed;
      linesModified += Math.min(added, removed);
    }

    const riskFlags: string[] = [];
    if (linesRemoved > 100) riskFlags.push('large deletion (>100 lines)');
    if (hunks.length > 50) riskFlags.push('many changes (>50 hunks)');

    const summary: FileCompareSummary = {
      totalHunks: hunks.length,
      linesAdded,
      linesRemoved,
      linesModified,
      movedBlocks: movedBlocks.length,
      riskFlags,
    };

    session.fileResult = {
      leftPath,
      rightPath,
      leftSize: leftStat.size,
      rightSize: rightStat.size,
      leftLines: leftLines.length,
      rightLines: rightLines.length,
      identical: hunks.length === 0,
      hunks,
      summary,
      movedBlocks: movedBlocks.length > 0 ? movedBlocks : undefined,
    };
    session.status = 'complete';
  } catch (err) {
    session.status = 'error';
    session.error = err instanceof Error ? err.message : String(err);
  }

  session.updatedAt = Date.now();
  return session;
}

// ─── 3-Way Merge ───

export function merge3Way(
  leftPath: string,
  rightPath: string,
  basePath: string,
  filters?: CompareFilters
): CompareSession {
  const session: CompareSession = {
    id: generateSessionId(),
    mode: 'merge3',
    status: 'comparing',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    leftPath,
    rightPath,
    basePath,
    filters,
  };
  sessions.set(session.id, session);

  try {
    const baseContent = readFileSafe(basePath);
    const leftContent = readFileSafe(leftPath);
    const rightContent = readFileSafe(rightPath);

    // Use diff.merge for 3-way merge
    // Signature: merge(mine, theirs, base) — mine=left(ours), theirs=right, base=ancestor
    const mergeResult: any = Diff.merge(leftContent, rightContent, baseContent);

    const hunks: MergeHunk[] = [];
    let conflictCount = 0;
    let autoMergedCount = 0;
    const riskFlags: string[] = [];

    // Parse merge result into hunks
    // Diff.merge returns { hunks: [...] } where each hunk has a .lines array.
    // IMPORTANT: Each element in .lines can be either:
    //   - a string prefixed with ' ', '-', or '+' (normal change)
    //   - an object { conflict: true, mine: string[], theirs: string[] } (conflict)
    // We must handle both forms safely.
    const mergedHunks: any[] = mergeResult?.hunks || [];
    if (mergedHunks.length === 0 && !mergeResult?.conflict) {
      // Clean merge — no conflicts
      autoMergedCount = 1;
    } else {
      // Process each hunk from the merge result
      for (let hi = 0; hi < mergedHunks.length; hi++) {
        const mh = mergedHunks[hi];
        const hasConflict = mh.conflict || false;
        if (hasConflict) conflictCount++;
        else autoMergedCount++;

        const mhLines: any[] = mh.lines || [];
        let hunkLeftContent = '';
        let hunkRightContent = '';
        let hunkBaseContent = '';

        for (const line of mhLines) {
          if (typeof line === 'string') {
            const prefix = line[0];
            const content = line.slice(1);
            if (prefix === '-') {
              // In diff.merge: "mine" removals come from the left/theirs side
              hunkLeftContent += (hunkLeftContent ? '\n' : '') + content;
            } else if (prefix === '+') {
              hunkRightContent += (hunkRightContent ? '\n' : '') + content;
            } else {
              // Context line — belongs to base
              hunkBaseContent += (hunkBaseContent ? '\n' : '') + content;
            }
          } else if (line && typeof line === 'object' && line.conflict) {
            // Conflict object: { conflict: true, mine: string[], theirs: string[] }
            // With merge(left, right, base): mine = left/ours changes, theirs = right changes
            // Each entry is prefixed with '-' (removal from base) or '+' (addition from this side)
            const mineLines = (line.mine || []) as string[];
            const theirLines = (line.theirs || []) as string[];

            // mine = left side: '+' lines are what left wants to add
            for (const ml of mineLines) {
              if (typeof ml === 'string' && ml.startsWith('+')) {
                hunkLeftContent += (hunkLeftContent ? '\n' : '') + ml.slice(1);
              }
            }
            // theirs = right side: '+' lines are what right wants to add
            for (const tl of theirLines) {
              if (typeof tl === 'string' && tl.startsWith('+')) {
                hunkRightContent += (hunkRightContent ? '\n' : '') + tl.slice(1);
              }
            }
            // Base content from '-' lines (removals are what base had)
            for (const ml of mineLines) {
              if (typeof ml === 'string' && ml.startsWith('-')) {
                hunkBaseContent += (hunkBaseContent ? '\n' : '') + ml.slice(1);
              }
            }
          }
        }

        hunks.push({
          index: hi,
          conflict: hasConflict,
          baseContent: hunkBaseContent,
          leftContent: hunkLeftContent,
          rightContent: hunkRightContent,
          action: 'none',
          oldStart: mh.oldStart || 0,
          oldLines: mh.oldLines || 0,
        });
      }
    }

    // Build merged content: reconstruct from the merge result
    let mergedContent = '';
    if (typeof mergeResult === 'string') {
      mergedContent = mergeResult;
    } else if (mergedHunks.length > 0) {
      // Reconstruct merged content — for non-conflicting merges, apply left patch to base
      // For conflicting merges, provide base content with conflict markers
      try {
        const basePatch = Diff.createPatch('merged', baseContent, leftContent);
        const applied = Diff.applyPatch(baseContent, basePatch);
        mergedContent = typeof applied === 'string' ? applied : baseContent;
      } catch {
        mergedContent = baseContent; // fallback to base if patch fails
      }
    } else {
      mergedContent = leftContent; // fallback
    }

    const summary: MergeSummary = {
      totalHunks: hunks.length + (autoMergedCount > 0 ? 1 : 0),
      conflicts: conflictCount,
      resolved: hunks.filter(h => h.action !== 'none').length,
      autoMerged: autoMergedCount,
      riskFlags,
    };

    if (conflictCount > 10) riskFlags.push('many conflicts (>10)');

    session.mergeResult = {
      leftPath,
      rightPath,
      basePath,
      mergedContent,
      hunks,
      summary,
      allResolved: conflictCount === 0,
    };
    session.status = 'complete';
  } catch (err) {
    session.status = 'error';
    session.error = err instanceof Error ? err.message : String(err);
  }

  session.updatedAt = Date.now();
  return session;
}

// ─── Folder Compare ───

export function compareFolders(
  leftPath: string,
  rightPath: string,
  filters?: CompareFilters
): CompareSession {
  const session: CompareSession = {
    id: generateSessionId(),
    mode: 'folder',
    status: 'comparing',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    leftPath,
    rightPath,
    filters,
  };
  sessions.set(session.id, session);

  try {
    const recursive = filters?.recursive !== false; // default true
    const leftFiles = collectFiles(leftPath, '', recursive, filters);
    const rightFiles = collectFiles(rightPath, '', recursive, filters);

    const allPaths = new Set([...leftFiles.keys(), ...rightFiles.keys()]);
    const entries: FolderEntry[] = [];
    let identical = 0, different = 0, leftOnly = 0, rightOnly = 0, filtered = 0, errors = 0;
    const topChanged: Array<{ path: string; added: number; removed: number }> = [];

    for (const relPath of Array.from(allPaths).sort()) {
      const lInfo = leftFiles.get(relPath);
      const rInfo = rightFiles.get(relPath);

      if (matchesFilter(relPath, filters, 'exclude')) {
        filtered++;
        entries.push({
          relativePath: relPath,
          state: 'filtered',
          isDirectory: lInfo?.isDirectory || rInfo?.isDirectory || false,
        });
        continue;
      }

      if (lInfo && rInfo) {
        if (lInfo.isDirectory && rInfo.isDirectory) {
          identical++;
          entries.push({
            relativePath: relPath,
            state: 'identical',
            isDirectory: true,
          });
        } else if (lInfo.isDirectory !== rInfo.isDirectory) {
          // Type mismatch
          different++;
          entries.push({
            relativePath: relPath,
            state: 'different',
            isDirectory: false,
            leftSize: lInfo.size,
            rightSize: rInfo.size,
          });
        } else {
          // Both are files — compare content
          try {
            const lContent = readFileSafe(join(leftPath, relPath));
            const rContent = readFileSafe(join(rightPath, relPath));
            if (lContent === rContent) {
              identical++;
              entries.push({
                relativePath: relPath,
                state: 'identical',
                isDirectory: false,
                leftSize: lInfo.size,
                rightSize: rInfo.size,
                leftModified: lInfo.mtime,
                rightModified: rInfo.mtime,
              });
            } else {
              different++;
              // Quick diff summary (no full hunk detail — fetched on demand)
              const changes = Diff.diffLines(lContent, rContent);
              let added = 0, removed = 0;
              for (const c of changes) {
                const lineCount = (c.value.match(/\n/g) || []).length + (c.value.endsWith('\n') ? 0 : 1);
                if (c.added) added += lineCount;
                if (c.removed) removed += lineCount;
              }
              entries.push({
                relativePath: relPath,
                state: 'different',
                isDirectory: false,
                leftSize: lInfo.size,
                rightSize: rInfo.size,
                leftModified: lInfo.mtime,
                rightModified: rInfo.mtime,
                diffSummary: {
                  totalHunks: changes.filter(c => c.added || c.removed).length,
                  linesAdded: added,
                  linesRemoved: removed,
                  linesModified: Math.min(added, removed),
                  movedBlocks: 0,
                  riskFlags: [],
                },
              });
              if (topChanged.length < 20) {
                topChanged.push({ path: relPath, added, removed });
              }
            }
          } catch {
            errors++;
            entries.push({
              relativePath: relPath,
              state: 'error',
              isDirectory: false,
              leftSize: lInfo.size,
              rightSize: rInfo.size,
            });
          }
        }
      } else if (lInfo) {
        leftOnly++;
        entries.push({
          relativePath: relPath,
          state: 'left-only',
          isDirectory: lInfo.isDirectory,
          leftSize: lInfo.size,
          leftModified: lInfo.mtime,
        });
      } else {
        rightOnly++;
        entries.push({
          relativePath: relPath,
          state: 'right-only',
          isDirectory: rInfo!.isDirectory,
          rightSize: rInfo!.size,
          rightModified: rInfo!.mtime,
        });
      }
    }

    const riskFlags: string[] = [];
    if (different > 50) riskFlags.push('many different files (>50)');
    if (leftOnly > 20) riskFlags.push('many left-only files (>20)');
    if (rightOnly > 20) riskFlags.push('many right-only files (>20)');

    // Sort topChanged by total changes
    topChanged.sort((a, b) => (b.added + b.removed) - (a.added + a.removed));

    session.folderResult = {
      leftPath,
      rightPath,
      recursive,
      entries,
      summary: {
        totalEntries: entries.length,
        identical,
        different,
        leftOnly,
        rightOnly,
        filtered,
        errors,
        topChangedFiles: topChanged.slice(0, 10),
        riskFlags,
      },
    };
    session.status = 'complete';
  } catch (err) {
    session.status = 'error';
    session.error = err instanceof Error ? err.message : String(err);
  }

  session.updatedAt = Date.now();
  return session;
}

// ─── Sync Preview ───

export function syncPreview(
  sessionId: string,
  direction: SyncDirection
): SyncPreviewResult | null {
  const session = sessions.get(sessionId);
  if (!session || !session.folderResult) return null;

  const actions: SyncAction[] = [];
  const { entries } = session.folderResult;

  for (const entry of entries) {
    if (entry.state === 'filtered' || entry.state === 'error' || entry.isDirectory) continue;

    if (direction === 'left-to-right') {
      if (entry.state === 'left-only') {
        actions.push({
          relativePath: entry.relativePath,
          action: 'copy',
          danger: false,
          sourceSize: entry.leftSize,
        });
      } else if (entry.state === 'different') {
        actions.push({
          relativePath: entry.relativePath,
          action: 'overwrite',
          danger: true,
          sourceSize: entry.leftSize,
          targetSize: entry.rightSize,
        });
      } else if (entry.state === 'right-only') {
        actions.push({
          relativePath: entry.relativePath,
          action: 'delete',
          danger: true,
          targetSize: entry.rightSize,
        });
      }
    } else {
      // right-to-left
      if (entry.state === 'right-only') {
        actions.push({
          relativePath: entry.relativePath,
          action: 'copy',
          danger: false,
          sourceSize: entry.rightSize,
        });
      } else if (entry.state === 'different') {
        actions.push({
          relativePath: entry.relativePath,
          action: 'overwrite',
          danger: true,
          sourceSize: entry.rightSize,
          targetSize: entry.leftSize,
        });
      } else if (entry.state === 'left-only') {
        actions.push({
          relativePath: entry.relativePath,
          action: 'delete',
          danger: true,
          targetSize: entry.leftSize,
        });
      }
    }
  }

  const copies = actions.filter(a => a.action === 'copy').length;
  const overwrites = actions.filter(a => a.action === 'overwrite').length;
  const deletes = actions.filter(a => a.action === 'delete').length;
  const skips = actions.filter(a => a.action === 'skip').length;

  const dangerFlags: string[] = [];
  if (deletes > 0) dangerFlags.push(`${deletes} file(s) will be DELETED`);
  if (overwrites > 0) dangerFlags.push(`${overwrites} file(s) will be OVERWRITTEN`);

  const result: SyncPreviewResult = {
    direction,
    actions,
    summary: {
      totalActions: actions.length,
      copies,
      overwrites,
      deletes,
      skips,
      dangerFlags,
    },
  };

  session.syncPreview = result;
  session.updatedAt = Date.now();
  return result;
}

// ─── Hunk Actions ───

export function applyHunkAction(
  sessionId: string,
  hunkIndex: number,
  action: HunkAction
): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  if (session.fileResult) {
    const hunk = session.fileResult.hunks[hunkIndex];
    if (hunk) {
      hunk.action = action;
      session.updatedAt = Date.now();
      return true;
    }
  }

  if (session.mergeResult) {
    const hunk = session.mergeResult.hunks[hunkIndex];
    if (hunk) {
      hunk.action = action;
      if (action === 'apply-left') {
        hunk.resolvedContent = hunk.leftContent;
      } else if (action === 'apply-right') {
        hunk.resolvedContent = hunk.rightContent;
      } else if (action === 'apply-base') {
        hunk.resolvedContent = hunk.baseContent;
      }
      session.mergeResult.summary.resolved = session.mergeResult.hunks.filter(h => h.action !== 'none').length;
      session.mergeResult.allResolved = session.mergeResult.summary.resolved >= session.mergeResult.summary.conflicts;
      session.updatedAt = Date.now();
      return true;
    }
  }

  return false;
}

// ─── Get Hunk Detail (on-demand, token-efficient) ───

export function getHunkDetail(sessionId: string, hunkIndex: number): Hunk | MergeHunk | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (session.fileResult) {
    return session.fileResult.hunks[hunkIndex] || null;
  }
  if (session.mergeResult) {
    return session.mergeResult.hunks[hunkIndex] || null;
  }
  return null;
}

// ─── Get Folder Entry Detail (on-demand file diff) ───

export function getFolderEntryDiff(
  sessionId: string,
  relativePath: string
): FileCompareResult | null {
  const session = sessions.get(sessionId);
  if (!session || !session.folderResult) return null;

  const entry = session.folderResult.entries.find(e => e.relativePath === relativePath);
  if (!entry || entry.state !== 'different') return null;

  // Do full file compare on-demand
  const subSession = compareFiles(
    join(session.leftPath, relativePath),
    join(session.rightPath, relativePath),
    session.filters
  );
  return subSession.fileResult || null;
}

// ─── Token-Efficient Compact Output ───

export function getCompactOutput(
  sessionId: string,
  maxPreviewItems: number = 5
): CompareToolOutput | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (session.mode === 'file' && session.fileResult) {
    return {
      sessionId: session.id,
      mode: 'file',
      status: session.status,
      summary: session.fileResult.summary,
      preview: session.fileResult.hunks.slice(0, maxPreviewItems).map(h => ({
        index: h.index,
        oldStart: h.oldStart,
        newStart: h.newStart,
        linesAdded: h.lines.filter(l => l.type === 'add').length,
        linesRemoved: h.lines.filter(l => l.type === 'remove').length,
        action: h.action,
      })),
      totalItems: session.fileResult.hunks.length,
      actions: ['view-diff', 'apply-left', 'apply-right', 'explain-changes', 'open-workspace'],
    };
  }

  if (session.mode === 'merge3' && session.mergeResult) {
    return {
      sessionId: session.id,
      mode: 'merge3',
      status: session.status,
      summary: session.mergeResult.summary,
      preview: session.mergeResult.hunks.slice(0, maxPreviewItems).map(h => ({
        index: h.index,
        conflict: h.conflict,
        action: h.action,
      })),
      totalItems: session.mergeResult.hunks.length,
      actions: ['apply-left', 'apply-right', 'apply-base', 'resolve-all', 'explain-conflicts', 'open-workspace'],
    };
  }

  if (session.mode === 'folder' && session.folderResult) {
    return {
      sessionId: session.id,
      mode: 'folder',
      status: session.status,
      summary: session.folderResult.summary,
      preview: session.folderResult.entries
        .filter(e => e.state !== 'identical' && e.state !== 'filtered')
        .slice(0, maxPreviewItems)
        .map(e => ({
          path: e.relativePath,
          state: e.state,
          added: e.diffSummary?.linesAdded,
          removed: e.diffSummary?.linesRemoved,
        })),
      totalItems: session.folderResult.entries.filter(e => e.state !== 'identical' && e.state !== 'filtered').length,
      actions: ['view-details', 'sync-preview-ltr', 'sync-preview-rtl', 'filter', 'explain-changes', 'open-workspace'],
    };
  }

  return {
    sessionId: session.id,
    mode: session.mode,
    status: session.status,
    summary: { totalHunks: 0, linesAdded: 0, linesRemoved: 0, linesModified: 0, movedBlocks: 0, riskFlags: [] },
    preview: [],
    totalItems: 0,
    actions: [],
    error: session.error,
  };
}

// ─── Save Merge Result ───

export function saveMergeResult(sessionId: string, outputPath: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || !session.mergeResult) return false;

  try {
    writeFileSync(outputPath, session.mergeResult.mergedContent, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ─── Utility Functions ───

function readFileSafe(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

function computeWordDiff(lines: DiffLine[]): WordDiffSegment[][] {
  const pairs: WordDiffSegment[][] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type === 'remove' && i + 1 < lines.length && lines[i + 1].type === 'add') {
      const wordChanges = Diff.diffWords(lines[i].content, lines[i + 1].content);
      pairs.push(wordChanges.map(c => ({
        value: c.value,
        added: c.added || undefined,
        removed: c.removed || undefined,
      })));
      i += 2;
    } else {
      i++;
    }
  }
  return pairs;
}

function detectMovedBlocks(hunks: Hunk[]): MovedBlock[] {
  const moved: MovedBlock[] = [];
  // Simple moved-block detection: find hunks where removed lines
  // appear as added lines in another hunk
  const removedHunks: Array<{ index: number; lines: string[] }> = [];
  const addedHunks: Array<{ index: number; lines: string[] }> = [];

  for (const hunk of hunks) {
    const rm = hunk.lines.filter(l => l.type === 'remove').map(l => l.content.trim());
    const ad = hunk.lines.filter(l => l.type === 'add').map(l => l.content.trim());
    if (rm.length >= 3) removedHunks.push({ index: hunk.index, lines: rm });
    if (ad.length >= 3) addedHunks.push({ index: hunk.index, lines: ad });
  }

  for (const rmHunk of removedHunks) {
    for (const adHunk of addedHunks) {
      if (rmHunk.index === adHunk.index) continue;
      const matching = rmHunk.lines.filter(l => adHunk.lines.includes(l)).length;
      const similarity = matching / Math.max(rmHunk.lines.length, adHunk.lines.length);
      if (similarity >= 0.6 && matching >= 3) {
        moved.push({
          fromHunkIndex: rmHunk.index,
          toHunkIndex: adHunk.index,
          matchingLines: matching,
          similarity,
        });
      }
    }
  }
  return moved;
}

interface FileInfo {
  size: number;
  mtime: number;
  isDirectory: boolean;
}

function collectFiles(
  basePath: string,
  prefix: string,
  recursive: boolean,
  filters?: CompareFilters
): Map<string, FileInfo> {
  const result = new Map<string, FileInfo>();
  if (!existsSync(basePath)) return result;

  try {
    const entries = readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Skip common non-compare directories
      if (entry.isDirectory() && ['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) {
        continue;
      }

      if (matchesFilter(relPath, filters, 'exclude')) continue;
      if (filters?.includePatterns && filters.includePatterns.length > 0) {
        if (!entry.isDirectory() && !matchesFilter(relPath, filters, 'include')) continue;
      }

      const fullPath = join(basePath, entry.name);
      try {
        const stat = statSync(fullPath);
        result.set(relPath, {
          size: stat.size,
          mtime: stat.mtimeMs,
          isDirectory: entry.isDirectory(),
        });

        if (entry.isDirectory() && recursive) {
          const subFiles = collectFiles(fullPath, relPath, true, filters);
          for (const [subPath, subInfo] of subFiles) {
            result.set(subPath, subInfo);
          }
        }
      } catch {
        // Skip unreadable entries
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return result;
}

function matchesFilter(path: string, filters?: CompareFilters, kind?: 'include' | 'exclude'): boolean {
  if (!filters) return false;
  const patterns = kind === 'include' ? filters.includePatterns : filters.excludePatterns;
  if (!patterns || patterns.length === 0) return false;
  return patterns.some(p => minimatch(path, p, { dot: true }));
}
