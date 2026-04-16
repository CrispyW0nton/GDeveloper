/**
 * Application State Store
 * Loads persisted state from Electron main process on startup
 * Uses IPC to sync state changes
 * Sprint 9 fix: workspace activation flow, startup hydration, session auto-creation, relaxed gating
 * Sprint 12: ExecutionMode (plan/build), terminal panel visibility
 */

import { useState, useCallback, useEffect } from 'react';

// Get electronAPI (available in Electron, undefined in web preview)
const api = (window as any).electronAPI;

// ─── Types ───

export type ExecutionMode = 'plan' | 'build';

export type TabId = 'chat' | 'github' | 'mcp' | 'tasks' | 'roadmap' | 'diff' | 'activity' | 'settings' | 'workspace' | 'terminal';

// ─── App State Interface ───
export interface AppState {
  apiKeyConfigured: boolean;
  apiKeyProvider: string;
  githubConnected: boolean;
  githubUsername: string;
  selectedRepo: SelectedRepo | null;
  repositories: RepoInfo[];
  currentSession: SessionInfo | null;
  activeTab: TabId;
  sidebarCollapsed: boolean;
  activeWorkspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
  startupError: string | null;
  // Sprint 12 additions
  executionMode: ExecutionMode;
  terminalPanelOpen: boolean;
  terminalPanelHeight: number;
}

export interface SelectedRepo {
  id: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  description?: string;
  language?: string;
}

export interface RepoInfo {
  id: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  description?: string;
  language?: string;
}

export interface SessionInfo {
  id: string;
  repositoryId: string;
  repositoryFullName: string;
  workingBranch: string;
  status: 'active' | 'paused' | 'completed';
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  local_path: string;
  remote_url?: string;
  github_owner?: string;
  github_repo?: string;
  default_branch?: string;
  cloned_at?: string;
  last_opened_at?: string;
  mcp_server_id?: string;
  status: string;
}

// Sprint 13 types
export interface EnvironmentProfile {
  stack: string;
  manager: string;
  envPath: string;
  activationHint: string;
  detectedAt: string;
  details: Record<string, string>;
}

export interface MCPHealthInfo {
  id: string;
  name: string;
  status: string;
  transport: string;
  toolCount: number;
  lastConnected: string | null;
}

export interface GitHubAuthStatus {
  connected: boolean;
  username: string | null;
  hasToken: boolean;
  tokenValid: boolean;
  needsReconnect: boolean;
}

// ─── Helpers ───

/** Create a SessionInfo and SelectedRepo from a workspace */
function sessionFromWorkspace(ws: WorkspaceInfo): { session: SessionInfo; repo: SelectedRepo } {
  const fullName = ws.github_owner && ws.github_repo
    ? `${ws.github_owner}/${ws.github_repo}`
    : ws.name;
  return {
    session: {
      id: `session-ws-${ws.id}`,
      repositoryId: ws.id,
      repositoryFullName: fullName,
      workingBranch: ws.default_branch || 'main',
      status: 'active',
    },
    repo: {
      id: ws.id,
      fullName,
      defaultBranch: ws.default_branch || 'main',
      isPrivate: false,
    },
  };
}

// ─── Initial State ───
export const INITIAL_STATE: AppState = {
  apiKeyConfigured: false,
  apiKeyProvider: '',
  githubConnected: false,
  githubUsername: '',
  selectedRepo: null,
  repositories: [],
  currentSession: null,
  activeTab: 'settings',
  sidebarCollapsed: false,
  activeWorkspace: null,
  workspaces: [],
  startupError: null,
  // Sprint 12
  executionMode: 'build',
  terminalPanelOpen: false,
  terminalPanelHeight: 250,
};

