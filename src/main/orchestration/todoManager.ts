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

/**
 * Sprint 27.2: Broadcast callback for live UI updates.
 * When set, every mutation (create/update/append/clear) will call this
 * function so the main process can push events to the renderer via IPC.
 */
type TodoBroadcastFn = (sessionId: string, items: TodoItem[], event: string) => void;
let _broadcastFn: TodoBroadcastFn | null = null;

export function setTodoBroadcast(fn: TodoBroadcastFn): void {
  _broadcastFn = fn;
}

function broadcast(sessionId: string, event: string): void {
  if (!_broadcastFn) return;
  const list = todoLists.get(sessionId);
  _broadcastFn(sessionId, list ? list.items : [], event);
}

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
  broadcast(sessionId, 'created');
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
  broadcast(sessionId, 'updated');
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
  broadcast(sessionId, 'appended');
  return list;
}

export function clearTodoList(sessionId: string): boolean {
  const deleted = todoLists.delete(sessionId);
  if (deleted) broadcast(sessionId, 'cleared');
  return deleted;
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Sprint 27.2: Task Lifecycle — single active task enforcement
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Get the currently active (in_progress) task, if any.
 * Enforces single active task invariant.
 */
export function getActiveTask(sessionId: string): TodoItem | null {
  const list = todoLists.get(sessionId);
  if (!list) return null;
  return list.items.find(i => i.status === 'in_progress') || null;
}

/**
 * Set a specific task as active (in_progress).
 * If another task is already in_progress, it stays — caller should completeActive first.
 * This is idempotent: calling setActive on an already active task is a no-op.
 */
export function setActive(sessionId: string, itemId: string): TodoItem | null {
  const list = todoLists.get(sessionId);
  if (!list) return null;

  const item = list.items.find(i => i.id === itemId);
  if (!item) return null;

  // Idempotent: already active
  if (item.status === 'in_progress') return item;

  // Only transition from pending → in_progress
  if (item.status !== 'pending') return null;

  // Enforce single active: deactivate any other in_progress tasks first
  for (const other of list.items) {
    if (other.id !== itemId && other.status === 'in_progress') {
      other.status = 'pending';
      other.updatedAt = new Date().toISOString();
    }
  }

  item.status = 'in_progress';
  item.updatedAt = new Date().toISOString();
  list.updatedAt = new Date().toISOString();
  broadcast(sessionId, 'active-changed');
  return item;
}

/**
 * Complete the currently active task (mark as done) and optionally advance.
 * Returns the completed item, or null if no active task.
 */
export function completeActive(sessionId: string, notes?: string): TodoItem | null {
  const list = todoLists.get(sessionId);
  if (!list) return null;

  const active = list.items.find(i => i.status === 'in_progress');
  if (!active) return null;

  active.status = 'done';
  active.updatedAt = new Date().toISOString();
  if (notes) active.notes = notes;
  list.updatedAt = new Date().toISOString();
  broadcast(sessionId, 'completed');
  return active;
}

/**
 * Advance to the next pending task (mark it as in_progress).
 * Returns the newly active task, or null if no pending tasks remain.
 * Respects priority: high > medium > low.
 */
export function advanceToNextPending(sessionId: string): TodoItem | null {
  const list = todoLists.get(sessionId);
  if (!list) return null;

  // Already have an active task — don't overwrite
  const existing = list.items.find(i => i.status === 'in_progress');
  if (existing) return existing;

  // Find next pending task, preferring higher priority
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const pending = list.items
    .filter(i => i.status === 'pending')
    .sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));

  if (pending.length === 0) return null;

  const next = pending[0];
  next.status = 'in_progress';
  next.updatedAt = new Date().toISOString();
  list.updatedAt = new Date().toISOString();
  broadcast(sessionId, 'advanced');
  return next;
}

/**
 * Mark the active task as blocked (e.g., tool timeout or error).
 * Optionally sets a reason in notes.
 */
export function blockActive(sessionId: string, reason?: string): TodoItem | null {
  const list = todoLists.get(sessionId);
  if (!list) return null;

  const active = list.items.find(i => i.status === 'in_progress');
  if (!active) return null;

  active.status = 'blocked';
  active.updatedAt = new Date().toISOString();
  if (reason) active.notes = (active.notes ? active.notes + '; ' : '') + reason;
  list.updatedAt = new Date().toISOString();
  broadcast(sessionId, 'blocked');
  return active;
}
