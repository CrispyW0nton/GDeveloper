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

const TYPE_ICONS: Record<string, { color: string; label: string }> = {
  api_key_set: { color: 'text-matrix-warning', label: 'API Key' },
  github_connect: { color: 'text-matrix-info', label: 'GitHub' },
  github_disconnect: { color: 'text-matrix-danger', label: 'GitHub' },
  repo_selected: { color: 'text-matrix-green', label: 'Repo' },
  chat_send: { color: 'text-matrix-green', label: 'Chat' },
  chat_response: { color: 'text-matrix-text-dim', label: 'AI' },
  chat_error: { color: 'text-matrix-danger', label: 'Error' },
  chat_cleared: { color: 'text-matrix-text-muted', label: 'Chat' },
  task_updated: { color: 'text-matrix-warning', label: 'Task' },
  branch_created: { color: 'text-matrix-info', label: 'Branch' },
  commit: { color: 'text-matrix-green', label: 'Commit' },
  pr_created: { color: 'text-matrix-green', label: 'PR' },
  mcp_server_added: { color: 'text-matrix-warning', label: 'MCP' },
  mcp_connected: { color: 'text-matrix-green', label: 'MCP' },
  tool_execute: { color: 'text-matrix-info', label: 'Tool' },
  verification_run: { color: 'text-matrix-info', label: 'Verify' },
};

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
  const taskCount = activities.filter(a => a.type === 'task_updated').length;
  const errorCount = activities.filter(a => a.status === 'error').length;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-matrix-green glow-text flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Activity Log
          </h1>
          <p className="text-xs text-matrix-text-muted/50 mt-1">{repo.fullName} - Real-time event stream</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-3">
          <div className="glass-panel p-3 text-center">
            <div className="text-xl text-matrix-green font-bold">{activities.length}</div>
            <div className="text-[10px] text-matrix-text-muted/40 uppercase">Total Events</div>
          </div>
          <div className="glass-panel p-3 text-center">
            <div className="text-xl text-matrix-green font-bold">{chatCount}</div>
            <div className="text-[10px] text-matrix-text-muted/40 uppercase">Messages</div>
          </div>
          <div className="glass-panel p-3 text-center">
            <div className="text-xl text-matrix-green font-bold">{taskCount}</div>
            <div className="text-[10px] text-matrix-text-muted/40 uppercase">Task Updates</div>
          </div>
          <div className="glass-panel p-3 text-center">
            <div className={`text-xl font-bold ${errorCount > 0 ? 'text-matrix-danger' : 'text-matrix-green'}`}>{errorCount}</div>
            <div className="text-[10px] text-matrix-text-muted/40 uppercase">Errors</div>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2">
          {['all', 'chat', 'task', 'github', 'mcp', 'tool'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-3 py-1 rounded border transition-all ${
                filter === f
                  ? 'border-matrix-green bg-matrix-green/10 text-matrix-green'
                  : 'border-matrix-border text-matrix-text-muted/40 hover:text-matrix-green'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
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
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto text-matrix-text-muted/20 mb-2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <p className="text-xs text-matrix-text-muted/30">
              {filter === 'all' ? 'No activity recorded yet. Events will appear as you use the app.' : `No ${filter} events found.`}
            </p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-matrix-border" />
            <div className="space-y-3">
              {filtered.map(activity => {
                const typeInfo = TYPE_ICONS[activity.type] || { color: 'text-matrix-text-muted', label: activity.type };
                return (
                  <div key={activity.id} className="flex gap-4 animate-fadeIn">
                    <div className={`relative z-10 w-8 h-8 rounded-full border flex items-center justify-center bg-matrix-bg ${
                      activity.status === 'success' ? 'border-matrix-green/30' :
                      activity.status === 'error' ? 'border-matrix-danger/30' : 'border-matrix-border'
                    }`}>
                      <span className={`text-[8px] font-bold ${typeInfo.color}`}>{typeInfo.label.charAt(0)}</span>
                    </div>

                    <div className="flex-1 glass-panel p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-matrix-green font-bold">{activity.title}</span>
                          <span className={`badge text-[8px] ${
                            activity.status === 'success' ? 'badge-done' :
                            activity.status === 'error' ? 'badge-blocked' : 'badge-planned'
                          }`}>{typeInfo.label}</span>
                        </div>
                        <span className="text-[9px] text-matrix-text-muted/30">
                          {new Date(activity.timestamp).toLocaleTimeString()}
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
