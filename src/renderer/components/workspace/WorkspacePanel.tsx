/**
 * WorkspacePanel — Sprint 9
 * Clone wizard, workspace list, git toolbar, commit panel, branch switcher
 * All-in-one workspace management with Matrix theme
 */

import React, { useState, useEffect, useCallback } from 'react';
import { WorkspaceInfo } from '../../store';

const api = (window as any).electronAPI;

interface WorkspacePanelProps {
  activeWorkspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
  githubConnected: boolean;
  onWorkspaceActivated: (ws: WorkspaceInfo) => void;
  onRefreshWorkspaces: () => void;
}

interface GitStatus {
  current: string;
  tracking: string;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
  isClean: boolean;
  files: {
    staged: string[];
    modified: string[];
    untracked: string[];
    deleted: string[];
    conflicted: string[];
  };
}

interface BranchInfo {
  current: string;
  local: string[];
  remote: string[];
}

type SubView = 'list' | 'clone' | 'git' | 'commit';

export default function WorkspacePanel({
  activeWorkspace, workspaces, githubConnected, onWorkspaceActivated, onRefreshWorkspaces
}: WorkspacePanelProps) {
  const [subView, setSubView] = useState<SubView>('list');
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<BranchInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Clone wizard state
  const [cloneUrl, setCloneUrl] = useState('');
  const [clonePath, setClonePath] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneSource, setCloneSource] = useState<'url' | 'github' | 'local'>('url');
  const [githubRepos, setGithubRepos] = useState<any[]>([]);
  const [githubSearch, setGithubSearch] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [localName, setLocalName] = useState('');

  // Commit state
  const [commitMessage, setCommitMessage] = useState('');

  // Branch state
  const [newBranchName, setNewBranchName] = useState('');
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showNewBranchInput, setShowNewBranchInput] = useState(false);

  // Refresh git status
  const refreshGitStatus = useCallback(async () => {
    if (!api || !activeWorkspace) return;
    try {
      const result = await api.gitStatus();
      if (result.success) setGitStatus(result.status);
    } catch { /* ignore */ }
  }, [activeWorkspace]);

  const refreshBranches = useCallback(async () => {
    if (!api || !activeWorkspace) return;
    try {
      const result = await api.gitBranches();
      if (result.success) setBranches({ current: result.current, local: result.local, remote: result.remote });
    } catch { /* ignore */ }
  }, [activeWorkspace]);

  useEffect(() => {
    refreshGitStatus();
    refreshBranches();
    const interval = setInterval(refreshGitStatus, 15000);
    return () => clearInterval(interval);
  }, [refreshGitStatus, refreshBranches]);

  // Load GitHub repos for clone wizard
  useEffect(() => {
    if (cloneSource === 'github' && githubConnected && api) {
      api.listRepos().then((result: any) => {
        if (result.repos) setGithubRepos(result.repos);
      });
    }
  }, [cloneSource, githubConnected]);

  // Auto-populate clone name from URL
  useEffect(() => {
    if (cloneUrl) {
      const match = cloneUrl.match(/\/([^/]+?)(?:\.git)?$/);
      if (match) setCloneName(match[1]);
    }
  }, [cloneUrl]);

  const doClone = async () => {
    if (!cloneUrl || !clonePath || !cloneName) {
      setError('Please fill in all clone fields');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const fullPath = clonePath.endsWith('/') || clonePath.endsWith('\\')
        ? `${clonePath}${cloneName}`
        : `${clonePath}/${cloneName}`;
      const result = await api.cloneWorkspace(cloneUrl, fullPath, cloneName);
      if (result.success) {
        setMessage(`Cloned successfully! Workspace ID: ${result.id}`);
        onRefreshWorkspaces();
        // Activate
        const ws = await api.getWorkspace(result.id);
        if (ws) onWorkspaceActivated(ws);
        setSubView('list');
        setCloneUrl('');
        setClonePath('');
        setCloneName('');
      } else {
        setError(result.error || 'Clone failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clone failed');
    }
    setLoading(false);
  };

  const doOpenLocal = async () => {
    if (!localPath || !localName) {
      setError('Please provide path and name');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.openLocalWorkspace(localPath, localName);
      if (result.success) {
        setMessage(`Opened workspace: ${localName}`);
        onRefreshWorkspaces();
        const ws = await api.getWorkspace(result.id);
        if (ws) onWorkspaceActivated(ws);
        setSubView('list');
      } else {
        setError(result.error || 'Failed to open');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open');
    }
    setLoading(false);
  };

  const activateWorkspace = async (ws: WorkspaceInfo) => {
    if (!api) return;
    setLoading(true);
    try {
      const result = await api.setActiveWorkspace(ws.id);
      if (result.success) {
        onWorkspaceActivated(result.workspace || ws);
        setMessage(`Activated: ${ws.name}`);
        refreshGitStatus();
        refreshBranches();
      } else {
        setError(result.error || 'Failed to activate');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed');
    }
    setLoading(false);
  };

  const removeWorkspace = async (id: string) => {
    if (!api) return;
    await api.removeWorkspace(id);
    onRefreshWorkspaces();
  };

  // Git operations
  const gitAction = async (action: () => Promise<any>, label: string) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (result.success) {
        setMessage(result.result || `${label} complete`);
        await refreshGitStatus();
        await refreshBranches();
      } else {
        setError(result.error || `${label} failed`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    }
    setLoading(false);
  };

  const doCommit = async () => {
    if (!commitMessage.trim()) { setError('Commit message required'); return; }
    await gitAction(() => api.gitCommit(commitMessage), 'Commit');
    setCommitMessage('');
  };

  const doCommitPush = async () => {
    if (!commitMessage.trim()) { setError('Commit message required'); return; }
    await gitAction(() => api.gitCommitPush(commitMessage), 'Commit & Push');
    setCommitMessage('');
  };

  const doCheckout = async (branch: string) => {
    setShowBranchDropdown(false);
    await gitAction(() => api.gitCheckout(branch), `Checkout ${branch}`);
  };

  const doCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    await gitAction(() => api.gitCreateBranch(newBranchName), `Create branch ${newBranchName}`);
    setNewBranchName('');
    setShowNewBranchInput(false);
  };

  const filteredGithubRepos = githubRepos.filter(r =>
    !githubSearch || r.fullName?.toLowerCase().includes(githubSearch.toLowerCase()) || r.full_name?.toLowerCase().includes(githubSearch.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-matrix-border flex items-center justify-between glass-panel-solid rounded-none border-x-0 border-t-0">
        <div className="flex items-center gap-3">
          <span className="text-sm text-matrix-green font-bold">Workspaces</span>
          <div className="flex gap-1">
            <TabBtn active={subView === 'list'} onClick={() => setSubView('list')}>List</TabBtn>
            <TabBtn active={subView === 'clone'} onClick={() => setSubView('clone')}>Clone</TabBtn>
            {activeWorkspace && <TabBtn active={subView === 'git'} onClick={() => setSubView('git')}>Git</TabBtn>}
            {activeWorkspace && <TabBtn active={subView === 'commit'} onClick={() => setSubView('commit')}>Commit</TabBtn>}
          </div>
        </div>
        {activeWorkspace && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-matrix-green animate-pulseDot" />
            <span className="text-[10px] text-matrix-text-dim truncate max-w-[200px]">{activeWorkspace.name}</span>
          </div>
        )}
      </div>

      {/* Git Status Bar */}
      {activeWorkspace && gitStatus && (
        <div className="px-4 py-1.5 border-b border-matrix-border/50 flex items-center gap-3 text-[10px] bg-black/30">
          <span className="text-matrix-green font-mono">{gitStatus.current || '(detached)'}</span>
          {gitStatus.tracking && <span className="text-matrix-text-muted/40">← {gitStatus.tracking}</span>}
          {gitStatus.ahead > 0 && <span className="text-matrix-info">↑{gitStatus.ahead}</span>}
          {gitStatus.behind > 0 && <span className="text-matrix-warning">↓{gitStatus.behind}</span>}
          <span className="text-matrix-text-muted/30">|</span>
          {gitStatus.staged > 0 && <span className="text-matrix-green">●{gitStatus.staged}</span>}
          {gitStatus.modified > 0 && <span className="text-yellow-500">◐{gitStatus.modified}</span>}
          {gitStatus.untracked > 0 && <span className="text-matrix-text-muted">+{gitStatus.untracked}</span>}
          {gitStatus.conflicted > 0 && <span className="text-red-500">✕{gitStatus.conflicted}</span>}
          {gitStatus.isClean && <span className="text-matrix-green/50">✓ clean</span>}
        </div>
      )}

      {/* Feedback */}
      {(error || message) && (
        <div className={`px-4 py-2 text-xs ${error ? 'bg-red-900/20 text-red-400' : 'bg-matrix-green/10 text-matrix-green'}`}>
          {error || message}
          <button onClick={() => { setError(''); setMessage(''); }} className="ml-2 opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {subView === 'list' && renderWorkspaceList()}
        {subView === 'clone' && renderCloneWizard()}
        {subView === 'git' && renderGitToolbar()}
        {subView === 'commit' && renderCommitPanel()}
      </div>
    </div>
  );

  // ─── Sub-renderers ───

  function renderWorkspaceList() {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs text-matrix-text-dim uppercase tracking-wider">Registered Workspaces</h3>
          <button onClick={() => setSubView('clone')} className="matrix-btn text-[10px] px-2 py-1">
            + Clone / Open
          </button>
        </div>

        {workspaces.length === 0 ? (
          <div className="glass-panel p-6 text-center">
            <p className="text-matrix-text-muted text-xs mb-3">No workspaces registered yet.</p>
            <button onClick={() => setSubView('clone')} className="matrix-btn matrix-btn-primary text-xs px-4 py-2">
              Clone or Open a Repository
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {workspaces.map(ws => {
              const isActive = activeWorkspace?.id === ws.id;
              return (
                <div key={ws.id} className={`glass-panel p-3 cursor-pointer transition-all ${isActive ? 'border-matrix-green/40 bg-matrix-green/5' : 'hover:border-matrix-green/20'}`}
                  onClick={() => !isActive && activateWorkspace(ws)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isActive && <span className="w-2 h-2 rounded-full bg-matrix-green animate-pulseDot" />}
                      <span className="text-xs text-matrix-green font-bold">{ws.name}</span>
                      {ws.github_owner && ws.github_repo && (
                        <span className="text-[9px] text-matrix-text-muted/40">{ws.github_owner}/{ws.github_repo}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {ws.default_branch && (
                        <span className="badge badge-connected text-[9px]">{ws.default_branch}</span>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); removeWorkspace(ws.id); }}
                        className="text-matrix-text-muted/30 hover:text-red-400 text-[10px]" title="Remove from list">
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="text-[9px] text-matrix-text-muted/40 mt-1 truncate">{ws.local_path}</div>
                  {ws.last_opened_at && (
                    <div className="text-[9px] text-matrix-text-muted/20 mt-0.5">Last opened: {new Date(ws.last_opened_at).toLocaleDateString()}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderCloneWizard() {
    return (
      <div className="space-y-4">
        <h3 className="text-xs text-matrix-text-dim uppercase tracking-wider">Clone / Open Repository</h3>

        {/* Source tabs */}
        <div className="flex gap-1">
          <TabBtn active={cloneSource === 'url'} onClick={() => setCloneSource('url')}>From URL</TabBtn>
          <TabBtn active={cloneSource === 'github'} onClick={() => setCloneSource('github')}>From GitHub</TabBtn>
          <TabBtn active={cloneSource === 'local'} onClick={() => setCloneSource('local')}>Open Local</TabBtn>
        </div>

        {cloneSource === 'url' && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-matrix-text-muted/50 block mb-1">Repository URL</label>
              <input value={cloneUrl} onChange={e => setCloneUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="matrix-input text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-matrix-text-muted/50 block mb-1">Clone to directory</label>
              <input value={clonePath} onChange={e => setClonePath(e.target.value)}
                placeholder="C:\\Dev\\Projects"
                className="matrix-input text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-matrix-text-muted/50 block mb-1">Workspace name</label>
              <input value={cloneName} onChange={e => setCloneName(e.target.value)}
                placeholder="my-project"
                className="matrix-input text-xs" />
            </div>
            <button onClick={doClone} disabled={loading} className="matrix-btn matrix-btn-primary w-full">
              {loading ? 'Cloning...' : 'Clone Repository'}
            </button>
          </div>
        )}

        {cloneSource === 'github' && (
          <div className="space-y-3">
            {!githubConnected ? (
              <div className="glass-panel p-4 text-center">
                <p className="text-xs text-matrix-text-muted">Connect GitHub first in the GitHub tab.</p>
              </div>
            ) : (
              <>
                <input value={githubSearch} onChange={e => setGithubSearch(e.target.value)}
                  placeholder="Search repositories..." className="matrix-input text-xs" />
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {filteredGithubRepos.slice(0, 20).map((r: any) => (
                    <div key={r.id || r.full_name} className="glass-panel p-2 cursor-pointer hover:border-matrix-green/30"
                      onClick={() => {
                        const url = r.clone_url || r.cloneUrl || `https://github.com/${r.fullName || r.full_name}.git`;
                        setCloneUrl(url);
                        setCloneSource('url');
                      }}>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-matrix-green">{r.fullName || r.full_name}</span>
                        <span className="text-[9px] text-matrix-text-muted/30">{r.isPrivate || r.private ? 'private' : 'public'}</span>
                      </div>
                      {(r.description) && <p className="text-[9px] text-matrix-text-muted/40 truncate">{r.description}</p>}
                    </div>
                  ))}
                </div>
                <div>
                  <label className="text-[10px] text-matrix-text-muted/50 block mb-1">Clone to directory</label>
                  <input value={clonePath} onChange={e => setClonePath(e.target.value)}
                    placeholder="C:\\Dev\\Projects" className="matrix-input text-xs" />
                </div>
              </>
            )}
          </div>
        )}

        {cloneSource === 'local' && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-matrix-text-muted/50 block mb-1">Local directory path</label>
              <input value={localPath} onChange={e => setLocalPath(e.target.value)}
                placeholder="C:\\Dev\\Projects\\my-project"
                className="matrix-input text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-matrix-text-muted/50 block mb-1">Workspace name</label>
              <input value={localName} onChange={e => setLocalName(e.target.value)}
                placeholder="my-project"
                className="matrix-input text-xs" />
            </div>
            <button onClick={doOpenLocal} disabled={loading} className="matrix-btn matrix-btn-primary w-full">
              {loading ? 'Opening...' : 'Open Local Directory'}
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderGitToolbar() {
    if (!activeWorkspace) {
      return <div className="text-xs text-matrix-text-muted text-center p-4">No active workspace</div>;
    }

    return (
      <div className="space-y-4">
        <h3 className="text-xs text-matrix-text-dim uppercase tracking-wider">Git Quick Actions</h3>

        {/* Primary Actions */}
        <div className="grid grid-cols-3 gap-2">
          <GitBtn label="Pull" icon="↓" onClick={() => gitAction(() => api.gitPull(), 'Pull')} />
          <GitBtn label="Push" icon="↑" onClick={() => gitAction(() => api.gitPush(), 'Push')} />
          <GitBtn label="Fetch" icon="⟳" onClick={() => gitAction(() => api.gitFetch(), 'Fetch')} />
          <GitBtn label="Stash" icon="📦" onClick={() => gitAction(() => api.gitStash(), 'Stash')} />
          <GitBtn label="Stash Pop" icon="📤" onClick={() => gitAction(() => api.gitStashPop(), 'Stash Pop')} />
          <GitBtn label="Discard" icon="↩" onClick={() => {
            if (window.confirm('Discard all uncommitted changes?')) {
              gitAction(() => api.gitDiscard(), 'Discard');
            }
          }} danger />
        </div>

        {/* Branch Switcher */}
        <div className="glass-panel p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider">Branch</span>
            <button onClick={() => setShowBranchDropdown(!showBranchDropdown)}
              className="text-xs text-matrix-green font-mono hover:underline">
              {gitStatus?.current || 'main'} ▾
            </button>
          </div>

          {showBranchDropdown && branches && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {branches.local.map(b => (
                <button key={b} onClick={() => doCheckout(b)}
                  className={`w-full text-left text-[10px] px-2 py-1 rounded transition-colors ${
                    b === branches.current ? 'text-matrix-green bg-matrix-green/10' : 'text-matrix-text-dim hover:bg-matrix-bg-hover'
                  }`}>
                  {b === branches.current && '● '}{b}
                </button>
              ))}
              <hr className="border-matrix-border/30" />
              <button onClick={() => { setShowNewBranchInput(true); setShowBranchDropdown(false); }}
                className="w-full text-left text-[10px] px-2 py-1 text-matrix-info hover:bg-matrix-bg-hover rounded">
                + New branch...
              </button>
            </div>
          )}

          {showNewBranchInput && (
            <div className="flex gap-2 mt-2">
              <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                placeholder="feature/my-branch" className="matrix-input text-[10px] flex-1"
                onKeyDown={e => e.key === 'Enter' && doCreateBranch()} />
              <button onClick={doCreateBranch} className="matrix-btn text-[10px] px-2">Create</button>
              <button onClick={() => setShowNewBranchInput(false)} className="text-matrix-text-muted/30 text-xs">✕</button>
            </div>
          )}
        </div>

        {/* Dangerous Actions */}
        <div className="glass-panel p-3 border-red-900/20">
          <span className="text-[10px] text-red-400/50 uppercase tracking-wider block mb-2">Destructive</span>
          <div className="grid grid-cols-3 gap-2">
            <GitBtn label="Undo Commit" icon="⤺" onClick={() => {
              if (window.confirm('Undo last commit? (soft reset)')) {
                gitAction(() => api.gitResetSoft(), 'Undo Commit');
              }
            }} danger />
            <GitBtn label="Hard Reset" icon="⚠" onClick={() => {
              const val = window.prompt('Type RESET to hard reset to HEAD');
              if (val === 'RESET') gitAction(() => api.gitResetHard('RESET'), 'Hard Reset');
            }} danger />
            <GitBtn label="Reset Remote" icon="⚠" onClick={() => {
              const val = window.prompt('Type RESET to reset to remote tracking branch');
              if (val === 'RESET') gitAction(() => api.gitResetToRemote('RESET'), 'Reset Remote');
            }} danger />
          </div>
        </div>

        {/* Recent Log */}
        <RecentLog />
      </div>
    );
  }

  function renderCommitPanel() {
    if (!activeWorkspace || !gitStatus) {
      return <div className="text-xs text-matrix-text-muted text-center p-4">No active workspace</div>;
    }

    return (
      <div className="space-y-4">
        <h3 className="text-xs text-matrix-text-dim uppercase tracking-wider">Commit Changes</h3>

        {/* Staged files */}
        <div className="glass-panel p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-matrix-green uppercase tracking-wider">Staged ({gitStatus.files.staged.length})</span>
            <button onClick={() => gitAction(() => api.gitUnstageAll(), 'Unstage All')}
              className="text-[9px] text-matrix-text-muted/40 hover:text-matrix-text-dim">Unstage All</button>
          </div>
          {gitStatus.files.staged.length === 0 ? (
            <p className="text-[10px] text-matrix-text-muted/30 italic">No staged changes</p>
          ) : (
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {gitStatus.files.staged.map(f => (
                <div key={f} className="flex items-center justify-between text-[10px]">
                  <span className="text-matrix-green truncate flex-1">{f}</span>
                  <button onClick={() => gitAction(() => api.gitUnstageFile(f), `Unstage ${f}`)}
                    className="text-matrix-text-muted/30 hover:text-red-400 ml-2">−</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Unstaged files */}
        <div className="glass-panel p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-yellow-500 uppercase tracking-wider">
              Modified ({gitStatus.files.modified.length}) / Untracked ({gitStatus.files.untracked.length})
            </span>
            <button onClick={() => gitAction(() => api.gitStageAll(), 'Stage All')}
              className="text-[9px] text-matrix-text-muted/40 hover:text-matrix-green">Stage All</button>
          </div>
          {gitStatus.files.modified.length === 0 && gitStatus.files.untracked.length === 0 ? (
            <p className="text-[10px] text-matrix-text-muted/30 italic">Working tree clean</p>
          ) : (
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {[...gitStatus.files.modified, ...gitStatus.files.untracked].map(f => (
                <div key={f} className="flex items-center justify-between text-[10px]">
                  <span className="text-yellow-500 truncate flex-1">{f}</span>
                  <button onClick={() => gitAction(() => api.gitStageFile(f), `Stage ${f}`)}
                    className="text-matrix-text-muted/30 hover:text-matrix-green ml-2">+</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Deleted */}
        {gitStatus.files.deleted.length > 0 && (
          <div className="glass-panel p-3">
            <span className="text-[10px] text-red-400 uppercase tracking-wider block mb-1">Deleted ({gitStatus.files.deleted.length})</span>
            <div className="space-y-0.5 max-h-20 overflow-y-auto">
              {gitStatus.files.deleted.map(f => (
                <div key={f} className="text-[10px] text-red-400/60 truncate">{f}</div>
              ))}
            </div>
          </div>
        )}

        {/* Commit message */}
        <div className="space-y-2">
          <textarea value={commitMessage} onChange={e => setCommitMessage(e.target.value)}
            placeholder="Commit message..."
            className="matrix-input text-xs resize-none h-16"
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { doCommit(); } }} />
          <div className="flex gap-2">
            <button onClick={() => { gitAction(() => api.gitStageAll(), 'Stage All'); }}
              className="matrix-btn text-[10px] flex-1">Stage All</button>
            <button onClick={doCommit} disabled={loading || !commitMessage.trim()}
              className="matrix-btn matrix-btn-primary text-[10px] flex-1">Commit</button>
            <button onClick={doCommitPush} disabled={loading || !commitMessage.trim()}
              className="matrix-btn text-[10px] flex-1 border-matrix-info/30 text-matrix-info">Commit & Push</button>
          </div>
          <span className="text-[9px] text-matrix-text-muted/20">Ctrl+Enter to commit</span>
        </div>
      </div>
    );
  }
}

// ─── Small Components ───

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`text-[10px] px-2 py-1 rounded transition-all ${
        active ? 'bg-matrix-green/10 text-matrix-green border border-matrix-green/30' : 'text-matrix-text-muted/40 hover:text-matrix-text-dim border border-transparent'
      }`}>
      {children}
    </button>
  );
}

function GitBtn({ label, icon, onClick, danger }: { label: string; icon: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`glass-panel p-2 text-center transition-all hover:border-matrix-green/30 ${
        danger ? 'hover:border-red-500/30' : ''
      }`}>
      <span className="block text-sm">{icon}</span>
      <span className={`text-[9px] ${danger ? 'text-red-400/60' : 'text-matrix-text-dim'}`}>{label}</span>
    </button>
  );
}

function RecentLog() {
  const [entries, setEntries] = useState<any[]>([]);
  const api = (window as any).electronAPI;

  useEffect(() => {
    if (!api) return;
    api.gitLog(8).then((result: any) => {
      if (result.success && result.entries) setEntries(result.entries);
    });
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="glass-panel p-3">
      <span className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider block mb-2">Recent Commits</span>
      <div className="space-y-1">
        {entries.map((e: any) => (
          <div key={e.hash} className="text-[10px] flex items-start gap-2">
            <span className="text-matrix-green/50 font-mono shrink-0">{e.hash?.substring(0, 7)}</span>
            <span className="text-matrix-text-dim truncate">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
