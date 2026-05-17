/**
 * Slash Command Registry — Sprint 12 + Sprint 15.2 + Sprint 17 + Sprint 27
 * Defines command interfaces, registers all commands, and executes them.
 * Commands are invoked from the renderer via IPC and run in the main process.
 * Sprint 15.2: /verify-last truthfulness guard, workspace cwd alignment.
 * Sprint 17: Worktree slash commands for full worktree lifecycle management.
 * Sprint 27: Compare Agent commands + MCP, Todo, Checkpoint, CHANGELOG, Verify DSL.
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { join, resolve, isAbsolute } from 'path';
import { getActiveWorkspace, LOCAL_TOOL_DEFINITIONS } from '../tools';
import { getDatabase } from '../db';
import { getMCPManager } from '../mcp';
import { MCPTransportType } from '../domain/enums';
import {
  buildMarketplaceInstallPreview,
  getMCPMarketplaceEntry,
  searchMCPMarketplace,
} from '../mcp/marketplace';
import { providerRegistry, ClaudeProvider } from '../providers';
import { executeResearch, compareRepos, downloadExternalRepo } from '../research';
import { fetchGitHubSource, formatSourceSnippets, parseGitHubUrl } from '../research/githubSource';
import {
  worktreeList, worktreeAdd, worktreeRemove, worktreePrune,
  worktreeRepair, worktreeLock, worktreeUnlock, compareWorktreesCmd,
  worktreeIsolate, worktreeHandoff,
} from './worktreeCommands';
import * as compareEngine from '../compare';
import {
  getTodoList, createTodoList, updateTodoItem, appendTodoItems, clearTodoList,
  getTodoProgress, isTodoComplete, type TodoItem,
} from '../orchestration/todoManager';
import {
  createCheckpoint, getCheckpoints, getLatestCheckpoint, clearCheckpoints,
  formatCheckpointSummary,
} from '../orchestration/checkpoint';
import {
  buildChangelogEntry, writeChangelog, formatChangelogMarkdown,
} from '../orchestration/changelog';
import {
  runAssertions, formatVerifyReport, getPersistedReports,
} from '../orchestration/verifier';
import {
  VIBE_LOOP_STAGE_DEFINITIONS,
  formatVibeLoopMarkdown,
  getNextVibeLoopStage,
  getVibeLoopState,
  isVibeLoopStage,
  resetVibeLoopState,
  setVibeLoopStage,
  type VibeLoopStage,
} from '../orchestration/vibeLoop';
import { writeSessionMemento } from '../orchestration/memento';
import { createTracerBullet } from '../orchestration/tracerBullet';
import {
  formatCardboardScanReport,
  scanWorkspaceChangesForCardboardMuffins,
} from '../orchestration/cardboardDetector';
import {
  formatMultiModelVerificationResult,
  runMultiModelVerification,
} from '../orchestration/multiModelVerifier';
import {
  getActiveSpecialistMode,
  listSpecialistModes,
  setActiveSpecialistMode,
} from '../orchestration/specialistModes';
import {
  createAgentDelegationPlan,
  formatAgentDelegationPlan,
  parseAgentMention,
} from '../orchestration/agentDelegation';
import {
  getAgentNamespaceLocks,
  heartbeatAgentLock,
  releaseAgentNamespaces,
  reserveAgentNamespaces,
} from '../worktree/agentLocks';
import {
  buildScheduledAgentRunPackets,
  createScheduledAgent,
  deleteScheduledAgent,
  formatScheduledAgent,
  listScheduledAgents,
  markScheduledAgentRun,
  parseScheduledAgentCadence,
  setScheduledAgentStatus,
} from '../orchestration/scheduledAgents';

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
  /** Sprint 18: whether this command is safe for beginners (read-only) */
  safe?: boolean;
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
  description: 'Stage all changes and commit. Omit message for AI-generated commit message.',
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
  description: 'Push current branch to its tracking remote.',
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
  description: 'Show current git diff inline in chat. Includes both staged and unstaged changes.',
  category: 'git',
  safe: true,
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
  description: 'Show branch, tracking info, ahead/behind counts, and file status.',
  category: 'git',
  safe: true,
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
  description: 'Switch to Plan mode — read-only research, write tools disabled. Safe for exploration.',
  category: 'mode',
  safe: true,
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
  description: 'Switch to Build mode — all tools enabled. Full read, write, and execute access.',
  category: 'mode',
  safe: true,
  async execute(_args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    setExecutionMode('build');
    return {
      success: true,
      message: '**Switched to BUILD MODE.** All tools enabled. Full read/write access.',
      data: { mode: 'build' },
    };
  },
});

register({
  name: 'mode',
  description: 'Show or set specialist mode. Usage: /mode [code|architect|ask|debug|test|custom-id]',
  category: 'mode',
  safe: true,
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const requested = args.trim().toLowerCase();
    const modes = listSpecialistModes(ctx.workspacePath);

    if (!requested || requested === 'status') {
      const active = getActiveSpecialistMode(ctx.workspacePath);
      return {
        success: true,
        message: [
          `**Specialist mode:** ${active.label} (\`${active.id}\`)`,
          active.description,
          '',
          '**Available modes:**',
          ...modes.map(mode => `- \`${mode.id}\` - ${mode.label} (${mode.toolPolicy}, ${mode.source})`),
        ].join('\n'),
        data: { specialistMode: active, modes },
      };
    }

    try {
      const mode = setActiveSpecialistMode(requested, ctx.workspacePath);
      getDatabase().logActivity(ctx.sessionId, 'specialist_mode_set', `Specialist mode: ${mode.label}`, mode.description, {
        modeId: mode.id,
        source: mode.source,
        toolPolicy: mode.toolPolicy,
      });
      return {
        success: true,
        message: `**Specialist mode set:** ${mode.label} (\`${mode.id}\`)\n${mode.description}`,
        data: { specialistMode: mode, action: 'specialist-mode-set' },
      };
    } catch (err) {
      return {
        success: false,
        message: `${err instanceof Error ? err.message : String(err)}\nUse \`/mode\` to list available specialist modes.`,
      };
    }
  },
});

