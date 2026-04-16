/**
 * Slash Command Registry — Sprint 12 + Sprint 15.2
 * Defines command interfaces, registers all commands, and executes them.
 * Commands are invoked from the renderer via IPC and run in the main process.
 * Sprint 15.2: /verify-last truthfulness guard, workspace cwd alignment.
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { getActiveWorkspace, LOCAL_TOOL_DEFINITIONS } from '../tools';
import { getDatabase } from '../db';
import { getMCPManager } from '../mcp';
import { providerRegistry, ClaudeProvider } from '../providers';
import { executeResearch, compareRepos, downloadExternalRepo } from '../research';

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
// Sprint 16: added multi_edit and bash_command to the blocked set
export const WRITE_TOOL_NAMES = [
  'write_file',
  'patch_file',
  'run_command',
  'git_commit',
  'git_create_branch',
  // Sprint 16 mutating tools
  'multi_edit',
  'bash_command',
];

// Tools that are always allowed in Plan mode (read-only/planning)
export const PLAN_MODE_ALLOWED = [
  'read_file',
  'list_files',
  'search_files',
  'git_status',
  'git_diff',
  'git_log',
  'parallel_search',
  'parallel_read',
  'summarize_large_document',
  'task_plan',
];

// ─── Main window reference (for streaming results to renderer) ───
let _mainWindow: any = null;

export function setCommandsMainWindow(win: any): void {
  _mainWindow = win;
}

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
    // Sprint 15.2: warn if workspace path differs from the git cwd
    const realWs = getActiveWorkspace();
    if (realWs && realWs !== ws) {
      return { success: false, message: `**Warning:** Workspace path mismatch. Active: \`${realWs}\`, Context: \`${ws}\`. Please re-activate the workspace.` };
    }
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
    const realWs = getActiveWorkspace();
    if (realWs && realWs !== ws) {
      return { success: false, message: `**Warning:** Workspace path mismatch. Active: \`${realWs}\`, Context: \`${ws}\`. Please re-activate the workspace.` };
    }
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
  description: 'Create a pull request (coming in Sprint 16).',
  category: 'workflow',
  async execute(_args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    return {
      success: true,
      message: '**PR workflow** is coming in Sprint 16. This will create branch + commit + push + draft PR from chat.',
    };
  },
});

register({
  name: 'handoff',
  description: 'Generate developer handoff package (coming in Sprint 16).',
  category: 'workflow',
  async execute(_args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    return {
      success: true,
      message: '**Handoff generation** is coming in Sprint 16. This will generate a zip of plans, tasks, changes, and conversation summary.',
    };
  },
});

register({
  name: 'plan-generate',
  description: 'Generate a development roadmap (coming in Sprint 16).',
  category: 'workflow',
  async execute(_args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    return {
      success: true,
      message: '**Roadmap generation** is coming in Sprint 16. This will analyze the repo and generate plan.md + tasks.md.',
    };
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TRUTHFULNESS VERIFICATION (Sprint 15.2)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'verify-last',
  description: 'Verify the last agent session: compare git status with reported actions, run truthfulness checks.',
  category: 'workflow',
  async execute(_args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const ws = requireWorkspace(ctx);
    const git: SimpleGit = simpleGit(ws);
    const db = getDatabase();

    try {
      // 1. Get current git status
      const status = await git.status();
      const modified = status.modified;
      const staged = status.staged;
      const untracked = status.not_added;
      const deleted = status.deleted;

      // 2. Get recent activity from DB (last 50 events)
      const activity = db.getActivity(ctx.sessionId).slice(0, 50);
      const toolCalls = activity.filter(a => a.action === 'tool_call' || a.action === 'tool_result' || a.action === 'tool_error');
      const fileEdits = toolCalls.filter(a =>
        a.title?.includes('write_file') || a.title?.includes('patch_file') ||
        a.title?.includes('multi_edit') || a.title?.includes('run_command')
      );

      // 3. Get recent diffs from DB
      const diffs = db.getDiffs(ctx.sessionId) || [];
      const systemDiffs = db.getDiffs('system') || [];
      const allDiffs = [...diffs, ...systemDiffs];
      const diffFiles = [...new Set(allDiffs.map(d => d.file_path))];

      // 4. Get last 3 commits
      const log = await git.log({ maxCount: 3 });
      const recentCommits = log.all.map(c => `${c.hash.substring(0, 7)} ${c.message}`);

      // 5. Build verification report
      const lines: string[] = [
        '## Truthfulness Verification Report',
        '',
        '### Git Status (actual)',
        `**Branch:** \`${status.current || '(detached)'}\``,
        `**Working tree:** ${status.isClean() ? 'Clean' : 'Has changes'}`,
        `- Modified: ${modified.length} ${modified.length > 0 ? '(\`' + modified.join('\`, \`') + '\`)' : ''}`,
        `- Staged: ${staged.length} ${staged.length > 0 ? '(\`' + staged.join('\`, \`') + '\`)' : ''}`,
        `- Untracked: ${untracked.length}`,
        `- Deleted: ${deleted.length}`,
        '',
        '### Agent-Reported Activity',
        `- Total tool calls in session: ${toolCalls.length}`,
        `- File-editing tool calls: ${fileEdits.length}`,
        `- DB-recorded diffs: ${allDiffs.length} across ${diffFiles.length} files`,
        '',
        '### Recent Commits',
        recentCommits.length > 0 ? recentCommits.map(c => `- \`${c}\``).join('\n') : '- (none)',
        '',
        '### Cross-Check',
      ];

      // Cross-check: files in git modified vs files in DB diffs
      const gitChangedFiles = new Set([...modified, ...staged, ...untracked]);
      const dbChangedFiles = new Set(diffFiles);
      const inGitNotDb = [...gitChangedFiles].filter(f => !dbChangedFiles.has(f));
      const inDbNotGit = [...dbChangedFiles].filter(f => !gitChangedFiles.has(f));

      if (inGitNotDb.length > 0) {
        lines.push(`**Files changed in git but not tracked in DB diffs:** ${inGitNotDb.map(f => '\`' + f + '\`').join(', ')}`);
        lines.push('This may indicate edits happened outside agent tool calls (e.g., shell commands, manual edits).');
      }
      if (inDbNotGit.length > 0) {
        lines.push(`**Files in DB diffs but clean in git:** ${inDbNotGit.map(f => '\`' + f + '\`').join(', ')}`);
        lines.push('These files may have been committed or reverted since the agent edited them.');
      }
      if (inGitNotDb.length === 0 && inDbNotGit.length === 0) {
        lines.push('**All files match.** Git status and agent-reported diffs are consistent.');
      }

      // Truthfulness score
      const totalChecks = Math.max(gitChangedFiles.size, 1);
      const mismatches = inGitNotDb.length + inDbNotGit.length;
      const truthScore = Math.round(((totalChecks - mismatches) / totalChecks) * 100);
      lines.push('');
      lines.push(`### Truthfulness Score: **${truthScore}%** (${totalChecks - mismatches}/${totalChecks} files consistent)`);

      if (truthScore < 100) {
        lines.push('');
        lines.push('> **Recommendation:** Review mismatched files. Use `/diff` to inspect changes, then `/commit` to stage and commit verified work.');
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: { truthScore, gitChangedFiles: [...gitChangedFiles], dbChangedFiles: [...dbChangedFiles], mismatches },
      };
    } catch (err) {
      return { success: false, message: `Verification failed: ${err instanceof Error ? err.message : String(err)}` };
    }
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

    const question = args.trim();

    // Stream progress to chat via mainWindow
    const sendProgress = (stage: string, detail: string) => {
      if (_mainWindow && !_mainWindow.isDestroyed()) {
        _mainWindow.webContents.send('chat:stream-chunk', {
          sessionId: ctx.sessionId,
          type: 'text',
          content: `\n**[Research: ${stage}]** ${detail}\n`,
          fullContent: `**[Research: ${stage}]** ${detail}`,
        });
      }
    };

    // Execute research asynchronously — don't await; let it stream into chat
    (async () => {
      try {
        const wsPath = ctx.workspacePath || undefined;
        const report = await executeResearch(question, ctx.sessionId, wsPath, (stage, detail) => {
          sendProgress(stage, detail);
        });

        // Send final report as a done message
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send('chat:stream-chunk', {
            sessionId: ctx.sessionId,
            type: 'research-complete',
            report: {
              topic: report.topic,
              findings: report.findings,
              recommendation: report.recommendation,
              plan: report.plan,
            },
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send('chat:stream-chunk', {
            sessionId: ctx.sessionId,
            type: 'error',
            content: `Research failed: ${errMsg}`,
          });
        }
      }
    })();

    return {
      success: true,
      message: `**Deep Research started:** "${question}"\n\nAnalyzing with multi-step research workflow...\nProgress and results will stream into this chat.`,
      data: { action: 'research-started', question },
    };
  },
});

register({
  name: 'research-continue',
  description: 'Continue or refine the last research query. Usage: /research-continue <follow-up>',
  category: 'workflow',
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    if (!args.trim()) {
      return { success: true, message: '**Usage:** `/research-continue <follow-up question or refinement>`' };
    }

    const question = args.trim();

    // Same async pattern as /research
    (async () => {
      try {
        const wsPath = ctx.workspacePath || undefined;
        const report = await executeResearch(question, ctx.sessionId, wsPath, (stage, detail) => {
          if (_mainWindow && !_mainWindow.isDestroyed()) {
            _mainWindow.webContents.send('chat:stream-chunk', {
              sessionId: ctx.sessionId,
              type: 'text',
              content: `\n**[Research: ${stage}]** ${detail}\n`,
              fullContent: `**[Research: ${stage}]** ${detail}`,
            });
          }
        });

        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send('chat:stream-chunk', {
            sessionId: ctx.sessionId,
            type: 'research-complete',
            report: {
              topic: report.topic,
              findings: report.findings,
              recommendation: report.recommendation,
              plan: report.plan,
            },
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send('chat:stream-chunk', {
            sessionId: ctx.sessionId,
            type: 'error',
            content: `Research failed: ${errMsg}`,
          });
        }
      }
    })();

    return {
      success: true,
      message: `**Continuing research:** "${question}"\n\nDeep analysis in progress...`,
      data: { action: 'research-started', question },
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

    const repoA = parts[0];
    const repoB = parts[1];
    const focus = parts.slice(2).join(' ') || undefined;

    // Execute comparison asynchronously
    (async () => {
      try {
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send('chat:stream-chunk', {
            sessionId: ctx.sessionId,
            type: 'text',
            content: '\n**[Comparison]** Gathering repository context...\n',
            fullContent: '**[Comparison]** Gathering repository context...',
          });
        }

        const result = await compareRepos(repoA, repoB, ctx.sessionId, focus);

        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send('chat:stream-chunk', {
            sessionId: ctx.sessionId,
            type: 'research-complete',
            report: {
              topic: `Comparison: ${repoA} vs ${repoB}`,
              findings: result,
              recommendation: '',
              plan: [],
            },
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send('chat:stream-chunk', {
            sessionId: ctx.sessionId,
            type: 'error',
            content: `Comparison failed: ${errMsg}`,
          });
        }
      }
    })();

    return {
      success: true,
      message: `**Comparing:** \`${repoA}\` vs \`${repoB}\`\nFocus: ${focus || 'general'}\n\nAnalysis in progress — results will stream into this chat.`,
      data: { action: 'comparison-started', repoA, repoB, focus },
    };
  },
});
