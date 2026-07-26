/**
 * Durable offline library — integrity manifest, boot verification, native storage audit.
 * Metadata rows are never deleted when blobs go missing; tracks are marked hollow and re-queued.
 */

import { Capacitor } from '@capacitor/core';
import { NativeExoPlayback } from './nativePluginHandles';
import { isAndroid } from './platformEnv';
import { queueDeadLockerTrackReacquire } from './lockerDeadTrackReacquire';
import {
  auditLockerVaultHealth,
  getLockerAudioBlob,
  getLockerEntriesSnapshot,
  type LockerEntry,
  readLockerEntriesForDurability,
} from './lockerStorage';

const MANIFEST_KEY = 'locker-integrity-manifest-v1';
const MANIFEST_VERSION = 1 as const;

export type LockerIntegrityEntry = {
  id: string;
  blobBytes: number;
  nativePath?: string;
  updatedAt: number;
  /**
   * Set the first time a scan finds no audio anywhere (IDB or native) for an otherwise
   * "playable" row. Only acted on (hollow + re-download) if it's STILL missing on a
   * later, independent scan — a single flaky check (e.g. native bridge congestion) can't
   * nuke a real download; it takes two separate boots agreeing the audio is actually gone.
   */
  suspectedMissingAt?: number;
};

export type LockerIntegrityManifest = {
  version: typeof MANIFEST_VERSION;
  entries: Record<string, LockerIntegrityEntry>;
};

export type NativeLockerStorageAudit = {
  durableBlobCount: number;
  durableBlobBytes: number;
  durableYtdlpCount: number;
  durableYtdlpBytes: number;
  cacheBlobCount: number;
  cacheBlobBytes: number;
  cacheYtdlpCount: number;
  cacheYtdlpBytes: number;
  migrationRan: boolean;
};

export type OfflineLibraryDurabilityReport = {
  trackRows: number;
  playableTracks: number;
  healableTracks: number;
  metadataOnlyTracks: number;
  idbBlobBytes: number;
  native: NativeLockerStorageAudit | null;
  integrityVerified: number;
  markedHollow: number;
  reacquireQueued: number;
};

function loadManifest(): LockerIntegrityManifest {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    if (!raw) return { version: MANIFEST_VERSION, entries: {} };
    const parsed = JSON.parse(raw) as LockerIntegrityManifest;
    if (parsed?.version !== MANIFEST_VERSION || !parsed.entries) {
      return { version: MANIFEST_VERSION, entries: {} };
    }
    return parsed;
  } catch {
    return { version: MANIFEST_VERSION, entries: {} };
  }
}

function saveManifest(manifest: LockerIntegrityManifest): void {
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  } catch {
    /* quota — non-fatal */
  }
}

/** Update manifest after a successful blob write or native import. */
export async function recordLockerIntegrityEntry(
  id: string,
  options?: { nativePath?: string },
): Promise<void> {
  const trackId = id.trim();
  if (!trackId) return;
  const blob = await getLockerAudioBlob(trackId);
  const manifest = loadManifest();
  manifest.entries[trackId] = {
    id: trackId,
    blobBytes: blob?.size ?? 0,
    nativePath: options?.nativePath?.trim() || manifest.entries[trackId]?.nativePath,
    updatedAt: Date.now(),
  };
  saveManifest(manifest);
}

export function removeLockerIntegrityEntry(id: string): void {
  const manifest = loadManifest();
  delete manifest.entries[id.trim()];
  saveManifest(manifest);
}

export function clearLockerIntegrityManifest(): void {
  try {
    localStorage.removeItem(MANIFEST_KEY);
  } catch {
    /* ignore */
  }
}

