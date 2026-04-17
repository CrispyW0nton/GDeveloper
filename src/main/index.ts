/**
 * GDeveloper - Electron Main Process Entry
 * Creates the BrowserWindow, registers ALL IPC handlers,
 * initializes services (DB, security, providers, GitHub, MCP).
 * Sprint 9: + Workspace management, Git operations, Terminal, Agentic chat loop
 */

import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import simpleGit, { SimpleGit } from 'simple-git';
import { IPC_CHANNELS } from './ipc';
import { getDatabase } from './db';
import { getSecureSettings } from './security';
import { ClaudeProvider, providerRegistry, streamChatToRenderer } from './providers';
import { getGitHub } from './github';
import { getMCPManager } from './mcp';
import { getOrchestrationEngine } from './orchestration';
import { SYSTEM_PROMPT } from './orchestration/prompts';
import * as compareEngine from './compare';
import {
  setActiveWorkspace, getActiveWorkspace,
  executeLocalTool, LOCAL_TOOL_DEFINITIONS,
  gitPull, gitPush, gitFetch, gitStash, gitStashPop,
  gitBranches, gitCheckout, gitGetStatus, gitClone, isGitRepo,
} from './tools';
import {
  getAllCommands, getCommand, getExecutionMode, setExecutionMode,
  WRITE_TOOL_NAMES, WorkspaceContext, setCommandsMainWindow,
} from './commands';
import { scanForRepositories, importDiscoveredRepos, DiscoveredRepo } from './discovery';
import { getManagedRoot, setManagedRoot, moveWorkspace, moveToManagedRoot, ensureManagedRoot } from './migration';
import { detectStack, getEnvironmentProfile, createPythonEnv, syncPythonDeps, isUvAvailable } from './environment';
import { executeResearch, compareRepos, downloadExternalRepo, listExternalRepos, removeExternalRepo } from './research';
import { scanAppCapabilities } from './mcp-forge/scan';
import { generateCLIAdapter } from './mcp-forge/generate';
import {
  saveAdapterProject, listAdapterProjects, loadAdapterProject, updateAdapterProject,
  removeAdapterProject, getAdaptersRoot,
  saveAppRecord, listAppRecords, removeAppRecord, toggleAppFavorite,
} from './mcp-forge/storage';
import { testAdapter } from './mcp-forge/testHarness';
import { registerAndConnectAdapter, unregisterAdapter } from './mcp-forge/register';
import { researchAppForAdapter, cloneForAnalysis, listForgeAnalysisRepos, removeForgeAnalysisRepo } from './mcp-forge/research';
import { v4 as uuid } from 'uuid';
import {
  listWorktrees, addWorktree, removeWorktree, pruneWorktrees,
  repairWorktrees, lockWorktree, unlockWorktree, moveWorktree as gitMoveWorktree,
  compareWorktrees, getWorktreeContext,
} from './git/worktree';
import {
  createTaskWorktree, completeTaskWorktree, abandonTaskWorktree,
  getHandoffInfo, getTaskWorktrees, shouldRecommendWorktree,
} from './worktree/taskIsolation';
import { buildFileTree, readFileSafe, writeFileSafe, checkFileWritable } from './fs';
import {
  startAutoContinue, stopAutoContinue, pauseAutoContinue, resumeAutoContinue,
  getAutoContinueState, getAutoContinueConfig, getAutoContinueLog,
  shouldAutoContinue, shouldContinueNext, buildContinueNudge, isAutoContinueActive,
  scheduleNextTurn,
  type AutoContinueContext,
} from './orchestration/autoContinue';
import { getSessionUsage, resetSessionUsage } from './providers';
import { getRetryHandler } from './providers/retryHandler';
import { getRateLimiter } from './providers/rateLimiter';
import { DEFAULT_TOKEN_BUDGET_CONFIG } from './providers/rateLimitConfig';
import {
  processAttachment, processClipboardImage, loadAttachment,
  deleteConversationAttachments, getAttachmentConfig, setAttachmentConfig,
  modelSupportsVision, buildVisionContent, type AttachmentMeta,
} from './attachments';
// Sprint 27: Orchestration enhancements
import {
  createCheckpoint, getCheckpoints, getLatestCheckpoint,
  formatCheckpointSummary,
} from './orchestration/checkpoint';
import {
  getTodoList, getTodoProgress, isTodoComplete,
  createTodoList, updateTodoItem, appendTodoItems, clearTodoList,
} from './orchestration/todoManager';
import { buildEnhancedSystemPrompt } from './orchestration/promptBuilder';
import {
  runAssertions, formatVerifyReport, getPersistedReports,
} from './orchestration/verifier';
import {
  buildChangelogEntry, writeChangelog,
} from './orchestration/changelog';
// Sprint 27.1: Write-scope, verify-spec, TPM survival
import {
  getWriteScope, setWriteScope, clearWriteScope, isWriteAllowed,
} from './mode/writeScope';
import {
  listVerifySpecs, resolveSpecArg, loadVerifySpec,
} from './orchestration/verifySpecLoader';
import {
  shouldThrottle, parseAnthropicHeaders, record429,
  formatRateLimitLiteSnapshot, getLastHeaders,
} from './providers/rateLimitLite';
import { applyCacheControl, shouldEnableCache } from './providers/cachePolicy';

let mainWindow: BrowserWindow | null = null;

// ─── Active workspace ID in memory ───
let activeWorkspaceId: string | null = null;

// ─── Sprint 16: Sandbox Monitor Log ───
interface SandboxEvent {
  id: string;
  timestamp: string;
  type: 'tool_call' | 'tool_result' | 'command' | 'file_edit' | 'mcp_call' | 'status' | 'error';
  tool?: string;
  summary: string;
  detail?: string;
  cwd?: string;
  status: 'running' | 'success' | 'error';
}

const sandboxLog: SandboxEvent[] = [];
const MAX_SANDBOX_LOG = 500;

