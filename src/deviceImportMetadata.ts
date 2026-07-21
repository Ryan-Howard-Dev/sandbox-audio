/**
 * Device import metadata — parse bad MediaStore tags and enrich from online catalog.
 */

import { isAirGapEnabled } from './airGapMode';
import { findAlbumCoverForLockerGroup } from './albumCover';
import {
  extractEmbeddedPerformerFromText,
  inferArtistTitleFromAllCapsBlob,
  isLikelyFanEditTrackTitle,
  resolveImportArtistAndTitle,
} from './importTitleParse';
import {
  getLockerEntriesSnapshot,
  isArtistTitleMashupName,
  isBadMediaStoreAlbum,
  isBadMediaStoreArtist,
  isJunkImportArchiveLabel,
  isKnownPlaylistStubArtistName,
  isLikelyUploaderHandleArtist,
  isMislabeledPlaylistStubArtist,
  isInventedCatalogStubArtistName,
  isUserMetadataLocked,
  isPersistentAlbumArt,
  isTitleFragmentArtistName,
  isUsableArtistName,
  lockerAlbumGroupArtist,
  lockerAlbumGroupKey,
  lockerTrackArtistConsensus,
  normalizeLockerKeyPart,
  persistAlbumCoverForGroup,
  refreshLockerCache,
  resolveAlbumSearchArtist,
  resolveKnownStubArtistReassignment,
  updateLockerEntryMetadata,
  type LockerEntry,
} from './lockerStorage';
import type { DeviceMusicScanHit } from './lockerUploadFilter';
import { identifyAndRepairAlbumGroup } from './metadataRepair';
import { fetchSearchCatalog, trackTitlesFuzzyMatch } from './searchCatalog';

export {
  extractEmbeddedPerformerFromText,
  inferArtistTitleFromAllCapsBlob,
  isLikelyFanEditTrackTitle,
} from './importTitleParse';

const CATALOG_SINGLE_MIN_CONFIDENCE = 0.88;
/** Boot / auto-repair requires even higher title agreement before writing a famous artist. */
const CATALOG_SAFE_REPAIR_MIN_CONFIDENCE = 0.92;

/** Resolve title/artist/album from a device scan hit — prefers filename over bad MediaStore tags. */
export function resolveDeviceScanMetadata(hit: DeviceMusicScanHit): {
  title: string;
  artist: string;
  albumName?: string;
} {
  const displayName = hit.displayName.trim();
  const pathName = (hit.path || displayName).split(/[/\\]/).pop() ?? displayName;

  const { artist, title } = resolveImportArtistAndTitle({
    pathName,
    mediaTitle: hit.title.trim() || pathName.replace(/\.[^/.]+$/, ''),
    mediaArtist: hit.artist.trim(),
  });

  let albumName = hit.album.trim() || undefined;
  if (albumName && isBadMediaStoreAlbum(albumName)) {
    albumName = undefined;
  }

  if (!albumName) {
    const folder = hit.folder.trim();
    if (folder && !/ymusic/i.test(folder) && !isBadMediaStoreAlbum(folder)) {
      albumName = folder;
    }
  }

  return {
    title,
    artist,
    albumName,
  };
}

function catalogArtistConflictsWithLocalHint(catalogArtist: string, localHint?: string): boolean {
  if (!localHint?.trim()) return false;
  const a = localHint.trim().toLowerCase();
  const b = catalogArtist.trim().toLowerCase();
  if (a === b) return false;
  if (b.includes(a) || a.includes(b)) return false;
  return true;
}

function singleTrackCatalogConfidence(localTitle: string, catalogTitle: string): number {
  if (!trackTitlesFuzzyMatch(localTitle, catalogTitle)) return 0;
  const local = localTitle.trim().toLowerCase();
  const remote = catalogTitle.trim().toLowerCase();
  if (local === remote) return 1;
  const localWords = local.split(/\s+/).filter((w) => w.length > 1);
  const remoteWords = remote.split(/\s+/).filter((w) => w.length > 1);
  // Short/ambiguous titles ("Now", "Go", "Up") must be exact — never substring fuzzy hits.
  if (localWords.length <= 1 && local.replace(/[^a-z0-9]/g, '').length <= 6) return 0;
  if (localWords.length === 0 || remoteWords.length === 0) return 0.5;
  const overlap = localWords.filter((w) => remoteWords.includes(w)).length;
  return overlap / Math.max(localWords.length, remoteWords.length);
}

