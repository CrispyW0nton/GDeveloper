/**
 * Multi-Prompt Orchestration Engine
 * State machine: TASK_CREATED → SCOPED → PLANNED → EXECUTING → VERIFYING → COMMIT_READY → PR_READY → DONE/BLOCKED
 * Includes retry limits, budget controls, loop detection, audit trail
 */

import { TaskStatus, PromptRole } from '../domain/enums';
import { Task, TaskLedger, LedgerEvent, ChatMessage, ToolCallRecord } from '../domain/entities';
import { IOrchestrationEngine } from '../domain/interfaces';
import {
  SYSTEM_PROMPT, PLANNER_PROMPT, EXECUTOR_PROMPT,
  VERIFIER_PROMPT, REPAIR_PROMPT, SUMMARIZER_PROMPT,
  COMPACTOR_PROMPT, buildPrompt
} from './prompts';
import { getContextManager, type ContextMessage } from '../providers/contextManager';
import { getToolResultBudget } from '../providers/toolResultBudget';
import { getRateLimiter } from '../providers/rateLimiter';

// ─── State Machine Transitions ───
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.TASK_CREATED]: [TaskStatus.SCOPED, TaskStatus.BLOCKED],
  [TaskStatus.SCOPED]: [TaskStatus.PLANNED, TaskStatus.BLOCKED],
  [TaskStatus.PLANNED]: [TaskStatus.EXECUTING, TaskStatus.BLOCKED],
  [TaskStatus.EXECUTING]: [TaskStatus.VERIFYING, TaskStatus.BLOCKED],
  [TaskStatus.VERIFYING]: [TaskStatus.COMMIT_READY, TaskStatus.EXECUTING, TaskStatus.BLOCKED],
  [TaskStatus.COMMIT_READY]: [TaskStatus.PR_READY, TaskStatus.BLOCKED],
  [TaskStatus.PR_READY]: [TaskStatus.DONE, TaskStatus.BLOCKED],
  [TaskStatus.DONE]: [],
  [TaskStatus.BLOCKED]: [TaskStatus.TASK_CREATED, TaskStatus.SCOPED, TaskStatus.PLANNED, TaskStatus.EXECUTING]
};

// ─── Budget Controls ───
export interface BudgetConfig {
  maxTurnsPerTask: number;    // 30-50
  maxToolCallsPerTurn: number; // 5-10
  maxRetries: number;          // 2-3
  tokenBudget: number;         // 500000
  timeoutMs: number;           // 600000 (10 min)
  // Sprint 21 additions
  maxParallelToolCalls: number; // concurrency cap
  maxContextTokens: number;     // per-request context window cap
  maxToolResultTokens: number;  // per-tool-result token cap
}

const DEFAULT_BUDGET: BudgetConfig = {
  maxTurnsPerTask: 50,
  maxToolCallsPerTurn: 10,
  maxRetries: 3,
  tokenBudget: 500000,
  timeoutMs: 600000,
  // Sprint 21
  maxParallelToolCalls: 2,
  maxContextTokens: 80000,
  maxToolResultTokens: 2500,
};

// ─── Loop Detection ───
class LoopDetector {
  private history: string[] = [];
  private maxHistory = 20;
  private repeatThreshold = 3;

  recordAction(action: string): void {
    this.history.push(action);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  isLooping(): boolean {
    if (this.history.length < this.repeatThreshold * 2) return false;

    const recent = this.history.slice(-this.repeatThreshold);
    const pattern = recent.join('|');
    let count = 0;

    for (let i = 0; i <= this.history.length - this.repeatThreshold; i++) {
      const window = this.history.slice(i, i + this.repeatThreshold).join('|');
      if (window === pattern) count++;
    }

    return count >= this.repeatThreshold;
  }

  reset(): void {
    this.history = [];
  }
}

// ─── Context Compactor ───
class ContextCompactor {
  private tokenThreshold = 100000;

  shouldCompact(totalTokens: number): boolean {
    return totalTokens > this.tokenThreshold;
  }

  compact(messages: ChatMessage[], task: Task): ChatMessage[] {
    // Keep: system message, last 5 messages, task context
    const system = messages.filter(m => m.role === 'system').slice(0, 1);
    const recent = messages.slice(-5);

    const summary: ChatMessage = {
      id: `compact-${Date.now()}`,
      sessionId: task.sessionId,
      role: PromptRole.SUMMARIZER,
      content: buildPrompt(COMPACTOR_PROMPT, {
        taskTitle: task.title,
        taskStatus: task.status,
        repoName: '', // filled by engine
        branch: task.workingBranch,
        fileScope: task.fileScope.join(', '),
        filesTouched: task.filesTouched.join(', '),
        criteriaStatus: task.acceptanceCriteria.map(c => `${c.description}: ${c.met ? 'MET' : 'NOT MET'}`).join(', '),
        decisions: 'See audit trail',
        blocker: task.status === TaskStatus.BLOCKED ? 'Task is blocked' : 'None',
        nextAction: 'Continue from last checkpoint'
      }),
      timestamp: new Date().toISOString()
    };

    return [...system, summary, ...recent];
  }
}

// ─── Orchestration Engine ───
export class OrchestrationEngine implements IOrchestrationEngine {
  private budget: BudgetConfig;
  private loopDetector: LoopDetector;
  private compactor: ContextCompactor;
  private eventLog: LedgerEvent[] = [];
  private listeners: Array<(event: OrchestrationEvent) => void> = [];