export async function auditNativeLockerStorage(): Promise<NativeLockerStorageAudit | null> {
  if (!isAndroid() || Capacitor.getPlatform() !== 'android') return null;
  try {
    const result = await NativeExoPlayback.auditLockerStorage();
    return {
      durableBlobCount: result.durableBlobCount ?? 0,
      durableBlobBytes: result.durableBlobBytes ?? 0,
      durableYtdlpCount: result.durableYtdlpCount ?? 0,
      durableYtdlpBytes: result.durableYtdlpBytes ?? 0,
      cacheBlobCount: result.cacheBlobCount ?? 0,
      cacheBlobBytes: result.cacheBlobBytes ?? 0,
      cacheYtdlpCount: result.cacheYtdlpCount ?? 0,
      cacheYtdlpBytes: result.cacheYtdlpBytes ?? 0,
      migrationRan: Boolean(result.migrationRan),
    };
  } catch (err) {
    console.warn('[lockerDurability] native storage audit failed', err);
    return null;
  }
}

async function markLockerRowHollow(id: string): Promise<void> {
  const { markLockerEntryHollow } = await import('./lockerStorage');
  await markLockerEntryHollow(id);
}

/**
 * Boot heal: migrate legacy cache → files, verify manifest vs blobs, mark hollow + queue re-download.
 * Never deletes metadata rows.
 */
export async function verifyLockerIntegrityOnBoot(): Promise<{
  verified: number;
  markedHollow: number;
  reacquireQueued: number;
}> {
  const native = await auditNativeLockerStorage();
  if (native && (native.cacheBlobCount > 0 || native.cacheYtdlpCount > 0)) {
    console.warn('[lockerDurability] legacy cache survivors remain — migration will retry next boot', {
      cacheBlobCount: native.cacheBlobCount,
      cacheYtdlpCount: native.cacheYtdlpCount,
    });
  }

  // This scan can span seconds (it yields to the main thread every 16 rows), during which
  // the user can delete or (re)download tracks. Snapshot-in/merge-out below avoids clobbering
  // those concurrent manifest writes, and the live-cache check avoids re-queuing a re-download
  // for a track the user deleted while the scan was still running.
  const manifestAtStart = loadManifest();
  const rows = await readLockerEntriesForDurability();
  const pendingEntries: Record<string, LockerIntegrityEntry> = {};
  let verified = 0;
  let markedHollow = 0;
  let reacquireQueued = 0;

  const { yieldToMain } = await import('./yieldToMain');
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    if (rowIndex > 0 && rowIndex % 16 === 0) await yieldToMain();
    const id = row.id.trim();
    if (!id) continue;
    const liveEntries = getLockerEntriesSnapshot();
    if (liveEntries && !liveEntries.some((e) => e.id === id)) {
      // Deleted by the user since this scan started — leave it alone.
      continue;
    }
    const blob = await getLockerAudioBlob(id);
    const blobBytes = blob?.size ?? 0;
    const entry = manifestAtStart.entries[id];
    const claimedPlayable =
      row.offlineReady === true ||
      Boolean((row as { hasAudioBlob?: boolean }).hasAudioBlob) ||
      (entry?.blobBytes ?? 0) > 0;

    if (blobBytes > 0) {
      pendingEntries[id] = {
        id,
        blobBytes,
        nativePath: row.nativeSourcePath,
        updatedAt: Date.now(),
      };
      verified += 1;
      continue;
    }

    // getLockerAudioBlob only reads the IndexedDB blob store — tracks whose audio lives in
    // native storage (the normal case on Android) read back 0 bytes here even though the file
    // is safely on disk. Use the authoritative recoverable-audio check, which also accepts a
    // durable nativeSourcePath (files/ytdlp-locker/*.mp4 — where downloaded locker audio
    // actually lives) and the native content:// registry. Without this, natively-stored tracks
    // looked "hollow" every boot and got wastefully re-downloaded ("still re-downloading").
    if (isAndroid()) {
      try {
        const { lockerEntryHasRecoverableAudio } = await import('./lockerStorage');
        if (await lockerEntryHasRecoverableAudio(id)) {
          pendingEntries[id] = {
            id,
            blobBytes: entry?.blobBytes ?? 0,
            nativePath: row.nativeSourcePath,
            updatedAt: Date.now(),
          };
          verified += 1;
          continue;
        }
      } catch {
        /* probe optional — fall through to the claimedPlayable check below */
      }
    }

    if (!claimedPlayable) continue;

    // Metadata says playable but neither IDB nor native storage has the bytes. Don't act on
    // a single scan's word for it — record the suspicion and only hollow + re-download once
    // a LATER, independent scan (a separate boot) still can't find it either.
    if (!entry?.suspectedMissingAt) {
      pendingEntries[id] = {
        id,
        blobBytes: 0,
        nativePath: row.nativeSourcePath,
        updatedAt: entry?.updatedAt ?? Date.now(),
        suspectedMissingAt: Date.now(),
      };
      continue;
    }

    // Metadata says playable but bytes are missing — mark hollow, keep row, queue re-download.
    await markLockerRowHollow(id);
    markedHollow += 1;
    pendingEntries[id] = {
      id,
      blobBytes: 0,
      nativePath: row.nativeSourcePath,
      updatedAt: Date.now(),
    };

    const outcome = await queueDeadLockerTrackReacquire(row.title, row.artist, row.albumName);
    if (outcome === 'queued' || outcome === 'already-active') {
      reacquireQueued += 1;
    }
  }

  const latestManifest = loadManifest();
  for (const [id, pendingEntry] of Object.entries(pendingEntries)) {
    const existedAtStart = id in manifestAtStart.entries;
    const stillExists = id in latestManifest.entries;
    // Only clobber a concurrent write if the id wasn't removed from the manifest
    // (e.g. via a locker delete) while this scan was running.
    if (!existedAtStart || stillExists) {
      latestManifest.entries[id] = pendingEntry;
    }
  }
  saveManifest(latestManifest);

  if (markedHollow > 0 || reacquireQueued > 0) {
    console.info('[lockerDurability] integrity boot verify', {
      verified,
      markedHollow,
      reacquireQueued,
    });
  }

  return { verified, markedHollow, reacquireQueued };
}

