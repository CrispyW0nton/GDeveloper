/**
 * CompareToolCard — Sprint 27
 * First-class agent tool card for Compare sessions in the chatbox.
 * Shows session status, compact summary, hunk preview, and action buttons.
 * Supports follow-up interactions (apply hunk, filter, explain, open workspace).
 */

import React, { useState, useCallback } from 'react';

const api = (window as any).electronAPI;

interface CompareToolCardProps {
  sessionData: any; // CompareToolOutput
  onAction?: (action: string, params?: any) => void;
  onOpenWorkspace?: (sessionId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  analyzing: 'border-matrix-warning/30 bg-matrix-warning/5',
  comparing: 'border-matrix-warning/30 bg-matrix-warning/5',
  complete: 'border-matrix-green/30 bg-matrix-green/5',
  error: 'border-matrix-danger/30 bg-matrix-danger/5',
};

const STATUS_LABELS: Record<string, string> = {
  analyzing: 'Analyzing...',
  comparing: 'Comparing...',
  complete: 'Complete',
  error: 'Error',
};

const MODE_ICONS: Record<string, string> = {
  file: '\u00B1',
  merge3: '\uD83D\uDD00',
  folder: '\uD83D\uDCC1',
};

const MODE_LABELS: Record<string, string> = {
  file: 'File Compare',
  merge3: '3-Way Merge',
  folder: 'Folder Compare',
};

export default function CompareToolCard({ sessionData, onAction, onOpenWorkspace }: CompareToolCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [activeHunk, setActiveHunk] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const data = sessionData;
  if (!data || !data.sessionId) return null;

  const status = data.status || 'complete';
  const mode = data.mode || 'file';
  const summary = data.summary || {};

  const handleViewHunk = useCallback(async (hunkIndex: number) => {
    if (!api?.compareHunkDetail) return;
    setLoadingDetail(true);
    try {
      const detail = await api.compareHunkDetail(data.sessionId, hunkIndex);
      setActiveHunk(detail);
    } catch { /* ignore */ }
    setLoadingDetail(false);
  }, [data.sessionId]);

  const handleHunkAction = useCallback(async (hunkIndex: number, action: string) => {
    if (!api?.compareHunkAction) return;
    await api.compareHunkAction(data.sessionId, hunkIndex, action);
    onAction?.(`Applied ${action} to hunk ${hunkIndex}`, { sessionId: data.sessionId, hunkIndex, action });
  }, [data.sessionId, onAction]);

  return (
    <div className={`rounded-lg border text-[11px] overflow-hidden transition-all ${STATUS_COLORS[status]}`}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-matrix-bg-hover/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-sm">{MODE_ICONS[mode] || '\u00B1'}</span>
        <span className="font-mono font-bold text-matrix-green">{MODE_LABELS[mode] || 'Compare'}</span>
        {status === 'comparing' || status === 'analyzing' ? (
          <span className="w-3 h-3 border-2 border-matrix-warning/40 border-t-matrix-warning rounded-full animate-spin" />
        ) : null}
        <span className="text-[9px] text-matrix-text-muted/40 font-mono ml-1">{data.sessionId}</span>
        <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider ${
          status === 'complete' ? 'text-matrix-green' : status === 'error' ? 'text-matrix-danger' : 'text-matrix-warning'
        }`}>{STATUS_LABELS[status]}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`transition-transform ${expanded ? 'rotate-180' : ''} text-matrix-text-muted/40`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Body */}
      {expanded && (
        <div className="px-3 py-2 border-t border-matrix-border/20 space-y-3">
          {/* Error */}
          {data.error && (
            <div className="text-matrix-danger text-[10px]">{data.error}</div>
          )}

          {/* Summary table */}
          {mode === 'file' && <FileSummary summary={summary} />}
          {mode === 'merge3' && <MergeSummary summary={summary} />}
          {mode === 'folder' && <FolderSummary summary={summary} />}

          {/* Preview items */}
          {data.preview && data.preview.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] text-matrix-text-muted/40 uppercase tracking-wider">
                Preview ({data.preview.length}/{data.totalItems})
              </div>
              {data.preview.map((item: any, i: number) => (
                <PreviewItem
                  key={i}
                  item={item}
                  mode={mode}
                  onViewDetail={() => handleViewHunk(item.index ?? i)}
                  onApplyAction={(action) => handleHunkAction(item.index ?? i, action)}
                />
              ))}
              {data.totalItems > data.preview.length && (
                <div className="text-[9px] text-matrix-text-muted/30 italic">
                  +{data.totalItems - data.preview.length} more item(s). Ask to see specific items or open in Compare Workspace.
                </div>
              )}
            </div>
          )}

          {/* Active hunk detail */}
          {loadingDetail && (
            <div className="text-[9px] text-matrix-text-muted/40 flex items-center gap-1">
              <span className="w-2.5 h-2.5 border border-matrix-green/40 border-t-matrix-green rounded-full animate-spin" />
              Loading hunk detail...
            </div>
          )}
          {activeHunk && !loadingDetail && (
            <HunkDetailView hunk={activeHunk} onClose={() => setActiveHunk(null)} />
          )}

          {/* Actions */}
          <div className="flex gap-1.5 flex-wrap pt-1 border-t border-matrix-border/10">
            {(data.actions || []).map((action: string) => (
              <ActionButton
                key={action}
                action={action}
                onClick={() => {
                  if (action === 'open-workspace') {
                    onOpenWorkspace?.(data.sessionId);
                  } else {
                    onAction?.(action, { sessionId: data.sessionId });
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Collapsed footer */}
      {!expanded && (
        <div className="px-3 py-1 border-t border-matrix-border/10 text-[9px] text-matrix-text-muted/50 truncate">
          {mode === 'file' && `${summary.totalHunks || 0} hunks, +${summary.linesAdded || 0}/-${summary.linesRemoved || 0}`}
          {mode === 'merge3' && `${summary.conflicts || 0} conflicts, ${summary.resolved || 0} resolved`}
          {mode === 'folder' && `${summary.different || 0} different, ${summary.leftOnly || 0} left-only, ${summary.rightOnly || 0} right-only`}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function FileSummary({ summary }: { summary: any }) {
  return (
    <div className="grid grid-cols-4 gap-2 text-[10px]">
      <Stat label="Hunks" value={summary.totalHunks || 0} />
      <Stat label="Added" value={`+${summary.linesAdded || 0}`} color="text-matrix-green" />
      <Stat label="Removed" value={`-${summary.linesRemoved || 0}`} color="text-matrix-danger" />
      <Stat label="Moved" value={summary.movedBlocks || 0} />
      {summary.riskFlags?.length > 0 && (
        <div className="col-span-4 text-[9px] text-yellow-400">{summary.riskFlags.join(' | ')}</div>
      )}
    </div>
  );
}

function MergeSummary({ summary }: { summary: any }) {
  return (
    <div className="grid grid-cols-4 gap-2 text-[10px]">
      <Stat label="Hunks" value={summary.totalHunks || 0} />
      <Stat label="Conflicts" value={summary.conflicts || 0} color={summary.conflicts > 0 ? 'text-matrix-danger' : undefined} />
      <Stat label="Resolved" value={summary.resolved || 0} color="text-matrix-green" />
      <Stat label="Auto-merged" value={summary.autoMerged || 0} />
    </div>
  );
}

function FolderSummary({ summary }: { summary: any }) {
  return (
    <div className="grid grid-cols-5 gap-2 text-[10px]">
      <Stat label="Total" value={summary.totalEntries || 0} />
      <Stat label="Identical" value={summary.identical || 0} color="text-matrix-green" />
      <Stat label="Different" value={summary.different || 0} color="text-yellow-400" />
      <Stat label="Left only" value={summary.leftOnly || 0} />
      <Stat label="Right only" value={summary.rightOnly || 0} />
      {summary.topChangedFiles?.length > 0 && (
        <div className="col-span-5 text-[9px] text-matrix-text-muted/40">
          Top changed: {summary.topChangedFiles.slice(0, 3).map((f: any) => f.path).join(', ')}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div className="text-[8px] text-matrix-text-muted/40 uppercase tracking-wider">{label}</div>
      <div className={`font-mono font-bold ${color || 'text-matrix-text-dim'}`}>{value}</div>
    </div>
  );
}

function PreviewItem({ item, mode, onViewDetail, onApplyAction }: {
  item: any;
  mode: string;
  onViewDetail: () => void;
  onApplyAction: (action: string) => void;
}) {
  if (mode === 'folder') {
    const stateColors: Record<string, string> = {
      different: 'text-yellow-400',
      'left-only': 'text-blue-400',
      'right-only': 'text-purple-400',
      error: 'text-matrix-danger',
    };
    return (
      <div className="flex items-center gap-2 text-[10px] bg-matrix-bg-elevated/50 rounded px-2 py-1">
        <span className={`w-1.5 h-1.5 rounded-full ${
          item.state === 'different' ? 'bg-yellow-400' :
          item.state === 'left-only' ? 'bg-blue-400' :
          item.state === 'right-only' ? 'bg-purple-400' : 'bg-matrix-danger'
        }`} />
        <span className="font-mono text-matrix-text-dim truncate flex-1">{item.path}</span>
        <span className={`text-[8px] uppercase ${stateColors[item.state] || ''}`}>{item.state}</span>
        {item.added !== undefined && (
          <span className="text-[8px] text-matrix-text-muted/30">+{item.added}/-{item.removed}</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onViewDetail(); }}
          className="text-[8px] text-matrix-accent/60 hover:text-matrix-accent"
        >
          detail
        </button>
      </div>
    );
  }

  // File / merge hunk preview
  return (
    <div className="flex items-center gap-2 text-[10px] bg-matrix-bg-elevated/50 rounded px-2 py-1">
      <span className="font-mono text-matrix-text-muted/50">#{item.index}</span>
      {item.conflict && <span className="text-[8px] text-matrix-danger font-bold">CONFLICT</span>}
      {item.linesAdded !== undefined && (
        <>
          <span className="text-matrix-green">+{item.linesAdded}</span>
          <span className="text-matrix-danger">-{item.linesRemoved}</span>
        </>
      )}
      <span className={`text-[8px] ${item.action !== 'none' ? 'text-matrix-green' : 'text-matrix-text-muted/30'}`}>
        {item.action !== 'none' ? item.action : 'pending'}
      </span>
      <div className="ml-auto flex gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); onViewDetail(); }}
          className="text-[8px] text-matrix-accent/60 hover:text-matrix-accent px-1 rounded hover:bg-matrix-accent/10"
        >
          view
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onApplyAction('apply-left'); }}
          className="text-[8px] text-blue-400/60 hover:text-blue-400 px-1 rounded hover:bg-blue-400/10"
        >
          ◀ left
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onApplyAction('apply-right'); }}
          className="text-[8px] text-purple-400/60 hover:text-purple-400 px-1 rounded hover:bg-purple-400/10"
        >
          right ▶
        </button>
      </div>
    </div>
  );
}

function HunkDetailView({ hunk, onClose }: { hunk: any; onClose: () => void }) {
  const lines = hunk.lines || [];
  return (
    <div className="bg-matrix-bg-elevated rounded-lg border border-matrix-border/20 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 border-b border-matrix-border/10">
        <span className="text-[9px] text-matrix-text-muted/50 font-mono">
          Hunk #{hunk.index} — line {hunk.oldStart || '?'}
        </span>
        <button onClick={onClose} className="text-[9px] text-matrix-text-muted/40 hover:text-matrix-text-dim">
          close
        </button>
      </div>
      <pre className="text-[10px] p-2 font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre">
        {lines.map((line: any, i: number) => (
          <div key={i} className={
            line.type === 'add' ? 'text-matrix-green bg-matrix-green/5' :
            line.type === 'remove' ? 'text-matrix-danger bg-matrix-danger/5' :
            'text-matrix-text-muted/40'
          }>
            {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}{line.content}
          </div>
        ))}
      </pre>
    </div>
  );
}

function ActionButton({ action, onClick }: { action: string; onClick: () => void }) {
  const labels: Record<string, { label: string; color: string }> = {
    'view-diff': { label: 'View Diff', color: 'text-matrix-accent/60 hover:text-matrix-accent hover:bg-matrix-accent/10' },
    'apply-left': { label: 'Apply Left', color: 'text-blue-400/60 hover:text-blue-400 hover:bg-blue-400/10' },
    'apply-right': { label: 'Apply Right', color: 'text-purple-400/60 hover:text-purple-400 hover:bg-purple-400/10' },
    'apply-base': { label: 'Apply Base', color: 'text-matrix-text-muted/50 hover:text-matrix-text-dim hover:bg-matrix-bg-hover' },
    'resolve-all': { label: 'Resolve All', color: 'text-matrix-green/60 hover:text-matrix-green hover:bg-matrix-green/10' },
    'explain-changes': { label: 'Explain', color: 'text-matrix-info/60 hover:text-matrix-info hover:bg-matrix-info/10' },
    'explain-conflicts': { label: 'Explain Conflicts', color: 'text-matrix-info/60 hover:text-matrix-info hover:bg-matrix-info/10' },
    'open-workspace': { label: 'Open Workspace', color: 'text-matrix-green/60 hover:text-matrix-green hover:bg-matrix-green/10' },
    'view-details': { label: 'View Details', color: 'text-matrix-accent/60 hover:text-matrix-accent hover:bg-matrix-accent/10' },
    'sync-preview-ltr': { label: 'Sync L\u2192R', color: 'text-blue-400/60 hover:text-blue-400 hover:bg-blue-400/10' },
    'sync-preview-rtl': { label: 'Sync R\u2192L', color: 'text-purple-400/60 hover:text-purple-400 hover:bg-purple-400/10' },
    'filter': { label: 'Filter', color: 'text-matrix-text-muted/50 hover:text-matrix-text-dim hover:bg-matrix-bg-hover' },
  };

  const config = labels[action] || { label: action, color: 'text-matrix-text-muted/50 hover:text-matrix-text-dim' };

  return (
    <button
      onClick={onClick}
      className={`text-[8px] px-2 py-0.5 rounded border border-matrix-border/20 transition-colors ${config.color}`}
    >
      {config.label}
    </button>
  );
}
