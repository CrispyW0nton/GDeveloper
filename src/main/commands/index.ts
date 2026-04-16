/**
 * Slash Command Registry — Sprint 12
 * Defines command interfaces, registers all commands, and executes them.
 * Commands are invoked from the renderer via IPC and run in the main process.
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { getActiveWorkspace, LOCAL_TOOL_DEFINITIONS } from '../tools';
import { getDatabase } from '../db';
import { getMCPManager } from '../mcp';
import { providerRegistry, ClaudeProvider } from '../providers';

// ─── Interfaces ───

export interface WorkspaceContext {
  workspacePath: string;
  sessionId: string;
  branch?: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: any;
  /** If set, the command needs user confirmation before proceeding */
  needsConfirmation?: boolean;
  confirmAction?: string;
}

export interface SlashCommand {
  name: string;
  description: string;
  category: 'git' | 'mode' | 'info' | 'chat' | 'workflow';
  execute: (args: string, context: WorkspaceContext) => Promise<CommandResult>;
}

// ─── Write tools that are disabled in Plan mode ───
export const WRITE_TOOL_NAMES = [
  'write_file',
  'patch_file',
  'run_command',
  'git_commit',
  'git_create_branch',
];

// ─── Execution Mode State ───
let currentMode: 'plan' | 'build' = 'build';

export function getExecutionMode(): 'plan' | 'build' {
  return currentMode;
}

export function setExecutionMode(mode: 'plan' | 'build'): void {
  currentMode = mode;
}

// ─── Command Registry ───

const commands = new Map<string, SlashCommand>();

function register(cmd: SlashCommand): void {
  commands.set(cmd.name, cmd);
}

export function getCommand(name: string): SlashCommand | undefined {
  return commands.get(name);
}

export function getAllCommands(): SlashCommand[] {
  return Array.from(commands.values());
}

export function getCommandNames(): string[] {
  return Array.from(commands.keys());
}

