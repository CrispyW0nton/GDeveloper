/**
 * Dynamic System Prompt Builder — Sprint 27 (Block 2)
 * Constructs context-aware system prompts by composing:
 *   - Base system prompt
 *   - Mode prefix (plan/build)
 *   - Workspace metadata (branch, worktree, status)
 *   - Active todo/checkpoint context
 *   - Available tools summary
 *   - MCP server/tool listing
 *   - Rate-limit awareness
 */

import { SYSTEM_PROMPT } from './prompts';
import { getExecutionMode, WRITE_TOOL_NAMES } from '../commands';
import { getActiveWorkspace, LOCAL_TOOL_DEFINITIONS } from '../tools';
import { getMCPManager } from '../mcp';
import { getTodoProgress, getTodoList } from './todoManager';
import { formatCheckpointSummary, getLatestCheckpoint } from './checkpoint';
import { getRateLimiter } from '../providers/rateLimiter';
import simpleGit from 'simple-git';

export interface PromptBuilderContext {
  sessionId: string;
  workspacePath?: string;
  mcpToolCount?: number;
  localToolCount?: number;
}

/**
 * Build the complete enhanced system prompt for the agentic loop.
 */
export async function buildEnhancedSystemPrompt(ctx: PromptBuilderContext): Promise<string> {
  const sections: string[] = [];

  // 1. Mode prefix
  const mode = getExecutionMode();
  if (mode === 'plan') {
    sections.push(
      'You are in PLAN MODE. You can read, search, and analyze the codebase but you CANNOT modify files, run commands, or make commits. Focus on understanding, researching, and proposing plans. When ready to implement, tell the user to switch to Build mode with /build.'
    );
  } else {
    sections.push(
      'You are in BUILD MODE. You have full access to read, write, patch, and execute commands in the workspace. You can create branches, commit changes, and run shell commands.'
    );
  }

  // 2. Base system prompt
  sections.push(SYSTEM_PROMPT);

  // 3. Workspace context
  const wsPath = ctx.workspacePath || getActiveWorkspace();
  if (wsPath) {
    const wsLines: string[] = [`\nCurrent workspace: ${wsPath}`];
    try {
      const git = simpleGit(wsPath);
      const status = await git.status();
      wsLines.push(`Branch: ${status.current || '(detached)'}`);
      wsLines.push(`Tracking: ${status.tracking || '(none)'}`);
      wsLines.push(`Modified: ${status.modified.length} | Staged: ${status.staged.length} | Untracked: ${status.not_added.length}`);
    } catch { /* git context optional */ }

    // Worktree context
    try {
      const { getWorktreeContext, listWorktrees } = require('../git/worktree');
      const wtContext = getWorktreeContext(wsPath);
      if (wtContext) {
        wsLines.push(`Worktree: ${wtContext.isMain ? 'Main' : 'Linked'}`);
        if (wtContext.isLinked) {
          wsLines.push(`  branch: ${wtContext.branch || 'detached'}, main root: ${wtContext.mainRoot || 'unknown'}`);
        }
        const wts = listWorktrees(wsPath);
        if (wts.length > 1) {
          wsLines.push(`Total worktrees: ${wts.length}`);
        }
      }
    } catch { /* optional */ }

    sections.push(wsLines.join('\n'));
  }

  // 4. Todo/task context
  const todoProgress = getTodoProgress(ctx.sessionId);
  if (todoProgress.total > 0) {
    const todoLines = [`\nTask Progress: ${todoProgress.done}/${todoProgress.total} completed`];
    if (todoProgress.pending.length > 0) {
      todoLines.push(`Next tasks: ${todoProgress.pending.slice(0, 3).join(', ')}`);
    }
    sections.push(todoLines.join('\n'));
  }

  // 5. Checkpoint context
  const cpSummary = formatCheckpointSummary(ctx.sessionId);
  if (cpSummary) {
    sections.push('\n' + cpSummary);
  }

  // 6. Tool summary
  const filteredLocal = mode === 'plan'
    ? LOCAL_TOOL_DEFINITIONS.filter(t => !WRITE_TOOL_NAMES.includes(t.name))
    : LOCAL_TOOL_DEFINITIONS;

  const mcp = getMCPManager();
  const mcpServers = mcp.getServers();
  let mcpToolCount = 0;
  for (const s of mcpServers) {
    if (s.status === 'connected') {
      mcpToolCount += s.tools.filter(t => t.enabled).length;
    }
  }

  sections.push(`\nYou have ${filteredLocal.length + mcpToolCount} tools available (${filteredLocal.length} local + ${mcpToolCount} MCP).`);
  sections.push(`Local tools: ${filteredLocal.map(t => t.name).join(', ')}`);
  if (mode === 'plan') {
    sections.push(`[PLAN MODE] Disabled write tools: ${WRITE_TOOL_NAMES.join(', ')}`);
  }
  if (mcpToolCount > 0) {
    const mcpNames: string[] = [];
    for (const s of mcpServers) {
      if (s.status === 'connected') {
        for (const t of s.tools) {
          if (t.enabled) mcpNames.push(`${s.name}/${t.name}`);
        }
      }
    }
    if (mcpNames.length <= 20) {
      sections.push(`MCP tools: ${mcpNames.join(', ')}`);
    } else {
      sections.push(`MCP tools: ${mcpNames.slice(0, 20).join(', ')} ... and ${mcpNames.length - 20} more`);
    }
  }

  // 7. Rate limit awareness
  const rateLimiter = getRateLimiter();
  const snap = rateLimiter.getSnapshot();
  if (snap.isPaused || snap.inputPercent > 80) {
    sections.push(`\n⚠️ Rate limit awareness: ${snap.isPaused ? 'PAUSED' : 'Approaching limits (' + snap.inputPercent + '% input)'}. Be efficient with token usage.`);
  }

  return sections.join('\n\n');
}
