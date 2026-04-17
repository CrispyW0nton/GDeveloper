/**
 * DiffViewer — Sprint 15.2 + Sprint 18
 * Shows file changes from agent tool calls AND live git diff.
 * Tracks write_file, patch_file, multi_edit, and run_command edits.
 * Falls back to live git diff when DB diffs are empty but git status shows changes.
 * Sprint 18: improved labels, clearer empty states, file change badges,
 * timestamp display, source labels (AI vs Git), better contrast.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { SelectedRepo } from '../../store';

const api = (window as any).electronAPI;

interface DiffViewerProps {
  repo: SelectedRepo;
  sessionId?: string;
}

interface DiffRecord {
  id: string;
  session_id: string;
  task_id: string | null;
  file_path: string;
  old_content: string;
  new_content: string;
  status: string;
  created_at: string;
}

interface DiffLine {
  type: 'add' | 'del' | 'context';
  lineNumber: number;
  content: string;
}

function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export default function DiffViewer({ repo, sessionId }: DiffViewerProps) {
  const [diffs, setDiffs] = useState<DiffRecord[]>([]);
  const [gitDiffText, setGitDiffText] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showGitDiff, setShowGitDiff] = useState(false);

  const loadDiffs = useCallback(async () => {
    if (!api) { setLoading(false); return; }
    try {
      // Load DB-recorded diffs (from session AND from 'system' session)
      const result = await api.getDiffs(sessionId);
      let allDiffs = result || [];

      // Also load system-session diffs (tools use 'system' as session_id)
      if (sessionId && sessionId !== 'system') {
        try {
          const systemDiffs = await api.getDiffs('system');
          if (systemDiffs && systemDiffs.length > 0) {
            // Merge, dedup by id
            const ids = new Set(allDiffs.map((d: DiffRecord) => d.id));
            for (const sd of systemDiffs) {
              if (!ids.has(sd.id)) {
                allDiffs.push(sd);
                ids.add(sd.id);
              }
            }
          }
        } catch { /* ignore */ }
      }

      // Sort by created_at descending
      allDiffs.sort((a: DiffRecord, b: DiffRecord) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setDiffs(allDiffs);
      if (allDiffs.length > 0 && !selectedFile) {
        setSelectedFile(allDiffs[0].file_path);
      }

      // Sprint 15.2: Also fetch live git diff to fill in gaps
      if (api.gitDiff) {
        try {
          const gitResult = await api.gitDiff(false);
          if (gitResult.success && gitResult.diff && gitResult.diff !== '(no changes)') {
            setGitDiffText(gitResult.diff);
            // If DB diffs are empty but git shows changes, auto-show git diff
            if (allDiffs.length === 0) {
              setShowGitDiff(true);
            }
          } else {
            setGitDiffText('');
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error('Failed to load diffs:', err);
    }
    setLoading(false);
  }, [sessionId, selectedFile]);

  useEffect(() => {
    loadDiffs();
    const interval = setInterval(loadDiffs, 5000);
    return () => clearInterval(interval);
  }, [sessionId, loadDiffs]);

  const selectedDiff = diffs.find(d => d.file_path === selectedFile);

  // Compute diff lines from old and new content
  const computeDiffLines = (record: DiffRecord): DiffLine[] => {
    const oldLines = (record.old_content || '').split('\n');
    const newLines = (record.new_content || '').split('\n');
    const lines: DiffLine[] = [];

    if (!record.old_content && record.new_content) {
      // New file
      newLines.forEach((line, i) => {
        lines.push({ type: 'add', lineNumber: i + 1, content: line });
      });
    } else if (record.old_content && !record.new_content) {
      // Deleted file
      oldLines.forEach((line, i) => {
        lines.push({ type: 'del', lineNumber: i + 1, content: line });
      });
    } else {
      // Simple line-by-line diff
      const maxLen = Math.max(oldLines.length, newLines.length);
      for (let i = 0; i < maxLen; i++) {
        if (i >= oldLines.length) {
          lines.push({ type: 'add', lineNumber: i + 1, content: newLines[i] });
        } else if (i >= newLines.length) {
          lines.push({ type: 'del', lineNumber: i + 1, content: oldLines[i] });
        } else if (oldLines[i] !== newLines[i]) {
          lines.push({ type: 'del', lineNumber: i + 1, content: oldLines[i] });
          lines.push({ type: 'add', lineNumber: i + 1, content: newLines[i] });
        } else {
          lines.push({ type: 'context', lineNumber: i + 1, content: oldLines[i] });
        }
      }
    }
    return lines;
  };

  const addedCount = diffs.filter(d => !d.old_content).length;
  const deletedCount = diffs.filter(d => !d.new_content).length;
  const modifiedCount = diffs.filter(d => d.old_content && d.new_content).length;

  return (
    <div className="h-full flex flex-col">
      {/* Header — Sprint 18: improved labels and stats */}
      <div className="px-4 py-3 border-b border-matrix-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-matrix-green glow-text-dim flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18M3 12h18"/></svg>
            File Changes
          </h2>
          <span className="text-[10px] text-matrix-text-muted/40">{repo.fullName}</span>
        </div>
        <div className="flex items-center gap-3">
          {diffs.length > 0 && (
            <div className="flex gap-1.5 text-[9px]">
              {addedCount > 0 && <span className="px-1.5 py-0.5 rounded-full border border-matrix-green/20 text-matrix-green/60 bg-matrix-green/5">{addedCount} added</span>}
              {modifiedCount > 0 && <span className="px-1.5 py-0.5 rounded-full border border-yellow-400/20 text-yellow-400/60 bg-yellow-400/5">{modifiedCount} modified</span>}
              {deletedCount > 0 && <span className="px-1.5 py-0.5 rounded-full border border-red-400/20 text-red-400/60 bg-red-400/5">{deletedCount} deleted</span>}
            </div>
          )}
          {gitDiffText && (
            <button
              onClick={() => setShowGitDiff(!showGitDiff)}
              className={`text-[9px] px-2 py-1 rounded-full border transition-all ${showGitDiff ? 'border-matrix-green/40 text-matrix-green bg-matrix-green/10 font-bold' : 'border-matrix-border/30 text-matrix-text-muted/40 hover:text-matrix-text-dim'}`}
              title="Toggle between AI-tracked changes and live git diff"
            >
              {showGitDiff ? 'Showing: Git Diff' : 'Showing: AI Changes'}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="w-5 h-5 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin inline-block" />
            <p className="text-xs text-matrix-text-muted/40 mt-2">Loading changes...</p>
          </div>
        </div>
      ) : diffs.length === 0 && !gitDiffText ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto text-matrix-text-muted/15 mb-3"><path d="M12 3v18M3 12h18"/></svg>
            <p className="text-sm text-matrix-text-muted/40 font-bold mb-1">No changes yet</p>
            <p className="text-[10px] text-matrix-text-muted/25 leading-relaxed">
              When the AI writes or edits files, the before/after diff appears here.
              You can also toggle the live git diff to see uncommitted changes.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* File List Sidebar */}
          <div className="w-64 border-r border-matrix-border overflow-y-auto">
            <div className="p-2 text-[10px] text-matrix-text-muted/40 uppercase tracking-wider">
              Changed Files ({diffs.length})
            </div>
            {diffs.map(diff => {
              const isNew = !diff.old_content;
              const isDel = !diff.new_content;
              return (
                <button
                  key={diff.id}
                  onClick={() => { setSelectedFile(diff.file_path); setShowGitDiff(false); }}
                  className={`w-full px-3 py-2.5 text-left text-xs transition-all border-b border-matrix-border/10 ${
                    selectedFile === diff.file_path && !showGitDiff ? 'bg-matrix-green/5 border-l-2 border-l-matrix-green' : 'hover:bg-matrix-bg-hover border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-matrix-text-dim truncate flex-1 font-mono text-[11px]">{diff.file_path}</span>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full border ml-2 ${
                      isDel ? 'border-red-400/20 text-red-400/60 bg-red-400/5' :
                      isNew ? 'border-matrix-green/20 text-matrix-green/60 bg-matrix-green/5' :
                      'border-yellow-400/20 text-yellow-400/60 bg-yellow-400/5'
                    }`}>{isDel ? 'deleted' : isNew ? 'created' : 'modified'}</span>
                  </div>
                  <div className="text-[9px] text-matrix-text-muted/25 mt-0.5 flex items-center gap-1.5">
                    <span className="inline-block w-1 h-1 rounded-full bg-blue-400/30" />
                    AI change &middot; {relativeTime(diff.created_at)}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Diff Content */}
          <div className="flex-1 overflow-auto font-mono text-xs">
            {showGitDiff && gitDiffText ? (
              /* Sprint 15.2: Raw git diff view */
              <div className="p-1">
                <div className="px-3 py-1.5 text-matrix-info/60 bg-matrix-info/5 text-[10px] flex items-center gap-2 border-b border-matrix-info/10">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-matrix-info/40" />
                  Live Git Diff (working tree) &mdash; shows all uncommitted changes
                </div>
                {gitDiffText.split('\n').map((line, li) => (
                  <div key={li} className={`px-3 py-0.5 ${
                    line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' :
                    line.startsWith('-') && !line.startsWith('---') ? 'diff-del' :
                    line.startsWith('@@') ? 'text-matrix-info/70 bg-matrix-info/5' :
                    line.startsWith('diff ') || line.startsWith('index ') ? 'text-matrix-text-muted/50 font-bold' :
                    'diff-context'
                  }`}>
                    {line}
                  </div>
                ))}
              </div>
            ) : selectedDiff ? (
              <div className="p-1">
                <div className="px-3 py-1.5 text-matrix-info/60 bg-matrix-info/5 text-[10px] flex items-center gap-2 border-b border-matrix-info/10">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400/40" />
                  {selectedDiff.file_path} &mdash; AI-tracked change
                </div>
                {computeDiffLines(selectedDiff).map((line, li) => (
                  <div key={li} className={`px-3 py-0.5 flex ${
                    line.type === 'add' ? 'diff-add' : line.type === 'del' ? 'diff-del' : 'diff-context'
                  }`}>
                    <span className="w-8 text-right mr-3 text-matrix-text-muted/20 select-none">{line.lineNumber}</span>
                    <span className="flex-1">{line.content}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-matrix-text-muted/25 text-xs">
                Select a file to view its diff
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
