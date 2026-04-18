/**
 * activePlanState.ts — Sprint 32
 *
 * Single source of truth for live task_plan state per session.
 * Ported from Cline's currentFocusChainChecklist pattern
 * (ExtensionMessage.ts / task/index.ts "Bug for the history books").
 *
 * The plan is stored here — NOT inside a tool card's result field.
 * This prevents the reversion bug where React unmounts/remounts a
 * component because the tool card identity changes between turns.
 *
 * Reference: src/core/task/index.ts (Cline), combineApiRequests.ts
 */

import { EventEmitter } from 'events';
import type { TaskPlan } from '../tools/taskPlan';

const plansBySession = new Map<string, TaskPlan>();
const bus = new EventEmitter();

// Prevent Node warnings for many listeners in test/dev
bus.setMaxListeners(50);

export function setActivePlan(sessionId: string, plan: TaskPlan): void {
  plansBySession.set(sessionId, plan);
  bus.emit('change', sessionId, plan);
}

export function getActivePlan(sessionId: string): TaskPlan | null {
  return plansBySession.get(sessionId) || null;
}

export function clearActivePlan(sessionId: string): void {
  plansBySession.delete(sessionId);
  bus.emit('change', sessionId, null);
}

export function onActivePlanChange(
  listener: (sessionId: string, plan: TaskPlan | null) => void
): () => void {
  bus.on('change', listener);
  return () => { bus.off('change', listener); };
}
