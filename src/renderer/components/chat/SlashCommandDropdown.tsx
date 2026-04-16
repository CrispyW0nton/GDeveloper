/**
 * SlashCommandDropdown — Sprint 12
 * Autocomplete dropdown for slash commands.
 * Shows when user types '/' in chat input; filters as they type.
 * Arrow up/down to navigate, Enter/Tab to select, Escape to dismiss.
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

const CATEGORY_COLORS: Record<string, string> = {
  git: 'text-matrix-green',
  mode: 'text-yellow-400',
  info: 'text-blue-400',
  chat: 'text-purple-400',
  workflow: 'text-matrix-text-muted/50',
};

const CATEGORY_ICONS: Record<string, string> = {
  git: '\u2387',
  mode: '\u2699',
  info: '\u2139',
  chat: '\u2709',
  workflow: '\u21BB',
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
        setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex].name);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, filtered, selectedIndex, onSelect, onDismiss]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-1 z-50"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={listRef}
        className="glass-panel border border-matrix-green/20 bg-[#0a0f0a]/95 backdrop-blur-lg rounded-lg shadow-[0_0_20px_rgba(0,255,65,0.1)] max-h-[280px] overflow-y-auto"
      >
        <div className="px-3 py-1.5 border-b border-matrix-border/30">
          <span className="text-[9px] text-matrix-text-muted/40 uppercase tracking-wider">Commands</span>
        </div>
        {filtered.map((cmd, i) => (
          <button
            key={cmd.name}
            data-cmd-item
            onClick={() => onSelect(cmd.name)}
            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-all duration-75 ${
              i === selectedIndex
                ? 'bg-matrix-green/10 border-l-2 border-matrix-green'
                : 'border-l-2 border-transparent hover:bg-matrix-green/5'
            }`}
          >
            <span className={`text-sm w-5 text-center ${CATEGORY_COLORS[cmd.category] || 'text-matrix-text-dim'}`}>
              {CATEGORY_ICONS[cmd.category] || '/'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-matrix-green font-mono font-bold">/{cmd.name}</span>
                <span className={`text-[9px] px-1 py-0 rounded ${CATEGORY_COLORS[cmd.category] || 'text-matrix-text-muted/30'} opacity-50`}>
                  {cmd.category}
                </span>
              </div>
              <p className="text-[10px] text-matrix-text-muted/50 truncate">{cmd.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
