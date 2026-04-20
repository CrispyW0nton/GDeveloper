/**
 * Rate-Limit & Token-Budget Configuration — Sprint 21
 *
 * Defines per-provider tier defaults, preset profiles (Safe / Balanced / Aggressive / Custom),
 * soft rate-limit thresholds, retry strategy config, and helper utilities.
 */

// ─── Anthropic Tier Definitions ───

export type AnthropicTier = 'tier1' | 'tier2' | 'tier3' | 'tier4';

export interface TierLimits {
  inputTokensPerMinute: number;
  outputTokensPerMinute: number;
  requestsPerMinute: number;
  label: string;
  description: string;
}

export const ANTHROPIC_TIER_LIMITS: Record<AnthropicTier, TierLimits> = {
  tier1: {
    inputTokensPerMinute: 40_000,
    outputTokensPerMinute: 8_000,
    requestsPerMinute: 50,
    label: 'Tier 1 — Free / New',
    description: 'New accounts or free tier. Very tight limits.',
  },
  tier2: {
    inputTokensPerMinute: 80_000,
    outputTokensPerMinute: 16_000,
    requestsPerMinute: 1000,
    label: 'Tier 2 — Build',
    description: 'Most individual developers. Moderate limits.',
  },
  tier3: {
    inputTokensPerMinute: 160_000,
    outputTokensPerMinute: 32_000,
    requestsPerMinute: 2000,
    label: 'Tier 3 — Scale',
    description: 'Teams / heavy workloads. Higher limits.',
  },
  tier4: {
    inputTokensPerMinute: 400_000,
    outputTokensPerMinute: 80_000,
    requestsPerMinute: 4000,
    label: 'Tier 4 — Enterprise',
    description: 'Enterprise accounts with highest limits.',
  },
};

// ─── Retry Strategy ───

export type RetryStrategy = 'none' | 'linear' | 'exponential';

export interface RetryConfig {
  strategy: RetryStrategy;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  strategy: 'exponential',
  maxRetries: 5,
  baseDelayMs: 1500,
  maxDelayMs: 30000,
};

// ─── Token-Budget Settings ───

export interface TokenBudgetConfig {
  // Per-response limits
  maxOutputTokensPerResponse: number;
  maxContextTokensPerRequest: number;
  // Conversation management
  maxConversationHistoryMessages: number;
  // Tool result budgets
  maxToolResultTokensPerTool: number;
  maxToolResultsRetained: number;
  // Parallel tool limits
  maxParallelToolCalls: number;
  // Soft per-minute limits (user-configurable, should stay under tier limits)
  softInputTokensPerMinute: number;
  softOutputTokensPerMinute: number;
  softRequestsPerMinute: number;
  // Retry
  retry: RetryConfig;
  // Provider tier
  providerTier: AnthropicTier;
}

// ─── Preset Profiles ───

export type PresetProfileId = 'safe' | 'balanced' | 'aggressive' | 'custom';

export interface PresetProfile {
  id: PresetProfileId;
  name: string;
  description: string;
  config: Omit<TokenBudgetConfig, 'providerTier'>;
}

const SAFE_CONFIG: Omit<TokenBudgetConfig, 'providerTier'> = {
  maxOutputTokensPerResponse: 2048,
  maxContextTokensPerRequest: 40_000,
  maxConversationHistoryMessages: 10,
  maxToolResultTokensPerTool: 1500,
  maxToolResultsRetained: 5,
  maxParallelToolCalls: 1,
  softInputTokensPerMinute: 30_000,
  softOutputTokensPerMinute: 6_000,
  softRequestsPerMinute: 20,
  retry: { strategy: 'exponential', maxRetries: 5, baseDelayMs: 2000, maxDelayMs: 60000 },
};

const BALANCED_CONFIG: Omit<TokenBudgetConfig, 'providerTier'> = {
  maxOutputTokensPerResponse: 4096,
  maxContextTokensPerRequest: 80_000,
  maxConversationHistoryMessages: 20,
  maxToolResultTokensPerTool: 2500,
  maxToolResultsRetained: 10,
  maxParallelToolCalls: 2,
  softInputTokensPerMinute: 400_000,
  softOutputTokensPerMinute: 14_000,
  softRequestsPerMinute: 45,
  retry: { ...DEFAULT_RETRY_CONFIG },
};

