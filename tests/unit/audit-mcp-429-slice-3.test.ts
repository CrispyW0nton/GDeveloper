/**
 * MCP-429 Slice 3 regression tests — predictive pre-flight + schema-aware truncation
 *
 * Covers:
 *   MCP-429-02  RateLimiter.preFlightCheckPredictive estimates this
 *               request's cost against the sliding window BEFORE sending.
 *               Refuses on projected hard-limit breach; delays on
 *               projected soft-limit breach; falls through to reactive
 *               check when the projection fits.
 *   MCP-429-09  truncateIfNeeded now includes a `toolSchemaTokens`
 *               parameter in its budget calculation. Previously the
 *               budget was just system + messages; ~15k tokens of tool
 *               schemas were invisible to the calculation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { RateLimiter } from '../../src/main/providers/rateLimiter';
import { truncateIfNeeded } from '../../src/main/providers/index';
import { DEFAULT_TOKEN_BUDGET_CONFIG } from '../../src/main/providers/rateLimitConfig';

const agentLoopSrc = readFileSync(resolve(__dirname, '../../src/main/orchestration/agentLoop.ts'), 'utf-8');
const mainSrc = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf-8');
const providersSrc = readFileSync(resolve(__dirname, '../../src/main/providers/index.ts'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════
//  MCP-429-02 — predictive pre-flight
// ═══════════════════════════════════════════════════════════════════
describe('MCP-429 / Slice 3 / MCP-429-02 — predictive pre-flight (functional)', () => {
  let rl: RateLimiter;

  beforeEach(() => {
    // Each test gets a fresh rate limiter on a tight tier-1 config
    // (40k input/min hard, 32k soft) so projections are easy to reason about.
    rl = new RateLimiter({
      ...DEFAULT_TOKEN_BUDGET_CONFIG,
      providerTier: 'tier1',
      softInputTokensPerMinute: 32_000,
      softOutputTokensPerMinute: 6_400,
      softRequestsPerMinute: 40,
    });
  });

  it('no estimate → falls through to the reactive check (ok: true on fresh window)', () => {
    const check = rl.preFlightCheckPredictive();
    expect(check.ok).toBe(true);
    expect(check.delayMs).toBe(0);
  });

  it('small projection on fresh window → ok: true, no delay', () => {
    const check = rl.preFlightCheckPredictive({ inputTokens: 1_000 });
    expect(check.ok).toBe(true);
    expect(check.delayMs).toBe(0);
  });

  it('projection would breach the HARD limit → refuses outright (ok: false, delayMs: 0)', () => {
    // tier1 hard limit is 40k. Record 35k already used + estimate 10k more = 45k.
    rl.recordUsage(35_000, 0);
    const check = rl.preFlightCheckPredictive({ inputTokens: 10_000 });
    expect(check.ok).toBe(false);
    expect(check.delayMs).toBe(0);
    expect(check.reason).toMatch(/exceed your tier's hard input-token limit/i);
    // Must mention the tier and the actionable remediation
    expect(check.reason).toMatch(/tier1/);
    expect(check.reason).toMatch(/disable unused MCP servers|switch to a higher tier|Shorten/i);
  });

  it('projection would breach the SOFT limit but not hard → delays until window clears enough', () => {
    // Soft input = 32k, 90% safety buffer = 28.8k effective.
    // Record 20k used + 10k estimate = 30k projected, > 28.8k soft.
    rl.recordUsage(20_000, 0);
    const check = rl.preFlightCheckPredictive({ inputTokens: 10_000 });
    expect(check.ok).toBe(true);
    expect(check.delayMs).toBeGreaterThan(0);
    expect(check.delayMs).toBeLessThanOrEqual(60_000);
    expect(check.reason).toMatch(/soft cap|aging out|age/i);
  });

  it('delay never exceeds the 60-second window', () => {
    rl.recordUsage(35_000, 0); // push close to soft limit
    const check = rl.preFlightCheckPredictive({ inputTokens: 1_000 });
    // Either refuses or delays, but never returns a delay > 60s
    expect(check.delayMs).toBeLessThanOrEqual(60_000);
  });

  it('projection passes → falls through to reactive check and returns its result', () => {
    rl.recordUsage(5_000, 0);
    const check = rl.preFlightCheckPredictive({ inputTokens: 1_000 });
    expect(check.ok).toBe(true);
    expect(check.delayMs).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MCP-429-02 — wiring (source-scan)
// ═══════════════════════════════════════════════════════════════════
describe('MCP-429 / Slice 3 / MCP-429-02 — wiring', () => {
  it('agentLoop passes { inputTokens } estimate to rateLimitCheck', () => {
    expect(agentLoopSrc).toMatch(/rateLimitCheck\(\s*\{\s*inputTokens:\s*estimateTurnInputTokens\(\)\s*\}\s*\)/);
  });

  it('agentLoop computes the estimate from system + tools + history', () => {
    const fnIdx = agentLoopSrc.indexOf('estimateTurnInputTokens');
    expect(fnIdx).toBeGreaterThan(0);
    const fnBlock = agentLoopSrc.substring(fnIdx, fnIdx + 1500);
    expect(fnBlock).toContain('options.systemPrompt?.length');
    expect(fnBlock).toMatch(/currentMessages\.reduce/);
    expect(fnBlock).toMatch(/JSON\.stringify\(options\.tools/);
  });

  it('CHAT_SEND rateLimitCheck wires to preFlightCheckPredictive', () => {
    expect(mainSrc).toMatch(/rateLimitCheck:\s*\(\s*estimate\s*\)\s*=>\s*getRateLimiter\(\)\.preFlightCheckPredictive\(\s*estimate\s*\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MCP-429-09 — schema-aware truncation
// ═══════════════════════════════════════════════════════════════════
describe('MCP-429 / Slice 3 / MCP-429-09 — truncateIfNeeded accounts for tool schema cost', () => {
  it('without toolSchemaTokens arg → unchanged behaviour (back-compat)', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(100),
    }));
    const result = truncateIfNeeded(messages, 'sys', 'claude-3-5-sonnet-20241022');
    expect(result.wasTruncated).toBe(false);
    expect(result.toolSchemaTokens).toBe(0);
  });

  it('returns toolSchemaTokens in its result', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    const result = truncateIfNeeded(messages, 'sys', 'claude-3-5-sonnet-20241022', 5_000);
    expect(result.toolSchemaTokens).toBe(5_000);
  });

  it('tool-schema tokens contribute to originalTokens', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    const result = truncateIfNeeded(messages, '', 'claude-3-5-sonnet-20241022', 10_000);
    // hi = ~1 token, empty system = 0 tokens, + 10k tool schema = ~10k
    expect(result.originalTokens).toBeGreaterThanOrEqual(10_000);
    expect(result.originalTokens).toBeLessThan(10_100);
  });

  it('truncation triggers earlier when tool schemas consume part of the budget', () => {
    // Build messages close to the 160k Claude budget.
    // Each message is 40_000 chars = 10_000 tokens. 16 messages = 160_000 tokens.
    const messages = Array.from({ length: 16 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(40_000),
    }));

    // Without tool schema cost: 160k total tokens, right at the edge
    const noTools = truncateIfNeeded(messages, '', 'claude-3-5-sonnet-20241022');

    // With 20k of tool schemas: total 180k → must trigger truncation
    const withTools = truncateIfNeeded(messages, '', 'claude-3-5-sonnet-20241022', 20_000);

    expect(withTools.wasTruncated).toBe(true);
    // The with-tools truncation is stricter (smaller budget after tool
    // tokens reserved), so the result is no larger than the no-tools
    // case — which itself may or may not have truncated, doesn't matter
    // to the invariant we're asserting.
    expect(withTools.messages.length).toBeLessThanOrEqual(noTools.messages.length);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MCP-429-09 — wiring (source-scan)
// ═══════════════════════════════════════════════════════════════════
describe('MCP-429 / Slice 3 / MCP-429-09 — wiring', () => {
  it('streamChatToRenderer computes toolSchemaTokens and passes to truncateIfNeeded', () => {
    // Scan within streamChatToRenderer
    const startIdx = providersSrc.indexOf('export async function streamChatToRenderer');
    expect(startIdx).toBeGreaterThan(0);
    const end = providersSrc.indexOf('\n}', startIdx);
    const fn = providersSrc.substring(startIdx, end > 0 ? end : startIdx + 5000);

    expect(fn).toMatch(/toolSchemaTokens\s*=\s*estimateTokens\(JSON\.stringify\(tools\)\)/);
    expect(fn).toMatch(/truncateIfNeeded\([^)]*toolSchemaTokens[^)]*\)/);
  });

  it('truncateIfNeeded signature includes toolSchemaTokens optional arg', () => {
    const fnIdx = providersSrc.indexOf('export function truncateIfNeeded');
    expect(fnIdx).toBeGreaterThan(0);
    // Grab a generous window — the signature spans multiple lines and
    // includes `Array<{…}>` type annotations whose braces would fool a
    // naive indexOf('{') scan.
    const sig = providersSrc.substring(fnIdx, fnIdx + 2000);
    expect(sig).toMatch(/toolSchemaTokens\??:\s*number/);
  });

  it('truncation log message includes the tool-schema token count', () => {
    // The updated log line mentions `tools=${toolTokens}` so the
    // DevConsole/terminal output makes tool-schema overhead visible.
    expect(providersSrc).toMatch(/tools=\$\{toolTokens\}/);
  });
});
