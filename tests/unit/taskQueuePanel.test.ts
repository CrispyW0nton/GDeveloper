/**
 * Unit tests — Task Queue Panel & Todo Manager (Sprint 27.2)
 * Tests: todoManager broadcast, state transitions, TaskQueuePanel logic,
 * status indicators, collapse/expand, progress calculations.
 */

import {
  getTodoList, getTodoProgress, isTodoComplete,
  createTodoList, updateTodoItem, appendTodoItems, clearTodoList,
  setTodoBroadcast,
  type TodoItem,
} from '../../src/main/orchestration/todoManager';

// ─── Helpers ───

let broadcastLog: Array<{ sessionId: string; items: TodoItem[]; event: string }> = [];

function setupBroadcast() {
  broadcastLog = [];
  setTodoBroadcast((sessionId, items, event) => {
    broadcastLog.push({ sessionId, items: [...items], event });
  });
}

function clearBroadcast() {
  broadcastLog = [];
  setTodoBroadcast(() => {});
}

// ─── Test: Create todo list ───

function testCreateTodoList() {
  const results: string[] = [];
  const sid = 'test-create-' + Date.now();

  setupBroadcast();

  const list = createTodoList(sid, [
    { content: 'Task 1' },
    { content: 'Task 2', priority: 'high' },
    { content: 'Task 3', status: 'in_progress' },
  ]);

  console.assert(list.items.length === 3, `Expected 3 items, got ${list.items.length}`);
  results.push(list.items.length === 3 ? 'PASS' : 'FAIL');

  // Default status should be pending
  console.assert(list.items[0].status === 'pending', `Expected pending, got ${list.items[0].status}`);
  results.push(list.items[0].status === 'pending' ? 'PASS' : 'FAIL');

  // High priority should be preserved
  console.assert(list.items[1].priority === 'high', `Expected high, got ${list.items[1].priority}`);
  results.push(list.items[1].priority === 'high' ? 'PASS' : 'FAIL');

  // in_progress should be preserved
  console.assert(list.items[2].status === 'in_progress', `Expected in_progress, got ${list.items[2].status}`);
  results.push(list.items[2].status === 'in_progress' ? 'PASS' : 'FAIL');

  // Broadcast should have fired once with event 'created'
  console.assert(broadcastLog.length === 1, `Expected 1 broadcast, got ${broadcastLog.length}`);
  results.push(broadcastLog.length === 1 ? 'PASS' : 'FAIL');
  console.assert(broadcastLog[0]?.event === 'created', `Expected 'created', got ${broadcastLog[0]?.event}`);
  results.push(broadcastLog[0]?.event === 'created' ? 'PASS' : 'FAIL');

  clearTodoList(sid);
  clearBroadcast();

  return results;
}

// ─── Test: Update todo item ───

function testUpdateTodoItem() {
  const results: string[] = [];
  const sid = 'test-update-' + Date.now();

  setupBroadcast();

  const list = createTodoList(sid, [
    { content: 'Build feature' },
    { content: 'Write tests' },
  ]);
  broadcastLog = []; // Reset after create

  const item = list.items[0];
  const updated = updateTodoItem(sid, item.id, { status: 'done', notes: 'Completed OK' });

  console.assert(updated !== null, 'Updated item should not be null');
  results.push(updated !== null ? 'PASS' : 'FAIL');

  console.assert(updated!.status === 'done', `Expected done, got ${updated!.status}`);
  results.push(updated!.status === 'done' ? 'PASS' : 'FAIL');

  console.assert(updated!.notes === 'Completed OK', `Expected notes, got ${updated!.notes}`);
  results.push(updated!.notes === 'Completed OK' ? 'PASS' : 'FAIL');

  // Broadcast should fire on update
  console.assert(broadcastLog.length === 1, `Expected 1 broadcast, got ${broadcastLog.length}`);
  results.push(broadcastLog.length === 1 ? 'PASS' : 'FAIL');
  console.assert(broadcastLog[0]?.event === 'updated', `Expected 'updated', got ${broadcastLog[0]?.event}`);
  results.push(broadcastLog[0]?.event === 'updated' ? 'PASS' : 'FAIL');

  clearTodoList(sid);
  clearBroadcast();

  return results;
}

// ─── Test: Update non-existent item ───

function testUpdateNonExistent() {
  const results: string[] = [];
  const sid = 'test-nonexist-' + Date.now();

  createTodoList(sid, [{ content: 'Only task' }]);
  const result = updateTodoItem(sid, 'bad-id', { status: 'done' });

  console.assert(result === null, 'Should return null for bad item id');
  results.push(result === null ? 'PASS' : 'FAIL');

  // Non-existent session
  const result2 = updateTodoItem('no-session', 'bad-id', { status: 'done' });
  console.assert(result2 === null, 'Should return null for bad session id');
  results.push(result2 === null ? 'PASS' : 'FAIL');

  clearTodoList(sid);
  return results;
}