/** True when the title is too short/generic for a safe famous-artist catalog invent. */
function isAmbiguousShortTrackTitle(title: string): boolean {
  const words = title
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const compact = title.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return words.length <= 1 && compact.length <= 6;
}

async function applyTitleParsedArtistOnly(track: LockerEntry): Promise<boolean> {
  // DISABLED for auto-repair: title-prefix parsing invented fake artists (Show, Type, Bad…).
  // Only allow explicit "Title — Artist" / "Artist - Title" dash forms with a usable artist.
  const parsed = extractEmbeddedPerformerFromText(track.title);
  if (!parsed?.artist || !isUsableArtistName(parsed.artist)) return false;
  if (
    isTitleFragmentArtistName(parsed.artist, track) ||
    isMislabeledPlaylistStubArtist(parsed.artist, track) ||
    isArtistTitleMashupName(parsed.artist) ||
    isLikelyUploaderHandleArtist(parsed.artist)
  ) {
    return false;
  }
  // Require a dash separator in the source title — never invent from first words alone
  if (!/\s[-–—]\s/.test(track.title)) return false;
  if (parsed.artist === track.artist?.trim() && parsed.title === track.title?.trim()) return false;

  await updateLockerEntryMetadata(
    track.id,
    {
      artist: parsed.artist,
      albumArtist: parsed.artist,
      title: parsed.title,
    },
    { skipCacheRefresh: true },
  );
  return true;
}

/** Look up a single locker track against the online catalog (title, artist, album, artwork). */
export async function fixLockerTrackFromOnlineLibrary(track: LockerEntry): Promise<boolean> {
  const ok = await identifySingleTrackFromCatalog(track, { minConfidence: CATALOG_SINGLE_MIN_CONFIDENCE });
  if (ok) await refreshLockerCache();
  return ok;
}

