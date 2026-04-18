/**
 * taskTool.test.ts — Sprint 27.3
 * Unit tests for the Claude Code TodoWrite-compatible task tool.
 */

let passed = 0;
let failed = 0;
const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (e: any) {
      failed++;
      console.log(`  ✗ ${t.name}: ${e.message}`);
    }
  }
  console.log(`\ntaskTool tests: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failed > 0) process.exit(1);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ─── Import task tool ───

const { executeTaskTool, setTaskToolSessionId, TASK_TOOL_DEFINITION } = require('../../src/main/tools/taskTool');
const { getTodoList, clearTodoList, getActiveTask } = require('../../src/main/orchestration/todoManager');

// Use a test session
const SESSION = 'test-session-task-tool';

function cleanup() {
  clearTodoList(SESSION);
  setTaskToolSessionId(SESSION);
}

// ─── Test: Tool definition matches Claude Code TodoWrite ───

test('TASK_TOOL_DEFINITION has name todo_write', () => {
  assert(TASK_TOOL_DEFINITION.name === 'todo_write', `Expected 'todo_write', got '${TASK_TOOL_DEFINITION.name}'`);
});

test('TASK_TOOL_DEFINITION requires todos array', () => {
  assert(TASK_TOOL_DEFINITION.input_schema.required.includes('todos'), 'Should require todos');
});

test('Todo item schema has id, content, status, priority', () => {
  const props = TASK_TOOL_DEFINITION.input_schema.properties.todos.items.properties;
  assert(props.id, 'Should have id');
  assert(props.content, 'Should have content');
  assert(props.status, 'Should have status');
  assert(props.priority, 'Should have priority');
});

test('Status enum includes pending, in_progress, completed', () => {
  const statusEnum = TASK_TOOL_DEFINITION.input_schema.properties.todos.items.properties.status.enum;
  assert(statusEnum.includes('pending'), 'Should include pending');
  assert(statusEnum.includes('in_progress'), 'Should include in_progress');
  assert(statusEnum.includes('completed'), 'Should include completed');
});

// ─── Test: Empty input ───

test('Returns error for empty todos array', () => {
  cleanup();
  const result = executeTaskTool({ todos: [] });
  assert(result.success === false, 'Should fail');
  assert(result.message.includes('required'), 'Should mention required');
});

test('Returns error for missing todos', () => {
  cleanup();
  const result = executeTaskTool({});
  assert(result.success === false, 'Should fail');
});

// ─── Test: Basic creation ───

test('Creates tasks from todos array', () => {
  cleanup();
  const result = executeTaskTool({
    todos: [
      { id: '1', content: 'Task one', status: 'pending', priority: 'high' },
      { id: '2', content: 'Task two', status: 'pending', priority: 'medium' },
    ],
  });
  assert(result.success === true, 'Should succeed');
  assert(result.todos.length === 2, 'Should have 2 todos');
  const list = getTodoList(SESSION);
  assert(list !== null, 'Todo list should exist');
  assert(list.items.length === 2, 'Should have 2 items');
});

// ─── Test: Idempotent replacement ───

test('Calling executeTaskTool replaces entire list', () => {
  cleanup();
  executeTaskTool({
    todos: [
      { id: '1', content: 'Task one', status: 'pending', priority: 'high' },
    ],
  });
  const result = executeTaskTool({
    todos: [
      { id: 'A', content: 'New task A', status: 'pending', priority: 'low' },
      { id: 'B', content: 'New task B', status: 'completed', priority: 'medium' },
    ],
  });
  assert(result.todos.length === 2, 'Should have 2 todos (replaced)');
  const list = getTodoList(SESSION);
  assert(list!.items.length === 2, 'Should have 2 items');
  assert(list!.items[0].content === 'New task A', 'First item should be New task A');
});

// ─── Test: Single in_progress enforcement ───

test('Enforces single in_progress task', () => {
  cleanup();
  const result = executeTaskTool({
    todos: [
      { id: '1', content: 'Task one', status: 'in_progress', priority: 'high' },
      { id: '2', content: 'Task two', status: 'in_progress', priority: 'medium' },
      { id: '3', content: 'Task three', status: 'pending', priority: 'low' },
    ],
  });
  const inProgress = result.todos.filter((t: any) => t.status === 'in_progress');
  assert(inProgress.length === 1, `Expected 1 in_progress, got ${inProgress.length}`);
  assert(inProgress[0].id === '1', 'First in_progress should be kept');
});

// ─── Test: Auto-advance to first pending ───

test('Auto-advances to first pending when no in_progress specified', () => {
  cleanup();
  executeTaskTool({
    todos: [
      { id: '1', content: 'Task one', status: 'completed', priority: 'high' },
      { id: '2', content: 'Task two', status: 'pending', priority: 'medium' },
      { id: '3', content: 'Task three', status: 'pending', priority: 'low' },
    ],
  });
  const active = getActiveTask(SESSION);
  assert(active !== null, 'Should have an active task');
  assert(active.id === '2', `Active should be task 2, got ${active?.id}`);
});

// ─── Test: Status mapping ───

test('Status completed maps to done in todoManager', () => {
  cleanup();
  executeTaskTool({
    todos: [
      { id: '1', content: 'Done task', status: 'completed', priority: 'high' },
    ],
  });
  const list = getTodoList(SESSION);
  assert(list!.items[0].status === 'done', `Expected 'done', got '${list!.items[0].status}'`);
});

// ─── Test: Summary message ───

test('Returns human-readable summary', () => {
  cleanup();
  const result = executeTaskTool({
    todos: [
      { id: '1', content: 'Done task', status: 'completed', priority: 'high' },
      { id: '2', content: 'Active task', status: 'in_progress', priority: 'medium' },
      { id: '3', content: 'Pending task', status: 'pending', priority: 'low' },
    ],
  });
  assert(result.message.includes('3 tasks total'), 'Should mention total');
  assert(result.message.includes('1 completed'), 'Should mention completed');
  assert(result.message.includes('Active task:'), 'Should mention active task');
});

// ─── Test: All complete detection ───

test('Detects all tasks complete', () => {
  cleanup();
  const result = executeTaskTool({
    todos: [
      { id: '1', content: 'Done 1', status: 'completed', priority: 'high' },
      { id: '2', content: 'Done 2', status: 'completed', priority: 'medium' },
    ],
  });
  assert(result.message.includes('All tasks are complete'), 'Should detect all complete');
});

// ─── Test: Progress tracking ───

test('Returns progress object', () => {
  cleanup();
  const result = executeTaskTool({
    todos: [
      { id: '1', content: 'Done', status: 'completed', priority: 'high' },
      { id: '2', content: 'Pending', status: 'pending', priority: 'medium' },
    ],
  });
  assert(result.progress.done === 1, `Expected done=1, got ${result.progress.done}`);
  assert(result.progress.total === 2, `Expected total=2, got ${result.progress.total}`);
});

runTests();
