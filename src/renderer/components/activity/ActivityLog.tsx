import React, { useState } from 'react';
import { SelectedRepo } from '../../store';

interface ActivityLogProps {
  sessionId: string;
  repo: SelectedRepo;
}

interface ActivityItem {
  id: string;
  type: 'branch_created' | 'commit' | 'pr_created' | 'pr_merged' | 'task_completed' | 'verification' | 'mcp_connected';
  title: string;
  description: string;
  branch?: string;
  sha?: string;
  prNumber?: number;
  status: 'success' | 'pending' | 'error';
  timestamp: string;
}

const DEMO_ACTIVITY: ActivityItem[] = [
  {
    id: 'act-1',
    type: 'branch_created',
    title: 'Created branch ai/auth-setup',
    description: 'New feature branch for authentication module implementation',
    branch: 'ai/auth-setup',
    status: 'success',
    timestamp: '2026-04-15T09:00:00Z'
  },
  {
    id: 'act-2',
    type: 'commit',
    title: 'feat(auth): implement JWT authentication',
    description: 'Added JWT token generation, bcrypt password hashing, and user repository integration',
    branch: 'ai/auth-setup',
    sha: 'a1b2c3d',
    status: 'success',
    timestamp: '2026-04-15T09:15:00Z'
  },
  {
    id: 'act-3',
    type: 'verification',
    title: 'Verification passed for auth module',
    description: 'Unit Tests: 12/12 passed | ESLint: 0 errors | TypeScript: clean | Build: 4.2s',
    branch: 'ai/auth-setup',
    status: 'success',
    timestamp: '2026-04-15T09:18:00Z'
  },
  {
    id: 'act-4',
    type: 'commit',
    title: 'feat(auth): add user registration endpoint',
    description: 'Implemented user registration with email validation and password hashing',
    branch: 'ai/auth-setup',
    sha: 'e4f5g6h',
    status: 'success',
    timestamp: '2026-04-15T09:25:00Z'
  },
  {
    id: 'act-5',
    type: 'pr_created',
    title: 'PR #42: Authentication Module',
    description: 'Pull request opened: JWT auth, user registration, middleware integration',
    branch: 'ai/auth-setup',
    prNumber: 42,
    status: 'success',
    timestamp: '2026-04-15T09:30:00Z'
  },
  {
    id: 'act-6',
    type: 'task_completed',
    title: 'Task completed: Set up authentication module',
    description: 'All acceptance criteria met. 3 files modified, 12 turns, 45k tokens used.',
    branch: 'ai/auth-setup',
    status: 'success',
    timestamp: '2026-04-15T09:32:00Z'
  },
  {
    id: 'act-7',
    type: 'mcp_connected',
    title: 'MCP Server connected: Filesystem Server',
    description: '4 tools discovered and registered: fs_read, fs_write, fs_list, fs_search',
    status: 'success',
    timestamp: '2026-04-15T08:45:00Z'
  },
  {
    id: 'act-8',
    type: 'branch_created',
    title: 'Created branch ai/user-api',
    description: 'New feature branch for user API endpoints',
    branch: 'ai/user-api',
    status: 'pending',
    timestamp: '2026-04-15T09:35:00Z'
  }
];

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  branch_created: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>,
    color: 'text-matrix-info'
  },
  commit: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>,
    color: 'text-matrix-green'
  },
  pr_created: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 012 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>,
    color: 'text-matrix-green'
  },
  pr_merged: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 009 9"/></svg>,
    color: 'text-matrix-accent'
  },
  task_completed: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
    color: 'text-matrix-green'
  },
  verification: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    color: 'text-matrix-info'
  },
  mcp_connected: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="6" rx="1"/><circle cx="6" cy="6" r="1" fill="currentColor"/></svg>,
    color: 'text-matrix-warning'
  }
};

export default function ActivityLog({ sessionId, repo }: ActivityLogProps) {
  const [activities] = useState<ActivityItem[]>(DEMO_ACTIVITY);

  // Summary counts
  const branches = activities.filter(a => a.type === 'branch_created').length;
  const commits = activities.filter(a => a.type === 'commit').length;
  const prs = activities.filter(a => a.type === 'pr_created' || a.type === 'pr_merged').length;
  const tasks = activities.filter(a => a.type === 'task_completed').length;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-matrix-green glow-text flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Activity Log
          </h1>
          <p className="text-xs text-matrix-text-muted/50 mt-1">{repo.fullName} - Branch activity, commits, and pull requests</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-3">
          <div className="glass-panel p-3 text-center">
            <div className="text-xl text-matrix-green font-bold">{branches}</div>
            <div className="text-[10px] text-matrix-text-muted/40 uppercase">Branches</div>
          </div>
          <div className="glass-panel p-3 text-center">
            <div className="text-xl text-matrix-green font-bold">{commits}</div>
            <div className="text-[10px] text-matrix-text-muted/40 uppercase">Commits</div>
          </div>
          <div className="glass-panel p-3 text-center">
            <div className="text-xl text-matrix-green font-bold">{prs}</div>
            <div className="text-[10px] text-matrix-text-muted/40 uppercase">Pull Requests</div>
          </div>
          <div className="glass-panel p-3 text-center">
            <div className="text-xl text-matrix-green font-bold">{tasks}</div>
            <div className="text-[10px] text-matrix-text-muted/40 uppercase">Tasks Done</div>
          </div>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-matrix-border" />

          <div className="space-y-4">
            {activities.map(activity => {
              const config = TYPE_CONFIG[activity.type] || TYPE_CONFIG.commit;
              return (
                <div key={activity.id} className="flex gap-4 animate-fadeIn">
                  {/* Icon */}
                  <div className={`relative z-10 w-8 h-8 rounded-full border flex items-center justify-center bg-matrix-bg ${
                    activity.status === 'success' ? 'border-matrix-green/30' : activity.status === 'error' ? 'border-matrix-danger/30' : 'border-matrix-border'
                  }`}>
                    <span className={config.color}>{config.icon}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 glass-panel p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-matrix-green font-bold">{activity.title}</span>
                      <span className="text-[9px] text-matrix-text-muted/30">
                        {new Date(activity.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-[11px] text-matrix-text-muted/50">{activity.description}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-matrix-text-muted/30">
                      {activity.branch && <span>branch: <code className="text-matrix-green/60">{activity.branch}</code></span>}
                      {activity.sha && <span>sha: <code className="text-matrix-green/60">{activity.sha}</code></span>}
                      {activity.prNumber && <span>PR: <code className="text-matrix-green/60">#{activity.prNumber}</code></span>}
                      {activity.status === 'success' && activity.type === 'pr_created' && (
                        <span className="badge badge-done text-[8px]">Checks Pass</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
