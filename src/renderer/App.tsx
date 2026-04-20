/**
 * App — Root application component
 * Sprint 19: adds right-side FileTreePanel, Live Code View,
 * and wires file highlight state.
 * Sprint 20: Real-time theme editing, Matrix rain hue control.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAppState, TabId } from './store';
import { ThemeProvider, useTheme } from './themes/ThemeContext';
import Sidebar from './components/common/Sidebar';
import ChatWorkspace from './components/chat/ChatWorkspace';
import GitHubPanel from './components/github/GitHubPanel';
import MCPServersPanel from './components/mcp/MCPServersPanel';
import McpForgePanel from './components/mcp/McpForgePanel';
import TaskLedgerPanel from './components/tasks/TaskLedgerPanel';
import DiffViewer from './components/diff/DiffViewer';
import ActivityLog from './components/activity/ActivityLog';
import SettingsPanel from './components/settings/SettingsPanel';
import MatrixRainCanvas from './components/common/MatrixRainCanvas';
import BackdropRenderer from './components/background/BackdropRenderer';
import WorkspacePanel from './components/workspace/WorkspacePanel';
import TerminalPanel from './components/terminal/TerminalPanel';
import BottomPanel from './components/common/BottomPanel';
import SandboxMonitor from './components/sandbox/SandboxMonitor';
import FileTreePanel from './components/fileTree/FileTreePanel';
import LiveCodeView, { type FileViewState } from './components/liveView/LiveCodeView';
import CompareWorkspace from './components/compare/CompareWorkspace';
import DevConsolePanel from './components/devConsole/DevConsolePanel';
import type { ModelMeta } from './store';

const api = (window as any).electronAPI;

export default function App() {
  return (
    <ThemeProvider initialTheme="matrix">
      <AppInner />
    </ThemeProvider>
  );
}

function AppInner() {
  const {
    state, setApiKey, connectGitHub, disconnectGitHub, selectRepo,
    setTab, setRepos, toggleSidebar, setActiveWorkspace, refreshWorkspaces,
    clearStartupError, setExecutionMode, toggleTerminalPanel,
    setTerminalPanelHeight, setTerminalPanelOpen,
    setSelectedModel, toggleSandboxMonitor, setSandboxMonitorOpen,
    refreshWorktreeContext,
    // Sprint 19
    setFileTreeOpen, setFileTreeWidth,
    // Sprint 28: setAutoContinueEnabled removed
    setLiveViewOpen, setLiveViewAutoOpen,
    setActiveFilePath, addHighlightedFile, clearHighlightedFiles,
    // Sprint 21
    setTokenBudget, setRateLimitSnapshot, setRetryState,
    // Sprint 23
    setModelMetaList, setDefaultModel: setDefaultModelAction,
    setEditorDirtyFile, setEditorToast,
    // Sprint 24
    setSessionUsage,
    // Sprint 25
    setAttachmentConfig,
    // Sprint 27
    openCompareWorkspace, closeCompareWorkspace,
  } = useAppState();
  const {
    showMatrixRain, showCrtOverlay,
    backdropType, backdropOpacity, backdropIntensity, matrixRainEnabled, crtOverlayEnabled,
    activePreset,
    matrixRainHue, // Sprint 20
  } = useTheme();

  // Sprint 25: Vision support tracking
  const [visionSupported, setVisionSupported] = useState<boolean>(true);

  // Sprint 30: Dev Console panel state
  const [devConsoleOpen, setDevConsoleOpen] = useState(false);

  // Sprint 25.5: Model refresh state
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const handleRefreshModels = useCallback(async () => {
    if (!api?.refreshModels) return;
    setIsRefreshingModels(true);
    try {
      const result = await api.refreshModels();
      if (result?.success && result.models) {
        setModelMetaList(result.models);
        if (result.selectedModel) {
          setSelectedModel(result.selectedModel);
        }
      }
    } catch (err) {
      console.warn('[App] Model refresh failed:', err);
    } finally {
      setIsRefreshingModels(false);
    }
  }, [setModelMetaList, setSelectedModel]);

  // Sprint 19: Live Code View state
  const [liveFile, setLiveFile] = useState<FileViewState | null>(null);
  const [recentLiveFiles, setRecentLiveFiles] = useState<FileViewState[]>([]);
  const [editProgress, setEditProgress] = useState<string>('');

  // Sprint 23 + Sprint 25.5: Load model metadata on startup via discovery API
  useEffect(() => {
    if (!api) return;
    // Use discoverModels (dynamic) instead of getModelMetaList (static)
    const loadModels = async () => {
      try {
        // First try dynamic discovery
        if (api.discoverModels) {
          const discovered = await api.discoverModels();
          if (discovered && discovered.length > 0) {
            setModelMetaList(discovered);
          }
        } else if (api.getModelMetaList) {
          const models = await api.getModelMetaList();
          if (models && models.length > 0) {
            setModelMetaList(models);
          }
        }
      } catch { /* fallback to empty */ }

      // Also load and validate default model
      try {
        if (api.validateSelectedModel) {
          const result = await api.validateSelectedModel();
          if (result?.model) setSelectedModel(result.model);
          if (result?.availableModels?.length > 0) setModelMetaList(result.availableModels);
        } else if (api.getDefaultModel) {
          const model = await api.getDefaultModel();
          if (model) setDefaultModelAction(model);
        }
      } catch { /* ignore */ }
    };

    loadModels();
  }, [state.apiKeyConfigured, state.apiKeyProvider, setModelMetaList, setDefaultModelAction, setSelectedModel]);

  // Sprint 25: Check vision support when model changes
  useEffect(() => {
    if (!api?.checkVisionSupport) return;
    api.checkVisionSupport(state.selectedModel).then((result: any) => {
      setVisionSupported(result?.supportsVision ?? true);
    }).catch(() => setVisionSupported(true));
  }, [state.selectedModel]);

  // Sprint 25: Load attachment config on startup
  useEffect(() => {
    if (!api?.getAttachmentConfig) return;
    api.getAttachmentConfig().then((config: any) => {
      if (config) setAttachmentConfig(config);
    }).catch(() => {});
  }, [setAttachmentConfig]);

  // Sprint 21: Subscribe to rate-limit and retry-state updates from main process
  useEffect(() => {
    if (!api?.onRateLimitUpdate) return;
    const unsubRL = api.onRateLimitUpdate((data: any) => setRateLimitSnapshot(data));
    return () => { if (unsubRL) unsubRL(); };
  }, [setRateLimitSnapshot]);

  useEffect(() => {
    if (!api?.onRetryStateUpdate) return;
    const unsubRS = api.onRetryStateUpdate((data: any) => setRetryState(data));
    return () => { if (unsubRS) unsubRS(); };
  }, [setRetryState]);

  // Sprint 17: Refresh worktree context when workspace changes
  useEffect(() => {
    if (state.activeWorkspace) {
      refreshWorktreeContext();
    }
  }, [state.activeWorkspace?.id, refreshWorktreeContext]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+` — toggle terminal
      if (e.key === '`' && e.ctrlKey) {
        e.preventDefault();
        toggleTerminalPanel();
      }
      // Ctrl+B — toggle file tree
      if (e.key === 'b' && e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        setFileTreeOpen(!state.fileTreeOpen);
      }
      // Ctrl+Shift+D — toggle Dev Console (Sprint 30)
      if (e.key === 'D' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        setDevConsoleOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleTerminalPanel, state.fileTreeOpen, setFileTreeOpen]);

  // Sprint 19: Listen for file-change events from main (live view updates)
  useEffect(() => {
    if (!api?.onFileChanged) return;
    const unsubscribe = api.onFileChanged((data: any) => {
      if (data.filePath) {
        addHighlightedFile(data.filePath);
        // Auto-open live view if configured
        if (state.liveViewAutoOpen && !state.liveViewOpen) {
          setLiveViewOpen(true);
        }
        // Load file content for live view
        loadFileForLiveView(data.filePath, data.absolutePath, data.toolName);
      }
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [state.liveViewAutoOpen, state.liveViewOpen, addHighlightedFile, setLiveViewOpen]);

  // Sprint 19: Listen for sandbox events to detect file edits
  useEffect(() => {
    if (!api?.onSandboxEvent) return;
    const unsubscribe = api.onSandboxEvent((data: any) => {
      if (data.type === 'file_edit' && data.detail) {
        // Extract file path from the sandbox event detail
        try {
          const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
          const pathMatch = detail.match(/(?:path|file_path)['":\s]+([^\s'"]+)/);
          if (pathMatch) {
            addHighlightedFile(pathMatch[1]);
          }
        } catch { /* ignore */ }
      }
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [addHighlightedFile]);

  // Load file content for live view
  const loadFileForLiveView = useCallback(async (filePath: string, absolutePath: string, toolName?: string) => {
    if (!api?.readFileContent) return;
    try {
      const result = await api.readFileContent(absolutePath || filePath);
      const fileState: FileViewState = {
        filePath,
        absolutePath: absolutePath || filePath,
        content: result.content,
        isBinary: result.isBinary,
        isTooLarge: result.isTooLarge,
        size: result.size || 0,
        lastTool: toolName,
        isBeingEdited: true,
        timestamp: Date.now(),
      };
      setLiveFile(fileState);
      setActiveFilePath(filePath);
      // Update recent files list
      setRecentLiveFiles(prev => {
        const filtered = prev.filter(f => f.filePath !== filePath);
        return [fileState, ...filtered].slice(0, 10);
      });
    } catch { /* ignore read errors */ }
  }, [setActiveFilePath]);

  // Handle file selection from file tree
  const handleFileTreeSelect = useCallback((filePath: string, absolutePath: string) => {
    setActiveFilePath(filePath);
    loadFileForLiveView(filePath, absolutePath);
    setLiveViewOpen(true);
  }, [setActiveFilePath, loadFileForLiveView, setLiveViewOpen]);

  // Handle switching files in live view
  const handleLiveFileSwitch = useCallback((filePath: string) => {
    const recent = recentLiveFiles.find(f => f.filePath === filePath);
    if (recent) {
      setLiveFile(recent);
      setActiveFilePath(filePath);
    }
  }, [recentLiveFiles, setActiveFilePath]);

  /**
   * Build repo display from activeWorkspace (preferred) or selectedRepo.
   */
  const repoDisplay = state.activeWorkspace
    ? {
        id: state.activeWorkspace.id,
        fullName: state.activeWorkspace.github_owner && state.activeWorkspace.github_repo
          ? `${state.activeWorkspace.github_owner}/${state.activeWorkspace.github_repo}`
          : state.activeWorkspace.name,
        defaultBranch: state.activeWorkspace.default_branch || 'main',
        isPrivate: false,
      }
    : state.selectedRepo;

  // Worktree label for file tree
  const worktreeLabel = state.worktreeContext
    ? state.worktreeContext.isMain ? 'Main' : `Linked: ${state.worktreeContext.branch || 'detached'}`
    : undefined;

  const highlightedSet = new Set(state.highlightedFiles);

  const renderMainContent = () => {
    // If no API key, show settings first
    if (!state.apiKeyConfigured && state.activeTab !== 'settings') {
      return <SettingsPanel onApiKeySet={setApiKey} selectedModel={state.selectedModel} availableModels={state.availableModels} onModelChange={setSelectedModel} />;
    }

    switch (state.activeTab) {
      case 'workspace':
        return (
          <WorkspacePanel
            activeWorkspace={state.activeWorkspace}
            workspaces={state.workspaces}
            githubConnected={state.githubConnected}
            onWorkspaceActivated={(ws) => {
              setActiveWorkspace(ws);
              refreshWorkspaces();
              clearHighlightedFiles();
            }}
            onRefreshWorkspaces={refreshWorkspaces}
          />
        );

      case 'chat':
        if (state.currentSession && repoDisplay) {
          return (
            <ChatWorkspace
              session={state.currentSession}
              repo={repoDisplay}
              providerKey={state.apiKeyProvider}
              executionMode={state.executionMode}
              onModeChange={setExecutionMode}
              selectedModel={state.selectedModel}
              availableModels={state.availableModels}
              onModelChange={setSelectedModel}
              worktreeContext={state.worktreeContext}
              rateLimitSnapshot={state.rateLimitSnapshot}
              retryState={state.retryState}
              softInputLimit={state.tokenBudget.softInputTokensPerMinute}
              softOutputLimit={state.tokenBudget.softOutputTokensPerMinute}
              softRequestLimit={state.tokenBudget.softRequestsPerMinute}
              modelMetaList={state.modelMetaList}
              defaultModel={state.defaultModel}
              onSetDefaultModel={setDefaultModelAction}
              apiKeyConfigured={state.apiKeyConfigured}
              sessionUsage={state.sessionUsage}
              onSessionUsageUpdate={setSessionUsage}
              attachmentConfig={state.attachmentConfig}
              visionSupported={visionSupported}
              onRefreshModels={handleRefreshModels}
              isRefreshingModels={isRefreshingModels}
              onOpenCompareWorkspace={openCompareWorkspace}
              onOpenMCPSettings={() => setTab('mcp')}
            />
          );
        }
        return (
          <EmptyState
            icon="chat"
            title="Ready to code"
            subtitle="Open a project to start chatting with Claude. It can read your files, write code, run commands, and commit changes."
            actionLabel="Open a Project"
            onAction={() => setTab('workspace')}
            hint="Tip: Clone a GitHub repo or open a local folder from the Workspaces tab."
          />
        );

      case 'terminal':
        return <TerminalPanel activeWorkspace={state.activeWorkspace} />;

      case 'compare':
        if (state.compareSessionId) {
          return <CompareWorkspace sessionId={state.compareSessionId} onClose={closeCompareWorkspace} />;
        }
        return (
          <div className="h-full flex items-center justify-center text-matrix-text-muted/50 text-sm">
            No active compare session. Use <code className="bg-matrix-bg-elevated px-1.5 py-0.5 rounded mx-1">/compare-file</code> or <code className="bg-matrix-bg-elevated px-1.5 py-0.5 rounded mx-1">/compare-folder</code> from chat.
          </div>
        );

      case 'github':
        return (
          <GitHubPanel
            connected={state.githubConnected}
            selectedRepo={state.selectedRepo}
            onConnect={connectGitHub}
            onSelectRepo={selectRepo}
            onReposLoaded={setRepos}
          />
        );

      case 'mcp':
        return <MCPServersPanel />;

      case 'forge':
        return <McpForgePanel />;

      case 'tasks':
        if (state.currentSession) {
          return <TaskLedgerPanel sessionId={state.currentSession.id} />;
        }
        return (
          <EmptyState
            icon="tasks"
            title="No tasks yet"
            subtitle="Tasks are created automatically as you chat with the AI. Start a conversation and GDeveloper will break your requests into trackable tasks."
            actionLabel="Start Chatting"
            onAction={() => setTab(state.activeWorkspace ? 'chat' : 'workspace')}
            hint="Tasks help you track what the AI is doing and what's been completed."
          />
        );

      case 'diff':
        if (repoDisplay) {
          return <DiffViewer repo={repoDisplay} sessionId={state.currentSession?.id} />;
        }
        return (
          <EmptyState
            icon="diff"
            title="No file changes yet"
            subtitle="When the AI writes or edits files, the before/after diff shows up here. You can also toggle a live git diff view."
            actionLabel="Start Building"
            onAction={() => setTab(state.activeWorkspace ? 'chat' : 'workspace')}
            hint='Try asking the AI to "add error handling" or "write tests" to see diffs appear.'
          />
        );

      case 'activity':
        if (repoDisplay) {
          return <ActivityLog sessionId={state.currentSession?.id || ''} repo={repoDisplay} />;
        }
        return (
          <EmptyState
            icon="activity"
            title="No activity yet"
            subtitle="Every action is logged here: chats, tool calls, git operations, MCP events. This is your audit trail."
            actionLabel="Start Chatting"
            onAction={() => setTab(state.activeWorkspace ? 'chat' : 'workspace')}
            hint="Use /verify-last to cross-check the AI's claims against actual file changes."
          />
        );

      case 'settings':
        return (
          <SettingsPanel
            onApiKeySet={setApiKey}
            selectedModel={state.selectedModel}
            availableModels={state.availableModels}
            onModelChange={setSelectedModel}
            tokenBudget={state.tokenBudget}
            onTokenBudgetChange={setTokenBudget}
            attachmentConfig={state.attachmentConfig}
            onAttachmentConfigChange={setAttachmentConfig}
          />
        );

      default:
        return null;
    }
  };

  // Determine if file tree / live view should show (only when workspace is active)
  const showRightPanel = state.activeWorkspace && (state.fileTreeOpen || state.liveViewOpen);

  return (
    <>
      <BackdropRenderer
        type={backdropType}
        opacity={backdropOpacity}
        intensity={backdropIntensity}
        enabled={backdropType !== 'none'}
        accentColor={activePreset?.tokens?.accent || '#00ff41'}
        matrixRainHue={matrixRainHue}
      />

      {matrixRainEnabled && backdropType !== 'matrix-rain' && (
        <MatrixRainCanvas opacity={0.2} fontSize={14} color={activePreset?.tokens?.accent || '#00ff41'} speed={33} rainHue={matrixRainHue} />
      )}

      {crtOverlayEnabled && <div className="crt-overlay" />}

      {state.startupError && (
        <div className="fixed top-0 left-0 right-0 z-50 px-4 py-2 text-xs flex items-center justify-between"
             style={{ background: 'rgba(127, 29, 29, 0.92)', color: '#fecaca' }}>
          <span>Startup error: {state.startupError}</span>
          <button onClick={clearStartupError} className="ml-4 opacity-70 hover:opacity-100 transition-opacity">Dismiss</button>
        </div>
      )}

      {/* App Container */}
      <div className="app-container">
        <Sidebar
          activeTab={state.activeTab}
          onTabChange={setTab}
          repoSelected={!!state.selectedRepo}
          githubConnected={state.githubConnected}
          apiKeyConfigured={state.apiKeyConfigured}
          selectedRepo={state.selectedRepo}
          collapsed={state.sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          activeWorkspace={state.activeWorkspace}
          terminalOpen={state.terminalPanelOpen}
          sandboxMonitorOpen={state.sandboxMonitorOpen}
          onToggleSandboxMonitor={toggleSandboxMonitor}
          executionMode={state.executionMode}
          devConsoleOpen={devConsoleOpen}
          onToggleDevConsole={() => setDevConsoleOpen(prev => !prev)}
        />

        {/* Sprint 30: Dev Console panel (left side) */}
        {devConsoleOpen && (
          <DevConsolePanel
            visible={devConsoleOpen}
            onClose={() => setDevConsoleOpen(false)}
          />
        )}

        {/* Main content area + right panel + bottom terminal */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex overflow-hidden">
            {/* Main content */}
            <main className="flex-1 overflow-hidden animate-fadeIn">
              {renderMainContent()}
            </main>

            {/* Sprint 19: Right-side panels (file tree + live view) */}
            {showRightPanel && (
              <div className="flex h-full flex-shrink-0">
                {/* Live Code View (stacked above file tree when both open) */}
                {state.liveViewOpen && liveFile && (
                  <div
                    className="border-l border-matrix-border/20 flex-shrink-0"
                    style={{ width: Math.max(300, state.fileTreeWidth + 40) }}
                  >
                    <LiveCodeView
                      visible={state.liveViewOpen}
                      currentFile={liveFile}
                      recentFiles={recentLiveFiles}
                      onFileSwitch={handleLiveFileSwitch}
                      onClose={() => setLiveViewOpen(false)}
                      editProgress={editProgress}
                      workspaceRoot={state.activeWorkspace?.local_path}
                      onDirtyStateChange={(fp, dirty) => setEditorDirtyFile(fp, dirty)}
                      toastMessage={state.editorToast}
                      onToast={setEditorToast}
                    />
                  </div>
                )}

                {/* File Tree Panel */}
                {state.fileTreeOpen && (
                  <FileTreePanel
                    visible={state.fileTreeOpen}
                    workspaceName={state.activeWorkspace?.name}
                    worktreeLabel={worktreeLabel}
                    width={state.fileTreeWidth}
                    onWidthChange={setFileTreeWidth}
                    onClose={() => setFileTreeOpen(false)}
                    onFileSelect={handleFileTreeSelect}
                    highlightedFiles={highlightedSet}
                    activeFilePath={state.activeFilePath}
                  />
                )}
              </div>
            )}
          </div>

          {/* Bottom Terminal Panel — persists across tab switches */}
          <BottomPanel
            open={state.terminalPanelOpen}
            height={state.terminalPanelHeight}
            onHeightChange={setTerminalPanelHeight}
            onClose={() => setTerminalPanelOpen(false)}
          >
            <div className="flex h-full">
              <div className={`${state.sandboxMonitorOpen ? 'w-1/2' : 'w-full'} h-full overflow-hidden`}>
                <TerminalPanel
                  activeWorkspace={state.activeWorkspace}
                  onClose={() => setTerminalPanelOpen(false)}
                />
              </div>
              {state.sandboxMonitorOpen && (
                <div className="w-1/2 h-full border-l border-matrix-border/20 overflow-hidden">
                  <SandboxMonitor onClose={() => setSandboxMonitorOpen(false)} />
                </div>
              )}
            </div>
          </BottomPanel>
        </div>
      </div>
    </>
  );
}

// ─── Matrix-themed empty state component ───

const EMPTY_ICONS: Record<string, React.ReactNode> = {
  chat: (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  tasks: (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  diff: (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto">
      <path d="M12 3v18M3 12h18" />
    </svg>
  ),
  activity: (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  workspace: (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  ),
};

function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  hint,
}: {
  icon: string;
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
  hint?: string;
}) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="glass-panel p-8 max-w-md text-center">
        <div className="text-matrix-text-muted/20 mb-4">
          {EMPTY_ICONS[icon] || EMPTY_ICONS.workspace}
        </div>
        <h3 className="text-sm font-bold text-matrix-green glow-text-dim mb-2">{title}</h3>
        <p className="text-matrix-text-dim text-xs mb-4 leading-relaxed">{subtitle}</p>
        {actionLabel && onAction && (
          <button onClick={onAction} className="matrix-btn matrix-btn-primary text-xs">
            {actionLabel}
          </button>
        )}
        {hint && (
          <p className="text-[10px] text-matrix-text-muted/30 mt-3 leading-relaxed">{hint}</p>
        )}
      </div>
    </div>
  );
}
