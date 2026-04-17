/**
 * Unit tests — Rate Limit Lite (Sprint 27.1)
 */

import {
  parseAnthropicHeaders, shouldThrottle, record429,
  getLastHeaders, getConsecutiveThrottles, resetRateLimitLiteState,
  formatRateLimitLiteSnapshot,
} from '../../src/main/providers/rateLimitLite';

function testParseHeaders() {
  const results: string[] = [];

  resetRateLimitLiteState();

  // Normal headers
  const headers: Record<string, string> = {
    'anthropic-ratelimit-requests-limit': '1000',
    'anthropic-ratelimit-requests-remaining': '950',
    'anthropic-ratelimit-requests-reset': '2025-04-17T12:00:00Z',
    'anthropic-ratelimit-tokens-limit': '80000',
    'anthropic-ratelimit-tokens-remaining': '75000',
    'anthropic-ratelimit-tokens-reset': '2025-04-17T12:00:00Z',
  };

  const parsed = parseAnthropicHeaders(headers);
  console.assert(parsed.requestLimit === 1000, `Expected 1000, got ${parsed.requestLimit}`);
  console.assert(parsed.requestsRemaining === 950, `Expected 950, got ${parsed.requestsRemaining}`);
  console.assert(parsed.tokensLimit === 80000, `Expected 80000, got ${parsed.tokensLimit}`);
  console.assert(parsed.tokensRemaining === 75000, `Expected 75000, got ${parsed.tokensRemaining}`);
  results.push(parsed.requestLimit === 1000 && parsed.tokensLimit === 80000 ? 'PASS' : 'FAIL');

  // Check getLastHeaders
  const last = getLastHeaders();
  console.assert(last !== null, 'Last headers should not be null');
  console.assert(last!.requestLimit === 1000, 'Last headers should match');
  results.push(last !== null && last.requestLimit === 1000 ? 'PASS' : 'FAIL');

  return results;
}

function testShouldThrottleNormal() {
  const results: string[] = [];

  resetRateLimitLiteState();

  // No headers yet — should not throttle
  const r1 = shouldThrottle();
  console.assert(!r1.shouldWait, 'Should not throttle with no headers');
  results.push(!r1.shouldWait ? 'PASS' : 'FAIL');

  // Normal usage (plenty of budget)
  parseAnthropicHeaders({
    'anthropic-ratelimit-requests-limit': '1000',
    'anthropic-ratelimit-requests-remaining': '900',
    'anthropic-ratelimit-tokens-limit': '80000',
    'anthropic-ratelimit-tokens-remaining': '70000',
    'anthropic-ratelimit-tokens-reset': new Date(Date.now() + 60000).toISOString(),
  });
  const r2 = shouldThrottle();
  console.assert(!r2.shouldWait, 'Should not throttle with plenty of budget');
  results.push(!r2.shouldWait ? 'PASS' : 'FAIL');

  return results;
}

function testShouldThrottleLowTokens() {
  const results: string[] = [];

  resetRateLimitLiteState();

  // Low tokens (5% remaining)
  parseAnthropicHeaders({
    'anthropic-ratelimit-requests-limit': '1000',
    'anthropic-ratelimit-requests-remaining': '900',
    'anthropic-ratelimit-tokens-limit': '80000',
    'anthropic-ratelimit-tokens-remaining': '4000',  // 5% remaining
    'anthropic-ratelimit-tokens-reset': new Date(Date.now() + 30000).toISOString(),
  });

  const r1 = shouldThrottle();
  console.assert(r1.shouldWait, 'Should throttle when tokens are low');
  console.assert(r1.waitMs > 0, 'Wait time should be > 0');
  results.push(r1.shouldWait ? 'PASS' : 'FAIL');

  return results;
}

function testRecord429() {
  const results: string[] = [];

  resetRateLimitLiteState();

  // Record a 429
  record429(10);
  const r1 = shouldThrottle();
  console.assert(r1.shouldWait, 'Should throttle after 429');
  console.assert(r1.waitMs > 0, 'Wait time should be > 0');
  results.push(r1.shouldWait ? 'PASS' : 'FAIL');

  // Consecutive throttle count
  console.assert(getConsecutiveThrottles() === 1, `Expected 1, got ${getConsecutiveThrottles()}`);
  results.push(getConsecutiveThrottles() === 1 ? 'PASS' : 'FAIL');

  return results;
}

function testFormatSnapshot() {
  const results: string[] = [];

  resetRateLimitLiteState();

  // No headers
  const s1 = formatRateLimitLiteSnapshot();
  console.assert(s1.includes('No Anthropic'), 'Should indicate no headers');
  results.push(s1.includes('No Anthropic') ? 'PASS' : 'FAIL');

  // With headers
  parseAnthropicHeaders({
    'anthropic-ratelimit-requests-limit': '1000',
    'anthropic-ratelimit-requests-remaining': '900',
    'anthropic-ratelimit-tokens-limit': '80000',
    'anthropic-ratelimit-tokens-remaining': '70000',
    'anthropic-ratelimit-tokens-reset': new Date(Date.now() + 60000).toISOString(),
  });
  const s2 = formatRateLimitLiteSnapshot();
  console.assert(s2.includes('Anthropic Rate Limits'), 'Should include rate limit table');
  console.assert(s2.includes('1000'), 'Should include request limit');
  results.push(s2.includes('1000') ? 'PASS' : 'FAIL');

  resetRateLimitLiteState();

  return results;
}

// ─── Run ───

const allResults = [
  ...testParseHeaders(),
  ...testShouldThrottleNormal(),
  ...testShouldThrottleLowTokens(),
  ...testRecord429(),
  ...testFormatSnapshot(),
];

const passed = allResults.filter(r => r === 'PASS').length;
const failed = allResults.filter(r => r === 'FAIL').length;

console.log(`\nrateLimitLite tests: ${passed} passed, ${failed} failed (${allResults.length} total)`);
if (failed > 0) {
  process.exit(1);
}
