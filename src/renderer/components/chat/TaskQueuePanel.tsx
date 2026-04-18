/**
 * TaskQueuePanel — Sprint 27.5
 *
 * Subscribes via window.gdev.onTodoChanged(setTodos) in useEffect.
 * Fetches initial todos via getTodoList() on mount.
 * Renders list with status icons:
 *   - pending
 *   - in_progress (spinning)
 *   - completed
 * Mounted inside ChatWorkspace, always visible above the message list.
 */

import React, { useState, useEffect } from 'react';

const api = (window as any).electronAPI;

// ─── Types ───

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

interface TaskQueuePanelProps {
  sessionId: string;
}

// ─── Status icons ───

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') {
    return <span style={{ color: '#00ff41', fontSize: '14px' }} title="Completed">{'\u2713'}</span>;
  }
  if (status === 'in_progress') {
    return (
      <span
        style={{
          display: 'inline-block',
          width: '14px',
          height: '14px',
          border: '2px solid #ffaa00',
          borderTop: '2px solid transparent',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }}
        title="In Progress"
      />
    );
  }
  // pending
  return <span style={{ color: '#666', fontSize: '14px' }} title="Pending">{'\u25CB'}</span>;
}

// ─── Component ───

const TaskQueuePanel: React.FC<TaskQueuePanelProps> = ({ sessionId }) => {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  // Subscribe to live updates via IPC
  useEffect(() => {
    const cleanup = api?.onTodoChanged?.((_event: any, updatedTodos: TodoItem[]) => {
      setTodos(updatedTodos || []);
    });

    // Also fetch initial state
    api?.getTodoList?.(sessionId).then((list: any) => {
      if (list && list.items) {
        setTodos(list.items);
      }
    }).catch(() => {});

    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [sessionId]);

  if (todos.length === 0) return null;

  const completed = todos.filter(t => t.status === 'completed').length;
  const total = todos.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div style={{
      margin: '0 0 8px 0',
      padding: '8px 12px',
      background: 'rgba(0, 255, 65, 0.04)',
      border: '1px solid rgba(0, 255, 65, 0.15)',
      borderRadius: '6px',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: '12px',
    }}>
      {/* Keyframe for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          color: '#00ff41',
          marginBottom: collapsed ? 0 : '6px',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span>{collapsed ? '\u25B6' : '\u25BC'}</span>
        <span style={{ fontWeight: 600 }}>Tasks</span>
        <span style={{ color: '#888', fontWeight: 400 }}>
          {completed}/{total} ({progressPct}%)
        </span>
        {/* Progress bar */}
        <div style={{
          flex: 1,
          height: '4px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '2px',
          overflow: 'hidden',
          marginLeft: '8px',
        }}>
          <div style={{
            width: `${progressPct}%`,
            height: '100%',
            background: '#00ff41',
            borderRadius: '2px',
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Task list */}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {todos.map(todo => (
            <div
              key={todo.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '2px 0',
                color: todo.status === 'completed' ? '#666' : '#b0b0b0',
                textDecoration: todo.status === 'completed' ? 'line-through' : 'none',
              }}
            >
              <StatusIcon status={todo.status} />
              <span style={{ flex: 1 }}>{todo.content}</span>
              {todo.priority === 'high' && (
                <span style={{ color: '#ff3c3c', fontSize: '10px' }}>HIGH</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TaskQueuePanel;
