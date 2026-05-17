import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  clearContextCache,
  createContextCacheKey,
  getContextCacheStats,
  getOrSetContextCache,
  setContextCacheEntry,
} from '../../src/main/orchestration/contextCache';

const SRC = resolve(__dirname, '../../src');

class MemoryStore {
  values = new Map<string, string>();
  getSetting(key: string): string | null {
    return this.values.get(key) || null;
  }
  setSetting(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

describe('Phase 5 context cache', () => {
  it('creates stable namespace keys and returns cached values on repeated access', () => {
    const store = new MemoryStore();
    let produced = 0;
    const first = getOrSetContextCache('project-context', ['/repo', { maxFiles: 10 }], () => {
      produced++;
      return { repoMap: ['a'] };
    }, store);
    const second = getOrSetContextCache('project-context', ['/repo', { maxFiles: 10 }], () => {
      produced++;
      return { repoMap: ['b'] };
    }, store);

    expect(first.hit).toBe(false);
    expect(second.hit).toBe(true);
    expect(second.value).toEqual({ repoMap: ['a'] });
    expect(produced).toBe(1);
    expect(createContextCacheKey('project-context', ['/repo'])).toMatch(/^project-context:/);
  });

  it('tracks misses, hits, bytes, namespaces, expiry, and clear', () => {
    const store = new MemoryStore();
    setContextCacheEntry('code-retrieval', 'expired', ['old'], store, -1, new Date('2026-05-16T10:00:00.000Z'));
    const miss = getOrSetContextCache('code-retrieval', ['query'], () => ['fresh'], store, 60_000);
    const hit = getOrSetContextCache('code-retrieval', ['query'], () => ['unused'], store, 60_000);
    const stats = getContextCacheStats(store);

    expect(miss.hit).toBe(false);
    expect(hit.hit).toBe(true);
    expect(stats.entries).toBe(1);
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(stats.misses).toBeGreaterThanOrEqual(1);
    expect(stats.evictions).toBeGreaterThanOrEqual(1);
    expect(stats.byNamespace['code-retrieval']).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);

    expect(clearContextCache(store).entries).toBe(0);
    expect(getContextCacheStats(store).entries).toBe(0);
  });

  it('wires prompt builder, slash command, IPC, and preload to the cache', () => {
    const promptBuilderSrc = readSrc('main/orchestration/promptBuilder.ts');
    const commandsSrc = readSrc('main/commands/index.ts');
    const ipcSrc = readSrc('main/ipc/index.ts');
    const mainSrc = readSrc('main/index.ts');
    const preloadSrc = readSrc('preload/index.ts');

    expect(promptBuilderSrc).toContain("getOrSetContextCache('project-context'");
    expect(promptBuilderSrc).toContain("getOrSetContextCache('code-retrieval'");
    expect(commandsSrc).toContain("name: 'cache'");
    expect(commandsSrc).toContain('getContextCacheStats');
    expect(ipcSrc).toContain('CONTEXT_CACHE_STATS');
    expect(ipcSrc).toContain('CONTEXT_CACHE_CLEAR');
    expect(mainSrc).toContain('IPC_CHANNELS.CONTEXT_CACHE_STATS');
    expect(preloadSrc).toContain('getContextCacheStats');
  });
});