// ─── Helper: require workspace path ───
function requireWorkspace(ctx: WorkspaceContext): string {
  if (!ctx.workspacePath) {
    throw new Error('No active workspace. Clone or open a repository first.');
  }
  return ctx.workspacePath;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GIT COMMANDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'commit',
  description: 'Stage all changes and commit. Omit message for AI-generated commit.',
  category: 'git',
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const ws = requireWorkspace(ctx);
    const git: SimpleGit = simpleGit(ws);
    const db = getDatabase();

    // Stage all changes
    await git.add('.');
    const status = await git.status();

    if (status.staged.length === 0 && status.isClean()) {
      return { success: true, message: '**No changes to commit.** Working tree is clean.' };
    }

    let commitMessage = args.trim();

    // If no message, generate one with AI
    if (!commitMessage) {
      const diff = await git.diff(['--cached']);
      if (!diff && status.isClean()) {
        return { success: true, message: '**No staged changes found.** Nothing to commit.' };
      }

      const provider = providerRegistry.getDefault();
      if (!provider) {
        return { success: false, message: 'No AI provider configured. Please provide a commit message or configure an API key.' };
      }

      try {
        const aiResponse = await (provider as ClaudeProvider).sendMessage(
          [{ role: 'user', content: `Generate a concise Conventional Commits message for this diff. Reply with ONLY the commit message, nothing else.\n\n${(diff || '(no diff, new files staged)').substring(0, 8000)}` }],
          undefined,
          'You are a git commit message generator. Output a single Conventional Commits message (e.g., "feat(auth): add login endpoint"). No markdown, no explanation, just the message.'
        );
        commitMessage = aiResponse.content.replace(/^["'`]+|["'`]+$/g, '').trim();
      } catch (err) {
        return { success: false, message: `AI commit message generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }

      // Return with confirmation needed
      return {
        success: true,
        message: `**AI-generated commit message:**\n\`${commitMessage}\`\n\nType \`/commit ${commitMessage}\` to accept, or edit the message.`,
        data: { suggestedMessage: commitMessage, staged: status.staged.length },
        needsConfirmation: true,
        confirmAction: 'commit',
      };
    }

    // Commit with the provided message
    try {
      const result = await git.commit(commitMessage);
      const summary = `${result.summary.changes} changed, +${result.summary.insertions} -${result.summary.deletions}`;
      db.logActivity(ctx.sessionId, 'git_commit', `Committed: ${commitMessage}`, summary);

      return {
        success: true,
        message: `**Committed:** \`${result.commit || '(done)'}\`\n**Message:** ${commitMessage}\n**Summary:** ${summary}`,
        data: { commit: result.commit, summary: result.summary },
      };
    } catch (err) {
      return { success: false, message: `Commit failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

register({
  name: 'push',
  description: 'Push current branch to tracking remote.',
  category: 'git',
  async execute(_args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const ws = requireWorkspace(ctx);
    const git: SimpleGit = simpleGit(ws);
    const db = getDatabase();

    try {
      const status = await git.status();
      await git.push();
      db.logActivity(ctx.sessionId, 'git_push', `Pushed branch: ${status.current}`);

      return {
        success: true,
        message: `**Pushed** branch \`${status.current}\` to \`${status.tracking || 'origin'}\`.`,
        data: { branch: status.current, tracking: status.tracking },
      };
    } catch (err) {
      return { success: false, message: `Push failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

register({
  name: 'diff',
  description: 'Show current git diff inline in chat.',
  category: 'git',
  async execute(_args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const ws = requireWorkspace(ctx);
    const git: SimpleGit = simpleGit(ws);

    try {
      const diff = await git.diff();
      const stagedDiff = await git.diff(['--cached']);
      const combined = [
        stagedDiff ? `**Staged changes:**\n\`\`\`diff\n${stagedDiff.substring(0, 12000)}\n\`\`\`` : '',
        diff ? `**Unstaged changes:**\n\`\`\`diff\n${diff.substring(0, 12000)}\n\`\`\`` : '',
      ].filter(Boolean).join('\n\n');

      if (!combined) {
        return { success: true, message: '**No changes.** Working tree is clean.' };
      }

      return { success: true, message: combined };
    } catch (err) {
      return { success: false, message: `Diff failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

register({
  name: 'undo',
  description: 'Soft reset HEAD~1 (undo last commit, keep changes).',
  category: 'git',
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const ws = requireWorkspace(ctx);
    const git: SimpleGit = simpleGit(ws);
    const db = getDatabase();

    try {
      // Get the commit that will be undone
      const log = await git.log({ maxCount: 1 });
      const lastCommit = log.latest;

      if (!lastCommit) {
        return { success: false, message: 'No commits to undo.' };
      }

      if (args.trim().toLowerCase() !== 'confirm') {
        return {
          success: true,
          message: `**Undo last commit?**\n\`${lastCommit.hash.substring(0, 7)}\` ${lastCommit.message}\n\nType \`/undo confirm\` to proceed. Changes will be kept as unstaged.`,
          needsConfirmation: true,
          confirmAction: 'undo',
          data: { commit: lastCommit },
        };
      }

      await git.reset(['--soft', 'HEAD~1']);
      db.logActivity(ctx.sessionId, 'git_reset_soft', `Undid commit: ${lastCommit.message}`);

      return {
        success: true,
        message: `**Undone:** \`${lastCommit.hash.substring(0, 7)}\` ${lastCommit.message}\nChanges are now unstaged.`,
        data: { undoneCommit: lastCommit },
      };
    } catch (err) {
      return { success: false, message: `Undo failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

register({
  name: 'status',
  description: 'Show branch, tracking, ahead/behind, file counts.',
  category: 'git',
  async execute(_args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const ws = requireWorkspace(ctx);
    const git: SimpleGit = simpleGit(ws);

    try {
      const status = await git.status();
      const lines = [
        `**Branch:** \`${status.current || '(detached)'}\``,
        `**Tracking:** \`${status.tracking || '(none)'}\``,
        `**Ahead:** ${status.ahead} | **Behind:** ${status.behind}`,
        '',
        `| Category | Count |`,
        `|---|---|`,
        `| Staged | ${status.staged.length} |`,
        `| Modified | ${status.modified.length} |`,
        `| Untracked | ${status.not_added.length} |`,
        `| Deleted | ${status.deleted.length} |`,
        `| Conflicted | ${status.conflicted.length} |`,
        '',
        status.isClean() ? '**Working tree is clean.**' : '**Working tree has changes.**',
      ];

      return { success: true, message: lines.join('\n') };
    } catch (err) {
      return { success: false, message: `Status failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MODE COMMANDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'plan',
  description: 'Switch to Plan mode (read-only research, write tools disabled).',
  category: 'mode',
  async execute(_args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    setExecutionMode('plan');
    return {
      success: true,
      message: '**Switched to PLAN MODE.** Write tools disabled. Read, search, and analyze only.\nUse `/build` when ready to implement.',
      data: { mode: 'plan' },
    };
  },
});

register({
  name: 'build',
  description: 'Switch to Build mode (all tools enabled).',
  category: 'mode',
  async execute(_args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    setExecutionMode('build');
    return {
      success: true,
      message: '**Switched to BUILD MODE.** All tools enabled. Full read/write access.',
      data: { mode: 'build' },
    };
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INFO COMMANDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'tools',
  description: 'List all available tools (local + MCP) with counts.',
  category: 'info',
  async execute(_args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    const mcp = getMCPManager();
    const mcpServers = mcp.getServers();
    const mcpTools: string[] = [];
    for (const s of mcpServers) {
      if (s.status === 'connected') {
        for (const t of s.tools) {
          if (t.enabled) mcpTools.push(`  - ${t.name}: ${(t.description || '').substring(0, 60)}`);
        }
      }
    }

    const localList = LOCAL_TOOL_DEFINITIONS.map(t => `  - **${t.name}**: ${t.description.substring(0, 60)}`);
    const mode = getExecutionMode();
    const disabledInPlan = mode === 'plan'
      ? `\n\n**Plan mode active** — write tools disabled: ${WRITE_TOOL_NAMES.join(', ')}`
      : '';

    const lines = [
      `**Local Tools (${localList.length}):**`,
      ...localList,
      '',
      `**MCP Tools (${mcpTools.length}):**`,
      mcpTools.length > 0 ? mcpTools.slice(0, 30).join('\n') : '  (none connected)',
      mcpTools.length > 30 ? `  ... and ${mcpTools.length - 30} more` : '',
      '',
      `**Total: ${localList.length + mcpTools.length} tools**`,
      disabledInPlan,
    ];

    return { success: true, message: lines.join('\n') };
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CHAT COMMANDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'clear',
  description: 'Clear current chat display.',
  category: 'chat',
  async execute(_args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const db = getDatabase();
    db.logActivity(ctx.sessionId, 'chat_cleared', 'Chat display cleared via /clear');
    return {
      success: true,
      message: '__CLEAR_CHAT__',
      data: { action: 'clear' },
    };
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  WORKFLOW STUBS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'pr',
  description: 'Create a pull request (coming in Sprint 15).',
  category: 'workflow',
  async execute(_args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    return {
      success: true,
      message: '**PR workflow** is coming in Sprint 15. This will create branch + commit + push + draft PR from chat.',
    };
  },
});

register({
  name: 'handoff',
  description: 'Generate developer handoff package (coming in Sprint 15).',
  category: 'workflow',
  async execute(_args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    return {
      success: true,
      message: '**Handoff generation** is coming in Sprint 15. This will generate a zip of plans, tasks, changes, and conversation summary.',
    };
  },
});

register({
  name: 'plan-generate',
  description: 'Generate a development roadmap (coming in Sprint 15).',
  category: 'workflow',
  async execute(_args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    return {
      success: true,
      message: '**Roadmap generation** is coming in Sprint 15. This will analyze the repo and generate plan.md + tasks.md.',
    };
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RESEARCH COMMANDS (Sprint 13)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'research',
  description: 'Start a deep research workflow. Usage: /research <question>',
  category: 'workflow',
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    if (!args.trim()) {
      return {
        success: true,
        message: '**Usage:** `/research <question>`\n\nExamples:\n- `/research best Electron PTY library for terminal emulation`\n- `/research MCP SSE retry logic patterns`\n- `/research compare React state management approaches`',
      };
    }

    return {
      success: true,
      message: `**Research started:** "${args.trim()}"\n\nThe AI will analyze this question using deep research workflow.\nResults will appear in chat. This may take a moment...`,
      data: { action: 'research', question: args.trim(), workspacePath: ctx.workspacePath, sessionId: ctx.sessionId },
    };
  },
});

register({
  name: 'research-continue',
  description: 'Continue or refine the last research query.',
  category: 'workflow',
  async execute(args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    if (!args.trim()) {
      return { success: true, message: '**Usage:** `/research-continue <follow-up question or refinement>`' };
    }
    return {
      success: true,
      message: `**Continuing research:** "${args.trim()}"`,
      data: { action: 'research-continue', question: args.trim() },
    };
  },
});

register({
  name: 'compare-repos',
  description: 'Compare two repositories. Usage: /compare-repos <path1> <path2> [focus]',
  category: 'workflow',
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
      return {
        success: true,
        message: '**Usage:** `/compare-repos <path-or-url-1> <path-or-url-2> [focus area]`\n\nCompares two projects side by side with architecture analysis, feature comparison, and recommendations.',
      };
    }
    return {
      success: true,
      message: `**Comparing:** \`${parts[0]}\` vs \`${parts[1]}\`\nFocus: ${parts.slice(2).join(' ') || 'general'}`,
      data: { action: 'compare-repos', repoA: parts[0], repoB: parts[1], focus: parts.slice(2).join(' ') },
    };
  },
});
