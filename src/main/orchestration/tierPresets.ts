/**
 * Tier Presets — Sprint 29
 *
 * Predefined orchestration settings per Anthropic API tier.
 * These align with the rate-limit windows published by Anthropic.
 *
 * DEFAULT_TIER = 2 — balances throughput and safety for most users.
 */

export interface TierPreset {
  tier: number;
  label: string;
  description: string;
  maxTurnsPerTask: number;
  maxToolCallsPerTurn: number;
  maxRetries: number;
  tokenBudget: number;
  timeoutMs: number;
  maxParallelToolCalls: number;
  maxContextTokens: number;
  maxToolResultTokens: number;
  softInputTokensPerMinute: number;
  softOutputTokensPerMinute: number;
  softRequestsPerMinute: number;
}

export const TIER_PRESETS: Record<number, TierPreset> = {
  1: {
    tier: 1,
    label: 'Free / Starter',
    description: 'Conservative limits for free-tier API keys. Low concurrency, small context.',
    maxTurnsPerTask: 15,
    maxToolCallsPerTurn: 5,
    maxRetries: 2,
    tokenBudget: 100_000,
    timeoutMs: 300_000,
    maxParallelToolCalls: 1,
    maxContextTokens: 40_000,
    maxToolResultTokens: 1_500,
    softInputTokensPerMinute: 20_000,
    softOutputTokensPerMinute: 4_000,
    softRequestsPerMinute: 5,
  },
  2: {
    tier: 2,
    label: 'Build (Recommended)',
    description: 'Balanced settings for paid-tier keys. Good throughput with safety margin.',
    maxTurnsPerTask: 25,
    maxToolCallsPerTurn: 10,
    maxRetries: 3,
    tokenBudget: 300_000,
    timeoutMs: 600_000,
    maxParallelToolCalls: 2,
    maxContextTokens: 80_000,
    maxToolResultTokens: 2_500,
    softInputTokensPerMinute: 40_000,
    softOutputTokensPerMinute: 8_000,
    softRequestsPerMinute: 50,
  },
  3: {
    tier: 3,
    label: 'Scale',
    description: 'Higher limits for scale-tier keys. More turns, larger context window.',
    maxTurnsPerTask: 40,
    maxToolCallsPerTurn: 15,
    maxRetries: 4,
    tokenBudget: 500_000,
    timeoutMs: 900_000,
    maxParallelToolCalls: 3,
    maxContextTokens: 150_000,
    maxToolResultTokens: 4_000,
    softInputTokensPerMinute: 80_000,
    softOutputTokensPerMinute: 16_000,
    softRequestsPerMinute: 100,
  },
  4: {
    tier: 4,
    label: 'Enterprise',
    description: 'Maximum throughput for enterprise keys. Use with caution — high token spend.',
    maxTurnsPerTask: 50,
    maxToolCallsPerTurn: 20,
    maxRetries: 5,
    tokenBudget: 1_000_000,
    timeoutMs: 1_200_000,
    maxParallelToolCalls: 4,
    maxContextTokens: 200_000,
    maxToolResultTokens: 5_000,
    softInputTokensPerMinute: 200_000,
    softOutputTokensPerMinute: 40_000,
    softRequestsPerMinute: 250,
  },
};

/** Default tier for fresh installs */
export const DEFAULT_TIER = 2;

/** Get a tier preset, falling back to DEFAULT_TIER if not found */
export function getTierPreset(tier: number): TierPreset {
  return TIER_PRESETS[tier] || TIER_PRESETS[DEFAULT_TIER];
}

/** Get all tier preset entries (for UI dropdowns) */
export function getAllTierPresets(): TierPreset[] {
  return Object.values(TIER_PRESETS).sort((a, b) => a.tier - b.tier);
}