async function identifySingleTrackFromCatalog(
  track: LockerEntry,
  options?: { minConfidence?: number; allowTitleParse?: boolean },
): Promise<boolean> {
  if (isAirGapEnabled()) return false;
  if (isUserMetadataLocked(track)) return false;
  const title = track.title.trim();
  if (title.length < 3) return false;

  const minConfidence = options?.minConfidence ?? CATALOG_SINGLE_MIN_CONFIDENCE;
  const localHint = extractEmbeddedPerformerFromText(track.title)?.artist;
  const fanEdit = isLikelyFanEditTrackTitle(track.title);
  const artistMislabeled =
    isMislabeledPlaylistStubArtist(track.artist, track) ||
    isMislabeledPlaylistStubArtist(track.albumArtist, track) ||
    isKnownPlaylistStubArtistName(track.artist) ||
    isKnownPlaylistStubArtistName(track.albumArtist) ||
    isTitleFragmentArtistName(track.artist, track) ||
    isTitleFragmentArtistName(track.albumArtist, track) ||
    isArtistTitleMashupName(track.artist) ||
    isLikelyUploaderHandleArtist(track.artist);

  const knownReassignment = resolveKnownStubArtistReassignment(track);
  if (knownReassignment) {
    const already =
      track.artist?.trim() === knownReassignment.artist &&
      (track.albumArtist?.trim() === knownReassignment.albumArtist ||
        !track.albumArtist?.trim());
    if (!already) {
      const patch: Parameters<typeof updateLockerEntryMetadata>[1] = {
        artist: knownReassignment.artist,
        albumArtist: knownReassignment.albumArtist,
      };
      if (
        knownReassignment.albumName?.trim() &&
        (!track.albumName?.trim() || isBadMediaStoreAlbum(track.albumName))
      ) {
        patch.albumName = knownReassignment.albumName.trim();
      }
      await updateLockerEntryMetadata(track.id, patch, { skipCacheRefresh: true });
      console.log('[locker] known stub reassignment', {
        id: track.id,
        title: track.title,
        from: track.artist,
        to: knownReassignment.artist,
      });
      return true;
    }
  }

  if (fanEdit && options?.allowTitleParse) {
    return applyTitleParsedArtistOnly(track);
  }
  if (fanEdit) {
    // Do not invent artists from fan-edit meme titles during auto-repair
    return false;
  }

  const usableLocalArtist =
    track.artist?.trim() &&
    isUsableArtistName(track.artist) &&
    !artistMislabeled &&
    !isMislabeledPlaylistStubArtist(track.artist, track)
      ? track.artist.trim()
      : null;

  // Prefer title+artist query; for junk artists search title only (never trust fragment as hint)
  const query = usableLocalArtist
    ? `${usableLocalArtist} ${title}`.trim()
    : localHint && isUsableArtistName(localHint) && !isTitleFragmentArtistName(localHint, track)
      ? `${localHint} ${title}`.trim()
      : title;

  const catalog = await fetchSearchCatalog(query);
  const candidates = catalog.tracks.filter((ct) => trackTitlesFuzzyMatch(ct.title, track.title));
  // Pick best by title confidence; reject weak title similarity
  let best: (typeof candidates)[number] | undefined;
  let bestConf = 0;
  for (const ct of candidates) {
    const conf = singleTrackCatalogConfidence(track.title, ct.title);
    if (conf > bestConf) {
      bestConf = conf;
      best = ct;
    }
  }
  const match = best;
  if (!match?.artist?.trim()) {
    return false;
  }

  if (
    isBadMediaStoreArtist(match.artist) ||
    isJunkImportArchiveLabel(match.artist) ||
    isBadMediaStoreAlbum(match.album ?? '') ||
    isTitleFragmentArtistName(match.artist, track) ||
    isArtistTitleMashupName(match.artist) ||
    isLikelyUploaderHandleArtist(match.artist) ||
    isInventedCatalogStubArtistName(match.artist)
  ) {
    return false;
  }

  const confidence = bestConf;
  if (confidence < minConfidence) {
    console.log('[locker] catalog match rejected (low confidence)', {
      title: track.title,
      matchTitle: match.title,
      matchArtist: match.artist,
      confidence,
      minConfidence,
    });
    return false;
  }

  // Reject wrong famous-artist assignments when local title barely overlaps
  const localWords = title.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const remoteWords = match.title
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const overlap = localWords.filter((w) => remoteWords.includes(w)).length;
  if (overlap === 0 || overlap / Math.max(localWords.length, 1) < 0.5) {
    console.log('[locker] catalog match rejected (weak title overlap)', {
      title: track.title,
      matchTitle: match.title,
      matchArtist: match.artist,
    });
    return false;
  }

  // Short titles collide across the catalog — never invent a famous artist without a
  // usable local artist that already agrees (prefer Unknown over wrong Tones and I / etc.).
  if (isAmbiguousShortTrackTitle(title)) {
    if (confidence < 1) return false;
    if (!usableLocalArtist) {
      console.log('[locker] catalog match rejected (ambiguous short title, no local artist)', {
        title: track.title,
        matchArtist: match.artist,
      });
      return false;
    }
    if (
      normalizeLockerKeyPart(usableLocalArtist) !== normalizeLockerKeyPart(match.artist) &&
      !match.artist.trim().toLowerCase().includes(usableLocalArtist.toLowerCase()) &&
      !usableLocalArtist.toLowerCase().includes(match.artist.trim().toLowerCase())
    ) {
      console.log('[locker] catalog match rejected (short title artist disagreement)', {
        title: track.title,
        localArtist: usableLocalArtist,
        matchArtist: match.artist,
      });
      return false;
    }
  }

  if (localHint && isUsableArtistName(localHint) && catalogArtistConflictsWithLocalHint(match.artist, localHint)) {
    return false;
  }

  // If we already have a usable local artist that disagrees with catalog, do not overwrite
  if (
    usableLocalArtist &&
    normalizeLockerKeyPart(usableLocalArtist) !== normalizeLockerKeyPart(match.artist) &&
    !artistMislabeled
  ) {
    const a = usableLocalArtist.toLowerCase();
    const b = match.artist.trim().toLowerCase();
    if (!b.includes(a) && !a.includes(b) && confidence < 0.97) {
      return false;
    }
  }

  const patch: Parameters<typeof updateLockerEntryMetadata>[1] = {};
  if (match.artist.trim() && match.artist.trim() !== track.artist?.trim()) {
    patch.artist = match.artist.trim();
    patch.albumArtist = match.artist.trim();
  }
  if (match.title?.trim() && match.title.trim() !== track.title?.trim() && confidence >= 0.95) {
    patch.title = match.title.trim();
  }
  if (match.album?.trim() && !track.albumName?.trim() && !isBadMediaStoreAlbum(match.album)) {
    patch.albumName = match.album.trim();
  }
  if (match.artworkUrl?.trim() && !track.albumArt?.trim() && confidence >= 0.95) {
    patch.albumArt = match.artworkUrl.trim();
  }
  if (match.releaseYear?.trim() && !track.releaseYear?.trim()) {
    patch.releaseYear = match.releaseYear.trim();
  }

  if (Object.keys(patch).length === 0) return false;
  await updateLockerEntryMetadata(track.id, patch, { skipCacheRefresh: true });
  return true;
}

