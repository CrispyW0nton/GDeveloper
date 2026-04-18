/**
 * task_plan — Sprint 16 + Sprint 27.2
 * Visible multi-step task-plan tool: creates plan, allows status updates, integrates with Task Ledger.
 * Maintains a global plan object that can be updated via subsequent tool calls.
 *
 * Sprint 27.2 (Bug A fix): Syncs plan data to todoManager so the renderer
 * can read from a single source of truth. Previously, task_plan had its own
 * store and todoManager had its own — the renderer read todoManager which
 * was always empty, showing "No plan data".
 */

import {
  createTodoList, updateTodoItem, appendTodoItems, getTodoProgress,
} from '../orchestration/todoManager';
import { updateProgress } from '../orchestration/autoContinueState';

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';

export interface TaskItem {
  id: string;
  content: string;
  status: TaskStatus;
  priority: 'high' | 'medium' | 'low';
  notes?: string;
}

export interface TaskPlanInput {
  action: 'create' | 'update' | 'append' | 'get';
  plan_id?: string;
  tasks?: Array<{
    id?: string;
    content: string;
    status?: TaskStatus;
    priority?: 'high' | 'medium' | 'low';
  }>;
  task_id?: string;
  new_status?: TaskStatus;
  notes?: string;
}

export interface TaskPlan {
  id: string;
  created_at: string;
  updated_at: string;
  tasks: TaskItem[];
}

export interface TaskPlanResult {
  success: boolean;
  action: string;
  plan: TaskPlan | null;
  message: string;
  error?: string;
}

// In-memory plan store (keyed by plan_id)
const plans = new Map<string, TaskPlan>();

// Active plan ID for the current session
let activePlanId: string | null = null;

// Sprint 27.2: Session ID used for todoManager sync
let _syncSessionId: string = 'default';

/** Set the session ID used for syncing plan data to todoManager. */
export function setTaskPlanSessionId(sessionId: string): void {
  _syncSessionId = sessionId;
}

/** Sync plan data to todoManager (Bug A fix). */
function syncToTodoManager(plan: TaskPlan): void {
  try {
    const todoItems = plan.tasks.map(t => ({
      id: t.id,
      content: t.content,
      status: t.status === 'failed' ? 'blocked' as const : t.status as any,
      priority: t.priority,
      notes: t.notes,
    }));
    createTodoList(_syncSessionId, todoItems);
    // Also update the autoContinueState progress
    const progress = getTodoProgress(_syncSessionId);
    updateProgress(progress.done, progress.total);
  } catch { /* sync is best-effort */ }
}

export function getActivePlan(): TaskPlan | null {
  if (activePlanId) return plans.get(activePlanId) || null;
  return null;
}

export function getAllPlans(): TaskPlan[] {
  return Array.from(plans.values());
}

function generateId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
}

/**
 * Execute task_plan operations: create, update, append, get.
 */
export function executeTaskPlan(input: TaskPlanInput): TaskPlanResult {
  const { action } = input;

  switch (action) {
    case 'create': {
      if (!input.tasks || input.tasks.length === 0) {
        return { success: false, action, plan: null, message: '', error: 'tasks array is required for create action' };
      }

      const planId = generateId();
      const now = new Date().toISOString();
      const tasks: TaskItem[] = input.tasks.map(t => ({
        id: t.id || generateTaskId(),
        content: t.content,
        status: t.status || 'pending',
        priority: t.priority || 'medium',
      }));

      const plan: TaskPlan = {
        id: planId,
        created_at: now,
        updated_at: now,
        tasks,
      };

      plans.set(planId, plan);
      activePlanId = planId;

      // Sprint 27.2: Sync to todoManager (Bug A fix)
      syncToTodoManager(plan);

      return {
        success: true,
        action,
        plan,
        message: `Created plan "${planId}" with ${tasks.length} tasks.`,
      };
    }

    case 'update': {
      const planId = input.plan_id || activePlanId;
      if (!planId) {
        return { success: false, action, plan: null, message: '', error: 'No active plan. Create one first.' };
      }
      const plan = plans.get(planId);
      if (!plan) {
        return { success: false, action, plan: null, message: '', error: `Plan "${planId}" not found.` };
      }

      if (!input.task_id || !input.new_status) {
        return { success: false, action, plan, message: '', error: 'task_id and new_status are required for update action' };
      }

      const task = plan.tasks.find(t => t.id === input.task_id);
      if (!task) {
        return { success: false, action, plan, message: '', error: `Task "${input.task_id}" not found in plan.` };
      }

      task.status = input.new_status;
      if (input.notes) task.notes = input.notes;
      plan.updated_at = new Date().toISOString();

      // Sprint 27.2: Sync update to todoManager
      updateTodoItem(_syncSessionId, input.task_id, {
        status: input.new_status === 'failed' ? 'blocked' : input.new_status as any,
        notes: input.notes,
      });
      const progress = getTodoProgress(_syncSessionId);
      updateProgress(progress.done, progress.total);

      return {
        success: true,
        action,
        plan,
        message: `Updated task "${input.task_id}" to ${input.new_status}.`,
      };
    }

    case 'append': {
      const planId = input.plan_id || activePlanId;
      if (!planId) {
        return { success: false, action, plan: null, message: '', error: 'No active plan. Create one first.' };
      }
      const plan = plans.get(planId);
      if (!plan) {
        return { success: false, action, plan: null, message: '', error: `Plan "${planId}" not found.` };
      }

      if (!input.tasks || input.tasks.length === 0) {
        return { success: false, action, plan, message: '', error: 'tasks array is required for append action' };
      }

      const newTasks: TaskItem[] = input.tasks.map(t => ({
        id: t.id || generateTaskId(),
        content: t.content,
        status: t.status || 'pending',
        priority: t.priority || 'medium',
      }));

      plan.tasks.push(...newTasks);
      plan.updated_at = new Date().toISOString();

      // Sprint 27.2: Sync append to todoManager
      appendTodoItems(_syncSessionId, newTasks.map(t => ({
        id: t.id,
        content: t.content,
        status: t.status === 'failed' ? 'blocked' as const : t.status as any,
        priority: t.priority,
      })));
      const progress = getTodoProgress(_syncSessionId);
      updateProgress(progress.done, progress.total);

      return {
        success: true,
        action,
        plan,
        message: `Appended ${newTasks.length} tasks to plan "${planId}". Total: ${plan.tasks.length} tasks.`,
      };
    }

    case 'get': {
      const planId = input.plan_id || activePlanId;
      if (!planId) {
        return { success: true, action, plan: null, message: 'No active plan.' };
      }
      const plan = plans.get(planId);
      if (!plan) {
        return { success: false, action, plan: null, message: '', error: `Plan "${planId}" not found.` };
      }

      const done = plan.tasks.filter(t => t.status === 'done').length;
      const total = plan.tasks.length;
      return {
        success: true,
        action,
        plan,
        message: `Plan "${planId}": ${done}/${total} tasks done.`,
      };
    }

    default:
      return { success: false, action, plan: null, message: '', error: `Unknown action: ${action}. Use create, update, append, or get.` };
  }
}
