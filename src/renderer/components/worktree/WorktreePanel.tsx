/**
 * WorktreePanel — Sprint 17 + Sprint 18
 * Visual Worktree Manager showing main + linked worktrees with
 * quick actions: open, remove, lock/unlock, prune, repair, compare.
 * Sprint 18: improved labels, better empty states, "Why worktrees?" card,
 * clearer conflict warnings, friendly microcopy, visual polish.
 */

import React, { useState, useEffect, useCallback } from 'react';

const api = (window as any).electronAPI;

// ─── Types ───

interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  isMain: boolean;
  isLinked: boolean;
  isBare: boolean;
  isDetached: boolean;
  locked: boolean;
  lockReason: string;
  prunable: boolean;
  prunableReason: string;
  dirty: boolean;
  aheadBehind: { ahead: number; behind: number } | null;
  missing: boolean;
  hasSubmodules: boolean;
}

interface WorktreeContext {
  isWorktree: boolean;
  isMain: boolean;
  isLinked: boolean;
  branch: string | null;
  head: string;
  mainRoot: string | null;
  currentPath: string;
}

interface TaskWorktree {
  id: string;
  worktreePath: string;
  branchName: string | null;
  taskDescription: string;
  sessionId: string;
  lifecycle: 'temporary' | 'permanent';
  createdAt: string;
  status: 'active' | 'completed' | 'abandoned';
}

interface WorktreePanelProps {
  workspacePath?: string;
  sessionId?: string;
  onSwitchWorktree?: (path: string) => void;
}

