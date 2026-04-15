import React, { useState } from 'react';

interface TaskLedgerPanelProps {
  sessionId: string;
}

interface DemoTask {
  id: string;
  title: string;
  status: 'DONE' | 'EXECUTING' | 'VERIFYING' | 'PLANNED' | 'BLOCKED' | 'SCOPED' | 'COMMIT_READY' | 'PR_READY';
  turnCount: number;
  maxTurns: number;
  tokenUsed: number;
  tokenBudget: number;
  retryCount: number;
  branch: string;
  fileScope: string[];
  filesTouched: string[];
  acceptanceCriteria: Array<{ desc: string; met: boolean }>;
  priority: 'low' | 'medium' | 'high' | 'critical';
  complexity: 'low' | 'medium' | 'high';
}

const DEMO_TASKS: DemoTask[] = [
  {
    id: 'task-1',
    title: 'Set up authentication module',
    status: 'DONE',
    turnCount: 12,
    maxTurns: 50,
    tokenUsed: 45000,
    tokenBudget: 500000,
    retryCount: 0,
    branch: 'ai/auth-setup',
    fileScope: ['src/auth/login.ts', 'src/auth/register.ts'],
    filesTouched: ['src/auth/login.ts', 'src/auth/register.ts', 'src/auth/middleware.ts'],
    acceptanceCriteria: [
      { desc: 'JWT token generation works', met: true },
      { desc: 'Password hashing implemented', met: true },
      { desc: 'Unit tests pass', met: true }
    ],
    priority: 'high',
    complexity: 'medium'
  },
  {
    id: 'task-2',
    title: 'Implement user API endpoints',
    status: 'EXECUTING',
    turnCount: 5,
    maxTurns: 50,
    tokenUsed: 18000,
    tokenBudget: 500000,
    retryCount: 0,
    branch: 'ai/user-api',
    fileScope: ['src/api/users.ts', 'src/api/middleware.ts'],
    filesTouched: ['src/api/users.ts'],
    acceptanceCriteria: [
      { desc: 'CRUD operations functional', met: false },
      { desc: 'Input validation added', met: false },
      { desc: 'Error handling complete', met: false }
    ],
    priority: 'high',
    complexity: 'medium'
  },
  {
    id: 'task-3',
    title: 'Database schema migration',
    status: 'PLANNED',
    turnCount: 0,
    maxTurns: 50,
    tokenUsed: 3000,
    tokenBudget: 500000,
    retryCount: 0,
    branch: 'ai/db-schema',
    fileScope: ['src/db/schema.ts', 'src/db/migrations/*.ts'],
    filesTouched: [],
    acceptanceCriteria: [
      { desc: 'Migration runs without errors', met: false },
      { desc: 'Schema matches spec', met: false }
    ],
    priority: 'medium',
    complexity: 'high'
  },
  {
    id: 'task-4',
    title: 'Integrate MCP server tools',
    status: 'BLOCKED',
    turnCount: 3,
    maxTurns: 50,
    tokenUsed: 8000,
    tokenBudget: 500000,
    retryCount: 2,
    branch: 'ai/mcp-integration',
    fileScope: ['src/mcp/client.ts', 'src/tools/registry.ts'],
    filesTouched: ['src/mcp/client.ts'],
    acceptanceCriteria: [
      { desc: 'MCP tools registered in tool registry', met: false },
      { desc: 'Stdio transport working', met: false }
    ],
    priority: 'medium',
    complexity: 'high'
  }
];

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  DONE: { bg: 'badge-done', text: 'text-matrix-green', label: 'Done' },
  EXECUTING: { bg: 'badge-executing', text: 'text-matrix-green', label: 'Executing' },
  VERIFYING: { bg: 'badge-verifying', text: 'text-matrix-info', label: 'Verifying' },
  PLANNED: { bg: 'badge-planned', text: 'text-matrix-warning', label: 'Planned' },
  BLOCKED: { bg: 'badge-blocked', text: 'text-matrix-danger', label: 'Blocked' },
  SCOPED: { bg: 'badge-planned', text: 'text-matrix-warning', label: 'Scoped' },
  COMMIT_READY: { bg: 'badge-done', text: 'text-matrix-green', label: 'Commit Ready' },
  PR_READY: { bg: 'badge-done', text: 'text-matrix-green', label: 'PR Ready' },
  TASK_CREATED: { bg: 'badge-disconnected', text: 'text-gray-400', label: 'Created' }
};

