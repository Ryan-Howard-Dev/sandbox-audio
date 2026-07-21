/**
 * Collapse duplicate locker rows — one row per envelope or release-group identity.
 */

import type { LockerEntry } from './lockerStorage';
import { compareLockerTrackOrder } from './lockerTrackOrder';

export type EnvelopeTrackGroup = {
  key: string;
  envelopeId: string;
  primary: LockerEntry;
  entries: LockerEntry[];
};

function normalizeToken(value: string): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function trackIdentityKey(title: string, artist: string): string {
  return `${normalizeToken(title)}::${normalizeToken(artist || 'local upload')}`;
}

/** Prefer playable copies when collapsing duplicates — matches dedupeLockerEntriesForDisplay. */
export function pickEnvelopeGroupPrimary(entries: LockerEntry[]): LockerEntry {
  const playable = entries.filter((e) => e.offlineReady === true);
  const pool = playable.length > 0 ? playable : entries;
  return [...pool].sort((a, b) => {
    const durationDelta = (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0);
    if (durationDelta !== 0) return durationDelta;
    return b.addedAt - a.addedAt;
  })[0]!;
}

/** Read musicbrainzReleaseGroupId from creditsJson when present. */
export function releaseGroupIdFromEntry(entry: LockerEntry): string | null {
  if (!entry.creditsJson?.trim()) return null;
  try {
    const parsed = JSON.parse(entry.creditsJson) as { musicbrainzReleaseGroupId?: string };
    const id = parsed.musicbrainzReleaseGroupId?.trim();
    return id || null;
  } catch {
    return null;
  }
}

export type EnvelopeMetaRow = {
  envelopeId: string;
  musicbrainzReleaseGroupId?: string;
  contentHash?: string;
};

/**
 * Group tracks within an album (or flat list) by envelope_id or release group + title.
 * Duplicate blobs / remaster copies collapse to a single representative row.
 */
export function groupTracksByEnvelope(
  tracks: LockerEntry[],
  metaByEnvelopeId?: Map<string, EnvelopeMetaRow>,
): EnvelopeTrackGroup[] {
  const groups = new Map<string, EnvelopeTrackGroup>();

  for (const entry of tracks) {
    const meta = metaByEnvelopeId?.get(entry.id);
    const releaseGroupId =
      meta?.musicbrainzReleaseGroupId?.trim() || releaseGroupIdFromEntry(entry);
    const identity = trackIdentityKey(entry.title, entry.artist);

    const groupKey = releaseGroupId
      ? `rg:${releaseGroupId}::${identity}`
      : identity;

    const existing = groups.get(groupKey);
    if (existing) {
      existing.entries.push(entry);
      existing.primary = pickEnvelopeGroupPrimary(existing.entries);
    } else {
      groups.set(groupKey, {
        key: groupKey,
        envelopeId: entry.id,
        primary: entry,
        entries: [entry],
      });
    }
  }

  return [...groups.values()].sort((a, b) => compareLockerTrackOrder(a.primary, b.primary));
}
