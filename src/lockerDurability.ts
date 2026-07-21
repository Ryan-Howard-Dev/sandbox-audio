/**
 * Durable offline library — integrity manifest, boot verification, native storage audit.
 * Metadata rows are never deleted when blobs go missing; tracks are marked hollow and re-queued.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { NativeExoPlaybackPlugin } from './androidNativePlayback';
import { isAndroid } from './platformEnv';
import { queueDeadLockerTrackReacquire } from './lockerDeadTrackReacquire';
import {
  auditLockerVaultHealth,
  getLockerAudioBlob,
  type LockerEntry,
  readLockerEntriesForDurability,
} from './lockerStorage';

const NativeExoPlayback = registerPlugin<NativeExoPlaybackPlugin>('NativeExoPlayback');

const MANIFEST_KEY = 'locker-integrity-manifest-v1';
const MANIFEST_VERSION = 1 as const;

export type LockerIntegrityEntry = {
  id: string;
  blobBytes: number;
  nativePath?: string;
  updatedAt: number;
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

  const manifest = loadManifest();
  const rows = await readLockerEntriesForDurability();
  let verified = 0;
  let markedHollow = 0;
  let reacquireQueued = 0;

  for (const row of rows) {
    const id = row.id.trim();
    if (!id) continue;
    const blob = await getLockerAudioBlob(id);
    const blobBytes = blob?.size ?? 0;
    const entry = manifest.entries[id];
    const claimedPlayable =
      row.offlineReady === true ||
      Boolean((row as { hasAudioBlob?: boolean }).hasAudioBlob) ||
      (entry?.blobBytes ?? 0) > 0;

    if (blobBytes > 0) {
      manifest.entries[id] = {
        id,
        blobBytes,
        nativePath: row.nativeSourcePath,
        updatedAt: Date.now(),
      };
      verified += 1;
      continue;
    }

    if (!claimedPlayable) continue;

    // Metadata says playable but bytes are missing — mark hollow, keep row, queue re-download.
    await markLockerRowHollow(id);
    markedHollow += 1;
    manifest.entries[id] = {
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

  saveManifest(manifest);

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
export async function getOfflineLibraryDurabilityReport(): Promise<OfflineLibraryDurabilityReport> {
  const health = await auditLockerVaultHealth();
  const native = await auditNativeLockerStorage();
  const rows = await readLockerEntriesForDurability();
  let idbBlobBytes = 0;
  for (const row of rows) {
    const blob = await getLockerAudioBlob(row.id);
    if (blob?.size) idbBlobBytes += blob.size;
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