/** Apply hardcoded stub → real artist mappings (metadata only). */
export async function applyKnownStubReassignmentsInVault(
  trackIds?: string[],
): Promise<{ fixed: number }> {
  const snap = getLockerEntriesSnapshot() ?? [];
  // Include any row whose title hits a known mapping (e.g. Starburst → Danny Brown
  // even when tagged with a producer/uploader name like Niko Sitaras).
  const targets = trackIds?.length
    ? snap.filter((t) => trackIds.includes(t.id))
    : snap.filter(
        (t) =>
          resolveKnownStubArtistReassignment(t) != null ||
          isKnownPlaylistStubArtistName(t.artist) ||
          isKnownPlaylistStubArtistName(t.albumArtist) ||
          isMislabeledPlaylistStubArtist(t.artist, t) ||
          isMislabeledPlaylistStubArtist(t.albumArtist, t),
      );

  let fixed = 0;
  for (const track of targets) {
    if (isUserMetadataLocked(track)) continue;
    const reassignment = resolveKnownStubArtistReassignment(track);
    if (!reassignment) continue;
    const patch: Parameters<typeof updateLockerEntryMetadata>[1] = {
      artist: reassignment.artist,
      albumArtist: reassignment.albumArtist,
    };
    if (
      reassignment.albumName?.trim() &&
      (!track.albumName?.trim() || isBadMediaStoreAlbum(track.albumName))
    ) {
      patch.albumName = reassignment.albumName.trim();
    }
    const unchanged =
      track.artist?.trim() === patch.artist &&
      track.albumArtist?.trim() === patch.albumArtist &&
      (!patch.albumName || track.albumName?.trim() === patch.albumName);
    if (unchanged) continue;

    await updateLockerEntryMetadata(track.id, patch, { skipCacheRefresh: true });
    fixed += 1;
    console.log('[locker] applyKnownStubReassignmentsInVault', {
      id: track.id,
      title: track.title,
      from: track.artist,
      to: reassignment.artist,
    });
  }
  if (fixed > 0) await refreshLockerCache();
  return { fixed };
}

/** Repair playlist-stub artist labels — known stubs + high-confidence catalog only. */
export async function repairMislabeledStubArtistsInVault(
  trackIds?: string[],
): Promise<{ fixed: number }> {
  return repairMislabeledStubArtistsInVaultSafe(trackIds);
}

/**
 * Safe vault repair for mislabeled stubs:
 * known mapping OR high-confidence catalog — never title-prefix inventing.
 */
export async function repairMislabeledStubArtistsInVaultSafe(
  trackIds?: string[],
): Promise<{ fixed: number }> {
  const snap = getLockerEntriesSnapshot() ?? [];
  const targets = trackIds?.length
    ? snap.filter((t) => trackIds.includes(t.id))
    : snap.filter(
        (t) =>
          isMislabeledPlaylistStubArtist(t.artist, t) ||
          isMislabeledPlaylistStubArtist(t.albumArtist, t) ||
          isTitleFragmentArtistName(t.artist, t) ||
          isTitleFragmentArtistName(t.albumArtist, t) ||
          isArtistTitleMashupName(t.artist) ||
          isLikelyUploaderHandleArtist(t.artist),
      );

  let fixed = 0;
  for (const track of targets) {
    if (isUserMetadataLocked(track)) continue;
    const reassignment = resolveKnownStubArtistReassignment(track);
    if (reassignment) {
      const patch: Parameters<typeof updateLockerEntryMetadata>[1] = {
        artist: reassignment.artist,
        albumArtist: reassignment.albumArtist,
      };
      if (
        reassignment.albumName?.trim() &&
        (!track.albumName?.trim() || isBadMediaStoreAlbum(track.albumName))
      ) {
        patch.albumName = reassignment.albumName.trim();
      }
      const unchanged =
        track.artist?.trim() === patch.artist &&
        track.albumArtist?.trim() === patch.albumArtist &&
        (!patch.albumName || track.albumName?.trim() === patch.albumName);
      if (!unchanged) {
        await updateLockerEntryMetadata(track.id, patch, { skipCacheRefresh: true });
        fixed += 1;
        continue;
      }
    }
    const ok = await identifySingleTrackFromCatalog(track, {
      minConfidence: CATALOG_SAFE_REPAIR_MIN_CONFIDENCE,
      allowTitleParse: false,
    });
    if (ok) fixed += 1;
  }
  if (fixed > 0) await refreshLockerCache();
  return { fixed };
}

