/**
 * Application State Store
 * Loads persisted state from Electron main process on startup
 * Uses IPC to sync state changes
 * Sprint 9 fix: workspace activation flow, startup hydration, session auto-creation, relaxed gating
 * Sprint 12: ExecutionMode (plan/build), terminal panel visibility
 */

import { useState, useCallback, useEffect } from 'react';
import type { ThemeId } from '../themes';
import { applyTheme } from '../themes';

// Get electronAPI (available in Electron, undefined in web preview)
const api = (window as any).electronAPI;

// ─── Types ───

export type ExecutionMode = 'plan' | 'build';

export type TabId = 'chat' | 'github' | 'mcp' | 'forge' | 'tasks' | 'roadmap' | 'diff' | 'activity' | 'settings' | 'workspace' | 'terminal' | 'compare';

// ─── Sprint 21: Rate-limit / token-budget types ───
export type AnthropicTier = 'tier1' | 'tier2' | 'tier3' | 'tier4';
export type PresetProfileId = 'safe' | 'balanced' | 'aggressive' | 'custom';
export type RetryStrategy = 'none' | 'linear' | 'exponential';

export interface TokenBudgetSettings {
  maxOutputTokensPerResponse: number;
  maxContextTokensPerRequest: number;
  maxConversationHistoryMessages: number;
  maxToolResultTokensPerTool: number;
  maxToolResultsRetained: number;
  maxParallelToolCalls: number;
  softInputTokensPerMinute: number;
  softOutputTokensPerMinute: number;
  softRequestsPerMinute: number;
  retryStrategy: RetryStrategy;
  retryMaxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  providerTier: AnthropicTier;
  activePresetProfile: PresetProfileId;
}

export type RateLimitSeverity = 'green' | 'amber' | 'red';
export interface RateLimitSnapshot {
  inputTokensLast60s: number;
  outputTokensLast60s: number;
  requestsLast60s: number;
  severity: RateLimitSeverity;
  inputPercent: number;
  outputPercent: number;
  requestPercent: number;
  isPaused: boolean;
  isThrottled: boolean;
  recommendedDelayMs: number;
  lastUpdated: number;
}

export interface RetryState {
  isRetrying: boolean;
  attempt: number;
  maxAttempts: number;
  nextRetryMs: number;
  reason: string;
  gaveUp: boolean;
}

// ─── Sprint 23: Model metadata ───
export interface ModelMeta {
  id: string;
  name: string;
  provider: 'claude' | 'openai' | 'custom';
  supportsTools: boolean;
  supportsStreaming: boolean;
  contextWindow?: number;
  maxOutput?: number;
}

// ─── Sprint 24: Session usage tracking ───
export interface SessionUsage {
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeRequests: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  contextWindowUsed: number;
  contextWindowMax: number;
}

// ─── Sprint 25: Attachment types ───
export type AttachmentType = 'image' | 'document' | 'code' | 'unknown';
export type AttachmentSource = 'drag-drop' | 'clipboard' | 'file-picker' | 'workspace';

export interface AttachmentMeta {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  type: AttachmentType;
  dataUri?: string;
  extractedText?: string;
  thumbnailUri?: string;
  visionTokenEstimate?: number;
  storagePath?: string;
  warnings: string[];
  exifStripped: boolean;
  width?: number;
  height?: number;
  downscaled: boolean;
  addedAt: number;
  source: AttachmentSource;
}

export interface AttachmentConfig {
  maxImageSizeMB: number;
  maxDocSizeMB: number;
  maxTotalSizeMB: number;
  maxFilesPerMessage: number;
  autoDownscaleMaxPx: number;
  stripExif: boolean;
  warnOnSensitiveFiles: boolean;
  enableDragDrop: boolean;
  enableClipboardPaste: boolean;
  enableVision: boolean;
  maxTextChars: number;
}

