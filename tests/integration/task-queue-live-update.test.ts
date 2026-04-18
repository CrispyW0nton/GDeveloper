/**
 * Integration tests — Task Queue Live Update (Sprint 27.2)
 * Tests the full flow: todoManager mutation → broadcast → IPC channel → renderer update.
 * Since we can't instantiate real Electron IPC in unit tests, we test
 * the todoManager → broadcast contract and verify the IPC channel constant.
 */

import {
  createTodoList, updateTodoItem, appendTodoItems, clearTodoList,
  getTodoProgress, isTodoComplete, setTodoBroadcast,
  type TodoItem,
} from '../../src/main/orchestration/todoManager';
import { IPC_CHANNELS } from '../../src/main/ipc';

// ─── Helpers ───

let broadcastLog: Array<{ sessionId: string; items: TodoItem[]; event: string }> = [];

function setup() {
  broadcastLog = [];
  setTodoBroadcast((sessionId, items, event) => {
    broadcastLog.push({ sessionId, items: [...items], event });
  });
}

function teardown(sid: string) {
  clearTodoList(sid);
  broadcastLog = [];
  setTodoBroadcast(() => {});
}

// ─── Test: IPC channel constant is registered ───

function testIPCChannelExists() {
  const results: string[] = [];

  console.assert(IPC_CHANNELS.TODO_CHANGED === 'todo:changed', `Expected 'todo:changed', got ${IPC_CHANNELS.TODO_CHANGED}`);
  results.push(IPC_CHANNELS.TODO_CHANGED === 'todo:changed' ? 'PASS' : 'FAIL');

  // Verify other todo channels exist too
  console.assert(IPC_CHANNELS.TODO_GET === 'todo:get', 'TODO_GET should be defined');
  results.push(IPC_CHANNELS.TODO_GET === 'todo:get' ? 'PASS' : 'FAIL');

  console.assert(IPC_CHANNELS.TODO_CREATE === 'todo:create', 'TODO_CREATE should be defined');
  results.push(IPC_CHANNELS.TODO_CREATE === 'todo:create' ? 'PASS' : 'FAIL');

  console.assert(IPC_CHANNELS.TODO_UPDATE_ITEM === 'todo:update-item', 'TODO_UPDATE_ITEM should be defined');
  results.push(IPC_CHANNELS.TODO_UPDATE_ITEM === 'todo:update-item' ? 'PASS' : 'FAIL');

  return results;
}

// ─── Test: Full lifecycle — create → update → complete flow with broadcasts ───

function testFullLifecycle() {
  const results: string[] = [];
  const sid = 'integ-lifecycle-' + Date.now();

  setup();

  // 1. Create a plan with 3 tasks
  const list = createTodoList(sid, [
    { content: 'Implement feature', priority: 'high' },
    { content: 'Write tests', priority: 'medium' },
    { content: 'Update docs', priority: 'low' },
  ]);

  console.assert(broadcastLog.length === 1, 'Create should trigger 1 broadcast');
  results.push(broadcastLog.length === 1 ? 'PASS' : 'FAIL');
  console.assert(broadcastLog[0]?.items.length === 3, 'Broadcast should contain 3 items');
  results.push(broadcastLog[0]?.items.length === 3 ? 'PASS' : 'FAIL');

  // 2. Start working on task 1
  const task1Id = list.items[0].id;
  updateTodoItem(sid, task1Id, { status: 'in_progress' });

  console.assert(broadcastLog.length === 2, 'Update should trigger another broadcast');
  results.push(broadcastLog.length === 2 ? 'PASS' : 'FAIL');

  // Verify progress mid-way
  const progressMid = getTodoProgress(sid);
  console.assert(progressMid.done === 0, 'No tasks done yet');
  results.push(progressMid.done === 0 ? 'PASS' : 'FAIL');
  console.assert(progressMid.pending.length === 3, 'All 3 tasks should be in pending list (includes in_progress)');
  results.push(progressMid.pending.length === 3 ? 'PASS' : 'FAIL');

  // 3. Complete task 1
  updateTodoItem(sid, task1Id, { status: 'done', notes: 'Feature shipped' });

  const progressAfter = getTodoProgress(sid);
  console.assert(progressAfter.done === 1, 'One task should be done');
  results.push(progressAfter.done === 1 ? 'PASS' : 'FAIL');

  // 4. Skip task 3 (docs)
  const task3Id = list.items[2].id;
  updateTodoItem(sid, task3Id, { status: 'skipped' });

  const progressSkip = getTodoProgress(sid);
  console.assert(progressSkip.done === 2, 'Done+skipped = 2');
  results.push(progressSkip.done === 2 ? 'PASS' : 'FAIL');

  // 5. Not complete yet (task 2 still pending)
  console.assert(!isTodoComplete(sid), 'Should not be complete');
  results.push(!isTodoComplete(sid) ? 'PASS' : 'FAIL');

  // 6. Complete task 2
  const task2Id = list.items[1].id;
  updateTodoItem(sid, task2Id, { status: 'done' });

  console.assert(isTodoComplete(sid), 'Should be complete now');
  results.push(isTodoComplete(sid) ? 'PASS' : 'FAIL');

  // Total broadcasts: 1 create + 4 updates = 5
  console.assert(broadcastLog.length === 5, `Expected 5 broadcasts, got ${broadcastLog.length}`);
  results.push(broadcastLog.length === 5 ? 'PASS' : 'FAIL');

  teardown(sid);
  return results;
}

