import { createHash } from 'crypto';
import { getDatabase } from '../db';

export type ContextCacheNamespace = 'project-context' | 'code-retrieval' | 'prompt-fragment';

export interface ContextCacheEntry<T = unknown> {
  key: string;
  namespace: ContextCacheNamespace;
  value: T;
  createdAt: string;
  expiresAt: string;
  hitCount: number;
  byteSize: number;
}

export interface ContextCacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  evictions: number;
  byNamespace: Record<ContextCacheNamespace, number>;
}

interface ContextCacheStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

interface CacheEnvelope {
  entries: ContextCacheEntry[];
  stats: ContextCacheStats;
}

const SETTINGS_KEY = 'context_cache.v1';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 80;

const EMPTY_STATS: ContextCacheStats = {
  entries: 0,
  bytes: 0,
  hits: 0,
  misses: 0,
  evictions: 0,
  byNamespace: {
    'project-context': 0,
    'code-retrieval': 0,
    'prompt-fragment': 0,
  },
};

export function createContextCacheKey(namespace: ContextCacheNamespace, parts: unknown[]): string {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
  return `${namespace}:${digest}`;
}

export function getContextCacheEntry<T>(key: string, store?: ContextCacheStore, now = new Date()): ContextCacheEntry<T> | null {
  const effectiveStore = store || getDatabase();
  const envelope = loadEnvelope(effectiveStore);
  const index = envelope.entries.findIndex(entry => entry.key === key);
  if (index < 0) {
    envelope.stats.misses++;
    saveEnvelope(envelope, effectiveStore);
    return null;
  }

  const entry = envelope.entries[index];
  if (new Date(entry.expiresAt).getTime() <= now.getTime()) {
    envelope.entries.splice(index, 1);
    envelope.stats.misses++;
    envelope.stats.evictions++;
    saveEnvelope(recomputeStats(envelope), effectiveStore);
    return null;
  }

  const updated = { ...entry, hitCount: entry.hitCount + 1 } as ContextCacheEntry<T>;
  envelope.entries[index] = updated;
  envelope.stats.hits++;
  saveEnvelope(recomputeStats(envelope), effectiveStore);
  return updated;
}

export function setContextCacheEntry<T>(
  namespace: ContextCacheNamespace,
  key: string,
  value: T,
  store?: ContextCacheStore,
  ttlMs = DEFAULT_TTL_MS,
  now = new Date()
): ContextCacheEntry<T> {
  const effectiveStore = store || getDatabase();
  const envelope = pruneExpired(loadEnvelope(effectiveStore), now);
  const serialized = JSON.stringify(value);
  const entry: ContextCacheEntry<T> = {
    key,
    namespace,
    value,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    hitCount: 0,
    byteSize: Buffer.byteLength(serialized, 'utf-8'),
  };

  envelope.entries = envelope.entries.filter(existing => existing.key !== key);
  envelope.entries.unshift(entry);
  while (envelope.entries.length > MAX_ENTRIES) {
    envelope.entries.pop();
    envelope.stats.evictions++;
  }
  saveEnvelope(recomputeStats(envelope), effectiveStore);
  return entry;
}

export function getOrSetContextCache<T>(
  namespace: ContextCacheNamespace,
  parts: unknown[],
  producer: () => T,
  store?: ContextCacheStore,
  ttlMs = DEFAULT_TTL_MS
): { value: T; hit: boolean; key: string } {
  const key = createContextCacheKey(namespace, parts);
  const effectiveStore = store || getDatabase();
  const cached = getContextCacheEntry<T>(key, effectiveStore);
  if (cached) return { value: cached.value, hit: true, key };
  const value = producer();
  setContextCacheEntry(namespace, key, value, effectiveStore, ttlMs);
  return { value, hit: false, key };
}

export function getContextCacheStats(store?: ContextCacheStore): ContextCacheStats {
  const effectiveStore = store || getDatabase();
  const envelope = pruneExpired(loadEnvelope(effectiveStore), new Date());
  saveEnvelope(recomputeStats(envelope), effectiveStore);
  return envelope.stats;
}

export function clearContextCache(store?: ContextCacheStore): ContextCacheStats {
  const effectiveStore = store || getDatabase();
  const next = { entries: [], stats: { ...EMPTY_STATS, byNamespace: { ...EMPTY_STATS.byNamespace } } };
  saveEnvelope(next, effectiveStore);
  return next.stats;
}

function loadEnvelope(store: ContextCacheStore): CacheEnvelope {
  const raw = store.getSetting(SETTINGS_KEY);
  if (!raw) return { entries: [], stats: { ...EMPTY_STATS, byNamespace: { ...EMPTY_STATS.byNamespace } } };
  try {
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isEntry) : [],
      stats: { ...EMPTY_STATS, ...(parsed.stats || {}), byNamespace: { ...EMPTY_STATS.byNamespace, ...(parsed.stats?.byNamespace || {}) } },
    };
  } catch {
    return { entries: [], stats: { ...EMPTY_STATS, byNamespace: { ...EMPTY_STATS.byNamespace } } };
  }
}

function saveEnvelope(envelope: CacheEnvelope, store: ContextCacheStore): void {
  store.setSetting(SETTINGS_KEY, JSON.stringify(envelope));
}

function pruneExpired(envelope: CacheEnvelope, now: Date): CacheEnvelope {
  const before = envelope.entries.length;
  envelope.entries = envelope.entries.filter(entry => new Date(entry.expiresAt).getTime() > now.getTime());
  envelope.stats.evictions += before - envelope.entries.length;
  return recomputeStats(envelope);
}

function recomputeStats(envelope: CacheEnvelope): CacheEnvelope {
  const byNamespace = { ...EMPTY_STATS.byNamespace };
  let bytes = 0;
  for (const entry of envelope.entries) {
    byNamespace[entry.namespace]++;
    bytes += entry.byteSize;
  }
  envelope.stats.entries = envelope.entries.length;
  envelope.stats.bytes = bytes;
  envelope.stats.byNamespace = byNamespace;
  return envelope;
}

function isEntry(value: any): value is ContextCacheEntry {
  return !!value && typeof value.key === 'string' && typeof value.namespace === 'string' && typeof value.expiresAt === 'string';
}