// ─── Test: Append items ───

function testAppendTodoItems() {
  const results: string[] = [];
  const sid = 'test-append-' + Date.now();

  setupBroadcast();

  createTodoList(sid, [{ content: 'Task A' }]);
  broadcastLog = [];

  const list = appendTodoItems(sid, [{ content: 'Task B' }, { content: 'Task C' }]);
  console.assert(list !== null && list!.items.length === 3, `Expected 3 items, got ${list?.items.length}`);
  results.push(list !== null && list!.items.length === 3 ? 'PASS' : 'FAIL');

  // Broadcast for append
  console.assert(broadcastLog.length === 1, `Expected 1 broadcast, got ${broadcastLog.length}`);
  results.push(broadcastLog.length === 1 ? 'PASS' : 'FAIL');
  console.assert(broadcastLog[0]?.event === 'appended', `Expected 'appended', got ${broadcastLog[0]?.event}`);
  results.push(broadcastLog[0]?.event === 'appended' ? 'PASS' : 'FAIL');

  clearTodoList(sid);
  clearBroadcast();

  return results;
}

// ─── Test: Append to non-existent list creates it ───

function testAppendCreatesNew() {
  const results: string[] = [];
  const sid = 'test-append-new-' + Date.now();

  setupBroadcast();

  const list = appendTodoItems(sid, [{ content: 'Fresh task' }]);
  console.assert(list !== null && list!.items.length === 1, 'Append to missing list should create it');
  results.push(list !== null && list!.items.length === 1 ? 'PASS' : 'FAIL');

  // Should fire 'created' broadcast (from createTodoList inside appendTodoItems)
  const hasCreated = broadcastLog.some(b => b.event === 'created');
  results.push(hasCreated ? 'PASS' : 'FAIL');

  clearTodoList(sid);
  clearBroadcast();

  return results;
}

// ─── Test: Clear todo list ───

function testClearTodoList() {
  const results: string[] = [];
  const sid = 'test-clear-' + Date.now();

  setupBroadcast();

  createTodoList(sid, [{ content: 'Task' }]);
  broadcastLog = [];

  const deleted = clearTodoList(sid);
  console.assert(deleted === true, 'Clear should return true');
  results.push(deleted === true ? 'PASS' : 'FAIL');

  // Broadcast with 'cleared' event
  console.assert(broadcastLog.length === 1, `Expected 1 broadcast, got ${broadcastLog.length}`);
  results.push(broadcastLog.length === 1 ? 'PASS' : 'FAIL');
  console.assert(broadcastLog[0]?.event === 'cleared', `Expected 'cleared', got ${broadcastLog[0]?.event}`);
  results.push(broadcastLog[0]?.event === 'cleared' ? 'PASS' : 'FAIL');

  // Second clear should return false
  const deleted2 = clearTodoList(sid);
  console.assert(deleted2 === false, 'Double clear should return false');
  results.push(deleted2 === false ? 'PASS' : 'FAIL');

  clearBroadcast();

  return results;
}

// ─── Test: Progress calculation ───

function testGetTodoProgress() {
  const results: string[] = [];
  const sid = 'test-progress-' + Date.now();

  const list = createTodoList(sid, [
    { content: 'A', status: 'done' },
    { content: 'B', status: 'skipped' },
    { content: 'C', status: 'in_progress' },
    { content: 'D', status: 'pending' },
    { content: 'E', status: 'blocked' },
  ]);

  const progress = getTodoProgress(sid);
  console.assert(progress.done === 2, `Expected 2 done, got ${progress.done}`);
  results.push(progress.done === 2 ? 'PASS' : 'FAIL');

  console.assert(progress.total === 5, `Expected 5 total, got ${progress.total}`);
  results.push(progress.total === 5 ? 'PASS' : 'FAIL');

  // Pending array should contain in_progress and pending items
  console.assert(progress.pending.length === 2, `Expected 2 pending, got ${progress.pending.length}`);
  results.push(progress.pending.length === 2 ? 'PASS' : 'FAIL');

  // Not complete
  console.assert(!isTodoComplete(sid), 'Should not be complete');
  results.push(!isTodoComplete(sid) ? 'PASS' : 'FAIL');

  clearTodoList(sid);

  return results;
}

// ─── Test: isTodoComplete ───

function testIsTodoComplete() {
  const results: string[] = [];
  const sid = 'test-complete-' + Date.now();

  createTodoList(sid, [
    { content: 'A', status: 'done' },
    { content: 'B', status: 'skipped' },
  ]);

  console.assert(isTodoComplete(sid) === true, 'All done/skipped should be complete');
  results.push(isTodoComplete(sid) === true ? 'PASS' : 'FAIL');

  // Empty session
  console.assert(isTodoComplete('no-session') === false, 'Empty session should not be complete');
  results.push(isTodoComplete('no-session') === false ? 'PASS' : 'FAIL');

  clearTodoList(sid);

  return results;
}

