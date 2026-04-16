/**
 * Application State Store
 * Loads persisted state from Electron main process on startup
 * Uses IPC to sync state changes
 * Sprint 9: + workspace, git status, terminal state
 */

import { useState, useCallback, useEffect } from 'react';

// Get electronAPI (available in Electron, undefined in web preview)
const api = (window as any).electronAPI;

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
  // Sprint 9
  activeWorkspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
}

export type TabId = 'chat' | 'github' | 'mcp' | 'tasks' | 'roadmap' | 'diff' | 'activity' | 'settings' | 'workspace' | 'terminal';

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

        // Load workspaces
        let workspaces: WorkspaceInfo[] = [];
        let activeWorkspace: WorkspaceInfo | null = null;
        try {
          workspaces = await api.listWorkspaces();
          activeWorkspace = await api.getActiveWorkspace();
        } catch { /* ignore if not available */ }

        setState(prev => ({
          ...prev,
          apiKeyConfigured: hasKey,
          apiKeyProvider: provider,
          githubConnected: settings.github?.connected || false,
          activeTab: hasKey ? 'workspace' : 'settings',
          workspaces,
          activeWorkspace,
        }));

        // If GitHub is connected, try loading repos
        if (settings.github?.connected) {
          const result = await api.listRepos();
          if (result.repos && result.repos.length > 0) {
            setState(prev => ({
              ...prev,
              repositories: result.repos,
              githubConnected: true
            }));
          }
        }
      } catch (err) {
        console.error('[Store] Failed to load persisted state:', err);
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
      activeTab: 'workspace'
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
      selectedRepo: null,
      currentSession: null
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

  const setTab = useCallback((tab: TabId) => {
    setState(prev => {
      // workspace, mcp, settings, github, terminal are always accessible
      const alwaysAccessible: TabId[] = ['workspace', 'mcp', 'settings', 'github', 'terminal'];
      if (!prev.activeWorkspace && !prev.selectedRepo && !alwaysAccessible.includes(tab)) {
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

  const setActiveWorkspace = useCallback((ws: WorkspaceInfo | null) => {
    setState(prev => {
      // Create a session for the workspace
      let currentSession = prev.currentSession;
      let selectedRepo = prev.selectedRepo;

      if (ws) {
        currentSession = {
          id: `session-ws-${ws.id}-${Date.now()}`,
          repositoryId: ws.id,
          repositoryFullName: ws.github_owner && ws.github_repo ? `${ws.github_owner}/${ws.github_repo}` : ws.name,
          workingBranch: ws.default_branch || 'main',
          status: 'active'
        };
        selectedRepo = {
          id: ws.id,
          fullName: ws.github_owner && ws.github_repo ? `${ws.github_owner}/${ws.github_repo}` : ws.name,
          defaultBranch: ws.default_branch || 'main',
          isPrivate: false,
        };
      }

      return {
        ...prev,
        activeWorkspace: ws,
        currentSession,
        selectedRepo,
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
    refreshWorkspaces
  };
}