register({
  name: 'delegate',
  description: 'Create a coordinator/sub-agent delegation plan. Usage: /delegate <goal> or /delegate @debug <focused goal>',
  category: 'workflow',
  safe: true,
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const objective = args.trim();
    if (!objective) {
      return {
        success: false,
        message: 'Usage: /delegate <goal> or /delegate @general <focused goal>',
      };
    }

    try {
      const plan = createAgentDelegationPlan(objective, ctx.workspacePath);
      const mention = parseAgentMention(objective, ctx.workspacePath);
      getDatabase().logActivity(ctx.sessionId, 'agent_delegation_plan', `Delegation plan: ${plan.objective}`, `${plan.assignments.length} sub-agent assignment(s)`, {
        planId: plan.id,
        coordinatorModeId: plan.coordinatorModeId,
        assignments: plan.assignments.map(a => ({ id: a.id, roleId: a.roleId, status: a.status })),
        mention,
      });
      return {
        success: true,
        message: formatAgentDelegationPlan(plan),
        data: { action: 'agent-delegation-plan', delegationPlan: plan },
      };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

register({
  name: 'agent-schedule',
  description: 'Manage background agent schedules. Usage: /agent-schedule create <cadence> :: <prompt> | list | due | pause|resume|run|delete <id>',
  category: 'workflow',
  safe: true,
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const trimmed = args.trim();
    const [subcommandRaw, ...rest] = trimmed.split(/\s+/).filter(Boolean);
    const subcommand = (subcommandRaw || 'list').toLowerCase();

    try {
      if (subcommand === 'list') {
        const jobs = listScheduledAgents();
        return {
          success: true,
          message: jobs.length === 0
            ? 'No scheduled agents yet. Use `/agent-schedule create hourly :: summarize open risks`.'
            : ['**Scheduled agents:**', ...jobs.map(formatScheduledAgent)].join('\n'),
          data: { action: 'scheduled-agent-list', jobs },
        };
      }

      if (subcommand === 'due') {
        const packets = buildScheduledAgentRunPackets();
        return {
          success: true,
          message: packets.length === 0
            ? 'No scheduled agents are due right now.'
            : ['**Due scheduled agents:**', ...packets.map(packet => `- \`${packet.jobId}\` due ${packet.dueAt}: ${packet.prompt.split('\n')[0]}`)].join('\n'),
          data: { action: 'scheduled-agent-due', packets },
        };
      }

      if (subcommand === 'create') {
        const createArgs = rest.join(' ');
        const [cadenceText, promptText] = createArgs.split(/\s+::\s+/);
        if (!cadenceText || !promptText) {
          return { success: false, message: 'Usage: /agent-schedule create <hourly|daily|daily@09:00|every 30m> :: <prompt>' };
        }
        const ws = requireWorkspace(ctx);
        const job = createScheduledAgent({
          name: promptText,
          prompt: promptText,
          workspacePath: ws,
          sessionId: ctx.sessionId,
          cadence: parseScheduledAgentCadence(cadenceText),
        });
        getDatabase().logActivity(ctx.sessionId, 'scheduled_agent_created', `Scheduled agent: ${job.name}`, job.prompt, { jobId: job.id, cadence: job.cadence });
        return {
          success: true,
          message: `**Scheduled agent created:**\n${formatScheduledAgent(job)}`,
          data: { action: 'scheduled-agent-created', job },
        };
      }

      const jobId = rest[0];
      if (!jobId) return { success: false, message: `Usage: /agent-schedule ${subcommand} <job-id>` };

      if (subcommand === 'pause' || subcommand === 'resume') {
        const job = setScheduledAgentStatus(jobId, subcommand === 'pause' ? 'paused' : 'active');
        return { success: true, message: formatScheduledAgent(job), data: { action: 'scheduled-agent-status', job } };
      }

      if (subcommand === 'run') {
        const job = markScheduledAgentRun(jobId);
        getDatabase().logActivity(ctx.sessionId, 'scheduled_agent_run_recorded', `Scheduled agent run: ${job.name}`, `Next run: ${job.nextRunAt}`, { jobId: job.id, runCount: job.runCount });
        return { success: true, message: `Recorded scheduled run. ${formatScheduledAgent(job)}`, data: { action: 'scheduled-agent-run-recorded', job } };
      }

      if (subcommand === 'delete') {
        const deleted = deleteScheduledAgent(jobId);
        return { success: deleted, message: deleted ? `Deleted scheduled agent: ${jobId}` : `Scheduled agent not found: ${jobId}` };
      }

      return { success: false, message: 'Unknown agent schedule command. Use list, due, create, pause, resume, run, or delete.' };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INFO COMMANDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'tools',
  description: 'List all available tools (local + MCP) with descriptions and counts.',
  category: 'info',
  safe: true,
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
  description: 'Clear the chat display and show suggestion cards. Chat history is preserved in the database.',
  category: 'chat',
  safe: true,
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
  description: 'Write a session memento for handoff/resume. Usage: /handoff [note]',
  category: 'workflow',
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const ws = requireWorkspace(ctx);
    const result = await writeSessionMemento(ws, ctx.sessionId, args.trim());
    return {
      success: true,
      message: `**Memento written.**\n\nPath: \`${result.relativePath}\`\n\nUse this file to resume or hand off the session with current loop stage, todos, checkpoints, git state, and recent transcript.`,
      data: { memento: result.relativePath },
    };
  },
});

register({
  name: 'memento',
  description: 'Write a resumable session memento to .gd/memento. Usage: /memento [note]',
  category: 'workflow',
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const ws = requireWorkspace(ctx);
    const result = await writeSessionMemento(ws, ctx.sessionId, args.trim());
    return {
      success: true,
      message: `**Memento written.**\n\nPath: \`${result.relativePath}\`\n\nResume prompt and session context are captured in the markdown file.`,
      data: { memento: result.relativePath },
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

register({
  name: 'tracer',
  description: 'Create a tracer-bullet plan and todo ladder. Usage: /tracer <feature or behavior>',
  category: 'workflow',
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const ws = requireWorkspace(ctx);
    const tracer = createTracerBullet(ws, ctx.sessionId, args);
    const vibeLoop = setVibeLoopStage(ctx.sessionId, 'decompose', `Tracer bullet: ${tracer.feature}`);
    getDatabase().logActivity(ctx.sessionId, 'tracer_bullet_created', `Tracer bullet: ${tracer.feature}`, tracer.relativePath, {
      filePath: tracer.filePath,
      tasks: tracer.tasks,
    });
    return {
      success: true,
      message: [
        `**Tracer bullet created:** ${tracer.feature}`,
        '',
        `Path: \`${tracer.relativePath}\``,
        '',
        '**Task ladder:**',
        ...tracer.tasks.map((task, index) => `${index + 1}. ${task}`),
        '',
        'Loop stage moved to **Decompose**.',
      ].join('\n'),
      data: { tracer: tracer.relativePath, vibeLoop },
    };
  },
});

function vibeLoopCommandResult(ctx: WorkspaceContext, stage: VibeLoopStage, note?: string): CommandResult {
  const state = setVibeLoopStage(ctx.sessionId, stage, note);
  const def = VIBE_LOOP_STAGE_DEFINITIONS.find(s => s.id === state.stage);
  getDatabase().logActivity(ctx.sessionId, 'vibe_loop_stage', `Vibe loop: ${def?.label || state.stage}`, state.note || '', {
    stage: state.stage,
    note: state.note,
  });
  return {
    success: true,
    message: formatVibeLoopMarkdown(state),
    data: { vibeLoop: state, action: 'vibe-loop-stage' },
  };
}

register({
  name: 'vibe',
  description: 'Show or change the Vibe Coding Loop stage. Usage: /vibe [frame|decompose|converse|review|test|refine|next|reset] [note]',
  category: 'workflow',
  safe: true,
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const trimmed = args.trim();
    const [rawSubcommand, ...rest] = trimmed.split(/\s+/).filter(Boolean);
    const subcommand = (rawSubcommand || 'status').toLowerCase();
    const note = rest.join(' ');

    if (subcommand === 'status') {
      const state = getVibeLoopState(ctx.sessionId);
      return {
        success: true,
        message: formatVibeLoopMarkdown(state),
        data: { vibeLoop: state, action: 'vibe-loop-status' },
      };
    }

    if (subcommand === 'next') {
      const current = getVibeLoopState(ctx.sessionId);
      return vibeLoopCommandResult(ctx, getNextVibeLoopStage(current.stage), note);
    }

    if (subcommand === 'reset') {
      const state = resetVibeLoopState(ctx.sessionId);
      getDatabase().logActivity(ctx.sessionId, 'vibe_loop_reset', 'Vibe loop reset to Frame');
      return {
        success: true,
        message: formatVibeLoopMarkdown(state),
        data: { vibeLoop: state, action: 'vibe-loop-reset' },
      };
    }

    if (isVibeLoopStage(subcommand)) {
      return vibeLoopCommandResult(ctx, subcommand, note);
    }

    const stages = VIBE_LOOP_STAGE_DEFINITIONS.map(s => s.id).join(', ');
    return {
      success: false,
      message: `Unknown Vibe Coding Loop stage: \`${subcommand}\`.\nUse one of: ${stages}, next, reset, status.`,
    };
  },
});

for (const stageDef of VIBE_LOOP_STAGE_DEFINITIONS) {
  register({
    name: stageDef.id,
    description: `Vibe Coding Loop: ${stageDef.intent}`,
    category: 'workflow',
    safe: true,
    async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
      return vibeLoopCommandResult(ctx, stageDef.id, args.trim());
    },
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TRUTHFULNESS VERIFICATION (Sprint 15.2)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'verify-last',
  description: 'Verify truthfulness: compare git status against agent-reported actions, show consistency score.',
  category: 'workflow',
  safe: true,
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
      const unstagedDiff = await git.diff();
      const stagedDiff = await git.diff(['--cached']);
      const cardboardScan = scanWorkspaceChangesForCardboardMuffins(
        ws,
        [unstagedDiff, stagedDiff].filter(Boolean).join('\n'),
        untracked,
      );

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

      // 4b. Sprint 17: Get worktree context
      let worktreeLabel = '';
      try {
        const { getWorktreeContext: getWtCtx } = require('../git/worktree');
        const wtCtx = getWtCtx(ws);
        if (wtCtx) {
          worktreeLabel = wtCtx.isMain ? 'Main Worktree' : `Linked Worktree: ${wtCtx.branch || 'detached ' + wtCtx.head?.substring(0, 7)}`;
        }
      } catch { /* optional */ }

      // 5. Build verification report
      const lines: string[] = [
        '## Truthfulness Verification Report',
        '',
        worktreeLabel ? `**Worktree:** ${worktreeLabel}` : '',
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
      lines.push('');
      lines.push(formatCardboardScanReport(cardboardScan));

      if (truthScore < 100 || cardboardScan.findings.some(f => f.severity === 'critical' || f.severity === 'high')) {
        lines.push('');
        lines.push('> **Recommendation:** Review mismatched files and safety findings. Use `/diff` to inspect changes, fix high-risk findings, then `/commit` only after verified work is clean.');
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: { truthScore, gitChangedFiles: [...gitChangedFiles], dbChangedFiles: [...dbChangedFiles], mismatches, cardboardScan },
      };
    } catch (err) {
      return { success: false, message: `Verification failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

register({
  name: 'verify-with',
  description: 'Ask a configured provider/model to review the current diff. Usage: /verify-with [provider] [model]',
  category: 'workflow',
  safe: true,
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const ws = requireWorkspace(ctx);
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const providerName = parts[0] || providerRegistry.activeProvider || providerRegistry.getDefault()?.name || '';
    const modelId = parts.slice(1).join(' ') || undefined;

    const provider = providerName ? providerRegistry.get(providerName) : providerRegistry.getDefault();
    if (!provider) {
      const available = providerRegistry.list();
      return {
        success: false,
        message: available.length
          ? `Provider \`${providerName || '(default)'}\` is not configured. Available providers: ${available.map(p => `\`${p}\``).join(', ')}.`
          : 'No AI provider is configured. Configure a provider before running `/verify-with`.',
      };
    }

    const git: SimpleGit = simpleGit(ws);
    const status = await git.status();
    const unstagedDiff = await git.diff();
    const stagedDiff = await git.diff(['--cached']);
    const diffText = [unstagedDiff, stagedDiff].filter(Boolean).join('\n');
    const changedCount = status.modified.length + status.staged.length + status.not_added.length + status.deleted.length;

    if (!diffText.trim() && status.not_added.length === 0) {
      return {
        success: true,
        message: '**No current diff to verify.** Working tree appears clean.',
      };
    }

    const cardboardScan = scanWorkspaceChangesForCardboardMuffins(ws, diffText, status.not_added);
    const statusSummary = [
      `Branch: ${status.current || '(detached)'}`,
      `Changed files: ${changedCount}`,
      `Modified: ${status.modified.length}`,
      `Staged: ${status.staged.length}`,
      `Untracked: ${status.not_added.length}`,
      `Deleted: ${status.deleted.length}`,
      `Cardboard scan score: ${cardboardScan.score}% (${cardboardScan.findings.length} findings)`,
    ].join('\n');

    try {
      const result = await runMultiModelVerification({
        provider,
        providerName: provider.name,
        modelId,
        diffText,
        statusSummary,
        cardboardScan,
      });
      getDatabase().logActivity(ctx.sessionId, 'multi_model_verify', `Verified diff with ${result.providerName}`, result.modelId || '', {
        provider: result.providerName,
        model: result.modelId,
        usage: result.usage,
        cardboardScore: cardboardScan.score,
      });

      return {
        success: true,
        message: formatMultiModelVerificationResult(result),
        data: { result, cardboardScan },
      };
    } catch (err) {
      return {
        success: false,
        message: `Multi-model verification failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RESEARCH COMMANDS (Sprint 13)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'research',
  description: 'Start a deep multi-step research workflow. Usage: /research <question>',
  category: 'workflow',
  safe: true,
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
  safe: true,
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  WORKTREE COMMANDS (Sprint 17)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'worktree-list',
  description: 'List all git worktrees for the current repo.',
  category: 'git',
  execute: worktreeList,
});

register({
  name: 'worktree-add',
  description: 'Create a new worktree. Usage: /worktree-add <path> [branch|commit] [--detach] [--force] [-b name]',
  category: 'git',
  execute: worktreeAdd,
});

register({
  name: 'worktree-remove',
  description: 'Remove a linked worktree. Usage: /worktree-remove <path> [--force]',
  category: 'git',
  execute: worktreeRemove,
});

register({
  name: 'worktree-prune',
  description: 'Prune stale worktree references. Usage: /worktree-prune [--dry-run]',
  category: 'git',
  execute: worktreePrune,
});

register({
  name: 'worktree-repair',
  description: 'Repair worktree references. Usage: /worktree-repair [path]',
  category: 'git',
  execute: worktreeRepair,
});

register({
  name: 'worktree-lock',
  description: 'Lock a worktree to prevent pruning. Usage: /worktree-lock <path> [reason]',
  category: 'git',
  execute: worktreeLock,
});

register({
  name: 'worktree-unlock',
  description: 'Unlock a worktree. Usage: /worktree-unlock <path>',
  category: 'git',
  execute: worktreeUnlock,
});

register({
  name: 'compare-worktrees',
  description: 'Compare two worktrees. Usage: /compare-worktrees <path1> <path2>',
  category: 'git',
  execute: compareWorktreesCmd,
});

register({
  name: 'worktree-isolate',
  description: 'Create an isolated task worktree. Usage: /worktree-isolate <task description> [--permanent]',
  category: 'workflow',
  execute: worktreeIsolate,
});

register({
  name: 'worktree-handoff',
  description: 'Get handoff info for a worktree. Usage: /worktree-handoff [worktree-path] [target-branch]',
  category: 'workflow',
  execute: worktreeHandoff,
});

register({
  name: 'agent-lock',
  description: 'Reserve file namespaces for an agent task. Usage: /agent-lock <task-id> <path> [more paths...]',
  category: 'workflow',
  safe: true,
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const [taskId, ...namespaces] = args.trim().split(/\s+/).filter(Boolean);
    if (!taskId || namespaces.length === 0) {
      return { success: false, message: 'Usage: /agent-lock <task-id> <path> [more paths...]' };
    }
    const result = reserveAgentNamespaces(taskId, ctx.sessionId, namespaces);
    getDatabase().logActivity(ctx.sessionId, 'agent_namespace_lock', result.success ? `Reserved namespaces for ${taskId}` : `Namespace conflict for ${taskId}`, result.message, {
      taskId,
      namespaces,
      conflicts: result.conflicts || [],
    });
    return {
      success: result.success,
      message: result.success
        ? `**Namespace lock reserved:** ${taskId}\n${result.lock?.namespaces.map(ns => `- \`${ns}\``).join('\n')}`
        : `**Namespace lock blocked:** ${result.message}\n${(result.conflicts || []).map(c => `- ${c.taskId}: ${c.namespaces.join(', ')}`).join('\n')}`,
      data: { action: 'agent-lock', result },
    };
  },
});

register({
  name: 'agent-unlock',
  description: 'Release an agent namespace lock. Usage: /agent-unlock <task-id>',
  category: 'workflow',
  safe: true,
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const taskId = args.trim();
    if (!taskId) return { success: false, message: 'Usage: /agent-unlock <task-id>' };
    const result = releaseAgentNamespaces(taskId);
    getDatabase().logActivity(ctx.sessionId, 'agent_namespace_unlock', `Released namespaces for ${taskId}`, result.message, { taskId });
    return { success: result.success, message: result.message, data: { action: 'agent-unlock', result } };
  },
});

register({
  name: 'agent-heartbeat',
  description: 'Refresh or list agent namespace lock heartbeats. Usage: /agent-heartbeat [task-id]',
  category: 'workflow',
  safe: true,
  async execute(args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    const taskId = args.trim();
    if (taskId) {
      const result = heartbeatAgentLock(taskId);
      return { success: result.success, message: result.message, data: { action: 'agent-heartbeat', result } };
    }
    const active = getAgentNamespaceLocks();
    return {
      success: true,
      message: active.length === 0
        ? 'No active agent namespace locks.'
        : ['**Active agent namespace locks:**', ...active.map(lock => `- \`${lock.taskId}\` ${lock.namespaces.join(', ')} heartbeat ${lock.heartbeatAt}`)].join('\n'),
      data: { action: 'agent-heartbeat-list', locks: active },
    };
  },
});

