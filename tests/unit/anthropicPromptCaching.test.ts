import { describe, expect, it } from 'vitest';

import {
  ANTHROPIC_MAX_CACHE_CONTROL_BLOCKS,
  buildAnthropicPromptCacheParts,
} from '../../src/main/providers';

function tool(name: string): any {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: 'object', properties: {} },
  };
}

function countCacheControl(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countCacheControl(item), 0);

  const record = value as Record<string, unknown>;
  return (record.cache_control ? 1 : 0)
    + Object.values(record).reduce((sum, item) => sum + countCacheControl(item), 0);
}

describe('Anthropic prompt caching request shaping', () => {
  it('caps cache_control markers to Anthropic maximum across system and tools', () => {
    const result = buildAnthropicPromptCacheParts(
      'System prompt',
      Array.from({ length: 19 }, (_, index) => tool(`tool_${index}`)),
      true,
    );

    const total = countCacheControl({ system: result.system, tools: result.tools });

    expect(total).toBe(ANTHROPIC_MAX_CACHE_CONTROL_BLOCKS);
    expect(result.cacheControlBlocks).toBe(ANTHROPIC_MAX_CACHE_CONTROL_BLOCKS);
    expect(result.tools?.slice(0, 3).every(t => Boolean(t.cache_control))).toBe(true);
    expect(result.tools?.slice(3).every(t => !t.cache_control)).toBe(true);
  });

  it('can use all four cache slots for tools when no system prompt is present', () => {
    const result = buildAnthropicPromptCacheParts(
      '',
      Array.from({ length: 6 }, (_, index) => tool(`tool_${index}`)),
      true,
    );

    const total = countCacheControl({ system: result.system, tools: result.tools });

    expect(result.system).toBe('');
    expect(total).toBe(ANTHROPIC_MAX_CACHE_CONTROL_BLOCKS);
    expect(result.tools?.slice(0, 4).every(t => Boolean(t.cache_control))).toBe(true);
    expect(result.tools?.slice(4).every(t => !t.cache_control)).toBe(true);
  });

  it('omits cache_control markers when prompt caching is disabled', () => {
    const result = buildAnthropicPromptCacheParts(
      'System prompt',
      Array.from({ length: 6 }, (_, index) => tool(`tool_${index}`)),
      false,
    );

    expect(result.system).toBe('System prompt');
    expect(result.cacheControlBlocks).toBe(0);
    expect(countCacheControl({ system: result.system, tools: result.tools })).toBe(0);
  });
});
