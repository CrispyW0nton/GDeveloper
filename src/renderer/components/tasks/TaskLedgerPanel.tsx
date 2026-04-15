import React, { useState, useEffect } from 'react';

const api = (window as any).electronAPI;

interface TaskLedgerPanelProps {
  sessionId: string;
}

interface TaskRecord {
  id: string;
  session_id: string;
  title: string;
  description: string;
  status: string;
  file_scope: string[];
  acceptance_criteria: string[];
  verification_evidence: string[];
  created_at: string;
  updated_at: string;
  transitions?: Array<{
    id: string;
    from_status: string;
    to_status: string;
    reason: string;
    timestamp: string;
  }>;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  TASK_CREATED: { bg: 'badge-disconnected', text: 'text-gray-400', label: 'Created' },
  SCOPED: { bg: 'badge-planned', text: 'text-matrix-warning', label: 'Scoped' },
  PLANNED: { bg: 'badge-planned', text: 'text-matrix-warning', label: 'Planned' },
  EXECUTING: { bg: 'badge-executing', text: 'text-matrix-green', label: 'Executing' },
  VERIFYING: { bg: 'badge-verifying', text: 'text-matrix-info', label: 'Verifying' },
  COMMIT_READY: { bg: 'badge-done', text: 'text-matrix-green', label: 'Commit Ready' },
  PR_READY: { bg: 'badge-done', text: 'text-matrix-green', label: 'PR Ready' },
  DONE: { bg: 'badge-done', text: 'text-matrix-green', label: 'Done' },
  BLOCKED: { bg: 'badge-blocked', text: 'text-matrix-danger', label: 'Blocked' }
};

export default function TaskLedgerPanel({ sessionId }: TaskLedgerPanelProps) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTasks = async () => {
    if (!api) { setLoading(false); return; }
    try {
      const result = await api.listTasks(sessionId);
      setTasks(result || []);
    } catch (err) {
      console.error('Failed to load tasks:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTasks();
    // Poll for updates every 5 seconds
    const interval = setInterval(loadTasks, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // Load task details when selected
  useEffect(() => {
    if (selectedTask && api) {
      api.getTask(selectedTask).then((task: any) => {
        if (task) {
          setTasks(prev => prev.map(t => t.id === selectedTask ? { ...t, ...task } : t));
        }
      });
    }
  }, [selectedTask]);

  const selected = tasks.find(t => t.id === selectedTask);

  return (
    <div className="h-full flex">
      {/* Task List */}
      <div className="w-80 border-r border-matrix-border flex flex-col">
        <div className="px-4 py-3 border-b border-matrix-border">
          <h2 className="text-sm font-bold text-matrix-green glow-text-dim flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            Task Ledger
          </h2>
          <p className="text-[9px] text-matrix-text-muted/30 mt-0.5">
            {tasks.length > 0 ? `${tasks.length} task(s) recorded` : 'Tasks from chat sessions appear here'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center">
              <span className="w-4 h-4 border-2 border-matrix-green/30 border-t-matrix-green rounded-full animate-spin inline-block" />
              <p className="text-[10px] text-matrix-text-muted/40 mt-2">Loading tasks...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="p-6 text-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto text-matrix-text-muted/20 mb-2">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
              </svg>
              <p className="text-[10px] text-matrix-text-muted/30">
                No tasks yet. Send a message in Chat to create tasks automatically.
              </p>
            </div>
          ) : tasks.map(task => {
            const sc = STATUS_CONFIG[task.status] || STATUS_CONFIG.TASK_CREATED;
            return (
              <button
                key={task.id}
                onClick={() => setSelectedTask(task.id)}
                className={`w-full px-4 py-3 text-left border-b border-matrix-border/30 transition-all ${
                  selectedTask === task.id ? 'bg-matrix-green/5 border-l-2 border-l-matrix-green' : 'hover:bg-matrix-bg-hover'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-matrix-green font-bold truncate flex-1">{task.title}</span>
                  <span className={`badge ${sc.bg} text-[8px] ml-2`}>{sc.label}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-matrix-text-muted/40">
                  <span>{new Date(task.created_at).toLocaleDateString()}</span>
                  <span>{new Date(task.created_at).toLocaleTimeString()}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Task Detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="p-6 space-y-5">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-lg font-bold text-matrix-green">{selected.title}</h3>
                <span className={`badge ${(STATUS_CONFIG[selected.status] || STATUS_CONFIG.TASK_CREATED).bg}`}>
                  {(STATUS_CONFIG[selected.status] || STATUS_CONFIG.TASK_CREATED).label}
                </span>
              </div>
              <div className="text-xs text-matrix-text-muted/50 mb-3">{selected.description}</div>
              <div className="flex items-center gap-4 text-[10px] text-matrix-text-muted/40">
                <span>Created: {new Date(selected.created_at).toLocaleString()}</span>
                <span>Updated: {new Date(selected.updated_at).toLocaleString()}</span>
              </div>
            </div>

            {/* State Transitions */}
            {selected.transitions && selected.transitions.length > 0 && (
              <div className="glass-panel p-4">
                <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-3">State Transitions</h4>
                <div className="space-y-2">
                  {selected.transitions.map((t, i) => (
                    <div key={i} className="flex items-center gap-3 text-[10px]">
                      <span className="text-matrix-text-muted/30 w-20">{new Date(t.timestamp).toLocaleTimeString()}</span>
                      {t.from_status && (
                        <>
                          <span className={`badge ${(STATUS_CONFIG[t.from_status] || STATUS_CONFIG.TASK_CREATED).bg} text-[8px]`}>
                            {t.from_status}
                          </span>
                          <span className="text-matrix-text-muted/30">-&gt;</span>
                        </>
                      )}
                      <span className={`badge ${(STATUS_CONFIG[t.to_status] || STATUS_CONFIG.TASK_CREATED).bg} text-[8px]`}>
                        {t.to_status}
                      </span>
                      {t.reason && <span className="text-matrix-text-muted/40">{t.reason}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* File Scope */}
            {selected.file_scope && selected.file_scope.length > 0 && (
              <div className="glass-panel p-4">
                <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-2">File Scope</h4>
                <div className="flex flex-wrap gap-1.5">
                  {selected.file_scope.map((f, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-matrix-bg-hover border border-matrix-border text-matrix-text-dim">{f}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Acceptance Criteria */}
            {selected.acceptance_criteria && selected.acceptance_criteria.length > 0 && (
              <div className="glass-panel p-4">
                <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-3">Acceptance Criteria</h4>
                <div className="space-y-2">
                  {selected.acceptance_criteria.map((ac, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-matrix-text-muted/50">
                      <span className="w-4 h-4 rounded border border-matrix-border flex items-center justify-center">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-matrix-text-muted/30"><polyline points="20 6 9 17 4 12"/></svg>
                      </span>
                      {ac}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto text-matrix-text-muted/20 mb-3"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
              <p className="text-xs text-matrix-text-muted/30">Select a task to view details</p>
              <p className="text-[10px] text-matrix-text-muted/20 mt-1">Tasks are created automatically from chat sessions</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