export default function TaskLedgerPanel({ sessionId }: TaskLedgerPanelProps) {
  const [tasks] = useState<DemoTask[]>(DEMO_TASKS);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

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
          <p className="text-[9px] text-matrix-text-muted/30 mt-0.5">{"State Machine: CREATED → SCOPED → PLANNED → EXECUTING → VERIFYING → DONE"}</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tasks.map(task => {
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
                  <span>Turn {task.turnCount}/{task.maxTurns}</span>
                  <span>{Math.round(task.tokenUsed / task.tokenBudget * 100)}% tokens</span>
                </div>
                <div className="mt-1.5">
                  <div className="matrix-progress">
                    <div className="matrix-progress-bar" style={{ width: `${task.turnCount / task.maxTurns * 100}%` }} />
                  </div>
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
            {/* Task Header */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-lg font-bold text-matrix-green">{selected.title}</h3>
                <span className={`badge ${STATUS_CONFIG[selected.status].bg}`}>{STATUS_CONFIG[selected.status].label}</span>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-matrix-text-muted/40">
                <span>Branch: <code className="text-matrix-green">{selected.branch}</code></span>
                <span>Priority: <span className="text-matrix-warning">{selected.priority}</span></span>
                <span>Complexity: <span className="text-matrix-info">{selected.complexity}</span></span>
              </div>
            </div>

            {/* Progress Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="glass-panel p-3">
                <div className="text-[10px] text-matrix-text-muted/40 uppercase tracking-wider mb-1">Turns</div>
                <div className="text-lg text-matrix-green font-bold">{selected.turnCount}<span className="text-xs text-matrix-text-muted/30">/{selected.maxTurns}</span></div>
                <div className="matrix-progress mt-1">
                  <div className="matrix-progress-bar" style={{ width: `${selected.turnCount / selected.maxTurns * 100}%` }} />
                </div>
              </div>
              <div className="glass-panel p-3">
                <div className="text-[10px] text-matrix-text-muted/40 uppercase tracking-wider mb-1">Tokens</div>
                <div className="text-lg text-matrix-green font-bold">{(selected.tokenUsed / 1000).toFixed(0)}k<span className="text-xs text-matrix-text-muted/30">/{(selected.tokenBudget / 1000).toFixed(0)}k</span></div>
                <div className="matrix-progress mt-1">
                  <div className="matrix-progress-bar" style={{ width: `${selected.tokenUsed / selected.tokenBudget * 100}%` }} />
                </div>
              </div>
              <div className="glass-panel p-3">
                <div className="text-[10px] text-matrix-text-muted/40 uppercase tracking-wider mb-1">Retries</div>
                <div className="text-lg text-matrix-green font-bold">{selected.retryCount}<span className="text-xs text-matrix-text-muted/30">/3</span></div>
                <div className="text-[10px] text-matrix-text-muted/30 mt-1">{selected.branch}</div>
              </div>
            </div>

            {/* Acceptance Criteria */}
            <div className="glass-panel p-4">
              <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-3">Acceptance Criteria</h4>
              <div className="space-y-2">
                {selected.acceptanceCriteria.map((ac, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                      ac.met ? 'border-matrix-green bg-matrix-green/10' : 'border-matrix-border'
                    }`}>
                      {ac.met && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                    </span>
                    <span className={ac.met ? 'text-matrix-green' : 'text-matrix-text-muted/50'}>{ac.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* File Scope */}
            <div className="glass-panel p-4">
              <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-2">File Scope</h4>
              <div className="flex flex-wrap gap-1.5">
                {selected.fileScope.map((f, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-matrix-bg-hover border border-matrix-border text-matrix-text-dim">{f}</span>
                ))}
              </div>
            </div>

            {/* Files Touched */}
            {selected.filesTouched.length > 0 && (
              <div className="glass-panel p-4">
                <h4 className="text-[10px] text-matrix-text-muted/50 uppercase tracking-wider mb-2">Files Touched</h4>
                <div className="flex flex-wrap gap-1.5">
                  {selected.filesTouched.map((f, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-matrix-green/5 border border-matrix-green/20 text-matrix-green">{f}</span>
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
