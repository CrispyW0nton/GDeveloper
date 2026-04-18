/**
 * TaskQueuePanel — Sprint 27.2
 * Collapsible inline panel showing live task-plan progress in the chat.
 * Subscribes to `todo:changed` IPC events for real-time updates.
 *
 * Design reference: AI Developer task queue panel
 * Header: "Task Plan | Total: N Tasks"
 * Subheader: "N Tasks Remaining" (live)
 * Indicators: active (filled), pending (circle), completed (check, optional strikethrough)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './TaskQueuePanel.css';

// ─── Types (mirroring todoManager.ts) ───

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'blocked';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
  updatedAt: string;
  notes?: string;
  files?: string[];
}

export interface TaskQueuePanelProps {
  tasks: TodoItem[];
  collapsed?: boolean;
  onToggleCollapse: () => void;
  sessionId?: string;
}

// ─── Status Rendering Helpers ───

const STATUS_CONFIG: Record<TodoStatus, {
  icon: string;
  label: string;
  indicatorClass: string;
  textClass: string;
}> = {
  in_progress: {
    icon: '\u29BE',   // circled bullet
    label: 'Active',
    indicatorClass: 'tqp-indicator--active',
    textClass: 'tqp-task-text--active',
  },
  pending: {
    icon: '\u25CB',   // white circle
    label: 'Pending',
    indicatorClass: 'tqp-indicator--pending',
    textClass: 'tqp-task-text--pending',
  },
  done: {
    icon: '\u2713',   // check mark
    label: 'Completed',
    indicatorClass: 'tqp-indicator--done',
    textClass: 'tqp-task-text--done',
  },
  skipped: {
    icon: '\u23ED',   // skip forward
    label: 'Skipped',
    indicatorClass: 'tqp-indicator--skipped',
    textClass: 'tqp-task-text--skipped',
  },
  blocked: {
    icon: '\u26D4',   // no entry
    label: 'Blocked',
    indicatorClass: 'tqp-indicator--blocked',
    textClass: 'tqp-task-text--blocked',
  },
};

const PRIORITY_BADGE: Record<string, string> = {
  high: 'tqp-priority--high',
  medium: 'tqp-priority--medium',
  low: 'tqp-priority--low',
};

// ─── Component ───

const api = (window as any).electronAPI;

export default function TaskQueuePanel({
  tasks: initialTasks,
  collapsed: controlledCollapsed,
  onToggleCollapse,
  sessionId,
}: TaskQueuePanelProps) {
  const [tasks, setTasks] = useState<TodoItem[]>(initialTasks);
  const [isCollapsed, setIsCollapsed] = useState(controlledCollapsed ?? false);
  const unsubRef = useRef<(() => void) | null>(null);

  // Sync controlled collapsed prop
  useEffect(() => {
    if (controlledCollapsed !== undefined) {
      setIsCollapsed(controlledCollapsed);
    }
  }, [controlledCollapsed]);

  // Sync incoming tasks prop
  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  // Subscribe to live todo:changed events from main process
  useEffect(() => {
    if (!api?.onTodoChanged) return;

    const unsub = api.onTodoChanged((data: any) => {
      // Filter by sessionId if provided
      if (sessionId && data.sessionId && data.sessionId !== sessionId) return;

      if (data.items && Array.isArray(data.items)) {
        setTasks(data.items);
      }
    });

    unsubRef.current = unsub;
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [sessionId]);

  // Derived counts
  const totalCount = tasks.length;
  const doneCount = tasks.filter(t => t.status === 'done' || t.status === 'skipped').length;
  const activeCount = tasks.filter(t => t.status === 'in_progress').length;
  const pendingCount = tasks.filter(t => t.status === 'pending').length;
  const blockedCount = tasks.filter(t => t.status === 'blocked').length;
  const remainingCount = totalCount - doneCount;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const handleToggle = useCallback(() => {
    setIsCollapsed(prev => !prev);
    onToggleCollapse();
  }, [onToggleCollapse]);

  if (totalCount === 0) return null;

  return (
    <div className="tqp-container" role="region" aria-label="Task queue panel">
      {/* ─── Header ─── */}
      <button
        className="tqp-header"
        onClick={handleToggle}
        aria-expanded={!isCollapsed}
        aria-controls="tqp-task-list"
        title={isCollapsed ? 'Expand task list' : 'Collapse task list'}
      >
        <div className="tqp-header-left">
          <span className="tqp-chevron" aria-hidden="true">
            {isCollapsed ? '\u25B6' : '\u25BC'}
          </span>
          <span className="tqp-header-icon" aria-hidden="true">{'\uD83D\uDCCB'}</span>
          <span className="tqp-header-title">Task Plan</span>
          <span className="tqp-header-divider" aria-hidden="true">|</span>
          <span className="tqp-header-count">
            Total: {totalCount} Task{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="tqp-header-right">
          {activeCount > 0 && (
            <span className="tqp-badge tqp-badge--active" aria-label={`${activeCount} active`}>
              {activeCount} active
            </span>
          )}
          {blockedCount > 0 && (
            <span className="tqp-badge tqp-badge--blocked" aria-label={`${blockedCount} blocked`}>
              {blockedCount} blocked
            </span>
          )}
          <span className="tqp-badge tqp-badge--progress" aria-label={`${doneCount} of ${totalCount} done`}>
            {doneCount}/{totalCount}
          </span>
        </div>
      </button>

      {/* ─── Subheader ─── */}
      <div className="tqp-subheader">
        <span className="tqp-remaining">
          {remainingCount > 0
            ? `${remainingCount} Task${remainingCount !== 1 ? 's' : ''} Remaining`
            : 'All tasks complete'}
        </span>
        <span className="tqp-pct">{progressPct}%</span>
      </div>

      {/* ─── Progress Bar ─── */}
      <div className="tqp-progress-track" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
        <div className="tqp-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {/* ─── Task List (collapsible) ─── */}
      {!isCollapsed && (
        <div id="tqp-task-list" className="tqp-list" role="list" aria-label="Task items">
          {tasks.map((task, idx) => {
            const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
            const priorityCls = PRIORITY_BADGE[task.priority] || PRIORITY_BADGE.medium;

            return (
              <div
                key={task.id}
                className={`tqp-task ${task.status === 'in_progress' ? 'tqp-task--active-row' : ''}`}
                role="listitem"
                aria-label={`Task ${idx + 1}: ${task.content}, status: ${cfg.label}`}
              >
                <span className={`tqp-indicator ${cfg.indicatorClass}`} aria-hidden="true">
                  {cfg.icon}
                </span>
                <div className="tqp-task-body">
                  <span className={`tqp-task-text ${cfg.textClass}`}>
                    {task.content}
                  </span>
                  {task.notes && (
                    <span className="tqp-task-notes">{task.notes}</span>
                  )}
                </div>
                <span className={`tqp-priority ${priorityCls}`}>
                  {task.priority}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Footer ─── */}
      <div className="tqp-footer">
        <span className="tqp-footer-status">
          {activeCount > 0 ? `Working on task ${tasks.findIndex(t => t.status === 'in_progress') + 1}...` : ''}
        </span>
        <span className="tqp-footer-pct">{progressPct}% complete</span>
      </div>
    </div>
  );
}
