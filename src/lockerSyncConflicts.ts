/**
 * Metadata conflict queue when two devices edit the same locker track.
 */

import type { LockerSyncManifestEntry } from './lockerSync';
import type { LockerEntry } from './lockerStorage';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

export type LockerMetadataConflict = {
  trackId: string;
  localTitle: string;
  localArtist: string;
  localAlbum?: string;
  remoteTitle: string;
  remoteArtist: string;
  remoteAlbum?: string;
  remoteRow: LockerSyncManifestEntry;
  detectedAt: number;
};

export const LOCKER_SYNC_CONFLICTS_KEY = 'sandbox_locker_sync_conflicts';
export const LOCKER_SYNC_CONFLICTS_EVENT = 'sandbox-locker-sync-conflicts';

function loadRaw(): LockerMetadataConflict[] {
  try {
    const raw = prefsGetItem(LOCKER_SYNC_CONFLICTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LockerMetadataConflict[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRaw(conflicts: LockerMetadataConflict[]): void {
  prefsSetItem(LOCKER_SYNC_CONFLICTS_KEY, JSON.stringify(conflicts));
  window.dispatchEvent(new CustomEvent(LOCKER_SYNC_CONFLICTS_EVENT, { detail: conflicts }));
}

export function loadLockerSyncConflicts(): LockerMetadataConflict[] {
  return loadRaw();
}

export function clearLockerSyncConflict(trackId: string): void {
  saveRaw(loadRaw().filter((c) => c.trackId !== trackId));
}

function metadataDiffers(local: LockerEntry, remote: LockerSyncManifestEntry): boolean {
  const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();
  return (
    norm(local.title) !== norm(remote.title) ||
    norm(local.artist) !== norm(remote.artist) ||
    norm(local.albumName) !== norm(remote.albumName)
  );
}

/** Queue a conflict when remote metadata would overwrite a playable local track. */
export function maybeQueueMetadataConflict(
  local: LockerEntry,
  remote: LockerSyncManifestEntry,
): boolean {
  if (local.userMetadataLocked === true) return true;
  if (!local.url?.trim()) return false;
  if (!metadataDiffers(local, remote)) return false;
  if ((remote.addedAt ?? 0) <= (local.addedAt ?? 0)) return false;

  const conflicts = loadRaw().filter((c) => c.trackId !== local.id);
  conflicts.push({
    trackId: local.id,
    localTitle: local.title,
    localArtist: local.artist,
    localAlbum: local.albumName,
    remoteTitle: remote.title,
    remoteArtist: remote.artist,
    remoteAlbum: remote.albumName,
    remoteRow: remote,
    detectedAt: Date.now(),
  });
  saveRaw(conflicts);
  return true;
}

export function dismissAllLockerSyncConflicts(): void {
  saveRaw([]);
}
