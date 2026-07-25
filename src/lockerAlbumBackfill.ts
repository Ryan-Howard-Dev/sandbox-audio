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
  applyArtBlobToEntries,
  clearLastFmBrandingAlbumArt,
  formatAlbumDisplayName,
  getLockerArtBlob,
  getLockerEntries,
  isPersistentAlbumArt,
  listLockerArtBlobIds,
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

  // Derive from the whole group (consensus over all tracks), then fall back to the
  // caller's album artist. A per-track artist here can fail to match the album group
  // later, which silently skips the cover persist.
  const artist =
    lockerAlbumArtistConsensus(groupTracks) ||
    lockerAlbumGroupArtist(groupTracks[0]!, groupTracks) ||
    options.albumArtist?.trim() ||
    groupTracks[0]?.artist?.trim() ||
    'Local Upload';

  const artUrl = options.artworkUrl?.trim();
  const cover = artUrl
    ? { url: artUrl, source: 'catalog' as const, year: options.releaseYear }
    : await findAlbumCoverForLockerGroup(albumName, artist, groupTracks);

  if (!cover?.url) return false;

  const persisted = await persistAlbumCoverForGroup(albumName, artist, cover.url, {
    artist,
    releaseYear: cover.year ?? options.releaseYear,
  });
  if (persisted) return true;

  // The album-artist we guessed did not resolve to the group. Retry with the
  // consensus artist of the tracks we already hold so the cover still lands.
  const fallbackArtist = groupTracks[0]?.albumArtist?.trim() || groupTracks[0]?.artist?.trim();
  if (fallbackArtist && fallbackArtist !== artist) {
    return persistAlbumCoverForGroup(albumName, fallbackArtist, cover.url, {
      artist: fallbackArtist,
      releaseYear: cover.year ?? options.releaseYear,
    });
  }
  return false;
}

/**
 * Copy an album's existing cover onto every track in the same group.
 *
 * Most albums here have durable art on only one or two tracks (e.g. from the embedded
 * cover pass), which made `albumGroupHasPersistedCover` report the whole group as
 * covered — so the fetch heal skipped it while the album's other tracks still rendered
 * blank in Genres/Playlists/album grids. Propagating the art the group already owns
 * fixes those tiles without any network calls.
 */
export async function propagateAlbumArtWithinGroups(): Promise<number> {
  const entries = await getLockerEntries();
  // ONE bulk read of which ids hold art. Probing getLockerArtBlob() per track cost ~600
  // IndexedDB opens on a 300-track library and made opening the locker visibly slow.
  const artIds = await listLockerArtBlobIds();

  /*
   * Skip entirely once the library is essentially covered. This pass exists to repair a
   * historically under-covered locker; re-walking every group on each locker open just to
   * discover there is nothing to do is pure startup cost. Cheap inline count first.
   */
  const covered = entries.reduce(
    (n, e) => n + (artIds.has(e.id) || isPersistentAlbumArt(e.albumArt) ? 1 : 0),
    0,
  );
  if (entries.length > 0 && covered / entries.length >= 0.98) return 0;

  const groups = new Map<string, LockerEntry[]>();
  for (const entry of entries) {
    const key = lockerAlbumGroupKey(entry);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }

  let filled = 0;
  for (const tracks of groups.values()) {
    if (tracks.length < 2) continue;
    const donor = tracks.find((t) => isPersistentAlbumArt(t.albumArt));
    const donorUrl = donor?.albumArt?.trim();
    // Only tracks with no usable art of their own need the copy.
    const needy = tracks.filter(
      (t) => !isPersistentAlbumArt(t.albumArt) && !t.albumArt?.trim(),
    );
    if (needy.length === 0 && !tracks.some((t) => !isPersistentAlbumArt(t.albumArt))) {
      continue;
    }

    if (donorUrl) {
      for (const t of needy) {
        await updateLockerEntryMetadata(t.id, { albumArt: donorUrl });
        filled += 1;
      }
      continue;
    }

    // No inline donor. Art is often held in the separate blob store rather than on the
    // entry — use the bulk id set to find a donor and the tracks that need it, so this
    // costs ONE blob read per group instead of two per track.
    const donorId = tracks.find((t) => artIds.has(t.id))?.id;
    if (!donorId) continue;
    const needBlob = tracks.filter((t) => !artIds.has(t.id));
    if (needBlob.length === 0) continue;
    const donorBlob = await getLockerArtBlob(donorId);
    if (!donorBlob || donorBlob.size === 0) continue;
    // ONE transaction for the whole group — the per-entry write path opened a transaction
    // each time and blocked the main thread for seconds on a large library.
    filled += await applyArtBlobToEntries(
      needBlob.map((t) => t.id),
      donorBlob,
    );
    for (const t of needBlob) artIds.add(t.id);
  }
  return filled;
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
      artist: '',
      tracks: [entry],
    });
  }

  // Bulk id set again — albumGroupHasPersistedCover() probes the blob store per track, so
  // calling it for every group re-read the store hundreds of times.
  const coveredIds = await listLockerArtBlobIds();
  let fixed = 0;
  for (const group of groups.values()) {
    const hasInline = group.tracks.some((t) => isPersistentAlbumArt(t.albumArt));
    if (hasInline || group.tracks.some((t) => coveredIds.has(t.id))) continue;
    // Derive the artist from the WHOLE group, not one sample row. A single-entry
    // consensus often yields a track-level/featured artist that no longer matches the
    // album group, so the inner tracksForAlbumGroup() lookup found 0 tracks and bailed
    // before any cover lookup ran (whole heal finished in ~50ms, fixing nothing).
    const groupArtist =
      lockerAlbumArtistConsensus(group.tracks) ||
      lockerAlbumGroupArtist(group.tracks[0]!, group.tracks) ||
      '';
    const ok = await backfillLockerAlbumArtForTracks(
      group.albumName,
      groupArtist,
      group.tracks,
    );
    if (ok) fixed += 1;
  }
  return fixed;
}

/**
 * Cover heal for an album group whose tracks are already known — avoids re-deriving
 * the group by (albumName, artist), which can resolve to zero rows and silently skip.
 */
async function backfillLockerAlbumArtForTracks(
  albumName: string,
  artist: string,
  tracks: LockerEntry[],
): Promise<boolean> {
  const canonicalName = tracks[0]?.albumName?.trim() || albumName.trim();
  if (!canonicalName) return false;
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
