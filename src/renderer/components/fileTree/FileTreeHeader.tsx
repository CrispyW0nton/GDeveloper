/**
 * FileTreeHeader — Sprint 19
 * Header bar for the file tree panel.
 * Shows workspace name, worktree label, search box, and action buttons.
 */

import React, { useState } from 'react';

interface FileTreeHeaderProps {
  workspaceName: string;
  worktreeLabel?: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onClose: () => void;
  fileCount: number;
  loading: boolean;
}

export default function FileTreeHeader({
  workspaceName,
  worktreeLabel,
  searchQuery,
  onSearchChange,
  onRefresh,
  onExpandAll,
  onCollapseAll,
  onClose,
  fileCount,
  loading,
}: FileTreeHeaderProps) {
  const [showSearch, setShowSearch] = useState(false);

  return (
    <div className="border-b border-matrix-border/20">
      {/* Title row */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-bold text-matrix-text-muted/50">Files</span>
          <span className="text-[10px] text-matrix-green/60 truncate max-w-[120px]" title={workspaceName}>
            {workspaceName}
          </span>
          {worktreeLabel && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400/60 border border-blue-500/20">
              {worktreeLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {loading && (
            <span className="w-3 h-3 border border-matrix-green/30 border-t-matrix-green rounded-full animate-spin" />
          )}
          {/* Search toggle */}
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`p-1 rounded hover:bg-matrix-bg-hover/40 transition-colors ${showSearch ? 'text-matrix-green' : 'text-matrix-text-muted/40'}`}
            title="Search files (Ctrl+Shift+F)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          {/* Expand all */}
          <button
            onClick={onExpandAll}
            className="p-1 rounded hover:bg-matrix-bg-hover/40 text-matrix-text-muted/40 hover:text-matrix-text-dim transition-colors"
            title="Expand all folders"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {/* Collapse all */}
          <button
            onClick={onCollapseAll}
            className="p-1 rounded hover:bg-matrix-bg-hover/40 text-matrix-text-muted/40 hover:text-matrix-text-dim transition-colors"
            title="Collapse all folders"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          {/* Refresh */}
          <button
            onClick={onRefresh}
            className="p-1 rounded hover:bg-matrix-bg-hover/40 text-matrix-text-muted/40 hover:text-matrix-text-dim transition-colors"
            title="Refresh file tree"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-matrix-bg-hover/40 text-matrix-text-muted/40 hover:text-matrix-text-dim transition-colors"
            title="Close file tree"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search bar (toggled) */}
      {showSearch && (
        <div className="px-3 pb-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Filter files..."
            className="w-full matrix-input text-[10px] py-1 px-2"
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
