/**
 * FileTreeNode — Sprint 19
 * A single file or directory row in the file tree.
 * Features: expand/collapse chevron, file-type icon, highlight for AI-modified files,
 * active selection styling, indent guides, context menu.
 */

import React from 'react';
import type { FileEntry } from './FileTreePanel';

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  expandedDirs: Set<string>;
  onToggle: (path: string) => void;
  onClick: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  highlightedFiles?: Set<string>;
  activeFilePath?: string | null;
}

// File-type icon map (simple emoji-based for v1)
const FILE_ICONS: Record<string, string> = {
  '.ts': '\uD83D\uDD35',     // blue circle for TypeScript
  '.tsx': '\u269B\uFE0F',    // atom for React TSX
  '.js': '\uD83D\uDFE1',     // yellow circle for JavaScript
  '.jsx': '\u269B\uFE0F',
  '.json': '\uD83D\uDDC2\uFE0F',
  '.md': '\uD83D\uDCDD',
  '.css': '\uD83C\uDFA8',
  '.scss': '\uD83C\uDFA8',
  '.html': '\uD83C\uDF10',
  '.py': '\uD83D\uDC0D',
  '.rs': '\u2699\uFE0F',
  '.go': '\uD83D\uDC39',     // hamster for Go
  '.sh': '\uD83D\uDCBB',
  '.yml': '\u2699\uFE0F',
  '.yaml': '\u2699\uFE0F',
  '.toml': '\u2699\uFE0F',
  '.sql': '\uD83D\uDDC3\uFE0F',
  '.svg': '\uD83D\uDDBC\uFE0F',
  '.png': '\uD83D\uDDBC\uFE0F',
  '.jpg': '\uD83D\uDDBC\uFE0F',
  '.gif': '\uD83D\uDDBC\uFE0F',
  '.env': '\uD83D\uDD10',
  '.lock': '\uD83D\uDD12',
  '.gitignore': '\uD83D\uDEAB',
};

const SPECIAL_FILES: Record<string, string> = {
  'package.json': '\uD83D\uDCE6',
  'tsconfig.json': '\uD83D\uDD35',
  'Dockerfile': '\uD83D\uDC33',
  'README.md': '\uD83D\uDCD6',
  'LICENSE': '\uD83D\uDCDC',
  '.gitignore': '\uD83D\uDEAB',
};

function getIcon(entry: FileEntry): string {
  if (entry.isDirectory) return ''; // handled by chevron
  if (SPECIAL_FILES[entry.name]) return SPECIAL_FILES[entry.name];
  if (entry.extension && FILE_ICONS[entry.extension]) return FILE_ICONS[entry.extension];
  return '\uD83D\uDCC4'; // generic file
}

export default function FileTreeNode({
  entry,
  depth,
  expandedDirs,
  onToggle,
  onClick,
  onContextMenu,
  highlightedFiles,
  activeFilePath,
}: FileTreeNodeProps) {
  const isExpanded = expandedDirs.has(entry.path);
  const isHighlighted = highlightedFiles?.has(entry.path) || highlightedFiles?.has(entry.absolutePath);
  const isActive = activeFilePath === entry.path || activeFilePath === entry.absolutePath;

  return (
    <>
      <div
        className={`
          group flex items-center gap-1 px-2 py-[3px] cursor-pointer text-[11px] font-mono
          transition-colors duration-75 select-none relative
          ${isActive
            ? 'bg-matrix-green/10 text-matrix-green border-r-2 border-matrix-green'
            : isHighlighted
              ? 'bg-yellow-500/5 text-yellow-400/80 hover:bg-yellow-500/10'
              : 'text-matrix-text-dim hover:bg-matrix-bg-hover/40 hover:text-matrix-text-primary'
          }
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onClick(entry)}
        onContextMenu={(e) => onContextMenu(e, entry)}
        title={entry.path}
      >
        {/* Indent guides */}
        {depth > 0 && Array.from({ length: depth }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-matrix-border/10"
            style={{ left: `${i * 16 + 12}px` }}
          />
        ))}

        {/* Directory chevron or file icon */}
        {entry.isDirectory ? (
          <span
            className={`w-4 h-4 flex items-center justify-center text-matrix-text-muted/50 transition-transform duration-100 ${
              isExpanded ? 'rotate-90' : ''
            }`}
            onClick={(e) => { e.stopPropagation(); onToggle(entry.path); }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </span>
        ) : (
          <span className="w-4 h-4 flex items-center justify-center text-[10px]">
            {getIcon(entry)}
          </span>
        )}

        {/* Directory icon */}
        {entry.isDirectory && (
          <span className="text-[10px]">
            {isExpanded ? '\uD83D\uDCC2' : '\uD83D\uDCC1'}
          </span>
        )}

        {/* Name */}
        <span className="truncate flex-1">{entry.name}</span>

        {/* Highlight indicator for AI-modified files */}
        {isHighlighted && (
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/70 flex-shrink-0 animate-pulse" title="Modified by AI" />
        )}

        {/* File size (on hover) */}
        {!entry.isDirectory && entry.size !== undefined && (
          <span className="text-[8px] text-matrix-text-muted/20 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {formatSize(entry.size)}
          </span>
        )}
      </div>

      {/* Children (if expanded directory) */}
      {entry.isDirectory && isExpanded && entry.children && (
        <div>
          {entry.children.map(child => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              onToggle={onToggle}
              onClick={onClick}
              onContextMenu={onContextMenu}
              highlightedFiles={highlightedFiles}
              activeFilePath={activeFilePath}
            />
          ))}
          {entry.children.length === 0 && (
            <div
              className="text-[9px] text-matrix-text-muted/20 italic py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              (empty)
            </div>
          )}
        </div>
      )}
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