// ─── Sprint 27: Compare Agent Commands ───

function resolveComparePath(path: string, workspacePath: string): string {
  if (isAbsolute(path)) return path;
  return resolve(workspacePath, path);
}

register({
  name: 'compare-file',
  description: 'Compare two files side-by-side with line and word diff. Usage: /compare-file <left> <right> [--ignore-whitespace]',
  category: 'workflow',
  safe: true,
  execute: async (args: string, context: WorkspaceContext) => {
    const parts = args.trim().split(/\s+/);
    const flags = parts.filter(p => p.startsWith('--'));
    const paths = parts.filter(p => !p.startsWith('--'));

    if (paths.length < 2) {
      return { success: false, message: 'Usage: /compare-file <left-path> <right-path> [--ignore-whitespace]\n\nExamples:\n  /compare-file src/old.ts src/new.ts\n  /compare-file main:src/app.ts feature:src/app.ts --ignore-whitespace' };
    }

    const leftPath = resolveComparePath(paths[0], context.workspacePath);
    const rightPath = resolveComparePath(paths[1], context.workspacePath);
    const filters: any = {};
    if (flags.includes('--ignore-whitespace')) filters.ignoreWhitespace = true;

    const session = compareEngine.compareFiles(leftPath, rightPath, filters);
    const output = compareEngine.getCompactOutput(session.id);

    if (session.status === 'error') {
      return { success: false, message: `Compare failed: ${session.error}` };
    }

    const fr = session.fileResult!;
    const s = fr.summary;
    let msg = `## File Compare: ${paths[0]} ↔ ${paths[1]}\n`;
    msg += `**Session:** \`${session.id}\`\n\n`;

    if (fr.identical) {
      msg += '✅ **Files are identical** — no differences found.\n';
    } else {
      msg += `| Metric | Value |\n|---|---|\n`;
      msg += `| Hunks | ${s.totalHunks} |\n`;
      msg += `| Lines added | +${s.linesAdded} |\n`;
      msg += `| Lines removed | -${s.linesRemoved} |\n`;
      msg += `| Lines modified | ~${s.linesModified} |\n`;
      if (s.movedBlocks > 0) msg += `| Moved blocks | ${s.movedBlocks} |\n`;
      if (s.riskFlags.length > 0) msg += `\n⚠️ **Risk flags:** ${s.riskFlags.join(', ')}\n`;

      msg += `\n### First ${Math.min(3, s.totalHunks)} hunk(s):\n`;
      for (const hunk of fr.hunks.slice(0, 3)) {
        msg += `\n**Hunk ${hunk.index}** (line ${hunk.oldStart}):\n\`\`\`diff\n`;
        for (const line of hunk.lines.slice(0, 15)) {
          const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
          msg += `${prefix}${line.content}\n`;
        }
        if (hunk.lines.length > 15) msg += `... (${hunk.lines.length - 15} more lines)\n`;
        msg += '```\n';
      }
      if (s.totalHunks > 3) msg += `\n*${s.totalHunks - 3} more hunk(s) available. Ask to see specific hunks or open in Compare Workspace.*\n`;
    }

    msg += `\n**Actions:** View all hunks • Apply left/right • Explain changes • Open in Compare Workspace`;

    return {
      success: true,
      message: msg,
      data: { compareSession: output },
    };
  },
});

