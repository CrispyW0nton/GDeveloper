/**
 * FollowupButtons — Sprint 12
 * Context-aware action buttons shown after AI responses.
 * Inserts suggested text into chat input when clicked.
 */

import React from 'react';

interface FollowupButtonsProps {
  /** The assistant message content to derive suggestions from */
  content: string;
  /** Whether any tool calls were present */
  hasToolCalls: boolean;
  /** Names of tools that were called */
  toolNames: string[];
  onAction: (prompt: string) => void;
}

interface FollowupAction {
  label: string;
  prompt: string;
}

function deriveFollowups(content: string, hasToolCalls: boolean, toolNames: string[]): FollowupAction[] {
  const actions: FollowupAction[] = [];
  const lc = content.toLowerCase();

  // After file edits
  const hasFileWrite = toolNames.some(n => n === 'write_file' || n === 'patch_file');
  if (hasFileWrite) {
    actions.push({ label: 'Show diff', prompt: '/diff' });
    actions.push({ label: 'Commit changes', prompt: '/commit' });
    actions.push({ label: 'Undo last edit', prompt: '/undo' });
    return actions.slice(0, 3);
  }

  // After error
  if (lc.includes('error') || lc.includes('failed') || lc.includes('exception')) {
    actions.push({ label: 'Fix this', prompt: 'Please fix the error you just encountered' });
    actions.push({ label: 'Explain error', prompt: 'Explain what caused this error and how to prevent it' });
    return actions.slice(0, 3);
  }

  // After plan or analysis
  if (lc.includes('plan') || lc.includes('roadmap') || lc.includes('architecture') || lc.includes('structure')) {
    actions.push({ label: 'Implement this', prompt: 'Please implement the plan you just described' });
    actions.push({ label: 'Modify plan', prompt: 'Can you adjust the plan? I want to change...' });
    return actions.slice(0, 3);
  }

  // After code analysis or exploration
  if (hasToolCalls && toolNames.some(n => n === 'read_file' || n === 'list_files' || n === 'search_files')) {
    actions.push({ label: 'Go deeper', prompt: 'Can you analyze this in more detail?' });
    actions.push({ label: 'Create a plan', prompt: 'Based on your analysis, create a development plan' });
    return actions.slice(0, 3);
  }

  // After git operations
  if (toolNames.some(n => n.startsWith('git_'))) {
    actions.push({ label: 'Show status', prompt: '/status' });
    actions.push({ label: 'View diff', prompt: '/diff' });
    return actions.slice(0, 3);
  }

  // Generic fallback
  actions.push({ label: 'Go deeper', prompt: 'Can you elaborate on that?' });
  actions.push({ label: 'Create a plan', prompt: 'Create a development plan for this' });

  return actions.slice(0, 3);
}

export default function FollowupButtons({ content, hasToolCalls, toolNames, onAction }: FollowupButtonsProps) {
  const actions = deriveFollowups(content, hasToolCalls, toolNames);

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2 animate-fadeIn">
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => onAction(action.prompt)}
          className="text-[10px] px-2.5 py-1 rounded-full border border-matrix-green/20 text-matrix-green/60 bg-matrix-green/5 hover:bg-matrix-green/10 hover:text-matrix-green hover:border-matrix-green/40 transition-all duration-150 active:scale-95"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
