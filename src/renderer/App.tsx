import React, { useMemo, useState, useEffect } from 'react';
import { useAppState, TabId } from './store';
import Sidebar from './components/common/Sidebar';
import ChatWorkspace from './components/chat/ChatWorkspace';
import GitHubPanel from './components/github/GitHubPanel';
import MCPServersPanel from './components/mcp/MCPServersPanel';
import TaskLedgerPanel from './components/tasks/TaskLedgerPanel';
import DiffViewer from './components/diff/DiffViewer';
import ActivityLog from './components/activity/ActivityLog';
import SettingsPanel from './components/settings/SettingsPanel';

// Detect if running in Electron
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;

export default function App() {
  const { state, setApiKey, connectGitHub, disconnectGitHub, selectRepo, setTab, setRepos, toggleSidebar } = useAppState();
  const [videoError, setVideoError] = useState(false);

  // Resolve video path for both Electron (file://) and web (http://) modes
  const videoSrc = useMemo(() => {
    if (isElectron) {
      // In packaged Electron app, resources are in the extraResources folder
      // Use the process.resourcesPath if available, otherwise relative path
      return './resources/matrix-bg.mp4';
    }
    // Web preview mode (Vite dev server serves from publicDir = resources/)
    return '/matrix-bg.mp4';
  }, []);

  const renderMainContent = () => {
    // If no API key, show settings first
    if (!state.apiKeyConfigured && state.activeTab !== 'settings') {
      return <SettingsPanel onApiKeySet={setApiKey} />;
    }

    switch (state.activeTab) {
      case 'chat':
        return state.selectedRepo && state.currentSession ? (
          <ChatWorkspace
            session={state.currentSession}
            repo={state.selectedRepo}
            providerKey={state.apiKeyProvider}
          />
        ) : (
          <GatedMessage message="Connect GitHub and select a repository to start coding" onGoToGitHub={() => setTab('github')} />
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
      case 'tasks':
        return state.selectedRepo ? (
          <TaskLedgerPanel sessionId={state.currentSession?.id || ''} />
        ) : (
          <GatedMessage message="Select a repository to view tasks" onGoToGitHub={() => setTab('github')} />
        );
      case 'diff':
        return state.selectedRepo ? (
          <DiffViewer repo={state.selectedRepo} sessionId={state.currentSession?.id} />
        ) : (
          <GatedMessage message="Select a repository to view diffs" onGoToGitHub={() => setTab('github')} />
        );
      case 'activity':
        return state.selectedRepo ? (
          <ActivityLog sessionId={state.currentSession?.id || ''} repo={state.selectedRepo} />
        ) : (
          <GatedMessage message="Select a repository to view activity" onGoToGitHub={() => setTab('github')} />
        );
      case 'settings':
        return <SettingsPanel onApiKeySet={setApiKey} />;
      default:
        return null;
    }
  };

  return (
    <>
      {/* Matrix Video Background - CSS fallback if video fails */}
      {!videoError ? (
        <video
          className="video-background"
          autoPlay
          loop
          muted
          playsInline
          onError={() => setVideoError(true)}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      ) : (
        <div className="video-background matrix-rain-fallback" />
      )}

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
        />
        <main className="flex-1 overflow-hidden animate-fadeIn">
          {renderMainContent()}
        </main>
      </div>
    </>
  );
}

// Gated message component
function GatedMessage({ message, onGoToGitHub }: { message: string; onGoToGitHub: () => void }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="glass-panel p-8 max-w-md text-center">
        <div className="text-4xl mb-4 opacity-30">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto">
            <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <p className="text-matrix-text-dim mb-4 text-sm">{message}</p>
        <button onClick={onGoToGitHub} className="matrix-btn matrix-btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          Go to GitHub
        </button>
      </div>
    </div>
  );
}