register({
  name: 'merge-3way',
  description: '3-way merge with conflict detection. Usage: /merge-3way <left> <right> <base> [--output <path>]',
  category: 'workflow',
  execute: async (args: string, context: WorkspaceContext) => {
    const parts = args.trim().split(/\s+/);
    const outputIdx = parts.indexOf('--output');
    let outputPath: string | undefined;
    if (outputIdx !== -1 && parts[outputIdx + 1]) {
      outputPath = resolveComparePath(parts[outputIdx + 1], context.workspacePath);
      parts.splice(outputIdx, 2);
    }

    const paths = parts.filter(p => !p.startsWith('--'));
    if (paths.length < 3) {
      return { success: false, message: 'Usage: /merge-3way <left> <right> <base> [--output <path>]\n\nPerforms a 3-way merge using <base> as the common ancestor.\n\nExample:\n  /merge-3way feature/app.ts main/app.ts base/app.ts --output merged.ts' };
    }

    const leftPath = resolveComparePath(paths[0], context.workspacePath);
    const rightPath = resolveComparePath(paths[1], context.workspacePath);
    const basePath = resolveComparePath(paths[2], context.workspacePath);

    const session = compareEngine.merge3Way(leftPath, rightPath, basePath);
    const output = compareEngine.getCompactOutput(session.id);

    if (session.status === 'error') {
      return { success: false, message: `Merge failed: ${session.error}` };
    }

    const mr = session.mergeResult!;
    let msg = `## 3-Way Merge\n`;
    msg += `**Left:** ${paths[0]} | **Right:** ${paths[1]} | **Base:** ${paths[2]}\n`;
    msg += `**Session:** \`${session.id}\`\n\n`;
    msg += `| Metric | Value |\n|---|---|\n`;
    msg += `| Total hunks | ${mr.summary.totalHunks} |\n`;
    msg += `| Conflicts | ${mr.summary.conflicts} |\n`;
    msg += `| Auto-merged | ${mr.summary.autoMerged} |\n`;

    if (mr.allResolved) {
      msg += '\n✅ **All conflicts resolved** — merge is clean.\n';
    } else if (mr.summary.conflicts > 0) {
      msg += `\n⚠️ **${mr.summary.conflicts} conflict(s) need resolution.**\n`;
      msg += 'Use "apply hunk N left/right/base" to resolve each conflict.\n';
    }

    if (outputPath && mr.allResolved) {
      compareEngine.saveMergeResult(session.id, outputPath);
      msg += `\n📝 Merged output saved to: \`${outputPath}\`\n`;
    }

    msg += `\n**Actions:** Apply left • Apply right • Apply base • Explain conflicts • Open in Compare Workspace`;

    return {
      success: true,
      message: msg,
      data: { compareSession: output },
    };
  },
});

