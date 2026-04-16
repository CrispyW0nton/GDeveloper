/**
 * TaskPlanCard — Sprint 16
 * Live-updating checklist card for task_plan tool output.
 * Renders inline in chat, updates as the plan progresses.
 */

import React from 'react';

interface TaskItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';
  priority: 'high' | 'medium' | 'low';
  notes?: string;
}

interface TaskPlan {
  id: string;
  created_at: string;
  updated_at: string;
  tasks: TaskItem[];
}

interface TaskPlanCardProps {
  plan: TaskPlan;
}

const STATUS_ICONS: Record<string, string> = {
  pending: '\u23F3',
  in_progress: '\uD83D\uDD04',
  done: '\u2705',
  skipped: '\u23ED\uFE0F',
  failed: '\u274C',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  done: 'Done',
  skipped: 'Skipped',
  failed: 'Failed',
};

export default function TaskPlanCard({ plan }: TaskPlanCardProps) {
  const done = plan.tasks.filter(t => t.status === 'done').length;
  const inProgress = plan.tasks.filter(t => t.status === 'in_progress').length;
  const failed = plan.tasks.filter(t => t.status === 'failed').length;
  const total = plan.tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="glass-panel p-3 rounded-lg space-y-3 mt-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">{'\uD83D\uDCCB'}</span>
          <span className="text-xs font-bold text-matrix-green">Task Plan</span>
          <span className="text-[9px] text-matrix-text-muted/30 font-mono">{plan.id}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[9px]">
          {inProgress > 0 && <span className="text-matrix-warning">{inProgress} active</span>}
          {failed > 0 && <span className="text-matrix-danger">{failed} failed</span>}
          <span className="text-matrix-green">{done}/{total} done</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-matrix-bg-elevated rounded-full overflow-hidden">
        <div
          className="h-full bg-matrix-green transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Task list */}
      <div className="space-y-1.5">
        {plan.tasks.map((task) => (
          <div key={task.id} className={`flex items-start gap-2 text-[10px] px-2 py-1 rounded transition-colors ${
            task.status === 'in_progress' ? 'bg-matrix-warning/5' :
            task.status === 'failed' ? 'bg-matrix-danger/5' : ''
          }`}>
            <span className="flex-shrink-0 mt-0.5">{STATUS_ICONS[task.status] || '\u2B55'}</span>
            <div className="flex-1 min-w-0">
              <span className={`${
                task.status === 'done' ? 'line-through text-matrix-text-muted/30' :
                task.status === 'in_progress' ? 'text-matrix-warning font-bold' :
                task.status === 'failed' ? 'text-matrix-danger' :
                task.status === 'skipped' ? 'text-matrix-text-muted/30 italic' :
                'text-matrix-text-dim'
              }`}>
                {task.content}
              </span>
              {task.notes && (
                <div className="text-[9px] text-matrix-text-muted/30 mt-0.5 italic">{task.notes}</div>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className={`text-[8px] uppercase px-1 py-0.5 rounded ${
                task.priority === 'high' ? 'text-matrix-danger bg-matrix-danger/5' :
                task.priority === 'low' ? 'text-matrix-text-muted/30' :
                'text-matrix-text-muted/50'
              }`}>{task.priority}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="text-[8px] text-matrix-text-muted/20 flex justify-between">
        <span>Updated: {new Date(plan.updated_at).toLocaleTimeString()}</span>
        <span>{pct}% complete</span>
      </div>
    </div>
  );
}
