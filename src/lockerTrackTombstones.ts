/**
 * Cross-device locker track delete tombstones (Phase 3).
 * Mirrors playlist tombstones in playlistStorage.ts.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';

export type TrackTombstone = {
  id: string;
  deletedAt: number;
};

export const TRACK_TOMBSTONE_KEY = 'sandbox_locker_track_tombstones';
export const TRACKS_SYNC_DIRTY_EVENT = 'sandbox-locker-tracks-sync-dirty';

export function loadTrackTombstones(): TrackTombstone[] {
  try {
    const raw = prefsGetItem(TRACK_TOMBSTONE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrackTombstone[];
    return Array.isArray(parsed)
      ? parsed.filter((t) => t?.id && typeof t.deletedAt === 'number')
      : [];
  } catch {
    return [];
  }
}

function saveTrackTombstones(tombstones: TrackTombstone[]): void {
  prefsSetItem(TRACK_TOMBSTONE_KEY, JSON.stringify(tombstones));
}

/** Record a deleted track id for cross-device replication. */
export function recordTrackTombstone(id: string, deletedAt = Date.now()): void {
  if (!id?.trim()) return;
  const tombstones = loadTrackTombstones();
  const existing = tombstones.find((t) => t.id === id);
  if (existing) {
    existing.deletedAt = Math.max(existing.deletedAt, deletedAt);
  } else {
    tombstones.push({ id, deletedAt });
  }
  saveTrackTombstones(tombstones);
  window.dispatchEvent(new Event(TRACKS_SYNC_DIRTY_EVENT));
}

export function clearTrackTombstone(id: string): void {
  const next = loadTrackTombstones().filter((t) => t.id !== id);
  saveTrackTombstones(next);
}