register({
  name: 'compare-folder',
  description: 'Compare two folders recursively. Usage: /compare-folder <left-dir> <right-dir> [--no-recursive] [--include "*.ts"] [--exclude "node_modules"]',
  category: 'workflow',
  safe: true,
  execute: async (args: string, context: WorkspaceContext) => {
    const parts = args.trim().split(/\s+/);
    const filters: any = { recursive: true };

    // Parse flags
    const cleanParts: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '--no-recursive') {
        filters.recursive = false;
      } else if (parts[i] === '--include' && parts[i + 1]) {
        filters.includePatterns = (filters.includePatterns || []).concat(parts[++i].replace(/"/g, ''));
      } else if (parts[i] === '--exclude' && parts[i + 1]) {
        filters.excludePatterns = (filters.excludePatterns || []).concat(parts[++i].replace(/"/g, ''));
      } else if (!parts[i].startsWith('--')) {
        cleanParts.push(parts[i]);
      }
    }

    if (cleanParts.length < 2) {
      return { success: false, message: 'Usage: /compare-folder <left-dir> <right-dir> [options]\n\nOptions:\n  --no-recursive       Only compare top-level entries\n  --include "*.ts"     Include only matching files\n  --exclude "dist"     Exclude matching files/directories\n\nExample:\n  /compare-folder src/ backup/src/ --exclude "*.map"' };
    }

    const leftPath = resolveComparePath(cleanParts[0], context.workspacePath);
    const rightPath = resolveComparePath(cleanParts[1], context.workspacePath);

    const session = compareEngine.compareFolders(leftPath, rightPath, filters);
    const output = compareEngine.getCompactOutput(session.id);

    if (session.status === 'error') {
      return { success: false, message: `Folder compare failed: ${session.error}` };
    }

    const fr = session.folderResult!;
    const s = fr.summary;
    let msg = `## Folder Compare: ${cleanParts[0]} ↔ ${cleanParts[1]}\n`;
    msg += `**Session:** \`${session.id}\` | **Recursive:** ${fr.recursive ? 'yes' : 'no'}\n\n`;
    msg += `| State | Count |\n|---|---|\n`;
    msg += `| Total entries | ${s.totalEntries} |\n`;
    msg += `| ✅ Identical | ${s.identical} |\n`;
    msg += `| ✏️ Different | ${s.different} |\n`;
    msg += `| ◀️ Left only | ${s.leftOnly} |\n`;
    msg += `| ▶️ Right only | ${s.rightOnly} |\n`;
    if (s.filtered > 0) msg += `| 🔇 Filtered | ${s.filtered} |\n`;
    if (s.errors > 0) msg += `| ❌ Errors | ${s.errors} |\n`;

    if (s.topChangedFiles.length > 0) {
      msg += `\n### Top changed files:\n`;
      for (const f of s.topChangedFiles.slice(0, 8)) {
        msg += `- \`${f.path}\` — +${f.added} / -${f.removed}\n`;
      }
    }

    if (s.riskFlags.length > 0) msg += `\n⚠️ **Risk flags:** ${s.riskFlags.join(', ')}\n`;
    msg += `\n**Actions:** View file detail • Sync preview (L→R) • Sync preview (R→L) • Filter • Explain changes • Open in Compare Workspace`;

    return {
      success: true,
      message: msg,
      data: { compareSession: output },
    };
  },
});

register({
  name: 'sync-preview',
  description: 'Preview folder sync actions before applying. Usage: /sync-preview <session-id> <left-to-right|right-to-left>',
  category: 'workflow',
  safe: true,
  execute: async (args: string, _context: WorkspaceContext) => {
    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
      return { success: false, message: 'Usage: /sync-preview <session-id> <left-to-right|right-to-left>\n\nPreview what would happen if you sync a folder comparison.\nRun /compare-folder first to create a session.' };
    }

    const sessionId = parts[0];
    const direction = parts[1] as any;

    if (direction !== 'left-to-right' && direction !== 'right-to-left') {
      return { success: false, message: 'Direction must be "left-to-right" or "right-to-left".' };
    }

    const result = compareEngine.syncPreview(sessionId, direction);
    if (!result) {
      return { success: false, message: `Session "${sessionId}" not found or is not a folder comparison.` };
    }

    const s = result.summary;
    let msg = `## Sync Preview: ${direction}\n`;
    msg += `**Session:** \`${sessionId}\`\n\n`;
    msg += `| Action | Count |\n|---|---|\n`;
    msg += `| 📋 Copy | ${s.copies} |\n`;
    msg += `| ♻️ Overwrite | ${s.overwrites} |\n`;
    msg += `| 🗑️ Delete | ${s.deletes} |\n`;
    msg += `| ⏭️ Skip | ${s.skips} |\n`;
    msg += `| **Total** | **${s.totalActions}** |\n`;

    if (s.dangerFlags.length > 0) {
      msg += `\n🚨 **Danger flags:**\n`;
      for (const f of s.dangerFlags) {
        msg += `- ⚠️ ${f}\n`;
      }
    }

    if (result.actions.length > 0) {
      msg += `\n### Actions (first 10):\n`;
      for (const a of result.actions.slice(0, 10)) {
        const icon = a.action === 'copy' ? '📋' : a.action === 'overwrite' ? '♻️' : a.action === 'delete' ? '🗑️' : '⏭️';
        const danger = a.danger ? ' ⚠️' : '';
        msg += `- ${icon} \`${a.relativePath}\` — ${a.action}${danger}\n`;
      }
      if (result.actions.length > 10) {
        msg += `*... and ${result.actions.length - 10} more action(s)*\n`;
      }
    }

    msg += `\n**Note:** This is a preview only. No files have been modified. Destructive sync apply is NOT available in this sprint.`;

    return {
      success: true,
      message: msg,
      data: { syncPreview: result },
    };
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SPRINT 27: MCP COMMANDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'mcp',
  description: 'MCP server management. Subcommands: add, remove, connect, disconnect, list, test',
  category: 'workflow',
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase();
    const mcp = getMCPManager();
    const db = getDatabase();

    if (!sub || sub === 'list') {
      const servers = mcp.getServers();
      if (servers.length === 0) {
        return { success: true, message: '**No MCP servers registered.**\n\nUse `/mcp add <name> stdio <command> [args...]` or `/mcp add <name> http <url>` to add one.' };
      }
      const lines = servers.map(s => {
        const status = s.status === 'connected' ? '🟢' : s.status === 'error' ? '🔴' : '⚪';
        return `${status} **${s.name}** (${s.transport}) — ${s.tools.length} tools — ${s.status}`;
      });
      return { success: true, message: `**MCP Servers (${servers.length}):**\n${lines.join('\n')}` };
    }

    if (sub === 'add') {
      // /mcp add <name> stdio <command> [args...]
      // /mcp add <name> http|sse <url>
      const name = parts[1];
      const transport = parts[2]?.toLowerCase();
      if (!name || !transport) {
        return { success: false, message: 'Usage: `/mcp add <name> stdio <command> [args...]` or `/mcp add <name> http <url>`' };
      }

      const id = `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      const config: any = {
        id, name, enabled: true, autoStart: false, status: 'disconnected', tools: [],
      };

      if (transport === 'stdio') {
        config.transport = MCPTransportType.STDIO;
        config.command = parts[3] || '';
        config.args = parts.slice(4);
      } else if (transport === 'http' || transport === 'sse') {
        config.transport = transport === 'sse' ? MCPTransportType.SSE : MCPTransportType.HTTP;
        config.url = parts[3] || '';
      } else {
        return { success: false, message: `Unknown transport: ${transport}. Use stdio, http, or sse.` };
      }

      const server = await mcp.addServer(config);
      db.logActivity(ctx.sessionId, 'mcp_add', `Added MCP server: ${name}`, '', { serverId: server.id });
      return { success: true, message: `**Added MCP server:** ${name} (${transport})\nUse \`/mcp connect ${name}\` to connect.`, data: { server } };
    }

    if (sub === 'remove') {
      const name = parts[1];
      const servers = mcp.getServers();
      const server = servers.find(s => s.name.toLowerCase() === name?.toLowerCase() || s.id === name);
      if (!server) return { success: false, message: `Server "${name}" not found.` };
      await mcp.removeServer(server.id);
      return { success: true, message: `**Removed:** ${server.name}` };
    }

    if (sub === 'connect') {
      const name = parts[1];
      const servers = mcp.getServers();
      const server = servers.find(s => s.name.toLowerCase() === name?.toLowerCase() || s.id === name);
      if (!server) return { success: false, message: `Server "${name}" not found. Use \`/mcp list\` to see available servers.` };
      try {
        await mcp.connectServer(server.id);
        const updated = mcp.getServer(server.id);
        return { success: true, message: `**Connected:** ${server.name} — ${updated?.tools.length || 0} tools discovered.` };
      } catch (err) {
        return { success: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    if (sub === 'disconnect') {
      const name = parts[1];
      const servers = mcp.getServers();
      const server = servers.find(s => s.name.toLowerCase() === name?.toLowerCase() || s.id === name);
      if (!server) return { success: false, message: `Server "${name}" not found.` };
      await mcp.disconnectServer(server.id);
      return { success: true, message: `**Disconnected:** ${server.name}` };
    }

    if (sub === 'test') {
      const name = parts[1];
      const servers = mcp.getServers();
      const server = servers.find(s => s.name.toLowerCase() === name?.toLowerCase() || s.id === name);
      if (!server) return { success: false, message: `Server "${name}" not found.` };
      const result = await mcp.testConnection(server.id);
      return { success: true, message: `**Test:** ${server.name}\nReachable: ${result.reachable ? '✅' : '❌'}\nMCP Ready: ${result.mcpReady ? '✅' : '❌'}${result.error ? `\nError: ${result.error}` : ''}` };
    }

    return { success: false, message: 'Unknown subcommand. Use: list, add, remove, connect, disconnect, test' };
  },
});

register({
  name: 'mcp-marketplace',
  description: 'Search, preview, or install servers from the official MCP Registry. Usage: /mcp-marketplace search <query> | preview <name> | install <name>',
  category: 'workflow',
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || 'search').toLowerCase();
    const query = parts.slice(1).join(' ');
    const mcp = getMCPManager();
    const db = getDatabase();

    if (sub === 'search' || sub === 'list') {
      const entries = await searchMCPMarketplace(query, 20);
      if (entries.length === 0) {
        return { success: true, message: `**No MCP registry matches** for \`${query || '(all)'}\`.` };
      }
      const lines = entries.map(entry => [
        `- **${entry.title}**`,
        `  - name: \`${entry.name}\``,
        entry.description ? `  - ${entry.description.substring(0, 140)}` : '',
        entry.status ? `  - status: ${entry.status}` : '',
      ].filter(Boolean).join('\n'));
      return {
        success: true,
        message: [
          `**MCP Registry Results (${entries.length})**`,
          '',
          ...lines,
          '',
          'Use `/mcp-marketplace preview <name>` before installing.',
        ].join('\n'),
        data: { entries },
      };
    }

    if (sub === 'preview' || sub === 'inspect') {
      if (!query) return { success: false, message: 'Usage: `/mcp-marketplace preview <server-name>`' };
      const entry = await getMCPMarketplaceEntry(query);
      const preview = buildMarketplaceInstallPreview(entry);
      return {
        success: true,
        message: formatMarketplacePreview(preview),
        data: { preview },
      };
    }

    if (sub === 'install') {
      if (!query) return { success: false, message: 'Usage: `/mcp-marketplace install <server-name>`' };
      const entry = await getMCPMarketplaceEntry(query);
      const preview = buildMarketplaceInstallPreview(entry);
      if (!preview.installable || !preview.config) {
        return { success: false, message: formatMarketplacePreview(preview) };
      }
      const server = await mcp.addServer(preview.config);
      db.logActivity(ctx.sessionId, 'mcp_marketplace_install', `Installed MCP server: ${server.name}`, entry.name, {
        registryName: entry.name,
        serverId: server.id,
        transport: server.transport,
      });
      return {
        success: true,
        message: [
          `**Installed MCP server:** ${server.name}`,
          '',
          `Registry name: \`${entry.name}\``,
          `Transport: \`${server.transport}\``,
          '',
          'Use `/mcp connect ' + server.name + '` to connect and discover tools.',
        ].join('\n'),
        data: { server, entry },
      };
    }

    return { success: false, message: 'Unknown subcommand. Use: search, preview, install.' };
  },
});

function formatMarketplacePreview(preview: ReturnType<typeof buildMarketplaceInstallPreview>): string {
  const lines = [
    `**${preview.entry.title}**`,
    `Registry name: \`${preview.entry.name}\``,
    preview.entry.version ? `Version: \`${preview.entry.version}\`` : '',
    preview.entry.status ? `Status: \`${preview.entry.status}\`` : '',
    preview.entry.description || '',
    '',
    preview.installable ? '**Install preview:**' : '**Not installable from available metadata.**',
    preview.reason ? `Reason: ${preview.reason}` : '',
    ...preview.permissionPreview.map(item => `- ${item}`),
  ].filter(Boolean);
  if (preview.installable) {
    lines.push('', `Use \`/mcp-marketplace install ${preview.entry.name}\` to register this server.`);
  }
  return lines.join('\n');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SPRINT 27: TODO COMMANDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'todo',
  description: 'Task management. Subcommands: list, add <task>, done <id>, clear',
  category: 'workflow',
  safe: true,
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase();

    if (!sub || sub === 'list') {
      const list = getTodoList(ctx.sessionId);
      if (!list || list.items.length === 0) {
        return { success: true, message: '**No tasks.** Use `/todo add <task description>` to create one.' };
      }
      const progress = getTodoProgress(ctx.sessionId);
      const lines = list.items.map(i => {
        const icon = i.status === 'done' ? '✅' : i.status === 'in_progress' ? '🔄' : i.status === 'blocked' ? '🚫' : '⬜';
        return `${icon} \`${i.id}\` ${i.content} [${i.priority}]`;
      });
      return { success: true, message: `**Tasks (${progress.done}/${progress.total}):**\n${lines.join('\n')}` };
    }

    if (sub === 'add') {
      const content = parts.slice(1).join(' ');
      if (!content) return { success: false, message: 'Usage: `/todo add <task description>`' };
      appendTodoItems(ctx.sessionId, [{ content }]);
      return { success: true, message: `**Added:** ${content}` };
    }

    if (sub === 'done') {
      const id = parts[1];
      if (!id) return { success: false, message: 'Usage: `/todo done <task-id>`' };
      const item = updateTodoItem(ctx.sessionId, id, { status: 'done' });
      if (!item) return { success: false, message: `Task "${id}" not found.` };
      return { success: true, message: `**Done:** ${item.content}` };
    }

    if (sub === 'progress') {
      const id = parts[1];
      if (!id) return { success: false, message: 'Usage: `/todo progress <task-id>`' };
      const item = updateTodoItem(ctx.sessionId, id, { status: 'in_progress' });
      if (!item) return { success: false, message: `Task "${id}" not found.` };
      return { success: true, message: `**In Progress:** ${item.content}` };
    }

    if (sub === 'clear') {
      clearTodoList(ctx.sessionId);
      return { success: true, message: '**Cleared** all tasks.' };
    }

    return { success: false, message: 'Unknown subcommand. Use: list, add, done, progress, clear' };
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SPRINT 27: CHECKPOINT COMMANDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'checkpoint',
  description: 'Create or view checkpoints. Subcommands: create <label>, list, clear',
  category: 'workflow',
  safe: true,
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase();

    if (!sub || sub === 'list') {
      const summary = formatCheckpointSummary(ctx.sessionId);
      return { success: true, message: summary || '**No checkpoints.** Use `/checkpoint create <label>` to create one.' };
    }

    if (sub === 'create') {
      const label = parts.slice(1).join(' ') || `checkpoint-${Date.now()}`;
      const todoProgress = getTodoProgress(ctx.sessionId);

      // Get git state if available
      let branch: string | undefined;
      let commitHash: string | undefined;
      try {
        const ws = getActiveWorkspace();
        if (ws) {
          const git = simpleGit(ws);
          const status = await git.status();
          branch = status.current || undefined;
          const log = await git.log({ maxCount: 1 });
          commitHash = log.latest?.hash;
        }
      } catch { /* optional */ }

      const cp = createCheckpoint(ctx.sessionId, label, {
        branch,
        commitHash,
        todoProgress: { done: todoProgress.done, total: todoProgress.total },
        toolCallCount: 0,
        loopIteration: 0,
        notes: label,
      });
      return { success: true, message: `**Checkpoint created:** ${cp.label} (${cp.id})` };
    }

    if (sub === 'clear') {
      clearCheckpoints(ctx.sessionId);
      return { success: true, message: '**Cleared** all checkpoints.' };
    }

    return { success: false, message: 'Unknown subcommand. Use: list, create <label>, clear' };
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SPRINT 27: CHANGELOG COMMAND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'changelog',
  description: 'Generate and write a CHANGELOG.md entry from session activity.',
  category: 'workflow',
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    const ws = requireWorkspace(ctx);
    const db = getDatabase();

    // Gather recent tool calls from session activity
    const activity = db.getActivity(ctx.sessionId).slice(0, 100);
    const toolCalls = activity
      .filter(a => a.action === 'tool_call')
      .map(a => ({
        name: a.title?.replace('Tool call: ', '') || '',
        input: typeof a.metadata === 'object' ? a.metadata : {},
        result: a.description || '',
      }));

    const version = args.trim() || undefined;
    const entry = buildChangelogEntry(ctx.sessionId, toolCalls, version);
    const markdown = formatChangelogMarkdown(entry);

    if (entry.sections.added.length + entry.sections.changed.length + entry.sections.fixed.length + entry.sections.removed.length === 0) {
      return { success: true, message: '**No changes detected** in this session. Write some files first, then run `/changelog`.' };
    }

    const path = writeChangelog(ws, entry);
    return {
      success: true,
      message: `**CHANGELOG updated:** \`${path}\`\n\n${markdown}`,
      data: { entry, path },
    };
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SPRINT 27: ENHANCED /verify-last WITH DSL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'verify',
  description: 'Run deterministic assertions. Usage: /verify <assertions...> (one per line). See /verify help for syntax.',
  category: 'workflow',
  safe: true,
  async execute(args: string, ctx: WorkspaceContext): Promise<CommandResult> {
    if (!args.trim() || args.trim().toLowerCase() === 'help') {
      return {
        success: true,
        message: [
          '## /verify — Deterministic Assertion DSL',
          '',
          '**Assertion types:**',
          '- `FILE_EXISTS <path>`',
          '- `FILE_CONTAINS <path> <regex>`',
          '- `FILE_NOT_CONTAINS <path> <regex>`',
          '- `FILE_LINE_COUNT <path> <op> <n>` (op: >, <, >=, <=, ==)',
          '- `COMMAND_SUCCEEDS <command>`',
          '- `COMMAND_OUTPUT <command> | <regex>`',
          '- `GIT_BRANCH_IS <branch>`',
          '- `GIT_CLEAN`',
          '- `GIT_COMMITTED <message_regex>`',
          '',
          '**Example:**',
          '```',
          '/verify FILE_EXISTS src/main/mcp/index.ts',
          'FILE_CONTAINS package.json "@modelcontextprotocol"',
          'COMMAND_SUCCEEDS npx tsc --noEmit',
          '```',
        ].join('\n'),
      };
    }

    const ws = requireWorkspace(ctx);
    const report = await runAssertions(args.trim(), ws);
    const markdown = formatVerifyReport(report);

    return {
      success: true,
      message: markdown,
      data: { verifyReport: report },
    };
  },
});

