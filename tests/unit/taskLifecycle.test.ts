/**
 * Unit tests — Task Lifecycle (Sprint 27.2)
 *
 * Tests setActive, completeActive, advanceToNextPending, blockActive,
 * single active task invariant, priority-based advancement, broadcast events.
 */

import {
  createTodoList,
  getTodoList,
  setActive,
  completeActive,
  advanceToNextPending,
  blockActive,
  getActiveTask,
  getTodoProgress,
  isTodoComplete,
  clearTodoList,
  setTodoBroadcast,
  type TodoItem,
} from '../../src/main/orchestration/todoManager';

const results: Array<{ name: string; passed: boolean; error?: string }> = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, passed: true });
  } catch (err: any) {
    results.push({ name, passed: false, error: err.message || String(err) });
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const SESSION = 'test-lifecycle-' + Date.now();

function setup3Tasks(): void {
  clearTodoList(SESSION);
  createTodoList(SESSION, [
    { id: 'A', content: 'Task A', priority: 'high' },
    { id: 'B', content: 'Task B', priority: 'medium' },
    { id: 'C', content: 'Task C', priority: 'low' },
  ]);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('getActiveTask returns null when all pending', () => {
  setup3Tasks();
  assertEqual(getActiveTask(SESSION), null, 'no active task');
});

test('setActive transitions pending task to in_progress', () => {
  setup3Tasks();
  const item = setActive(SESSION, 'A');
  assert(item !== null, 'should return item');
  assertEqual(item!.status, 'in_progress', 'status');
  assertEqual(item!.id, 'A', 'id');
});

test('setActive is idempotent', () => {
  setup3Tasks();
  setActive(SESSION, 'A');
  const item = setActive(SESSION, 'A'); // second call
  assert(item !== null, 'should return item');
  assertEqual(item!.status, 'in_progress', 'status');
});

test('setActive enforces single active task', () => {
  setup3Tasks();
  setActive(SESSION, 'A');
  setActive(SESSION, 'B');
  const list = getTodoList(SESSION)!;
  const active = list.items.filter(i => i.status === 'in_progress');
  assertEqual(active.length, 1, 'only one active');
  assertEqual(active[0].id, 'B', 'B should be active');
  // A should be back to pending
  const a = list.items.find(i => i.id === 'A')!;
  assertEqual(a.status, 'pending', 'A should be pending');
});

test('setActive returns null for non-existent task', () => {
  setup3Tasks();
  assertEqual(setActive(SESSION, 'Z'), null, 'non-existent');
});

test('setActive returns null for done task', () => {
  setup3Tasks();
  setActive(SESSION, 'A');
  completeActive(SESSION);
  const result = setActive(SESSION, 'A');
  assertEqual(result, null, 'cannot reactivate done');
});

test('completeActive marks active task as done', () => {
  setup3Tasks();
  setActive(SESSION, 'A');
  const item = completeActive(SESSION);
  assert(item !== null, 'should return item');
  assertEqual(item!.status, 'done', 'status');
  assertEqual(item!.id, 'A', 'id');
});

test('completeActive with notes adds notes', () => {
  setup3Tasks();
  setActive(SESSION, 'A');
  const item = completeActive(SESSION, 'finished successfully');
  assertEqual(item!.notes, 'finished successfully', 'notes');
});

test('completeActive returns null when no active task', () => {
  setup3Tasks();
  assertEqual(completeActive(SESSION), null, 'no active');
});

test('advanceToNextPending activates first pending (priority order)', () => {
  setup3Tasks();
  const next = advanceToNextPending(SESSION);
  assert(next !== null, 'should return next');
  assertEqual(next!.id, 'A', 'should pick highest priority (A=high)');
  assertEqual(next!.status, 'in_progress', 'status');
});

test('advanceToNextPending skips done tasks', () => {
  setup3Tasks();
  setActive(SESSION, 'A');
  completeActive(SESSION);
  const next = advanceToNextPending(SESSION);
  assert(next !== null, 'should return next');
  assertEqual(next!.id, 'B', 'should pick B (A is done)');
});

test('advanceToNextPending returns null when all done', () => {
  setup3Tasks();
  setActive(SESSION, 'A'); completeActive(SESSION);
  advanceToNextPending(SESSION); // B
  completeActive(SESSION);
  advanceToNextPending(SESSION); // C
  completeActive(SESSION);
  assertEqual(advanceToNextPending(SESSION), null, 'none left');
});

test('advanceToNextPending returns existing active if one exists', () => {
  setup3Tasks();
  setActive(SESSION, 'B');
  const result = advanceToNextPending(SESSION);
  assert(result !== null, 'should return existing');
  assertEqual(result!.id, 'B', 'should return B not advance');
});

test('blockActive marks active task as blocked', () => {
  setup3Tasks();
  setActive(SESSION, 'A');
  const item = blockActive(SESSION, 'timeout');
  assert(item !== null, 'should return item');
  assertEqual(item!.status, 'blocked', 'status');
  assert(item!.notes?.includes('timeout'), 'notes should include reason');
});

test('blockActive returns null when no active task', () => {
  setup3Tasks();
  assertEqual(blockActive(SESSION), null, 'no active');
});

test('blockActive appends to existing notes', () => {
  setup3Tasks();
  setActive(SESSION, 'A');
  const list = getTodoList(SESSION)!;
  list.items[0].notes = 'existing note';
  const item = blockActive(SESSION, 'new reason');
  assert(item!.notes?.includes('existing note'), 'should keep existing');
  assert(item!.notes?.includes('new reason'), 'should add new');
});

test('getTodoProgress counts done tasks', () => {
  setup3Tasks();
  setActive(SESSION, 'A');
  completeActive(SESSION);
  const p = getTodoProgress(SESSION);
  assertEqual(p.done, 1, 'done');
  assertEqual(p.total, 3, 'total');
  assertEqual(p.pending.length, 2, 'pending count');
});

test('isTodoComplete returns false with pending tasks', () => {
  setup3Tasks();
  assertEqual(isTodoComplete(SESSION), false, 'not complete');
});

test('isTodoComplete returns true when all done', () => {
  setup3Tasks();
  setActive(SESSION, 'A'); completeActive(SESSION);
  advanceToNextPending(SESSION); completeActive(SESSION);
  advanceToNextPending(SESSION); completeActive(SESSION);
  assertEqual(isTodoComplete(SESSION), true, 'all complete');
});

test('full lifecycle A → B → C progression', () => {
  setup3Tasks();
  // Start first task
  advanceToNextPending(SESSION);
  assertEqual(getActiveTask(SESSION)!.id, 'A', 'A active');

  // Complete A, advance to B
  completeActive(SESSION);
  advanceToNextPending(SESSION);
  assertEqual(getActiveTask(SESSION)!.id, 'B', 'B active');

  // Complete B, advance to C
  completeActive(SESSION);
  advanceToNextPending(SESSION);
  assertEqual(getActiveTask(SESSION)!.id, 'C', 'C active');

  // Complete C
  completeActive(SESSION);
  assertEqual(getActiveTask(SESSION), null, 'no active');
  assertEqual(isTodoComplete(SESSION), true, 'all done');
});

// === Broadcast Tests ===

test('lifecycle events trigger broadcast', () => {
  const events: string[] = [];
  setTodoBroadcast((_sid, _items, event) => {
    events.push(event);
  });

  setup3Tasks(); // 'created'
  setActive(SESSION, 'A'); // 'active-changed'
  completeActive(SESSION); // 'completed'
  advanceToNextPending(SESSION); // 'advanced'
  blockActive(SESSION, 'test'); // 'blocked'

  assert(events.includes('created'), 'created event');
  assert(events.includes('active-changed'), 'active-changed event');
  assert(events.includes('completed'), 'completed event');
  assert(events.includes('advanced'), 'advanced event');
  assert(events.includes('blocked'), 'blocked event');

  // Clean up
  setTodoBroadcast(() => {});
});

test('non-existent session returns null for all lifecycle', () => {
  assertEqual(getActiveTask('nonexistent'), null, 'getActiveTask');
  assertEqual(setActive('nonexistent', 'x'), null, 'setActive');
  assertEqual(completeActive('nonexistent'), null, 'completeActive');
  assertEqual(advanceToNextPending('nonexistent'), null, 'advanceToNextPending');
  assertEqual(blockActive('nonexistent'), null, 'blockActive');
});

test('priority ordering: high > medium > low', () => {
  clearTodoList(SESSION);
  createTodoList(SESSION, [
    { id: 'L', content: 'Low task', priority: 'low' },
    { id: 'H', content: 'High task', priority: 'high' },
    { id: 'M', content: 'Medium task', priority: 'medium' },
  ]);
  const next = advanceToNextPending(SESSION);
  assertEqual(next!.id, 'H', 'should pick high priority first');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Report
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Cleanup
clearTodoList(SESSION);
setTodoBroadcast(() => {});

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

if (failed > 0) {
  console.error('\nFailed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.error(`  ✗ ${r.name}: ${r.error}`);
  });
}

console.log(`\ntaskLifecycle tests: ${passed} passed, ${failed} failed (${results.length} total)`);
process.exit(failed > 0 ? 1 : 0);
