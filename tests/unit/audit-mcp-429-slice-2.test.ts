/**
 * MCP-429 Slice 2 regression tests — tier detection + MCP result budgeting
 *
 * Covers:
 *   MCP-429-04  Auto-detect tier from x-ratelimit-limit-input-tokens
 *               response header; remove tier4 default in
 *               DEFAULT_TOKEN_BUDGET_CONFIG; emit
 *               rate-limit:tier-detected on mismatch.
 *   MCP-429-05  MCP tool results routed through
 *               ToolResultBudget.processToolResult instead of inline
 *               substring truncation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  detectTierFromHeaders,
  DEFAULT_TOKEN_BUDGET_CONFIG,
  ANTHROPIC_TIER_LIMITS,
  validateSoftLimits,
  type AnthropicTier,
} from '../../src/main/providers/rateLimitConfig';

const mainSrc = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf-8');
const providersSrc = readFileSync(resolve(__dirname, '../../src/main/providers/index.ts'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════
//  MCP-429-04 — Tier auto-detection
// ═══════════════════════════════════════════════════════════════════
describe('MCP-429 / Slice 2 / MCP-429-04 — tier auto-detection', () => {
  it('detectTierFromHeaders returns null for missing / invalid input', () => {
    expect(detectTierFromHeaders(undefined)).toBeNull();
    expect(detectTierFromHeaders(null)).toBeNull();
    expect(detectTierFromHeaders(0)).toBeNull();
    expect(detectTierFromHeaders(-1)).toBeNull();
  });

  it('detects exact tier ceilings', () => {
    expect(detectTierFromHeaders(ANTHROPIC_TIER_LIMITS.tier1.inputTokensPerMinute)).toBe('tier1');
    expect(detectTierFromHeaders(ANTHROPIC_TIER_LIMITS.tier2.inputTokensPerMinute)).toBe('tier2');
    expect(detectTierFromHeaders(ANTHROPIC_TIER_LIMITS.tier3.inputTokensPerMinute)).toBe('tier3');
    expect(detectTierFromHeaders(ANTHROPIC_TIER_LIMITS.tier4.inputTokensPerMinute)).toBe('tier4');
  });

  it('matches within ±20% band for non-round account-specific limits', () => {
    // 45k → close to tier1 (40k), within 20%
    expect(detectTierFromHeaders(45_000)).toBe('tier1');
    // 90k → close to tier2 (80k), within 20%
    expect(detectTierFromHeaders(90_000)).toBe('tier2');
    // 140k → tier3 (160k) is closer than tier2 (80k) by ratio; ±20% of 160k is 32k so 140k is within band
    expect(detectTierFromHeaders(140_000)).toBe('tier3');
  });

  it('falls back to the largest tier whose ceiling does not exceed the observed limit', () => {
    // 1,000,000 tokens/min → way over tier4 ceiling; fall back to tier4 (highest)
    expect(detectTierFromHeaders(1_000_000)).toBe('tier4');
    // 50k tokens/min → out of ±20% of every tier (±8k of 40k = 32k-48k includes 50k? let's see:
    // 50k / 40k = 1.25 → 25% delta → out of band
    // 50k / 80k = 0.625 → 37.5% delta → out of band
    // Should fall back: largest tier with ceiling <= 50k = tier1 (40k <= 50k)
    expect(detectTierFromHeaders(50_000)).toBe('tier1');
  });

  it('default config tier is NOT tier4 (the old insecure default)', () => {
    // MCP-429-04's central fix: default tier is no longer the liberal tier4.
    expect(DEFAULT_TOKEN_BUDGET_CONFIG.providerTier).not.toBe('tier4');
  });

  it('default config passes its own validateSoftLimits (no self-failure)', () => {
    const result = validateSoftLimits(DEFAULT_TOKEN_BUDGET_CONFIG);
    expect(result.valid, `default config fails its own validation: ${result.warnings.join('; ')}`).toBe(true);
  });

  it('default config\'s soft input limit is at or under tier2 hard limit', () => {
    // Safety invariant: a fresh install must NOT ship with soft limits
    // higher than a tier-1 user's real cap + some headroom.
    const softIn = DEFAULT_TOKEN_BUDGET_CONFIG.softInputTokensPerMinute;
    expect(softIn).toBeLessThanOrEqual(ANTHROPIC_TIER_LIMITS.tier2.inputTokensPerMinute);
  });

  it('providers/index.ts wires observeTierFromParsedHeaders into the done-chunk path', () => {
    expect(providersSrc).toContain('observeTierFromParsedHeaders');
    expect(providersSrc).toMatch(/rate-limit:tier-detected/);
  });

  it('streamMessage parses rate-limit headers (was collected-but-never-parsed before)', () => {
    // Find streamMessage body
    const streamIdx = providersSrc.indexOf('async *streamMessage');
    expect(streamIdx).toBeGreaterThan(0);
    const fnBody = providersSrc.substring(streamIdx, streamIdx + 20_000);
    expect(fnBody).toMatch(/parseRateLimitHeaders\s*\(\s*streamRespHeaders\s*\)/);
  });

  it('rate-limit:tier-detected event dedups so a single detected tier fires once', () => {
    // Source-scan for the _lastDetectedTier memo
    expect(providersSrc).toMatch(/_lastDetectedTier/);
    expect(providersSrc).toMatch(/if\s*\(\s*_lastDetectedTier\s*===\s*detected\s*\)\s*return/);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MCP-429-05 — MCP tool results routed through ToolResultBudget
// ═══════════════════════════════════════════════════════════════════
describe('MCP-429 / Slice 2 / MCP-429-05 — tool-result budget wiring', () => {
  it('CHAT_SEND executeTool callback imports & calls getToolResultBudget', () => {
    expect(mainSrc).toMatch(/from\s+['"]\.\/providers\/toolResultBudget['"]/);
    expect(mainSrc).toMatch(/getToolResultBudget\(\)\s*\.\s*processToolResult\s*\(\s*tc\.name,\s*toolResultContent,\s*tc\.id\s*\)/);
  });

  it('executeTool returns the TRUNCATED (budget-aware) content, not raw', () => {
    // Pre-fix: `return { content: toolResultContent, isError };`
    // Post-fix: `return { content: truncatedResult, isError };`
    const execIdx = mainSrc.indexOf('executeTool: async (tc)');
    expect(execIdx).toBeGreaterThan(0);
    const fnEnd = mainSrc.indexOf('persistMessage:', execIdx);
    const fnBody = mainSrc.substring(execIdx, fnEnd);
    // The return statement must use truncatedResult.
    expect(fnBody).toMatch(/return\s*\{\s*content:\s*truncatedResult,\s*isError\s*\}/);
    // And the pre-fix "content: toolResultContent" pattern must not
    // appear as a RETURN (live line). It's allowed in comments.
    const liveLines = fnBody.split(/\r?\n/).filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const liveBody = liveLines.join('\n');
    expect(liveBody).not.toMatch(/return\s*\{\s*content:\s*toolResultContent,\s*isError\s*\}/);
  });

  it('structured tools preserve the 16000-char cap (not over-truncated by token budget)', () => {
    const execIdx = mainSrc.indexOf('executeTool: async (tc)');
    const fnEnd = mainSrc.indexOf('persistMessage:', execIdx);
    const fnBody = mainSrc.substring(execIdx, fnEnd);
    // For structured tools we still substring to 16000 chars
    expect(fnBody).toMatch(/STRUCTURED_TOOL_NAMES\.has\(tc\.name\)/);
    expect(fnBody).toMatch(/substring\(0,\s*16000\)/);
  });

  it('DevConsole tool-result event carries both raw and budget-truncated lengths', () => {
    const execIdx = mainSrc.indexOf('executeTool: async (tc)');
    const fnEnd = mainSrc.indexOf('persistMessage:', execIdx);
    const fnBody = mainSrc.substring(execIdx, fnEnd);
    expect(fnBody).toMatch(/truncatedLength:\s*truncatedResult\.length/);
    expect(fnBody).toMatch(/fullTokens:\s*trbEntry\.fullTokens/);
    expect(fnBody).toMatch(/truncatedTokens:\s*trbEntry\.truncatedTokens/);
    expect(fnBody).toMatch(/retentionId:\s*trbEntry\.id/);
  });
});
