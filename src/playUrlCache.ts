/**
 * Session-scoped cache for resolved play URLs (cleared on tab close).
 */

import type { MediaEnvelope } from './sandboxLayer1';

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 120;

type CacheEntry = { envelope: MediaEnvelope; expiresAt: number };

const cache = new Map<string, CacheEntry>();

export function playCacheKey(env: MediaEnvelope): string {
  const parts = [
    env.envelopeId,
    env.sourceId,
    env.title?.trim().toLowerCase(),
    env.artist?.trim().toLowerCase(),
    env.album?.trim().toLowerCase(),
  ].filter(Boolean);
  return parts.join('|');
}

export function getCachedPlayEnvelope(key: string): MediaEnvelope | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.envelope;
}

export function setCachedPlayEnvelope(key: string, envelope: MediaEnvelope): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
  cache.set(key, { envelope, expiresAt: Date.now() + TTL_MS });
}

export function clearPlayUrlCache(): void {
  cache.clear();
}