/**
 * Clear remaining title-fragment / handle / mashup artists to Unknown Artist.
 * Never deletes tracks. Never writes first-word-of-title as artist.
 */
export async function clearJunkArtistsToUnknownInVault(
  trackIds?: string[],
): Promise<{ fixed: number }> {
  const snap = getLockerEntriesSnapshot() ?? [];
  const targets = trackIds?.length
    ? snap.filter((t) => trackIds.includes(t.id))
    : snap;

  let fixed = 0;
  for (const track of targets) {
    const artist = track.artist?.trim() ?? '';
    const albumArtist = track.albumArtist?.trim() ?? '';
    const junkArtist =
      isTitleFragmentArtistName(artist, track) ||
      isMislabeledPlaylistStubArtist(artist, track) ||
      isArtistTitleMashupName(artist) ||
      isLikelyUploaderHandleArtist(artist) ||
      isInventedCatalogStubArtistName(artist) ||
      (artist && !isUsableArtistName(artist) && !/^unknown artist$/i.test(artist) && !/^local upload$/i.test(artist));
    const junkAlbumArtist =
      (albumArtist &&
        (isTitleFragmentArtistName(albumArtist, track) ||
          isMislabeledPlaylistStubArtist(albumArtist, track) ||
          isArtistTitleMashupName(albumArtist) ||
          isLikelyUploaderHandleArtist(albumArtist) ||
          isInventedCatalogStubArtistName(albumArtist))) ||
      false;

    if (!junkArtist && !junkAlbumArtist) continue;
    if (resolveKnownStubArtistReassignment(track)) continue;
    if (isUserMetadataLocked(track)) continue;

    const patch: Parameters<typeof updateLockerEntryMetadata>[1] = {};
    if (junkArtist && !/^unknown artist$/i.test(artist)) {
      patch.artist = 'Unknown Artist';
    }
    if (junkAlbumArtist && !/^unknown artist$/i.test(albumArtist)) {
      patch.albumArtist = 'Unknown Artist';
    } else if (junkArtist && patch.artist === 'Unknown Artist') {
      patch.albumArtist = 'Unknown Artist';
    }
    if (Object.keys(patch).length === 0) continue;
    await updateLockerEntryMetadata(track.id, patch, { skipCacheRefresh: true });
    fixed += 1;
    console.log('[locker] clearJunkArtistsToUnknown', {
      id: track.id,
      title: track.title,
      from: artist,
    });
  }
  if (fixed > 0) await refreshLockerCache();
  return { fixed };
}

/**
 * Undo prior unsafe auto-repair that assigned wrong famous artists
 * (ABBA for Dream Come True, Taylor Swift for Choices / Bad fragment, etc.).
 */
