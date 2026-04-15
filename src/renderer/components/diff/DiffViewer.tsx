import React, { useState, useEffect } from 'react';
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

export default function DiffViewer({ repo, sessionId }: DiffViewerProps) {
  const [diffs, setDiffs] = useState<DiffRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const loadDiffs = async () => {
    if (!api) { setLoading(false); return; }
    try {
      const result = await api.getDiffs(sessionId);
      setDiffs(result || []);
      if (result && result.length > 0 && !selectedFile) {
        setSelectedFile(result[0].file_path);
      }
    } catch (err) {
      console.error('Failed to load diffs:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDiffs();
    const interval = setInterval(loadDiffs, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-matrix-border flex items-center justify-between">
        <h2 className="text-sm font-bold text-matrix-green glow-text-dim flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18M3 12h18"/></svg>
          Diff View
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-matrix-text-muted/30">{diffs.length} file(s) changed</span>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="w-5 h-5 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin inline-block" />
            <p className="text-xs text-matrix-text-muted/40 mt-2">Loading diffs...</p>
          </div>
        </div>
      ) : diffs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto text-matrix-text-muted/20 mb-3"><path d="M12 3v18M3 12h18"/></svg>
            <p className="text-xs text-matrix-text-muted/30">No diffs recorded yet</p>
            <p className="text-[10px] text-matrix-text-muted/20 mt-1">File changes from AI tasks will appear here</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* File List */}
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
                  onClick={() => setSelectedFile(diff.file_path)}
                  className={`w-full px-3 py-2 text-left text-xs transition-all border-b border-matrix-border/20 ${
                    selectedFile === diff.file_path ? 'bg-matrix-green/5 border-l-2 border-l-matrix-green' : 'hover:bg-matrix-bg-hover'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-matrix-text-dim truncate">{diff.file_path}</span>
                    <span className={`badge text-[8px] ${
                      isDel ? 'badge-blocked' : isNew ? 'badge-done' : 'badge-planned'
                    }`}>{isDel ? 'deleted' : isNew ? 'created' : 'modified'}</span>
                  </div>
                  <div className="text-[10px] text-matrix-text-muted/30 mt-0.5">
                    {new Date(diff.created_at).toLocaleTimeString()}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Diff Content */}
          <div className="flex-1 overflow-auto font-mono text-xs">
            {selectedDiff ? (
              <div className="p-1">
                <div className="px-3 py-1 text-matrix-info/50 bg-matrix-info/5 text-[10px]">
                  {selectedDiff.file_path}
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
              <div className="h-full flex items-center justify-center text-matrix-text-muted/30 text-xs">
                Select a file to view diff
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
