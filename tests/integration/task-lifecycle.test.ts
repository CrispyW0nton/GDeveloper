/**
 * Integration tests — Task Lifecycle (Sprint 27.2)
 *
 * Tests the full integration of todoManager lifecycle with:
 * - Task creation via createTodoList
 * - Active task enforcement (single active)
 * - Complete → advance progression
 * - Error/timeout → block active task
 * - Broadcast events on every state change
 * - Integration with autoContinueState progress tracking
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
  updateTodoItem,
} from '../../src/main/orchestration/todoManager';

import {
  startMachine,
  resetMachine,
  updateProgress,
  getSnapshot,
  shouldFireNudge,
} from '../../src/main/orchestration/autoContinueState';

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

const SESSION = 'integration-lifecycle-' + Date.now();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('Full 3-task lifecycle with broadcast tracking', () => {
  const events: Array<{ event: string; itemCount: number }> = [];
  setTodoBroadcast((_sid, items, event) => {
    events.push({ event, itemCount: items.length });
  });

  // Create plan
  createTodoList(SESSION, [
    { id: 'T1', content: 'Setup project', priority: 'high' },
    { id: 'T2', content: 'Implement feature', priority: 'medium' },
    { id: 'T3', content: 'Write tests', priority: 'low' },
  ]);
  assert(events.some(e => e.event === 'created'), 'created broadcast');
  assertEqual(events[events.length - 1].itemCount, 3, 'created with 3 items');

  // Advance to first task
  advanceToNextPending(SESSION);
  assertEqual(getActiveTask(SESSION)!.id, 'T1', 'T1 active');
  assert(events.some(e => e.event === 'advanced'), 'advanced broadcast');

  // Complete T1 → advance T2
  completeActive(SESSION);
  assert(events.some(e => e.event === 'completed'), 'completed broadcast');
  advanceToNextPending(SESSION);
  assertEqual(getActiveTask(SESSION)!.id, 'T2', 'T2 active');

  // Complete T2 → advance T3
  completeActive(SESSION);
  advanceToNextPending(SESSION);
  assertEqual(getActiveTask(SESSION)!.id, 'T3', 'T3 active');

  // Complete T3
  completeActive(SESSION);
  assertEqual(isTodoComplete(SESSION), true, 'all complete');
  assertEqual(getActiveTask(SESSION), null, 'no active after all done');

  // Verify progress
  const progress = getTodoProgress(SESSION);
  assertEqual(progress.done, 3, 'done=3');
  assertEqual(progress.total, 3, 'total=3');
  assertEqual(progress.pending.length, 0, 'no pending');

  // Clean up
  setTodoBroadcast(() => {});
});

test('Timeout blocks active task, allows advancing past it', () => {
  clearTodoList(SESSION);
  createTodoList(SESSION, [
    { id: 'X1', content: 'Normal task', priority: 'high' },
    { id: 'X2', content: 'Task that will timeout', priority: 'medium' },
    { id: 'X3', content: 'Recovery task', priority: 'low' },
  ]);

  // Start X1 and complete it
  advanceToNextPending(SESSION);
  completeActive(SESSION);

  // Start X2 and simulate timeout → block it
  advanceToNextPending(SESSION);
  assertEqual(getActiveTask(SESSION)!.id, 'X2', 'X2 active');
  blockActive(SESSION, 'Tool timed out after 120s');

  // X2 is blocked, so advance should pick X3
  assertEqual(getActiveTask(SESSION), null, 'no active (X2 blocked)');
  advanceToNextPending(SESSION);
  assertEqual(getActiveTask(SESSION)!.id, 'X3', 'X3 active');

  // Verify X2 status
  const list = getTodoList(SESSION)!;
  const x2 = list.items.find(i => i.id === 'X2')!;
  assertEqual(x2.status, 'blocked', 'X2 is blocked');
  assert(x2.notes?.includes('timed out'), 'notes have timeout reason');
});

test('Integration with autoContinueState progress', () => {
  clearTodoList(SESSION);
  resetMachine();
  startMachine(10);

  createTodoList(SESSION, [
    { id: 'P1', content: 'Task 1' },
    { id: 'P2', content: 'Task 2' },
    { id: 'P3', content: 'Task 3' },
  ]);

  // Sync progress to state machine
  let progress = getTodoProgress(SESSION);
  updateProgress(progress.done, progress.total);
  let snap = getSnapshot();
  assertEqual(snap.tasksCompleted, 0, 'initially 0 complete');
  assertEqual(snap.tasksTotal, 3, 'total=3');

  // Complete first task
  advanceToNextPending(SESSION);
  completeActive(SESSION);
  progress = getTodoProgress(SESSION);
  updateProgress(progress.done, progress.total);
  snap = getSnapshot();
  assertEqual(snap.tasksCompleted, 1, '1 complete');

  // Complete second task
  advanceToNextPending(SESSION);
  completeActive(SESSION);
  progress = getTodoProgress(SESSION);
  updateProgress(progress.done, progress.total);
  snap = getSnapshot();
  assertEqual(snap.tasksCompleted, 2, '2 complete');

  // Complete third task
  advanceToNextPending(SESSION);
  completeActive(SESSION);
  progress = getTodoProgress(SESSION);
  updateProgress(progress.done, progress.total);
  snap = getSnapshot();
  assertEqual(snap.tasksCompleted, 3, '3 complete');

  resetMachine();
});

test('Broadcast fires for every mutation type', () => {
  const events: string[] = [];
  setTodoBroadcast((_sid, _items, event) => {
    events.push(event);
  });

  clearTodoList(SESSION);
  createTodoList(SESSION, [
    { id: 'E1', content: 'Task 1' },
    { id: 'E2', content: 'Task 2' },
  ]);

  events.length = 0; // Reset after create

  setActive(SESSION, 'E1');
  assert(events.includes('active-changed'), 'active-changed event');

  completeActive(SESSION);
  assert(events.includes('completed'), 'completed event');

  advanceToNextPending(SESSION);
  assert(events.includes('advanced'), 'advanced event');

  blockActive(SESSION, 'test');
  assert(events.includes('blocked'), 'blocked event');

  updateTodoItem(SESSION, 'E1', { notes: 'updated' });
  assert(events.includes('updated'), 'updated event');

  clearTodoList(SESSION);
  // 'cleared' event fires before clearTodoList returns (from the old list)
  setTodoBroadcast(() => {});
});

test('Idempotent setActive does not generate extra broadcasts', () => {
  clearTodoList(SESSION);
  let broadcastCount = 0;
  setTodoBroadcast(() => { broadcastCount++; });

  createTodoList(SESSION, [{ id: 'I1', content: 'Task' }]);
  broadcastCount = 0; // Reset

  setActive(SESSION, 'I1'); // first call
  const count1 = broadcastCount;
  setActive(SESSION, 'I1'); // idempotent — should NOT broadcast
  assertEqual(broadcastCount, count1, 'idempotent setActive should not broadcast again');

  setTodoBroadcast(() => {});
});

test('Multiple rapid state changes produce correct final state', () => {
  clearTodoList(SESSION);
  createTodoList(SESSION, [
    { id: 'R1', content: 'Task 1', priority: 'high' },
    { id: 'R2', content: 'Task 2', priority: 'medium' },
    { id: 'R3', content: 'Task 3', priority: 'low' },
    { id: 'R4', content: 'Task 4', priority: 'medium' },
    { id: 'R5', content: 'Task 5', priority: 'high' },
  ]);

  // Rapid progression
  for (let i = 0; i < 5; i++) {
    advanceToNextPending(SESSION);
    completeActive(SESSION);
  }

  const progress = getTodoProgress(SESSION);
  assertEqual(progress.done, 5, 'all 5 done');
  assertEqual(progress.total, 5, 'total=5');
  assertEqual(isTodoComplete(SESSION), true, 'all complete');
});

test('Block then skip: blocked tasks count as not-done in progress', () => {
  clearTodoList(SESSION);
  createTodoList(SESSION, [
    { id: 'B1', content: 'Task 1' },
    { id: 'B2', content: 'Task 2' },
  ]);

  advanceToNextPending(SESSION);
  blockActive(SESSION, 'stall');

  const progress = getTodoProgress(SESSION);
  // Blocked is not 'done' or 'skipped', so it doesn't count
  assertEqual(progress.done, 0, 'blocked is not done');
  assertEqual(progress.total, 2, 'total=2');
  assert(!isTodoComplete(SESSION), 'not complete with blocked task');
});

test('Skipping a task counts as done in progress', () => {
  clearTodoList(SESSION);
  createTodoList(SESSION, [
    { id: 'S1', content: 'Task 1' },
    { id: 'S2', content: 'Task 2' },
  ]);

  updateTodoItem(SESSION, 'S1', { status: 'skipped' });
  advanceToNextPending(SESSION);
  completeActive(SESSION);

  const progress = getTodoProgress(SESSION);
  assertEqual(progress.done, 2, 'skipped + done = 2');
  assertEqual(isTodoComplete(SESSION), true, 'all complete');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Report
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

clearTodoList(SESSION);
setTodoBroadcast(() => {});
resetMachine();

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

if (failed > 0) {
  console.error('\nFailed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.error(`  ✗ ${r.name}: ${r.error}`);
  });
}

console.log(`\ntask-lifecycle integration tests: ${passed} passed, ${failed} failed (${results.length} total)`);
process.exit(failed > 0 ? 1 : 0);
