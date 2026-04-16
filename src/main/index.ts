/**
 * GDeveloper - Electron Main Process Entry
 * Creates the BrowserWindow, registers ALL IPC handlers,
 * initializes services (DB, security, providers, GitHub, MCP).
 * Sprint 9: + Workspace management, Git operations, Terminal, Agentic chat loop
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
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
import {
  setActiveWorkspace, getActiveWorkspace,
  executeLocalTool, LOCAL_TOOL_DEFINITIONS,
  gitPull, gitPush, gitFetch, gitStash, gitStashPop,
  gitBranches, gitCheckout, gitGetStatus, gitClone, isGitRepo,
} from './tools';
import { v4 as uuid } from 'uuid';

let mainWindow: BrowserWindow | null = null;

// ─── Active workspace ID in memory ───
let activeWorkspaceId: string | null = null;

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
          let bestModel = 'claude-sonnet-4-6';
          if (result.models && result.models.length > 0) {
            const sonnet4 = result.models.find((m: string) => m.includes('sonnet-4'));
            const anySonnet = result.models.find((m: string) => m.includes('sonnet'));
            bestModel = sonnet4 || anySonnet || result.models[0];
          }
          const registeredProvider = new ClaudeProvider(key, bestModel);
          providerRegistry.register(registeredProvider);
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

      // Build combined tools array (local + MCP)
      const allTools: any[] = [
        ...LOCAL_TOOL_DEFINITIONS.map(t => ({
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
      if (wsPath) {
        enhancedPrompt += `\n\nCurrent workspace: ${wsPath}`;
        try {
          const git: SimpleGit = simpleGit(wsPath);
          const status = await git.status();
          enhancedPrompt += `\nBranch: ${status.current || '(detached)'}`;
          enhancedPrompt += `\nTracking: ${status.tracking || '(none)'}`;
          enhancedPrompt += `\nModified: ${status.modified.length} | Staged: ${status.staged.length} | Untracked: ${status.not_added.length}`;
        } catch { /* git context optional */ }
      }

      enhancedPrompt += `\n\nYou have ${allTools.length} tools available (${LOCAL_TOOL_DEFINITIONS.length} local + ${mcpTools.length} MCP).`;
      enhancedPrompt += `\nLocal tools: ${LOCAL_TOOL_DEFINITIONS.map(t => t.name).join(', ')}`;

      // ─── Agentic Loop: stream → execute tools → continue ───
      let loopCount = 0;
      const maxLoops = 10;
      let fullContent = '';
      let allToolCalls: any[] = [];
      let currentMessages = [...messages];

      while (loopCount < maxLoops) {
        loopCount++;

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

          // Check if it's a local tool
          const isLocalTool = LOCAL_TOOL_DEFINITIONS.some(t => t.name === tc.name);

          if (isLocalTool) {
            try {
              const localResult = await executeLocalTool(tc.name, tc.input || {});
              toolResultContent = localResult.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
            } catch (err) {
              toolResultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
              isError = true;
            }
          } else {
            // MCP tool
            const toolMeta = mcpTools.find(t => t.name === tc.name);
            if (toolMeta) {
              try {
                const mcpResult = await mcp.executeTool(toolMeta.serverId, tc.name, tc.input || {});
                toolResultContent = mcpResult?.content
                  ? (Array.isArray(mcpResult.content)
                      ? mcpResult.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
                      : JSON.stringify(mcpResult.content))
                  : JSON.stringify(mcpResult);
              } catch (err) {
                toolResultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
                isError = true;
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

        // Add tool results as user message for next turn
        const toolResultMessage = toolResults.map(tr =>
          `[Tool Result: ${tr.toolName}]\n${tr.content.substring(0, 4000)}`
        ).join('\n\n');

        currentMessages.push({ role: 'user', content: toolResultMessage });

        // Persist the tool results
        db.insertMessage(sessionId, 'assistant', result.content || '(tool execution)', result.toolCalls);
        db.insertMessage(sessionId, 'user', toolResultMessage);
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
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const settings = getSecureSettings();

  // Auto-register saved API keys as providers
  const providers = settings.getConfiguredProviders();
  for (const provider of providers) {
    const key = settings.getApiKey(provider);
    if (key && provider === 'claude') {
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
