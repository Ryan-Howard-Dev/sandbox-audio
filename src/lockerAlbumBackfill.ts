/**
 * Repair locker rows missing albumName using recent album download jobs.
 */

import { getDownloadJobs } from './downloadQueue';
import { clearLastFmArtistImageCache } from './artistImage';
import { isOrphanLockerTrack } from './collectionIntelligence';
import {
  findAlbumCover,
  findAlbumCoverForLockerGroup,
  shouldReconcileLockerCoverWithMusicBrainz,
  musicbrainzReleaseIdFromCredits,
} from './albumCover';
import {
  albumGroupHasPersistedCover,
  clearLastFmBrandingAlbumArt,
  formatAlbumDisplayName,
  getLockerEntries,
  lockerAlbumArtistConsensus,
  lockerAlbumGroupArtist,
  lockerAlbumGroupKey,
  mergeKnownSplitAlbumGroups,
  normalizeAlbumGroupArtists,
  normalizeLockerKeyPart,
  persistAlbumCoverForGroup,
  resolveAlbumSearchArtist,
  tracksForAlbumGroup,
  updateLockerEntryMetadata,
  type LockerEntry,
} from './lockerStorage';

export async function backfillOrphanTracksFromDownloadJobs(): Promise<number> {
  const albumJobs = getDownloadJobs().filter(
    (j) => j.mode === 'album' && j.albumTitle?.trim(),
  );
  if (albumJobs.length === 0) return 0;

  const entries = await getLockerEntries();
  const orphans = entries.filter(isOrphanLockerTrack);
  if (orphans.length === 0) return 0;

  let updated = 0;
  for (const job of albumJobs) {
    const albumTitle = job.albumTitle!.trim();
    const albumArtist = job.artist?.trim() || undefined;
    const jobStart = job.startedAt ?? 0;
    const jobEnd = jobStart + 6 * 60 * 60 * 1000;

    for (const entry of orphans) {
      if (entry.albumName?.trim()) continue;
      if (entry.addedAt < jobStart - 60_000 || entry.addedAt > jobEnd) continue;
      if (!artistMatchesJob(entry, job.artist)) continue;

      await updateLockerEntryMetadata(entry.id, {
        albumName: albumTitle,
        albumArtist,
      });
      entry.albumName = albumTitle;
      entry.albumArtist = albumArtist;
      updated += 1;
    }
  }

  return updated;
}

/** Fetch and persist album cover after a catalog album download (or when tracks already exist). */
export async function ensureDownloadedAlbumCover(options: {
  albumName: string;
  albumArtist?: string;
  artworkUrl?: string;
  releaseYear?: string;
}): Promise<boolean> {
  const albumName = options.albumName.trim();
  if (!albumName) return false;

  const entries = await getLockerEntries();
  const normAlbum = normalizeLockerKeyPart(albumName);
  const groupTracks = entries.filter(
    (e) => e.albumName?.trim() && normalizeLockerKeyPart(e.albumName) === normAlbum,
  );
  if (groupTracks.length === 0) return false;
  if (await albumGroupHasPersistedCover(groupTracks)) return true;

  const artist =
    lockerAlbumArtistConsensus(groupTracks) ||
    options.albumArtist?.trim() ||
    groupTracks[0]?.artist?.trim() ||
    'Local Upload';

  const artUrl = options.artworkUrl?.trim();
  const cover = artUrl
    ? { url: artUrl, source: 'catalog' as const, year: options.releaseYear }
    : await findAlbumCoverForLockerGroup(albumName, artist, groupTracks);

  if (!cover?.url) return false;

  return persistAlbumCoverForGroup(albumName, artist, cover.url, {
    artist,
    releaseYear: cover.year ?? options.releaseYear,
  });
}

/** Fetch and persist missing album covers from catalog artwork search. */
export async function backfillMissingAlbumCovers(): Promise<number> {
  const entries = await getLockerEntries();
  const groups = new Map<
    string,
    { albumName: string; artist: string; tracks: LockerEntry[] }
  >();

  for (const entry of entries) {
    const key = lockerAlbumGroupKey(entry);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.tracks.push(entry);
      continue;
    }
    groups.set(key, {
      albumName: entry.albumName!.trim(),
      artist: lockerAlbumArtistConsensus([entry]),
      tracks: [entry],
    });
  }

  let fixed = 0;
  for (const group of groups.values()) {
    if (await albumGroupHasPersistedCover(group.tracks)) continue;
    const ok = await backfillLockerAlbumArt(group.albumName, group.artist);
    if (ok) fixed += 1;
  }
  return fixed;
}

