/**
 * Todo Tool Tests — Sprint 27.5
 *
 * Validates the Claude Code TodoWrite-compatible tool:
 * - Rejects two in_progress tasks
 * - Idempotent replacement
 * - Returns model-readable summary
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { executeTodo, getTodos, type TodoWriteInput } from '../../src/main/tools/taskTool';

describe('todoTool', () => {
  beforeEach(() => {
    // Reset state by sending empty list
    executeTodo({ todos: [] });
  });

  it('accepts a valid todo list', () => {
    const result = executeTodo({
      todos: [
        { id: '1', content: 'First task', status: 'pending', priority: 'high' },
        { id: '2', content: 'Second task', status: 'pending', priority: 'medium' },
      ],
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('0/2 completed');
    expect(result.content).toContain('2 pending');
  });

  it('rejects two in_progress tasks', () => {
    const result = executeTodo({
      todos: [
        { id: '1', content: 'Task A', status: 'in_progress', priority: 'high' },
        { id: '2', content: 'Task B', status: 'in_progress', priority: 'medium' },
      ],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('zero or one');
  });

  it('accepts exactly one in_progress task', () => {
    const result = executeTodo({
      todos: [
        { id: '1', content: 'Active task', status: 'in_progress', priority: 'high' },
        { id: '2', content: 'Pending task', status: 'pending', priority: 'medium' },
      ],
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Active: "Active task"');
  });

  it('replaces the full list idempotently', () => {
    executeTodo({
      todos: [
        { id: '1', content: 'Old task', status: 'pending', priority: 'low' },
      ],
    });

    const before = getTodos();
    expect(before).toHaveLength(1);
    expect(before[0].content).toBe('Old task');

    executeTodo({
      todos: [
        { id: 'a', content: 'New task 1', status: 'pending', priority: 'high' },
        { id: 'b', content: 'New task 2', status: 'completed', priority: 'medium' },
      ],
    });

    const after = getTodos();
    expect(after).toHaveLength(2);
    expect(after[0].content).toBe('New task 1');
    expect(after[1].status).toBe('completed');
  });

  it('rejects missing todos array', () => {
    const result = executeTodo({} as TodoWriteInput);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('must be an array');
  });

  it('rejects invalid status', () => {
    const result = executeTodo({
      todos: [
        { id: '1', content: 'Task', status: 'invalid_status' as any, priority: 'high' },
      ],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('invalid status');
  });

  it('rejects missing content', () => {
    const result = executeTodo({
      todos: [
        { id: '1', content: '', status: 'pending', priority: 'high' },
      ],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('non-empty');
  });

  it('returns a model-readable summary', () => {
    const result = executeTodo({
      todos: [
        { id: '1', content: 'Task 1', status: 'completed', priority: 'high' },
        { id: '2', content: 'Task 2', status: 'in_progress', priority: 'medium' },
        { id: '3', content: 'Task 3', status: 'pending', priority: 'low' },
      ],
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('1/3 completed');
    expect(result.content).toContain('1 pending');
    expect(result.content).toContain('Active: "Task 2"');
  });

  it('zero in_progress is valid', () => {
    const result = executeTodo({
      todos: [
        { id: '1', content: 'Done 1', status: 'completed', priority: 'high' },
        { id: '2', content: 'Pending 1', status: 'pending', priority: 'medium' },
      ],
    });

    expect(result.isError).toBe(false);
  });

  it('empty list is valid', () => {
    const result = executeTodo({ todos: [] });
    expect(result.isError).toBe(false);
    expect(getTodos()).toHaveLength(0);
  });
});