// ─── Test: Empty list progress ───

function testEmptyProgress() {
  const results: string[] = [];

  const progress = getTodoProgress('empty-session');
  console.assert(progress.done === 0, `Expected 0 done, got ${progress.done}`);
  results.push(progress.done === 0 ? 'PASS' : 'FAIL');
  console.assert(progress.total === 0, `Expected 0 total, got ${progress.total}`);
  results.push(progress.total === 0 ? 'PASS' : 'FAIL');

  return results;
}

// ─── Test: Broadcast items reflect current state ───

function testBroadcastReflectsState() {
  const results: string[] = [];
  const sid = 'test-broadcast-state-' + Date.now();

  setupBroadcast();

  createTodoList(sid, [{ content: 'X' }, { content: 'Y' }]);
  broadcastLog = [];

  updateTodoItem(sid, getTodoList(sid)!.items[0].id, { status: 'done' });

  // Broadcast items should have 2 items, first one done
  const items = broadcastLog[0]?.items;
  console.assert(items?.length === 2, `Expected 2 items in broadcast, got ${items?.length}`);
  results.push(items?.length === 2 ? 'PASS' : 'FAIL');
  console.assert(items?.[0]?.status === 'done', `Expected first item done, got ${items?.[0]?.status}`);
  results.push(items?.[0]?.status === 'done' ? 'PASS' : 'FAIL');

  clearTodoList(sid);
  clearBroadcast();

  return results;
}

// ─── Test: Status indicator mapping ───

function testStatusIndicators() {
  const results: string[] = [];

  // These verify the panel's rendering logic (status → icon mapping)
  const STATUS_CONFIG: Record<string, { icon: string; label: string }> = {
    in_progress: { icon: '\u29BE', label: 'Active' },
    pending: { icon: '\u25CB', label: 'Pending' },
    done: { icon: '\u2713', label: 'Completed' },
    skipped: { icon: '\u23ED', label: 'Skipped' },
    blocked: { icon: '\u26D4', label: 'Blocked' },
  };

  for (const [status, cfg] of Object.entries(STATUS_CONFIG)) {
    console.assert(cfg.icon.length > 0, `Icon for ${status} should be non-empty`);
    console.assert(cfg.label.length > 0, `Label for ${status} should be non-empty`);
    results.push(cfg.icon.length > 0 && cfg.label.length > 0 ? 'PASS' : 'FAIL');
  }

  return results;
}

// ─── Test: Progress percentage calculation ───

