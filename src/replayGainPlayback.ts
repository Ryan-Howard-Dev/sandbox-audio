/**
 * ReplayGain consumption at playback time (read-only; ingest lives in lockerStorage).
 */

import type { MediaEnvelope } from './sandboxLayer1';

const LOCKER_DB_NAME = 'SandboxMusicCoreDB';
const LOCKER_STORE_NAME = 'tracks';

/** EBU R128 streaming target used as loudness-normalization proxy. */
export const EBU_TARGET_LUFS = -14;

/** Applied when track metadata has no ReplayGain / peak estimate (0 dB placeholder). */
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

function openLockerDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCKER_DB_NAME, 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Read replayGainDb from locker IndexedDB row without touching lockerStorage. */
export async function lookupLockerReplayGainDb(entryId: string): Promise<number | null> {
  if (!entryId?.trim()) return null;
  try {
    const db = await openLockerDb();
    const row = await new Promise<{ replayGainDb?: number | null } | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(LOCKER_STORE_NAME, 'readonly');
        const req = tx.objectStore(LOCKER_STORE_NAME).get(entryId);
        req.onsuccess = () => resolve(req.result as { replayGainDb?: number | null } | undefined);
        req.onerror = () => reject(req.error);
      },
    );
    db.close();
    if (typeof row?.replayGainDb === 'number' && Number.isFinite(row.replayGainDb)) {
      return row.replayGainDb;
    }
    return null;
  } catch {
    return null;
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
