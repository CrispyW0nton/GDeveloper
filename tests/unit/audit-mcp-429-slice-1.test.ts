/**
 * MCP-429 Slice 1 regression tests — "same-day quick wins"
 *
 * Covers the three Slice-1 findings from docs/AUDIT-MCP-429.md:
 *
 *   MCP-429-10  MCP banner threshold lowered 20 → 10 in ChatWorkspace.tsx
 *   MCP-429-08  Redundant tool-name enumeration removed from system prompt
 *               - promptBuilder.ts (dead-code path, also cleaned)
 *               - CHAT_SEND inline prompt in src/main/index.ts (live path)
 *   MCP-429-12  validateSoftLimits wired into both app startup AND the
 *               TOKEN_BUDGET_SET IPC handler (previously had zero call sites)
 *
 * Strategy: source-scan tests that assert the fix is in place. Functional
 * tests for validateSoftLimits are already covered by the pure-function
 * being importable without Electron.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateSoftLimits, DEFAULT_TOKEN_BUDGET_CONFIG, getRecommendedConfigForTier } from '../../src/main/providers/rateLimitConfig';

const chatSrc = readFileSync(resolve(__dirname, '../../src/renderer/components/chat/ChatWorkspace.tsx'), 'utf-8');
const promptBuilderSrc = readFileSync(resolve(__dirname, '../../src/main/orchestration/promptBuilder.ts'), 'utf-8');
const mainSrc = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════
//  MCP-429-10 — Banner threshold
// ═══════════════════════════════════════════════════════════════════
describe('MCP-429 / Slice 1 / MCP-429-10 — banner threshold', () => {
  it('MCP_TOOL_BANNER_THRESHOLD is 10 (was 20 pre-fix)', () => {
    expect(chatSrc).toMatch(/const\s+MCP_TOOL_BANNER_THRESHOLD\s*=\s*10\b/);
    expect(chatSrc).not.toMatch(/const\s+MCP_TOOL_BANNER_THRESHOLD\s*=\s*20\b/);
  });

  it('threshold comment references MCP-429-10 for future-maintainer breadcrumb', () => {
    expect(chatSrc).toContain('MCP-429-10');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MCP-429-08 — Redundant tool-name enumeration removed
// ═══════════════════════════════════════════════════════════════════
describe('MCP-429 / Slice 1 / MCP-429-08 — redundant tool enumeration removed', () => {
  it('promptBuilder.ts no longer pushes an "MCP tools: server/tool, …" block', () => {
    // Pre-fix line was:
    //   sections.push(`MCP tools: ${mcpNames.join(', ')}`);
    // It must not reappear.
    expect(promptBuilderSrc).not.toMatch(/sections\.push\(\s*`MCP tools:/);
    // And the audit ID must be referenced so future readers understand
    // why the block is gone.
    expect(promptBuilderSrc).toContain('MCP-429-08');
  });

  it('CHAT_SEND no longer emits the per-local-tool name enumeration into enhancedPrompt', () => {
    // Pre-fix line was:
    //   enhancedPrompt += `\nLocal tools: ${filteredLocalTools.map(t => t.name).join(', ')}`;
    // Check that no LIVE (non-comment) line contains the template-literal
    // expansion `filteredLocalTools.map(t => t.name).join`. The commented
    // documentation of the old line is allowed and expected.
    const liveLines = mainSrc.split(/\r?\n/).filter(l => !l.trim().startsWith('//'));
    const liveSrc = liveLines.join('\n');
    expect(liveSrc).not.toMatch(/filteredLocalTools\s*\.\s*map\s*\(\s*t\s*=>\s*t\.name\s*\)\s*\.\s*join/);
    // The comment annotation referencing the audit ID must still be present
    // so future maintainers understand why the line is gone.
    expect(mainSrc).toContain('MCP-429-08');
  });

  it('the summary-count line is preserved (not over-eager deletion)', () => {
    // We intentionally keep the `\nYou have X tools available (Y local + Z MCP)`
    // line — it's one short line and useful for situational awareness.
    expect(mainSrc).toMatch(/You have \$\{allTools\.length\} tools available/);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MCP-429-12 — validateSoftLimits wired into startup + TOKEN_BUDGET_SET
// ═══════════════════════════════════════════════════════════════════
describe('MCP-429 / Slice 1 / MCP-429-12 — validateSoftLimits is actually called', () => {
  it('validateSoftLimits is imported in src/main/index.ts', () => {
    expect(mainSrc).toMatch(/import\s*\{[^}]*\bvalidateSoftLimits\b[^}]*\}\s*from\s*['"]\.\/providers\/rateLimitConfig['"]/);
  });

  it('validateSoftLimits is called from the TOKEN_BUDGET_SET handler', () => {
    // Find the handler and confirm it runs validation after updateConfig
    const handlerIdx = mainSrc.indexOf('IPC_CHANNELS.TOKEN_BUDGET_SET');
    expect(handlerIdx).toBeGreaterThan(0);
    const handlerBlock = mainSrc.substring(handlerIdx, handlerIdx + 2000);
    expect(handlerBlock).toMatch(/validateSoftLimits\s*\(/);
    // Must forward warnings to the renderer via the new rate-limit:validation channel
    expect(handlerBlock).toContain('rate-limit:validation');
  });

  it('validateSoftLimits is also called at startup (right after getRateLimiter() is resolved)', () => {
    // Look for the boot-validate log marker around the rate-limiter setup
    expect(mainSrc).toContain('rate-limit:boot-validate');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Functional test: validateSoftLimits itself still catches the
//  default-config bug (validates that the default is still broken
//  and that the validator correctly reports it — this is what the
//  new call sites will surface to users).
// ═══════════════════════════════════════════════════════════════════
describe('MCP-429 / Slice 1 / MCP-429-04-sanity — validateSoftLimits correctly flags the default', () => {
  it('DEFAULT_TOKEN_BUDGET_CONFIG is no longer the tier4-over-everything default', () => {
    // Slice 2 (MCP-429-04) flipped the default from tier4 → tier2 so
    // first-boot users get reasonable soft limits instead of silent 429s.
    // Slice 1 is aware of this flip and tolerates either tier so long as
    // it's NOT the legacy tier4 + 400k/min combination.
    expect(DEFAULT_TOKEN_BUDGET_CONFIG.providerTier).not.toBe('tier4');
  });

  it('validateSoftLimits passes for the shipped default config (no self-failure)', () => {
    const result = validateSoftLimits(DEFAULT_TOKEN_BUDGET_CONFIG);
    expect(result.valid, `shipped default fails its own validation: ${result.warnings.join('; ')}`).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('validateSoftLimits REJECTS a tier4-scale 400k/min config on a tier1 account (the bug MCP-429-04 closes)', () => {
    // Craft the OLD default shape explicitly so this test keeps documenting
    // what was broken, regardless of how DEFAULT_TOKEN_BUDGET_CONFIG evolves.
    const oldBrokenDefault = {
      ...DEFAULT_TOKEN_BUDGET_CONFIG,
      softInputTokensPerMinute: 400_000,
      softOutputTokensPerMinute: 14_000,
      softRequestsPerMinute: 45,
      providerTier: 'tier1' as const,
    };
    const result = validateSoftLimits(oldBrokenDefault);
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    const joined = result.warnings.join('\n');
    expect(joined).toMatch(/exceeds your tier's hard limit/i);
    expect(joined).toMatch(/429/);
  });

  it('getRecommendedConfigForTier produces a tier-1 config that VALIDATES', () => {
    // Meta-test: the recommended config for tier-1 must itself pass
    // validation. Otherwise Slice 2's auto-detection would hand users
    // a config that immediately fails its own validator.
    const tier1Rec = { ...getRecommendedConfigForTier('tier1'), providerTier: 'tier1' as const };
    const result = validateSoftLimits(tier1Rec);
    expect(result.valid, `tier1 recommended config failed validation: ${result.warnings.join('; ')}`).toBe(true);
  });
});