export default function WorktreePanel({ workspacePath, sessionId, onSwitchWorktree }: WorktreePanelProps) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [context, setContext] = useState<WorktreeContext | null>(null);
  const [taskWorktrees, setTaskWorktrees] = useState<TaskWorktree[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showWhyCard, setShowWhyCard] = useState(false);

  // Create dialog state
  const [createPath, setCreatePath] = useState('');
  const [createBranch, setCreateBranch] = useState('');
  const [createNewBranch, setCreateNewBranch] = useState(true);
  const [createDetach, setCreateDetach] = useState(false);

  // Task isolation dialog state
  const [showTaskCreate, setShowTaskCreate] = useState(false);
  const [taskDescription, setTaskDescription] = useState('');
  const [taskLifecycle, setTaskLifecycle] = useState<'temporary' | 'permanent'>('temporary');

  const refresh = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [wtResult, ctxResult, tasks] = await Promise.all([
        api.worktreeList(),
        api.worktreeContext(),
        api.worktreeTaskList(),
      ]);
      if (wtResult.success) setWorktrees(wtResult.worktrees);
      else setError(wtResult.error || 'Failed to list worktrees');
      if (ctxResult.success) setContext(ctxResult.context);
      setTaskWorktrees(tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load worktrees');
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh, workspacePath]);

  const showMessage = (msg: string) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 5000);
  };

  const handleCreate = async () => {
    if (!createPath.trim()) return;
    try {
      const result = await api.worktreeAdd({
        path: createPath.trim(),
        branchOrCommit: createBranch.trim() || undefined,
        newBranch: createNewBranch,
        detach: createDetach,
      });
      if (result.success) {
        showMessage(result.message || 'Worktree created successfully');
        setShowCreate(false);
        setCreatePath('');
        setCreateBranch('');
        refresh();
      } else {
        showMessage(result.message || 'Failed to create worktree');
      }
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const handleCreateTask = async () => {
    if (!taskDescription.trim()) return;
    try {
      const result = await api.worktreeCreateTask({
        taskDescription: taskDescription.trim(),
        sessionId: sessionId || 'system',
        lifecycle: taskLifecycle,
      });
      if (result.success) {
        showMessage(result.message || 'Task worktree created');
        setShowTaskCreate(false);
        setTaskDescription('');
        refresh();
      } else {
        showMessage(result.message || 'Failed to create task worktree');
      }
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const handleRemove = async (path: string, force = false) => {
    try {
      const result = await api.worktreeRemove({ path, force });
      showMessage(result.success ? (result.message || 'Worktree removed') : (result.message || 'Remove failed'));
      if (result.success) refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  const handleLock = async (path: string) => {
    try {
      const result = await api.worktreeLock(path);
      showMessage(result.success ? 'Worktree locked (protected from pruning)' : (result.message || 'Lock failed'));
      refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Lock failed');
    }
  };

  const handleUnlock = async (path: string) => {
    try {
      const result = await api.worktreeUnlock(path);
      showMessage(result.success ? 'Worktree unlocked' : (result.message || 'Unlock failed'));
      refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Unlock failed');
    }
  };

  const handlePrune = async () => {
    try {
      const result = await api.worktreePrune(false);
      showMessage(result.success ? (result.message || 'Stale references cleaned up') : (result.message || 'Prune failed'));
      refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Prune failed');
    }
  };

  const handleRepair = async () => {
    try {
      const result = await api.worktreeRepair();
      showMessage(result.success ? (result.message || 'Worktree references repaired') : (result.message || 'Repair failed'));
      refresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Repair failed');
    }
  };

  const handleOpen = (path: string) => {
    if (onSwitchWorktree) onSwitchWorktree(path);
  };

  const linkedCount = worktrees.filter(wt => wt.isLinked).length;

  // ─── Render ───
  return (
    <div className="p-4 space-y-4 text-sm" style={{ color: 'var(--text-primary, #00ff41)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--accent, #00ff41)' }}>
            Worktree Manager
          </h2>
          <button
            onClick={() => setShowWhyCard(!showWhyCard)}
            className="text-[10px] px-2 py-0.5 rounded-full opacity-40 hover:opacity-80 transition-opacity"
            style={{ border: '1px solid var(--border, #003300)' }}
            title="What are worktrees and why use them?"
          >
            ?
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 rounded text-xs font-bold transition-all hover:opacity-90"
            style={{ background: 'var(--accent, #00ff41)', color: '#000' }}
            title="Create a new worktree to work on a different branch simultaneously"
          >
            + New Worktree
          </button>
          <button
            onClick={() => setShowTaskCreate(true)}
            className="px-3 py-1.5 rounded text-xs font-bold transition-all hover:opacity-90"
            style={{ background: 'rgba(0,255,65,0.15)', color: 'var(--accent, #00ff41)', border: '1px solid var(--accent, #00ff41)' }}
            title="Create an isolated worktree for the AI to work in safely"
          >
            Isolate Task
          </button>
          <button onClick={refresh} className="px-2 py-1.5 rounded text-xs opacity-40 hover:opacity-100 transition-opacity" style={{ border: '1px solid var(--border, #003300)' }}
            title="Refresh worktree list">
            ↻
          </button>
        </div>
      </div>

      {/* Why Worktrees card (Sprint 18) */}
      {showWhyCard && (
        <div className="p-4 rounded-lg text-xs leading-relaxed space-y-2" style={{ background: 'rgba(0,100,255,0.05)', border: '1px solid rgba(0,100,255,0.2)' }}>
          <div className="flex items-center justify-between">
            <strong style={{ color: 'var(--accent, #00ff41)' }}>What are worktrees?</strong>
            <button onClick={() => setShowWhyCard(false)} className="opacity-40 hover:opacity-100">✕</button>
          </div>
          <p className="opacity-70">
            Worktrees let you check out <strong>multiple branches at the same time</strong>, each in its own folder. 
            No more <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>git stash</code> juggling.
          </p>
          <p className="opacity-50">
            <strong>Use cases:</strong> hotfix while mid-feature, let AI experiment safely, compare branches side-by-side, parallel work on multiple features.
          </p>
          <p className="opacity-50">
            <strong>Isolate Task</strong> creates a temporary worktree for AI work. When done, use <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>/worktree-handoff</code> to get merge instructions.
          </p>
        </div>
      )}

      {/* Current Context */}
      {context && (
        <div className="p-3 rounded-lg text-xs font-mono flex items-center gap-3" style={{ background: 'rgba(0,255,65,0.03)', border: '1px solid var(--border, #003300)' }}>
          <span className="opacity-40">You are in:</span>
          <span className="flex items-center gap-1.5" style={{ color: 'var(--accent, #00ff41)' }}>
            <span className={`w-2 h-2 rounded-full ${context.isMain ? 'bg-green-400/50' : 'bg-blue-400/50'}`} />
            {context.isMain ? 'Main Worktree' : 'Linked Worktree'}
          </span>
          {context.branch && <span className="opacity-60">{context.branch}</span>}
          {!context.branch && <span className="opacity-40">detached at {context.head?.substring(0, 7)}</span>}
          {linkedCount > 0 && (
            <span className="ml-auto opacity-30">{linkedCount} linked worktree{linkedCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      {/* Action Message */}
      {actionMessage && (
        <div className="p-3 rounded-lg text-xs font-mono animate-fadeIn" style={{ background: 'rgba(0,255,65,0.08)', border: '1px solid var(--accent, #00ff41)' }}>
          {actionMessage}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg text-xs font-mono" style={{ background: 'rgba(255,0,0,0.08)', border: '1px solid rgba(255,50,50,0.3)', color: '#ff5555' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-xs opacity-40 font-mono flex items-center gap-2">
          <span className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border, #003300)', borderTopColor: 'var(--accent, #00ff41)' }} />
          Loading worktrees...
        </div>
      )}

      {/* Worktree List */}
      {worktrees.length > 0 && (
        <div className="space-y-2">
          {worktrees.map((wt) => (
            <div
              key={wt.path}
              className="p-3 rounded-lg transition-all"
              style={{
                background: context?.currentPath === wt.path ? 'rgba(0,255,65,0.06)' : 'rgba(0,255,65,0.015)',
                border: context?.currentPath === wt.path ? '1px solid var(--accent, #00ff41)' : '1px solid var(--border, #003300)',
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${wt.isMain ? 'bg-green-400/40' : 'bg-blue-400/40'}`} />
                  <span className="font-bold text-xs" style={{ color: 'var(--accent, #00ff41)' }}>
                    {wt.isMain ? 'Main Worktree' : 'Linked Worktree'}
                  </span>
                  {context?.currentPath === wt.path && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full opacity-50" style={{ border: '1px solid var(--accent, #00ff41)' }}>current</span>
                  )}
                </div>
                <div className="flex gap-1">
                  {!wt.isMain && !wt.missing && (
                    <button
                      onClick={() => handleOpen(wt.path)}
                      className="px-2.5 py-1 rounded text-xs font-bold transition-all hover:opacity-90"
                      style={{ background: 'rgba(0,255,65,0.15)', color: 'var(--accent, #00ff41)' }}
                      title="Switch to this worktree"
                    >
                      Open
                    </button>
                  )}
                  {!wt.isMain && (
                    <>
                      {wt.locked ? (
                        <button onClick={() => handleUnlock(wt.path)} className="px-2 py-1 rounded text-xs opacity-50 hover:opacity-100 transition-opacity" title="Unlock this worktree (allow pruning)">
                          Unlock
                        </button>
                      ) : (
                        <button onClick={() => handleLock(wt.path)} className="px-2 py-1 rounded text-xs opacity-50 hover:opacity-100 transition-opacity" title="Lock this worktree (prevent pruning)">
                          Lock
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(wt.path, wt.dirty)}
                        className="px-2 py-1 rounded text-xs opacity-40 hover:opacity-100 transition-opacity"
                        style={{ color: '#ff5555' }}
                        title={wt.dirty ? 'Force remove (this worktree has uncommitted changes!)' : 'Remove this worktree'}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Path */}
              <div className="mt-1.5 text-[10px] font-mono opacity-40 truncate" title={wt.path}>
                {wt.path}
              </div>

              {/* Status indicators */}
              <div className="mt-1.5 flex items-center gap-3 text-[10px] font-mono flex-wrap">
                {wt.isDetached ? (
                  <span className="flex items-center gap-1" style={{ color: '#ffaa00' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500/40" />
                    Detached HEAD: {wt.head?.substring(0, 7)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 opacity-70">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400/30" />
                    {wt.branch || '(unknown branch)'}
                  </span>
                )}
                <span className={`flex items-center gap-1 ${wt.dirty ? 'text-yellow-400' : 'opacity-40'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${wt.dirty ? 'bg-yellow-400/40' : 'bg-green-400/20'}`} />
                  {wt.dirty ? 'Has uncommitted changes' : 'Clean'}
                </span>
                {wt.locked && <span className="text-yellow-400/70 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400/30" />Locked{wt.lockReason ? `: ${wt.lockReason}` : ''}</span>}
                {wt.missing && <span style={{ color: '#ff5555' }} className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400/40" />Missing (path not found)</span>}
                {wt.prunable && <span className="text-yellow-400/50 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400/20" />Prunable</span>}
                {wt.hasSubmodules && <span className="opacity-40 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400/20" />Has submodules</span>}
                {wt.aheadBehind && (wt.aheadBehind.ahead > 0 || wt.aheadBehind.behind > 0) && (
                  <span className="opacity-40">
                    {wt.aheadBehind.ahead > 0 && <span className="text-blue-400/60">↑{wt.aheadBehind.ahead} ahead</span>}
                    {wt.aheadBehind.ahead > 0 && wt.aheadBehind.behind > 0 && ' '}
                    {wt.aheadBehind.behind > 0 && <span className="text-yellow-400/60">↓{wt.aheadBehind.behind} behind</span>}
                  </span>
                )}
              </div>

              {/* Sprint 18: Conflict warning for dirty worktrees being removed */}
              {wt.dirty && !wt.isMain && (
                <div className="mt-2 p-2 rounded text-[10px] opacity-60" style={{ background: 'rgba(255,170,0,0.05)', border: '1px solid rgba(255,170,0,0.15)' }}>
                  This worktree has uncommitted changes. Removing it will <strong>discard those changes</strong>. Commit or stash first.
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty State (Sprint 18) */}
      {worktrees.length === 0 && !loading && !error && (
        <div className="py-10 text-center space-y-3">
          <div className="text-2xl opacity-20">🌳</div>
          <p className="text-xs opacity-50">No worktrees found.</p>
          <p className="text-[10px] opacity-30">
            Open a Git repository to use the Worktree Manager.<br />
            Worktrees let you work on multiple branches at the same time.
          </p>
          <button
            onClick={() => setShowWhyCard(true)}
            className="text-[10px] px-3 py-1 rounded opacity-30 hover:opacity-60 transition-opacity"
            style={{ border: '1px solid var(--border, #003300)' }}
          >
            Learn about worktrees
          </button>
        </div>
      )}

      {/* Task Worktrees */}
      {taskWorktrees.length > 0 && (
        <div className="mt-4 space-y-2">
          <h3 className="text-xs font-bold opacity-60 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400/40" />
            Active Task Worktrees
          </h3>
          {taskWorktrees.filter(tw => tw.status === 'active').map(tw => (
            <div key={tw.id} className="p-3 rounded-lg text-xs font-mono" style={{ background: 'rgba(0,100,255,0.04)', border: '1px solid rgba(0,100,255,0.2)' }}>
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <span className="font-bold opacity-80">{tw.taskDescription.substring(0, 60)}{tw.taskDescription.length > 60 ? '...' : ''}</span>
                  <div className="opacity-40 mt-1">{tw.branchName || 'detached'} &mdash; {tw.worktreePath}</div>
                </div>
                <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                  tw.lifecycle === 'temporary' ? 'bg-yellow-400/10 text-yellow-400/60 border border-yellow-400/20' : 'bg-blue-400/10 text-blue-400/60 border border-blue-400/20'
                }`}>
                  {tw.lifecycle === 'temporary' ? 'Auto-cleanup' : 'Permanent'}
                </span>
              </div>
            </div>
          ))}
          {taskWorktrees.filter(tw => tw.status === 'active').length === 0 && (
            <p className="text-[10px] opacity-30 pl-4">No active task worktrees. Use "Isolate Task" to create one.</p>
          )}
        </div>
      )}

      {/* Maintenance Actions */}
      <div className="flex gap-2 pt-3 border-t" style={{ borderColor: 'var(--border, #003300)' }}>
        <button onClick={handlePrune} className="px-3 py-1.5 rounded text-[10px] opacity-40 hover:opacity-80 transition-opacity" style={{ border: '1px solid var(--border, #003300)' }}
          title="Remove stale worktree references (safe, only cleans up metadata)">
          Prune stale refs
        </button>
        <button onClick={handleRepair} className="px-3 py-1.5 rounded text-[10px] opacity-40 hover:opacity-80 transition-opacity" style={{ border: '1px solid var(--border, #003300)' }}
          title="Repair broken worktree links (safe, fixes metadata only)">
          Repair links
        </button>
      </div>

      {/* Create Worktree Dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="p-6 rounded-lg w-[420px] space-y-4" style={{ background: 'var(--panel-bg, #0a0a0a)', border: '1px solid var(--accent, #00ff41)' }}>
            <div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--accent, #00ff41)' }}>New Worktree</h3>
              <p className="text-[10px] opacity-40 mt-1">Create a new checkout of this repo in a separate folder. You can work on a different branch without affecting your current one.</p>
            </div>
            <div>
              <label className="text-[10px] opacity-50 block mb-1">Folder path</label>
              <input
                value={createPath}
                onChange={e => setCreatePath(e.target.value)}
                className="w-full px-3 py-2 rounded text-xs font-mono"
                style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid var(--border, #003300)', color: 'var(--text-primary, #00ff41)' }}
                placeholder="../my-feature"
              />
              <p className="text-[9px] opacity-30 mt-1">Relative to repo root, or an absolute path</p>
            </div>
            <div>
              <label className="text-[10px] opacity-50 block mb-1">Branch or commit (optional)</label>
              <input
                value={createBranch}
                onChange={e => setCreateBranch(e.target.value)}
                className="w-full px-3 py-2 rounded text-xs font-mono"
                style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid var(--border, #003300)', color: 'var(--text-primary, #00ff41)' }}
                placeholder="feature/my-feature or abc1234"
              />
            </div>
            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity">
                <input type="checkbox" checked={createNewBranch} onChange={e => { setCreateNewBranch(e.target.checked); if (e.target.checked) setCreateDetach(false); }} />
                Create new branch
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity">
                <input type="checkbox" checked={createDetach} onChange={e => { setCreateDetach(e.target.checked); if (e.target.checked) setCreateNewBranch(false); }} />
                Detached HEAD
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 rounded text-xs opacity-50 hover:opacity-100 transition-opacity" style={{ border: '1px solid var(--border, #003300)' }}>
                Cancel
              </button>
              <button onClick={handleCreate} className="px-4 py-1.5 rounded text-xs font-bold" style={{ background: 'var(--accent, #00ff41)', color: '#000' }}>
                Create Worktree
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Isolation Dialog */}
      {showTaskCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="p-6 rounded-lg w-[420px] space-y-4" style={{ background: 'var(--panel-bg, #0a0a0a)', border: '1px solid var(--accent, #00ff41)' }}>
            <div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--accent, #00ff41)' }}>Isolate a Task</h3>
              <p className="text-[10px] opacity-50 mt-1">Create a dedicated worktree for the AI to work in. Changes happen in a separate branch, so your main work stays safe.</p>
            </div>
            <div>
              <label className="text-[10px] opacity-50 block mb-1">What should the AI work on?</label>
              <input
                value={taskDescription}
                onChange={e => setTaskDescription(e.target.value)}
                className="w-full px-3 py-2 rounded text-xs font-mono"
                style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid var(--border, #003300)', color: 'var(--text-primary, #00ff41)' }}
                placeholder="e.g., Refactor the authentication system"
              />
            </div>
            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity">
                <input type="radio" checked={taskLifecycle === 'temporary'} onChange={() => setTaskLifecycle('temporary')} />
                <div>
                  <span>Temporary</span>
                  <span className="block text-[9px] opacity-40">Auto-deleted when task completes</span>
                </div>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity">
                <input type="radio" checked={taskLifecycle === 'permanent'} onChange={() => setTaskLifecycle('permanent')} />
                <div>
                  <span>Permanent</span>
                  <span className="block text-[9px] opacity-40">Stays until you remove it</span>
                </div>
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowTaskCreate(false)} className="px-4 py-1.5 rounded text-xs opacity-50 hover:opacity-100 transition-opacity" style={{ border: '1px solid var(--border, #003300)' }}>
                Cancel
              </button>
              <button onClick={handleCreateTask} className="px-4 py-1.5 rounded text-xs font-bold" style={{ background: 'var(--accent, #00ff41)', color: '#000' }}>
                Create Task Worktree
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
