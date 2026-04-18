/**
 * ActivityLog — Sprint 9 + Sprint 18
 * Timeline view of all app events: chat, git, tools, MCP, verification.
 * Sprint 18: improved labels, readable type names, relative timestamps,
 * better empty states, grouping hints, filter descriptions.
 */

import React, { useState, useEffect } from 'react';
import { SelectedRepo } from '../../store';

const api = (window as any).electronAPI;

interface ActivityLogProps {
  sessionId: string;
  repo: SelectedRepo;
}

interface ActivityItem {
  id: string;
  session_id: string;
  type: string;
  title: string;
  description: string;
  metadata: Record<string, any>;
  status: string;
  timestamp: string;
}

const TYPE_META: Record<string, { color: string; label: string; icon: string }> = {
  api_key_set:       { color: 'text-yellow-400',         label: 'API Key',      icon: '🔑' },
  github_connect:    { color: 'text-blue-400',           label: 'GitHub',       icon: '🔗' },
  github_disconnect: { color: 'text-red-400',            label: 'GitHub',       icon: '🔗' },
  repo_selected:     { color: 'text-matrix-green',       label: 'Repo',         icon: '📁' },
  chat_send:         { color: 'text-matrix-green',       label: 'Message Sent', icon: '💬' },
  chat_response:     { color: 'text-matrix-text-dim',    label: 'AI Response',  icon: '🤖' },
  chat_error:        { color: 'text-red-400',            label: 'Chat Error',   icon: '⚠' },
  chat_cleared:      { color: 'text-matrix-text-muted',  label: 'Chat Cleared', icon: '🧹' },
  task_updated:      { color: 'text-yellow-400',         label: 'Task Update',  icon: '📋' },
  branch_created:    { color: 'text-blue-400',           label: 'Branch',       icon: '🌿' },
  commit:            { color: 'text-matrix-green',       label: 'Git Commit',   icon: '✓' },
  git_commit:        { color: 'text-matrix-green',       label: 'Git Commit',   icon: '✓' },
  git_push:          { color: 'text-blue-400',           label: 'Git Push',     icon: '↑' },
  git_reset_soft:    { color: 'text-yellow-400',         label: 'Git Undo',     icon: '↩' },
  pr_created:        { color: 'text-matrix-green',       label: 'Pull Request', icon: '📤' },
  mcp_server_added:  { color: 'text-yellow-400',         label: 'MCP Added',    icon: '🔌' },
  mcp_connected:     { color: 'text-matrix-green',       label: 'MCP Online',   icon: '🔌' },
  tool_execute:      { color: 'text-blue-400',           label: 'Tool Call',    icon: '🔧' },
  tool_call:         { color: 'text-blue-400',           label: 'Tool Call',    icon: '🔧' },
  tool_result:       { color: 'text-matrix-green',       label: 'Tool Done',    icon: '✓' },
  tool_error:        { color: 'text-red-400',            label: 'Tool Error',   icon: '✕' },
  verification_run:  { color: 'text-blue-400',           label: 'Verification', icon: '🔍' },
  worktree_add:      { color: 'text-blue-400',           label: 'Worktree',     icon: '🌳' },
  worktree_remove:   { color: 'text-yellow-400',         label: 'Worktree',     icon: '🌳' },
  worktree_lock:     { color: 'text-yellow-400',         label: 'Worktree',     icon: '🔒' },
  worktree_unlock:   { color: 'text-matrix-green',       label: 'Worktree',     icon: '🔓' },
  worktree_prune:    { color: 'text-yellow-400',         label: 'Worktree',     icon: '🗑' },
  worktree_repair:   { color: 'text-blue-400',           label: 'Worktree',     icon: '🔧' },
  worktree_task:     { color: 'text-blue-400',           label: 'Task Worktree', icon: '🔬' },
};

const FILTER_OPTIONS = [
  { key: 'all',      label: 'All',       description: 'Everything' },
  { key: 'chat',     label: 'Chat',      description: 'Messages & responses' },
  { key: 'git',      label: 'Git',       description: 'Commits, pushes, branches' },
  { key: 'tool',     label: 'Tools',     description: 'Tool calls & results' },
  { key: 'worktree', label: 'Worktrees', description: 'Worktree operations' },
  { key: 'mcp',      label: 'MCP',       description: 'Server connections' },
  { key: 'task',     label: 'Tasks',     description: 'Task updates' },
];

