/**
 * Checkpoint System — Sprint 27
 * Creates lightweight snapshots of agent progress at key points.
 * Checkpoints capture: git state, todo progress, tool call count, and notes.
 * Used by the Ralph loop and auto-continue for crash recovery and audit.
 */

export interface Checkpoint {
  id: string;
  sessionId: string;
  timestamp: string;
  label: string;
  data: {
    branch?: string;
    commitHash?: string;
    todoProgress?: { done: number; total: number };
    toolCallCount: number;
    loopIteration: number;
    notes?: string;
  };
}

// ─── In-memory checkpoint store ───
const checkpoints = new Map<string, Checkpoint[]>();
const MAX_CHECKPOINTS_PER_SESSION = 50;

function generateId(): string {
  return `cp-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Create a new checkpoint for the given session.
 */
export function createCheckpoint(
  sessionId: string,
  label: string,
  data: Checkpoint['data']
): Checkpoint {
  const cp: Checkpoint = {
    id: generateId(),
    sessionId,
    timestamp: new Date().toISOString(),
    label,
    data,
  };

  let list = checkpoints.get(sessionId);
  if (!list) {
    list = [];
    checkpoints.set(sessionId, list);
  }
  list.push(cp);

  // Trim old checkpoints
  if (list.length > MAX_CHECKPOINTS_PER_SESSION) {
    list.splice(0, list.length - MAX_CHECKPOINTS_PER_SESSION);
  }

  return cp;
}

/**
 * Get all checkpoints for a session.
 */
export function getCheckpoints(sessionId: string): Checkpoint[] {
  return checkpoints.get(sessionId) || [];
}

/**
 * Get the latest checkpoint for a session.
 */
export function getLatestCheckpoint(sessionId: string): Checkpoint | null {
  const list = checkpoints.get(sessionId);
  if (!list || list.length === 0) return null;
  return list[list.length - 1];
}

/**
 * Clear all checkpoints for a session.
 */
export function clearCheckpoints(sessionId: string): void {
  checkpoints.delete(sessionId);
}

/**
 * Format checkpoints as a readable summary for injection into the prompt.
 */
export function formatCheckpointSummary(sessionId: string): string {
  const cps = getCheckpoints(sessionId);
  if (cps.length === 0) return '';

  const lines = ['## Checkpoint History'];
  for (const cp of cps.slice(-5)) {
    const d = cp.data;
    const progress = d.todoProgress ? `${d.todoProgress.done}/${d.todoProgress.total}` : 'n/a';
    lines.push(
      `- **${cp.label}** (${cp.timestamp.split('T')[1]?.split('.')[0] || cp.timestamp}): ` +
      `loop=${d.loopIteration}, tools=${d.toolCallCount}, progress=${progress}` +
      (d.commitHash ? `, commit=${d.commitHash.substring(0, 7)}` : '') +
      (d.notes ? ` — ${d.notes}` : '')
    );
  }
  return lines.join('\n');
}
