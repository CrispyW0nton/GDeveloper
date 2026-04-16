import React, { useEffect } from 'react';
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
import WorkspacePanel from './components/workspace/WorkspacePanel';
import TerminalPanel from './components/terminal/TerminalPanel';
import BottomPanel from './components/common/BottomPanel';
import SandboxMonitor from './components/sandbox/SandboxMonitor';

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
  } = useAppState();
  const { showMatrixRain, showCrtOverlay } = useTheme();

  // Global Ctrl+` handler for toggling terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' && e.ctrlKey) {
        e.preventDefault();
        toggleTerminalPanel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleTerminalPanel]);

  /**
   * Build repo display from activeWorkspace (preferred) or selectedRepo.
   * Used by Chat, Diff, Activity which need a repo-like object.
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
            }}
            onRefreshWorkspaces={refreshWorkspaces}
          />
        );

      case 'chat':
        // Chat needs a session and repo — both are auto-created from workspace
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
            />
          );
        }
        return (
          <EmptyState
            icon="chat"
            title="No workspace active"
            subtitle="Activate a workspace to start chatting with the AI coding assistant."
            actionLabel="Go to Workspaces"
            onAction={() => setTab('workspace')}
          />
        );

      case 'terminal':
        // Terminal tab now opens bottom panel instead — but keep fallback
        return <TerminalPanel activeWorkspace={state.activeWorkspace} />;

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
            subtitle="Tasks are created automatically when you chat with the AI. Activate a workspace and start coding."
            actionLabel="Go to Workspaces"
            onAction={() => setTab('workspace')}
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
            subtitle="Diffs appear after the AI modifies files in your workspace."
            actionLabel="Go to Workspaces"
            onAction={() => setTab('workspace')}
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
            subtitle="Activity events are logged as you use the platform — chat, tools, git, MCP."
            actionLabel="Go to Workspaces"
            onAction={() => setTab('workspace')}
          />
        );

      case 'settings':
        return (
          <SettingsPanel
            onApiKeySet={setApiKey}
            selectedModel={state.selectedModel}
            availableModels={state.availableModels}
            onModelChange={setSelectedModel}
          />
        );

      default:
        return null;
    }
  };

  return (
    <>
      {/* Matrix Rain Canvas Background — only rendered for Matrix theme */}
      {showMatrixRain && <MatrixRainCanvas opacity={0.38} fontSize={14} color="#00ff41" speed={33} />}

      {/* CRT Scanline Overlay — only rendered for Matrix theme */}
      {showCrtOverlay && <div className="crt-overlay" />}

      {/* Startup Error Banner */}
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
        />

        {/* Main content area + bottom terminal panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-hidden animate-fadeIn">
            {renderMainContent()}
          </main>

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

// ─── TASK 5: Matrix-themed empty state component ───

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
}: {
  icon: string;
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
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
      </div>
    </div>
  );
}
