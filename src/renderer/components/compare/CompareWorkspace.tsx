/**
 * CompareWorkspace — Sprint 27
 * Dedicated workspace for Compare sessions.
 * Supports 2-pane file compare, 3-pane merge, folder tree view,
 * hunk navigation, apply controls, and filter bar.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

const api = (window as any).electronAPI;

interface CompareWorkspaceProps {
  sessionId: string;
  onClose?: () => void;
}

export default function CompareWorkspace({ sessionId, onClose }: CompareWorkspaceProps) {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeHunkIdx, setActiveHunkIdx] = useState(0);
  const [filterText, setFilterText] = useState('');
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('split');
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [entryDiff, setEntryDiff] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load session
  useEffect(() => {
    if (!api?.compareGetSession) return;
    setLoading(true);
    api.compareGetSession(sessionId).then((s: any) => {
      setSession(s);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [sessionId]);

  // Refresh session after actions
  const refreshSession = useCallback(async () => {
    if (!api?.compareGetSession) return;
    const s = await api.compareGetSession(sessionId);
    setSession(s);
  }, [sessionId]);

  // Navigate hunks
  const navigateHunk = useCallback((direction: 'next' | 'prev') => {
    if (!session) return;
    const hunks = session.fileResult?.hunks || session.mergeResult?.hunks || [];
    if (hunks.length === 0) return;
    setActiveHunkIdx(prev => {
      const next = direction === 'next'
        ? Math.min(prev + 1, hunks.length - 1)
        : Math.max(prev - 1, 0);
      return next;
    });
  }, [session]);

  // Apply hunk action
  const handleApplyAction = useCallback(async (hunkIndex: number, action: string) => {
    if (!api?.compareHunkAction) return;
    await api.compareHunkAction(sessionId, hunkIndex, action);
    await refreshSession();
  }, [sessionId, refreshSession]);

  // Load folder entry diff on-demand
  const handleSelectEntry = useCallback(async (relativePath: string) => {
    setSelectedEntry(relativePath);
    if (!api?.compareFolderEntryDiff) return;
    const diff = await api.compareFolderEntryDiff(sessionId, relativePath);
    setEntryDiff(diff);
  }, [sessionId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'j') navigateHunk('next');
      if (e.key === 'ArrowUp' || e.key === 'k') navigateHunk('prev');
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigateHunk, onClose]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-matrix-text-muted/50">
        <span className="w-5 h-5 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin mr-2" />
        Loading compare session...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-full flex items-center justify-center text-matrix-text-muted/50">
        Session not found: {sessionId}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-matrix-bg overflow-hidden">
      {/* Header bar */}
      <WorkspaceHeader
        session={session}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onClose={onClose}
      />

      {/* Filter bar */}
      <FilterBar
        value={filterText}
        onChange={setFilterText}
        mode={session.mode}
      />

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex">
        {session.mode === 'folder' ? (
          <FolderView
            session={session}
            filterText={filterText}
            selectedEntry={selectedEntry}
            entryDiff={entryDiff}
            onSelectEntry={handleSelectEntry}
          />
        ) : session.mode === 'merge3' ? (
          <MergeView
            session={session}
            activeHunkIdx={activeHunkIdx}
            onNavigateHunk={navigateHunk}
            onApplyAction={handleApplyAction}
          />
        ) : (
          <FileCompareView
            session={session}
            activeHunkIdx={activeHunkIdx}
            viewMode={viewMode}
            filterText={filterText}
            onNavigateHunk={navigateHunk}
            onApplyAction={handleApplyAction}
          />
        )}
      </div>

      {/* Hunk navigator footer */}
      {session.mode !== 'folder' && (
        <HunkNavigator
          hunks={session.fileResult?.hunks || session.mergeResult?.hunks || []}
          activeIndex={activeHunkIdx}
          onNavigate={navigateHunk}
          onJump={setActiveHunkIdx}
          onApply={handleApplyAction}
        />
      )}
    </div>
  );
}

// ─── Header ───