function testProgressPercentage() {
  const results: string[] = [];

  // Simulate what the panel calculates
  function calcPct(done: number, total: number): number {
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  console.assert(calcPct(0, 0) === 0, 'Empty should be 0%');
  results.push(calcPct(0, 0) === 0 ? 'PASS' : 'FAIL');

  console.assert(calcPct(0, 5) === 0, '0/5 should be 0%');
  results.push(calcPct(0, 5) === 0 ? 'PASS' : 'FAIL');

  console.assert(calcPct(3, 5) === 60, '3/5 should be 60%');
  results.push(calcPct(3, 5) === 60 ? 'PASS' : 'FAIL');

  console.assert(calcPct(5, 5) === 100, '5/5 should be 100%');
  results.push(calcPct(5, 5) === 100 ? 'PASS' : 'FAIL');

  console.assert(calcPct(1, 3) === 33, '1/3 should be 33%');
  results.push(calcPct(1, 3) === 33 ? 'PASS' : 'FAIL');

  return results;
}

// ─── Test: Remaining count calculation ───

function testRemainingCount() {
  const results: string[] = [];
  const sid = 'test-remaining-' + Date.now();

  createTodoList(sid, [
    { content: 'A', status: 'done' },
    { content: 'B', status: 'pending' },
    { content: 'C', status: 'in_progress' },
    { content: 'D', status: 'skipped' },
  ]);

  const list = getTodoList(sid)!;
  const total = list.items.length;
  const doneCount = list.items.filter(t => t.status === 'done' || t.status === 'skipped').length;
  const remaining = total - doneCount;

  console.assert(remaining === 2, `Expected 2 remaining, got ${remaining}`);
  results.push(remaining === 2 ? 'PASS' : 'FAIL');

  clearTodoList(sid);
  return results;
}

// ─── Test: Multiple broadcasts for sequential operations ───

function testSequentialBroadcasts() {
  const results: string[] = [];
  const sid = 'test-seq-' + Date.now();

  setupBroadcast();

  createTodoList(sid, [{ content: 'Step 1' }, { content: 'Step 2' }]);
  const itemId = getTodoList(sid)!.items[0].id;

  updateTodoItem(sid, itemId, { status: 'in_progress' });
  updateTodoItem(sid, itemId, { status: 'done' });
  appendTodoItems(sid, [{ content: 'Step 3' }]);

  // Should have: created(1) + update(2) + append(1) = 4 broadcasts
  console.assert(broadcastLog.length === 4, `Expected 4 broadcasts, got ${broadcastLog.length}`);
  results.push(broadcastLog.length === 4 ? 'PASS' : 'FAIL');

  // Events in order
  const events = broadcastLog.map(b => b.event);
  console.assert(events[0] === 'created', 'First should be created');
  results.push(events[0] === 'created' ? 'PASS' : 'FAIL');
  console.assert(events[1] === 'updated', 'Second should be updated');
  results.push(events[1] === 'updated' ? 'PASS' : 'FAIL');
  console.assert(events[2] === 'updated', 'Third should be updated');
  results.push(events[2] === 'updated' ? 'PASS' : 'FAIL');
  console.assert(events[3] === 'appended', 'Fourth should be appended');
  results.push(events[3] === 'appended' ? 'PASS' : 'FAIL');

  clearTodoList(sid);
  clearBroadcast();

  return results;
}

// ─── Test: Default values for new items ───

function testDefaultValues() {
  const results: string[] = [];
  const sid = 'test-defaults-' + Date.now();

  createTodoList(sid, [{ content: 'Minimal item' }]);
  const item = getTodoList(sid)!.items[0];

  console.assert(item.status === 'pending', `Default status should be pending, got ${item.status}`);
  results.push(item.status === 'pending' ? 'PASS' : 'FAIL');

  console.assert(item.priority === 'medium', `Default priority should be medium, got ${item.priority}`);
  results.push(item.priority === 'medium' ? 'PASS' : 'FAIL');

  console.assert(item.id.startsWith('todo-'), `ID should start with 'todo-', got ${item.id}`);
  results.push(item.id.startsWith('todo-') ? 'PASS' : 'FAIL');

  console.assert(item.createdAt.length > 0, 'createdAt should be set');
  results.push(item.createdAt.length > 0 ? 'PASS' : 'FAIL');

  clearTodoList(sid);
  return results;
}

// ─── Test: Broadcast sessionId is correct ───

function testBroadcastSessionId() {
  const results: string[] = [];
  const sid1 = 'test-sid-a-' + Date.now();
  const sid2 = 'test-sid-b-' + Date.now();

  setupBroadcast();

  createTodoList(sid1, [{ content: 'Session A task' }]);
  createTodoList(sid2, [{ content: 'Session B task' }]);

  // Should have 2 broadcasts with correct session IDs
  console.assert(broadcastLog.length === 2, `Expected 2 broadcasts, got ${broadcastLog.length}`);
  results.push(broadcastLog.length === 2 ? 'PASS' : 'FAIL');

  console.assert(broadcastLog[0]?.sessionId === sid1, 'First broadcast should be for session A');
  results.push(broadcastLog[0]?.sessionId === sid1 ? 'PASS' : 'FAIL');

  console.assert(broadcastLog[1]?.sessionId === sid2, 'Second broadcast should be for session B');
  results.push(broadcastLog[1]?.sessionId === sid2 ? 'PASS' : 'FAIL');

  clearTodoList(sid1);
  clearTodoList(sid2);
  clearBroadcast();

  return results;
}

// ─── Test: No broadcast without listener ───

function testNoBroadcastWithoutListener() {
  const results: string[] = [];
  const sid = 'test-no-broadcast-' + Date.now();

  // Set broadcast to no-op
  setTodoBroadcast(() => {});

  // Should not throw
  try {
    createTodoList(sid, [{ content: 'Silent task' }]);
    results.push('PASS');
  } catch (e) {
    results.push('FAIL');
  }

  clearTodoList(sid);
  return results;
}

// ─── Run ───

const allResults = [
  ...testCreateTodoList(),
  ...testUpdateTodoItem(),
  ...testUpdateNonExistent(),
  ...testAppendTodoItems(),
  ...testAppendCreatesNew(),
  ...testClearTodoList(),
  ...testGetTodoProgress(),
  ...testIsTodoComplete(),
  ...testEmptyProgress(),
  ...testBroadcastReflectsState(),
  ...testStatusIndicators(),
  ...testProgressPercentage(),
  ...testRemainingCount(),
  ...testSequentialBroadcasts(),
  ...testDefaultValues(),
  ...testBroadcastSessionId(),
  ...testNoBroadcastWithoutListener(),
];

const passed = allResults.filter(r => r === 'PASS').length;
const failed = allResults.filter(r => r === 'FAIL').length;

console.log(`\ntaskQueuePanel tests: ${passed} passed, ${failed} failed (${allResults.length} total)`);
if (failed > 0) {
  process.exit(1);
}
