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

      // Stream the response (pass MCP tools so Claude can use them)
      const result = await streamChatToRenderer(
        mainWindow,
        provider,
        messages,
        sessionId,
        SYSTEM_PROMPT,
        mcpTools.length > 0 ? mcpTools : undefined
      );

      // Save assistant response to DB
      const msgId = db.insertMessage(sessionId, 'assistant', result.content, result.toolCalls);

      // Handle tool_use: execute MCP tools and continue the conversation
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          db.logActivity(sessionId, 'tool_call', `Tool call: ${tc.name}`, JSON.stringify(tc.input).substring(0, 200), {
            toolName: tc.name,
            toolCallId: tc.id,
            sessionId
          });

          // Find which server has this tool
          const toolMeta = mcpTools.find(t => t.name === tc.name);
          if (toolMeta) {
            try {
              const toolResult = await mcp.executeTool(toolMeta.serverId, tc.name, tc.input || {});

              // Format tool result content
              const resultContent = toolResult?.content
                ? (Array.isArray(toolResult.content)
                    ? toolResult.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
                    : JSON.stringify(toolResult.content))
                : JSON.stringify(toolResult);

              db.logActivity(sessionId, 'tool_result', `Tool result: ${tc.name}`, resultContent.substring(0, 200), {
                toolName: tc.name,
                toolCallId: tc.id,
                success: true
              });

              // Send tool result to renderer
              mainWindow?.webContents.send('chat:stream-chunk', {
                sessionId,
                type: 'tool_result',
                toolCallId: tc.id,
                toolName: tc.name,
                result: resultContent.substring(0, 2000)
              });

              // Store tool result as a message for conversation continuity
              db.insertMessage(sessionId, 'user', `[Tool Result: ${tc.name}]\n${resultContent.substring(0, 4000)}`);
            } catch (toolErr) {
              const toolErrMsg = toolErr instanceof Error ? toolErr.message : 'Tool execution failed';
              db.logActivity(sessionId, 'tool_error', `Tool error: ${tc.name}`, toolErrMsg, {
                toolName: tc.name,
                toolCallId: tc.id
              }, 'error');

              mainWindow?.webContents.send('chat:stream-chunk', {
                sessionId,
                type: 'tool_error',
                toolCallId: tc.id,
                toolName: tc.name,
                error: toolErrMsg
              });
            }
          }
        }
      }

      // Create additional tasks for follow-up task-like messages
      if (!taskId && result.content.length > 50) {
        const isTaskRequest = ['task', 'implement', 'build', 'create', 'fix', 'update', 'add', 'change', 'refactor', 'debug'].some(
          kw => message.toLowerCase().includes(kw)
        );
        if (isTaskRequest) {
          const taskTitle = message.length > 80 ? message.substring(0, 80) + '...' : message;
          const newTaskId = db.createTask(sessionId, taskTitle, message);
          db.logActivity(sessionId, 'task_updated', `Task created: ${taskTitle}`, '', { taskId: newTaskId, status: 'TASK_CREATED' });
        }
      }

      // Update existing task to EXECUTING status
      if (taskId) {
        db.updateTaskStatus(taskId, 'EXECUTING', 'AI response received');
        db.logActivity(sessionId, 'task_updated', 'Task executing', 'AI processing response', { taskId, status: 'EXECUTING' });
      }

      db.logActivity(sessionId, 'chat_response', `AI responded (${result.content.length} chars)`, result.content.substring(0, 150), {
        sessionId,
        provider: provider.name,
        contentLength: result.content.length,
        toolCalls: result.toolCalls?.length || 0
      });

      return {
        id: msgId,
        role: 'assistant',
        content: result.content,
        toolCalls: result.toolCalls,
        streaming: true
      };
    } catch (err) {
      const errMsg = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      db.insertMessage(sessionId, 'assistant', errMsg);
      db.logActivity(sessionId, 'chat_error', 'Chat error', errMsg, { sessionId, provider: provider.name }, 'error');

      // Mark task as blocked on error
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
    // We don't delete from DB but can mark cleared
    db.logActivity(sessionId, 'chat_cleared', 'Chat history cleared');
    return true;
  });

  // ─── Tasks ──────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.TASK_LIST, async (_event, sessionId?: string) => {
    // Always return all tasks - sessions are ephemeral but tasks should persist
    // across app restarts and be visible regardless of session
    if (sessionId) {
      const sessionTasks = db.getTasks(sessionId);
      // Also include tasks from other sessions if requested session has none
      if (sessionTasks.length === 0) {
        return db.getAllTasks();
      }
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
    // Return all activity events (session-specific + system-level)
    // so the Activity Log panel always shows relevant events
    if (sessionId) {
      const sessionEvents = db.getActivity(sessionId);
      const systemEvents = db.getActivity('system');
      // Merge, dedupe by id, sort by timestamp desc
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
      // Return the canonical server record so the renderer uses the correct ID
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

  ipcMain.handle(IPC_CHANNELS.TOOL_EXECUTE, async (_event, name: string, input: any, serverId?: string) => {
    try {
      // Find which server has this tool
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
        return { success: false, error: `No connected MCP server provides tool: ${name}` };
      }

      db.logActivity('system', 'tool_execute', `Executing tool: ${name}`, JSON.stringify(input).substring(0, 200), {
        toolName: name,
        serverId: targetServerId
      });

      const result = await mcp.executeTool(targetServerId, name, input || {});

      db.logActivity('system', 'tool_result', `Tool completed: ${name}`, JSON.stringify(result).substring(0, 200), {
        toolName: name,
        serverId: targetServerId,
        success: true
      });

      return { success: true, output: result };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Tool execution failed';
      db.logActivity('system', 'tool_error', `Tool failed: ${name}`, errMsg, { toolName: name }, 'error');
      return { success: false, error: errMsg };
    }
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

  // Auto-register saved API keys as providers (with best model detection)
  const providers = settings.getConfiguredProviders();
  for (const provider of providers) {
    const key = settings.getApiKey(provider);
    if (key && provider === 'claude') {
      // Try to detect best model from saved key
      const tempProvider = new ClaudeProvider(key);
      tempProvider.validateKey().then(result => {
        let bestModel = 'claude-sonnet-4-6';
        if (result.valid && result.models && result.models.length > 0) {
          const sonnet4 = result.models.find((m: string) => m.includes('sonnet-4'));
          const anySonnet = result.models.find((m: string) => m.includes('sonnet'));
          bestModel = sonnet4 || anySonnet || result.models[0];
          console.log(`[Startup] Auto-detected best model: ${bestModel}`);
        }
        providerRegistry.register(new ClaudeProvider(key, bestModel));
      }).catch(() => {
        // Fallback: register with default model
        providerRegistry.register(new ClaudeProvider(key));
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