function WorkspaceHeader({ session, viewMode, onViewModeChange, onClose }: {
  session: any; viewMode: string; onViewModeChange: (v: 'unified' | 'split') => void; onClose?: () => void;
}) {
  const modeLabel = session.mode === 'file' ? 'File Compare'
    : session.mode === 'merge3' ? '3-Way Merge'
    : 'Folder Compare';

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-matrix-border/20 bg-matrix-bg-elevated/50">
      <span className="text-sm">{session.mode === 'folder' ? '\uD83D\uDCC1' : session.mode === 'merge3' ? '\uD83D\uDD00' : '\u00B1'}</span>
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-bold text-matrix-green">{modeLabel}</span>
        <span className="text-[9px] text-matrix-text-muted/40 ml-2 font-mono">{session.id}</span>
      </div>

      {session.mode !== 'folder' && (
        <div className="flex items-center gap-1 text-[9px]">
          <button
            onClick={() => onViewModeChange('unified')}
            className={`px-2 py-0.5 rounded ${viewMode === 'unified' ? 'bg-matrix-green/10 text-matrix-green' : 'text-matrix-text-muted/40 hover:text-matrix-text-dim'}`}
          >
            Unified
          </button>
          <button
            onClick={() => onViewModeChange('split')}
            className={`px-2 py-0.5 rounded ${viewMode === 'split' ? 'bg-matrix-green/10 text-matrix-green' : 'text-matrix-text-muted/40 hover:text-matrix-text-dim'}`}
          >
            Split
          </button>
        </div>
      )}

      {session.mode === 'file' && session.fileResult && (
        <div className="text-[9px] text-matrix-text-muted/40">
          <span className="text-matrix-green">+{session.fileResult.summary.linesAdded}</span>
          {' / '}
          <span className="text-matrix-danger">-{session.fileResult.summary.linesRemoved}</span>
          {' | '}
          {session.fileResult.summary.totalHunks} hunks
        </div>
      )}

      {onClose && (
        <button
          onClick={onClose}
          className="text-matrix-text-muted/40 hover:text-matrix-text-dim text-[10px] px-2 py-0.5 rounded hover:bg-matrix-bg-hover"
          title="Close Compare Workspace (Esc)"
        >
          Close
        </button>
      )}
    </div>
  );
}

// ─── Filter Bar ───

function FilterBar({ value, onChange, mode }: { value: string; onChange: (v: string) => void; mode: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-matrix-border/10 bg-matrix-bg-elevated/30">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-matrix-text-muted/30">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={mode === 'folder' ? 'Filter files by name...' : 'Filter lines...'}
        className="flex-1 bg-transparent text-[10px] text-matrix-text-dim placeholder:text-matrix-text-muted/30 outline-none"
      />
      {value && (
        <button onClick={() => onChange('')} className="text-[9px] text-matrix-text-muted/40 hover:text-matrix-text-dim">
          clear
        </button>
      )}
    </div>
  );
}

// ─── File Compare View (2-pane) ───