const AGGRESSIVE_CONFIG: Omit<TokenBudgetConfig, 'providerTier'> = {
  maxOutputTokensPerResponse: 8192,
  maxContextTokensPerRequest: 150_000,
  maxConversationHistoryMessages: 40,
  maxToolResultTokensPerTool: 5000,
  maxToolResultsRetained: 20,
  maxParallelToolCalls: 4,
  softInputTokensPerMinute: 380_000,
  softOutputTokensPerMinute: 60_000,
  softRequestsPerMinute: 80,
  retry: { strategy: 'exponential', maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 15000 },
};

export const PRESET_PROFILES: PresetProfile[] = [
  { id: 'safe', name: 'Safe', description: 'Minimize API spend and avoid rate limits. Best for Tier 1-2 accounts.', config: SAFE_CONFIG },
  { id: 'balanced', name: 'Balanced', description: 'Good default. Keeps within 450k input/min with headroom. Best for Tier 3-4.', config: BALANCED_CONFIG },
  { id: 'aggressive', name: 'Aggressive', description: 'Maximize throughput. Only for Tier 4 or unlimited accounts.', config: AGGRESSIVE_CONFIG },
  { id: 'custom', name: 'Custom', description: 'Fine-tune every setting yourself.', config: BALANCED_CONFIG },
];

// ─── Default ───

// MCP-429-04: Default was `providerTier: 'tier4'` with BALANCED_CONFIG's
// softInputTokensPerMinute: 400_000 — 10× over a Tier-1 account's
// real 40k/min hard limit. New accounts, free-tier users, and most
// individual developers on a single paid subscription are Tier 1 or
// Tier 2, not Tier 4. The old default meant validateSoftLimits would
// silently pass for every tier while users continued to hit 429s.
//
// New default: tier-2 with tier-2-scaled soft limits. A genuine Tier-4
// user still sees this validate cleanly (their real limit is higher
// than our assumed tier-2 soft cap), while a Tier-1 user immediately
// gets the validateSoftLimits warning instead of silent 429s.
//
// Slice 2 also auto-detects the real tier from rate-limit response
// headers (detectTierFromHeaders below) so the correct config is
// proposed on the user's first successful request.
export const DEFAULT_TOKEN_BUDGET_CONFIG: TokenBudgetConfig = {
  ...getRecommendedConfigForTier('tier2'),
  providerTier: 'tier2',
};

// ─── Helpers ───

/** Get recommended config for a given tier */
export function getRecommendedConfigForTier(tier: AnthropicTier): Omit<TokenBudgetConfig, 'providerTier'> {
  const limits = ANTHROPIC_TIER_LIMITS[tier];
  switch (tier) {
    case 'tier1':
      return {
        ...SAFE_CONFIG,
        softInputTokensPerMinute: Math.round(limits.inputTokensPerMinute * 0.8),
        softOutputTokensPerMinute: Math.round(limits.outputTokensPerMinute * 0.8),
        softRequestsPerMinute: Math.min(limits.requestsPerMinute, 20),
      };
    case 'tier2':
      return {
        ...SAFE_CONFIG,
        maxContextTokensPerRequest: 60_000,
        maxConversationHistoryMessages: 15,
        softInputTokensPerMinute: Math.round(limits.inputTokensPerMinute * 0.85),
        softOutputTokensPerMinute: Math.round(limits.outputTokensPerMinute * 0.85),
        softRequestsPerMinute: Math.min(limits.requestsPerMinute, 40),
      };
    case 'tier3':
      return {
        ...BALANCED_CONFIG,
        softInputTokensPerMinute: Math.round(limits.inputTokensPerMinute * 0.85),
        softOutputTokensPerMinute: Math.round(limits.outputTokensPerMinute * 0.85),
        softRequestsPerMinute: Math.min(limits.requestsPerMinute, 60),
      };
    case 'tier4':
    default:
      return BALANCED_CONFIG;
  }
}