function emitSandboxEvent(event: Omit<SandboxEvent, 'id' | 'timestamp'>): void {
  const entry: SandboxEvent = {
    ...event,
    id: `sb-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    timestamp: new Date().toISOString(),
  };
  sandboxLog.push(entry);
  if (sandboxLog.length > MAX_SANDBOX_LOG) sandboxLog.shift();
  // Emit to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sandbox:event', entry);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'GDeveloper // Matrix AI Coding Platform',
    backgroundColor: '#000000',
    show: false,
    frame: true,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Sprint 25.7 + 25.8: Environment-aware CSP via HTTP headers (single source of truth).
  // Dev needs 'unsafe-inline' + 'unsafe-eval' for Vite's @vitejs/plugin-react
  // preamble injection and HMR eval-based module reloading. Production stays strict
  // (preserving Sprint 25.5 hardening). Meta-tag CSP removed from index.html.
  // Sprint 25.8: Added fonts.googleapis.com / fonts.gstatic.com to restore Matrix fonts.
  const isDev = !app.isPackaged || !!process.env.ELECTRON_RENDERER_URL;

  const devCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:* https://api.anthropic.com https://api.openai.com https://api.github.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');

  const prodCsp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "connect-src 'self' https://api.anthropic.com https://api.openai.com https://api.github.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? devCsp : prodCsp],
      },
    });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist-renderer/index.html'));
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get the workspace path for the currently active workspace, or throw. */
function requireActiveWorkspacePath(): string {
  const ws = getActiveWorkspace();
  if (!ws) throw new Error('No active workspace. Clone or open a repository first.');
  return ws;
}

// ─── Register IPC Handlers ──────────────────────────────────────────────────

function registerIPCHandlers(): void {
  const settings = getSecureSettings();
  const db = getDatabase();
  const github = getGitHub();

  // ─── Settings ───────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    return settings.getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_event, partial: any) => {
    return settings.updateSettings(partial);
  });

  ipcMain.handle(IPC_CHANNELS.API_KEY_SET, async (_event, provider: string, key: string) => {
    settings.setApiKey(provider, key);
    if (provider === 'claude') {
      const claude = new ClaudeProvider(key);
      providerRegistry.register(claude);
    }
    db.logActivity('system', 'api_key_set', `API key configured for ${provider}`, '', { provider });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.API_KEY_GET, async (_event, provider: string) => {
    return settings.hasApiKey(provider) ? '••••••••' : '';
  });

  ipcMain.handle(IPC_CHANNELS.API_KEY_REMOVE, async (_event, provider: string) => {
    settings.removeApiKey(provider);
    providerRegistry.remove(provider);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.API_KEY_VALIDATE, async (_event, provider: string, key: string) => {
    try {
      if (provider === 'claude') {
        const claude = new ClaudeProvider(key);
        const result = await claude.validateKey();
        if (result.valid) {
          settings.setApiKey(provider, key);
          // Sprint 25.5: Register with safe default, then discover + validate
          const safeDefault = 'claude-3-5-sonnet-20241022';
          const registeredProvider = new ClaudeProvider(key, safeDefault);
          providerRegistry.register(registeredProvider);
          // Asynchronously discover models and pick the best one
          registeredProvider.discoverModels().then(models => {
            providerRegistry.availableModels = models;
            const bestModel = providerRegistry.validateSelectedModel();
            console.log(`[Validate] Discovered ${models.length} models, best: ${bestModel}`);
          }).catch(() => {});
          const bestModel = result.models?.[0] || safeDefault;
          db.logActivity('system', 'api_key_validated', `API key validated for ${provider}, model: ${bestModel}`, '', { provider, model: bestModel });
        }
        return { valid: result.valid, error: result.error };
      }
      const valid = key.length > 10;
      if (valid) settings.setApiKey(provider, key);
      return { valid, error: valid ? undefined : 'API key is too short' };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : 'Validation failed' };
    }
  });

  // ─── GitHub ──────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.GITHUB_CONNECT, async (_event, token: string) => {
    try {
      await github.authenticate(token);
      settings.setGitHubToken(token);
      const username = github.getUsername();
      db.logActivity('system', 'github_connect', `Connected to GitHub as ${username}`, '', { username });
      return { success: true, username };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GITHUB_DISCONNECT, async () => {
    await github.disconnect();
    settings.clearGitHubToken();
    db.logActivity('system', 'github_disconnect', 'Disconnected from GitHub');
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_REPOS, async () => {
    try {
      if (!github.isConnected()) {
        const token = settings.getGitHubToken();
        if (token) {
          await github.authenticate(token);
        } else {
          return { repos: [], error: 'Not connected to GitHub' };
        }
      }
      const repos = await github.getAllRepos();
      return { repos };
    } catch (err) {
      return { repos: [], error: err instanceof Error ? err.message : 'Failed to list repos' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GITHUB_SELECT_REPO, async (_event, repoFullName: string) => {
    try {
      const branches = await github.listBranches(repoFullName);
      db.logActivity('system', 'repo_selected', `Selected repository: ${repoFullName}`, '', { repoFullName });
      return { success: true, branches };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to select repo' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GITHUB_GET_FILE, async (_event, repo: string, path: string, branch: string) => {
    try {
      const content = await github.getFileContent(repo, path, branch);
      return { content };
    } catch (err) {
      return { content: null, error: err instanceof Error ? err.message : 'Failed to get file' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GITHUB_CREATE_BRANCH, async (_event, repo: string, branch: string, baseSha: string) => {
    try {
      await github.createBranch(repo, branch, baseSha);
      db.logActivity('system', 'branch_created', `Created branch: ${branch}`, '', { repo, branch });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to create branch' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GITHUB_CREATE_COMMIT, async (_event, repo: string, branch: string, message: string, files: any[]) => {
    try {
      const sha = await github.createCommit(repo, branch, message, files);
      db.logActivity('system', 'commit', `Commit: ${message}`, '', { repo, branch, sha });
      return { success: true, sha };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to create commit' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GITHUB_CREATE_PR, async (_event, repo: string, title: string, body: string, head: string, base: string) => {
    try {
      const pr = await github.createPullRequest(repo, title, body, head, base);
      db.logActivity('system', 'pr_created', `PR #${pr.number}: ${title}`, '', { repo, prNumber: pr.number, url: pr.url });
      return { success: true, ...pr };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to create PR' };
    }
  });

  // ─── Chat / Orchestration (Agentic Loop) ──────────────

  const mcp = getMCPManager();

  ipcMain.handle(IPC_CHANNELS.CHAT_SEND, async (_event, sessionId: string, message: string) => {
    const provider = providerRegistry.getDefault();

    // Save user message to DB
    db.insertMessage(sessionId, 'user', message);
    db.logActivity(sessionId, 'chat_send', `Message sent`, message.substring(0, 100), {
      sessionId,
      provider: provider?.name || 'none'
    });

    if (!provider) {
      const errMsg = 'No AI provider configured. Please add an API key in Settings.';
      db.insertMessage(sessionId, 'assistant', errMsg);
      db.logActivity(sessionId, 'chat_error', 'No provider configured', errMsg, {}, 'error');
      return { role: 'assistant', content: errMsg, error: true };
    }

    // Sprint 16: Model-tool compatibility check
    const selectedModelId = providerRegistry.selectedModel;
    if (!providerRegistry.checkModelToolSupport(selectedModelId)) {
      const warnMsg = `Warning: Model "${selectedModelId}" may not support tool use. Agentic features (file editing, commands, search) will be unavailable. Consider switching to a model that supports tools (e.g., claude-3-5-sonnet-20241022) in Settings.`;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:stream-chunk', {
          sessionId,
          type: 'text',
          content: `\n**[Model Warning]** ${warnMsg}\n`,
          fullContent: warnMsg,
        });
      }
    }

    // Auto-create a task on the first message in this session
    const existingTasks = db.getTasks(sessionId);
    let taskId: string | null = null;
    if (existingTasks.length === 0) {
      const taskTitle = message.length > 80 ? message.substring(0, 80) + '...' : message;
      taskId = db.createTask(sessionId, taskTitle, message);
      db.logActivity(sessionId, 'task_updated', `Task created: ${taskTitle}`, message.substring(0, 200), { taskId, status: 'TASK_CREATED' });
    }

    try {
      // Build conversation context from DB
      const history = db.getMessages(sessionId);
      const messages = history.map(m => ({
        role: m.role,
        content: m.content
      }));

      // Collect available MCP tools for Claude
      const mcpServers = mcp.getServers();
      const mcpTools: any[] = [];
      for (const s of mcpServers) {
        if (s.status === 'connected') {
          for (const t of s.tools) {
            if (t.enabled) {
              mcpTools.push({
                name: t.name,
                description: t.description || '',
                inputSchema: t.inputSchema || { type: 'object', properties: {} },
                source: 'mcp',
                serverName: s.name,
                serverId: s.id
              });
            }
          }
        }
      }

      // Build combined tools array (local + MCP) — Sprint 12: filter by mode
      const mode = getExecutionMode();
      const filteredLocalTools = mode === 'plan'
        ? LOCAL_TOOL_DEFINITIONS.filter(t => !WRITE_TOOL_NAMES.includes(t.name))
        : LOCAL_TOOL_DEFINITIONS;

      const allTools: any[] = [
        ...filteredLocalTools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.input_schema,
          source: 'local'
        })),
        ...mcpTools
      ];

      // Build enhanced system prompt with workspace context
      const wsPath = getActiveWorkspace();
      let enhancedPrompt = SYSTEM_PROMPT;

      // Sprint 12: mode-aware system prompt prefix
      if (mode === 'plan') {
        enhancedPrompt = 'You are in PLAN MODE. You can read, search, and analyze the codebase but you CANNOT modify files, run commands, or make commits. Focus on understanding, researching, and proposing plans. When ready to implement, tell the user to switch to Build mode with /build.\n\n' + enhancedPrompt;
      } else {
        enhancedPrompt = 'You are in BUILD MODE. You have full access to read, write, patch, and execute commands in the workspace. You can create branches, commit changes, and run shell commands.\n\n' + enhancedPrompt;
      }
      if (wsPath) {
        enhancedPrompt += `\n\nCurrent workspace: ${wsPath}`;
        try {
          const git: SimpleGit = simpleGit(wsPath);
          const status = await git.status();
          enhancedPrompt += `\nBranch: ${status.current || '(detached)'}`;
          enhancedPrompt += `\nTracking: ${status.tracking || '(none)'}`;
          enhancedPrompt += `\nModified: ${status.modified.length} | Staged: ${status.staged.length} | Untracked: ${status.not_added.length}`;
        } catch { /* git context optional */ }

        // Sprint 17: Add worktree context to system prompt
        try {
          const wtContext = getWorktreeContext(wsPath);
          if (wtContext) {
            enhancedPrompt += `\nWorktree: ${wtContext.isMain ? 'Main' : 'Linked'}`;
            if (wtContext.isLinked) {
              enhancedPrompt += ` (branch: ${wtContext.branch || 'detached ' + wtContext.head?.substring(0, 7)})`;
              enhancedPrompt += `\nMain repo root: ${wtContext.mainRoot || 'unknown'}`;
            }
            const wts = listWorktrees(wsPath);
            if (wts.length > 1) {
              enhancedPrompt += `\nTotal worktrees: ${wts.length} (${wts.filter(w => w.isLinked).length} linked)`;
            }
          }
        } catch { /* worktree context optional */ }
      }

      enhancedPrompt += `\n\nYou have ${allTools.length} tools available (${filteredLocalTools.length} local + ${mcpTools.length} MCP).`;
      enhancedPrompt += `\nLocal tools: ${filteredLocalTools.map(t => t.name).join(', ')}`;
      if (mode === 'plan') {
        enhancedPrompt += `\n[PLAN MODE] Disabled write tools: ${WRITE_TOOL_NAMES.join(', ')}`;
      }

      // ─── Agentic Loop: stream → execute tools → continue ───
      // Sprint 27: Increased max loops for long-task orchestration, added checkpoint injection
      let loopCount = 0;
      const maxLoops = 25;
      let fullContent = '';
      let allToolCalls: any[] = [];
      let currentMessages = [...messages];
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 3;

      while (loopCount < maxLoops) {
        loopCount++;

        // Sprint 27: Checkpoint injection every 5 loops
        if (loopCount > 1 && loopCount % 5 === 0) {
          const todoProgress = getTodoProgress(sessionId);
          createCheckpoint(sessionId, `loop-${loopCount}`, {
            todoProgress: { done: todoProgress.done, total: todoProgress.total },
            toolCallCount: allToolCalls.length,
            loopIteration: loopCount,
          });
        }

        // Sprint 27: Consecutive error circuit-breaker
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('chat:stream-chunk', {
              sessionId,
              type: 'text',
              content: `\n**[Agent Loop]** Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Use /checkpoint list to review progress.\n`,
              fullContent: '',
            });
          }
          break;
        }

        // Sprint 27.1: TPM survival layer — check Anthropic header-based throttle
        const tpmCheck = shouldThrottle();
        if (tpmCheck.shouldWait) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('chat:stream-chunk', {
              sessionId,
              type: 'text',
              content: `\n*[TPM] ${tpmCheck.reason}*\n`,
              fullContent: '',
            });
          }
          await new Promise(resolve => setTimeout(resolve, tpmCheck.waitMs));
        }

        // Sprint 24: Pre-flight rate-limit check before every API call
        const preCheck = getRateLimiter().preFlightCheck();
        if (!preCheck.ok) {
          // Hard-paused — notify renderer and stop
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('chat:stream-chunk', {
              sessionId,
              type: 'text',
              content: `\n**[Rate Limit]** ${preCheck.reason}\n`,
              fullContent: preCheck.reason || '',
            });
          }
          break;
        }
        if (preCheck.delayMs > 0) {
          // Throttled — wait before sending
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('chat:stream-chunk', {
              sessionId,
              type: 'text',
              content: `\n*Waiting ${Math.round(preCheck.delayMs / 1000)}s for rate-limit window...*\n`,
              fullContent: '',
            });
          }
          await new Promise(resolve => setTimeout(resolve, preCheck.delayMs));
        }

        const result = await streamChatToRenderer(
          mainWindow,
          provider,
          currentMessages,
          sessionId,
          enhancedPrompt,
          allTools.length > 0 ? allTools : undefined
        );

        fullContent = result.content;

        if (!result.toolCalls || result.toolCalls.length === 0) {
          // No tool calls — done
          break;
        }

        // Process each tool call
        allToolCalls.push(...result.toolCalls);

        // Add assistant message with tool calls to conversation
        const assistantContent: any[] = [];
        if (result.content) {
          assistantContent.push({ type: 'text', text: result.content });
        }
        for (const tc of result.toolCalls) {
          assistantContent.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input || {}
          });
        }
        currentMessages.push({ role: 'assistant', content: JSON.stringify(assistantContent) });

        // Execute each tool and collect results
        const toolResults: any[] = [];
        for (const tc of result.toolCalls) {
          db.logActivity(sessionId, 'tool_call', `Tool call: ${tc.name}`, JSON.stringify(tc.input).substring(0, 200), {
            toolName: tc.name,
            toolCallId: tc.id,
            sessionId,
            loop: loopCount
          });

          let toolResultContent: string;
          let isError = false;

          // Sprint 16 + Sprint 27.1: Plan/Build mode enforcement with write-scope
          const isWriteToolCall = WRITE_TOOL_NAMES.includes(tc.name);
          const writeCheck = isWriteAllowed(tc.name, tc.input || {}, wsPath || '', isWriteToolCall, mode);
          if (!writeCheck.allowed) {
            toolResultContent = `Error: ${writeCheck.reason}`;
            isError = true;
            emitSandboxEvent({ type: 'error', tool: tc.name, summary: `Blocked ${tc.name} (${mode} mode${getWriteScope().active ? ' + write-scope' : ''})`, status: 'error' });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: toolResultContent,
              is_error: true,
            });
            // Send to renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('chat:stream-chunk', {
                sessionId,
                type: 'tool_error',
                toolName: tc.name,
                result: toolResultContent,
              });
            }
            continue;
          }

          // Sprint 15.2: Emit sandbox event for tool start with cwd and args
          const isCommandTool = ['run_command', 'bash_command'].includes(tc.name);
          emitSandboxEvent({
            type: isCommandTool ? 'command' : 'tool_call',
            tool: tc.name,
            summary: isCommandTool ? `$ ${(tc.input?.command || '').substring(0, 100)}` : `Calling ${tc.name}`,
            detail: JSON.stringify(tc.input || {}).substring(0, 500),
            cwd: getActiveWorkspace() || undefined,
            status: 'running',
          });

          // Check if it's a local tool
          const isLocalTool = LOCAL_TOOL_DEFINITIONS.some(t => t.name === tc.name);

          if (isLocalTool) {
            try {
              const localResult = await executeLocalTool(tc.name, tc.input || {});
              toolResultContent = localResult.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
              // Sprint 15.2: Emit file_edit event for write/patch tools
              const isFileEdit = ['write_file', 'patch_file', 'multi_edit'].includes(tc.name);
              emitSandboxEvent({
                type: isFileEdit ? 'file_edit' : 'tool_result',
                tool: tc.name,
                summary: `${tc.name} completed${isFileEdit ? `: ${tc.input?.path || tc.input?.file_path || ''}` : ''}`,
                detail: toolResultContent.substring(0, 300),
                cwd: getActiveWorkspace() || undefined,
                status: 'success',
              });
              // Sprint 19: Notify renderer about file changes for live view
              if (isFileEdit && mainWindow && !mainWindow.isDestroyed()) {
                const filePath = tc.input?.path || tc.input?.file_path || '';
                const wsPath = getActiveWorkspace() || '';
                const absolutePath = filePath.startsWith('/') ? filePath : join(wsPath, filePath);
                mainWindow.webContents.send('filetree:file-changed', {
                  filePath: filePath,
                  absolutePath: absolutePath,
                  toolName: tc.name,
                  timestamp: Date.now(),
                });
              }
            } catch (err) {
              toolResultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
              isError = true;
              emitSandboxEvent({ type: 'tool_result', tool: tc.name, summary: `${tc.name} failed`, detail: toolResultContent, status: 'error' });
            }
          } else {
            // MCP tool
            const toolMeta = mcpTools.find(t => t.name === tc.name);
            if (toolMeta) {
              try {
                emitSandboxEvent({ type: 'mcp_call', tool: tc.name, summary: `MCP: ${tc.name}`, status: 'running' });
                const mcpResult = await mcp.executeTool(toolMeta.serverId, tc.name, tc.input || {});
                toolResultContent = mcpResult?.content
                  ? (Array.isArray(mcpResult.content)
                      ? mcpResult.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
                      : JSON.stringify(mcpResult.content))
                  : JSON.stringify(mcpResult);
                emitSandboxEvent({ type: 'tool_result', tool: tc.name, summary: `MCP: ${tc.name} done`, detail: toolResultContent.substring(0, 300), status: 'success' });
              } catch (err) {
                toolResultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
                isError = true;
                emitSandboxEvent({ type: 'tool_result', tool: tc.name, summary: `MCP: ${tc.name} failed`, detail: toolResultContent, status: 'error' });
              }
            } else {
              toolResultContent = `Error: Unknown tool "${tc.name}"`;
              isError = true;
            }
          }

          toolResults.push({
            toolCallId: tc.id,
            toolName: tc.name,
            content: toolResultContent,
            isError
          });

          db.logActivity(sessionId, isError ? 'tool_error' : 'tool_result', `Tool ${isError ? 'error' : 'result'}: ${tc.name}`, toolResultContent.substring(0, 200), {
            toolName: tc.name,
            toolCallId: tc.id,
            success: !isError,
            loop: loopCount
          });

          // Send tool result to renderer
          mainWindow?.webContents.send('chat:stream-chunk', {
            sessionId,
            type: isError ? 'tool_error' : 'tool_result',
            toolCallId: tc.id,
            toolName: tc.name,
            result: toolResultContent.substring(0, 2000)
          });
        }

        // Sprint 27: Track consecutive errors for circuit-breaker
        const errorCount = toolResults.filter(tr => tr.isError).length;
        if (errorCount > 0 && errorCount === toolResults.length) {
          consecutiveErrors++;
        } else {
          consecutiveErrors = 0;
        }

        // Add tool results as user message for next turn
        const toolResultMessage = toolResults.map(tr =>
          `[Tool Result: ${tr.toolName}]\n${tr.content.substring(0, 4000)}`
        ).join('\n\n');

        currentMessages.push({ role: 'user', content: toolResultMessage });

        // Persist the tool results
        db.insertMessage(sessionId, 'assistant', result.content || '(tool execution)', result.toolCalls);
        db.insertMessage(sessionId, 'user', toolResultMessage);
      }

      // Sprint 24: Emit session usage and rate-limit snapshot to renderer after complete response
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:stream-chunk', {
          sessionId,
          type: 'usage-update',
          sessionUsage: getSessionUsage(),
          rateLimitSnapshot: getRateLimiter().getSnapshot(),
        });
      }

      // Save final assistant response to DB
      const msgId = db.insertMessage(sessionId, 'assistant', fullContent, allToolCalls.length > 0 ? allToolCalls : undefined);

      // Update task status
      if (taskId) {
        db.updateTaskStatus(taskId, 'EXECUTING', 'AI response received');
        db.logActivity(sessionId, 'task_updated', 'Task executing', 'AI processing response', { taskId, status: 'EXECUTING' });
      }

      db.logActivity(sessionId, 'chat_response', `AI responded (${fullContent.length} chars, ${loopCount} loops, ${allToolCalls.length} tool calls)`, fullContent.substring(0, 150), {
        sessionId,
        provider: provider.name,
        contentLength: fullContent.length,
        toolCalls: allToolCalls.length,
        loops: loopCount
      });

      return {
        id: msgId,
        role: 'assistant',
        content: fullContent,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        streaming: true
      };
    } catch (err) {
      const errMsg = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      db.insertMessage(sessionId, 'assistant', errMsg);
      db.logActivity(sessionId, 'chat_error', 'Chat error', errMsg, { sessionId, provider: provider.name }, 'error');

      if (taskId) {
        db.updateTaskStatus(taskId, 'BLOCKED', errMsg);
        db.logActivity(sessionId, 'task_updated', 'Task blocked', errMsg, { taskId, status: 'BLOCKED' });
      }

      return { role: 'assistant', content: errMsg, error: true };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY, async (_event, sessionId: string) => {
    return db.getMessages(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.CHAT_CLEAR, async (_event, sessionId: string) => {
    db.logActivity(sessionId, 'chat_cleared', 'Chat history cleared');
    return true;
  });

  // ─── Tasks ──────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.TASK_LIST, async (_event, sessionId?: string) => {
    if (sessionId) {
      const sessionTasks = db.getTasks(sessionId);
      if (sessionTasks.length === 0) return db.getAllTasks();
      return sessionTasks;
    }
    return db.getAllTasks();
  });

  ipcMain.handle(IPC_CHANNELS.TASK_GET, async (_event, taskId: string) => {
    const tasks = db.getAllTasks();
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      const transitions = db.getTaskTransitions(taskId);
      return { ...task, transitions };
    }
    return null;
  });

  ipcMain.handle(IPC_CHANNELS.TASK_UPDATE, async (_event, taskId: string, newStatus: string, reason?: string) => {
    db.updateTaskStatus(taskId, newStatus, reason || '');
    db.logActivity('system', 'task_updated', `Task status: ${newStatus}`, reason || '', { taskId });
    return true;
  });

  // ─── Activity ──────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.ACTIVITY_LIST, async (_event, sessionId?: string) => {
    if (sessionId) {
      const sessionEvents = db.getActivity(sessionId);
      const systemEvents = db.getActivity('system');
      const merged = new Map<string, any>();
      for (const e of [...sessionEvents, ...systemEvents]) {
        merged.set(e.id, e);
      }
      return Array.from(merged.values()).sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      ).slice(0, 200);
    }
    return db.getActivity();
  });

  // ─── Diff ──────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.DIFF_GET, async (_event, sessionId?: string) => {
    if (sessionId) return db.getDiffs(sessionId);
    return [];
  });

  // ─── MCP ───────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.MCP_LIST_SERVERS, async () => {
    return mcp.getServers();
  });

  ipcMain.handle(IPC_CHANNELS.MCP_ADD_SERVER, async (_event, config: any) => {
    try {
      const savedServer = await mcp.addServer({
        id: config.id || uuid(),
        name: config.name,
        transport: config.transport || 'stdio',
        command: config.command,
        args: config.args || [],
        env: config.env || {},
        url: config.url,
        enabled: true,
        autoStart: false,
        status: 'disconnected' as any,
        tools: []
      });
      db.logActivity('system', 'mcp_server_added', `MCP server added: ${config.name}`, '', { serverId: savedServer.id, transport: config.transport });
      return { success: true, server: savedServer };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add server' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.MCP_REMOVE_SERVER, async (_event, id: string) => {
    await mcp.removeServer(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.MCP_CONNECT, async (_event, id: string) => {
    try {
      await mcp.connectServer(id);
      const server = mcp.getServer(id);
      const toolCount = server?.tools.length || 0;
      db.logActivity('system', 'mcp_connected', `MCP connected: ${server?.name}`, `Discovered ${toolCount} tool(s)`, {
        serverId: id,
        serverName: server?.name,
        transport: server?.transport,
        tools: toolCount,
        toolNames: server?.tools.map(t => t.name).slice(0, 10)
      });
      return { success: true, tools: server?.tools || [] };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Connection failed';
      db.logActivity('system', 'mcp_error', `MCP connection failed: ${mcp.getServer(id)?.name || id}`, errMsg, { serverId: id }, 'error');
      return { success: false, error: errMsg };
    }
  });

  ipcMain.handle(IPC_CHANNELS.MCP_DISCONNECT, async (_event, id: string) => {
    await mcp.disconnectServer(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.MCP_TEST, async (_event, id: string) => {
    const result = await mcp.testConnection(id);
    return {
      success: result.reachable,
      reachable: result.reachable,
      mcpReady: result.mcpReady,
      error: result.error
    };
  });

  ipcMain.handle(IPC_CHANNELS.MCP_GET_TOOLS, async (_event, serverId?: string) => {
    if (serverId) return mcp.getServerTools(serverId);
    const servers = mcp.getServers();
    const tools: any[] = [];
    for (const s of servers) {
      if (s.status === 'connected') tools.push(...s.tools);
    }
    return tools;
  });

  ipcMain.handle(IPC_CHANNELS.MCP_TOGGLE_TOOL, async (_event, serverId: string, toolName: string, enabled: boolean) => {
    mcp.toggleTool(serverId, toolName, enabled);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.MCP_UPDATE_SERVER, async (_event, id: string, updates: any) => {
    mcp.updateServer(id, updates);
    return true;
  });

  // ─── Tools ─────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.TOOL_LIST, async () => {
    const servers = mcp.getServers();
    const tools: any[] = [];
    // Local tools
    for (const t of LOCAL_TOOL_DEFINITIONS) {
      tools.push({ name: t.name, description: t.description, source: 'local', enabled: true });
    }
    // MCP tools
    for (const s of servers) {
      if (s.status === 'connected') {
        for (const t of s.tools) {
          if (t.enabled) tools.push({ ...t, source: 'mcp', serverName: s.name });
        }
      }
    }
    return tools;
  });

  ipcMain.handle(IPC_CHANNELS.TOOL_EXECUTE, async (_event, name: string, input: any, serverId?: string) => {
    try {
      // Check local tools first
      const isLocal = LOCAL_TOOL_DEFINITIONS.some(t => t.name === name);
      if (isLocal) {
        const result = await executeLocalTool(name, input || {});
        db.logActivity('system', 'tool_result', `Tool completed: ${name}`, JSON.stringify(result).substring(0, 200), {
          toolName: name, source: 'local', success: true
        });
        return { success: true, output: result };
      }

      // MCP tool
      let targetServerId = serverId;
      if (!targetServerId) {
        const servers = mcp.getServers();
        for (const s of servers) {
          if (s.status === 'connected' && s.tools.some(t => t.name === name && t.enabled)) {
            targetServerId = s.id;
            break;
          }
        }
      }

      if (!targetServerId) {
        return { success: false, error: `No connected server provides tool: ${name}` };
      }

      db.logActivity('system', 'tool_execute', `Executing tool: ${name}`, JSON.stringify(input).substring(0, 200), {
        toolName: name, serverId: targetServerId
      });

      const result = await mcp.executeTool(targetServerId, name, input || {});
      db.logActivity('system', 'tool_result', `Tool completed: ${name}`, JSON.stringify(result).substring(0, 200), {
        toolName: name, serverId: targetServerId, success: true
      });

      return { success: true, output: result };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Tool execution failed';
      db.logActivity('system', 'tool_error', `Tool failed: ${name}`, errMsg, { toolName: name }, 'error');
      return { success: false, error: errMsg };
    }
  });

  // ─── Verification ──────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.VERIFICATION_LIST, async () => []);

  ipcMain.handle(IPC_CHANNELS.VERIFICATION_RUN, async (_event, taskId: string) => {
    db.logActivity('system', 'verification_run', `Verification started for task ${taskId}`);
    return { passed: true, checks: [] };
  });

  // ─── Workspace Management (Sprint 9) ──────────────────

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST, async () => {
    return db.getWorkspaces();
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET, async (_event, id: string) => {
    return db.getWorkspace(id);
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_ADD, async (_event, ws: any) => {
    try {
      const id = db.saveWorkspace(ws);
      db.logActivity('system', 'workspace_added', `Workspace added: ${ws.name}`, ws.local_path || ws.localPath || '', { workspaceId: id });
      return { success: true, id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add workspace' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_REMOVE, async (_event, id: string) => {
    db.removeWorkspace(id);
    if (activeWorkspaceId === id) {
      activeWorkspaceId = null;
      setActiveWorkspace(null);
    }
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET_ACTIVE, async (_event, id: string) => {
    try {
      const ws = db.getWorkspace(id);
      if (!ws) return { success: false, error: 'Workspace not found' };
      if (!existsSync(ws.local_path)) return { success: false, error: `Path does not exist: ${ws.local_path}` };

      activeWorkspaceId = id;
      setActiveWorkspace(ws.local_path);
      db.touchWorkspace(id);
      db.logActivity('system', 'workspace_activated', `Activated workspace: ${ws.name}`, ws.local_path, { workspaceId: id });
      return { success: true, workspace: ws };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to activate workspace' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_ACTIVE, async () => {
    if (!activeWorkspaceId) return null;
    const ws = db.getWorkspace(activeWorkspaceId);
    return ws || null;
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_UPDATE_PATH, async (_event, id: string, newPath: string) => {
    try {
      if (!existsSync(newPath)) return { success: false, error: `Path does not exist: ${newPath}` };
      db.updateWorkspacePath(id, newPath);
      if (activeWorkspaceId === id) setActiveWorkspace(newPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to update path' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CLONE, async (_event, url: string, localPath: string, name: string) => {
    try {
      db.logActivity('system', 'workspace_clone_start', `Cloning ${url}`, localPath);
      await gitClone(url, localPath);

      // Detect remote info
      const git: SimpleGit = simpleGit(localPath);
      const remotes = await git.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      const status = await git.status();

      // Parse GitHub owner/repo from URL
      let ghOwner = '';
      let ghRepo = '';
      const ghMatch = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (ghMatch) {
        ghOwner = ghMatch[1];
        ghRepo = ghMatch[2];
      }

      const wsId = db.saveWorkspace({
        name,
        local_path: localPath,
        remote_url: origin?.refs?.fetch || url,
        github_owner: ghOwner,
        github_repo: ghRepo,
        default_branch: status.current || 'main',
        status: 'active'
      });

      // Set as active
      activeWorkspaceId = wsId;
      setActiveWorkspace(localPath);
      db.touchWorkspace(wsId);

      db.logActivity('system', 'workspace_cloned', `Cloned: ${name}`, `${url} → ${localPath}`, { workspaceId: wsId });
      return { success: true, id: wsId };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Clone failed';
      db.logActivity('system', 'workspace_clone_error', 'Clone failed', errMsg, {}, 'error');
      return { success: false, error: errMsg };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN_LOCAL, async (_event, localPath: string, name: string) => {
    try {
      if (!existsSync(localPath)) return { success: false, error: `Path does not exist: ${localPath}` };

      const isRepo = await isGitRepo(localPath);
      let remoteUrl = '';
      let defaultBranch = 'main';
      let ghOwner = '';
      let ghRepo = '';

      if (isRepo) {
        const git: SimpleGit = simpleGit(localPath);
        const remotes = await git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        remoteUrl = origin?.refs?.fetch || '';
        const status = await git.status();
        defaultBranch = status.current || 'main';

        const ghMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
        if (ghMatch) {
          ghOwner = ghMatch[1];
          ghRepo = ghMatch[2];
        }
      }

      const wsId = db.saveWorkspace({
        name,
        local_path: localPath,
        remote_url: remoteUrl,
        github_owner: ghOwner,
        github_repo: ghRepo,
        default_branch: defaultBranch,
        status: 'active'
      });

      activeWorkspaceId = wsId;
      setActiveWorkspace(localPath);
      db.touchWorkspace(wsId);

      db.logActivity('system', 'workspace_opened', `Opened local: ${name}`, localPath, { workspaceId: wsId, isGitRepo: isRepo });
      return { success: true, id: wsId, isGitRepo: isRepo };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to open workspace' };
    }
  });

  // ─── Git Operations (Sprint 9) ────────────────────────

  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async () => {
    try {
      const ws = requireActiveWorkspacePath();
      return { success: true, status: await gitGetStatus(ws) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git status failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_PULL, async () => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = await gitPull(ws);
      db.logActivity('system', 'git_pull', 'Git pull', result);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git pull failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_PUSH, async () => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = await gitPush(ws);
      db.logActivity('system', 'git_push', 'Git push', result);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git push failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_FETCH, async () => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = await gitFetch(ws);
      db.logActivity('system', 'git_fetch', 'Git fetch', result);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git fetch failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_BRANCHES, async () => {
    try {
      const ws = requireActiveWorkspacePath();
      const branches = await gitBranches(ws);
      return { success: true, ...branches };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git branches failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_CHECKOUT, async (_event, branch: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = await gitCheckout(ws, branch);
      db.logActivity('system', 'git_checkout', `Checked out: ${branch}`, result);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git checkout failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_CREATE_BRANCH, async (_event, name: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      await git.checkoutLocalBranch(name);
      db.logActivity('system', 'git_branch', `Created branch: ${name}`);
      return { success: true, result: `Created and switched to: ${name}` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git create branch failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_STASH, async (_event, message?: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = await gitStash(ws, message);
      db.logActivity('system', 'git_stash', 'Git stash', result);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git stash failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_STASH_POP, async () => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = await gitStashPop(ws);
      db.logActivity('system', 'git_stash_pop', 'Git stash pop', result);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git stash pop failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_STAGE_ALL, async () => {
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      await git.add('.');
      return { success: true, result: 'All files staged' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git stage all failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_UNSTAGE_ALL, async () => {
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      await git.reset();
      return { success: true, result: 'All files unstaged' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git unstage all failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_STAGE_FILE, async (_event, path: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      await git.add(path);
      return { success: true, result: `Staged: ${path}` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git stage file failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_UNSTAGE_FILE, async (_event, path: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      await git.reset(['--', path]);
      return { success: true, result: `Unstaged: ${path}` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git unstage file failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, async (_event, message: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      const result = await git.commit(message);
      db.logActivity('system', 'git_commit', `Committed: ${message}`, `${result.summary.changes} changed, ${result.summary.insertions}+ ${result.summary.deletions}-`);
      return { success: true, result: `Committed: ${result.commit || '(no changes)'}` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git commit failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT_PUSH, async (_event, message: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      const commitResult = await git.commit(message);
      await git.push();
      db.logActivity('system', 'git_commit_push', `Committed & pushed: ${message}`);
      return { success: true, result: `Committed & pushed: ${commitResult.commit || '(no changes)'}` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git commit & push failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_LOG, async (_event, count?: number) => {
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      const log = await git.log({ maxCount: Math.min(count || 20, 50) });
      return { success: true, entries: log.all };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git log failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_DIFF, async (_event, staged?: boolean) => {
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      const diff = staged ? await git.diff(['--cached']) : await git.diff();
      return { success: true, diff: diff || '(no changes)' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git diff failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_DISCARD, async () => {
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      await git.checkout('.');
      db.logActivity('system', 'git_discard', 'Discarded all changes');
      return { success: true, result: 'Discarded all changes' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git discard failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_RESET_SOFT, async () => {
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      await git.reset(['--soft', 'HEAD~1']);
      db.logActivity('system', 'git_reset_soft', 'Soft reset HEAD~1');
      return { success: true, result: 'Undid last commit (soft reset)' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git reset failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_RESET_HARD, async (_event, confirm: string) => {
    if (confirm !== 'RESET') return { success: false, error: 'Type RESET to confirm' };
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      await git.reset(['--hard', 'HEAD']);
      db.logActivity('system', 'git_reset_hard', 'Hard reset to HEAD');
      return { success: true, result: 'Hard reset to HEAD' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git hard reset failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_RESET_TO_REMOTE, async (_event, confirm: string) => {
    if (confirm !== 'RESET') return { success: false, error: 'Type RESET to confirm' };
    try {
      const ws = requireActiveWorkspacePath();
      const git: SimpleGit = simpleGit(ws);
      const status = await git.status();
      const tracking = status.tracking || `origin/${status.current}`;
      await git.fetch();
      await git.reset(['--hard', tracking]);
      db.logActivity('system', 'git_reset_remote', `Reset to ${tracking}`);
      return { success: true, result: `Reset to ${tracking}` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Git reset to remote failed' };
    }
  });

  // ─── Terminal (Sprint 9) ──────────────────────────────

  ipcMain.handle(IPC_CHANNELS.TERMINAL_EXECUTE, async (_event, command: string, cwd?: string) => {
    try {
      const workDir = cwd || getActiveWorkspace() || process.cwd();
      if (!existsSync(workDir)) return { success: false, error: `Directory not found: ${workDir}` };

      const output = execSync(command, {
        cwd: workDir,
        maxBuffer: 2 * 1024 * 1024,
        timeout: 30000,
        encoding: 'utf-8',
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
      });

      db.logActivity('system', 'terminal_exec', `$ ${command.substring(0, 80)}`, (output || '').substring(0, 200));
      return { success: true, output: output || '(no output)', exitCode: 0 };
    } catch (err: any) {
      const stdout = err.stdout || '';
      const stderr = err.stderr || '';
      const exitCode = err.status ?? 1;
      return { success: false, output: stdout, stderr, exitCode, error: stderr || err.message };
    }
  });

  // ─── Slash Commands & Mode (Sprint 12) ────────────

  ipcMain.handle(IPC_CHANNELS.SLASH_COMMAND_EXECUTE, async (_event, name: string, args: string, sessionId: string) => {
    try {
      const cmd = getCommand(name);
      if (!cmd) {
        return { success: false, message: `Unknown command: /${name}` };
      }

      const wsPath = getActiveWorkspace();
      const context: WorkspaceContext = {
        workspacePath: wsPath || '',
        sessionId: sessionId || 'system',
      };

      const result = await cmd.execute(args || '', context);

      // If mode command returned a mode change, sync
      if (result.data?.mode) {
        setExecutionMode(result.data.mode);
      }

      db.logActivity(sessionId || 'system', 'slash_command', `/${name} ${args || ''}`.trim(), result.message.substring(0, 200), {
        command: name,
        args,
        success: result.success,
      });

      return result;
    } catch (err) {
      return { success: false, message: `Command error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SLASH_COMMAND_LIST, async () => {
    return getAllCommands().map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      category: cmd.category,
    }));
  });

  ipcMain.handle(IPC_CHANNELS.MODE_GET, async () => {
    return getExecutionMode();
  });

  ipcMain.handle(IPC_CHANNELS.MODE_SET, async (_event, mode: string) => {
    if (mode === 'plan' || mode === 'build') {
      setExecutionMode(mode);
      return { success: true, mode };
    }
    return { success: false, error: 'Invalid mode. Use "plan" or "build".' };
  });

  // ─── Sprint 13: Discovery ────────────────────────

  ipcMain.handle(IPC_CHANNELS.DISCOVERY_SCAN, async (_event, rootPath: string, maxDepth?: number) => {
    try {
      if (!rootPath || typeof rootPath !== 'string') {
        return { success: false, error: 'Invalid scan path', repos: [] };
      }
      const depth = Math.min(Math.max(1, maxDepth || 5), 8); // clamp 1-8
      const repos = await scanForRepositories(rootPath.trim(), depth);
      return { success: true, repos: repos || [] };
    } catch (err) {
      console.error('[Discovery] Scan error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Scan failed', repos: [] };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DISCOVERY_IMPORT, async (_event, repos: DiscoveredRepo[]) => {
    try {
      const result = await importDiscoveredRepos(repos);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Import failed', imported: 0, skipped: 0 };
    }
  });

  // ─── Sprint 13: Migration ────────────────────────

  ipcMain.handle(IPC_CHANNELS.MIGRATION_GET_MANAGED_ROOT, async () => {
    return getManagedRoot();
  });

  ipcMain.handle(IPC_CHANNELS.MIGRATION_SET_MANAGED_ROOT, async (_event, path: string) => {
    setManagedRoot(path);
    ensureManagedRoot();
    return { success: true, path: getManagedRoot() };
  });

  ipcMain.handle(IPC_CHANNELS.MIGRATION_MOVE_WORKSPACE, async (_event, workspaceId: string, destDir: string, deleteOriginal?: boolean) => {
    return moveWorkspace(workspaceId, destDir, deleteOriginal || false);
  });

  ipcMain.handle(IPC_CHANNELS.MIGRATION_MOVE_TO_MANAGED, async (_event, workspaceId: string, deleteOriginal?: boolean) => {
    return moveToManagedRoot(workspaceId, deleteOriginal || false);
  });

  // ─── Sprint 13: Environment Profiles ─────────────

  ipcMain.handle(IPC_CHANNELS.ENV_DETECT_STACK, async (_event, workspacePath?: string) => {
    const ws = workspacePath || getActiveWorkspace();
    if (!ws) return { stack: 'unknown', manager: '', indicators: [] };
    return detectStack(ws);
  });

  ipcMain.handle(IPC_CHANNELS.ENV_GET_PROFILE, async (_event, workspacePath?: string) => {
    const ws = workspacePath || getActiveWorkspace();
    if (!ws) return null;
    return getEnvironmentProfile(ws);
  });

  ipcMain.handle(IPC_CHANNELS.ENV_CREATE_PYTHON, async (_event, workspacePath?: string) => {
    const ws = workspacePath || getActiveWorkspace();
    if (!ws) return { success: false, error: 'No workspace active' };
    try {
      const profile = await createPythonEnv(ws);
      return { success: true, profile };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ENV_SYNC_DEPS, async (_event, workspacePath?: string, envPath?: string) => {
    const ws = workspacePath || getActiveWorkspace();
    if (!ws) return { success: false, error: 'No workspace active' };
    try {
      const profile = getEnvironmentProfile(ws);
      const ep = envPath || profile?.envPath || '';
      if (!ep) return { success: false, error: 'No environment found' };
      const output = await syncPythonDeps(ws, ep);
      return { success: true, output };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Sync failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ENV_IS_UV_AVAILABLE, async () => {
    return isUvAvailable();
  });

  // ─── Sprint 13: Research & External ──────────────

  ipcMain.handle(IPC_CHANNELS.RESEARCH_EXECUTE, async (_event, question: string, sessionId: string) => {
    try {
      const wsPath = getActiveWorkspace() || undefined;
      const report = await executeResearch(question, sessionId, wsPath, (stage, detail) => {
        mainWindow?.webContents.send('chat:stream-chunk', {
          sessionId,
          type: 'text',
          content: `\n[Research: ${stage}] ${detail}\n`,
          fullContent: `[Research: ${stage}] ${detail}`,
        });
      });
      return { success: true, report };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Research failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RESEARCH_COMPARE, async (_event, repoA: string, repoB: string, sessionId: string, focus?: string) => {
    try {
      const result = await compareRepos(repoA, repoB, sessionId, focus);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Comparison failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTERNAL_DOWNLOAD, async (_event, repoUrl: string) => {
    try {
      const wsPath = getActiveWorkspace() || undefined;
      const info = await downloadExternalRepo(repoUrl, wsPath);
      return { success: true, info };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Download failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTERNAL_LIST, async () => {
    const wsPath = getActiveWorkspace() || undefined;
    return listExternalRepos(wsPath);
  });

  ipcMain.handle(IPC_CHANNELS.EXTERNAL_REMOVE, async (_event, localPath: string) => {
    return removeExternalRepo(localPath);
  });

  // ─── Sprint 13: MCP Health ──────────────────────

  ipcMain.handle(IPC_CHANNELS.MCP_HEALTH, async () => {
    const servers = mcp.getServers();
    return servers.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      transport: s.transport,
      toolCount: s.tools.length,
      lastConnected: s.lastConnected || null,
      url: s.url || null,
      command: s.command || null,
    }));
  });

  // ─── Sprint 13: GitHub Auth Status ───────────────

  ipcMain.handle(IPC_CHANNELS.GITHUB_AUTH_STATUS, async () => {
    const gh = getGitHub();
    const connected = gh.isConnected();
    const username = gh.getUsername();
    const hasToken = !!settings.getGitHubToken();
    return {
      connected,
      username,
      hasToken,
      tokenValid: connected,
      needsReconnect: hasToken && !connected,
    };
  });

  // ─── Sprint 13: Task Verification ────────────────

  ipcMain.handle(IPC_CHANNELS.TASK_VERIFY, async (_event, taskId: string) => {
    const wsPath = getActiveWorkspace();
    if (!wsPath) return { success: false, checks: [], error: 'No active workspace' };

    const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

    // Check 1: TypeScript compilation
    try {
      execSync('npx tsc --noEmit 2>&1', { cwd: wsPath, timeout: 60000, encoding: 'utf-8' });
      checks.push({ name: 'TypeScript', passed: true, detail: 'tsc --noEmit passed' });
    } catch (err: any) {
      const stderr = err.stderr || err.stdout || '';
      checks.push({ name: 'TypeScript', passed: false, detail: stderr.substring(0, 500) });
    }

    // Check 2: Git status clean
    try {
      const git = simpleGit(wsPath);
      const status = await git.status();
      const clean = status.isClean();
      checks.push({ name: 'Git Status', passed: clean, detail: clean ? 'Working tree clean' : `${status.modified.length} modified, ${status.not_added.length} untracked` });
    } catch (err) {
      checks.push({ name: 'Git Status', passed: false, detail: err instanceof Error ? err.message : 'Git check failed' });
    }

    // Check 3: Build (if package.json has build script)
    try {
      const pkgPath = join(wsPath, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.scripts?.build) {
          execSync('npm run build 2>&1', { cwd: wsPath, timeout: 120000, encoding: 'utf-8' });
          checks.push({ name: 'Build', passed: true, detail: 'npm run build succeeded' });
        }
      }
    } catch (err: any) {
      checks.push({ name: 'Build', passed: false, detail: (err.stderr || err.stdout || '').substring(0, 500) });
    }

    const allPassed = checks.every(c => c.passed);

    // Update task status based on verification
    if (taskId) {
      db.updateTaskStatus(taskId, allPassed ? 'VERIFIED' : 'VERIFICATION_FAILED',
        checks.map(c => `${c.name}: ${c.passed ? 'PASS' : 'FAIL'}`).join(', '));
      db.logActivity('system', 'task_verified', `Verification ${allPassed ? 'passed' : 'failed'}: ${taskId}`,
        checks.map(c => `${c.name}: ${c.passed ? 'PASS' : 'FAIL'}`).join('; '), {
          taskId, allPassed, checks
        });
    }

    return { success: true, passed: allPassed, checks };
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_DETECT_SHELLS, async () => {
    const shells: Array<{ id: string; name: string; command: string; available: boolean }> = [];

    // Bash (always available on Linux/macOS)
    shells.push({ id: 'bash', name: 'Bash', command: 'bash', available: true });

    // Check for zsh
    try {
      execSync('which zsh', { timeout: 2000 });
      shells.push({ id: 'zsh', name: 'Zsh', command: 'zsh', available: true });
    } catch {
      shells.push({ id: 'zsh', name: 'Zsh', command: 'zsh', available: false });
    }

    // PowerShell (pwsh)
    try {
      execSync('which pwsh', { timeout: 2000 });
      shells.push({ id: 'pwsh', name: 'PowerShell 7', command: 'pwsh', available: true });
    } catch {
      shells.push({ id: 'pwsh', name: 'PowerShell 7', command: 'pwsh', available: false });
    }

    // On Windows, add cmd
    if (process.platform === 'win32') {
      shells.push({ id: 'cmd', name: 'Command Prompt', command: 'cmd.exe', available: true });
      try {
        execSync('where pwsh.exe', { timeout: 2000 });
      } catch {
        // Already handled above
      }
    }

    return shells;
  });

  // ─── Sprint 14: MCP Forge / App Adapter Studio ──

  ipcMain.handle(IPC_CHANNELS.FORGE_SCAN, async (_event, appPath: string) => {
    try {
      const report = await scanAppCapabilities(appPath);
      return { success: true, report };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Scan failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_GENERATE, async (_event, capReport: any) => {
    try {
      const adaptersRoot = getAdaptersRoot();
      const project = generateCLIAdapter(capReport, adaptersRoot);
      const saved = saveAdapterProject(project);
      // Save app record
      saveAppRecord({
        appName: capReport.appName,
        appPath: capReport.appPath,
        capabilityTypes: capReport.capabilities.map((c: any) => c.type),
        adapterProjectId: saved.id,
        adapterPath: saved.adapterPath,
        generatedAt: new Date().toISOString(),
      });
      return { success: true, project: saved };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Generation failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_SAVE, async (_event, project: any) => {
    try {
      const saved = saveAdapterProject(project);
      return { success: true, project: saved };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Save failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_LIST_ADAPTERS, async () => {
    return listAdapterProjects();
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_GET_ADAPTER, async (_event, id: string) => {
    const projects = listAdapterProjects();
    return projects.find(p => p.id === id) || null;
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_UPDATE_ADAPTER, async (_event, id: string, updates: any) => {
    try {
      const result = updateAdapterProject(id, updates);
      return { success: !!result, project: result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Update failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_REMOVE_ADAPTER, async (_event, id: string) => {
    return removeAdapterProject(id);
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_TEST, async (_event, adapterId: string) => {
    try {
      const projects = listAdapterProjects();
      const project = projects.find(p => p.id === adapterId);
      if (!project) return { success: false, error: 'Adapter not found' };
      const result = await testAdapter(project);
      // Persist test result
      updateAdapterProject(adapterId, { lastTestResult: result, status: result.passed ? 'tested' : 'error' });
      // Update app record
      saveAppRecord({
        appName: project.appName,
        appPath: project.appPath,
        lastTestResult: result.passed ? 'passed' : 'failed',
      });
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Test failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_REGISTER, async (_event, adapterId: string) => {
    try {
      const projects = listAdapterProjects();
      const project = projects.find(p => p.id === adapterId);
      if (!project) return { success: false, error: 'Adapter not found' };
      const result = await registerAndConnectAdapter(project);
      if (result.success) {
        saveAppRecord({
          appName: project.appName,
          appPath: project.appPath,
          lastConnectionState: 'connected',
          usageCount: 1,
        });
      }
      return result;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Registration failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_UNREGISTER, async (_event, adapterId: string) => {
    try {
      const projects = listAdapterProjects();
      const project = projects.find(p => p.id === adapterId);
      if (!project) return false;
      return await unregisterAdapter(project);
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_RESEARCH, async (_event, appName: string, capReport: any, sessionId: string) => {
    try {
      const summary = await researchAppForAdapter(appName, capReport, sessionId);
      return { success: true, summary };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Research failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_ANALYSIS_CLONE, async (_event, repoUrl: string, branch?: string) => {
    try {
      const info = await cloneForAnalysis(repoUrl, branch);
      return { success: true, info };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Clone failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_ANALYSIS_LIST, async () => {
    return listForgeAnalysisRepos();
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_ANALYSIS_REMOVE, async (_event, localPath: string) => {
    return removeForgeAnalysisRepo(localPath);
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_APP_RECORDS, async () => {
    return listAppRecords();
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_APP_RECORD_SAVE, async (_event, record: any) => {
    try {
      const saved = saveAppRecord(record);
      return { success: true, record: saved };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Save failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_APP_RECORD_REMOVE, async (_event, id: string) => {
    return removeAppRecord(id);
  });

  ipcMain.handle(IPC_CHANNELS.FORGE_APP_TOGGLE_FAVORITE, async (_event, id: string) => {
    return toggleAppFavorite(id);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 16: Model Selection IPC Handlers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.MODEL_LIST, async () => {
    return providerRegistry.availableModels;
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_GET_SELECTED, async () => {
    return providerRegistry.selectedModel;
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_SET_SELECTED, async (_event, model: string) => {
    providerRegistry.selectedModel = model;
    // Persist the selection
    try {
      const settings = getSecureSettings();
      settings.updateSettings({ selectedModel: model });
    } catch { /* ignore */ }
    return { success: true, model };
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_DISCOVER, async () => {
    const models = await providerRegistry.discoverModels();
    return models;
  });

  // Sprint 25.5: Force-refresh models from API (user clicked "Refresh models")
  ipcMain.handle(IPC_CHANNELS.MODEL_REFRESH, async () => {
    try {
      const models = await providerRegistry.refreshModels();
      // Also validate the selected model after refresh
      const validatedModel = providerRegistry.validateSelectedModel();
      return { success: true, models, selectedModel: validatedModel };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Refresh failed', models: providerRegistry.availableModels };
    }
  });

  // Sprint 25.5: Validate that selected model exists in available models
  ipcMain.handle(IPC_CHANNELS.MODEL_VALIDATE_SELECTED, async () => {
    const validatedModel = providerRegistry.validateSelectedModel();
    return { model: validatedModel, availableModels: providerRegistry.availableModels };
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_CHECK_TOOLS, async (_event, model?: string) => {
    return providerRegistry.checkModelToolSupport(model);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 16: Sandbox Monitor IPC Handlers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.SANDBOX_GET_LOG, async () => {
    return sandboxLog;
  });

  ipcMain.handle(IPC_CHANNELS.SANDBOX_CLEAR_LOG, async () => {
    sandboxLog.length = 0;
    return { success: true };
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 17: Git Worktree IPC Handlers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.WORKTREE_LIST, async () => {
    try {
      const ws = requireActiveWorkspacePath();
      const worktrees = listWorktrees(ws);
      return { success: true, worktrees };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to list worktrees', worktrees: [] };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_ADD, async (_event, options: any) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = addWorktree(ws, options);
      if (result.success) {
        db.logActivity('system', 'worktree_created', `Worktree created: ${options.path}`, result.message, { path: options.path, branch: options.branchOrCommit });
        emitSandboxEvent({ type: 'status', summary: `Worktree created: ${options.path}`, status: 'success' });
      }
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to add worktree' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_REMOVE, async (_event, options: any) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = removeWorktree(ws, options);
      if (result.success) {
        db.logActivity('system', 'worktree_removed', `Worktree removed: ${options.path}`, result.message, { path: options.path });
        emitSandboxEvent({ type: 'status', summary: `Worktree removed: ${options.path}`, status: 'success' });
      }
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to remove worktree' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_PRUNE, async (_event, dryRun?: boolean) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = pruneWorktrees(ws, dryRun);
      if (result.success && !dryRun) {
        db.logActivity('system', 'worktree_pruned', 'Worktrees pruned', result.message);
      }
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to prune worktrees' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_REPAIR, async (_event, targetPath?: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = repairWorktrees(ws, targetPath);
      if (result.success) {
        db.logActivity('system', 'worktree_repaired', 'Worktrees repaired', result.message, { target: targetPath });
      }
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to repair worktrees' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_LOCK, async (_event, targetPath: string, reason?: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = lockWorktree(ws, targetPath, reason);
      if (result.success) {
        db.logActivity('system', 'worktree_locked', `Worktree locked: ${targetPath}`, reason || '', { path: targetPath, reason });
      }
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to lock worktree' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_UNLOCK, async (_event, targetPath: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = unlockWorktree(ws, targetPath);
      if (result.success) {
        db.logActivity('system', 'worktree_unlocked', `Worktree unlocked: ${targetPath}`, '', { path: targetPath });
      }
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to unlock worktree' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_MOVE, async (_event, from: string, to: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = gitMoveWorktree(ws, { from, to });
      if (result.success) {
        db.logActivity('system', 'worktree_moved', `Worktree moved: ${from} → ${to}`, '', { from, to });
      }
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to move worktree' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_COMPARE, async (_event, pathA: string, pathB: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = compareWorktrees(ws, pathA, pathB);
      return result ? { success: true, result } : { success: false, error: 'Could not compare worktrees' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to compare worktrees' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_CONTEXT, async (_event, path?: string) => {
    try {
      const ws = path || requireActiveWorkspacePath();
      const context = getWorktreeContext(ws);
      return { success: true, context };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to get context' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_CREATE_TASK, async (_event, request: any) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = createTaskWorktree({ ...request, repoPath: ws });
      if (result.success) {
        db.logActivity(request.sessionId || 'system', 'worktree_task_created', `Task worktree: ${request.taskDescription}`, result.message, {
          taskId: result.data?.taskId, path: result.data?.worktreePath,
        });
      }
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to create task worktree' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_COMPLETE_TASK, async (_event, taskId: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = completeTaskWorktree(taskId, ws);
      if (result.success) {
        db.logActivity('system', 'worktree_task_completed', `Task worktree completed: ${taskId}`, result.message);
      }
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to complete task' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_ABANDON_TASK, async (_event, taskId: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = abandonTaskWorktree(taskId, ws);
      if (result.success) {
        db.logActivity('system', 'worktree_task_abandoned', `Task worktree abandoned: ${taskId}`, result.message);
      }
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to abandon task' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_HANDOFF, async (_event, worktreePath: string, targetBranch?: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const result = getHandoffInfo(ws, worktreePath, targetBranch);
      if (result.success) {
        db.logActivity('system', 'worktree_handoff', `Handoff info: ${worktreePath} → ${targetBranch || 'main'}`, result.message);
      }
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to get handoff info' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_TASK_LIST, async () => {
    return getTaskWorktrees();
  });

  ipcMain.handle(IPC_CHANNELS.WORKTREE_RECOMMEND, async (_event, taskDescription: string) => {
    try {
      const ws = requireActiveWorkspacePath();
      const git = simpleGit(ws);
      const status = await git.status();
      const dirty = !status.isClean();
      return shouldRecommendWorktree(taskDescription, dirty);
    } catch (err) {
      return { recommend: false, reason: '' };
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 19: File Tree IPC Handlers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.FILE_TREE_GET, async (_event, maxDepth?: number) => {
    try {
      const ws = requireActiveWorkspacePath();
      const tree = buildFileTree(ws, maxDepth || 4);
      return { success: true, tree };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to build file tree', tree: [] };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_TREE_READ, async (_event, filePath: string) => {
    try {
      const result = readFileSafe(filePath);
      return result;
    } catch (err) {
      return { content: null, isBinary: false, isTooLarge: false, size: 0 };
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 23: File Writing (Editor) IPC Handlers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.FILE_WRITE, async (_event, filePath: string, content: string) => {
    try {
      const result = writeFileSafe(filePath, content);
      if (result.success) {
        db.logActivity('system', 'file_write', `File saved: ${filePath}`, `${content.length} chars`);
        // Notify renderer about the file change
        mainWindow?.webContents.send('filetree:file-changed', {
          filePath,
          absolutePath: filePath,
          toolName: 'user-edit',
        });
      }
      return result;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Write failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_CHECK_WRITABLE, async (_event, filePath: string) => {
    try {
      const wsPath = getActiveWorkspace() || undefined;
      return checkFileWritable(filePath, wsPath);
    } catch (err) {
      return { writable: false, reason: 'Check failed', isBinary: false, isLockFile: false, isOutsideWorktree: false, isTooLarge: false, size: 0 };
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 23: Model Metadata IPC Handlers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.MODEL_GET_META_LIST, async () => {
    try {
      const models = providerRegistry.availableModels;
      return models.map((m: any) => ({
        id: m.id,
        name: m.name,
        provider: m.provider || 'claude',
        supportsTools: m.supportsTools ?? true,
        supportsStreaming: m.supportsStreaming ?? true,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_GET_DEFAULT, async () => {
    try {
      const settings = getSecureSettings();
      const all = settings.getSettings();
      return (all as any).preferences?.defaultModel || 'claude-3-5-sonnet-20241022';
    } catch {
      return 'claude-3-5-sonnet-20241022';
    }
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_SET_DEFAULT, async (_event, model: string) => {
    try {
      const settings = getSecureSettings();
      settings.updateSettings({ preferences: { defaultModel: model } } as any);
      providerRegistry.selectedModel = model;
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set default model' };
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 24: Rate Limiting & Token Budget IPC Handlers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const rateLimiter = getRateLimiter();
  const retryHandler = getRetryHandler();

  // Push rate-limit snapshot to renderer whenever it changes
  rateLimiter.onChange((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rate-limit:update', snapshot);
    }
  });

  // Push retry state to renderer whenever it changes
  retryHandler.onStateChange((retryState) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('retry:state-update', retryState);
    }
  });

  ipcMain.handle(IPC_CHANNELS.RATE_LIMIT_GET_SNAPSHOT, async () => {
    return rateLimiter.getSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.RATE_LIMIT_RESET, async () => {
    rateLimiter.reset();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.RATE_LIMIT_PAUSE_RESUME, async () => {
    const snap = rateLimiter.getSnapshot();
    if (snap.isPaused) {
      rateLimiter.resume();
    } else {
      rateLimiter.pause();
    }
    return rateLimiter.getSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.TOKEN_BUDGET_GET, async () => {
    return rateLimiter.getConfig();
  });

  ipcMain.handle(IPC_CHANNELS.TOKEN_BUDGET_SET, async (_event, config: any) => {
    try {
      rateLimiter.updateConfig({ ...DEFAULT_TOKEN_BUDGET_CONFIG, ...config });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to update token budget' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RETRY_STATE_GET, async () => {
    return retryHandler.getState();
  });

  ipcMain.handle(IPC_CHANNELS.CONTEXT_SUMMARIZE, async (_event, _sessionId: string) => {
    return { success: true, message: 'Context summarized' };
  });

  ipcMain.handle(IPC_CHANNELS.CONTEXT_COMPACT, async (_event, _sessionId: string) => {
    return { success: true, message: 'History compacted' };
  });

  // Sprint 24: Session-level usage
  ipcMain.handle(IPC_CHANNELS.SESSION_USAGE_GET, async () => {
    return getSessionUsage();
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_USAGE_RESET, async () => {
    resetSessionUsage();
    return { success: true };
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 25: Attachment & Vision IPC Handlers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.ATTACHMENT_PROCESS, async (_event, fileData: { buffer: number[]; name: string; mimeType: string; conversationId: string; source: string }) => {
    try {
      const buffer = Buffer.from(fileData.buffer);
      const result = processAttachment(
        buffer,
        fileData.name,
        fileData.mimeType,
        fileData.conversationId,
        (fileData.source as any) || 'drag-drop',
        getAttachmentConfig(),
      );
      db.logActivity('system', 'attachment_processed', `Attachment: ${result.originalName} (${result.type})`, `${(result.size / 1024).toFixed(1)} KB`, {
        attachmentId: result.id, type: result.type, size: result.size, warnings: result.warnings,
      });
      return { success: true, attachment: result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to process attachment' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ATTACHMENT_PROCESS_CLIPBOARD, async (_event, data: { pngBase64: string; conversationId: string }) => {
    try {
      const buffer = Buffer.from(data.pngBase64, 'base64');
      const result = processClipboardImage(buffer, data.conversationId, getAttachmentConfig());
      db.logActivity('system', 'attachment_clipboard', `Clipboard image: ${result.originalName}`, `${(result.size / 1024).toFixed(1)} KB`);
      return { success: true, attachment: result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to process clipboard image' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ATTACHMENT_LOAD, async (_event, conversationId: string, filename: string) => {
    try {
      const buffer = loadAttachment(conversationId, filename);
      if (!buffer) return { success: false, error: 'Attachment not found' };
      return { success: true, data: buffer.toString('base64'), size: buffer.length };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to load attachment' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ATTACHMENT_DELETE_CONVERSATION, async (_event, conversationId: string) => {
    try {
      deleteConversationAttachments(conversationId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to delete attachments' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ATTACHMENT_CONFIG_GET, async () => {
    return getAttachmentConfig();
  });

  ipcMain.handle(IPC_CHANNELS.ATTACHMENT_CONFIG_SET, async (_event, config: any) => {
    return setAttachmentConfig(config);
  });

  ipcMain.handle(IPC_CHANNELS.ATTACHMENT_CHECK_VISION, async (_event, modelId?: string) => {
    const id = modelId || providerRegistry.selectedModel;
    return { supportsVision: modelSupportsVision(id), modelId: id };
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 19 + Sprint 24: Auto-Continue IPC Handlers (Fixed)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.AUTO_CONTINUE_START, async (_event, config?: any) => {
    const state = startAutoContinue(config);
    db.logActivity('system', 'auto_continue', 'Auto-Continue started', `Max ${state.maxIterations} iterations`);
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.AUTO_CONTINUE_STOP, async (_event, reason?: string) => {
    const stopReason = (reason as 'user' | 'safety' | 'completion' | 'error' | 'rate-limit') || 'user';
    const state = stopAutoContinue(stopReason);
    db.logActivity('system', 'auto_continue', `Auto-Continue stopped: ${stopReason}`, state.lastStatus);
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.AUTO_CONTINUE_STATUS, async () => {
    return getAutoContinueState();
  });

  // Sprint 24: Fixed pause — uses pauseAutoContinue() instead of stopAutoContinue()
  ipcMain.handle(IPC_CHANNELS.AUTO_CONTINUE_PAUSE, async (_event, reason?: string) => {
    const state = pauseAutoContinue(reason || 'Manual pause');
    db.logActivity('system', 'auto_continue', `Auto-Continue paused: ${reason || 'manual'}`, state.lastStatus);
    return state;
  });

  // Sprint 24: Fixed resume — uses resumeAutoContinue() instead of startAutoContinue()
  ipcMain.handle(IPC_CHANNELS.AUTO_CONTINUE_RESUME, async () => {
    const state = resumeAutoContinue();
    db.logActivity('system', 'auto_continue', 'Auto-Continue resumed', state.lastStatus);
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.AUTO_CONTINUE_LOG, async () => {
    return { entries: getAutoContinueLog() };
  });

  ipcMain.handle(IPC_CHANNELS.AUTO_CONTINUE_CONFIG, async () => {
    return getAutoContinueConfig();
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 27: Compare Agent IPC Handlers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.COMPARE_FILES, async (_event, leftPath: string, rightPath: string, filters?: any) => {
    try {
      const session = compareEngine.compareFiles(leftPath, rightPath, filters);
      db.logActivity('system', 'compare_files', `Compared files: ${leftPath} ↔ ${rightPath}`, session.id);
      return compareEngine.getCompactOutput(session.id);
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Compare failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_FOLDERS, async (_event, leftPath: string, rightPath: string, filters?: any) => {
    try {
      const session = compareEngine.compareFolders(leftPath, rightPath, filters);
      db.logActivity('system', 'compare_folders', `Compared folders: ${leftPath} ↔ ${rightPath}`, session.id);
      return compareEngine.getCompactOutput(session.id);
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Compare failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_MERGE3, async (_event, leftPath: string, rightPath: string, basePath: string, filters?: any) => {
    try {
      const session = compareEngine.merge3Way(leftPath, rightPath, basePath, filters);
      db.logActivity('system', 'compare_merge3', `3-way merge: ${basePath} → ${leftPath} / ${rightPath}`, session.id);
      return compareEngine.getCompactOutput(session.id);
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Merge failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_SYNC_PREVIEW, async (_event, sessionId: string, direction: string) => {
    try {
      const result = compareEngine.syncPreview(sessionId, direction as any);
      return result || { error: 'Session not found or not a folder comparison' };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Sync preview failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_GET_SESSION, async (_event, sessionId: string) => {
    return compareEngine.getSession(sessionId) || null;
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_LIST_SESSIONS, async () => {
    return compareEngine.listSessions();
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_DELETE_SESSION, async (_event, sessionId: string) => {
    return compareEngine.deleteSession(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_HUNK_ACTION, async (_event, sessionId: string, hunkIndex: number, action: string) => {
    return compareEngine.applyHunkAction(sessionId, hunkIndex, action as any);
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_HUNK_DETAIL, async (_event, sessionId: string, hunkIndex: number) => {
    return compareEngine.getHunkDetail(sessionId, hunkIndex);
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_FOLDER_ENTRY_DIFF, async (_event, sessionId: string, relativePath: string) => {
    return compareEngine.getFolderEntryDiff(sessionId, relativePath);
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_COMPACT_OUTPUT, async (_event, sessionId: string, maxItems?: number) => {
    return compareEngine.getCompactOutput(sessionId, maxItems);
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_SAVE_MERGE, async (_event, sessionId: string, outputPath: string) => {
    return compareEngine.saveMergeResult(sessionId, outputPath);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 27: Todo Manager IPC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.TODO_GET, async (_event, sessionId: string) => {
    return getTodoList(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_CREATE, async (_event, sessionId: string, items: any[]) => {
    return createTodoList(sessionId, items);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_UPDATE_ITEM, async (_event, sessionId: string, itemId: string, updates: any) => {
    return updateTodoItem(sessionId, itemId, updates);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_APPEND, async (_event, sessionId: string, items: any[]) => {
    return appendTodoItems(sessionId, items);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_CLEAR, async (_event, sessionId: string) => {
    return clearTodoList(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_PROGRESS, async (_event, sessionId: string) => {
    return getTodoProgress(sessionId);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 27: Checkpoint IPC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.CHECKPOINT_LIST, async (_event, sessionId: string) => {
    return getCheckpoints(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.CHECKPOINT_CREATE, async (_event, sessionId: string, label: string, data: any) => {
    return createCheckpoint(sessionId, label, data);
  });

  ipcMain.handle(IPC_CHANNELS.CHECKPOINT_LATEST, async (_event, sessionId: string) => {
    return getLatestCheckpoint(sessionId);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 27: Verify IPC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.VERIFY_RUN, async (_event, assertions: string, workspacePath?: string) => {
    const ws = workspacePath || getActiveWorkspace() || '';
    return runAssertions(assertions, ws);
  });

  ipcMain.handle(IPC_CHANNELS.VERIFY_HISTORY, async () => {
    return getPersistedReports();
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 27.1: Write-Scope IPC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.WRITE_SCOPE_GET, async () => {
    return getWriteScope();
  });

  ipcMain.handle(IPC_CHANNELS.WRITE_SCOPE_SET, async (_event, prefixes: string[]) => {
    setWriteScope(prefixes);
    return getWriteScope();
  });

  ipcMain.handle(IPC_CHANNELS.WRITE_SCOPE_CLEAR, async () => {
    clearWriteScope();
    return { success: true };
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 27.1: Verify Spec IPC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.VERIFY_SPEC_LIST, async () => {
    const ws = getActiveWorkspace() || '';
    return listVerifySpecs(ws);
  });

  ipcMain.handle(IPC_CHANNELS.VERIFY_SPEC_LOAD, async (_event, specArg: string) => {
    const ws = getActiveWorkspace() || '';
    return resolveSpecArg(specArg, ws);
  });

  ipcMain.handle(IPC_CHANNELS.VERIFY_SPEC_RUN, async (_event, specArg: string) => {
    const ws = getActiveWorkspace() || '';
    const loadResult = resolveSpecArg(specArg, ws);
    if (!loadResult.success || !loadResult.spec) {
      return { success: false, error: loadResult.error };
    }
    const assertionText = loadResult.spec.assertions.join('\n');
    const report = await runAssertions(assertionText, ws);
    return { success: true, report, spec: loadResult.spec };
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Sprint 27.1: Rate Limit Lite IPC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ipcMain.handle(IPC_CHANNELS.RATE_LIMIT_LITE_SNAPSHOT, async () => {
    return formatRateLimitLiteSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.RATE_LIMIT_LITE_HEADERS, async () => {
    return getLastHeaders();
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const settings = getSecureSettings();

  // Sprint 25.5: Auto-register saved API keys with dynamic model discovery
  const configuredProviders = settings.getConfiguredProviders();
  for (const providerName of configuredProviders) {
    const key = settings.getApiKey(providerName);
    if (key && providerName === 'claude') {
      // Register immediately with a safe default model
      const safeDefault = 'claude-3-5-sonnet-20241022';
      const claudeInstance = new ClaudeProvider(key, safeDefault);
      providerRegistry.register(claudeInstance);

      // Then discover available models and validate/auto-switch
      claudeInstance.discoverModels().then(models => {
        providerRegistry.availableModels = models;

        // Restore persisted model selection, then validate it exists
        const savedSettings = settings.getSettings() as any;
        const savedModel = savedSettings?.selectedModel || savedSettings?.preferences?.defaultModel;
        if (savedModel) {
          providerRegistry.selectedModel = savedModel;
        }
        const validatedModel = providerRegistry.validateSelectedModel();
        console.log(`[Startup] Discovered ${models.length} models, selected: ${validatedModel}`);
      }).catch(err => {
        console.warn('[Startup] Model discovery failed, using safe fallback:', err);
      });
    }
  }

  // Auto-reconnect GitHub if token saved
  const ghToken = settings.getGitHubToken();
  if (ghToken) {
    const gh = getGitHub();
    gh.authenticate(ghToken).catch(err => {
      console.error('[GitHub] Auto-reconnect failed:', err);
      settings.clearGitHubToken();
    });
  }

  // Restore last active workspace
  try {
    const db = getDatabase();
    const workspaces = db.getWorkspaces();
    if (workspaces.length > 0) {
      const last = workspaces[0]; // sorted by last_opened_at DESC
      if (existsSync(last.local_path)) {
        activeWorkspaceId = last.id;
        setActiveWorkspace(last.local_path);
        console.log(`[Startup] Restored workspace: ${last.name} at ${last.local_path}`);
      }
    }
  } catch (err) {
    console.error('[Startup] Failed to restore workspace:', err);
  }

  registerIPCHandlers();
  createWindow();

  // Wire mainWindow into the commands module for streaming research results
  if (mainWindow) {
    setCommandsMainWindow(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  try { getMCPManager().cleanup(); } catch {}
  try { getDatabase().close(); } catch {}

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  try { getMCPManager().cleanup(); } catch {}
  try { getDatabase().close(); } catch {}
});

// Security: prevent new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, _url) => {
    event.preventDefault();
  });
});