// ─── Sprint 23: Editor dirty-file tracking ───
export interface EditorDirtyFile {
  filePath: string;
  absolutePath: string;
  isDirty: boolean;
  lastSavedAt?: number;
}

// ─── Sprint 17: Worktree context ───
export interface WorktreeContextInfo {
  isWorktree: boolean;
  isMain: boolean;
  isLinked: boolean;
  branch: string | null;
  head: string;
  mainRoot: string | null;
  currentPath: string;
}

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
  // Sprint 15 theme
  theme: ThemeId;
  // Sprint 16: Model selection + Sandbox monitor
  selectedModel: string;
  availableModels: string[];
  sandboxMonitorOpen: boolean;
  // Sprint 17: Worktree awareness
  worktreeContext: WorktreeContextInfo | null;
  // Sprint 19: File tree, auto-continue, live view
  fileTreeOpen: boolean;
  fileTreeWidth: number;
  autoContinueEnabled: boolean;
  autoContinueMaxIterations: number;
  autoContinueMaxMinutes: number;
  // Sprint 22: Auto-continue enhancements
  autoContinueDebounceMs: number;
  autoContinuePauseOnRisk: boolean;
  autoContinueStopOnRateLimit: boolean;
  autoContinueMaxRetries: number;
  liveViewOpen: boolean;
  liveViewAutoOpen: boolean;
  activeFilePath: string | null;
  highlightedFiles: string[];
  // Sprint 21: Token budget & rate limits
  tokenBudget: TokenBudgetSettings;
  rateLimitSnapshot: RateLimitSnapshot | null;
  retryState: RetryState | null;
  // Sprint 23: Model metadata & editor state
  modelMetaList: ModelMeta[];
  defaultModel: string;
  editorDirtyFiles: Map<string, EditorDirtyFile>;
  editorToast: string;
  // Sprint 24: Session usage tracking
  sessionUsage: SessionUsage;
  // Sprint 25: Attachment config
  attachmentConfig: AttachmentConfig;
  // Sprint 27: Compare workspace
  compareSessionId: string | null;
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
  // Sprint 15
  theme: 'matrix' as ThemeId,
  // Sprint 16
  selectedModel: 'claude-3-5-sonnet-20241022',
  availableModels: [],
  sandboxMonitorOpen: false,
  // Sprint 17
  worktreeContext: null,
  // Sprint 19
  fileTreeOpen: true,
  fileTreeWidth: 260,
  autoContinueEnabled: false,
  autoContinueMaxIterations: 10,
  autoContinueMaxMinutes: 10,
  // Sprint 22
  autoContinueDebounceMs: 300,
  autoContinuePauseOnRisk: true,
  autoContinueStopOnRateLimit: true,
  autoContinueMaxRetries: 2,
  liveViewOpen: false,
  liveViewAutoOpen: true,
  activeFilePath: null,
  highlightedFiles: [],
  // Sprint 21
  tokenBudget: {
    maxOutputTokensPerResponse: 4096,
    maxContextTokensPerRequest: 80_000,
    maxConversationHistoryMessages: 20,
    maxToolResultTokensPerTool: 2500,
    maxToolResultsRetained: 10,
    maxParallelToolCalls: 2,
    softInputTokensPerMinute: 400_000,
    softOutputTokensPerMinute: 14_000,
    softRequestsPerMinute: 45,
    retryStrategy: 'exponential',
    retryMaxRetries: 5,
    retryBaseDelayMs: 1500,
    retryMaxDelayMs: 30000,
    providerTier: 'tier4',
    activePresetProfile: 'balanced',
  },
  rateLimitSnapshot: null,
  retryState: null,
  // Sprint 23
  modelMetaList: [],
  defaultModel: 'claude-3-5-sonnet-20241022',
  editorDirtyFiles: new Map(),
  editorToast: '',
  // Sprint 24
  sessionUsage: {
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    cumulativeRequests: 0,
    lastInputTokens: 0,
    lastOutputTokens: 0,
    contextWindowUsed: 0,
    contextWindowMax: 200_000,
  },
  // Sprint 25
  attachmentConfig: {
    maxImageSizeMB: 20,
    maxDocSizeMB: 10,
    maxTotalSizeMB: 50,
    maxFilesPerMessage: 10,
    autoDownscaleMaxPx: 2048,
    stripExif: true,
    warnOnSensitiveFiles: true,
    enableDragDrop: true,
    enableClipboardPaste: true,
    enableVision: true,
    maxTextChars: 100_000,
  },
  // Sprint 27
  compareSessionId: null,
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

        // ─── Sprint 15: Theme hydration ───
        const savedTheme: ThemeId = (settings.theme as ThemeId) || 'matrix';
        applyTheme(savedTheme);

        // ─── Sprint 17: Worktree context hydration ───
        let worktreeContext: WorktreeContextInfo | null = null;
        if (activeWorkspace && api.worktreeContext) {
          try {
            const ctxResult = await api.worktreeContext();
            if (ctxResult.success && ctxResult.context) {
              worktreeContext = ctxResult.context;
            }
          } catch { /* worktree context is optional */ }
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
          theme: savedTheme,
          worktreeContext,
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
      const alwaysAccessible: TabId[] = ['workspace', 'mcp', 'forge', 'settings', 'github', 'compare'];
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

  // Sprint 16: Model selection
  const setSelectedModel = useCallback((model: string) => {
    setState(prev => ({ ...prev, selectedModel: model }));
    if (api?.setSelectedModel) api.setSelectedModel(model);
  }, []);

  const setAvailableModels = useCallback((models: string[]) => {
    setState(prev => ({ ...prev, availableModels: models }));
  }, []);

  // Sprint 16: Sandbox monitor
  const toggleSandboxMonitor = useCallback(() => {
    setState(prev => ({ ...prev, sandboxMonitorOpen: !prev.sandboxMonitorOpen }));
  }, []);

  const setSandboxMonitorOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, sandboxMonitorOpen: open }));
  }, []);

  // Sprint 17: Worktree context
  const refreshWorktreeContext = useCallback(async () => {
    if (!api?.worktreeContext) return;
    try {
      const result = await api.worktreeContext();
      if (result.success) {
        setState(prev => ({ ...prev, worktreeContext: result.context }));
      }
    } catch { /* ignore */ }
  }, []);

  const setWorktreeContext = useCallback((ctx: WorktreeContextInfo | null) => {
    setState(prev => ({ ...prev, worktreeContext: ctx }));
  }, []);

  // Sprint 19: File tree
  const setFileTreeOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, fileTreeOpen: open }));
  }, []);

  const setFileTreeWidth = useCallback((width: number) => {
    setState(prev => ({ ...prev, fileTreeWidth: Math.max(180, Math.min(600, width)) }));
  }, []);

  // Sprint 19: Auto-continue
  const setAutoContinueEnabled = useCallback((enabled: boolean) => {
    setState(prev => ({ ...prev, autoContinueEnabled: enabled }));
  }, []);

  const setAutoContinueMaxIterations = useCallback((n: number) => {
    setState(prev => ({ ...prev, autoContinueMaxIterations: Math.max(1, Math.min(50, n)) }));
  }, []);

  const setAutoContinueMaxMinutes = useCallback((n: number) => {
    setState(prev => ({ ...prev, autoContinueMaxMinutes: Math.max(1, Math.min(60, n)) }));
  }, []);

  // Sprint 19: Live view
  const setLiveViewOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, liveViewOpen: open }));
  }, []);

  const setLiveViewAutoOpen = useCallback((autoOpen: boolean) => {
    setState(prev => ({ ...prev, liveViewAutoOpen: autoOpen }));
  }, []);

  const setActiveFilePath = useCallback((path: string | null) => {
    setState(prev => ({ ...prev, activeFilePath: path }));
  }, []);

  const addHighlightedFile = useCallback((path: string) => {
    setState(prev => ({
      ...prev,
      highlightedFiles: prev.highlightedFiles.includes(path) ? prev.highlightedFiles : [...prev.highlightedFiles, path],
    }));
  }, []);

  const clearHighlightedFiles = useCallback(() => {
    setState(prev => ({ ...prev, highlightedFiles: [] }));
  }, []);

  // Sprint 21: Token budget & rate limits
  const setTokenBudget = useCallback((budget: Partial<TokenBudgetSettings>) => {
    setState(prev => ({ ...prev, tokenBudget: { ...prev.tokenBudget, ...budget } }));
  }, []);

  const setRateLimitSnapshot = useCallback((snapshot: RateLimitSnapshot | null) => {
    setState(prev => ({ ...prev, rateLimitSnapshot: snapshot }));
  }, []);

  const setRetryState = useCallback((retryState: RetryState | null) => {
    setState(prev => ({ ...prev, retryState }));
  }, []);

  // Sprint 23: Model metadata
  const setModelMetaList = useCallback((models: ModelMeta[]) => {
    setState(prev => ({ ...prev, modelMetaList: models }));
  }, []);

  const setDefaultModel = useCallback((model: string) => {
    setState(prev => ({ ...prev, defaultModel: model }));
    if (api?.setDefaultModel) api.setDefaultModel(model);
  }, []);

  // Sprint 23: Editor dirty file tracking
  const setEditorDirtyFile = useCallback((filePath: string, isDirty: boolean, absolutePath?: string) => {
    setState(prev => {
      const newMap = new Map(prev.editorDirtyFiles);
      if (isDirty) {
        newMap.set(filePath, { filePath, absolutePath: absolutePath || filePath, isDirty: true });
      } else {
        newMap.delete(filePath);
      }
      return { ...prev, editorDirtyFiles: newMap };
    });
  }, []);

  const setEditorToast = useCallback((msg: string) => {
    setState(prev => ({ ...prev, editorToast: msg }));
    if (msg) setTimeout(() => setState(prev => ({ ...prev, editorToast: '' })), 3000);
  }, []);

  // Sprint 24: Session usage
  const setSessionUsage = useCallback((usage: SessionUsage) => {
    setState(prev => ({ ...prev, sessionUsage: usage }));
  }, []);

  // Sprint 25: Attachment config
  const setAttachmentConfig = useCallback((config: AttachmentConfig) => {
    setState(prev => ({ ...prev, attachmentConfig: config }));
    if (api?.setAttachmentConfig) api.setAttachmentConfig(config);
  }, []);

  // Sprint 27: Compare workspace
  const openCompareWorkspace = useCallback((sessionId: string) => {
    setState(prev => ({ ...prev, compareSessionId: sessionId, activeTab: 'compare' as TabId }));
  }, []);

  const closeCompareWorkspace = useCallback(() => {
    setState(prev => ({ ...prev, compareSessionId: null, activeTab: 'chat' as TabId }));
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
    // Sprint 16
    setSelectedModel,
    setAvailableModels,
    toggleSandboxMonitor,
    setSandboxMonitorOpen,
    // Sprint 17
    refreshWorktreeContext,
    setWorktreeContext,
    // Sprint 19
    setFileTreeOpen,
    setFileTreeWidth,
    setAutoContinueEnabled,
    setAutoContinueMaxIterations,
    setAutoContinueMaxMinutes,
    setLiveViewOpen,
    setLiveViewAutoOpen,
    setActiveFilePath,
    addHighlightedFile,
    clearHighlightedFiles,
    // Sprint 21
    setTokenBudget,
    setRateLimitSnapshot,
    setRetryState,
    // Sprint 23
    setModelMetaList,
    setDefaultModel,
    setEditorDirtyFile,
    setEditorToast,
    // Sprint 24
    setSessionUsage,
    // Sprint 25
    setAttachmentConfig,
    // Sprint 27
    openCompareWorkspace,
    closeCompareWorkspace,
  };
}
