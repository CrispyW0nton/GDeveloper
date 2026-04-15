/**
 * Application State Store
 * Loads persisted state from Electron main process on startup
 * Uses IPC to sync state changes
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
}

export type TabId = 'chat' | 'github' | 'mcp' | 'tasks' | 'roadmap' | 'diff' | 'activity' | 'settings';

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

// ─── Initial State ───
export const INITIAL_STATE: AppState = {
  apiKeyConfigured: false,
  apiKeyProvider: '',
  githubConnected: false,
  githubUsername: '',
  selectedRepo: null,
  repositories: [],
  currentSession: null,
  activeTab: 'settings', // Start on settings if no API key
  sidebarCollapsed: false
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

        // Check if any API key is configured
        const hasKey = settings.apiKeys && Object.keys(settings.apiKeys).some(
          (k: string) => settings.apiKeys[k] && settings.apiKeys[k] !== ''
        );
        const provider = hasKey ? Object.keys(settings.apiKeys).find(
          (k: string) => settings.apiKeys[k] && settings.apiKeys[k] !== ''
        ) || '' : '';

        setState(prev => ({
          ...prev,
          apiKeyConfigured: hasKey,
          apiKeyProvider: provider,
          githubConnected: settings.github?.connected || false,
          activeTab: hasKey ? (settings.github?.connected ? 'github' : 'github') : 'settings'
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
      activeTab: prev.githubConnected ? 'github' : 'github'
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
      if (!prev.selectedRepo && !['github', 'mcp', 'settings'].includes(tab)) {
        return { ...prev, activeTab: 'github' };
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

  return {
    state,
    setApiKey,
    connectGitHub,
    disconnectGitHub,
    selectRepo,
    setTab,
    setRepos,
    toggleSidebar
  };
}
