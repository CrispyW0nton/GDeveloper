export type AgentNamespaceLockStatus = 'active' | 'stale';

export interface AgentNamespaceLock {
  id: string;
  taskId: string;
  ownerSessionId: string;
  namespaces: string[];
  createdAt: string;
  heartbeatAt: string;
  expiresAt: string;
  status: AgentNamespaceLockStatus;
}

export interface AgentNamespaceConflict {
  lockId: string;
  taskId: string;
  namespaces: string[];
}

export interface AgentNamespaceLockResult {
  success: boolean;
  message: string;
  lock?: AgentNamespaceLock;
  conflicts?: AgentNamespaceConflict[];
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const locks = new Map<string, AgentNamespaceLock>();

export function reserveAgentNamespaces(taskId: string, ownerSessionId: string, namespaces: string[], ttlMs = DEFAULT_TTL_MS): AgentNamespaceLockResult {
  const normalized = normalizeNamespaces(namespaces);
  if (!taskId.trim()) {
    return { success: false, message: 'Task id is required to reserve agent namespaces.' };
  }
  if (normalized.length === 0) {
    return { success: false, message: 'At least one namespace/path is required.' };
  }

  pruneExpiredLocks();
  const conflicts = findNamespaceConflicts(taskId, normalized);
  if (conflicts.length > 0) {
    return {
      success: false,
      message: `Namespace reservation conflicts with ${conflicts.length} active agent lock(s).`,
      conflicts,
    };
  }

  const existing = locks.get(taskId);
  const now = new Date();
  const lock: AgentNamespaceLock = {
    id: existing?.id || `agent-lock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    taskId,
    ownerSessionId: ownerSessionId || 'system',
    namespaces: normalized,
    createdAt: existing?.createdAt || now.toISOString(),
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    status: 'active',
  };
  locks.set(taskId, lock);
  return { success: true, message: `Reserved ${normalized.join(', ')} for ${taskId}.`, lock };
}

export function heartbeatAgentLock(taskId: string, ttlMs = DEFAULT_TTL_MS): AgentNamespaceLockResult {
  pruneExpiredLocks();
  const lock = locks.get(taskId);
  if (!lock) {
    return { success: false, message: `No active namespace lock for task: ${taskId}` };
  }
  const now = new Date();
  lock.heartbeatAt = now.toISOString();
  lock.expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  lock.status = 'active';
  return { success: true, message: `Heartbeat recorded for ${taskId}.`, lock };
}

export function releaseAgentNamespaces(taskId: string): AgentNamespaceLockResult {
  const lock = locks.get(taskId);
  if (!lock) {
    return { success: false, message: `No namespace lock found for task: ${taskId}` };
  }
  locks.delete(taskId);
  return { success: true, message: `Released namespace lock for ${taskId}.`, lock };
}

export function getAgentNamespaceLocks(): AgentNamespaceLock[] {
  pruneExpiredLocks();
  return Array.from(locks.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getAgentNamespaceConflicts(taskId: string, namespaces: string[]): AgentNamespaceConflict[] {
  pruneExpiredLocks();
  return findNamespaceConflicts(taskId, normalizeNamespaces(namespaces));
}

export function clearAgentNamespaceLocksForTests(): void {
  locks.clear();
}

function findNamespaceConflicts(taskId: string, namespaces: string[]): AgentNamespaceConflict[] {
  const conflicts: AgentNamespaceConflict[] = [];
  for (const lock of locks.values()) {
    if (lock.taskId === taskId || lock.status !== 'active') continue;
    const overlap = lock.namespaces.filter(existing => namespaces.some(next => namespacesOverlap(existing, next)));
    if (overlap.length > 0) {
      conflicts.push({ lockId: lock.id, taskId: lock.taskId, namespaces: overlap });
    }
  }
  return conflicts;
}

function pruneExpiredLocks(now = Date.now()): void {
  for (const [taskId, lock] of locks.entries()) {
    if (new Date(lock.expiresAt).getTime() <= now) {
      lock.status = 'stale';
      locks.delete(taskId);
    }
  }
}

function normalizeNamespaces(namespaces: string[]): string[] {
  return Array.from(new Set(namespaces
    .map(ns => ns.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, ''))
    .filter(Boolean)
    .sort()));
}

function namespacesOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
