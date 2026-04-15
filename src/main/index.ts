/**
 * GDeveloper - Electron Main Process Entry
 * Initializes: database, security, GitHub adapter, MCP manager, orchestration engine, tool registry
 * Exposes IPC handlers for renderer
 */

// Note: In web preview mode, we export the modules for the React app to import directly.
// In Electron mode, this would be the main process entry point.

export { getDatabase } from './db';
export { getSecureSettings } from './security';
export { getGitHub } from './github';
export { getMCPManager } from './mcp';
export { getOrchestrationEngine } from './orchestration';
export { getToolRegistry } from './tools';
export { providerRegistry, ClaudeProvider } from './providers';
