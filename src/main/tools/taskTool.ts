/**
 * Task Tool — Sprint 27.5
 *
 * Matches Claude Code's TodoWrite schema verbatim.
 * Single tool named "todo" (not "task_plan").
 *
 * Input: { todos: Array<{ id, content, status, priority }> }
 * status enum: "pending" | "in_progress" | "completed"
 * Validation: exactly zero or one task may be in_progress
 * Idempotent: replaces the full list on each call
 * Broadcasts via IPC: webContents.send("todo:changed", todos)
 *
 * Reference: Claude Code TodoWrite tool schema
 * https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/system-prompts/tool-description-todowrite.md
 */

import { BrowserWindow } from 'electron';

// ─── Types ───

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: 'high' | 'medium' | 'low';
}

export interface TodoWriteInput {
  todos: Array<{
    id: string;
    content: string;
    status: TodoStatus;
    priority: 'high' | 'medium' | 'low';
  }>;
}

// ─── Tool definition for Anthropic API ───

export const TODO_TOOL_DEFINITION = {
  name: 'todo',
  description: `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.

When to Use: Complex multi-step tasks (3+ steps), user provides multiple tasks, after receiving new instructions.
When NOT to Use: Single straightforward task, trivial tasks (< 3 steps), purely conversational.

Task States: pending (not started), in_progress (currently working on, limit to ONE at a time), completed (finished).

IMPORTANT: Call this tool with the FULL updated list each time. Only ONE task should be in_progress at any time. Mark tasks completed IMMEDIATELY after finishing.`,
  input_schema: {
    type: 'object' as const,
    required: ['todos'],
    properties: {
      todos: {
        type: 'array' as const,
        description: 'The complete, updated todo list. Replaces the previous list entirely.',
        items: {
          type: 'object' as const,
          required: ['id', 'content', 'status', 'priority'],
          properties: {
            id: { type: 'string' as const, description: 'Unique identifier for the task (string)' },
            content: { type: 'string' as const, description: 'The task description', minLength: 1 },
            status: {
              type: 'string' as const,
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Current status of the task',
            },
            priority: {
              type: 'string' as const,
              enum: ['high', 'medium', 'low'],
              description: 'Priority level',
            },
          },
        },
      },
    },
  },
};

// ─── In-memory store ───

let _todos: TodoItem[] = [];
let _win: BrowserWindow | null = null;

export function setTodoWindow(win: BrowserWindow | null): void {
  _win = win;
}

export function getTodos(): TodoItem[] {
  return [..._todos];
}

// ─── Broadcast ───

function broadcast(): void {
  if (_win && !_win.isDestroyed()) {
    _win.webContents.send('todo:changed', [..._todos]);
  }
}

// ─── Execute the todo tool ───

export function executeTodo(input: TodoWriteInput): { content: string; isError: boolean } {
  // Validate input
  if (!input.todos || !Array.isArray(input.todos)) {
    return { content: 'Error: "todos" must be an array.', isError: true };
  }

  // Validate: at most one in_progress
  const inProgress = input.todos.filter(t => t.status === 'in_progress');
  if (inProgress.length > 1) {
    return {
      content: `Error: Exactly zero or one task may be in_progress. Found ${inProgress.length}: ${inProgress.map(t => t.id).join(', ')}`,
      isError: true,
    };
  }

  // Validate each item
  for (const item of input.todos) {
    if (!item.id || typeof item.id !== 'string') {
      return { content: 'Error: Each todo must have a string "id".', isError: true };
    }
    if (!item.content || typeof item.content !== 'string') {
      return { content: `Error: Todo "${item.id}" must have a non-empty "content" string.`, isError: true };
    }
    if (!['pending', 'in_progress', 'completed'].includes(item.status)) {
      return { content: `Error: Todo "${item.id}" has invalid status "${item.status}". Must be pending, in_progress, or completed.`, isError: true };
    }
    if (!['high', 'medium', 'low'].includes(item.priority)) {
      return { content: `Error: Todo "${item.id}" has invalid priority "${item.priority}". Must be high, medium, or low.`, isError: true };
    }
  }

  // Idempotent replacement
  _todos = input.todos.map(t => ({
    id: t.id,
    content: t.content,
    status: t.status,
    priority: t.priority,
  }));

  // Broadcast to renderer
  broadcast();

  // Build model-readable summary
  const total = _todos.length;
  const completed = _todos.filter(t => t.status === 'completed').length;
  const pending = _todos.filter(t => t.status === 'pending').length;
  const active = inProgress[0];

  let summary = `Todo list updated: ${completed}/${total} completed, ${pending} pending.`;
  if (active) {
    summary += ` Active: "${active.content}"`;
  }

  return { content: summary, isError: false };
}
