/**
 * Reclaim wasted device storage: garbage-collect orphaned locker audio blobs
 * (leftovers from the old re-download loop) and redundant IndexedDB audio copies
 * for tracks that already have a durable native file.
 *
 * SAFETY MODEL — a file/blob is only removed when it is provably unreferenced:
 *  - native `locker_blobs/{id}.*`: removed only when {id} matches no locker track.
 *  - IndexedDB `track_blobs`: audio removed only for tracks that have a durable
 *    native `content://` copy (redundant) or match no track at all (orphan).
 *  - Both layers refuse to delete when the keep-set is empty (index not loaded).
 */
import { Capacitor } from '@capacitor/core';
import { NativeExoPlayback } from './androidNativePlayback';
import type { LockerEntry } from './lockerStorage';
import {
  getLockerEntriesSnapshot,
  pruneTrackBlobs,
  refreshLockerCache,
  type TrackBlobPruneResult,
} from './lockerStorage';

export interface StorageReclaimPreview {
  nativeOrphanCount: number;
  nativeOrphanBytes: number;
  idbReclaimCount: number;
  idbReclaimBytes: number;
  totalBytes: number;
}

export interface StorageReclaimResult {
  nativeDeleted: number;
  nativeFreedBytes: number;
  idbDeleted: number;
  idbFreedBytes: number;
  totalFreedBytes: number;
}

