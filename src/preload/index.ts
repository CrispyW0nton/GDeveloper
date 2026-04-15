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

  // ─── Platform Info ─────────────────────────────────
  platform: process.platform as string,
  isElectron: true,
};

// Expose to renderer via window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type export for TypeScript consumers
export type ElectronAPI = typeof electronAPI;
