/**
 * Application State Store
 * Lightweight state management for the GDeveloper UI
 */

import { useState, useCallback } from 'react';

// ─── App State Interface ───
export interface AppState {
  // Auth & Config
  apiKeyConfigured: boolean;
  apiKeyProvider: string;

  // GitHub
  githubConnected: boolean;
  selectedRepo: SelectedRepo | null;
  repositories: RepoInfo[];

  // Session
  currentSession: SessionInfo | null;

  // UI
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
  selectedRepo: null,
  repositories: [],
  currentSession: null,
  activeTab: 'github',
  sidebarCollapsed: false
};

// ─── State Hook ───
export function useAppState() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);

  const setApiKey = useCallback((provider: string) => {
    setState(prev => ({
      ...prev,
      apiKeyConfigured: true,
      apiKeyProvider: provider
    }));
  }, []);

  const connectGitHub = useCallback(() => {
    setState(prev => ({
      ...prev,
      githubConnected: true
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
      // Gate certain tabs behind repo selection
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
    selectRepo,
    setTab,
    setRepos,
    toggleSidebar
  };
}