function isNative(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/** Mirror of the native LockerBlobRegistry.sanitizeId so ids match filenames. */
function sanitizeBlobId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Basenames of every durable native locker blob file that actually exists. */
async function nativeBlobIdSet(): Promise<Set<string>> {
  if (!isNative()) return new Set();
  try {
    const res = await NativeExoPlayback.listLockerBlobs();
    return new Set(res.ids ?? []);
  } catch {
    return new Set();
  }
}

/** Every id that references a native locker blob (keep-set for the native GC). */
function referencedNativeIds(entries: LockerEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.id) ids.add(entry.id);
    const match = /\/locker\/([^/?#]+)$/i.exec(entry.url ?? '');
    if (match?.[1]) {
      try {
        ids.add(decodeURIComponent(match[1]));
      } catch {
        ids.add(match[1]);
      }
    }
  }
  return [...ids];
}

/**
 * Track ids whose IndexedDB audio must be KEPT: those WITHOUT a durable native
 * blob file on disk (IndexedDB is their only offline audio). Tracks that already
 * have a native file — the common case — have their redundant IDB copy reclaimed.
 */
function idbKeepIds(entries: LockerEntry[], nativeIds: Set<string>): Set<string> {
  const keep = new Set<string>();
  for (const entry of entries) {
    if (!entry.id) continue;
    if (!nativeIds.has(sanitizeBlobId(entry.id))) keep.add(entry.id);
  }
  return keep;
}

function currentEntries(entries?: LockerEntry[]): LockerEntry[] {
  return entries ?? getLockerEntriesSnapshot() ?? [];
}

/** Non-destructive: report how much orphaned/redundant storage can be freed. */
export async function previewStorageReclaim(
  entries?: LockerEntry[],
): Promise<StorageReclaimPreview> {
  const list = currentEntries(entries);
  let nativeOrphanCount = 0;
  let nativeOrphanBytes = 0;
  let idbReclaimCount = 0;
  let idbReclaimBytes = 0;

  if (isNative()) {
    try {
      const native = await NativeExoPlayback.pruneLockerBlobs({
        keepIds: referencedNativeIds(list),
        dryRun: true,
      });
      nativeOrphanCount = native.deletedCount;
      nativeOrphanBytes = native.freedBytes;
    } catch {
      /* preview only — ignore */
    }
  }

  try {
    const nativeIds = await nativeBlobIdSet();
    const keep = idbKeepIds(list, nativeIds);
    const idb: TrackBlobPruneResult = await pruneTrackBlobs(keep, { dryRun: true });
    idbReclaimCount = idb.deleted;
    idbReclaimBytes = idb.freedBytes;
    console.info(
      `[storageReclaim] preview: entries=${list.length} nativeFiles=${nativeIds.size} ` +
        `idbKeep=${keep.size} idbTotal=${idb.total} idbReclaim=${idb.deleted} ` +
        `idbBytes=${idb.freedBytes} nativeOrphans=${nativeOrphanCount} nativeOrphanBytes=${nativeOrphanBytes}`,
    );
  } catch (err) {
    console.warn('[storageReclaim] preview failed', err);
  }

  return {
    nativeOrphanCount,
    nativeOrphanBytes,
    idbReclaimCount,
    idbReclaimBytes,
    totalBytes: nativeOrphanBytes + idbReclaimBytes,
  };
}

/**
 * Destructive reclaim. `mode: 'orphans'` frees only unambiguously-safe native
 * orphans (used by the on-launch auto-clean). `mode: 'full'` also drops
 * redundant IndexedDB audio copies (the manual, previewed button).
 */
export async function runStorageReclaim(
  options: { mode?: 'orphans' | 'full'; entries?: LockerEntry[] } = {},
): Promise<StorageReclaimResult> {
  const { mode = 'orphans' } = options;
  const list = currentEntries(options.entries);
  const result: StorageReclaimResult = {
    nativeDeleted: 0,
    nativeFreedBytes: 0,
    idbDeleted: 0,
    idbFreedBytes: 0,
    totalFreedBytes: 0,
  };

  const keepNative = referencedNativeIds(list);
  // Guard: never delete against an empty index (not loaded / catastrophic).
  if (keepNative.length === 0 && list.length === 0) return result;

  if (isNative()) {
    try {
      const native = await NativeExoPlayback.pruneLockerBlobs({
        keepIds: keepNative,
        dryRun: false,
      });
      console.info(
        `[storageReclaim] native prune: entries=${list.length} keep=${keepNative.length} ` +
          `deleted=${native.deletedCount} freed=${native.freedBytes} ` +
          `kept=${native.keptCount} total=${native.totalCount} refusedEmpty=${native.refusedEmptyKeep}`,
      );
      if (!native.refusedEmptyKeep) {
        result.nativeDeleted = native.deletedCount;
        result.nativeFreedBytes = native.freedBytes;
      }
    } catch (err) {
      console.warn('[storageReclaim] native prune failed', err);
    }
  }

  if (mode === 'full') {
    try {
      const nativeIds = await nativeBlobIdSet();
      // list is non-empty here (guarded above), so an empty keep-set genuinely
      // means "every track has a native copy" — allow the full IDB prune.
      const idb = await pruneTrackBlobs(idbKeepIds(list, nativeIds), {
        dryRun: false,
        allowEmptyKeep: list.length > 0,
      });
      console.info(
        `[storageReclaim] idb prune: deleted=${idb.deleted} freed=${idb.freedBytes} ` +
          `refusedEmpty=${idb.refusedEmptyKeep}`,
      );
      if (!idb.refusedEmptyKeep) {
        result.idbDeleted = idb.deleted;
        result.idbFreedBytes = idb.freedBytes;
      }
    } catch (err) {
      console.warn('[storageReclaim] idb prune failed', err);
    }
  }

  result.totalFreedBytes = result.nativeFreedBytes + result.idbFreedBytes;
  if (result.totalFreedBytes > 0) await refreshLockerCache();
  return result;
}

let autoCleanRan = false;

/**
 * One-shot background reclaim, safe to call on launch. Frees orphaned native
 * blobs AND redundant IndexedDB audio copies — every such copy is backed by a
 * durable native file that Android playback prefers (see
 * healLockerEntryNativePlayback), and album art is preserved. Waits until the
 * locker index has loaded so the keep-set is complete.
 */
export async function autoCleanOrphanBlobsOnce(): Promise<void> {
  if (autoCleanRan || !isNative()) return;
  const list = getLockerEntriesSnapshot() ?? [];
  console.info(`[storageReclaim] autoClean check: snapshot=${list.length}`);
  if (list.length === 0) return; // index not ready — try again on a later call
  autoCleanRan = true;
  try {
    const result = await runStorageReclaim({ mode: 'full', entries: list });
    console.info('[storageReclaim] auto full reclaim', JSON.stringify(result));
  } catch (e) {
    console.warn('[storageReclaim] auto reclaim failed', e);
  }
}
