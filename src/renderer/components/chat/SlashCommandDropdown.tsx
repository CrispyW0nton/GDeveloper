/**
 * SlashCommandDropdown — Sprint 12 + Sprint 18
 * Autocomplete dropdown for slash commands.
 * Shows when user types '/' in chat input; filters as they type.
 * Arrow up/down to navigate, Enter/Tab to select, Escape to dismiss.
 * Sprint 18: category grouping, beginner-safe markers, examples,
 * improved descriptions, visual cohesion.
 */

import React, { useState, useEffect, useRef } from 'react';

export interface SlashCommandInfo {
  name: string;
  description: string;
  category: string;
}

interface SlashCommandDropdownProps {
  commands: SlashCommandInfo[];
  filter: string;
  onSelect: (commandName: string) => void;
  onDismiss: () => void;
  visible: boolean;
}

// Sprint 18: Enhanced category metadata
const CATEGORY_META: Record<string, { color: string; icon: string; label: string; order: number }> = {
  mode:     { color: 'text-yellow-400',          icon: '\u2699', label: 'Modes',     order: 0 },
  info:     { color: 'text-blue-400',            icon: '\u2139', label: 'Info',       order: 1 },
  chat:     { color: 'text-purple-400',          icon: '\u2709', label: 'Chat',       order: 2 },
  git:      { color: 'text-matrix-green',        icon: '\u2387', label: 'Git',        order: 3 },
  workflow: { color: 'text-matrix-text-muted/60', icon: '\u21BB', label: 'Workflow',   order: 4 },
};

// Sprint 18: Commands that are safe for beginners (read-only, no mutations)
const BEGINNER_SAFE: Set<string> = new Set([
  'plan', 'tools', 'clear', 'status', 'diff', 'research', 'research-continue',
  'compare-repos', 'verify-last', 'worktree-list',
]);

// Sprint 18: Example usage for commands
const COMMAND_EXAMPLES: Record<string, string> = {
  'commit': '/commit fix: resolve login validation',
  'research': '/research best React state management library',
  'compare-repos': '/compare-repos ./app1 ./app2',
  'worktree-add': '/worktree-add ../hotfix -b hotfix/bug-123',
  'worktree-isolate': '/worktree-isolate refactor auth system',
  'worktree-handoff': '/worktree-handoff ../feature main',
};

export default function SlashCommandDropdown({
  commands,
  filter,
  onSelect,
  onDismiss,
  visible,
}: SlashCommandDropdownProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter commands based on what user typed after '/'
  const filterText = filter.startsWith('/') ? filter.substring(1).toLowerCase() : filter.toLowerCase();
  const filtered = commands.filter(cmd =>
    cmd.name.toLowerCase().startsWith(filterText) ||
    cmd.description.toLowerCase().includes(filterText)
  );

  // Sort by category order, then alphabetically within category
  const sorted = [...filtered].sort((a, b) => {
    const catA = CATEGORY_META[a.category]?.order ?? 99;
    const catB = CATEGORY_META[b.category]?.order ?? 99;
    if (catA !== catB) return catA - catB;
    return a.name.localeCompare(b.name);
  });

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const items = listRef.current.querySelectorAll('[data-cmd-item]');
      if (items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  // Keyboard handler (called from parent)
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, sorted.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (sorted[selectedIndex]) {
          onSelect(sorted[selectedIndex].name);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, sorted, selectedIndex, onSelect, onDismiss]);

  if (!visible || sorted.length === 0) return null;

  // Sprint 18: Group by category for display
  let lastCategory = '';

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-1 z-50"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={listRef}
        className="glass-panel-solid border border-matrix-green/20 backdrop-blur-lg rounded-lg shadow-matrix max-h-[320px] overflow-y-auto"
      >
        <div className="px-3 py-1.5 border-b border-matrix-border/30 flex items-center justify-between">
          <span className="text-[9px] text-matrix-text-muted/40 uppercase tracking-wider">Commands</span>
          <span className="text-[8px] text-matrix-text-muted/20">
            ↑↓ navigate &middot; Enter select &middot; Esc close
          </span>
        </div>
        {sorted.map((cmd, i) => {
          const meta = CATEGORY_META[cmd.category] || { color: 'text-matrix-text-dim', icon: '/', label: cmd.category, order: 99 };
          const isSafe = BEGINNER_SAFE.has(cmd.name);
          const example = COMMAND_EXAMPLES[cmd.name];
          const showCategoryHeader = cmd.category !== lastCategory;
          lastCategory = cmd.category;

          return (
            <React.Fragment key={cmd.name}>
              {/* Category divider */}
              {showCategoryHeader && filterText === '' && (
                <div className="px-3 py-1 text-[8px] text-matrix-text-muted/30 uppercase tracking-widest border-t border-matrix-border/10 bg-matrix-bg-hover/30">
                  {meta.label}
                </div>
              )}
              <button
                data-cmd-item
                onClick={() => onSelect(cmd.name)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-all duration-75 ${
                  i === selectedIndex
                    ? 'bg-matrix-green/10 border-l-2 border-matrix-green'
                    : 'border-l-2 border-transparent hover:bg-matrix-green/5'
                }`}
              >
                <span className={`text-sm w-5 text-center ${meta.color}`}>
                  {meta.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-matrix-green font-mono font-bold">/{cmd.name}</span>
                    {isSafe && (
                      <span className="text-[7px] px-1 py-0 rounded-full border border-matrix-green/15 text-matrix-green/40 bg-matrix-green/5">
                        safe
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-matrix-text-muted/50 truncate">{cmd.description}</p>
                  {example && i === selectedIndex && (
                    <p className="text-[9px] text-matrix-text-muted/25 mt-0.5 font-mono truncate">
                      e.g. <span className="text-matrix-green/30">{example}</span>
                    </p>
                  )}
                </div>
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