export async function undoUnsafeFamousArtistAssignmentsInVault(
  trackIds?: string[],
): Promise<{ fixed: number }> {
  const snap = getLockerEntriesSnapshot() ?? [];
  const targets = trackIds?.length
    ? snap.filter((t) => trackIds.includes(t.id))
    : snap;

  let fixed = 0;
  for (const track of targets) {
    const artistKey = normalizeLockerKeyPart(track.artist ?? '');
    const titleKey = normalizeLockerKeyPart(track.title ?? '');
    let shouldClear = false;

    // Prior bug: dream come → ABBA
    if (
      artistKey === 'abba' &&
      (titleKey.includes('dream come') || titleKey === 'true' || titleKey.startsWith('true '))
    ) {
      shouldClear = true;
    }
    // Prior bug: artistKey === 'bad' → Taylor Swift for any track
    if (
      artistKey === 'taylor swift' &&
      titleKey !== 'bad blood' &&
      !titleKey.includes('bad blood') &&
      (titleKey === 'choices' || titleKey.includes('choices'))
    ) {
      shouldClear = true;
    }
    // California fragment wrongly mapped to Childish Gambino
    if (
      artistKey === 'childish gambino' &&
      (titleKey === 'california' || titleKey.startsWith('california '))
    ) {
      shouldClear = true;
    }
    // Short title "Now" wrongly assigned to Tones and I via weak catalog / Dance Monkey bleed
    if (artistKey === 'tones and i' && titleKey === 'now') {
      shouldClear = true;
    }
    // Starburst must be Danny Brown — clear producer/uploader primary tags
    if (
      titleKey === 'starburst' &&
      artistKey !== 'danny brown' &&
      !artistKey.includes('danny brown')
    ) {
      const known = resolveKnownStubArtistReassignment(track);
      if (known) {
        await updateLockerEntryMetadata(
          track.id,
          { artist: known.artist, albumArtist: known.albumArtist },
          { skipCacheRefresh: true },
        );
        fixed += 1;
        console.log('[locker] undoUnsafeFamousArtistAssignment', {
          id: track.id,
          title: track.title,
          from: track.artist,
          to: known.artist,
        });
        continue;
      }
    }
    // Prior bug: wrong catalog stubs (Liv Angell, Starringo, Ash Wiseman, etc.)
    if (isInventedCatalogStubArtistName(track.artist)) {
      const known = resolveKnownStubArtistReassignment(track);
      if (known) {
        await updateLockerEntryMetadata(
          track.id,
          { artist: known.artist, albumArtist: known.albumArtist },
          { skipCacheRefresh: true },
        );
        fixed += 1;
        continue;
      }
      shouldClear = true;
    }

    if (!shouldClear) continue;
    if (isUserMetadataLocked(track)) continue;

    // Try high-confidence catalog first; else Unknown
    const ok = await identifySingleTrackFromCatalog(track, {
      minConfidence: CATALOG_SAFE_REPAIR_MIN_CONFIDENCE,
      allowTitleParse: false,
    });
    if (ok) {
      fixed += 1;
      continue;
    }
    await updateLockerEntryMetadata(
      track.id,
      { artist: 'Unknown Artist', albumArtist: 'Unknown Artist' },
      { skipCacheRefresh: true },
    );
    fixed += 1;
    console.log('[locker] undoUnsafeFamousArtistAssignment', {
      id: track.id,
      title: track.title,
      from: track.artist,
    });
  }
  if (fixed > 0) await refreshLockerCache();
  return { fixed };
}

async function tryFetchCoverForGroup(
  albumName: string,
  groupArtist: string,
  tracks: LockerEntry[],
): Promise<boolean> {
  if (isBadMediaStoreAlbum(albumName)) return false;
  if (tracks.some((t) => isLikelyFanEditTrackTitle(t.title))) return false;

  const refreshed = (getLockerEntriesSnapshot() ?? []).filter((t) =>
    tracks.some((x) => x.id === t.id),
  );
  const hasArt = refreshed.some(
    (t) => t.albumArt?.trim() && (isPersistentAlbumArt(t.albumArt) || t.albumArt.startsWith('blob:')),
  );
  if (hasArt) return false;

  const searchArtist = resolveAlbumSearchArtist(albumName, groupArtist, refreshed);
  if (!searchArtist || isBadMediaStoreArtist(searchArtist)) return false;

  const found = await findAlbumCoverForLockerGroup(albumName, searchArtist, refreshed);
  if (!found?.url) return false;
  return persistAlbumCoverForGroup(albumName, groupArtist, found.url, { releaseYear: found.year });
}

export type ImportMetadataProgress = {
  current: number;
  total: number;
  label: string;
};

