/**
 * SuggestionCards — Sprint 12 + Sprint 18
 * Welcoming empty-chat experience with categorized prompt suggestions.
 * Sprint 18: expanded categories, beginner-friendly copy, quick-start hints,
 * example prompts surfaced from prompt library.
 */

import React, { useState } from 'react';

interface SuggestionCard {
  icon: string;
  title: string;
  prompt: string;
  description: string;
  category: 'start' | 'build' | 'fix' | 'research' | 'git' | 'advanced';
  /** Whether this is safe for beginners (read-only, no mutations) */
  safe?: boolean;
}

const PROMPT_LIBRARY: SuggestionCard[] = [
  // Getting Started (safe, read-only)
  {
    icon: '\uD83D\uDCDA',
    title: 'Explore this codebase',
    prompt: 'Analyze the project structure, key files, and architecture. Give me a high-level overview.',
    description: 'Understand what you\'re working with',
    category: 'start',
    safe: true,
  },
  {
    icon: '\uD83D\uDDFA\uFE0F',
    title: 'Create a plan',
    prompt: 'Analyze this project and create a development roadmap with priorities and next steps.',
    description: 'Get a roadmap before making changes',
    category: 'start',
    safe: true,
  },
  {
    icon: '\uD83D\uDD0D',
    title: 'Find all endpoints',
    prompt: 'Find all API endpoints, routes, or entry points in this project and list them.',
    description: 'Map out the API surface',
    category: 'start',
    safe: true,
  },
  // Build
  {
    icon: '\u2728',
    title: 'Add a feature',
    prompt: 'Help me implement a new feature. I want to add...',
    description: 'Describe what you want to build',
    category: 'build',
  },
  {
    icon: '\uD83E\uDDEA',
    title: 'Write tests',
    prompt: 'Generate tests for the existing code. Focus on the most critical paths first.',
    description: 'Improve test coverage',
    category: 'build',
  },
  {
    icon: '\uD83D\uDCC4',
    title: 'Add documentation',
    prompt: 'Add JSDoc comments and documentation to the key functions and modules in this project.',
    description: 'Make the code self-documenting',
    category: 'build',
  },
  // Fix
  {
    icon: '\uD83D\uDC1B',
    title: 'Fix a bug',
    prompt: 'Help me find and fix a bug. The issue is...',
    description: 'Describe the problem you\'re seeing',
    category: 'fix',
  },
  {
    icon: '\u26A0\uFE0F',
    title: 'Fix errors',
    prompt: 'Check this project for common errors, type issues, or broken imports and fix them.',
    description: 'Automated error scanning and repair',
    category: 'fix',
  },
  // Research
  {
    icon: '\uD83D\uDD2C',
    title: 'Deep research',
    prompt: '/research ',
    description: 'Multi-step research on any topic',
    category: 'research',
    safe: true,
  },
  {
    icon: '\uD83D\uDD04',
    title: 'Compare approaches',
    prompt: '/research compare the best approaches for ',
    description: 'Compare libraries, patterns, or architectures',
    category: 'research',
    safe: true,
  },
  // Git
  {
    icon: '\uD83D\uDCCB',
    title: 'Review changes',
    prompt: '/diff',
    description: 'See what\'s changed since last commit',
    category: 'git',
    safe: true,
  },
  {
    icon: '\uD83D\uDCE6',
    title: 'Commit changes',
    prompt: '/commit',
    description: 'Stage all changes and commit with AI message',
    category: 'git',
  },
  // Advanced
  {
    icon: '\uD83C\uDF33',
    title: 'Isolate a task',
    prompt: '/worktree-isolate ',
    description: 'Create a separate worktree for safe experimentation',
    category: 'advanced',
  },
  {
    icon: '\u2705',
    title: 'Verify truthfulness',
    prompt: '/verify-last',
    description: 'Check if the AI did what it said it did',
    category: 'advanced',
    safe: true,
  },
];