function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export default function ActivityLog({ sessionId, repo }: ActivityLogProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const loadActivity = async () => {
    if (!api) { setLoading(false); return; }
    try {
      const result = await api.listActivity(sessionId);
      setActivities(result || []);
    } catch (err) {
      console.error('Failed to load activity:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadActivity();
    const interval = setInterval(loadActivity, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  const filtered = filter === 'all'
    ? activities
    : activities.filter(a => a.type.includes(filter));

  // Summary counts
  const chatCount = activities.filter(a => a.type === 'chat_send').length;
  const toolCount = activities.filter(a => a.type === 'tool_execute' || a.type === 'tool_call').length;
  const errorCount = activities.filter(a => a.status === 'error' || a.type.includes('error')).length;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-matrix-green glow-text flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Activity Log
          </h1>
          <p className="text-xs text-matrix-text-muted/50 mt-1">
            {repo.fullName} &mdash; Full audit trail of every action
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-3">
          <div className="glass-panel p-3 text-center">
            <div className="text-xl text-matrix-green font-bold">{activities.length}</div>
            <div className="text-[10px] text-matrix-text-muted/50 mt-0.5">Total Events</div>
          </div>
          <div className="glass-panel p-3 text-center">
            <div className="text-xl text-matrix-green font-bold">{chatCount}</div>
            <div className="text-[10px] text-matrix-text-muted/50 mt-0.5">Messages</div>
          </div>
          <div className="glass-panel p-3 text-center">
            <div className="text-xl text-blue-400 font-bold">{toolCount}</div>
            <div className="text-[10px] text-matrix-text-muted/50 mt-0.5">Tool Calls</div>
          </div>
          <div className="glass-panel p-3 text-center">
            <div className={`text-xl font-bold ${errorCount > 0 ? 'text-red-400' : 'text-matrix-green'}`}>{errorCount}</div>
            <div className="text-[10px] text-matrix-text-muted/50 mt-0.5">Errors</div>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[10px] px-3 py-1.5 rounded-full border transition-all duration-150 ${
                filter === f.key
                  ? 'border-matrix-green/40 bg-matrix-green/10 text-matrix-green font-bold'
                  : 'border-matrix-border/30 text-matrix-text-muted/40 hover:text-matrix-text-dim hover:border-matrix-border/50'
              }`}
              title={f.description}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Timeline */}
        {loading ? (
          <div className="glass-panel p-8 text-center">
            <span className="w-5 h-5 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin inline-block" />
            <p className="text-xs text-matrix-text-muted/40 mt-2">Loading activity...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-panel p-8 text-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto text-matrix-text-muted/20 mb-3">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <p className="text-xs text-matrix-text-muted/40 mb-1">
              {filter === 'all' ? 'No activity recorded yet.' : `No ${FILTER_OPTIONS.find(f => f.key === filter)?.label.toLowerCase()} events found.`}
            </p>
            <p className="text-[10px] text-matrix-text-muted/25">
              {filter === 'all'
                ? 'Events will appear as you chat, run commands, and use tools.'
                : 'Try a different filter or start using this feature.'}
            </p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-matrix-border/30" />
            <div className="space-y-2">
              {filtered.map(activity => {
                const meta = TYPE_META[activity.type] || { color: 'text-matrix-text-muted', label: activity.type.replace(/_/g, ' '), icon: '•' };
                return (
                  <div key={activity.id} className="flex gap-4 animate-fadeIn">
                    <div className={`relative z-10 w-8 h-8 rounded-full border flex items-center justify-center bg-matrix-bg text-sm ${
                      activity.status === 'success' ? 'border-matrix-green/20' :
                      activity.status === 'error' ? 'border-red-400/20' : 'border-matrix-border/30'
                    }`}>
                      <span className="text-[10px]">{meta.icon}</span>
                    </div>

                    <div className="flex-1 glass-panel p-3">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-matrix-green font-bold">{activity.title}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                            activity.status === 'success' ? 'border-matrix-green/20 text-matrix-green/50 bg-matrix-green/5' :
                            activity.status === 'error' ? 'border-red-400/20 text-red-400/50 bg-red-400/5' :
                            'border-matrix-border/20 text-matrix-text-muted/40'
                          }`}>{meta.label}</span>
                        </div>
                        <span className="text-[9px] text-matrix-text-muted/30" title={new Date(activity.timestamp).toLocaleString()}>
                          {relativeTime(activity.timestamp)}
                        </span>
                      </div>
                      {activity.description && (
                        <p className="text-[11px] text-matrix-text-muted/50 truncate">{activity.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
