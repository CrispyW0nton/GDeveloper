/**
 * Agent Continuation Tests — Sprint 27.5.1
 *
 * Validates the silent todo-continuation fix:
 * - After a todo-only turn with incomplete tasks, a nudge is injected
 * - Model exits normally when all tasks are completed
 * - Normal exit on non-todo tool calls (no nudge)
 * - Error after 3 consecutive nudges (stuck_after_todo)
 * - Correct user-role nudge message content
 * - Nudge counter resets on non-todo tool calls
 */

import { describe, it, expect } from 'vitest';

// ─── Constants matching agentLoop.ts ───

const MAX_TODO_NUDGES = 3;
const TODO_NUDGE_MESSAGE = 'Continue executing the in_progress task from your todo list. Do not end your turn until all tasks are completed.';

// ─── Mock types ───

interface MockStreamChunk {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
  stopReason?: string;
}

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

// ─── Inline agent loop with Sprint 27.5.1 continuation logic ───

function onlyTodoCalled(toolCalls: Array<{ name: string }>): boolean {
  return toolCalls.length > 0 && toolCalls.every(tc => tc.name === 'todo');
}

function hasIncompleteTasks(todos: TodoItem[]): boolean {
  return todos.length > 0 && todos.some(t => t.status === 'pending' || t.status === 'in_progress');
}

async function runAgentLoopWithContinuation(
  makeChunks: (turn: number, nudgeCount: number) => MockStreamChunk[],
  opts: {
    maxTurns?: number;
    signal?: AbortSignal;
    /** Simulated todo state per turn — function receives turn number and returns todo items */
    getTodosForTurn?: (turn: number) => TodoItem[];
  } = {},
) {
  const maxTurns = opts.maxTurns ?? 25;
  const messages: any[] = [{ role: 'user', content: 'test' }];
  let allToolCalls: any[] = [];
  let lastContent = '';
  const turnsExecuted: number[] = [];
  const nudgeMessages: string[] = [];
  const dbLog: Array<{ role: string; content: string }> = [];

  // Sprint 27.5.1 state
  let consecutiveTodoNudges = 0;
  let lastTurnOnlyTodo = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (opts.signal?.aborted) {
      return { content: lastContent, toolCalls: allToolCalls, turns: turnsExecuted.length, reason: 'aborted' as const, nudgeMessages, dbLog };
    }

    const chunks = makeChunks(turn, consecutiveTodoNudges);
    let content = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let stopReason = 'end_turn';

    for (const chunk of chunks) {
      if (chunk.type === 'text') content += chunk.content || '';
      if (chunk.type === 'tool_call' && chunk.toolCall) toolCalls.push(chunk.toolCall);
      if (chunk.type === 'done') stopReason = chunk.stopReason || 'end_turn';
    }

    lastContent = content;
    turnsExecuted.push(turn);

    // Get current todo state
    const currentTodos = opts.getTodosForTurn?.(turn) ?? [];

    // ─── stop_reason check ───

    if (stopReason === 'end_turn') {
      // Sprint 27.5.1: Silent todo-continuation check
      if (lastTurnOnlyTodo && hasIncompleteTasks(currentTodos)) {
        consecutiveTodoNudges++;
        if (consecutiveTodoNudges >= MAX_TODO_NUDGES) {
          dbLog.push({ role: 'assistant', content: lastContent || '(stuck after todo)' });
          return {
            content: lastContent || 'Error: agent stuck in todo loop after ' + MAX_TODO_NUDGES + ' nudges.',
            toolCalls: allToolCalls,
            turns: turnsExecuted.length,
            reason: 'stuck_after_todo' as const,
            nudgeMessages,
            dbLog,
          };
        }

        // Inject nudge
        messages.push({ role: 'assistant', content: lastContent || '(planning)' });
        messages.push({ role: 'user', content: TODO_NUDGE_MESSAGE });
        nudgeMessages.push(TODO_NUDGE_MESSAGE);
        dbLog.push({ role: 'assistant', content: lastContent || '(planning)' });
        dbLog.push({ role: 'user', content: TODO_NUDGE_MESSAGE });

        lastTurnOnlyTodo = false;
        continue;
      }

      return { content: lastContent, toolCalls: allToolCalls, turns: turnsExecuted.length, reason: 'end_turn' as const, nudgeMessages, dbLog };
    }

    if (stopReason === 'max_tokens') return { content: lastContent, toolCalls: allToolCalls, turns: turnsExecuted.length, reason: 'max_tokens' as const, nudgeMessages, dbLog };
    if (stopReason === 'stop_sequence') return { content: lastContent, toolCalls: allToolCalls, turns: turnsExecuted.length, reason: 'stop_sequence' as const, nudgeMessages, dbLog };
    if (stopReason !== 'tool_use') return { content: lastContent, toolCalls: allToolCalls, turns: turnsExecuted.length, reason: 'end_turn' as const, nudgeMessages, dbLog };

    if (toolCalls.length === 0) return { content: lastContent, toolCalls: allToolCalls, turns: turnsExecuted.length, reason: 'no_tools' as const, nudgeMessages, dbLog };

    allToolCalls.push(...toolCalls);
    messages.push({ role: 'assistant', content });
    messages.push({ role: 'user', content: '[Tool Result]' });

    // Sprint 27.5.1: Track todo-only turns
    const thisOnlyTodo = onlyTodoCalled(toolCalls);
    if (thisOnlyTodo && hasIncompleteTasks(currentTodos)) {
      lastTurnOnlyTodo = true;
    } else {
      lastTurnOnlyTodo = false;
      if (!thisOnlyTodo) {
        consecutiveTodoNudges = 0;
      }
    }
  }

  return { content: lastContent, toolCalls: allToolCalls, turns: turnsExecuted.length, reason: 'max_turns' as const, nudgeMessages, dbLog };
}

