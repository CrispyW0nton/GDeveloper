/**
 * multi_edit — Sprint 16
 * Atomic multi-edit tool: applies a list of {old_string, new_string, replace_all} edits
 * to a single file. All-or-none: if any old_string is not found, no edits are applied.
 * Returns a unified diff of the changes.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getDatabase } from '../db';

export interface EditOp {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface MultiEditInput {
  file_path: string;
  edits: EditOp[];
}

export interface MultiEditResult {
  success: boolean;
  file_path: string;
  edit_count: number;
  applied: number;
  diff: string;
  error?: string;
}

/**
 * Generate a simple unified-diff-style representation
 */
function generateDiff(filePath: string, oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diffLines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++; j++;
      continue;
    }
    // Find the hunk
    const hunkStartOld = Math.max(0, i - 2);
    const hunkStartNew = Math.max(0, j - 2);

    // Collect changed region
    const changedOld: string[] = [];
    const changedNew: string[] = [];

    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        break;
      }
      if (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
        changedOld.push(oldLines[i]);
        i++;
      }
      if (j < newLines.length && (i > oldLines.length || (changedOld.length > 0 && changedNew.length < changedOld.length + 5))) {
        changedNew.push(newLines[j]);
        j++;
      }
      if (changedOld.length > 50 || changedNew.length > 50) break;
    }

    if (changedOld.length > 0 || changedNew.length > 0) {
      diffLines.push(`@@ -${hunkStartOld + 1},${changedOld.length} +${hunkStartNew + 1},${changedNew.length} @@`);
      for (const line of changedOld) diffLines.push(`-${line}`);
      for (const line of changedNew) diffLines.push(`+${line}`);
    }
  }

  return diffLines.length > 2 ? diffLines.join('\n') : '(no visible diff)';
}

/**
 * Execute multi_edit: atomic, sequential, all-or-none edits on a single file.
 */
export function executeMultiEdit(
  workspacePath: string,
  resolveSafe: (ws: string, fp: string) => string,
  input: MultiEditInput
): MultiEditResult {
  const { file_path, edits } = input;

  if (!file_path) {
    return { success: false, file_path: '', edit_count: 0, applied: 0, diff: '', error: 'file_path is required' };
  }
  if (!edits || !Array.isArray(edits) || edits.length === 0) {
    return { success: false, file_path, edit_count: 0, applied: 0, diff: '', error: 'edits array is required and must not be empty' };
  }

  const absPath = resolveSafe(workspacePath, file_path);

  // Read or create
  let content: string;
  if (existsSync(absPath)) {
    content = readFileSync(absPath, 'utf-8');
  } else if (edits[0].old_string === '') {
    // Creating a new file — first edit has empty old_string (insert content)
    const dir = dirname(absPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    content = '';
  } else {
    return { success: false, file_path, edit_count: edits.length, applied: 0, diff: '', error: `File not found: ${file_path}` };
  }

  const originalContent = content;

  // Validate all edits first (all-or-none)
  let simContent = content;
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    if (edit.old_string === '' && edit.new_string !== '') {
      // Insert/append — always valid
      simContent += edit.new_string;
      continue;
    }
    if (!simContent.includes(edit.old_string)) {
      return {
        success: false,
        file_path,
        edit_count: edits.length,
        applied: 0,
        diff: '',
        error: `Edit #${i + 1} failed: old_string not found in file (after previous edits applied).\nSearched for: "${edit.old_string.substring(0, 120)}${edit.old_string.length > 120 ? '...' : ''}"`
      };
    }
    if (edit.replace_all) {
      simContent = simContent.split(edit.old_string).join(edit.new_string);
    } else {
      simContent = simContent.replace(edit.old_string, edit.new_string);
    }
  }

  // Apply edits for real
  let result = content;
  for (const edit of edits) {
    if (edit.old_string === '' && edit.new_string !== '') {
      result += edit.new_string;
      continue;
    }
    if (edit.replace_all) {
      result = result.split(edit.old_string).join(edit.new_string);
    } else {
      result = result.replace(edit.old_string, edit.new_string);
    }
  }

  // Write
  writeFileSync(absPath, result, 'utf-8');

  // Record diff in DB
  try {
    const db = getDatabase();
    db.addDiff('system', null, file_path, originalContent, result);
  } catch { /* ignore */ }

  const diff = generateDiff(file_path, originalContent, result);

  return {
    success: true,
    file_path,
    edit_count: edits.length,
    applied: edits.length,
    diff,
  };
}
