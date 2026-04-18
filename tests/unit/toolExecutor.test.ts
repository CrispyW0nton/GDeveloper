/**
 * toolExecutor.test.ts — Sprint 27.3
 * Unit tests for the tool executor with per-tool timeouts.
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
  console.log(`\ntoolExecutor tests: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failed > 0) process.exit(1);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ─── Test: DEFAULT_TIMEOUTS has correct values ───

test('DEFAULT_TIMEOUTS has bash_command at 120000ms', () => {
  const { DEFAULT_TIMEOUTS } = require('../../src/main/tools/toolExecutor');
  assert(DEFAULT_TIMEOUTS.bash_command === 120_000, `Expected 120000, got ${DEFAULT_TIMEOUTS.bash_command}`);
});

test('DEFAULT_TIMEOUTS has run_command at 120000ms', () => {
  const { DEFAULT_TIMEOUTS } = require('../../src/main/tools/toolExecutor');
  assert(DEFAULT_TIMEOUTS.run_command === 120_000, `Expected 120000, got ${DEFAULT_TIMEOUTS.run_command}`);
});

test('DEFAULT_TIMEOUTS has read_file at 30000ms', () => {
  const { DEFAULT_TIMEOUTS } = require('../../src/main/tools/toolExecutor');
  assert(DEFAULT_TIMEOUTS.read_file === 30_000, `Expected 30000, got ${DEFAULT_TIMEOUTS.read_file}`);
});

test('DEFAULT_TIMEOUTS has write_file at 30000ms', () => {
  const { DEFAULT_TIMEOUTS } = require('../../src/main/tools/toolExecutor');
  assert(DEFAULT_TIMEOUTS.write_file === 30_000, `Expected 30000, got ${DEFAULT_TIMEOUTS.write_file}`);
});

test('DEFAULT_TIMEOUTS has grep_search at 60000ms', () => {
  const { DEFAULT_TIMEOUTS } = require('../../src/main/tools/toolExecutor');
  assert(DEFAULT_TIMEOUTS.grep_search === 60_000, `Expected 60000, got ${DEFAULT_TIMEOUTS.grep_search}`);
});

test('DEFAULT_TIMEOUTS has glob_search at 60000ms', () => {
  const { DEFAULT_TIMEOUTS } = require('../../src/main/tools/toolExecutor');
  assert(DEFAULT_TIMEOUTS.glob_search === 60_000, `Expected 60000, got ${DEFAULT_TIMEOUTS.glob_search}`);
});

test('DEFAULT_TIMEOUTS has task_plan at 5000ms', () => {
  const { DEFAULT_TIMEOUTS } = require('../../src/main/tools/toolExecutor');
  assert(DEFAULT_TIMEOUTS.task_plan === 5_000, `Expected 5000, got ${DEFAULT_TIMEOUTS.task_plan}`);
});

test('DEFAULT_TIMEOUTS has todo_write at 5000ms', () => {
  const { DEFAULT_TIMEOUTS } = require('../../src/main/tools/toolExecutor');
  assert(DEFAULT_TIMEOUTS.todo_write === 5_000, `Expected 5000, got ${DEFAULT_TIMEOUTS.todo_write}`);
});

test('DEFAULT_TIMEOUTS has default at 60000ms', () => {
  const { DEFAULT_TIMEOUTS } = require('../../src/main/tools/toolExecutor');
  assert(DEFAULT_TIMEOUTS.default === 60_000, `Expected 60000, got ${DEFAULT_TIMEOUTS.default}`);
});

// ─── Test: ToolExecResult interface ───

test('executeToolWithTimeout is exported', () => {
  const mod = require('../../src/main/tools/toolExecutor');
  assert(typeof mod.executeToolWithTimeout === 'function', 'Should export executeToolWithTimeout');
});

test('executeMcpToolWithTimeout is exported', () => {
  const mod = require('../../src/main/tools/toolExecutor');
  assert(typeof mod.executeMcpToolWithTimeout === 'function', 'Should export executeMcpToolWithTimeout');
});

// ─── Test: Unknown tool returns error ───

test('executeToolWithTimeout returns error for unknown tool', async () => {
  const { executeToolWithTimeout } = require('../../src/main/tools/toolExecutor');
  const result = await executeToolWithTimeout('nonexistent_tool', 'test-id', {});
  assert(result.isError === true, 'Should be error');
  assert(result.content.includes('Unknown tool'), 'Should mention unknown tool');
  assert(result.toolName === 'nonexistent_tool', 'Should have correct tool name');
  assert(result.toolCallId === 'test-id', 'Should have correct call id');
});

// ─── Test: Source code checks ───

test('toolExecutor uses withTimeout from toolTimeout', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/tools/toolExecutor.ts', 'utf-8');
  assert(source.includes("import { withTimeout, getTimeoutForTool } from './toolTimeout'"), 'Should import from toolTimeout');
});

test('toolExecutor uses AbortController via withTimeout', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/tools/toolExecutor.ts', 'utf-8');
  assert(source.includes('_signal'), 'Should pass signal to tool execution');
});

test('toolExecutor returns structured ToolExecResult', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/tools/toolExecutor.ts', 'utf-8');
  assert(source.includes('toolCallId'), 'Result should have toolCallId');
  assert(source.includes('toolName'), 'Result should have toolName');
  assert(source.includes('isError'), 'Result should have isError');
  assert(source.includes('timedOut'), 'Result should have timedOut');
  assert(source.includes('elapsedMs'), 'Result should have elapsedMs');
});

runTests();