// ─── Test: Append during active loop ───

function testAppendDuringLoop() {
  const results: string[] = [];
  const sid = 'integ-append-' + Date.now();

  setup();

  // Start with 2 tasks
  createTodoList(sid, [
    { content: 'Phase 1' },
    { content: 'Phase 2' },
  ]);

  // Agent discovers more work and appends
  appendTodoItems(sid, [
    { content: 'Phase 3 (discovered)' },
    { content: 'Phase 4 (discovered)' },
  ]);

  // Should now have 4 tasks total
  const progress = getTodoProgress(sid);
  console.assert(progress.total === 4, `Expected 4 total, got ${progress.total}`);
  results.push(progress.total === 4 ? 'PASS' : 'FAIL');

  // Broadcast count: create(1) + append(1) = 2
  console.assert(broadcastLog.length === 2, `Expected 2 broadcasts, got ${broadcastLog.length}`);
  results.push(broadcastLog.length === 2 ? 'PASS' : 'FAIL');

  // Last broadcast should have all 4 items
  const lastItems = broadcastLog[broadcastLog.length - 1]?.items;
  console.assert(lastItems?.length === 4, `Last broadcast should have 4 items, got ${lastItems?.length}`);
  results.push(lastItems?.length === 4 ? 'PASS' : 'FAIL');

  teardown(sid);
  return results;
}

// ─── Test: Clear resets everything and broadcasts ───

function testClearBroadcast() {
  const results: string[] = [];
  const sid = 'integ-clear-' + Date.now();

  setup();

  createTodoList(sid, [{ content: 'Temp task' }]);
  broadcastLog = [];

  clearTodoList(sid);

  console.assert(broadcastLog.length === 1, 'Clear should broadcast');
  results.push(broadcastLog.length === 1 ? 'PASS' : 'FAIL');

  console.assert(broadcastLog[0]?.event === 'cleared', 'Event should be cleared');
  results.push(broadcastLog[0]?.event === 'cleared' ? 'PASS' : 'FAIL');

  // Items should be empty after clear
  console.assert(broadcastLog[0]?.items.length === 0, 'Items should be empty after clear');
  results.push(broadcastLog[0]?.items.length === 0 ? 'PASS' : 'FAIL');

  teardown(sid);
  return results;
}

// ─── Test: Multiple sessions don't interfere ───

function testMultiSessionIsolation() {
  const results: string[] = [];
  const sidA = 'integ-iso-a-' + Date.now();
  const sidB = 'integ-iso-b-' + Date.now();

  setup();

  createTodoList(sidA, [{ content: 'A task 1' }]);
  createTodoList(sidB, [{ content: 'B task 1' }, { content: 'B task 2' }]);

  const progressA = getTodoProgress(sidA);
  const progressB = getTodoProgress(sidB);

  console.assert(progressA.total === 1, `Session A should have 1 task, got ${progressA.total}`);
  results.push(progressA.total === 1 ? 'PASS' : 'FAIL');

  console.assert(progressB.total === 2, `Session B should have 2 tasks, got ${progressB.total}`);
  results.push(progressB.total === 2 ? 'PASS' : 'FAIL');

  // Broadcasts should have correct session IDs
  const abroadcasts = broadcastLog.filter(b => b.sessionId === sidA);
  const bbroadcasts = broadcastLog.filter(b => b.sessionId === sidB);
  console.assert(abroadcasts.length === 1, 'Session A should have 1 broadcast');
  results.push(abroadcasts.length === 1 ? 'PASS' : 'FAIL');
  console.assert(bbroadcasts.length === 1, 'Session B should have 1 broadcast');
  results.push(bbroadcasts.length === 1 ? 'PASS' : 'FAIL');

  teardown(sidA);
  teardown(sidB);
  return results;
}

// ─── Run ───

const allResults = [
  ...testIPCChannelExists(),
  ...testFullLifecycle(),
  ...testAppendDuringLoop(),
  ...testClearBroadcast(),
  ...testMultiSessionIsolation(),
];

const passed = allResults.filter(r => r === 'PASS').length;
const failed = allResults.filter(r => r === 'FAIL').length;

console.log(`\ntask-queue-live-update integration tests: ${passed} passed, ${failed} failed (${allResults.length} total)`);
if (failed > 0) {
  process.exit(1);
}
