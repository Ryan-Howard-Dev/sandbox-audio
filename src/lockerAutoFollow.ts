/**
 * Auto-follow artists discovered in the locker library.
 * Triggered on app load and locker cache refresh/sync.
 */

import { isAirGapEnabled } from './airGapMode';
import {
  artistIdFromEntry,
  normalizeIdentityKey,
} from './collectionIntelligence';
import {
  followArtist,
  getFollowedArtists,
  isFollowingArtist,
  isUnfollowedArtist,
  updateFollowedArtistMbId,
} from './followedArtists';
import { loadLockerAutoFollowEnabled } from './lockerAutoFollowSettings';
import {
  getLockerEntriesSnapshot,
  primaryLockerArtist,
  subscribeLockerCache,
  type LockerEntry,
} from './lockerStorage';
import { resolveArtistMusicBrainzId } from './searchCatalog';

const SKIP_ARTIST_RE =
  /^(various artists?|unknown artist|local upload|sandbox artist|uploaded|local device locker|untitled)$/i;

const MB_RESOLVE_DELAY_MS = 350;
const SYNC_DEBOUNCE_MS = 600;

export type LockerArtistCandidate = {
  name: string;
  key: string;
  musicbrainzArtistId?: string;
};

function isCompilationAlbumArtist(name: string): boolean {
  return /^various\b/i.test(name.trim());
}

function isFollowableArtistName(name: string): boolean {
  const n = name.trim();
  if (!n || n.length <= 2) return false;
  if (SKIP_ARTIST_RE.test(n)) return false;
  return true;
}

function resolveArtistForAutoFollow(entry: LockerEntry): LockerArtistCandidate | null {
  const albumArtist = entry.albumArtist?.trim() ?? '';
  const trackArtist = (entry.artist ?? '').trim();
  const mbId = artistIdFromEntry(entry) ?? undefined;

  let name: string | null = null;

  if (
    albumArtist &&
    isFollowableArtistName(albumArtist) &&
    !isCompilationAlbumArtist(albumArtist)
  ) {
    name = albumArtist;
  } else {
    const primary = primaryLockerArtist(trackArtist);
    if (primary && isFollowableArtistName(primary)) {
      name = primary;
    }
  }

  if (!name) return null;

  return {
    name,
    key: normalizeIdentityKey(name),
    musicbrainzArtistId: mbId,
  };
}

/** Distinct followable artists from locker entries (deduped by normalized name). */
export function extractLockerArtistCandidates(entries: LockerEntry[]): LockerArtistCandidate[] {
  const map = new Map<string, LockerArtistCandidate>();

  for (const entry of entries) {
    const candidate = resolveArtistForAutoFollow(entry);
    if (!candidate) continue;
    const existing = map.get(candidate.key);
    if (existing) {
      if (!existing.musicbrainzArtistId && candidate.musicbrainzArtistId) {
        map.set(candidate.key, {
          ...existing,
          musicbrainzArtistId: candidate.musicbrainzArtistId,
        });
      }
      continue;
    }
    map.set(candidate.key, candidate);
  }

  return [...map.values()];
}

async function resolveMissingMusicBrainzIds(): Promise<void> {
  if (isAirGapEnabled()) return;

  const pending = getFollowedArtists().filter(
    (a) => a.source === 'locker' && !a.musicbrainzArtistId,
  );
  for (const artist of pending) {
    const mbId = await resolveArtistMusicBrainzId(artist.name);
    if (mbId) updateFollowedArtistMbId(artist.name, mbId);
    await new Promise((r) => setTimeout(r, MB_RESOLVE_DELAY_MS));
  }
}

/** Sync locker artists into the followed list when auto-follow is enabled. */
export async function syncLockerAutoFollow(
  entries?: LockerEntry[],
): Promise<number> {
  if (!loadLockerAutoFollowEnabled()) return 0;

  const list = entries ?? getLockerEntriesSnapshot() ?? [];
  if (list.length === 0) return 0;

  const candidates = extractLockerArtistCandidates(list);
  let added = 0;

  for (const candidate of candidates) {
    if (isUnfollowedArtist(candidate.name)) continue;
    if (isFollowingArtist(candidate.name)) continue;
    await followArtist({
      name: candidate.name,
      musicbrainzArtistId: candidate.musicbrainzArtistId,
      source: 'locker',
      skipMbLookup: true,
    });
    added += 1;
  }

  if (added > 0 || candidates.length > 0) {
    void resolveMissingMusicBrainzIds();
  }

  return added;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight: Promise<number> | null = null;

function scheduleLockerAutoFollowSync(entries?: LockerEntry[]): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    if (!syncInFlight) {
      syncInFlight = syncLockerAutoFollow(entries).finally(() => {
        syncInFlight = null;
      });
    }
  }, SYNC_DEBOUNCE_MS);
}

/** Subscribe to locker changes and run an initial sync. Returns cleanup. */
export function initLockerAutoFollow(): () => void {
  const run = () => {
    const snap = getLockerEntriesSnapshot();
    if (snap) scheduleLockerAutoFollowSync(snap);
  };

  run();
  const unsub = subscribeLockerCache(run);

  return () => {
    unsub();
    if (syncTimer) clearTimeout(syncTimer);
  };
}