const CATEGORY_META: Record<string, { label: string; description: string }> = {
  start: { label: 'Get Started', description: 'Safe, read-only exploration' },
  build: { label: 'Build', description: 'Create and implement' },
  fix: { label: 'Fix', description: 'Debug and repair' },
  research: { label: 'Research', description: 'Analyze and compare' },
  git: { label: 'Git', description: 'Version control' },
  advanced: { label: 'Advanced', description: 'Power features' },
};

interface SuggestionCardsProps {
  onSelect: (prompt: string) => void;
}

export default function SuggestionCards({ onSelect }: SuggestionCardsProps) {
  const [activeCategory, setActiveCategory] = useState<string>('start');

  const categories = ['start', 'build', 'fix', 'research', 'git', 'advanced'];
  const filtered = PROMPT_LIBRARY.filter(c => c.category === activeCategory);

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8 animate-fadeIn">
      {/* Welcome */}
      <div className="text-center mb-6">
        <h2 className="text-lg font-bold text-matrix-green glow-text tracking-wide mb-2">
          Welcome to GDeveloper
        </h2>
        <p className="text-xs text-matrix-text-muted/60 max-w-md mx-auto leading-relaxed">
          Your AI coding assistant is ready. Pick a suggestion below, or type your own prompt.
          <br />
          <span className="text-matrix-text-muted/40">New here? Start with <strong className="text-matrix-green/60">"Explore this codebase"</strong> — it's read-only and safe.</span>
        </p>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 mb-4 flex-wrap justify-center">
        {categories.map(cat => {
          const meta = CATEGORY_META[cat];
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`text-[10px] px-3 py-1.5 rounded-full border transition-all duration-150 ${
                activeCategory === cat
                  ? 'border-matrix-green/40 bg-matrix-green/10 text-matrix-green font-bold'
                  : 'border-matrix-border/30 text-matrix-text-muted/40 hover:text-matrix-text-dim hover:border-matrix-border/50'
              }`}
              title={meta.description}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Suggestion grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl w-full">
        {filtered.map((card, i) => (
          <button
            key={i}
            onClick={() => onSelect(card.prompt)}
            className="group glass-panel p-4 text-left transition-all duration-200 hover:border-matrix-green/40 hover:bg-matrix-green/5 hover:shadow-[0_0_15px_rgba(0,255,65,0.08)] active:scale-[0.98]"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-lg opacity-70 group-hover:opacity-100 transition-opacity">
                {card.icon}
              </span>
              {card.safe && (
                <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-matrix-green/20 text-matrix-green/50 bg-matrix-green/5">
                  safe
                </span>
              )}
            </div>
            <h3 className="text-xs font-bold text-matrix-green/80 group-hover:text-matrix-green mb-1 transition-colors">
              {card.title}
            </h3>
            <p className="text-[10px] text-matrix-text-muted/40 group-hover:text-matrix-text-muted/60 leading-relaxed transition-colors">
              {card.description}
            </p>
          </button>
        ))}
      </div>

      {/* Footer hints */}
      <div className="mt-6 flex flex-col items-center gap-2">
        <div className="text-[9px] text-matrix-text-muted/20 flex items-center gap-2">
          <span>Type</span>
          <code className="px-1 py-0.5 bg-matrix-bg-hover rounded text-matrix-green/40 font-mono">/</code>
          <span>for commands</span>
          <span className="mx-1">|</span>
          <code className="px-1 py-0.5 bg-matrix-bg-hover rounded text-matrix-green/40 font-mono">Shift+Enter</code>
          <span>for new line</span>
        </div>
        <div className="text-[9px] text-matrix-text-muted/15 flex items-center gap-1">
          <span className="inline-block w-1 h-1 rounded-full bg-yellow-500/30" />
          <span>Plan mode = read-only</span>
          <span className="mx-1">|</span>
          <span className="inline-block w-1 h-1 rounded-full bg-matrix-green/30" />
          <span>Build mode = full access</span>
        </div>
      </div>
    </div>
  );
}
