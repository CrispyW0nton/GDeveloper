/**
 * no-auto-continue.test.ts — Sprint 27.3
 * Integration test confirming the agent loop exits on end_turn
 * without any timer messages, nudge strings, or auto-continue logic.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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
  console.log(`\nno-auto-continue tests: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failed > 0) process.exit(1);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ROOT = join(__dirname, '..', '..');

function readSource(relPath: string): string {
  const fullPath = join(ROOT, relPath);
  assert(existsSync(fullPath), `File not found: ${relPath}`);
  return readFileSync(fullPath, 'utf-8');
}

// ─── Test: autoContinue.ts is no longer imported in main/index.ts ───

test('main/index.ts does not import from autoContinue.ts', () => {
  const source = readSource('src/main/index.ts');
  // Should have removal comment
  assert(source.includes('autoContinue REMOVED'), 'Should have removal comment');
  // Should not have active import
  assert(!source.includes("from './orchestration/autoContinue'"), 'Should not import autoContinue');
});

// ─── Test: autoContinueState.ts is no longer imported in main/index.ts ───

test('main/index.ts does not import from autoContinueState.ts', () => {
  const source = readSource('src/main/index.ts');
  assert(!source.includes("from './orchestration/autoContinueState'"), 'Should not import autoContinueState');
});

// ─── Test: No scheduleAutoContinue in renderer ───

test('ChatWorkspace does not define scheduleAutoContinue callback', () => {
  const source = readSource('src/renderer/components/chat/ChatWorkspace.tsx');
  // Should have removal comment, not the function
  assert(!source.includes('const scheduleAutoContinue = useCallback'), 'Should not have scheduleAutoContinue callback');
  assert(source.includes('scheduleAutoContinue REMOVED'), 'Should have removal comment');
});

// ─── Test: No nudge messages in renderer ───

test('ChatWorkspace does not build nudge messages', () => {
  const source = readSource('src/renderer/components/chat/ChatWorkspace.tsx');
  assert(!source.includes('Auto-Continue: step'), 'Should not have nudge message format');
  assert(!source.includes('msg-nudge-'), 'Should not have nudge message ID');
});

// ─── Test: No debounce timer for auto-continue ───

test('ChatWorkspace does not use autoContinueDebounceRef with setTimeout', () => {
  const source = readSource('src/renderer/components/chat/ChatWorkspace.tsx');
  // The ref declaration should be commented out
  assert(!source.includes('useRef<ReturnType<typeof setTimeout> | null>(null)'), 'Should not have debounce ref');
});

// ─── Test: agentLoop.ts uses stop_reason exclusively ───

test('agentLoop.ts uses stop_reason as sole termination signal (code-only check)', () => {
  const source = readSource('src/main/orchestration/agentLoop.ts');
  assert(source.includes("lastStopReason !== 'tool_use'"), 'Should check stop_reason');
  // Check code only (exclude comments)
  const codeOnly = source.split('\n').filter((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
  assert(!codeOnly.includes('nudge'), 'Code should not mention nudge');
  assert(!codeOnly.includes('AutoContinue'), 'Code should not mention AutoContinue');
  assert(!codeOnly.includes('scheduleNextTurn'), 'Code should not mention scheduleNextTurn');
  assert(!codeOnly.includes('setInterval'), 'Code should not use setInterval');
});

// ─── Test: Auto-continue IPC handlers are no-op stubs ───

test('main/index.ts has no-op auto-continue IPC handlers', () => {
  const source = readSource('src/main/index.ts');
  assert(source.includes('noOpState'), 'Should have noOpState');
  assert(source.includes("active: false"), 'noOpState should be inactive');
  assert(source.includes("'Removed in Sprint 27.3'"), 'noOpState should mention removal');
});

// ─── Test: No "text-only turn" logic ───

test('No text-only turn detection in main codebase', () => {
  const indexSource = readSource('src/main/index.ts');
  assert(!indexSource.includes('text-only turn'), 'main/index.ts should not have text-only turn');
  assert(!indexSource.includes('consecutiveTextOnlyTurns'), 'main/index.ts should not track text-only turns');
});

// ─── Test: No consecutive text-only counter in agent loop ───

test('agentLoop.ts does not track consecutive text-only turns', () => {
  const source = readSource('src/main/orchestration/agentLoop.ts');
  assert(!source.includes('consecutiveTextOnly'), 'Should not track text-only turns');
});

// ─── Test: Provider streams stop_reason ───

test('providers/index.ts captures stop_reason from message_delta', () => {
  const source = readSource('src/main/providers/index.ts');
  assert(source.includes("event.delta?.stop_reason"), 'Should capture stop_reason from delta');
  assert(source.includes("streamStopReason"), 'Should store stop_reason');
});

// ─── Test: streamChatToRenderer returns stop_reason ───

test('streamChatToRenderer returns stopReason in result', () => {
  const source = readSource('src/main/providers/index.ts');
  assert(source.includes('stopReason: string'), 'Return type should include stopReason');
  assert(source.includes('chunk.stopReason'), 'Should capture stop_reason from done chunk');
  assert(source.includes('stopReason }'), 'Should return stopReason in result object');
});

// ─── Test: LLMStreamChunk type includes stop_reason ───

test('LLMStreamChunk interface has optional stopReason', () => {
  const source = readSource('src/main/domain/interfaces/index.ts');
  assert(source.includes('stopReason?: string'), 'Should have optional stopReason');
});

// ─── Test: No auto-continue call in handleSend ───

test('handleSend does not trigger auto-continue', () => {
  const source = readSource('src/renderer/components/chat/ChatWorkspace.tsx');
  // Should have removal comment instead of auto-continue trigger
  assert(source.includes('Auto-continue nudge REMOVED'), 'Should have removal comment after handleSend');
});

runTests();
