/**
 * Electron Preload Script
 * Exposes safe IPC bridges to the renderer process via contextBridge.
 * Includes streaming support for chat responses.
 * The renderer can only call these whitelisted methods.
 */

import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  // ─── Settings ──────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: any) => ipcRenderer.invoke('settings:update', settings),
  setApiKey: (provider: string, key: string) => ipcRenderer.invoke('api-key:set', provider, key),
  getApiKey: (provider: string) => ipcRenderer.invoke('api-key:get', provider),
  removeApiKey: (provider: string) => ipcRenderer.invoke('api-key:remove', provider),
  validateApiKey: (provider: string, key: string) => ipcRenderer.invoke('api-key:validate', provider, key),

  // ─── GitHub ────────────────────────────────────────
  connectGitHub: (token: string) => ipcRenderer.invoke('github:connect', token),
  disconnectGitHub: () => ipcRenderer.invoke('github:disconnect'),
  listRepos: () => ipcRenderer.invoke('github:list-repos'),
  selectRepo: (repoFullName: string) => ipcRenderer.invoke('github:select-repo', repoFullName),
  getFile: (repo: string, path: string, branch: string) => ipcRenderer.invoke('github:get-file', repo, path, branch),
  createBranch: (repo: string, name: string, baseSha: string) => ipcRenderer.invoke('github:create-branch', repo, name, baseSha),
  createCommit: (repo: string, branch: string, message: string, files: any[]) => ipcRenderer.invoke('github:create-commit', repo, branch, message, files),
  createPR: (repo: string, title: string, body: string, head: string, base: string) => ipcRenderer.invoke('github:create-pr', repo, title, body, head, base),

  // ─── Chat / Orchestration ─────────────────────────
  sendMessage: (sessionId: string, message: string) => ipcRenderer.invoke('chat:send', sessionId, message),
  getChatHistory: (sessionId: string) => ipcRenderer.invoke('chat:history', sessionId),
  clearChat: (sessionId: string) => ipcRenderer.invoke('chat:clear', sessionId),

  // Chat streaming: listen for stream chunks from main process
  onStreamChunk: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chat:stream-chunk', handler);
    return () => ipcRenderer.removeListener('chat:stream-chunk', handler);
  },

  // ─── Tasks ─────────────────────────────────────────
  listTasks: (sessionId?: string) => ipcRenderer.invoke('task:list', sessionId),
  getTask: (taskId: string) => ipcRenderer.invoke('task:get', taskId),
  updateTask: (taskId: string, status: string, reason?: string) => ipcRenderer.invoke('task:update', taskId, status, reason),

  // ─── MCP Servers ───────────────────────────────────
  listMCPServers: () => ipcRenderer.invoke('mcp:list-servers'),
  addMCPServer: (config: any) => ipcRenderer.invoke('mcp:add-server', config),
  removeMCPServer: (id: string) => ipcRenderer.invoke('mcp:remove-server', id),
  updateMCPServer: (id: string, config: any) => ipcRenderer.invoke('mcp:update-server', id, config),
  connectMCPServer: (id: string) => ipcRenderer.invoke('mcp:connect', id),
  disconnectMCPServer: (id: string) => ipcRenderer.invoke('mcp:disconnect', id),
  testMCPConnection: (id: string) => ipcRenderer.invoke('mcp:test', id),
  getMCPTools: (serverId?: string) => ipcRenderer.invoke('mcp:get-tools', serverId),
  toggleMCPTool: (serverId: string, toolName: string, enabled: boolean) => ipcRenderer.invoke('mcp:toggle-tool', serverId, toolName, enabled),

  // ─── Tools ─────────────────────────────────────────
  listTools: () => ipcRenderer.invoke('tool:list'),
  executeTool: (name: string, input: any) => ipcRenderer.invoke('tool:execute', name, input),
  approveTool: (executionId: string) => ipcRenderer.invoke('tool:approve', executionId),

  // ─── Activity ──────────────────────────────────────
  listActivity: (sessionId?: string) => ipcRenderer.invoke('activity:list', sessionId),

  // ─── Diff ──────────────────────────────────────────
  getDiffs: (sessionId?: string) => ipcRenderer.invoke('diff:get', sessionId),

  // ─── Verification ──────────────────────────────────
  listVerifications: () => ipcRenderer.invoke('verification:list'),
  runVerification: (taskId: string) => ipcRenderer.invoke('verification:run', taskId),

  // ─── Roadmap ───────────────────────────────────────
  uploadRoadmap: (content: string) => ipcRenderer.invoke('roadmap:upload', content),
  parseRoadmap: (content: string) => ipcRenderer.invoke('roadmap:parse', content),
  listRoadmaps: () => ipcRenderer.invoke('roadmap:list'),

  // ─── Workspace Management (Sprint 9) ──────────────
  listWorkspaces: () => ipcRenderer.invoke('workspace:list'),
  getWorkspace: (id: string) => ipcRenderer.invoke('workspace:get', id),
  addWorkspace: (ws: any) => ipcRenderer.invoke('workspace:add', ws),
  removeWorkspace: (id: string) => ipcRenderer.invoke('workspace:remove', id),
  setActiveWorkspace: (id: string) => ipcRenderer.invoke('workspace:set-active', id),
  getActiveWorkspace: () => ipcRenderer.invoke('workspace:get-active'),
  updateWorkspacePath: (id: string, newPath: string) => ipcRenderer.invoke('workspace:update-path', id, newPath),
  cloneWorkspace: (url: string, localPath: string, name: string) => ipcRenderer.invoke('workspace:clone', url, localPath, name),
  openLocalWorkspace: (localPath: string, name: string) => ipcRenderer.invoke('workspace:open-local', localPath, name),

  // ─── Git Operations (Sprint 9) ────────────────────
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitPull: () => ipcRenderer.invoke('git:pull'),
  gitPush: () => ipcRenderer.invoke('git:push'),
  gitFetch: () => ipcRenderer.invoke('git:fetch'),
  gitBranches: () => ipcRenderer.invoke('git:branches'),
  gitCheckout: (branch: string) => ipcRenderer.invoke('git:checkout', branch),
  gitCreateBranch: (name: string) => ipcRenderer.invoke('git:create-branch', name),
  gitStash: (message?: string) => ipcRenderer.invoke('git:stash', message),
  gitStashPop: () => ipcRenderer.invoke('git:stash-pop'),
  gitStageAll: () => ipcRenderer.invoke('git:stage-all'),
  gitUnstageAll: () => ipcRenderer.invoke('git:unstage-all'),
  gitStageFile: (path: string) => ipcRenderer.invoke('git:stage-file', path),
  gitUnstageFile: (path: string) => ipcRenderer.invoke('git:unstage-file', path),
  gitCommit: (message: string) => ipcRenderer.invoke('git:commit', message),
  gitCommitPush: (message: string) => ipcRenderer.invoke('git:commit-push', message),
  gitLog: (count?: number) => ipcRenderer.invoke('git:log', count),
  gitDiff: (staged?: boolean) => ipcRenderer.invoke('git:diff', staged),
  gitDiscard: () => ipcRenderer.invoke('git:discard'),
  gitResetSoft: () => ipcRenderer.invoke('git:reset-soft'),
  gitResetHard: (confirm: string) => ipcRenderer.invoke('git:reset-hard', confirm),
  gitResetToRemote: (confirm: string) => ipcRenderer.invoke('git:reset-to-remote', confirm),

  // ─── Terminal (Sprint 9) ──────────────────────────
  terminalExecute: (command: string, cwd?: string) => ipcRenderer.invoke('terminal:execute', command, cwd),
  detectShells: () => ipcRenderer.invoke('terminal:detect-shells'),

  // ─── Slash Commands & Mode (Sprint 12) ─────────────
  executeSlashCommand: (name: string, args: string, sessionId: string) => ipcRenderer.invoke('slash:execute', name, args, sessionId),
  listSlashCommands: () => ipcRenderer.invoke('slash:list'),
  getExecutionMode: () => ipcRenderer.invoke('mode:get'),
  setExecutionMode: (mode: string) => ipcRenderer.invoke('mode:set', mode),

  // ─── Sprint 13: Discovery ─────────────────────────
  scanForRepos: (rootPath: string, maxDepth?: number) => ipcRenderer.invoke('discovery:scan', rootPath, maxDepth),
  importDiscoveredRepos: (repos: any[]) => ipcRenderer.invoke('discovery:import', repos),

  // ─── Sprint 13: Migration ─────────────────────────
  getManagedRoot: () => ipcRenderer.invoke('migration:get-managed-root'),
  setManagedRoot: (path: string) => ipcRenderer.invoke('migration:set-managed-root', path),
  moveWorkspace: (id: string, destDir: string, deleteOriginal?: boolean) => ipcRenderer.invoke('migration:move-workspace', id, destDir, deleteOriginal),
  moveToManagedRoot: (id: string, deleteOriginal?: boolean) => ipcRenderer.invoke('migration:move-to-managed', id, deleteOriginal),

  // ─── Sprint 13: Environment Profiles ──────────────
  detectStack: (workspacePath?: string) => ipcRenderer.invoke('env:detect-stack', workspacePath),
  getEnvProfile: (workspacePath?: string) => ipcRenderer.invoke('env:get-profile', workspacePath),
  createPythonEnv: (workspacePath?: string) => ipcRenderer.invoke('env:create-python', workspacePath),
  syncPythonDeps: (workspacePath?: string, envPath?: string) => ipcRenderer.invoke('env:sync-deps', workspacePath, envPath),
  isUvAvailable: () => ipcRenderer.invoke('env:is-uv-available'),

  // ─── Sprint 13: Research & External ───────────────
  executeResearch: (question: string, sessionId: string) => ipcRenderer.invoke('research:execute', question, sessionId),
  compareRepos: (repoA: string, repoB: string, sessionId: string, focus?: string) => ipcRenderer.invoke('research:compare', repoA, repoB, sessionId, focus),
  downloadExternalRepo: (repoUrl: string) => ipcRenderer.invoke('external:download', repoUrl),
  listExternalRepos: () => ipcRenderer.invoke('external:list'),
  removeExternalRepo: (localPath: string) => ipcRenderer.invoke('external:remove', localPath),

  // ─── Sprint 13: MCP Health ────────────────────────
  getMCPHealth: () => ipcRenderer.invoke('mcp:health'),

  // ─── Sprint 13: GitHub Auth Status ────────────────
  getGitHubAuthStatus: () => ipcRenderer.invoke('github:auth-status'),

  // ─── Sprint 13: Task Verification ─────────────────
  verifyTask: (taskId: string) => ipcRenderer.invoke('task:verify', taskId),

  // ─── Sprint 14: MCP Forge / App Adapter Studio ────
  forgeScan: (appPath: string) => ipcRenderer.invoke('forge:scan', appPath),
  forgeGenerate: (capReport: any) => ipcRenderer.invoke('forge:generate', capReport),
  forgeSave: (project: any) => ipcRenderer.invoke('forge:save', project),
  forgeListAdapters: () => ipcRenderer.invoke('forge:list-adapters'),
  forgeGetAdapter: (id: string) => ipcRenderer.invoke('forge:get-adapter', id),
  forgeUpdateAdapter: (id: string, updates: any) => ipcRenderer.invoke('forge:update-adapter', id, updates),
  forgeRemoveAdapter: (id: string) => ipcRenderer.invoke('forge:remove-adapter', id),
  forgeTest: (adapterId: string) => ipcRenderer.invoke('forge:test', adapterId),
  forgeRegister: (adapterId: string) => ipcRenderer.invoke('forge:register', adapterId),
  forgeUnregister: (adapterId: string) => ipcRenderer.invoke('forge:unregister', adapterId),
  forgeResearch: (appName: string, capReport: any, sessionId: string) => ipcRenderer.invoke('forge:research', appName, capReport, sessionId),
  forgeAnalysisClone: (repoUrl: string, branch?: string) => ipcRenderer.invoke('forge:analysis-clone', repoUrl, branch),
  forgeAnalysisList: () => ipcRenderer.invoke('forge:analysis-list'),
  forgeAnalysisRemove: (localPath: string) => ipcRenderer.invoke('forge:analysis-remove', localPath),
  forgeListAppRecords: () => ipcRenderer.invoke('forge:app-records'),
  forgeSaveAppRecord: (record: any) => ipcRenderer.invoke('forge:app-record-save', record),
  forgeRemoveAppRecord: (id: string) => ipcRenderer.invoke('forge:app-record-remove', id),
  forgeToggleAppFavorite: (id: string) => ipcRenderer.invoke('forge:app-toggle-favorite', id),

  // ─── Sprint 16: Model Selection ───────────────────
  listModels: () => ipcRenderer.invoke('model:list'),
  getSelectedModel: () => ipcRenderer.invoke('model:get-selected'),
  setSelectedModel: (model: string) => ipcRenderer.invoke('model:set-selected', model),
  discoverModels: () => ipcRenderer.invoke('model:discover'),
  refreshModels: () => ipcRenderer.invoke('model:refresh'),                     // Sprint 25.5
  validateSelectedModel: () => ipcRenderer.invoke('model:validate-selected'),   // Sprint 25.5
  checkModelToolSupport: (model?: string) => ipcRenderer.invoke('model:check-tools', model),

  // ─── Sprint 16: Sandbox Monitor ───────────────────
  getSandboxLog: () => ipcRenderer.invoke('sandbox:get-log'),
  clearSandboxLog: () => ipcRenderer.invoke('sandbox:clear-log'),
  onSandboxEvent: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('sandbox:event', handler);
    return () => ipcRenderer.removeListener('sandbox:event', handler);
  },

  // ─── Sprint 17: Git Worktrees ──────────────────────
  worktreeList: () => ipcRenderer.invoke('worktree:list'),
  worktreeAdd: (options: any) => ipcRenderer.invoke('worktree:add', options),
  worktreeRemove: (options: any) => ipcRenderer.invoke('worktree:remove', options),
  worktreePrune: (dryRun?: boolean) => ipcRenderer.invoke('worktree:prune', dryRun),
  worktreeRepair: (targetPath?: string) => ipcRenderer.invoke('worktree:repair', targetPath),
  worktreeLock: (targetPath: string, reason?: string) => ipcRenderer.invoke('worktree:lock', targetPath, reason),
  worktreeUnlock: (targetPath: string) => ipcRenderer.invoke('worktree:unlock', targetPath),
  worktreeMove: (from: string, to: string) => ipcRenderer.invoke('worktree:move', from, to),
  worktreeCompare: (pathA: string, pathB: string) => ipcRenderer.invoke('worktree:compare', pathA, pathB),
  worktreeContext: (path?: string) => ipcRenderer.invoke('worktree:context', path),
  worktreeCreateTask: (request: any) => ipcRenderer.invoke('worktree:create-task', request),
  worktreeCompleteTask: (taskId: string) => ipcRenderer.invoke('worktree:complete-task', taskId),
  worktreeAbandonTask: (taskId: string) => ipcRenderer.invoke('worktree:abandon-task', taskId),
  worktreeHandoff: (worktreePath: string, targetBranch?: string) => ipcRenderer.invoke('worktree:handoff', worktreePath, targetBranch),
  worktreeTaskList: () => ipcRenderer.invoke('worktree:task-list'),
  worktreeRecommend: (taskDescription: string) => ipcRenderer.invoke('worktree:recommend', taskDescription),

  // ─── Sprint 19: File Tree ─────────────────────────
  getFileTree: (maxDepth?: number) => ipcRenderer.invoke('filetree:get', maxDepth),
  readFileContent: (filePath: string) => ipcRenderer.invoke('filetree:read-file', filePath),

  // ─── Sprint 23: File Writing (Editor) ─────────────
  writeFileContent: (filePath: string, content: string) => ipcRenderer.invoke('filetree:write-file', filePath, content),
  checkFileWritable: (filePath: string) => ipcRenderer.invoke('filetree:check-writable', filePath),

  // ─── Sprint 23: Model Metadata ────────────────────
  getDefaultModel: () => ipcRenderer.invoke('model:get-default'),
  setDefaultModel: (model: string) => ipcRenderer.invoke('model:set-default', model),
  getModelMetaList: () => ipcRenderer.invoke('model:get-meta-list'),

  // ─── Sprint 19 + Sprint 22: Auto-Continue ───────────
  autoContinueStart: (config?: any) => ipcRenderer.invoke('auto-continue:start', config),
  autoContinueStop: (reason?: string) => ipcRenderer.invoke('auto-continue:stop', reason),
  autoContinueStatus: () => ipcRenderer.invoke('auto-continue:status'),
  autoContinuePause: (reason?: string) => ipcRenderer.invoke('auto-continue:pause', reason),
  autoContinueResume: () => ipcRenderer.invoke('auto-continue:resume'),
  autoContinueLog: () => ipcRenderer.invoke('auto-continue:log'),
  autoContinueConfig: () => ipcRenderer.invoke('auto-continue:config'),
  // Sprint 27.2: State machine APIs
  autoContinueShouldFire: () => ipcRenderer.invoke('auto-continue:should-fire'),
  autoContinueStateSnapshot: () => ipcRenderer.invoke('auto-continue:state-snapshot'),
  autoContinuePauseUser: () => ipcRenderer.invoke('auto-continue:pause-user'),
  autoContinueResumeUser: () => ipcRenderer.invoke('auto-continue:resume-user'),

  // ─── Sprint 19: Live Code View events ──────────────
  onFileChanged: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('filetree:file-changed', handler);
    return () => ipcRenderer.removeListener('filetree:file-changed', handler);
  },

  // ─── Sprint 21 + Sprint 24: Rate Limiting & Token Budget ───────
  getRateLimitSnapshot: () => ipcRenderer.invoke('rate-limit:get-snapshot'),
  resetRateLimit: () => ipcRenderer.invoke('rate-limit:reset'),
  pauseResumeRateLimit: () => ipcRenderer.invoke('rate-limit:pause-resume'),
  getTokenBudget: () => ipcRenderer.invoke('token-budget:get'),
  setTokenBudget: (config: any) => ipcRenderer.invoke('token-budget:set', config),
  getRetryState: () => ipcRenderer.invoke('retry:get-state'),
  summarizeContext: (sessionId: string) => ipcRenderer.invoke('context:summarize', sessionId),
  compactHistory: (sessionId: string) => ipcRenderer.invoke('context:compact', sessionId),

  // ─── Sprint 24: Session Usage ───
  getSessionUsage: () => ipcRenderer.invoke('session-usage:get'),
  resetSessionUsage: () => ipcRenderer.invoke('session-usage:reset'),
  onRateLimitUpdate: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('rate-limit:update', handler);
    return () => ipcRenderer.removeListener('rate-limit:update', handler);
  },
  onRetryStateUpdate: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('retry:state-update', handler);
    return () => ipcRenderer.removeListener('retry:state-update', handler);
  },

  // ─── Sprint 25: Attachments & Vision ────────────────
  processAttachment: (fileData: any) => ipcRenderer.invoke('attachment:process', fileData),
  processClipboardImage: (data: any) => ipcRenderer.invoke('attachment:process-clipboard', data),
  loadAttachment: (conversationId: string, filename: string) => ipcRenderer.invoke('attachment:load', conversationId, filename),
  deleteConversationAttachments: (conversationId: string) => ipcRenderer.invoke('attachment:delete-conversation', conversationId),
  getAttachmentConfig: () => ipcRenderer.invoke('attachment:config-get'),
  setAttachmentConfig: (config: any) => ipcRenderer.invoke('attachment:config-set', config),
  checkVisionSupport: (modelId?: string) => ipcRenderer.invoke('attachment:check-vision', modelId),

  // ─── Sprint 27: Compare Agent ───────────────────────
  compareFiles: (left: string, right: string, filters?: any) => ipcRenderer.invoke('compare:files', left, right, filters),
  compareFolders: (left: string, right: string, filters?: any) => ipcRenderer.invoke('compare:folders', left, right, filters),
  compareMerge3: (left: string, right: string, base: string, filters?: any) => ipcRenderer.invoke('compare:merge3', left, right, base, filters),
  compareSyncPreview: (sessionId: string, direction: string) => ipcRenderer.invoke('compare:sync-preview', sessionId, direction),
  compareGetSession: (sessionId: string) => ipcRenderer.invoke('compare:get-session', sessionId),
  compareListSessions: () => ipcRenderer.invoke('compare:list-sessions'),
  compareDeleteSession: (sessionId: string) => ipcRenderer.invoke('compare:delete-session', sessionId),
  compareHunkAction: (sessionId: string, hunkIndex: number, action: string) => ipcRenderer.invoke('compare:hunk-action', sessionId, hunkIndex, action),
  compareHunkDetail: (sessionId: string, hunkIndex: number) => ipcRenderer.invoke('compare:hunk-detail', sessionId, hunkIndex),
  compareFolderEntryDiff: (sessionId: string, relativePath: string) => ipcRenderer.invoke('compare:folder-entry-diff', sessionId, relativePath),
  compareCompactOutput: (sessionId: string, maxItems?: number) => ipcRenderer.invoke('compare:compact-output', sessionId, maxItems),
  compareSaveMerge: (sessionId: string, outputPath: string) => ipcRenderer.invoke('compare:save-merge', sessionId, outputPath),

  // ─── Sprint 27: Todo Manager ─────────────────────────
  getTodoList: (sessionId: string) => ipcRenderer.invoke('todo:get', sessionId),
  createTodoList: (sessionId: string, items: any[]) => ipcRenderer.invoke('todo:create', sessionId, items),
  updateTodoItem: (sessionId: string, itemId: string, updates: any) => ipcRenderer.invoke('todo:update-item', sessionId, itemId, updates),
  appendTodoItems: (sessionId: string, items: any[]) => ipcRenderer.invoke('todo:append', sessionId, items),
  clearTodoList: (sessionId: string) => ipcRenderer.invoke('todo:clear', sessionId),
  getTodoProgress: (sessionId: string) => ipcRenderer.invoke('todo:progress', sessionId),

  // ─── Sprint 27: Checkpoints ─────────────────────────
  getCheckpoints: (sessionId: string) => ipcRenderer.invoke('checkpoint:list', sessionId),
  createCheckpoint: (sessionId: string, label: string, data: any) => ipcRenderer.invoke('checkpoint:create', sessionId, label, data),
  getLatestCheckpoint: (sessionId: string) => ipcRenderer.invoke('checkpoint:latest', sessionId),

  // ─── Sprint 27: Verify ──────────────────────────────
  runVerifyAssertions: (assertions: string, workspacePath?: string) => ipcRenderer.invoke('verify:run', assertions, workspacePath),
  getVerifyHistory: () => ipcRenderer.invoke('verify:history'),

  // ─── Sprint 27.1: Write-Scope ──────────────────────
  getWriteScope: () => ipcRenderer.invoke('write-scope:get'),
  setWriteScope: (prefixes: string[]) => ipcRenderer.invoke('write-scope:set', prefixes),
  clearWriteScope: () => ipcRenderer.invoke('write-scope:clear'),

  // ─── Sprint 27.1: Verify Specs ─────────────────────
  listVerifySpecs: () => ipcRenderer.invoke('verify-spec:list'),
  loadVerifySpec: (specArg: string) => ipcRenderer.invoke('verify-spec:load', specArg),
  runVerifySpec: (specArg: string) => ipcRenderer.invoke('verify-spec:run', specArg),

  // ─── Sprint 27.1: Rate Limit Lite ──────────────────
  getRateLimitLiteSnapshot: () => ipcRenderer.invoke('rate-limit-lite:snapshot'),
  getRateLimitLiteHeaders: () => ipcRenderer.invoke('rate-limit-lite:headers'),

  // ─── Platform Info ─────────────────────────────────
  platform: process.platform as string,
  isElectron: true,
};

// Expose to renderer via window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type export for TypeScript consumers
export type ElectronAPI = typeof electronAPI;
