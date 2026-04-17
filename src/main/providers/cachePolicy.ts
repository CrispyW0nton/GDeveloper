/**
 * Prompt Cache Policy — Sprint 27.1 (Block 3)
 *
 * Marks stable prompt blocks with Anthropic's cache_control directive
 * so they are cached server-side and reduce input token costs on
 * subsequent requests (cache reads are 90% cheaper).
 *
 * Usage:
 *   import { applyCacheControl } from './cachePolicy';
 *   const systemBlocks = applyCacheControl(systemPrompt, { mode: 'plan' });
 *   // systemBlocks is an array of { type: 'text', text, cache_control? } blocks
 *   // suitable for the Anthropic "system" parameter.
 *
 * Caching strategy:
 *   - The base system prompt (>1000 chars, rarely changes) → ephemeral cache
 *   - Mode prefix (short, changes on /plan or /build) → NOT cached
 *   - Workspace/worktree context (changes on branch switch) → NOT cached
 *   - Tool listing (changes when MCP servers connect/disconnect) → NOT cached
 *
 * Only the first block (base prompt) is marked for caching. This is the
 * minimum viable approach — Sprint 28 can expand to multi-block caching.
 */

// ─── Types ───

export interface CacheableSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface CachePolicyOptions {
  /** Current execution mode */
  mode: 'plan' | 'build';
  /** Whether prompt caching is enabled globally */
  enabled?: boolean;
  /** Minimum length to consider a block cacheable (chars) */
  minCacheableLength?: number;
}

// ─── Constants ───

/** Minimum text length to be worth caching (Anthropic minimum is ~1024 tokens) */
const DEFAULT_MIN_CACHEABLE_LENGTH = 400; // ~100 tokens

// ─── Public API ───

/**
 * Split a system prompt into cache-aware blocks for the Anthropic API.
 *
 * @param systemPrompt - The full system prompt string
 * @param options - Cache policy options
 * @returns Array of CacheableSystemBlock suitable for Anthropic's system param
 */
export function applyCacheControl(
  systemPrompt: string,
  options: CachePolicyOptions,
): CacheableSystemBlock[] {
  const enabled = options.enabled !== false;
  const minLen = options.minCacheableLength ?? DEFAULT_MIN_CACHEABLE_LENGTH;

  if (!systemPrompt || systemPrompt.length === 0) {
    return [];
  }

  if (!enabled) {
    // Caching disabled — return as single plain block
    return [{ type: 'text', text: systemPrompt }];
  }

  // Split the prompt into logical sections by double-newline
  const sections = splitPromptSections(systemPrompt);

  if (sections.length <= 1) {
    // Single block — cache it if long enough
    if (systemPrompt.length >= minLen) {
      return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
    }
    return [{ type: 'text', text: systemPrompt }];
  }

  // Multi-section: cache the first (base prompt) section if it's stable and long
  const blocks: CacheableSystemBlock[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const isFirst = i === 0;
    const isStable = isFirst && section.length >= minLen && isLikelyStableBlock(section);

    blocks.push({
      type: 'text',
      text: section,
      ...(isStable ? { cache_control: { type: 'ephemeral' } } : {}),
    });
  }

  return blocks;
}

/**
 * Convert CacheableSystemBlock array back to a plain system string.
 * Used when the provider doesn't support structured system blocks.
 */
export function flattenSystemBlocks(blocks: CacheableSystemBlock[]): string {
  return blocks.map(b => b.text).join('\n\n');
}

/**
 * Check whether prompt caching should be used for the current request.
 * Simple heuristic: enable for long prompts (>2000 chars) in any mode.
 */
export function shouldEnableCache(systemPromptLength: number): boolean {
  return systemPromptLength > 2000;
}

// ─── Internals ───

/**
 * Split a prompt string into sections by double newlines.
 * Preserves content within sections.
 */
function splitPromptSections(prompt: string): string[] {
  return prompt
    .split(/\n\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Heuristic: is this text block likely stable across requests?
 * Stable blocks contain role instructions, not workspace state.
 */
function isLikelyStableBlock(text: string): boolean {
  // Workspace-specific dynamic content markers
  const dynamicMarkers = [
    'Current workspace:',
    'Branch:',
    'Tracking:',
    'Modified:',
    'Worktree:',
    'Task Progress:',
    'Checkpoint',
    'Rate limit awareness:',
    'tools available',
    'Local tools:',
    'MCP tools:',
  ];

  const lowerText = text.toLowerCase();
  for (const marker of dynamicMarkers) {
    if (lowerText.includes(marker.toLowerCase())) return false;
  }

  // Likely stable if it contains role instructions
  const stableMarkers = [
    'you are',
    'your role',
    'you can',
    'you cannot',
    'you must',
    'system prompt',
    'plan mode',
    'build mode',
  ];

  for (const marker of stableMarkers) {
    if (lowerText.includes(marker)) return true;
  }

  // Default: cache if long enough (>800 chars)
  return text.length > 800;
}