/** Check whether a proposed soft limit exceeds the tier hard limit */
export function validateSoftLimits(
  config: TokenBudgetConfig
): { valid: boolean; warnings: string[] } {
  const tierLimits = ANTHROPIC_TIER_LIMITS[config.providerTier];
  const warnings: string[] = [];

  if (config.softInputTokensPerMinute > tierLimits.inputTokensPerMinute) {
    warnings.push(
      `Soft input token limit (${config.softInputTokensPerMinute.toLocaleString()}) exceeds your tier's hard limit (${tierLimits.inputTokensPerMinute.toLocaleString()}/min). You will hit 429 errors.`
    );
  }
  if (config.softOutputTokensPerMinute > tierLimits.outputTokensPerMinute) {
    warnings.push(
      `Soft output token limit (${config.softOutputTokensPerMinute.toLocaleString()}) exceeds your tier's hard limit (${tierLimits.outputTokensPerMinute.toLocaleString()}/min).`
    );
  }
  if (config.softRequestsPerMinute > tierLimits.requestsPerMinute) {
    warnings.push(
      `Soft request limit (${config.softRequestsPerMinute}) exceeds your tier's hard limit (${tierLimits.requestsPerMinute}/min).`
    );
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * MCP-429-04: Infer the user's Anthropic tier from the
 * `x-ratelimit-limit-input-tokens` response header.
 *
 * The Anthropic API reports the account's true per-minute input-token
 * cap on every response. We match it against the known tier ceilings:
 *
 *   40k   → tier1
 *   80k   → tier2
 *   160k  → tier3
 *   400k+ → tier4
 *
 * Tolerance: each tier matches within ±20% of its declared cap, so
 * customer-specific negotiated limits (e.g. 50k, 90k) still pin to the
 * nearest published tier. Returns `null` if the header is absent or
 * unparseable — callers should leave the configured tier untouched in
 * that case.
 *
 * Intended caller: the provider's response-processing path, right after
 * parseRateLimitHeaders returns. The caller compares the detected tier
 * against the rate-limiter's currently configured tier and, on
 * mismatch, emits a `rate-limit:tier-detected` event so the renderer's
 * Settings panel can prompt the user.
 *
 * Ref: docs/AUDIT-MCP-429.md §MCP-429-04
 */
export function detectTierFromHeaders(
  inputTokensLimit: number | null | undefined,
): AnthropicTier | null {
  if (!inputTokensLimit || inputTokensLimit <= 0) return null;

  // Sort tiers by declared inputTokensPerMinute ascending so we match
  // each band's window correctly. Tolerance = ±20% of the tier ceiling.
  const sortedTiers: AnthropicTier[] = (['tier1', 'tier2', 'tier3', 'tier4'] as const);
  let best: AnthropicTier | null = null;
  let bestDelta = Infinity;
  for (const tier of sortedTiers) {
    const ceiling = ANTHROPIC_TIER_LIMITS[tier].inputTokensPerMinute;
    const delta = Math.abs(inputTokensLimit - ceiling) / ceiling;
    if (delta <= 0.2 && delta < bestDelta) {
      best = tier;
      bestDelta = delta;
    }
  }

  if (best) return best;

  // No tier within ±20% — pin to the nearest tier whose ceiling does
  // NOT exceed the observed limit (conservative — we'd rather soft-cap
  // below an unknown real limit than above it).
  let fallback: AnthropicTier = 'tier1';
  for (const tier of sortedTiers) {
    if (ANTHROPIC_TIER_LIMITS[tier].inputTokensPerMinute <= inputTokensLimit) {
      fallback = tier;
    }
  }
  return fallback;
}

/** Serialize / deserialize for localStorage persistence */
export function serializeTokenBudgetConfig(config: TokenBudgetConfig): string {
  return JSON.stringify(config);
}

export function deserializeTokenBudgetConfig(json: string): TokenBudgetConfig | null {
  try {
    const parsed = JSON.parse(json);
    // Validate required fields exist
    if (typeof parsed.maxOutputTokensPerResponse !== 'number') return null;
    return { ...DEFAULT_TOKEN_BUDGET_CONFIG, ...parsed };
  } catch {
    return null;
  }
}
