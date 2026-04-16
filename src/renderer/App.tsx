import React from 'react';
import { useAppState, TabId } from './store';
import Sidebar from './components/common/Sidebar';
import ChatWorkspace from './components/chat/ChatWorkspace';
import GitHubPanel from './components/github/GitHubPanel';
import MCPServersPanel from './components/mcp/MCPServersPanel';
import TaskLedgerPanel from './components/tasks/TaskLedgerPanel';
import DiffViewer from './components/diff/DiffViewer';
import ActivityLog from './components/activity/ActivityLog';
import SettingsPanel from './components/settings/SettingsPanel';
import MatrixRainCanvas from './components/common/MatrixRainCanvas';
import WorkspacePanel from './components/workspace/WorkspacePanel';
import TerminalPanel from './components/terminal/TerminalPanel';

export default function App() {
  const {
    state, setApiKey, connectGitHub, disconnectGitHub, selectRepo,
    setTab, setRepos, toggleSidebar, setActiveWorkspace, refreshWorkspaces
  } = useAppState();

  const renderMainContent = () => {
    // If no API key, show settings first
    if (!state.apiKeyConfigured && state.activeTab !== 'settings') {
      return <SettingsPanel onApiKeySet={setApiKey} />;
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
        if (state.currentSession) {
          const repoDisplay = state.activeWorkspace
            ? {
                id: state.activeWorkspace.id,
                fullName: state.activeWorkspace.github_owner && state.activeWorkspace.github_repo
                  ? `${state.activeWorkspace.github_owner}/${state.activeWorkspace.github_repo}`
                  : state.activeWorkspace.name,
                defaultBranch: state.activeWorkspace.default_branch || 'main',
                isPrivate: false
              }
            : state.selectedRepo;

          if (repoDisplay) {
            return (
              <ChatWorkspace
                session={state.currentSession}
                repo={repoDisplay}
                providerKey={state.apiKeyProvider}
              />
            );
          }
        }
        return (
          <GatedMessage
            message="Activate a workspace or select a repository to start coding"
            actionLabel="Go to Workspaces"
            onAction={() => setTab('workspace')}
          />
        );

      case 'terminal':
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

      case 'tasks':
        return state.currentSession ? (
          <TaskLedgerPanel sessionId={state.currentSession.id} />
        ) : (
          <GatedMessage message="Activate a workspace to view tasks" actionLabel="Go to Workspaces" onAction={() => setTab('workspace')} />
        );

      case 'diff':
        if (state.selectedRepo || state.activeWorkspace) {
          const repo = state.selectedRepo || (state.activeWorkspace ? {
            id: state.activeWorkspace.id,
            fullName: state.activeWorkspace.name,
            defaultBranch: state.activeWorkspace.default_branch || 'main',
            isPrivate: false
          } : null);
          return repo ? (
            <DiffViewer repo={repo} sessionId={state.currentSession?.id} />
          ) : null;
        }
        return <GatedMessage message="Activate a workspace to view diffs" actionLabel="Go to Workspaces" onAction={() => setTab('workspace')} />;

      case 'activity':
        if (state.selectedRepo || state.activeWorkspace) {
          const repo = state.selectedRepo || (state.activeWorkspace ? {
            id: state.activeWorkspace.id,
            fullName: state.activeWorkspace.name,
            defaultBranch: state.activeWorkspace.default_branch || 'main',
            isPrivate: false
          } : null);
          return repo ? (
            <ActivityLog sessionId={state.currentSession?.id || ''} repo={repo} />
          ) : null;
        }
        return <GatedMessage message="Activate a workspace to view activity" actionLabel="Go to Workspaces" onAction={() => setTab('workspace')} />;

      case 'settings':
        return <SettingsPanel onApiKeySet={setApiKey} />;

      default:
        return null;
    }
  };

  return (
    <>
      {/* Matrix Rain Canvas Background */}
      <MatrixRainCanvas opacity={0.38} fontSize={14} color="#00ff41" speed={33} />

      {/* CRT Scanline Overlay */}
      <div className="crt-overlay" />

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
        />
        <main className="flex-1 overflow-hidden animate-fadeIn">
          {renderMainContent()}
        </main>
      </div>
    </>
  );
}

// Gated message component
function GatedMessage({ message, actionLabel, onAction }: { message: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="glass-panel p-8 max-w-md text-center">
        <div className="text-4xl mb-4 opacity-30">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        </div>
        <p className="text-matrix-text-dim mb-4 text-sm">{message}</p>
        <button onClick={onAction} className="matrix-btn matrix-btn-primary">
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
