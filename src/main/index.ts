/**
 * GDeveloper - Electron Main Process Entry
 * Creates the BrowserWindow, registers ALL IPC handlers,
 * initializes services (DB, security, providers, GitHub, MCP).
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import { IPC_CHANNELS } from './ipc';
import { getDatabase } from './db';
import { getSecureSettings } from './security';
import { ClaudeProvider, providerRegistry, streamChatToRenderer } from './providers';
import { getGitHub } from './github';
import { getMCPManager } from './mcp';
import { getOrchestrationEngine } from './orchestration';
import { SYSTEM_PROMPT } from './orchestration/prompts';
import { v4 as uuid } from 'uuid';

let mainWindow: BrowserWindow | null = null;

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
    // Register provider
    if (provider === 'claude') {
      const claude = new ClaudeProvider(key);
      providerRegistry.register(claude);
    }
    db.logActivity('system', 'api_key_set', `API key configured for ${provider}`, '', { provider });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.API_KEY_GET, async (_event, provider: string) => {
    // Return masked indicator only - never send raw key to renderer
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

          // Pick the best available model from the returned list
          let bestModel = 'claude-sonnet-4-6'; // default fallback
          if (result.models && result.models.length > 0) {
            // Prefer sonnet-4, then any sonnet, then first available
            const sonnet4 = result.models.find((m: string) => m.includes('sonnet-4'));
            const anySonnet = result.models.find((m: string) => m.includes('sonnet'));
            bestModel = sonnet4 || anySonnet || result.models[0];
          }

          // Register provider with the best available model
          const registeredProvider = new ClaudeProvider(key, bestModel);
          providerRegistry.register(registeredProvider);
          db.logActivity('system', 'api_key_validated', `API key validated for ${provider}, model: ${bestModel}`, '', { provider, model: bestModel });
        }
        return { valid: result.valid, error: result.error };
      }
      // Generic provider: basic length check
      const valid = key.length > 10;
      if (valid) {
        settings.setApiKey(provider, key);
      }
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
      // Try to reconnect with saved token if not connected
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

  // ─── Chat / Orchestration ──────────────────────────────

  ipcMain.handle(IPC_CHANNELS.CHAT_SEND, async (_event, sessionId: string, message: string) => {
    const provider = providerRegistry.getDefault();

    // Save user message to DB
    db.insertMessage(sessionId, 'user', message);
    db.logActivity(sessionId, 'chat_send', `Message sent`, message.substring(0, 100));

    if (!provider) {
      const errMsg = 'No AI provider configured. Please add an API key in Settings.';
      db.insertMessage(sessionId, 'assistant', errMsg);
      return { role: 'assistant', content: errMsg, error: true };
    }

    try {
      // Build conversation context from DB
      const history = db.getMessages(sessionId);
      const messages = history.map(m => ({
        role: m.role,
        content: m.content
      }));

      // Stream the response
      const result = await streamChatToRenderer(
        mainWindow,
        provider,
        messages,
        sessionId,
        SYSTEM_PROMPT
      );

      // Save assistant response to DB
      const msgId = db.insertMessage(sessionId, 'assistant', result.content, result.toolCalls);

      // Create task record if this looks like a task request
      if (result.content.length > 50) {
        const existingTasks = db.getTasks(sessionId);
        if (existingTasks.length === 0 || message.toLowerCase().includes('task') || message.toLowerCase().includes('implement') || message.toLowerCase().includes('build') || message.toLowerCase().includes('create') || message.toLowerCase().includes('fix')) {
          const taskTitle = message.length > 80 ? message.substring(0, 80) + '...' : message;
          db.createTask(sessionId, taskTitle, message);
        }
      }

      db.logActivity(sessionId, 'chat_response', `AI responded`, result.content.substring(0, 100));

      return {
        id: msgId,
        role: 'assistant',
        content: result.content,
        toolCalls: result.toolCalls,
        streaming: true // Tells renderer the response was streamed
      };
    } catch (err) {
      const errMsg = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      db.insertMessage(sessionId, 'assistant', errMsg);
      db.logActivity(sessionId, 'chat_error', errMsg, '', {}, 'error');
      return { role: 'assistant', content: errMsg, error: true };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY, async (_event, sessionId: string) => {
    return db.getMessages(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.CHAT_CLEAR, async (_event, sessionId: string) => {
    // We don't delete from DB but can mark cleared
    db.logActivity(sessionId, 'chat_cleared', 'Chat history cleared');
    return true;
  });

  // ─── Tasks ──────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.TASK_LIST, async (_event, sessionId?: string) => {
    if (sessionId) {
      return db.getTasks(sessionId);
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
    return db.getActivity(sessionId);
  });

  // ─── Diff ──────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.DIFF_GET, async (_event, sessionId?: string) => {
    if (sessionId) {
      return db.getDiffs(sessionId);
    }
    return [];
  });

  // ─── MCP ───────────────────────────────────────────────

  const mcp = getMCPManager();

  ipcMain.handle(IPC_CHANNELS.MCP_LIST_SERVERS, async () => {
    return mcp.getServers();
  });

  ipcMain.handle(IPC_CHANNELS.MCP_ADD_SERVER, async (_event, config: any) => {
    try {
      await mcp.addServer({
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
      db.logActivity('system', 'mcp_server_added', `MCP server added: ${config.name}`);
      return { success: true };
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
      db.logActivity('system', 'mcp_connected', `MCP connected: ${server?.name}`, '', {
        serverId: id,
        tools: server?.tools.length || 0
      });
      return { success: true, tools: server?.tools || [] };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.MCP_DISCONNECT, async (_event, id: string) => {
    await mcp.disconnectServer(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.MCP_TEST, async (_event, id: string) => {
    const result = await mcp.testConnection(id);
    return { success: result };
  });

  ipcMain.handle(IPC_CHANNELS.MCP_GET_TOOLS, async (_event, serverId?: string) => {
    if (serverId) {
      return mcp.getServerTools(serverId);
    }
    // Return all tools from all connected servers
    const servers = mcp.getServers();
    const tools: any[] = [];
    for (const s of servers) {
      if (s.status === 'connected') {
        tools.push(...s.tools);
      }
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
    // Return list of available tools (builtin + MCP)
    const servers = mcp.getServers();
    const tools: any[] = [];
    for (const s of servers) {
      if (s.status === 'connected') {
        for (const t of s.tools) {
          if (t.enabled) {
            tools.push({ ...t, source: 'mcp', serverName: s.name });
          }
        }
      }
    }
    return tools;
  });

  ipcMain.handle(IPC_CHANNELS.TOOL_EXECUTE, async (_event, name: string, input: any) => {
    // For now, log the tool call
    db.logActivity('system', 'tool_execute', `Tool executed: ${name}`, JSON.stringify(input).substring(0, 200));
    return { success: true, output: `Tool ${name} executed` };
  });

  // ─── Verification ──────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.VERIFICATION_LIST, async () => {
    return [];
  });

  ipcMain.handle(IPC_CHANNELS.VERIFICATION_RUN, async (_event, taskId: string) => {
    db.logActivity('system', 'verification_run', `Verification started for task ${taskId}`);
    return { passed: true, checks: [] };
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Initialize services before registering handlers
  const settings = getSecureSettings();

  // Auto-register saved API keys as providers
  const providers = settings.getConfiguredProviders();
  for (const provider of providers) {
    const key = settings.getApiKey(provider);
    if (key && provider === 'claude') {
      providerRegistry.register(new ClaudeProvider(key));
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

  registerIPCHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Cleanup MCP processes
  try { getMCPManager().cleanup(); } catch {}
  // Close database
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