// ─── State Hook ───
export function useAppState() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [loaded, setLoaded] = useState(false);

  // Load persisted state from main process on mount
  useEffect(() => {
    if (!api || loaded) return;

    const loadState = async () => {
      try {
        const settings = await api.getSettings();

        const hasKey = settings.apiKeys && Object.keys(settings.apiKeys).some(
          (k: string) => settings.apiKeys[k] && settings.apiKeys[k] !== ''
        );
        const provider = hasKey ? Object.keys(settings.apiKeys).find(
          (k: string) => settings.apiKeys[k] && settings.apiKeys[k] !== ''
        ) || '' : '';

        // ─── TASK 2: Startup hydration – load workspaces & last active ───
        let workspaces: WorkspaceInfo[] = [];
        let activeWorkspace: WorkspaceInfo | null = null;
        let currentSession: SessionInfo | null = null;
        let selectedRepo: SelectedRepo | null = null;

        try {
          workspaces = await api.listWorkspaces();
          activeWorkspace = await api.getActiveWorkspace();
        } catch (err) {
          console.warn('[Store] Workspace hydration failed:', err);
        }

        // ─── TASK 3: Session auto-creation from workspace ───
        if (activeWorkspace) {
          const derived = sessionFromWorkspace(activeWorkspace);
          currentSession = derived.session;
          selectedRepo = derived.repo;
        }

        // Determine the best default tab
        let defaultTab: TabId = 'settings';
        if (hasKey && activeWorkspace) {
          defaultTab = 'chat'; // straight to chat if workspace is ready
        } else if (hasKey) {
          defaultTab = 'workspace';
        }

        setState(prev => ({
          ...prev,
          apiKeyConfigured: hasKey,
          apiKeyProvider: provider,
          githubConnected: settings.github?.connected || false,
          activeTab: defaultTab,
          workspaces,
          activeWorkspace,
          currentSession,
          selectedRepo,
          startupError: null,
        }));

        // If GitHub is connected, try loading repos
        if (settings.github?.connected) {
          try {
            const result = await api.listRepos();
            if (result.repos && result.repos.length > 0) {
              setState(prev => ({
                ...prev,
                repositories: result.repos,
                githubConnected: true
              }));
            }
          } catch {
            // GitHub repo load is non-critical
          }
        }
      } catch (err) {
        console.error('[Store] Failed to load persisted state:', err);
        setState(prev => ({
          ...prev,
          startupError: err instanceof Error ? err.message : 'Failed to load state',
        }));
      }
      setLoaded(true);
    };

    loadState();
  }, [loaded]);

  const setApiKey = useCallback((provider: string) => {
    setState(prev => ({
      ...prev,
      apiKeyConfigured: true,
      apiKeyProvider: provider,
      activeTab: prev.activeWorkspace ? 'chat' : 'workspace',
    }));
  }, []);

  const connectGitHub = useCallback((username?: string) => {
    setState(prev => ({
      ...prev,
      githubConnected: true,
      githubUsername: username || ''
    }));
  }, []);

  const disconnectGitHub = useCallback(() => {
    setState(prev => ({
      ...prev,
      githubConnected: false,
      githubUsername: '',
      repositories: [],
      selectedRepo: prev.activeWorkspace ? prev.selectedRepo : null,
      currentSession: prev.activeWorkspace ? prev.currentSession : null,
    }));
  }, []);

  const selectRepo = useCallback((repo: SelectedRepo) => {
    const session: SessionInfo = {
      id: `session-${Date.now()}`,
      repositoryId: repo.id,
      repositoryFullName: repo.fullName,
      workingBranch: repo.defaultBranch,
      status: 'active'
    };
    setState(prev => ({
      ...prev,
      selectedRepo: repo,
      currentSession: session,
      activeTab: 'chat'
    }));
  }, []);

  // ─── TASK 4: Relaxed tab gating ───
  const setTab = useCallback((tab: TabId) => {
    setState(prev => {
      // Always accessible tabs (no workspace or repo needed)
      const alwaysAccessible: TabId[] = ['workspace', 'mcp', 'settings', 'github'];
      if (alwaysAccessible.includes(tab)) {
        return { ...prev, activeTab: tab };
      }
      // Terminal tab now toggles bottom panel instead
      if (tab === 'terminal') {
        return { ...prev, terminalPanelOpen: !prev.terminalPanelOpen };
      }
      // All other tabs only require an active workspace
      if (!prev.activeWorkspace) {
        return { ...prev, activeTab: 'workspace' };
      }
      return { ...prev, activeTab: tab };
    });
  }, []);

  const setRepos = useCallback((repos: RepoInfo[]) => {
    setState(prev => ({ ...prev, repositories: repos }));
  }, []);

  const toggleSidebar = useCallback(() => {
    setState(prev => ({ ...prev, sidebarCollapsed: !prev.sidebarCollapsed }));
  }, []);

  // ─── TASK 1: Workspace activation sets session + repo ───
  const setActiveWorkspace = useCallback((ws: WorkspaceInfo | null) => {
    setState(prev => {
      if (!ws) {
        return {
          ...prev,
          activeWorkspace: null,
          currentSession: null,
          selectedRepo: null,
        };
      }

      const derived = sessionFromWorkspace(ws);
      return {
        ...prev,
        activeWorkspace: ws,
        currentSession: derived.session,
        selectedRepo: derived.repo,
        startupError: null,
      };
    });
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    if (!api) return;
    try {
      const workspaces = await api.listWorkspaces();
      setState(prev => ({ ...prev, workspaces }));
    } catch { /* ignore */ }
  }, []);

  const clearStartupError = useCallback(() => {
    setState(prev => ({ ...prev, startupError: null }));
  }, []);

  // ─── Sprint 12: Execution mode ───
  const setExecutionMode = useCallback((mode: ExecutionMode) => {
    setState(prev => ({ ...prev, executionMode: mode }));
  }, []);

  // ─── Sprint 12: Terminal panel ───
  const toggleTerminalPanel = useCallback(() => {
    setState(prev => ({ ...prev, terminalPanelOpen: !prev.terminalPanelOpen }));
  }, []);

  const setTerminalPanelHeight = useCallback((height: number) => {
    setState(prev => ({ ...prev, terminalPanelHeight: Math.max(100, Math.min(height, window.innerHeight * 0.7)) }));
  }, []);

  const setTerminalPanelOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, terminalPanelOpen: open }));
  }, []);

  return {
    state,
    setApiKey,
    connectGitHub,
    disconnectGitHub,
    selectRepo,
    setTab,
    setRepos,
    toggleSidebar,
    setActiveWorkspace,
    refreshWorkspaces,
    clearStartupError,
    // Sprint 12
    setExecutionMode,
    toggleTerminalPanel,
    setTerminalPanelHeight,
    setTerminalPanelOpen,
  };
}
