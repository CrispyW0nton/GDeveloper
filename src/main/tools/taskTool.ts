/**
 * taskTool.ts — Sprint 27.3 (Canonical Agent Loop)
 *
 * Claude Code–compatible TodoWrite tool.
 * Matches the schema: { todos: TodoItem[] } where each item has
 * { id, content, status ('pending'|'in_progress'|'completed'), priority }.
 *
 * Design principles:
 *   1. Single in_progress task — enforced on every write
 *   2. Idempotent state replacement — full todo list is provided each call
 *   3. Broadcast on every mutation via todoManager → IPC → renderer
 *   4. Returns a model-readable summary (not raw JSON) for the assistant
 */

import {
  getTodoList, createTodoList, updateTodoItem,
  clearTodoList, getTodoProgress, isTodoComplete,
  setActive, completeActive, advanceToNextPending,
  getActiveTask, type TodoItem, type TodoStatus,
} from '../orchestration/todoManager';

// ─── Input/Output types ───

export interface TaskToolTodo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

export interface TaskToolInput {
  todos: TaskToolTodo[];
}

export interface TaskToolResult {
  success: boolean;
  message: string;
  todos: TaskToolTodo[];
  progress: { done: number; total: number; pending: string[] };
}

// ─── Session binding ───

let _sessionId: string = 'default';

export function setTaskToolSessionId(sessionId: string): void {
  _sessionId = sessionId;
}

// ─── Status mapping ───

function toTodoStatus(status: string): TodoStatus {
  switch (status) {
    case 'completed': return 'done';
    case 'in_progress': return 'in_progress';
    case 'pending': return 'pending';
    default: return 'pending';
  }
}

function fromTodoStatus(status: TodoStatus): 'pending' | 'in_progress' | 'completed' {
  switch (status) {
    case 'done':
    case 'skipped': return 'completed';
    case 'in_progress': return 'in_progress';
    case 'blocked': return 'pending';
    default: return 'pending';
  }
}

// ─── Core execution ───

/**
 * Execute the TodoWrite tool.
 * Replaces the entire todo list idempotently.
 * Enforces a single in_progress task.
 */
export function executeTaskTool(input: TaskToolInput): TaskToolResult {
  const { todos } = input;

  if (!todos || !Array.isArray(todos) || todos.length === 0) {
    return {
      success: false,
      message: 'Error: todos array is required and must not be empty.',
      todos: [],
      progress: { done: 0, total: 0, pending: [] },
    };
  }

  // Enforce single in_progress: if multiple are marked in_progress, keep only the first
  let foundInProgress = false;
  const sanitized: TaskToolTodo[] = todos.map(t => {
    const todo = { ...t };
    if (todo.status === 'in_progress') {
      if (foundInProgress) {
        todo.status = 'pending'; // Demote duplicates
      } else {
        foundInProgress = true;
      }
    }
    return todo;
  });

  // Clear existing and create fresh (idempotent replacement)
  clearTodoList(_sessionId);

  const todoItems = sanitized.map(t => ({
    id: t.id,
    content: t.content,
    status: toTodoStatus(t.status),
    priority: t.priority || 'medium',
  }));

  createTodoList(_sessionId, todoItems);

  // If there's an in_progress task, activate it
  const activeCandidate = sanitized.find(t => t.status === 'in_progress');
  if (activeCandidate) {
    setActive(_sessionId, activeCandidate.id);
  } else {
    // Auto-advance to first pending
    advanceToNextPending(_sessionId);
  }

  // Build summary
  const progress = getTodoProgress(_sessionId);
  const active = getActiveTask(_sessionId);
  const completedCount = sanitized.filter(t => t.status === 'completed').length;
  const pendingCount = sanitized.filter(t => t.status === 'pending').length;
  const inProgressCount = sanitized.filter(t => t.status === 'in_progress').length;

  const lines = [
    `Updated task list: ${sanitized.length} tasks total.`,
    `  ✓ ${completedCount} completed, → ${inProgressCount} in progress, ○ ${pendingCount} pending.`,
  ];
  if (active) {
    lines.push(`Active task: "${active.content}"`);
  }
  if (isTodoComplete(_sessionId)) {
    lines.push('All tasks are complete.');
  }

  return {
    success: true,
    message: lines.join('\n'),
    todos: sanitized,
    progress,
  };
}

// ─── Tool definition for the Anthropic tools array ───

export const TASK_TOOL_DEFINITION = {
  name: 'todo_write',
  description: 'Create and manage a structured task list for the current session. Replaces the entire todo list each time. Enforces a single in_progress task. Use this to track multi-step work.',
  input_schema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The updated todo list. Each call replaces the full list.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique identifier for the task' },
            content: { type: 'string', description: 'The task description' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Task status. Only one task should be in_progress at a time.',
            },
            priority: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Priority level',
            },
          },
          required: ['id', 'content', 'status', 'priority'],
        },
      },
    },
    required: ['todos'],
  },
};