/** Fetch cover online and persist albumArtBlob + artUrl on every track in the album group. */
export async function backfillLockerAlbumArt(
  albumName: string,
  artist = '',
): Promise<boolean> {
  const trimmedAlbum = albumName.trim();
  if (!trimmedAlbum) return false;

  const entries = await getLockerEntries();
  const normAlbum = normalizeLockerKeyPart(trimmedAlbum);
  let tracks = tracksForAlbumGroup(entries, trimmedAlbum, artist);
  if (tracks.length === 0) {
    tracks = entries.filter(
      (e) => e.albumName?.trim() && normalizeLockerKeyPart(e.albumName) === normAlbum,
    );
  }
  if (tracks.length === 0) return false;
  if (await albumGroupHasPersistedCover(tracks)) return true;

  const canonicalName = tracks[0].albumName?.trim() || trimmedAlbum;
  const groupArtist =
    resolveAlbumSearchArtist(canonicalName, artist, tracks) ||
    lockerAlbumArtistConsensus(tracks) ||
    artist.trim() ||
    'Local Upload';
  const searchAlbum = formatAlbumDisplayName(canonicalName) || canonicalName;

  try {
    const found = await findAlbumCoverForLockerGroup(searchAlbum, groupArtist, tracks);
    if (!found?.url) return false;
    return persistAlbumCoverForGroup(canonicalName, groupArtist, found.url, {
      artist: groupArtist,
      releaseYear: found.year,
    });
  } catch {
    return false;
  }
}

/** Replace wrong iTunes title-collisions with Cover Art Archive art when MB release id is known. */
export async function repairAlbumCoversFromMusicBrainzCredits(): Promise<number> {
  const entries = await getLockerEntries();
  const groups = new Map<
    string,
    { albumName: string; artist: string; tracks: LockerEntry[] }
  >();

  for (const entry of entries) {
    const key = lockerAlbumGroupKey(entry);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.tracks.push(entry);
      continue;
    }
    groups.set(key, {
      albumName: entry.albumName!.trim(),
      artist: lockerAlbumArtistConsensus([entry]),
      tracks: [entry],
    });
  }

  let fixed = 0;
  for (const group of groups.values()) {
    const releaseId = group.tracks
      .map((t) => musicbrainzReleaseIdFromCredits(t.creditsJson))
      .find(Boolean);
    if (!releaseId) continue;

    const currentArt = group.tracks.find((t) => t.albumArt?.trim())?.albumArt;
    if (!shouldReconcileLockerCoverWithMusicBrainz(currentArt, releaseId)) continue;

    const artist = lockerAlbumArtistConsensus(group.tracks) || group.artist;
    const found = await findAlbumCoverForLockerGroup(group.albumName, artist, group.tracks);
    if (!found?.url) continue;

    const ok = await persistAlbumCoverForGroup(group.albumName, artist, found.url, {
      artist,
      releaseYear: found.year ?? group.tracks.find((t) => t.releaseYear)?.releaseYear,
    });
    if (ok) fixed += 1;
  }
  return fixed;
}

/** Run all locker album metadata + artwork repairs. */
export async function repairLockerAlbumGrouping(): Promise<boolean> {
  const orphans = await backfillOrphanTracksFromDownloadJobs();
  const merged = await mergeKnownSplitAlbumGroups();
  const normalized = await normalizeAlbumGroupArtists();
  const clearedLastFm = await clearLastFmBrandingAlbumArt();
  const clearedArtistLastFm = clearLastFmArtistImageCache();
  const reconciled = await repairAlbumCoversFromMusicBrainzCredits();
  const covers = await backfillMissingAlbumCovers();
  return (
    orphans > 0 ||
    merged > 0 ||
    normalized > 0 ||
    clearedLastFm > 0 ||
    clearedArtistLastFm > 0 ||
    reconciled > 0 ||
    covers > 0
  );
}

function artistMatchesJob(entry: LockerEntry, jobArtist: string): boolean {
  const jobKey = normalizeArtist(jobArtist);
  if (!jobKey) return true;
  const line = lockerAlbumGroupArtist(entry);
  const entryKey = normalizeArtist(line);
  if (!entryKey) return true;
  return entryKey === jobKey || entryKey.includes(jobKey) || jobKey.includes(entryKey);
}

function normalizeArtist(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(',')[0]
    ?.trim() ?? '';
}
