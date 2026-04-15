/**
 * Electron Preload Script
 * Exposes safe IPC bridges to the renderer process
 * In web preview mode, this is not used (direct imports instead)
 */

// In Electron mode, this would use contextBridge:
// import { contextBridge, ipcRenderer } from 'electron';
// contextBridge.exposeInMainWorld('electronAPI', { ... });

// For web preview, we export a mock API
export const electronAPI = {
  // Settings
  getSettings: async () => ({}),
  updateSettings: async (settings: any) => settings,
  setApiKey: async (provider: string, key: string) => true,
  getApiKey: async (provider: string) => '',
  validateApiKey: async (provider: string, key: string) => ({ valid: true }),

  // GitHub
  connectGitHub: async (token: string) => true,
  listRepos: async () => [],
  selectRepo: async (repoId: string) => ({}),

  // Chat
  sendMessage: async (sessionId: string, message: string) => ({}),
  getChatHistory: async (sessionId: string) => [],

  // MCP
  listMCPServers: async () => [],
  addMCPServer: async (config: any) => true,
  connectMCPServer: async (id: string) => true,
  disconnectMCPServer: async (id: string) => true,
  testMCPConnection: async (id: string) => true,

  // Tools
  listTools: async () => [],
  executeTool: async (name: string, input: any) => ({}),

  // Platform info
  platform: 'web' as const,
  isElectron: false
};

// Type declaration for renderer
declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}
