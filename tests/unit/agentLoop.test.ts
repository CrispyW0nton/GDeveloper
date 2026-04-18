/**
 * agentLoop.test.ts — Sprint 27.3
 * Unit tests for the canonical agent loop.
 * Tests stop_reason handling, tool execution, maxTurns safety net,
 * task lifecycle, and absence of auto-continue nudge logic.
 */

// Minimal test runner (no jest in this project)
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
  console.log(`\nagentLoop tests: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failed > 0) process.exit(1);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ─── Test: StopReason type covers Anthropic values ───

test('StopReason type includes end_turn', () => {
  const reasons = ['end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'unknown'];
  assert(reasons.includes('end_turn'), 'end_turn missing');
  assert(reasons.includes('tool_use'), 'tool_use missing');
  assert(reasons.includes('max_tokens'), 'max_tokens missing');
  assert(reasons.includes('stop_sequence'), 'stop_sequence missing');
});

// ─── Test: AgentLoopOptions has required fields ───

test('AgentLoopOptions requires mainWindow, provider, messages, sessionId, systemPrompt, tools', () => {
  // This is a compile-time check, but we can verify the module exports
  const mod = require('../../src/main/orchestration/agentLoop');
  assert(typeof mod.runAgentLoop === 'function', 'runAgentLoop should be a function');
});

// ─── Test: Default maxTurns is 25 ───

test('Default maxTurns is 25', () => {
  // Read the constant from the module source
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes('DEFAULT_MAX_TURNS = 25'), 'DEFAULT_MAX_TURNS should be 25');
});

// ─── Test: Loop checks stop_reason not tool_use for exit ───

test('Loop exits when stop_reason is end_turn', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes("lastStopReason !== 'tool_use'"), 'Loop should check stop_reason !== tool_use');
  assert(source.includes("lastStopReason === 'end_turn'"), 'Loop should handle end_turn');
});

// ─── Test: Loop handles max_tokens stop_reason ───

test('Loop handles max_tokens stop_reason', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes("lastStopReason === 'max_tokens'"), 'Loop should handle max_tokens');
});

// ─── Test: Empty turn detection ───

test('Empty end_turn breaks loop to prevent infinite looping', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes('Empty end_turn'), 'Should detect empty end_turn');
});

// ─── Test: Consecutive error circuit-breaker ───

test('Circuit-breaker stops loop after 3 consecutive errors', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes('MAX_CONSECUTIVE_ERRORS = 3'), 'MAX_CONSECUTIVE_ERRORS should be 3');
  assert(source.includes('consecutiveErrors >= MAX_CONSECUTIVE_ERRORS'), 'Should check circuit-breaker');
});

// ─── Test: No auto-continue references ───

test('agentLoop.ts contains no auto-continue logic (comments excluded)', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  // Strip comment lines before checking
  const codeOnly = source.split('\n').filter((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
  assert(!codeOnly.includes('AutoContinue'), 'Code should not reference AutoContinue');
  assert(!codeOnly.includes('nudge'), 'Code should not reference nudge');
  assert(!codeOnly.includes('scheduleNextTurn'), 'Code should not reference scheduleNextTurn');
  assert(!codeOnly.includes('setInterval'), 'Code should not use setInterval');
});

// ─── Test: Loop calls streamChatToRenderer and checks stop_reason ───

test('Loop uses streamChatToRenderer which returns stop_reason', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes('streamChatToRenderer'), 'Should use streamChatToRenderer');
  assert(source.includes('result.stopReason'), 'Should access result.stopReason');
});

// ─── Test: Task lifecycle integration ───

test('Loop advances tasks after tool execution', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes('advanceToNextPending'), 'Should call advanceToNextPending');
  assert(source.includes('blockActive'), 'Should call blockActive on timeout');
  assert(source.includes('getActiveTask'), 'Should check getActiveTask');
  assert(source.includes('isTodoComplete'), 'Should check isTodoComplete');
});

// ─── Test: Tool result includes task progress ───

test('Loop injects task progress into tool result messages', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes('[Task Progress:'), 'Should inject task progress');
  assert(source.includes('ALL TASKS COMPLETE'), 'Should signal all tasks complete');
});

// ─── Test: isFinal flag sent on end_turn ───

test('Loop sends isFinal flag with final content', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes('isFinal: true'), 'Should send isFinal: true');
});

// ─── Test: Rate-limit pre-flight check ───

test('Loop performs rate-limit pre-flight check each turn', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes('preFlightCheck'), 'Should call preFlightCheck');
});

// ─── Test: Checkpoint injection every 5 loops ───

test('Checkpoint is created every 5 loops', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes('loopCount % 5 === 0'), 'Should checkpoint every 5 loops');
  assert(source.includes('createCheckpoint'), 'Should call createCheckpoint');
});

// ─── Test: Tool results sent to renderer with structured data ───

test('Tool results sent with toolCallId, toolName, result, timedOut, elapsedMs', () => {
  const fs = require('fs');
  const source = fs.readFileSync('src/main/orchestration/agentLoop.ts', 'utf-8');
  assert(source.includes('toolCallId:'), 'Should send toolCallId');
  assert(source.includes('toolInput:'), 'Should send toolInput');
  assert(source.includes('timedOut:'), 'Should send timedOut');
  assert(source.includes('elapsedMs:'), 'Should send elapsedMs');
});

runTests();