/** User-visible durability snapshot for Settings / pre-trip check. */
export async function getOfflineLibraryDurabilityReport(options?: {
  /** Fast path for Settings mount — manifest sum instead of per-blob IDB reads. */
  estimateBlobBytes?: boolean;
}): Promise<OfflineLibraryDurabilityReport> {
  const health = await auditLockerVaultHealth();
  const native = await auditNativeLockerStorage();
  const rows = await readLockerEntriesForDurability();
  let idbBlobBytes = 0;
  if (options?.estimateBlobBytes) {
    const manifest = loadManifest();
    for (const entry of Object.values(manifest.entries)) {
      idbBlobBytes += entry.blobBytes ?? 0;
    }
  } else {
    const { yieldToMain } = await import('./yieldToMain');
    for (let i = 0; i < rows.length; i += 1) {
      if (i > 0 && i % 16 === 0) await yieldToMain();
      const blob = await getLockerAudioBlob(rows[i]!.id);
      if (blob?.size) idbBlobBytes += blob.size;
    }
  }

  return {
    trackRows: health.trackRows,
    playableTracks: health.playableTracks,
    healableTracks: health.healableTracks,
    metadataOnlyTracks: health.metadataOnlyTracks,
    idbBlobBytes,
    native,
    integrityVerified: 0,
    markedHollow: 0,
    reacquireQueued: 0,
  };
}

export function formatDurabilityGb(bytes: number): string {
  if (bytes <= 0) return '0 GB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb < 0.1) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${gb.toFixed(2)} GB`;
}

/** Rebuild manifest from current vault — repair panel / diagnostics only. */
export async function rebuildLockerIntegrityManifest(): Promise<number> {
  const rows = await readLockerEntriesForDurability();
  const manifest: LockerIntegrityManifest = { version: MANIFEST_VERSION, entries: {} };
  let recorded = 0;
  for (const row of rows) {
    const blob = await getLockerAudioBlob(row.id);
    if (!blob || blob.size <= 0) continue;
    manifest.entries[row.id] = {
      id: row.id,
      blobBytes: blob.size,
      nativePath: row.nativeSourcePath,
      updatedAt: Date.now(),
    };
    recorded += 1;
  }
  saveManifest(manifest);
  return recorded;
}

export type LockerDurabilityRow = LockerEntry & {
  hasAudioBlob?: boolean;
  nativeSourcePath?: string;
};
