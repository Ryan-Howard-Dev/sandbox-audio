/**
 * Background sonic analysis — never blocks playback.
 * Triggers on locker ingest; lazy queue when mix/radio needs missing seed features.
 */

import { getLockerAudioBlob } from './lockerStorage';
import type { LockerEntry } from './lockerStorage';
import type { MediaEnvelope } from './sandboxLayer1';
import { analyzeAudioBlob } from './sonicAnalyzer';
import {
  applyMusicalKeyToFeatures,
  getSonicFeaturesForTrack,
  lockerTrackKeyFromEnvelope,
  setSonicFeaturesForTrack,
  sonicFeaturesFromTier34Vector,
} from './sonicFeatures';
import { tier34HealthOk, tier34SonicDna } from './tier34/client';
import { OFFLINE_STATUS_POLL_MS } from './offlineStatus';
import {
  CACHE_KEYS,
  prefixedCacheKey,
  readResponseCache,
  writeResponseCache,
} from './responseCache';

const pending = new Set<string>();
const queued: string[] = [];
let processing = false;
let pumpScheduled = false;

function schedulePump(): void {
  if (pumpScheduled) return;
  pumpScheduled = true;
  const run = () => {
    pumpScheduled = false;
    void processQueue();
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 2500 });
  } else {
    setTimeout(run, 32);
  }
}

async function fetchTier34Features(
  entry: LockerEntry,
): Promise<ReturnType<typeof sonicFeaturesFromTier34Vector> | null> {
  const cacheKey = prefixedCacheKey(
    CACHE_KEYS.SONIC_DNA,
    `${entry.title}::${entry.artist}::${entry.genre ?? ''}`,
  );
  const cached = readResponseCache<{ vector: number[] }>(cacheKey);
  if (cached?.data?.vector?.length) {
    return sonicFeaturesFromTier34Vector(cached.data.vector);
  }

  if (!(await tier34HealthOk())) return null;
  const result = await tier34SonicDna(
    entry.title,
    entry.artist,
    entry.genre,
    entry.durationSeconds,
  );
  if (!result?.vector?.length) return null;
  writeResponseCache(cacheKey, { vector: result.vector }, 7 * 24 * 60 * 60 * 1000);
  return sonicFeaturesFromTier34Vector(result.vector);
}

async function analyzeTrackId(trackId: string): Promise<void> {
  const existing = getSonicFeaturesForTrack(trackId);
  if (existing?.source === 'analyzed') return;

  const entries = await import('./lockerStorage').then((m) => m.getLockerEntries());
  const entry = entries.find((e) => e.id === trackId);

  const blob = await getLockerAudioBlob(trackId);
  if (blob) {
    const analyzed = await analyzeAudioBlob(blob);
    if (analyzed) {
      const withKey =
        !analyzed.camelot && entry?.initialKey
          ? applyMusicalKeyToFeatures(analyzed, entry.initialKey, 'id3')
          : analyzed;
      setSonicFeaturesForTrack(trackId, withKey);
      return;
    }
  }

  if (existing?.source === 'tier34-stub') {
    if (!(await tier34HealthOk())) return;
  }

  if (!entry) return;
  const tier34 = await fetchTier34Features(entry);
  if (tier34) {
    const withKey = entry.initialKey
      ? applyMusicalKeyToFeatures(tier34, entry.initialKey, 'id3')
      : tier34;
    setSonicFeaturesForTrack(trackId, withKey);
  } else if (entry.initialKey) {
    setSonicFeaturesForTrack(
      trackId,
      applyMusicalKeyToFeatures(
        { source: 'id3', analyzedAt: Date.now() },
        entry.initialKey,
        'id3',
      ),
    );
  }
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queued.length > 0) {
      const trackId = queued.shift();
      if (!trackId) continue;
      pending.delete(trackId);
      try {
        await analyzeTrackId(trackId);
      } catch {
        /* best-effort background work */
      }
      await new Promise((r) => setTimeout(r, 16));
    }
  } finally {
    processing = false;
  }
}

export function enqueueSonicAnalysis(trackId: string): void {
  const id = trackId.trim();
  if (!id || pending.has(id)) return;
  if (getSonicFeaturesForTrack(id)?.source === 'analyzed') return;
  pending.add(id);
  queued.push(id);
  schedulePump();
}

export function enqueueSonicAnalysisForEntry(entry: LockerEntry): void {
  enqueueSonicAnalysis(entry.id);
}

export function ensureSonicAnalysisForEnvelope(envelope: MediaEnvelope): void {
  const key = lockerTrackKeyFromEnvelope(envelope);
  if (key) enqueueSonicAnalysis(key);
}

/** Queue analysis for locker entries missing analyzed features (cap per call). */
export function enqueueMissingSonicAnalysis(limit = 12): void {
  const entries = import('./lockerStorage')
    .then((m) => m.getLockerEntries())
    .then((list) => {
      let n = 0;
      for (const entry of list) {
        if (n >= limit) break;
        const existing = getSonicFeaturesForTrack(entry.id);
        if (existing?.source === 'analyzed') continue;
        enqueueSonicAnalysis(entry.id);
        n++;
      }
    })
    .catch(() => undefined);
  void entries;
}

/** Re-queue locker tracks that only have tier34 stub features once the server is online. */
export function retryTier34StubAnalysis(): void {
  void import('./lockerStorage')
    .then((locker) => locker.getLockerEntries())
    .then((entries) => {
      for (const entry of entries) {
        const existing = getSonicFeaturesForTrack(entry.id);
        if (existing?.source === 'tier34-stub') enqueueSonicAnalysis(entry.id);
      }
    })
    .catch(() => undefined);
}

if (typeof window !== 'undefined') {
  let prevTier34Ok: boolean | null = null;
  const pollTier34StubRetry = () => {
    void tier34HealthOk().then((ok) => {
      if (prevTier34Ok === false && ok) retryTier34StubAnalysis();
      prevTier34Ok = ok;
    });
  };
  pollTier34StubRetry();
  window.addEventListener('online', pollTier34StubRetry);
  window.setInterval(pollTier34StubRetry, OFFLINE_STATUS_POLL_MS);
}