  constructor(budget?: Partial<BudgetConfig>) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
    this.loopDetector = new LoopDetector();
    this.compactor = new ContextCompactor();
  }

  // ─── State Machine ───
  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  transition(task: Task, newStatus: TaskStatus): Task {
    if (!this.canTransition(task.status, newStatus)) {
      throw new Error(`Invalid transition: ${task.status} → ${newStatus}`);
    }

    this.logEvent('state_transition', `${task.status} → ${newStatus}`, { taskId: task.id });
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();

    this.emit({ type: 'state_change', taskId: task.id, from: task.status, to: newStatus });
    return task;
  }

  // ─── Budget Checks ───
  checkBudget(task: Task): { withinBudget: boolean; reason?: string } {
    if (task.turnCount >= this.budget.maxTurnsPerTask) {
      return { withinBudget: false, reason: `Turn limit exceeded (${task.turnCount}/${this.budget.maxTurnsPerTask})` };
    }
    if (task.tokenUsed >= this.budget.tokenBudget) {
      return { withinBudget: false, reason: `Token budget exceeded (${task.tokenUsed}/${this.budget.tokenBudget})` };
    }
    if (task.retryCount >= this.budget.maxRetries) {
      return { withinBudget: false, reason: `Retry limit exceeded (${task.retryCount}/${this.budget.maxRetries})` };
    }
    // Sprint 21: Check rate limiter before proceeding
    const rateLimiter = getRateLimiter();
    const snap = rateLimiter.getSnapshot();
    if (snap.isPaused) {
      return { withinBudget: false, reason: 'Rate limit pause active. Wait for usage to drop.' };
    }
    return { withinBudget: true };
  }

  // ─── Sprint 21: Context-aware message building ───
  buildContextMessages(
    systemPrompt: string,
    messages: ContextMessage[],
    taskPlan?: string,
    workspaceMeta?: string,
  ) {
    const ctxMgr = getContextManager();
    return ctxMgr.buildContext(systemPrompt, messages, taskPlan, undefined, workspaceMeta);
  }

  // ─── Sprint 21: Tool result processing ───
  processToolResult(toolName: string, rawResult: string, toolCallId?: string) {
    const trb = getToolResultBudget();
    return trb.processToolResult(toolName, rawResult, toolCallId);
  }

  // ─── Sprint 21: Plan parallel tool call batches ───
  planToolBatches(pendingTools: Array<{ name: string; id: string; input: any }>) {
    const trb = getToolResultBudget();
    return trb.planToolCallBatches(pendingTools);
  }

  // ─── Task Lifecycle ───
  async startTask(sessionId: string, request: string): Promise<void> {
    this.logEvent('task_start', `Starting task for session ${sessionId}: ${request.substring(0, 100)}`);
    this.loopDetector.reset();
    this.emit({ type: 'task_start', sessionId, request });
  }

  async continueTask(taskId: string): Promise<void> {
    this.loopDetector.recordAction(`continue-${taskId}`);
    if (this.loopDetector.isLooping()) {
      this.logEvent('loop_detected', `Loop detected for task ${taskId}`);
      this.emit({ type: 'loop_detected', taskId });
    }
  }

  async pauseTask(taskId: string): Promise<void> {
    this.logEvent('task_pause', `Task ${taskId} paused`);
    this.emit({ type: 'task_pause', taskId });
  }

  getState(taskId: string): TaskStatus {
    return TaskStatus.TASK_CREATED; // Would query DB
  }

  // ─── Prompt Selection ───
  getPromptForPhase(status: TaskStatus): string {
    switch (status) {
      case TaskStatus.TASK_CREATED:
      case TaskStatus.SCOPED:
        return PLANNER_PROMPT;
      case TaskStatus.PLANNED:
      case TaskStatus.EXECUTING:
        return EXECUTOR_PROMPT;
      case TaskStatus.VERIFYING:
        return VERIFIER_PROMPT;
      case TaskStatus.BLOCKED:
        return REPAIR_PROMPT;
      default:
        return SYSTEM_PROMPT;
    }
  }

  // ─── Audit Trail ───
  private logEvent(type: string, message: string, data?: Record<string, unknown>): void {
    const event: LedgerEvent = {
      timestamp: new Date().toISOString(),
      type,
      message,
      data
    };
    this.eventLog.push(event);
  }

  getEventLog(): LedgerEvent[] {
    return [...this.eventLog];
  }

  // ─── Event System ───
  onEvent(listener: (event: OrchestrationEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: OrchestrationEvent): void {
    this.listeners.forEach(l => l(event));
  }
}

export interface OrchestrationEvent {
  type: string;
  [key: string]: unknown;
}

// Singleton
let engineInstance: OrchestrationEngine | null = null;

export function getOrchestrationEngine(): OrchestrationEngine {
  if (!engineInstance) {
    engineInstance = new OrchestrationEngine();
  }
  return engineInstance;
}
