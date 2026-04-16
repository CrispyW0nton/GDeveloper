/**
 * SuggestionCards — Sprint 12
 * Six prompt suggestion cards shown on empty chat.
 * Matrix-themed, disappear after first message.
 */

import React from 'react';

interface SuggestionCard {
  icon: string;
  title: string;
  prompt: string;
}

const SUGGESTIONS: SuggestionCard[] = [
  { icon: '\uD83D\uDD0D', title: 'Explore this codebase', prompt: 'Analyze the project structure and explain the architecture' },
  { icon: '\uD83D\uDC1B', title: 'Fix a bug', prompt: 'Help me find and fix a bug in the code' },
  { icon: '\u2728', title: 'Add a feature', prompt: 'Help me implement a new feature' },
  { icon: '\uD83E\uDDEA', title: 'Write tests', prompt: 'Generate tests for the existing code' },
  { icon: '\uD83D\uDCCB', title: 'Review changes', prompt: 'Review the current git diff and suggest improvements' },
  { icon: '\uD83D\uDDFA\uFE0F', title: 'Create a plan', prompt: 'Analyze the project and create a development roadmap' },
];

interface SuggestionCardsProps {
  onSelect: (prompt: string) => void;
}

export default function SuggestionCards({ onSelect }: SuggestionCardsProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8 animate-fadeIn">
      <div className="text-center mb-8">
        <h2 className="text-sm font-bold text-matrix-green glow-text tracking-wider mb-2">
          WHAT WOULD YOU LIKE TO DO?
        </h2>
        <p className="text-[10px] text-matrix-text-muted/40">
          Select a suggestion or type your own prompt below
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl w-full">
        {SUGGESTIONS.map((card, i) => (
          <button
            key={i}
            onClick={() => onSelect(card.prompt)}
            className="group glass-panel p-4 text-left transition-all duration-200 hover:border-matrix-green/40 hover:bg-matrix-green/5 hover:shadow-[0_0_15px_rgba(0,255,65,0.08)] active:scale-[0.98]"
          >
            <div className="text-xl mb-2 opacity-70 group-hover:opacity-100 transition-opacity">
              {card.icon}
            </div>
            <h3 className="text-xs font-bold text-matrix-green/80 group-hover:text-matrix-green mb-1 transition-colors">
              {card.title}
            </h3>
            <p className="text-[10px] text-matrix-text-muted/40 group-hover:text-matrix-text-muted/60 leading-relaxed transition-colors">
              {card.prompt}
            </p>
          </button>
        ))}
      </div>

      <div className="mt-6 text-[9px] text-matrix-text-muted/20 flex items-center gap-2">
        <span>Type</span>
        <code className="px-1 py-0.5 bg-matrix-bg-hover rounded text-matrix-green/40 font-mono">/</code>
        <span>for commands</span>
        <span className="mx-1">|</span>
        <code className="px-1 py-0.5 bg-matrix-bg-hover rounded text-matrix-green/40 font-mono">Shift+Enter</code>
        <span>for new line</span>
      </div>
    </div>
  );
}
