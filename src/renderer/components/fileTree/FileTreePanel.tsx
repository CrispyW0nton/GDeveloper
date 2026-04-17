/**
 * FileTreePanel — Sprint 19
 * VS Code–style file tree on the right side of the app.
 * Shows the current workspace/worktree files.
 * Features: expand/collapse, file icons, theme-aware, heavy-dir filtering,
 * click to open (read-only v1), context menu, modified indicator,
 * resizable panel with width/collapsed state persisted, worktree label.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import FileTreeNode from './FileTreeNode';
import FileTreeHeader from './FileTreeHeader';

const api = (window as any).electronAPI;

export interface FileEntry {
  name: string;
  path: string;
  absolutePath: string;
  isDirectory: boolean;
  children?: FileEntry[];
  size?: number;
  extension?: string;
}

interface FileTreePanelProps {
  visible: boolean;
  workspaceName?: string;
  worktreeLabel?: string;
  width: number;
  onWidthChange: (w: number) => void;
  onClose: () => void;
  onFileSelect?: (filePath: string, absolutePath: string) => void;
  highlightedFiles?: Set<string>;
  activeFilePath?: string | null;
}

export default function FileTreePanel({
  visible,
  workspaceName,
  worktreeLabel,
  width,
  onWidthChange,
  onClose,
  onFileSelect,
  highlightedFiles,
  activeFilePath,
}: FileTreePanelProps) {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Load file tree
  const loadTree = useCallback(async () => {
    if (!api?.getFileTree) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.getFileTree();
      if (result.success) {
        setTree(result.tree || []);
      } else {
        setError(result.error || 'Failed to load file tree');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file tree');
    }
    setLoading(false);
  }, []);

  // Load on mount and set up refresh interval
  useEffect(() => {
    if (visible) {
      loadTree();
      const interval = setInterval(loadTree, 10000); // refresh every 10s
      return () => clearInterval(interval);
    }
  }, [visible, loadTree]);

  // Toggle directory expand/collapse
  const toggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Expand all / collapse all
  const expandAll = useCallback(() => {
    const allDirs = new Set<string>();
    function collect(entries: FileEntry[]) {
      for (const e of entries) {
        if (e.isDirectory) {
          allDirs.add(e.path);
          if (e.children) collect(e.children);
        }
      }
    }
    collect(tree);
    setExpandedDirs(allDirs);
  }, [tree]);

  const collapseAll = useCallback(() => {
    setExpandedDirs(new Set());
  }, []);

  // Handle resize drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startWidth: width };

    const handleMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startX - ev.clientX; // dragging left increases width
      const newWidth = Math.max(180, Math.min(600, resizeRef.current.startWidth + delta));
      onWidthChange(newWidth);
    };

    const handleUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [width, onWidthChange]);

  // Simple search filter
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return tree;
    const q = searchQuery.toLowerCase();
    function filter(entries: FileEntry[]): FileEntry[] {
      const results: FileEntry[] = [];
      for (const e of entries) {
        if (e.name.toLowerCase().includes(q)) {
          results.push(e);
        } else if (e.isDirectory && e.children) {
          const filtered = filter(e.children);
          if (filtered.length > 0) {
            results.push({ ...e, children: filtered });
          }
        }
      }
      return results;
    }
    return filter(tree);
  }, [tree, searchQuery]);

  // Handle file click
  const handleFileClick = useCallback((entry: FileEntry) => {
    if (entry.isDirectory) {
      toggleDir(entry.path);
    } else {
      onFileSelect?.(entry.path, entry.absolutePath);
    }
  }, [toggleDir, onFileSelect]);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    // Simple context menu via prompt — v1
    // In a future sprint, this could be a proper dropdown menu
    const action = window.prompt(
      `${entry.name}\n\nActions:\n1 — Copy path\n2 — Copy relative path\n3 — Reveal in terminal\n\nEnter number:`,
      '2'
    );
    if (action === '1') {
      navigator.clipboard?.writeText(entry.absolutePath);
    } else if (action === '2') {
      navigator.clipboard?.writeText(entry.path);
    } else if (action === '3' && api?.terminalExecute) {
      const dir = entry.isDirectory ? entry.absolutePath : entry.absolutePath.replace(/[/\\][^/\\]+$/, '');
      api.terminalExecute(`cd "${dir}" && pwd`, dir);
    }
  }, []);

  if (!visible) return null;

  return (
    <div
      ref={panelRef}
      className="h-full flex flex-col border-l border-matrix-border/30 bg-matrix-bg/95 backdrop-blur-sm overflow-hidden flex-shrink-0"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-matrix-green/20 transition-colors z-10"
        onMouseDown={handleResizeStart}
      />

      {/* Header */}
      <FileTreeHeader
        workspaceName={workspaceName || 'Files'}
        worktreeLabel={worktreeLabel}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRefresh={loadTree}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onClose={onClose}
        fileCount={tree.length}
        loading={loading}
      />

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 scrollbar-thin">
        {loading && tree.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-matrix-text-muted/40">
            <span className="w-4 h-4 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin mr-2" />
            Loading files...
          </div>
        ) : error ? (
          <div className="p-3 text-xs text-matrix-danger/70">
            <p className="font-bold mb-1">Error loading files</p>
            <p className="text-matrix-text-muted/40">{error}</p>
            <button onClick={loadTree} className="mt-2 text-matrix-green/60 hover:text-matrix-green text-[10px] underline">
              Retry
            </button>
          </div>
        ) : filteredTree.length === 0 ? (
          <div className="p-4 text-center text-xs text-matrix-text-muted/30">
            {searchQuery ? 'No files match your search.' : 'No files in workspace.'}
          </div>
        ) : (
          filteredTree.map(entry => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              expandedDirs={expandedDirs}
              onToggle={toggleDir}
              onClick={handleFileClick}
              onContextMenu={handleContextMenu}
              highlightedFiles={highlightedFiles}
              activeFilePath={activeFilePath}
            />
          ))
        )}
      </div>

      {/* Footer status */}
      <div className="px-3 py-1.5 border-t border-matrix-border/20 text-[9px] text-matrix-text-muted/25 flex items-center justify-between">
        <span>{tree.length > 0 ? `${countFiles(tree)} files` : 'Empty'}</span>
        {highlightedFiles && highlightedFiles.size > 0 && (
          <span className="text-matrix-green/50">{highlightedFiles.size} modified by AI</span>
        )}
      </div>
    </div>
  );
}

function countFiles(entries: FileEntry[]): number {
  let count = 0;
  for (const e of entries) {
    if (e.isDirectory && e.children) {
      count += countFiles(e.children);
    } else {
      count++;
    }
  }
  return count;
}
