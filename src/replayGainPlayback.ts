/**
 * ReplayGain consumption at playback time (read-only; ingest lives in lockerStorage).
 */

import type { MediaEnvelope } from './sandboxLayer1';

const LOCKER_DB_NAME = 'SandboxMusicCoreDB';
const LOCKER_STORE_NAME = 'tracks';

/** EBU R128 streaming target used as loudness-normalization proxy. */
export const EBU_TARGET_LUFS = -14;

/**
 * Deliberate, not a placeholder: applied when a track carries no gain at all.
 *
 * Untagged files land here — anything imported before the ingest fix, anything over the 6 MB
 * analysis cap, and anything imported where AudioContext was unavailable. Most such files are
 * mastered louder than -14 LUFS, so a small flat cut is closer to right than unity and keeps
 * them from jumping out against measured tracks. It is a compromise for unknown loudness, and
 * re-importing a file replaces it with a real measurement.
 */
export const FALLBACK_LUFS_GAIN_DB = -4;

export function replayGainMultiplier(replayGainDb: number): number {
  return Math.pow(10, replayGainDb / 20);
}

/** ReplayGain tag when present; otherwise conservative -14 LUFS proxy gain. */
export function computePlaybackGainDb(replayGainDb: number): number {
  const normalized = normalizeReplayGainDb(replayGainDb);
  if (normalized !== 0) return normalized;
  return FALLBACK_LUFS_GAIN_DB;
}

export function normalizeReplayGainDb(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return 0;
}

/**
 * Opened WITHOUT a version on purpose.
 *
 * This pinned version 2 while lockerStorage owns the same database at version 3. Opening an
 * existing v3 database with a lower version throws VersionError, and the catch in
 * lookupLockerReplayGainDb swallowed it — so every lookup silently returned null and playback
 * fell back to the placeholder gain. ReplayGain never worked on an upgraded locker, and it
 * failed quietly enough that nothing reported it.
 *
 * A read-only consumer has no business declaring the schema version. Omitting it opens
 * whatever exists, which is both correct and immune to drift when lockerStorage next
 * migrates. Schema ownership stays with lockerStorage.
 */
function openLockerDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCKER_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Read the locker row's loudness gain without touching lockerStorage.
 *
 * Reads `trackGainDb`, not the legacy `replayGainDb`: that column stored peak dBFS under a
 * misleading name, and consuming it applied normalization backwards. Rows predating the ingest
 * fix have no `trackGainDb` and correctly resolve to null.
 */
export async function lookupLockerReplayGainDb(entryId: string): Promise<number | null> {
  if (!entryId?.trim()) return null;
  try {
    const db = await openLockerDb();
    const row = await new Promise<{ trackGainDb?: number | null } | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(LOCKER_STORE_NAME, 'readonly');
        const req = tx.objectStore(LOCKER_STORE_NAME).get(entryId);
        req.onsuccess = () => resolve(req.result as { trackGainDb?: number | null } | undefined);
        req.onerror = () => reject(req.error);
      },
    );
    db.close();
    if (typeof row?.trackGainDb === 'number' && Number.isFinite(row.trackGainDb)) {
      return row.trackGainDb;
    }
    return null;
  } catch (err) {
    // Returning null is right for playback — a missing gain must never stop audio. But swallowing
    // the reason is what let D-1 (a VersionError on every single lookup) hide for months. Report
    // it; a caller that wants silence can ignore the channel, not the failure.
    reportReplayGainLookupFailure(entryId, err);
    return null;
  }
}

export type ReplayGainLookupFailure = { entryId: string; error: unknown };

const lookupFailureListeners = new Set<(failure: ReplayGainLookupFailure) => void>();

/** Subscribe to locker gain lookup failures (diagnostics panel, tests). */
export function onReplayGainLookupFailure(
  listener: (failure: ReplayGainLookupFailure) => void,
): () => void {
  lookupFailureListeners.add(listener);
  return () => lookupFailureListeners.delete(listener);
}

function reportReplayGainLookupFailure(entryId: string, error: unknown): void {
  for (const listener of lookupFailureListeners) {
    try {
      listener({ entryId, error });
    } catch {
      /* a broken diagnostics listener must not break playback */
    }
  }
  if (typeof console !== 'undefined') {
    console.warn('[replayGain] locker gain lookup failed', { entryId, error });
  }
}

/** Resolve replayGainDb for an envelope; missing metadata → 0 dB. */
export async function resolveEnvelopeReplayGainDb(env: MediaEnvelope): Promise<number> {
  if (env.replayGainDb != null && Number.isFinite(env.replayGainDb)) {
    return env.replayGainDb;
  }
  if (env.provider === 'local-vault' && env.sourceId) {
    const fromDb = await lookupLockerReplayGainDb(env.sourceId);
    if (fromDb != null) return fromDb;
  }
  return 0;
}