register({
  name: 'verify-history',
  description: 'Show recent /verify report history.',
  category: 'workflow',
  safe: true,
  async execute(_args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    const reports = getPersistedReports();
    if (reports.length === 0) {
      return { success: true, message: '**No verification history.** Run `/verify` with assertions first.' };
    }

    const lines = reports.map((r, i) =>
      `${i + 1}. **${(r.score * 100).toFixed(0)}%** (${r.passed}/${r.total}) — ${r.timestamp}`
    );
    return { success: true, message: `**Verification History (${reports.length}):**\n${lines.join('\n')}` };
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SPRINT 27: SOURCE-VERIFIED RESEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register({
  name: 'fetch-source',
  description: 'Fetch exact source code from a GitHub URL. Usage: /fetch-source <github-url>',
  category: 'workflow',
  safe: true,
  async execute(args: string, _ctx: WorkspaceContext): Promise<CommandResult> {
    const url = args.trim();
    if (!url) {
      return { success: false, message: 'Usage: `/fetch-source <github-url>`\n\nExample: `/fetch-source https://github.com/owner/repo/blob/main/src/index.ts#L10-L20`' };
    }

    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      return { success: false, message: 'Not a recognized GitHub URL format.' };
    }

    const snippet = await fetchGitHubSource(url);
    if (!snippet) {
      return { success: false, message: 'Failed to fetch source from GitHub.' };
    }

    const formatted = formatSourceSnippets([snippet]);
    return { success: true, message: formatted, data: { snippet } };
  },
});