/** Re-apply import parsing to undo bad catalog enrichment on YMusic / fan-edit uploads. */
export async function refineCorruptedImportMetadata(
  trackIds?: string[],
): Promise<{ fixed: number }> {
  const snap = getLockerEntriesSnapshot() ?? [];
  const targets = trackIds?.length
    ? snap.filter((t) => trackIds.includes(t.id))
    : snap.filter(
        (t) =>
          isBadMediaStoreAlbum(t.albumName) ||
          isJunkImportArchiveLabel(t.albumArtist ?? '') ||
          isBadMediaStoreArtist(t.albumArtist) ||
          (t.albumArtist &&
            t.artist &&
            isJunkImportArchiveLabel(t.albumArtist) &&
            isUsableArtistName(t.artist)),
      );

  let fixed = 0;
  for (const track of targets) {
    const parsed = extractEmbeddedPerformerFromText(track.title);
    const patch: Parameters<typeof updateLockerEntryMetadata>[1] = {};

    if (isBadMediaStoreAlbum(track.albumName)) {
      patch.albumName = '';
    }
    if (
      track.albumArtist &&
      (isBadMediaStoreArtist(track.albumArtist) ||
        isJunkImportArchiveLabel(track.albumArtist) ||
        isBadMediaStoreAlbum(track.albumArtist))
    ) {
      patch.albumArtist = parsed?.artist ?? track.artist;
    }
    if (parsed?.artist && isUsableArtistName(parsed.artist)) {
      if (parsed.artist !== track.artist?.trim()) patch.artist = parsed.artist;
      if (parsed.title !== track.title?.trim()) patch.title = parsed.title;
      if (!patch.albumArtist) patch.albumArtist = parsed.artist;
    }

    if (Object.keys(patch).length === 0) continue;
    await updateLockerEntryMetadata(track.id, patch, { skipCacheRefresh: true });
    fixed += 1;
  }

  if (fixed > 0) await refreshLockerCache();
  return { fixed };
}

/** Online catalog enrichment for freshly imported device tracks (metadata only — no file deletion). */
export async function enrichImportedLockerTracks(
  trackIds: string[],
  onProgress?: (progress: ImportMetadataProgress) => void,
): Promise<{ repaired: number; failed: number }> {
  if (trackIds.length === 0 || isAirGapEnabled()) {
    return { repaired: 0, failed: 0 };
  }

  let repaired = 0;
  let failed = 0;

  const snap = getLockerEntriesSnapshot() ?? [];
  const imported = snap.filter((t) => trackIds.includes(t.id));
  if (imported.length === 0) return { repaired: 0, failed: 0 };

  await refineCorruptedImportMetadata(trackIds);
  await repairMislabeledStubArtistsInVaultSafe(trackIds);

  const singles: LockerEntry[] = [];
  const groups = new Map<string, LockerEntry[]>();

  for (const entry of imported) {
    const albumName = entry.albumName?.trim();
    if (!albumName || isBadMediaStoreAlbum(albumName)) {
      singles.push(entry);
      continue;
    }
    const key = lockerAlbumGroupKey(entry) || `${albumName}::${entry.artist}`;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  const work: Array<{ kind: 'album'; albumName: string; tracks: LockerEntry[] } | { kind: 'single'; track: LockerEntry }> = [
    ...[...groups.values()].map((tracks) => ({
      kind: 'album' as const,
      albumName: tracks[0]!.albumName!.trim(),
      tracks,
    })),
    ...singles.map((track) => ({ kind: 'single' as const, track })),
  ];

  for (let i = 0; i < work.length; i++) {
    const item = work[i]!;
    const label = item.kind === 'album' ? item.albumName : item.track.title;
    onProgress?.({ current: i + 1, total: work.length, label });

    try {
      if (item.kind === 'single') {
        const ok = await identifySingleTrackFromCatalog(item.track, {
          minConfidence: CATALOG_SINGLE_MIN_CONFIDENCE,
          allowTitleParse: false,
        });
        if (ok) repaired += 1;
        else failed += 1;
        continue;
      }

      const { albumName, tracks } = item;
      const groupArtist = lockerAlbumGroupArtist(tracks[0]!, tracks);
      const consensus = lockerTrackArtistConsensus(tracks);
      if (isBadMediaStoreAlbum(albumName) && consensus) {
        for (const track of tracks) {
          const patch: Parameters<typeof updateLockerEntryMetadata>[1] = {
            albumArtist: consensus,
          };
          if (isBadMediaStoreAlbum(albumName)) patch.albumName = '';
          if (isBadMediaStoreArtist(track.artist) || isMislabeledPlaylistStubArtist(track.artist, track)) {
            patch.artist = consensus;
          }
          await updateLockerEntryMetadata(track.id, patch, { skipCacheRefresh: true });
        }
        repaired += tracks.length;
        continue;
      }

      const outcome = await identifyAndRepairAlbumGroup(albumName, groupArtist, tracks);
      if (outcome.updated) repaired += tracks.length;

      const coverFixed = await tryFetchCoverForGroup(albumName, groupArtist, tracks);
      if (coverFixed) repaired += 1;
    } catch {
      failed += item.kind === 'album' ? item.tracks.length : 1;
    }
  }

  await refreshLockerCache();
  return { repaired, failed };
}