function FileCompareView({ session, activeHunkIdx, viewMode, filterText, onNavigateHunk, onApplyAction }: {
  session: any; activeHunkIdx: number; viewMode: string; filterText: string;
  onNavigateHunk: (d: 'next' | 'prev') => void; onApplyAction: (idx: number, action: string) => void;
}) {
  const result = session.fileResult;
  if (!result) return <div className="p-4 text-matrix-text-muted/40">No file compare data</div>;

  if (result.identical) {
    return (
      <div className="flex-1 flex items-center justify-center text-matrix-green text-sm">
        <span className="mr-2">{'\u2705'}</span> Files are identical
      </div>
    );
  }

  const hunks = result.hunks || [];
  const activeHunk = hunks[activeHunkIdx];

  if (viewMode === 'unified') {
    return (
      <div className="flex-1 overflow-auto p-3 font-mono text-[10px]">
        {hunks.map((hunk: any, hi: number) => (
          <div key={hi} className={`mb-4 rounded border ${hi === activeHunkIdx ? 'border-matrix-green/30 ring-1 ring-matrix-green/20' : 'border-matrix-border/10'}`}>
            <div className="px-2 py-1 bg-matrix-bg-elevated/50 text-matrix-text-muted/40 text-[9px] flex items-center justify-between">
              <span>@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
              <span className={`text-[8px] uppercase ${hunk.action !== 'none' ? 'text-matrix-green font-bold' : 'text-matrix-text-muted/30'}`}>
                {hunk.action !== 'none' ? hunk.action : `hunk ${hunk.index}`}
              </span>
            </div>
            {hunk.lines.map((line: any, li: number) => {
              if (filterText && !line.content.toLowerCase().includes(filterText.toLowerCase())) return null;
              return (
                <div key={li} className={`px-2 ${
                  line.type === 'add' ? 'bg-matrix-green/5 text-matrix-green' :
                  line.type === 'remove' ? 'bg-matrix-danger/5 text-matrix-danger' :
                  'text-matrix-text-muted/40'
                }`}>
                  <span className="inline-block w-10 text-right text-matrix-text-muted/20 mr-2 select-none">
                    {line.oldLineNumber || ''}{line.oldLineNumber && line.newLineNumber ? '/' : ''}{line.newLineNumber || ''}
                  </span>
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}{line.content}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  // Split view
  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left pane */}
      <div className="flex-1 overflow-auto border-r border-matrix-border/20 font-mono text-[10px]">
        <div className="px-2 py-1 bg-matrix-bg-elevated/50 text-[9px] text-matrix-text-muted/40 border-b border-matrix-border/10 sticky top-0">
          Left: {result.leftPath.split('/').pop()}
        </div>
        {hunks.map((hunk: any, hi: number) => (
          <div key={hi} className={hi === activeHunkIdx ? 'bg-matrix-green/3' : ''}>
            {hunk.lines.filter((l: any) => l.type !== 'add').map((line: any, li: number) => (
              <div key={li} className={`px-2 ${line.type === 'remove' ? 'bg-matrix-danger/8 text-matrix-danger' : 'text-matrix-text-muted/40'}`}>
                <span className="inline-block w-8 text-right text-matrix-text-muted/20 mr-2 select-none">
                  {line.oldLineNumber || ''}
                </span>
                {line.content}
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Right pane */}
      <div className="flex-1 overflow-auto font-mono text-[10px]">
        <div className="px-2 py-1 bg-matrix-bg-elevated/50 text-[9px] text-matrix-text-muted/40 border-b border-matrix-border/10 sticky top-0">
          Right: {result.rightPath.split('/').pop()}
        </div>
        {hunks.map((hunk: any, hi: number) => (
          <div key={hi} className={hi === activeHunkIdx ? 'bg-matrix-green/3' : ''}>
            {hunk.lines.filter((l: any) => l.type !== 'remove').map((line: any, li: number) => (
              <div key={li} className={`px-2 ${line.type === 'add' ? 'bg-matrix-green/8 text-matrix-green' : 'text-matrix-text-muted/40'}`}>
                <span className="inline-block w-8 text-right text-matrix-text-muted/20 mr-2 select-none">
                  {line.newLineNumber || ''}
                </span>
                {line.content}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 3-Pane Merge View ───

function MergeView({ session, activeHunkIdx, onNavigateHunk, onApplyAction }: {
  session: any; activeHunkIdx: number;
  onNavigateHunk: (d: 'next' | 'prev') => void;
  onApplyAction: (idx: number, action: string) => void;
}) {
  const result = session.mergeResult;
  if (!result) return <div className="p-4 text-matrix-text-muted/40">No merge data</div>;

  if (result.allResolved && (!result.hunks || result.hunks.length === 0)) {
    return (
      <div className="flex-1 flex items-center justify-center text-matrix-green text-sm">
        <span className="mr-2">{'\u2705'}</span> Clean merge — no conflicts
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left pane */}
      <div className="flex-1 overflow-auto border-r border-matrix-border/20 font-mono text-[10px]">
        <div className="px-2 py-1 bg-blue-400/10 text-[9px] text-blue-400/70 border-b border-matrix-border/10 sticky top-0">
          Left (ours)
        </div>
        {(result.hunks || []).map((h: any, i: number) => (
          <div key={i} className={`p-2 border-b border-matrix-border/10 ${i === activeHunkIdx ? 'bg-matrix-green/3' : ''} ${h.conflict ? 'bg-matrix-danger/3' : ''}`}>
            <pre className="whitespace-pre-wrap text-matrix-text-dim">{h.leftContent || '(empty)'}</pre>
          </div>
        ))}
      </div>
      {/* Base pane */}
      <div className="flex-1 overflow-auto border-r border-matrix-border/20 font-mono text-[10px]">
        <div className="px-2 py-1 bg-matrix-bg-elevated/50 text-[9px] text-matrix-text-muted/40 border-b border-matrix-border/10 sticky top-0">
          Base (ancestor)
        </div>
        {(result.hunks || []).map((h: any, i: number) => (
          <div key={i} className={`p-2 border-b border-matrix-border/10 ${i === activeHunkIdx ? 'bg-matrix-green/3' : ''}`}>
            <pre className="whitespace-pre-wrap text-matrix-text-muted/40">{h.baseContent || '(empty)'}</pre>
          </div>
        ))}
      </div>
      {/* Right pane */}
      <div className="flex-1 overflow-auto font-mono text-[10px]">
        <div className="px-2 py-1 bg-purple-400/10 text-[9px] text-purple-400/70 border-b border-matrix-border/10 sticky top-0">
          Right (theirs)
        </div>
        {(result.hunks || []).map((h: any, i: number) => (
          <div key={i} className={`p-2 border-b border-matrix-border/10 ${i === activeHunkIdx ? 'bg-matrix-green/3' : ''} ${h.conflict ? 'bg-matrix-danger/3' : ''}`}>
            <pre className="whitespace-pre-wrap text-matrix-text-dim">{h.rightContent || '(empty)'}</pre>
            {h.conflict && (
              <div className="flex gap-1 mt-1">
                <button onClick={() => onApplyAction(i, 'apply-left')} className="text-[8px] px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400 hover:bg-blue-400/20">Use Left</button>
                <button onClick={() => onApplyAction(i, 'apply-base')} className="text-[8px] px-1.5 py-0.5 rounded bg-matrix-bg-hover text-matrix-text-muted/50 hover:bg-matrix-bg-elevated">Use Base</button>
                <button onClick={() => onApplyAction(i, 'apply-right')} className="text-[8px] px-1.5 py-0.5 rounded bg-purple-400/10 text-purple-400 hover:bg-purple-400/20">Use Right</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Folder View ───

function FolderView({ session, filterText, selectedEntry, entryDiff, onSelectEntry }: {
  session: any; filterText: string; selectedEntry: string | null; entryDiff: any;
  onSelectEntry: (path: string) => void;
}) {
  const result = session.folderResult;
  if (!result) return <div className="p-4 text-matrix-text-muted/40">No folder compare data</div>;

  const entries = (result.entries || []).filter((e: any) => {
    if (e.state === 'filtered') return false;
    if (filterText && !e.relativePath.toLowerCase().includes(filterText.toLowerCase())) return false;
    return true;
  });

  const stateIcons: Record<string, string> = {
    identical: '\u2705',
    different: '\u270F\uFE0F',
    'left-only': '\u25C0\uFE0F',
    'right-only': '\u25B6\uFE0F',
    error: '\u274C',
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* File tree / table */}
      <div className={`${selectedEntry ? 'w-80' : 'flex-1'} overflow-auto border-r border-matrix-border/20`}>
        <table className="w-full text-[10px]">
          <thead className="sticky top-0 bg-matrix-bg-elevated/80 text-[9px] text-matrix-text-muted/40">
            <tr>
              <th className="text-left px-2 py-1">{'\u00A0'}</th>
              <th className="text-left px-2 py-1">File</th>
              <th className="text-right px-2 py-1">Left</th>
              <th className="text-right px-2 py-1">Right</th>
              <th className="text-right px-2 py-1">Changes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry: any) => (
              <tr
                key={entry.relativePath}
                onClick={() => entry.state === 'different' && onSelectEntry(entry.relativePath)}
                className={`border-b border-matrix-border/5 ${
                  entry.state === 'different' ? 'cursor-pointer hover:bg-matrix-bg-hover/40' : ''
                } ${selectedEntry === entry.relativePath ? 'bg-matrix-green/5' : ''}`}
              >
                <td className="px-2 py-1 text-center">
                  {stateIcons[entry.state] || ''}
                </td>
                <td className="px-2 py-1 font-mono text-matrix-text-dim truncate max-w-[200px]">
                  {entry.isDirectory ? '\uD83D\uDCC1 ' : ''}{entry.relativePath}
                </td>
                <td className="px-2 py-1 text-right text-matrix-text-muted/30">
                  {entry.leftSize ? formatSize(entry.leftSize) : '\u2014'}
                </td>
                <td className="px-2 py-1 text-right text-matrix-text-muted/30">
                  {entry.rightSize ? formatSize(entry.rightSize) : '\u2014'}
                </td>
                <td className="px-2 py-1 text-right">
                  {entry.diffSummary ? (
                    <span>
                      <span className="text-matrix-green">+{entry.diffSummary.linesAdded}</span>
                      {' / '}
                      <span className="text-matrix-danger">-{entry.diffSummary.linesRemoved}</span>
                    </span>
                  ) : (
                    <span className={
                      entry.state === 'identical' ? 'text-matrix-green/40' :
                      entry.state === 'left-only' ? 'text-blue-400/60' :
                      entry.state === 'right-only' ? 'text-purple-400/60' :
                      'text-matrix-text-muted/30'
                    }>{entry.state}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail pane (file diff for selected entry) */}
      {selectedEntry && (
        <div className="flex-1 overflow-auto font-mono text-[10px]">
          <div className="px-2 py-1 bg-matrix-bg-elevated/50 text-[9px] text-matrix-text-muted/40 border-b border-matrix-border/10 sticky top-0 flex items-center justify-between">
            <span>{selectedEntry}</span>
            <button onClick={() => onSelectEntry('')} className="text-matrix-text-muted/40 hover:text-matrix-text-dim">
              close
            </button>
          </div>
          {entryDiff ? (
            entryDiff.hunks?.map((hunk: any, hi: number) => (
              <div key={hi} className="mb-2">
                <div className="px-2 py-0.5 bg-matrix-bg-elevated/30 text-matrix-text-muted/30 text-[9px]">
                  @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                </div>
                {hunk.lines?.map((line: any, li: number) => (
                  <div key={li} className={`px-2 ${
                    line.type === 'add' ? 'bg-matrix-green/5 text-matrix-green' :
                    line.type === 'remove' ? 'bg-matrix-danger/5 text-matrix-danger' :
                    'text-matrix-text-muted/40'
                  }`}>
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}{line.content}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="p-4 text-matrix-text-muted/40 flex items-center gap-2">
              <span className="w-3 h-3 border border-matrix-green/40 border-t-matrix-green rounded-full animate-spin" />
              Loading diff...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Hunk Navigator Footer ───

function HunkNavigator({ hunks, activeIndex, onNavigate, onJump, onApply }: {
  hunks: any[]; activeIndex: number;
  onNavigate: (d: 'next' | 'prev') => void;
  onJump: (idx: number) => void;
  onApply: (idx: number, action: string) => void;
}) {
  if (hunks.length === 0) return null;
  const hunk = hunks[activeIndex];

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-matrix-border/20 bg-matrix-bg-elevated/50 text-[10px]">
      <button
        onClick={() => onNavigate('prev')}
        disabled={activeIndex === 0}
        className="px-2 py-0.5 rounded border border-matrix-border/20 text-matrix-text-muted/50 hover:text-matrix-green disabled:opacity-30"
        title="Previous hunk (k / Up)"
      >
        {'\u25B2'} Prev
      </button>
      <span className="text-matrix-text-muted/40 font-mono">
        Hunk {activeIndex + 1}/{hunks.length}
      </span>
      <button
        onClick={() => onNavigate('next')}
        disabled={activeIndex >= hunks.length - 1}
        className="px-2 py-0.5 rounded border border-matrix-border/20 text-matrix-text-muted/50 hover:text-matrix-green disabled:opacity-30"
        title="Next hunk (j / Down)"
      >
        Next {'\u25BC'}
      </button>

      <div className="ml-auto flex items-center gap-2">
        {hunk?.conflict && <span className="text-[8px] text-matrix-danger font-bold uppercase">Conflict</span>}
        <span className={`text-[8px] uppercase ${hunk?.action !== 'none' ? 'text-matrix-green' : 'text-matrix-text-muted/30'}`}>
          {hunk?.action !== 'none' ? hunk.action : 'no action'}
        </span>
        <button
          onClick={() => onApply(activeIndex, 'apply-left')}
          className="px-2 py-0.5 rounded bg-blue-400/10 text-blue-400/70 hover:bg-blue-400/20 text-[9px]"
        >
          {'\u25C0'} Left
        </button>
        <button
          onClick={() => onApply(activeIndex, 'apply-right')}
          className="px-2 py-0.5 rounded bg-purple-400/10 text-purple-400/70 hover:bg-purple-400/20 text-[9px]"
        >
          Right {'\u25B6'}
        </button>
      </div>
    </div>
  );
}

// ─── Utilities ───

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}
