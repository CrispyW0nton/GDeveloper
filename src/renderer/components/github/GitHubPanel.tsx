import React, { useState, useEffect } from 'react';
import { SelectedRepo, RepoInfo } from '../../store';

interface GitHubPanelProps {
  connected: boolean;
  selectedRepo: SelectedRepo | null;
  onConnect: () => void;
  onSelectRepo: (repo: SelectedRepo) => void;
  onReposLoaded: (repos: RepoInfo[]) => void;
}

// Demo repositories
const DEMO_REPOS: RepoInfo[] = [
  { id: 'repo-1', fullName: 'gdeveloper/web-app', defaultBranch: 'main', isPrivate: false, description: 'Full-stack TypeScript web application', language: 'TypeScript' },
  { id: 'repo-2', fullName: 'gdeveloper/api-server', defaultBranch: 'main', isPrivate: true, description: 'REST API backend with Express', language: 'TypeScript' },
  { id: 'repo-3', fullName: 'gdeveloper/mobile-app', defaultBranch: 'develop', isPrivate: false, description: 'React Native mobile application', language: 'TypeScript' },
  { id: 'repo-4', fullName: 'gdeveloper/infra', defaultBranch: 'main', isPrivate: true, description: 'Infrastructure as Code with Terraform', language: 'HCL' },
  { id: 'repo-5', fullName: 'gdeveloper/design-system', defaultBranch: 'main', isPrivate: false, description: 'Shared component library and design tokens', language: 'TypeScript' },
];

const PERMISSIONS = [
  { name: 'Contents', access: 'Read & Write', icon: '📄' },
  { name: 'Pull Requests', access: 'Read & Write', icon: '🔀' },
  { name: 'Issues', access: 'Read & Write', icon: '📋' },
  { name: 'Metadata', access: 'Read', icon: '📊' },
  { name: 'Checks', access: 'Read', icon: '✅' },
];

export default function GitHubPanel({ connected, selectedRepo, onConnect, onSelectRepo, onReposLoaded }: GitHubPanelProps) {
  const [connecting, setConnecting] = useState(false);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    // Simulate GitHub App OAuth flow
    await new Promise(resolve => setTimeout(resolve, 1500));
    setConnecting(false);
    onConnect();
  };

  useEffect(() => {
    if (connected && !loaded) {
      // Simulate loading repos
      setTimeout(() => {
        setRepos(DEMO_REPOS);
        onReposLoaded(DEMO_REPOS);
        setLoaded(true);
      }, 800);
    }
  }, [connected, loaded]);

  const filtered = repos.filter(r =>
    r.fullName.toLowerCase().includes(search.toLowerCase()) ||
    r.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-matrix-green glow-text flex items-center gap-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              GitHub Integration
            </h1>
            <p className="text-xs text-matrix-text-muted/50 mt-1">Connect your GitHub account and select a repository</p>
          </div>
          <div className={`badge ${connected ? 'badge-connected' : 'badge-disconnected'}`}>
            {connected ? 'Connected' : 'Not Connected'}
          </div>
        </div>

        {/* Connect Section */}
        {!connected && (
          <div className="glass-panel p-6 text-center">
            <div className="mb-4">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" className="mx-auto text-matrix-green/30"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            </div>
            <h2 className="text-sm text-matrix-green mb-2">Install GDeveloper GitHub App</h2>
            <p className="text-xs text-matrix-text-muted/40 mb-4">Connect your GitHub account to browse and select repositories for AI-assisted development.</p>
            <button onClick={handleConnect} disabled={connecting} className="matrix-btn matrix-btn-primary">
              {connecting ? (
                <>
                  <span className="w-3 h-3 border border-matrix-green/50 border-t-matrix-green rounded-full animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                  Install GitHub App
                </>
              )}
            </button>

            {/* Permissions */}
            <div className="mt-6 text-left">
              <p className="text-[10px] text-matrix-text-muted/40 mb-2 uppercase tracking-wider">Requested Permissions</p>
              <div className="space-y-1.5">
                {PERMISSIONS.map(p => (
                  <div key={p.name} className="flex items-center justify-between text-[10px] px-3 py-1 bg-matrix-bg-hover/30 rounded">
                    <span className="text-matrix-text-dim">{p.icon} {p.name}</span>
                    <span className="text-matrix-text-muted/40">{p.access}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Repository List */}
        {connected && (
          <>
            <div className="flex gap-3">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search repositories..."
                className="matrix-input flex-1"
              />
              <button className="matrix-btn" onClick={() => setLoaded(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                Refresh
              </button>
            </div>

            {!loaded ? (
              <div className="glass-panel p-8 text-center">
                <span className="w-5 h-5 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin inline-block" />
                <p className="text-xs text-matrix-text-muted/50 mt-2">Loading repositories...</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(repo => (
                  <button
                    key={repo.id}
                    onClick={() => onSelectRepo(repo)}
                    className={`
                      w-full glass-panel p-4 text-left transition-all hover:border-matrix-green/50
                      ${selectedRepo?.id === repo.id ? 'border-matrix-green/60 bg-matrix-green/5' : ''}
                    `}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-matrix-green font-bold">{repo.fullName}</span>
                      <div className="flex items-center gap-2">
                        {repo.isPrivate ? (
                          <span className="badge badge-planned text-[9px]">Private</span>
                        ) : (
                          <span className="badge badge-connected text-[9px]">Public</span>
                        )}
                        {repo.language && (
                          <span className="text-[10px] text-matrix-text-muted/40">{repo.language}</span>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-matrix-text-muted/50">{repo.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-matrix-text-muted/30">
                      <span>Branch: {repo.defaultBranch}</span>
                      {selectedRepo?.id === repo.id && (
                        <span className="text-matrix-green">Active Workspace</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
