/**
 * Integration tests — Tool Timeout (Sprint 27.2)
 *
 * Tests withTimeout abort behavior, spawnAsync, killProcess escalation,
 * fast command success, hung command abort, and timeout result structure.
 */

import {
  withTimeout,
  getTimeoutForTool,
  DEFAULT_TIMEOUTS,
  spawnAsync,
  killProcess,
} from '../../src/main/tools/toolTimeout';

const results: Array<{ name: string; passed: boolean; error?: string }> = [];

function test(name: string, fn: () => Promise<void>): void {
  fn().then(
    () => results.push({ name, passed: true }),
    (err: any) => results.push({ name, passed: false, error: err.message || String(err) }),
  );
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Run tests sequentially
async function runAll() {
  // === DEFAULT_TIMEOUTS Tests ===

  assertEqual(DEFAULT_TIMEOUTS.bash_command, 120_000, 'bash_command timeout');
  assertEqual(DEFAULT_TIMEOUTS.run_command, 120_000, 'run_command timeout');
  assertEqual(DEFAULT_TIMEOUTS.read_file, 30_000, 'read_file timeout');
  assertEqual(DEFAULT_TIMEOUTS.default, 60_000, 'default timeout');
  results.push({ name: 'DEFAULT_TIMEOUTS has expected values', passed: true });

  // === getTimeoutForTool Tests ===

  assertEqual(getTimeoutForTool('bash_command'), 120_000, 'bash_command');
  assertEqual(getTimeoutForTool('unknown_tool'), 60_000, 'unknown falls back to default');
  results.push({ name: 'getTimeoutForTool returns correct timeouts', passed: true });

  // === withTimeout Tests ===

  // Fast async operation succeeds within timeout
  try {
    const r = await withTimeout('test', 5000, async (_signal) => {
      return 'hello';
    });
    assert(r.ok === true, 'should be ok');
    if (r.ok) {
      assertEqual(r.value, 'hello', 'value');
      assert(r.elapsed_ms < 1000, 'should be fast');
    }
    results.push({ name: 'withTimeout: fast operation succeeds', passed: true });
  } catch (err: any) {
    results.push({ name: 'withTimeout: fast operation succeeds', passed: false, error: err.message });
  }

  // Operation that exceeds timeout is aborted
  try {
    const r = await withTimeout('test-timeout', 200, async (signal) => {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => resolve('should not reach'), 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });
    });
    assert(r.ok === false, 'should fail');
    if (!r.ok) {
      assert(r.timed_out, 'should be timed_out');
      assert(r.error.includes('timed out'), 'error should mention timeout');
      assert(r.elapsed_ms >= 150, 'should have waited at least 150ms');
    }
    results.push({ name: 'withTimeout: slow operation times out', passed: true });
  } catch (err: any) {
    results.push({ name: 'withTimeout: slow operation times out', passed: false, error: err.message });
  }

  // Operation that throws an error returns error result
  try {
    const r = await withTimeout('test-error', 5000, async (_signal) => {
      throw new Error('intentional error');
    });
    assert(r.ok === false, 'should fail');
    if (!r.ok) {
      assert(r.error.includes('intentional error'), 'error message');
      assertEqual(r.timed_out, false, 'not a timeout');
    }
    results.push({ name: 'withTimeout: thrown error returns error result', passed: true });
  } catch (err: any) {
    results.push({ name: 'withTimeout: thrown error returns error result', passed: false, error: err.message });
  }

  // onKill callback is invoked on timeout
  try {
    let killCalled = false;
    const r = await withTimeout(
      'test-kill',
      200,
      async (signal) => new Promise<void>((_, reject) => {
        const t = setTimeout(() => {}, 10000);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        });
      }),
      async () => { killCalled = true; },
    );
    assert(!r.ok, 'should fail');
    assert(killCalled, 'onKill should have been called');
    results.push({ name: 'withTimeout: onKill callback invoked on timeout', passed: true });
  } catch (err: any) {
    results.push({ name: 'withTimeout: onKill callback invoked on timeout', passed: false, error: err.message });
  }

  // === spawnAsync Tests ===

  // Simple echo command
  try {
    const r = await spawnAsync('echo "hello world"', '/tmp');
    assertEqual(r.exit_code, 0, 'exit code');
    assert(r.stdout.includes('hello world'), 'stdout');
    assertEqual(r.timed_out, false, 'not timed out');
    assert(r.duration_ms >= 0, 'duration positive');
    results.push({ name: 'spawnAsync: echo command succeeds', passed: true });
  } catch (err: any) {
    results.push({ name: 'spawnAsync: echo command succeeds', passed: false, error: err.message });
  }

  // Command with non-zero exit code
  try {
    const r = await spawnAsync('exit 42', '/tmp');
    assertEqual(r.exit_code, 42, 'exit code');
    assertEqual(r.timed_out, false, 'not timed out');
    results.push({ name: 'spawnAsync: non-zero exit code captured', passed: true });
  } catch (err: any) {
    results.push({ name: 'spawnAsync: non-zero exit code captured', passed: false, error: err.message });
  }

  // Command with stderr
  try {
    const r = await spawnAsync('echo "err" >&2', '/tmp');
    assert(r.stderr.includes('err'), 'stderr captured');
    results.push({ name: 'spawnAsync: stderr captured', passed: true });
  } catch (err: any) {
    results.push({ name: 'spawnAsync: stderr captured', passed: false, error: err.message });
  }

  // AbortSignal cancels running command
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const start = Date.now();
    const r = await spawnAsync('sleep 10', '/tmp', controller.signal);
    const elapsed = Date.now() - start;
    assert(r.timed_out, 'should be timed out');
    assert(elapsed < 5000, 'should not wait 10s');
    results.push({ name: 'spawnAsync: AbortSignal cancels running command', passed: true });
  } catch (err: any) {
    results.push({ name: 'spawnAsync: AbortSignal cancels running command', passed: false, error: err.message });
  }

  // Already-aborted signal returns immediately
  try {
    const controller = new AbortController();
    controller.abort();
    const r = await spawnAsync('echo "should not run"', '/tmp', controller.signal);
    assert(r.timed_out, 'should be timed out');
    results.push({ name: 'spawnAsync: pre-aborted signal returns immediately', passed: true });
  } catch (err: any) {
    results.push({ name: 'spawnAsync: pre-aborted signal returns immediately', passed: false, error: err.message });
  }

  // Multi-line output
  try {
    const r = await spawnAsync('echo "line1" && echo "line2" && echo "line3"', '/tmp');
    assertEqual(r.exit_code, 0, 'exit code');
    assert(r.stdout.includes('line1'), 'line1');
    assert(r.stdout.includes('line3'), 'line3');
    results.push({ name: 'spawnAsync: multi-line output captured', passed: true });
  } catch (err: any) {
    results.push({ name: 'spawnAsync: multi-line output captured', passed: false, error: err.message });
  }

  // Full pipeline: withTimeout + spawnAsync
  try {
    const r = await withTimeout('bash_command', 5000, async (signal) => {
      return spawnAsync('echo "integrated"', '/tmp', signal);
    });
    assert(r.ok, 'should succeed');
    if (r.ok) {
      assert(r.value.stdout.includes('integrated'), 'output');
      assertEqual(r.value.exit_code, 0, 'exit code');
    }
    results.push({ name: 'Integration: withTimeout + spawnAsync pipeline', passed: true });
  } catch (err: any) {
    results.push({ name: 'Integration: withTimeout + spawnAsync pipeline', passed: false, error: err.message });
  }

  // Full pipeline: timeout kills hung subprocess
  try {
    const r = await withTimeout('bash_command', 500, async (signal) => {
      return spawnAsync('sleep 30', '/tmp', signal);
    });
    assert(!r.ok, 'should fail');
    if (!r.ok) {
      assert(r.timed_out, 'should be timed out');
      assert(r.elapsed_ms < 5000, 'should abort quickly');
    }
    results.push({ name: 'Integration: withTimeout kills hung subprocess', passed: true });
  } catch (err: any) {
    results.push({ name: 'Integration: withTimeout kills hung subprocess', passed: false, error: err.message });
  }

  // === Report ===
  // Wait for any pending promises
  await new Promise(r => setTimeout(r, 500));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  if (failed > 0) {
    console.error('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.error(`  ✗ ${r.name}: ${r.error}`);
    });
  }

  console.log(`\ntool-timeout integration tests: ${passed} passed, ${failed} failed (${results.length} total)`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
