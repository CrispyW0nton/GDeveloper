/**
 * FollowupButtons — Sprint 12 + Sprint 18
 * Context-aware action buttons shown after AI responses.
 * Sprint 18: improved labels, more context scenarios,
 * worktree-aware suggestions, research follow-ups.
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
  /** Visual style hint */
  variant?: 'primary' | 'secondary' | 'safe';
}

function deriveFollowups(content: string, hasToolCalls: boolean, toolNames: string[]): FollowupAction[] {
  const actions: FollowupAction[] = [];
  const lc = content.toLowerCase();

  // After file edits
  const hasFileWrite = toolNames.some(n => n === 'write_file' || n === 'patch_file' || n === 'multi_edit');
  if (hasFileWrite) {
    actions.push({ label: 'Show diff', prompt: '/diff', variant: 'safe' });
    actions.push({ label: 'Commit changes', prompt: '/commit', variant: 'primary' });
    actions.push({ label: 'Run tests', prompt: 'Run the test suite to verify these changes work correctly', variant: 'safe' });
    return actions.slice(0, 3);
  }

  // After errors
  if (lc.includes('error') || lc.includes('failed') || lc.includes('exception')) {
    actions.push({ label: 'Fix this', prompt: 'Please fix the error you just encountered', variant: 'primary' });
    actions.push({ label: 'Explain error', prompt: 'Explain what caused this error and how to prevent it', variant: 'safe' });
    actions.push({ label: 'Try different approach', prompt: 'Try a different approach to accomplish the same goal', variant: 'secondary' });
    return actions.slice(0, 3);
  }

  // After plan, roadmap, or architecture analysis
  if (lc.includes('plan') || lc.includes('roadmap') || lc.includes('architecture') || lc.includes('structure')) {
    actions.push({ label: 'Implement this', prompt: 'Please implement the plan you just described', variant: 'primary' });
    actions.push({ label: 'Refine plan', prompt: 'Can you adjust the plan? I want to change...', variant: 'secondary' });
    actions.push({ label: 'Estimate effort', prompt: 'How long would each step take? Give rough time estimates.', variant: 'safe' });
    return actions.slice(0, 3);
  }

  // After research reports
  if (lc.includes('research report') || lc.includes('findings') || lc.includes('recommendation')) {
    actions.push({ label: 'Go deeper', prompt: '/research-continue Can you go deeper on the most promising option?', variant: 'safe' });
    actions.push({ label: 'Implement recommendation', prompt: 'Implement the recommended approach from the research', variant: 'primary' });
    return actions.slice(0, 3);
  }

  // After verification reports
  if (lc.includes('truthfulness') || lc.includes('verification report') || lc.includes('truth score')) {
    actions.push({ label: 'Show diff', prompt: '/diff', variant: 'safe' });
    actions.push({ label: 'Commit verified work', prompt: '/commit', variant: 'primary' });
    return actions.slice(0, 3);
  }

  // After code analysis or exploration
  if (hasToolCalls && toolNames.some(n => n === 'read_file' || n === 'list_files' || n === 'search_files' || n === 'parallel_read' || n === 'parallel_search')) {
    actions.push({ label: 'Go deeper', prompt: 'Can you analyze this in more detail?', variant: 'safe' });
    actions.push({ label: 'Create plan', prompt: 'Based on your analysis, create a development plan', variant: 'secondary' });
    actions.push({ label: 'Find issues', prompt: 'Are there any bugs, security issues, or improvements you can spot?', variant: 'safe' });
    return actions.slice(0, 3);
  }

  // After git operations
  if (toolNames.some(n => n.startsWith('git_'))) {
    actions.push({ label: 'Show status', prompt: '/status', variant: 'safe' });
    actions.push({ label: 'View diff', prompt: '/diff', variant: 'safe' });
    return actions.slice(0, 3);
  }

  // After terminal/command execution
  if (toolNames.some(n => n === 'run_command' || n === 'bash_command')) {
    actions.push({ label: 'Run again', prompt: 'Run that command again', variant: 'secondary' });
    actions.push({ label: 'Check status', prompt: '/status', variant: 'safe' });
    return actions.slice(0, 3);
  }

  // Sprint 27: After compare operations
  if (lc.includes('file compare') || lc.includes('folder compare') || lc.includes('3-way merge') || lc.includes('session:')) {
    if (lc.includes('folder compare')) {
      actions.push({ label: 'Show only changed files', prompt: 'Show only the changed TypeScript files', variant: 'safe' });
      actions.push({ label: 'Preview sync L\u2192R', prompt: 'Preview syncing from left to right', variant: 'secondary' });
      actions.push({ label: 'Explain risky changes', prompt: 'Explain the risky changes in this comparison', variant: 'safe' });
    } else if (lc.includes('3-way merge')) {
      actions.push({ label: 'Resolve all conflicts', prompt: 'Apply the best resolution for all conflicts', variant: 'primary' });
      actions.push({ label: 'Explain conflicts', prompt: 'Explain what each conflict is about', variant: 'safe' });
    } else {
      actions.push({ label: 'Explain changes', prompt: 'Explain the key changes between these files', variant: 'safe' });
      actions.push({ label: 'Show word diff', prompt: 'Show the word-level differences', variant: 'safe' });
      actions.push({ label: 'Apply all from right', prompt: 'Apply all changes from the right side', variant: 'primary' });
    }
    return actions.slice(0, 3);
  }

  // Generic fallback
  actions.push({ label: 'Go deeper', prompt: 'Can you elaborate on that?', variant: 'safe' });
  actions.push({ label: 'Create plan', prompt: 'Create a development plan for this', variant: 'secondary' });

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
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-all duration-150 active:scale-95 ${
            action.variant === 'primary'
              ? 'border-matrix-green/30 text-matrix-green/80 bg-matrix-green/8 hover:bg-matrix-green/15 hover:text-matrix-green hover:border-matrix-green/50'
              : action.variant === 'safe'
                ? 'border-blue-400/20 text-blue-400/60 bg-blue-400/5 hover:bg-blue-400/10 hover:text-blue-400 hover:border-blue-400/40'
                : 'border-matrix-border/30 text-matrix-text-muted/50 bg-matrix-bg-hover/50 hover:bg-matrix-green/5 hover:text-matrix-green/70 hover:border-matrix-green/30'
          }`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