// ─── Tests ───

describe('agent-continuation (Sprint 27.5.1)', () => {
  it('continues after todo-only turn with pending tasks (injects nudge)', async () => {
    // Scenario: Turn 0 = todo call (tool_use) → Turn 1 = end_turn (premature)
    //           → nudge injected → Turn 2 = bash (tool_use) → Turn 3 = end_turn (done)
    const result = await runAgentLoopWithContinuation(
      (turn) => {
        switch (turn) {
          case 0: return [
            { type: 'text', content: 'Creating plan.' },
            { type: 'tool_call', toolCall: { id: 'tc-0', name: 'todo', input: { todos: [
              { id: '1', content: 'Create file', status: 'in_progress', priority: 'high' },
              { id: '2', content: 'Run tests', status: 'pending', priority: 'medium' },
            ] } } },
            { type: 'done', stopReason: 'tool_use' },
          ];
          case 1: return [
            { type: 'text', content: 'I\'ll do this now.' },
            { type: 'done', stopReason: 'end_turn' },  // premature end_turn
          ];
          case 2: return [
            { type: 'text', content: 'Creating file.' },
            { type: 'tool_call', toolCall: { id: 'tc-1', name: 'write_file', input: { path: 'hello.txt', content: 'hi' } } },
            { type: 'done', stopReason: 'tool_use' },
          ];
          case 3: return [
            { type: 'text', content: 'All done!' },
            { type: 'done', stopReason: 'end_turn' },
          ];
          default: return [{ type: 'done', stopReason: 'end_turn' }];
        }
      },
      {
        getTodosForTurn: (turn) => {
          if (turn <= 1) return [
            { id: '1', content: 'Create file', status: 'in_progress', priority: 'high' },
            { id: '2', content: 'Run tests', status: 'pending', priority: 'medium' },
          ];
          // After nudge, model executes; by turn 3 all completed
          return [
            { id: '1', content: 'Create file', status: 'completed', priority: 'high' },
            { id: '2', content: 'Run tests', status: 'completed', priority: 'medium' },
          ];
        },
      },
    );

    expect(result.reason).toBe('end_turn');
    expect(result.nudgeMessages).toHaveLength(1);
    expect(result.nudgeMessages[0]).toBe(TODO_NUDGE_MESSAGE);
    expect(result.toolCalls).toHaveLength(2); // todo + write_file
    expect(result.turns).toBe(4);
  });

  it('exits normally when all tasks completed (no nudge)', async () => {
    const result = await runAgentLoopWithContinuation(
      (turn) => {
        if (turn === 0) {
          return [
            { type: 'text', content: 'Plan:' },
            { type: 'tool_call', toolCall: { id: 'tc-0', name: 'todo', input: { todos: [
              { id: '1', content: 'Done task', status: 'completed', priority: 'high' },
            ] } } },
            { type: 'done', stopReason: 'tool_use' },
          ];
        }
        return [
          { type: 'text', content: 'Everything is done.' },
          { type: 'done', stopReason: 'end_turn' },
        ];
      },
      {
        getTodosForTurn: () => [
          { id: '1', content: 'Done task', status: 'completed', priority: 'high' },
        ],
      },
    );

    expect(result.reason).toBe('end_turn');
    expect(result.nudgeMessages).toHaveLength(0);
    expect(result.turns).toBe(2);
  });

  it('exits normally on non-todo tool calls (no nudge)', async () => {
    const result = await runAgentLoopWithContinuation(
      (turn) => {
        if (turn === 0) return [
          { type: 'tool_call', toolCall: { id: 'tc-0', name: 'bash_command', input: { command: 'ls' } } },
          { type: 'done', stopReason: 'tool_use' },
        ];
        return [
          { type: 'text', content: 'Done.' },
          { type: 'done', stopReason: 'end_turn' },
        ];
      },
      {
        getTodosForTurn: () => [],
      },
    );

    expect(result.reason).toBe('end_turn');
    expect(result.nudgeMessages).toHaveLength(0);
    expect(result.turns).toBe(2);
  });

  it('errors after 3 consecutive nudges (stuck_after_todo)', async () => {
    // Model keeps returning end_turn after todo-only turns
    let turnCounter = 0;
    const result = await runAgentLoopWithContinuation(
      (turn) => {
        turnCounter++;
        // Alternate: even turns = todo (tool_use), odd turns = end_turn (premature)
        if (turn % 2 === 0) {
          return [
            { type: 'text', content: 'Planning again.' },
            { type: 'tool_call', toolCall: { id: `tc-${turn}`, name: 'todo', input: { todos: [
              { id: '1', content: 'Stuck task', status: 'in_progress', priority: 'high' },
            ] } } },
            { type: 'done', stopReason: 'tool_use' },
          ];
        }
        return [
          { type: 'text', content: 'I will do it now.' },
          { type: 'done', stopReason: 'end_turn' },
        ];
      },
      {
        maxTurns: 25,
        getTodosForTurn: () => [
          { id: '1', content: 'Stuck task', status: 'in_progress', priority: 'high' },
        ],
      },
    );

    expect(result.reason).toBe('stuck_after_todo');
    expect(result.nudgeMessages.length).toBeLessThanOrEqual(MAX_TODO_NUDGES);
  });

  it('nudge message has correct user-role content', async () => {
    const result = await runAgentLoopWithContinuation(
      (turn) => {
        if (turn === 0) return [
          { type: 'tool_call', toolCall: { id: 'tc-0', name: 'todo', input: { todos: [] } } },
          { type: 'done', stopReason: 'tool_use' },
        ];
        if (turn === 1) return [
          { type: 'text', content: 'Stopping early.' },
          { type: 'done', stopReason: 'end_turn' },
        ];
        // After nudge, model proceeds properly
        if (turn === 2) return [
          { type: 'tool_call', toolCall: { id: 'tc-1', name: 'bash_command', input: { command: 'echo ok' } } },
          { type: 'done', stopReason: 'tool_use' },
        ];
        return [
          { type: 'text', content: 'Finished.' },
          { type: 'done', stopReason: 'end_turn' },
        ];
      },
      {
        getTodosForTurn: (turn) => {
          if (turn <= 1) return [
            { id: '1', content: 'Task A', status: 'in_progress', priority: 'high' },
          ];
          return [
            { id: '1', content: 'Task A', status: 'completed', priority: 'high' },
          ];
        },
      },
    );

    // Verify the nudge message is correct
    expect(result.nudgeMessages).toHaveLength(1);
    expect(result.nudgeMessages[0]).toContain('Continue executing');
    expect(result.nudgeMessages[0]).toContain('in_progress');
    expect(result.nudgeMessages[0]).toContain('todo list');

    // Verify it was stored in the DB log as a user message
    const userNudges = result.dbLog.filter(
      entry => entry.role === 'user' && entry.content === TODO_NUDGE_MESSAGE
    );
    expect(userNudges).toHaveLength(1);
  });

  it('resets nudge counter when a non-todo tool is called', async () => {
    // Turn 0: todo (tool_use) → Turn 1: end_turn (nudge 1)
    // Turn 2: todo (tool_use) → Turn 3: end_turn (nudge 2)
    // Turn 4: todo + bash (tool_use) → counter resets
    // Turn 5: todo (tool_use) → Turn 6: end_turn (nudge 1 again, not 3)
    // Turn 7: bash (tool_use) → Turn 8: end_turn (clean exit)
    const result = await runAgentLoopWithContinuation(
      (turn) => {
        switch (turn) {
          case 0: return [
            { type: 'tool_call', toolCall: { id: 'tc-0', name: 'todo', input: {} } },
            { type: 'done', stopReason: 'tool_use' },
          ];
          case 1: return [
            { type: 'text', content: 'End.' },
            { type: 'done', stopReason: 'end_turn' },  // nudge 1
          ];
          case 2: return [
            { type: 'tool_call', toolCall: { id: 'tc-1', name: 'todo', input: {} } },
            { type: 'done', stopReason: 'tool_use' },
          ];
          case 3: return [
            { type: 'text', content: 'End again.' },
            { type: 'done', stopReason: 'end_turn' },  // nudge 2
          ];
          case 4: return [
            // Non-todo tool call → resets counter
            { type: 'tool_call', toolCall: { id: 'tc-2', name: 'todo', input: {} } },
            { type: 'tool_call', toolCall: { id: 'tc-3', name: 'bash_command', input: { command: 'echo reset' } } },
            { type: 'done', stopReason: 'tool_use' },
          ];
          case 5: return [
            { type: 'tool_call', toolCall: { id: 'tc-4', name: 'todo', input: {} } },
            { type: 'done', stopReason: 'tool_use' },
          ];
          case 6: return [
            { type: 'text', content: 'End once more.' },
            { type: 'done', stopReason: 'end_turn' },  // nudge 1 (counter was reset)
          ];
          case 7: return [
            { type: 'tool_call', toolCall: { id: 'tc-5', name: 'bash_command', input: { command: 'echo done' } } },
            { type: 'done', stopReason: 'tool_use' },
          ];
          case 8: return [
            { type: 'text', content: 'All done.' },
            { type: 'done', stopReason: 'end_turn' },
          ];
          default: return [{ type: 'done', stopReason: 'end_turn' }];
        }
      },
      {
        getTodosForTurn: (turn) => {
          if (turn <= 7) return [
            { id: '1', content: 'Task', status: 'in_progress', priority: 'high' },
          ];
          return [
            { id: '1', content: 'Task', status: 'completed', priority: 'high' },
          ];
        },
      },
    );

    // Should NOT be stuck_after_todo because counter was reset at turn 4
    expect(result.reason).toBe('end_turn');
    // 3 nudges total: turns 1, 3, and 6
    expect(result.nudgeMessages).toHaveLength(3);
    expect(result.content).toBe('All done.');
  });

  // ─── Source code verification tests ───

  it('agentLoop.ts contains consecutiveTodoNudges tracking', () => {
    const fs = require('fs');
    const code = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf8');
    expect(code).toContain('consecutiveTodoNudges');
    expect(code).toContain('stuck_after_todo');
    expect(code).toContain('TODO_NUDGE_MESSAGE');
  });

  it('agentLoop.ts contains onlyTodoCalled helper and uses todoManager.isTodoComplete', () => {
    const fs = require('fs');
    const code = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf8');
    expect(code).toContain('onlyTodoCalled');
    // Sprint 27.5.1 (post-merge onto main): the incomplete-tasks check is
    // delegated to todoManager.isTodoComplete rather than a local helper.
    expect(code).toContain('isTodoComplete');
    expect(code).toMatch(/from\s+['"]\.\/todoManager['"]/);
  });

  it('system prompt contains strengthened todo continuation instructions', () => {
    const fs = require('fs');
    const code = fs.readFileSync('src/main/orchestration/prompts.ts', 'utf8');
    expect(code).toContain('ABSOLUTE RULE');
    expect(code).toContain('NEVER end your turn immediately after a');
    expect(code).toContain('Correct pattern');
    expect(code).toContain('WRONG pattern');
    expect(code).toContain('Immediately');
  });

  it('agentLoop.ts does NOT contain Auto-Continue or setInterval', () => {
    const fs = require('fs');
    const code = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf8');
    expect(code).not.toContain('Auto-Continue');
    expect(code).not.toContain('setInterval');
    expect(code).not.toContain('shouldFireNudge');
  });
});
