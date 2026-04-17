/**
 * Todo Manager — Sprint 27
 * In-memory task ledger used by the Ralph Loop (Request → Assess → Loop → Publish → Halt).
 * Tracks per-session task items, supports create/update/list/clear operations.
 * Integrated with auto-continue and checkpoint system.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'blocked';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
  updatedAt: string;
  notes?: string;
  /** file paths this todo relates to */
  files?: string[];
}

export interface TodoList {
  sessionId: string;
  items: TodoItem[];
  createdAt: string;
  updatedAt: string;
}

// ─── In-memory store keyed by sessionId ───
const todoLists = new Map<string, TodoList>();

function generateId(): string {
  return `todo-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

// ─── Public API ───

export function getTodoList(sessionId: string): TodoList | null {
  return todoLists.get(sessionId) || null;
}

export function createTodoList(sessionId: string, items: Array<Partial<TodoItem>>): TodoList {
  const now = new Date().toISOString();
  const list: TodoList = {
    sessionId,
    items: items.map(i => ({
      id: i.id || generateId(),
      content: i.content || '(unnamed)',
      status: i.status || 'pending',
      priority: i.priority || 'medium',
      createdAt: now,
      updatedAt: now,
      notes: i.notes,
      files: i.files,
    })),
    createdAt: now,
    updatedAt: now,
  };
  todoLists.set(sessionId, list);
  return list;
}

export function updateTodoItem(
  sessionId: string,
  itemId: string,
  updates: Partial<Pick<TodoItem, 'status' | 'notes' | 'content' | 'priority' | 'files'>>
): TodoItem | null {
  const list = todoLists.get(sessionId);
  if (!list) return null;

  const item = list.items.find(i => i.id === itemId);
  if (!item) return null;

  Object.assign(item, updates, { updatedAt: new Date().toISOString() });
  list.updatedAt = new Date().toISOString();
  return item;
}

export function appendTodoItems(sessionId: string, items: Array<Partial<TodoItem>>): TodoList | null {
  let list = todoLists.get(sessionId);
  if (!list) {
    list = createTodoList(sessionId, items);
    return list;
  }

  const now = new Date().toISOString();
  for (const i of items) {
    list.items.push({
      id: i.id || generateId(),
      content: i.content || '(unnamed)',
      status: i.status || 'pending',
      priority: i.priority || 'medium',
      createdAt: now,
      updatedAt: now,
      notes: i.notes,
      files: i.files,
    });
  }
  list.updatedAt = now;
  return list;
}

export function clearTodoList(sessionId: string): boolean {
  return todoLists.delete(sessionId);
}

/**
 * Get progress summary for the Ralph loop.
 */
export function getTodoProgress(sessionId: string): { done: number; total: number; pending: string[] } {
  const list = todoLists.get(sessionId);
  if (!list || list.items.length === 0) return { done: 0, total: 0, pending: [] };

  const done = list.items.filter(i => i.status === 'done' || i.status === 'skipped').length;
  const pending = list.items
    .filter(i => i.status === 'pending' || i.status === 'in_progress')
    .map(i => i.content);

  return { done, total: list.items.length, pending };
}

/**
 * Returns true when every item is done/skipped.
 */
export function isTodoComplete(sessionId: string): boolean {
  const list = todoLists.get(sessionId);
  if (!list || list.items.length === 0) return false;
  return list.items.every(i => i.status === 'done' || i.status === 'skipped');
}
