/**
 * Locker metadata scan + repair — artwork, credits, genres, release groups, artist images.
 * Metadata only; never re-ingests audio files.
 */

import { isAirGapEnabled } from './airGapMode';
import { fixLockerTrackFromOnlineLibrary } from './deviceImportMetadata';
import { findAlbumCoverForLockerGroup } from './albumCover';
import { findArtistImage, getCachedArtistImage } from './artistImage';
import { extractEmbeddedCover } from './embeddedCover';
import { releaseGroupIdFromEntry } from './groupTracksByEnvelope';
import {
  artistLineContainsLeakWatermark,
  formatDisplayTrackTitle,
  isBadMediaStoreAlbum,
  isBadMediaStoreArtist,
  isJunkImportArchiveLabel,
  isLeakWatermarkArtistName,
  isMislabeledPlaylistStubArtist,
  isPersistentAlbumArt,
  isUsableArtistName,
  lockerAlbumArtistNeedsIdentification,
  lockerAlbumGroupArtist,
  lockerAlbumGroupKey,
  lockerTrackArtistConsensus,
  parseId3v2Tags,
  persistAlbumCoverBlobForGroup,
  persistAlbumCoverForGroup,
  primaryLockerArtist,
  refreshLockerCache,
  resolveAlbumSearchArtist,
  updateAlbumGroupMetadata,
  updateLockerEntryMetadata,
  type LockerEntry,
} from './lockerStorage';
import { fetchWithTimeout } from './fetchWithTimeout';
import {
  albumTitlesFuzzyMatch,
  fetchAlbumTracks,
  identifyCatalogAlbumByTitle,
  lookupKnownMixtapeArtist,
  matchCatalogTrackForTitle,
  normalizeAlbumTitleForMatch,
  type CatalogTrack,
} from './searchCatalog';
import {
  extractEmbeddedPerformerFromText,
  isLikelyFanEditTrackTitle,
} from './importTitleParse';

const APPLY_CATALOG_IDENTIFY_MIN_CONFIDENCE = 700;

const MB_USER_AGENT =
  'SandboxMusic/1.0.0 (https://github.com/sandbox-music; metadata-repair)';

const PLACEHOLDER_ARTIST =
  /^(local upload|unknown artist|sandbox artist|uploaded|local device locker|various artists?)$/i;

const WEAK_GENRE = /^(local|downloaded|unknown|other|)$/i;

const BATCH_SIZE = 8;

export enum MetadataIssueType {
  MissingAlbumArt = 'missing_album_art',
  MissingArtistImage = 'missing_artist_image',
  MissingGenre = 'missing_genre',
  MissingReleaseGroup = 'missing_release_group',
  BrokenCredits = 'broken_credits',
  WrongAlbumArtist = 'wrong_album_artist',
}

export interface MetadataIssue {
  type: MetadataIssueType;
  trackId?: string;
  albumKey?: string;
  albumName?: string;
  artist?: string;
  artistName?: string;
  detail?: string;
}

export interface MetadataScanReport {
  issues: MetadataIssue[];
  summary: Record<MetadataIssueType, number>;
  totalIssues: number;
  scannedTracks: number;
  uniqueAlbums: number;
  uniqueArtists: number;
}

export interface MetadataRepairOptions {
  repairAlbumArt?: boolean;
  repairArtistImages?: boolean;
  repairGenres?: boolean;
  repairReleaseGroups?: boolean;
  repairCredits?: boolean;
  repairAlbumIdentification?: boolean;
  /** When false, only local repairs run (embedded art, credit normalization). */
  allowNetwork?: boolean;
}

export type MetadataRepairPhase = 'idle' | 'scanning' | 'repairing' | 'done' | 'cancelled';

export interface MetadataRepairProgress {
  phase: MetadataRepairPhase;
  scanned: number;
  total: number;
  issuesFound: number;
  repaired: number;
  failed: number;
  skippedNetwork: number;
  currentLabel?: string;
  airGapBlocked?: boolean;
  message?: string;
}

export interface MetadataRepairResult {
  progress: MetadataRepairProgress;
  report: MetadataScanReport;
}

function emptySummary(): Record<MetadataIssueType, number> {
  return {
    [MetadataIssueType.MissingAlbumArt]: 0,
    [MetadataIssueType.MissingArtistImage]: 0,
    [MetadataIssueType.MissingGenre]: 0,
    [MetadataIssueType.MissingReleaseGroup]: 0,
    [MetadataIssueType.BrokenCredits]: 0,
    [MetadataIssueType.WrongAlbumArtist]: 0,
  };
}

function mbBaseUrl(): string {
  if (typeof window !== 'undefined') return '/musicbrainz';
  return 'https://musicbrainz.org';
}

async function mbFetch(path: string): Promise<Response> {
  return fetchWithTimeout(`${mbBaseUrl()}${path}`, {
    headers: {
      'User-Agent': MB_USER_AGENT,
      Accept: 'application/json',
    },
  });
}

function escapeLucene(value: string): string {
  return value.replace(/[\\"+&|!(){}[\]^~*?:/-]/g, '\\$&');
}

function normalizeToken(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isMissingGenre(genre?: string): boolean {
  const g = (genre ?? '').trim();
  return !g || WEAK_GENRE.test(g);
}

function trackArtistNeedsEnrichment(artist?: string): boolean {
  const a = artist?.trim();
  if (!a) return true;
  if (artistLineContainsLeakWatermark(a)) return true;
  return !isUsableTrackArtist(a);
}

/** Match locker tracks to catalog track artists (incl. featured performers). */
export function buildTrackArtistPatchesFromCatalog(
  localTracks: LockerEntry[],
  catalogTracks: CatalogTrack[],
): Array<{ id: string; artist: string }> {
  const patches: Array<{ id: string; artist: string }> = [];
  for (const local of localTracks) {
    if (isLikelyFanEditTrackTitle(local.title)) continue;
    const match = matchCatalogTrackForTitle(local.title, catalogTracks);
    const catalogArtist = match?.artist?.trim();
    if (!catalogArtist || !isUsableTrackArtist(catalogArtist)) continue;
    if (isBadMediaStoreArtist(catalogArtist) || isJunkImportArchiveLabel(catalogArtist)) continue;
    const current = local.artist?.trim();
    const titleHint = extractEmbeddedPerformerFromText(local.title)?.artist;
    if (
      titleHint &&
      isUsableArtistName(titleHint) &&
      normalizeToken(titleHint) !== normalizeToken(catalogArtist)
    ) {
      continue;
    }
    if (
      current &&
      isUsableArtistName(current) &&
      !trackArtistNeedsEnrichment(current) &&
      normalizeToken(current) !== normalizeToken(catalogArtist)
    ) {
      continue;
    }
    if (
      trackArtistNeedsEnrichment(current) ||
      artistLineContainsLeakWatermark(current ?? '') ||
      current !== catalogArtist
    ) {
      patches.push({ id: local.id, artist: catalogArtist });
    }
  }
  return patches;
}

async function enrichTrackArtistsFromCatalogMatch(
  tracks: LockerEntry[],
  catalogAlbum: { kind: 'album'; id: string; title: string; artist: string; collectionId?: number },
): Promise<boolean> {
  const catalogTracks = await fetchAlbumTracks(catalogAlbum);
  if (catalogTracks.length === 0) return false;
  const patches = buildTrackArtistPatchesFromCatalog(tracks, catalogTracks);
  if (patches.length === 0) return false;
  await Promise.all(
    patches.map((p) =>
      updateLockerEntryMetadata(p.id, { artist: p.artist }, { skipCacheRefresh: true }),
    ),
  );
  await refreshLockerCache();
  return true;
}

function hasBrokenCredits(entry: LockerEntry): string | null {
  const artist = (entry.artist ?? '').trim();
  const albumArtist = (entry.albumArtist ?? '').trim();
  const title = (entry.title ?? '').trim();

  if (PLACEHOLDER_ARTIST.test(artist) || isBadMediaStoreArtist(artist)) {
    return 'placeholder artist label';
  }

  if (artist.includes('_') && !title.includes('_')) {
    return 'raw underscore artist string';
  }

  const collabInArtist = /\s+(?:feat\.?|ft\.?|featuring|with)\s+/i.test(artist);
  if (collabInArtist && !albumArtist) {
    return 'missing album artist for collaboration';
  }

  if (/\(\s*feat/i.test(title) && !/\(feat\./i.test(title)) {
    return 'malformed feat. in title';
  }

  const formatted = formatDisplayTrackTitle(title);
  if (formatted && title && normalizeToken(formatted) !== normalizeToken(title)) {
    if (
      title.includes('_') ||
      /^\d+[\s._-]/.test(title) ||
      /\s+feat\.?\s+/i.test(title) && !/\(feat\./i.test(title)
    ) {
      return 'title needs credit normalization';
    }
  }

  if (artist && albumArtist && normalizeToken(artist) !== normalizeToken(albumArtist)) {
    const primary = primaryLockerArtist(artist);
    if (
      collabInArtist &&
      normalizeToken(albumArtist) !== normalizeToken(primary) &&
      !PLACEHOLDER_ARTIST.test(albumArtist)
    ) {
      return 'album artist does not match primary performer';
    }
  }

  return null;
}

function albumHasArt(tracks: LockerEntry[]): boolean {
  return tracks.some((t) => {
    const art = t.albumArt?.trim();
    return Boolean(art && (isPersistentAlbumArt(art) || art.startsWith('blob:')));
  });
}

function pushIssue(issues: MetadataIssue[], summary: Record<MetadataIssueType, number>, issue: MetadataIssue): void {
  issues.push(issue);
  summary[issue.type] += 1;
}

/** Scan locker tracks and build an issue report (synchronous, no network). */
export function scanLockerMetadata(tracks: LockerEntry[]): MetadataScanReport {
  const issues: MetadataIssue[] = [];
  const summary = emptySummary();

  const albumGroups = new Map<string, LockerEntry[]>();
  const artistsSeen = new Set<string>();
  const missingReleaseGroupAlbums = new Set<string>();

  for (const entry of tracks) {
    const albumKey = lockerAlbumGroupKey(entry);
    if (albumKey) {
      const list = albumGroups.get(albumKey);
      if (list) list.push(entry);
      else albumGroups.set(albumKey, [entry]);
    }

    const primaryArtist = lockerAlbumGroupArtist(entry);
    if (primaryArtist && !PLACEHOLDER_ARTIST.test(primaryArtist)) {
      artistsSeen.add(normalizeToken(primaryArtist));
    }

    if (isMissingGenre(entry.genre)) {
      pushIssue(issues, summary, {
        type: MetadataIssueType.MissingGenre,
        trackId: entry.id,
        albumKey: albumKey ?? undefined,
        albumName: entry.albumName,
        artist: primaryArtist,
        detail: entry.genre?.trim() || 'empty',
      });
    }

    const creditProblem = hasBrokenCredits(entry);
    if (creditProblem) {
      pushIssue(issues, summary, {
        type: MetadataIssueType.BrokenCredits,
        trackId: entry.id,
        albumKey: albumKey ?? undefined,
        albumName: entry.albumName,
        artist: entry.artist,
        detail: creditProblem,
      });
    }

    if (
      albumKey &&
      entry.albumName?.trim() &&
      !releaseGroupIdFromEntry(entry) &&
      !missingReleaseGroupAlbums.has(albumKey)
    ) {
      missingReleaseGroupAlbums.add(albumKey);
      pushIssue(issues, summary, {
        type: MetadataIssueType.MissingReleaseGroup,
        albumKey,
        albumName: entry.albumName,
        artist: primaryArtist,
      });
    }
  }

  for (const [albumKey, groupTracks] of albumGroups) {
    if (!albumHasArt(groupTracks)) {
      const sample = groupTracks[0];
      pushIssue(issues, summary, {
        type: MetadataIssueType.MissingAlbumArt,
        albumKey,
        albumName: sample.albumName,
        artist: lockerAlbumGroupArtist(sample, groupTracks),
      });
    }

    if (lockerAlbumArtistNeedsIdentification(groupTracks)) {
      const sample = groupTracks[0];
      const consensus = lockerTrackArtistConsensus(groupTracks);
      const wrong = groupTracks
        .map((t) => t.albumArtist?.trim())
        .find(
          (a) =>
            a &&
            consensus &&
            normalizeToken(a) !== normalizeToken(consensus),
        );
      pushIssue(issues, summary, {
        type: MetadataIssueType.WrongAlbumArtist,
        albumKey,
        albumName: sample.albumName,
        artist: lockerAlbumGroupArtist(sample, groupTracks),
        detail: wrong
          ? `album artist "${wrong}" vs track consensus "${consensus}"`
          : undefined,
      });
    }

    const stubMislabeled = groupTracks.some(
      (t) =>
        isMislabeledPlaylistStubArtist(t.artist, t) ||
        isMislabeledPlaylistStubArtist(t.albumArtist, t),
    );
    if (stubMislabeled) {
      const sample = groupTracks[0];
      pushIssue(issues, summary, {
        type: MetadataIssueType.WrongAlbumArtist,
        albumKey,
        albumName: sample.albumName,
        artist: lockerAlbumGroupArtist(sample, groupTracks),
        detail: 'playlist stub used album/title as artist',
      });
    }
  }

  for (const entry of tracks) {
    const name = lockerAlbumGroupArtist(entry);
    if (!name || PLACEHOLDER_ARTIST.test(name)) continue;
    const cached = getCachedArtistImage(name);
    if (cached === undefined) {
      const key = normalizeToken(name);
      if (!issues.some((i) => i.type === MetadataIssueType.MissingArtistImage && i.artistName === name)) {
        pushIssue(issues, summary, {
          type: MetadataIssueType.MissingArtistImage,
          artistName: name,
        });
      }
      void key;
    }
  }

  return {
    issues,
    summary,
    totalIssues: issues.length,
    scannedTracks: tracks.length,
    uniqueAlbums: albumGroups.size,
    uniqueArtists: artistsSeen.size,
  };
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 48 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function readAudioBlobForEntry(entryId: string): Promise<Blob | null> {
  try {
    const dbName = 'SandboxMusicCoreDB';
    const storeName = 'tracks';
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(entryId);
      req.onsuccess = () => {
        const row = req.result as { audioBlob?: Blob } | undefined;
        resolve(row?.audioBlob instanceof Blob ? row.audioBlob : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function tryEmbeddedCoverForGroup(
  albumName: string,
  artist: string,
  tracks: LockerEntry[],
): Promise<boolean> {
  for (const t of tracks.slice(0, 4)) {
    const blob = await readAudioBlobForEntry(t.id);
    if (!blob) continue;
    const probe = new File([blob], t.title || 'track', { type: blob.type || 'audio/flac' });
    const cover = await extractEmbeddedCover(probe);
    if (!cover) continue;
    try {
      await persistAlbumCoverBlobForGroup(albumName, artist, cover);
      return true;
    } catch {
      /* try next track */
    }
  }
  return false;
}

async function tryEmbeddedGenre(entry: LockerEntry): Promise<string | undefined> {
  const blob = await readAudioBlobForEntry(entry.id);
  if (!blob) return undefined;
  try {
    const head = blob.slice(0, Math.min(blob.size, 256 * 1024));
    const tags = parseId3v2Tags(await head.arrayBuffer());
    const genre = tags.genre?.trim();
    return genre && !WEAK_GENRE.test(genre) ? genre : undefined;
  } catch {
    return undefined;
  }
}

type ReleaseEnrichment = {
  musicbrainzReleaseId: string;
  musicbrainzReleaseGroupId?: string;
  releaseYear?: string;
  genre?: string;
};

async function fetchReleaseEnrichment(
  albumName: string,
  artist: string,
): Promise<ReleaseEnrichment | null> {
  const album = albumName.trim();
  if (!album) return null;

  const useArtist =
    artist.trim() && !PLACEHOLDER_ARTIST.test(artist) && isUsableArtistName(artist);
  const coreAlbum = normalizeAlbumTitleForMatch(album);
  const normalizedFull = normalizeToken(album);
  const coreDiffers = coreAlbum.length >= 4 && coreAlbum !== normalizedFull;
  const queries: string[] = [];
  if (useArtist) {
    queries.push(`release:"${escapeLucene(album)}" AND artist:"${escapeLucene(artist)}"`);
    if (coreDiffers) {
      queries.push(`release:"${escapeLucene(coreAlbum)}" AND artist:"${escapeLucene(artist)}"`);
    }
    queries.push(`artist:"${escapeLucene(artist)}" AND release:"${escapeLucene(coreAlbum)}"`);
  }
  queries.push(`release:"${escapeLucene(album)}"`);
  if (coreDiffers) {
    queries.push(`release:"${escapeLucene(coreAlbum)}"`);
  }

  let releases: Array<{
    id: string;
    title?: string;
    date?: string;
    'release-group'?: { id?: string };
    tags?: Array<{ name?: string; count?: number }>;
  }> = [];

  for (const q of queries) {
    const res = await mbFetch(
      `/ws/2/release?query=${encodeURIComponent(q)}&fmt=json&limit=8&inc=release-groups+tags`,
    );
    if (!res.ok) continue;
    const data = (await res.json()) as { releases?: typeof releases };
    releases = data.releases ?? [];
    if (releases.length > 0) break;
    await new Promise((r) => setTimeout(r, 110));
  }

  if (releases.length === 0) return null;

  const scored = releases
    .map((release) => {
      let score = 0;
      if (albumTitlesFuzzyMatch(release.title ?? '', album)) score += 500;
      if (useArtist) {
        const names =
          (release as { 'artist-credit'?: Array<{ name?: string }> })['artist-credit']
            ?.map((ac) => ac.name?.trim())
            .filter(Boolean)
            .join(' ') ?? '';
        const nNames = normalizeToken(names);
        const nArtist = normalizeToken(artist);
        if (nNames && nArtist && (nNames === nArtist || nNames.includes(nArtist))) {
          score += 400;
        }
      }
      const year = parseInt(release.date?.split('-')[0] ?? '9999', 10);
      score -= Math.min(year, 3000);
      return { release, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.release ?? releases[0];

  const tag = (best.tags ?? [])
    .filter((t) => t.name?.trim())
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];

  return {
    musicbrainzReleaseId: best.id,
    musicbrainzReleaseGroupId: best['release-group']?.id,
    releaseYear: best.date?.split('-')[0],
    genre: tag?.name?.trim(),
  };
}

function mergeCreditsJson(
  existing: string | undefined,
  patch: { musicbrainzReleaseId?: string; musicbrainzReleaseGroupId?: string },
): string {
  let base: Record<string, unknown> = {};
  if (existing?.trim()) {
    try {
      base = JSON.parse(existing) as Record<string, unknown>;
    } catch {
      base = {};
    }
  }
  if (patch.musicbrainzReleaseId) base.musicbrainzReleaseId = patch.musicbrainzReleaseId;
  if (patch.musicbrainzReleaseGroupId) {
    base.musicbrainzReleaseGroupId = patch.musicbrainzReleaseGroupId;
  }
  if (!base.fetchedAt) base.fetchedAt = Date.now();
  if (!base.source) base.source = 'metadata-repair';
  return JSON.stringify(base);
}

function normalizeCreditPatch(entry: LockerEntry): {
  title?: string;
  artist?: string;
  albumArtist?: string;
} | null {
  const patch: { title?: string; artist?: string; albumArtist?: string } = {};
  const title = entry.title?.trim() ?? '';
  const artist = entry.artist?.trim() ?? '';

  const formattedTitle = formatDisplayTrackTitle(title);
  if (formattedTitle && normalizeToken(formattedTitle) !== normalizeToken(title)) {
    patch.title = formattedTitle;
  }

  const primary = primaryLockerArtist(artist);
  const storedAlbumArtist = entry.albumArtist?.trim();
  if (
    primary &&
    storedAlbumArtist &&
    !PLACEHOLDER_ARTIST.test(storedAlbumArtist) &&
    normalizeToken(storedAlbumArtist) !== normalizeToken(primary) &&
    isUsableTrackArtist(primary)
  ) {
    patch.albumArtist = primary;
  }

  if (artist && /\s+(?:feat\.?|ft\.?|featuring|with)\s+/i.test(artist)) {
    if (primary && !PLACEHOLDER_ARTIST.test(primary)) {
      if (!entry.albumArtist?.trim()) patch.albumArtist = primary;
      const guests = artist
        .replace(new RegExp(`^${primary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')
        .replace(/^(?:feat\.?|ft\.?|featuring|with)\s+/i, '')
        .trim();
      if (guests) {
        patch.artist = formatDisplayTrackTitle(`${primary} (feat. ${guests})`);
      }
    }
  } else if (artist.includes('_')) {
    const cleaned = formatDisplayTrackTitle(artist);
    if (normalizeToken(cleaned) !== normalizeToken(artist)) patch.artist = cleaned;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function isUsableTrackArtist(name: string): boolean {
  return isUsableArtistName(name);
}

function resolveIdentifyArtistHint(
  albumName: string,
  groupArtist: string,
  tracks: LockerEntry[],
  consensus: string | null,
): string | undefined {
  if (consensus && isUsableArtistName(consensus)) return consensus;
  const fromSearch = resolveAlbumSearchArtist(albumName, groupArtist, tracks);
  if (isUsableArtistName(fromSearch)) return fromSearch;
  const known = lookupKnownMixtapeArtist(albumName);
  if (known) return known.artist;
  return undefined;
}

function storedAlbumArtistNeedsRepair(tracks: LockerEntry[]): boolean {
  return tracks.some((t) => {
    const aa = t.albumArtist?.trim();
    return Boolean(aa) && !isUsableArtistName(aa);
  });
}

export type AlbumIdentifyMatchType =
  | 'official_album'
  | 'partial_catalog'
  | 'track_consensus'
  | 'musicbrainz';

export interface AlbumIdentifyOutcome {
  updated: boolean;
  matchType?: AlbumIdentifyMatchType;
  artist?: string;
}

/**
 * Identify a locker album against the online catalog and persist corrected
 * album artist, release year, and genre when confidence is high.
 */
export async function identifyAndRepairAlbumGroup(
  albumName: string,
  groupArtist: string,
  tracks: LockerEntry[],
  options?: { allowNetwork?: boolean },
): Promise<AlbumIdentifyOutcome> {
  if (tracks.length === 0 || !albumName.trim()) return { updated: false };

  const allowNetwork = options?.allowNetwork !== false && !isAirGapEnabled();
  const consensus = lockerTrackArtistConsensus(tracks);
  const junkAlbum = isBadMediaStoreAlbum(albumName);
  const knownMixtape = lookupKnownMixtapeArtist(albumName);
  const artistHint = resolveIdentifyArtistHint(albumName, groupArtist, tracks, consensus);
  const trackIds = tracks.map((t) => t.id);
  const persistPatch = async (patch: Parameters<typeof updateAlbumGroupMetadata>[2]) => {
    await updateAlbumGroupMetadata(albumName, groupArtist, patch, { trackIds });
  };
  const needsFix =
    lockerAlbumArtistNeedsIdentification(tracks) || storedAlbumArtistNeedsRepair(tracks);

  if (junkAlbum) {
    const localArtist = consensus ?? artistHint ?? knownMixtape?.artist;
    if (!localArtist || isMislabeledPlaylistStubArtist(localArtist, tracks[0])) {
      return { updated: false };
    }
    const patch: Parameters<typeof updateAlbumGroupMetadata>[2] = {
      albumArtist: localArtist,
      albumName: '',
    };
    await persistPatch(patch);
    for (const track of tracks) {
      if (
        isMislabeledPlaylistStubArtist(track.artist, track) ||
        isBadMediaStoreArtist(track.artist)
      ) {
        await updateLockerEntryMetadata(
          track.id,
          { artist: localArtist },
          { skipCacheRefresh: true },
        );
      }
    }
    return { updated: true, matchType: 'track_consensus', artist: localArtist };
  }

  if (!allowNetwork) {
    const localArtist = consensus ?? knownMixtape?.artist;
    if (!needsFix || !localArtist) return { updated: false };
    await persistPatch({ albumArtist: localArtist });
    return { updated: true, matchType: 'track_consensus', artist: localArtist };
  }

  if (import.meta.env?.DEV) {
    console.debug('[catalog-identify]', albumName, {
      artistHint: artistHint ?? '(title-only)',
      trackCount: tracks.length,
      groupArtist,
    });
  }

  const releaseYear = tracks.find((t) => t.releaseYear?.trim())?.releaseYear?.trim();
  const trackTitles = tracks.map((t) => t.title.trim()).filter(Boolean);

  const match = await identifyCatalogAlbumByTitle(albumName, {
    trackCount: tracks.length,
    artistHint,
    trackTitles,
    releaseYear,
  });

  if (!match) {
    const fallbackArtist =
      consensus ??
      (artistHint && isUsableTrackArtist(artistHint) ? primaryLockerArtist(artistHint) : null) ??
      knownMixtape?.artist ??
      null;
    if (!fallbackArtist) return { updated: false };

    const patch: Parameters<typeof updateAlbumGroupMetadata>[2] = {};
    const storedAlbumArtist = tracks
      .map((t) => t.albumArtist?.trim())
      .find((a) => a && isUsableArtistName(a));
    const albumArtistWrong =
      needsFix ||
      !storedAlbumArtist ||
      normalizeToken(storedAlbumArtist) !== normalizeToken(fallbackArtist) ||
      isJunkImportArchiveLabel(storedAlbumArtist ?? '') ||
      isBadMediaStoreArtist(storedAlbumArtist);
    if (albumArtistWrong) patch.albumArtist = fallbackArtist;

    if (knownMixtape?.releaseYear) patch.releaseYear = knownMixtape.releaseYear;

    const enriched = await fetchReleaseEnrichment(albumName, fallbackArtist);
    if (enriched?.releaseYear) patch.releaseYear = enriched.releaseYear;
    if (enriched?.genre && tracks.some((t) => isMissingGenre(t.genre))) {
      patch.genre = enriched.genre;
    }

    if (Object.keys(patch).length === 0) return { updated: false };

    await persistPatch(patch);
    return {
      updated: true,
      matchType: enriched ? 'musicbrainz' : 'track_consensus',
      artist: fallbackArtist,
    };
  }

  if (
    match.confidence < APPLY_CATALOG_IDENTIFY_MIN_CONFIDENCE &&
    match.matchKind !== 'official'
  ) {
    const fallbackArtist =
      consensus ??
      (artistHint && isUsableTrackArtist(artistHint) ? primaryLockerArtist(artistHint) : null);
    if (!fallbackArtist) return { updated: false };
    const patch: Parameters<typeof updateAlbumGroupMetadata>[2] = {};
    if (needsFix) patch.albumArtist = fallbackArtist;
    if (Object.keys(patch).length === 0) return { updated: false };
    await persistPatch(patch);
    return { updated: true, matchType: 'track_consensus', artist: fallbackArtist };
  }

  const catalogArtist = primaryLockerArtist(match.album.artist.trim());
  if (
    !catalogArtist ||
    !isUsableTrackArtist(catalogArtist) ||
    isLeakWatermarkArtistName(catalogArtist) ||
    isJunkImportArchiveLabel(catalogArtist) ||
    isBadMediaStoreArtist(catalogArtist) ||
    artistLineContainsLeakWatermark(match.album.artist)
  ) {
    return { updated: false };
  }

  if (
    consensus &&
    normalizeToken(consensus) !== normalizeToken(catalogArtist) &&
    match.matchKind !== 'official'
  ) {
    const patch: Parameters<typeof updateAlbumGroupMetadata>[2] = {};
    if (needsFix) patch.albumArtist = consensus;
    if (Object.keys(patch).length === 0) return { updated: false };
    await persistPatch(patch);
    return { updated: true, matchType: 'track_consensus', artist: consensus };
  }

  const tracksNeedArtistEnrichment = tracks.some((t) => trackArtistNeedsEnrichment(t.artist));
  const trackArtistsUpdated = await enrichTrackArtistsFromCatalogMatch(tracks, match.album);

  const storedAlbumArtist = tracks
    .map((t) => t.albumArtist?.trim())
    .find((a) => a && isUsableArtistName(a));
  const alreadyCorrect =
    storedAlbumArtist &&
    normalizeToken(storedAlbumArtist) === normalizeToken(catalogArtist);
  if (
    alreadyCorrect &&
    !tracks.some((t) => isMissingGenre(t.genre)) &&
    match.matchKind === 'official' &&
    !tracksNeedArtistEnrichment &&
    !trackArtistsUpdated
  ) {
    return { updated: false, artist: catalogArtist };
  }

  const patch: Parameters<typeof updateAlbumGroupMetadata>[2] = {};
  if (needsFix || !storedAlbumArtist || !alreadyCorrect) {
    patch.albumArtist = catalogArtist;
  }
  if (match.album.releaseYear) patch.releaseYear = match.album.releaseYear;
  if (knownMixtape?.releaseYear && !patch.releaseYear) {
    patch.releaseYear = knownMixtape.releaseYear;
  }

  const enriched = await fetchReleaseEnrichment(albumName, catalogArtist);
  if (enriched?.releaseYear) patch.releaseYear = enriched.releaseYear;
  if (enriched?.genre && tracks.some((t) => isMissingGenre(t.genre))) {
    patch.genre = enriched.genre;
  }

  let albumMetaUpdated = false;
  if (Object.keys(patch).length > 0) {
    await persistPatch(patch);
    albumMetaUpdated = true;
  }

  if (!albumMetaUpdated && !trackArtistsUpdated) {
    return { updated: false, artist: catalogArtist };
  }

  let matchType: AlbumIdentifyMatchType;
  if (match.matchKind === 'official' && match.source === 'catalog') {
    matchType = 'official_album';
  } else if (match.source === 'musicbrainz') {
    matchType = 'musicbrainz';
  } else {
    matchType = 'partial_catalog';
  }

  return { updated: true, matchType, artist: catalogArtist };
}

export type MetadataRepairCancelToken = { cancelled: boolean };

export function createMetadataRepairCancelToken(): MetadataRepairCancelToken {
  return { cancelled: false };
}

/**
 * Async metadata repair job — chunked, cancelable, non-blocking.
 */
export async function repairLockerMetadata(
  tracks: LockerEntry[],
  options: MetadataRepairOptions = {},
  onProgress?: (progress: MetadataRepairProgress) => void,
  cancelToken?: MetadataRepairCancelToken,
): Promise<MetadataRepairResult> {
  const airGap = isAirGapEnabled();
  const allowNetwork = !airGap && options.allowNetwork !== false;

  const report = scanLockerMetadata(tracks);
  const total = report.totalIssues;

  const progress: MetadataRepairProgress = {
    phase: 'repairing',
    scanned: 0,
    total,
    issuesFound: total,
    repaired: 0,
    failed: 0,
    skippedNetwork: 0,
    airGapBlocked: airGap,
    message: airGap
      ? 'Air-Gap Mode active — network lookups skipped; running local repairs only.'
      : undefined,
  };

  const emit = () => onProgress?.({ ...progress });

  if (total === 0) {
    progress.phase = 'done';
    progress.message = 'No metadata issues found.';
    emit();
    return { progress, report };
  }

  emit();

  const albumGroups = new Map<string, { albumName: string; artist: string; tracks: LockerEntry[] }>();
  for (const entry of tracks) {
    const key = lockerAlbumGroupKey(entry);
    if (!key || !entry.albumName?.trim()) continue;
    const artist = lockerAlbumGroupArtist(entry);
    const existing = albumGroups.get(key);
    if (existing) existing.tracks.push(entry);
    else albumGroups.set(key, { albumName: entry.albumName.trim(), artist, tracks: [entry] });
  }

  const processedAlbumArt = new Set<string>();
  const processedReleaseGroup = new Set<string>();
  const processedArtists = new Set<string>();

  const wantArt = options.repairAlbumArt !== false;
  const wantArtistImg = options.repairArtistImages !== false;
  const wantGenre = options.repairGenres !== false;
  const wantRg = options.repairReleaseGroups !== false;
  const wantCredits = options.repairCredits !== false;
  const wantIdentify = options.repairAlbumIdentification !== false;

  let batchCount = 0;

  const step = async (label: string) => {
    progress.currentLabel = label;
    progress.scanned += 1;
    emit();
    batchCount += 1;
    if (batchCount >= BATCH_SIZE) {
      batchCount = 0;
      await yieldToMain();
    }
    if (cancelToken?.cancelled) {
      progress.phase = 'cancelled';
      progress.message = 'Repair cancelled.';
      emit();
      throw new Error('METADATA_REPAIR_CANCELLED');
    }
  };

  try {
    if (wantArt) {
      for (const issue of report.issues.filter((i) => i.type === MetadataIssueType.MissingAlbumArt)) {
        const key = issue.albumKey;
        if (!key || processedAlbumArt.has(key)) continue;
        processedAlbumArt.add(key);
        const group = albumGroups.get(key);
        if (!group) continue;

        await step(`Album art: ${group.albumName}`);

        let fixed = await tryEmbeddedCoverForGroup(group.albumName, group.artist, group.tracks);
        if (!fixed && allowNetwork) {
          const searchArtist = resolveAlbumSearchArtist(
            group.albumName,
            group.artist,
            group.tracks,
          );
          const found = await findAlbumCoverForLockerGroup(
            group.albumName,
            searchArtist,
            group.tracks,
          );
          if (found?.url) {
            fixed = await persistAlbumCoverForGroup(group.albumName, group.artist, found.url, {
              releaseYear: found.year,
            });
          }
        } else if (!fixed && !allowNetwork) {
          progress.skippedNetwork += 1;
        }

        if (fixed) progress.repaired += 1;
        else progress.failed += 1;
      }
    }

    if (wantCredits) {
      for (const issue of report.issues.filter((i) => i.type === MetadataIssueType.BrokenCredits)) {
        if (!issue.trackId) continue;
        const entry = tracks.find((t) => t.id === issue.trackId);
        if (!entry) continue;

        await step(`Credits: ${entry.title}`);

        const patch = normalizeCreditPatch(entry);
        if (patch) {
          try {
            await updateLockerEntryMetadata(entry.id, patch, { skipCacheRefresh: true });
            progress.repaired += 1;
          } catch {
            progress.failed += 1;
          }
        } else {
          progress.failed += 1;
        }
      }
    }

    if (wantIdentify) {
      const processedIdentify = new Set<string>();
      for (const issue of report.issues.filter(
        (i) => i.type === MetadataIssueType.WrongAlbumArtist,
      )) {
        const key = issue.albumKey;
        if (!key || processedIdentify.has(key)) continue;
        processedIdentify.add(key);
        const group = albumGroups.get(key);
        if (!group) continue;

        await step(`Identify album: ${group.albumName}`);

        if (!allowNetwork && !lockerAlbumArtistNeedsIdentification(group.tracks)) {
          progress.skippedNetwork += 1;
          progress.failed += 1;
          continue;
        }

        try {
          const outcome = await identifyAndRepairAlbumGroup(
            group.albumName,
            group.artist,
            group.tracks,
            { allowNetwork },
          );
          if (outcome.updated) progress.repaired += 1;
          else progress.failed += 1;
        } catch {
          progress.failed += 1;
        }
      }

      const repairedOrphanIds = new Set<string>();
      for (const entry of tracks) {
        if (
          !isMislabeledPlaylistStubArtist(entry.artist, entry) &&
          !isMislabeledPlaylistStubArtist(entry.albumArtist, entry)
        ) {
          continue;
        }
        if (repairedOrphanIds.has(entry.id)) continue;
        repairedOrphanIds.add(entry.id);
        await step(`Fix artist: ${entry.title}`);
        if (!allowNetwork) {
          progress.skippedNetwork += 1;
          progress.failed += 1;
          continue;
        }
        try {
          const ok = await fixLockerTrackFromOnlineLibrary(entry);
          if (ok) progress.repaired += 1;
          else progress.failed += 1;
        } catch {
          progress.failed += 1;
        }
      }
    }

    if (wantGenre) {
      for (const issue of report.issues.filter((i) => i.type === MetadataIssueType.MissingGenre)) {
        if (!issue.trackId) continue;
        const entry = tracks.find((t) => t.id === issue.trackId);
        if (!entry) continue;

        await step(`Genre: ${entry.title}`);

        let genre = await tryEmbeddedGenre(entry);
        if (!genre && allowNetwork && entry.albumName?.trim()) {
          const searchArtist = resolveAlbumSearchArtist(
            entry.albumName,
            lockerAlbumGroupArtist(entry),
            [entry],
          );
          const enriched = await fetchReleaseEnrichment(entry.albumName, searchArtist);
          genre = enriched?.genre;
        } else if (!genre && !allowNetwork) {
          progress.skippedNetwork += 1;
        }

        if (genre) {
          try {
            await updateLockerEntryMetadata(entry.id, { genre }, { skipCacheRefresh: true });
            progress.repaired += 1;
          } catch {
            progress.failed += 1;
          }
        } else {
          progress.failed += 1;
        }
      }
    }

    if (wantRg) {
      for (const issue of report.issues.filter((i) => i.type === MetadataIssueType.MissingReleaseGroup)) {
        const key = issue.albumKey;
        if (!key || processedReleaseGroup.has(key)) continue;
        processedReleaseGroup.add(key);
        const group = albumGroups.get(key);
        if (!group) continue;

        await step(`Release group: ${group.albumName}`);

        if (!allowNetwork) {
          progress.skippedNetwork += 1;
          progress.failed += 1;
          continue;
        }

        const searchArtist = resolveAlbumSearchArtist(
          group.albumName,
          group.artist,
          group.tracks,
        );
        const enriched = await fetchReleaseEnrichment(group.albumName, searchArtist);
        if (!enriched?.musicbrainzReleaseGroupId) {
          progress.failed += 1;
          continue;
        }

        const creditsJson = mergeCreditsJson(group.tracks[0]?.creditsJson, {
          musicbrainzReleaseId: enriched.musicbrainzReleaseId,
          musicbrainzReleaseGroupId: enriched.musicbrainzReleaseGroupId,
        });

        try {
          await updateAlbumGroupMetadata(group.albumName, group.artist, {
            creditsJson,
            releaseYear: enriched.releaseYear,
          });
          progress.repaired += 1;
        } catch {
          progress.failed += 1;
        }
      }
    }

    if (wantArtistImg) {
      for (const issue of report.issues.filter((i) => i.type === MetadataIssueType.MissingArtistImage)) {
        const name = issue.artistName?.trim();
        if (!name || processedArtists.has(name)) continue;
        processedArtists.add(name);

        await step(`Artist image: ${name}`);

        if (!allowNetwork) {
          progress.skippedNetwork += 1;
          progress.failed += 1;
          continue;
        }

        try {
          const url = await findArtistImage(name);
          if (url) progress.repaired += 1;
          else progress.failed += 1;
        } catch {
          progress.failed += 1;
        }
      }
    }

    await refreshLockerCache();
    progress.phase = 'done';
    progress.currentLabel = undefined;
    progress.message = `Found ${total} issues, repaired ${progress.repaired}.`;
    emit();
  } catch (err) {
    if ((err as Error).message === 'METADATA_REPAIR_CANCELLED') {
      await refreshLockerCache().catch(() => undefined);
      return { progress, report };
    }
    progress.phase = 'done';
    progress.message = (err as Error).message || 'Repair failed.';
    emit();
  }

  return { progress, report };
}

/** Human-readable issue type labels for UI. */
export const METADATA_ISSUE_LABELS: Record<MetadataIssueType, string> = {
  [MetadataIssueType.MissingAlbumArt]: 'Missing album art',
  [MetadataIssueType.MissingArtistImage]: 'Missing artist image',
  [MetadataIssueType.MissingGenre]: 'Missing genre',
  [MetadataIssueType.MissingReleaseGroup]: 'Missing release group',
  [MetadataIssueType.BrokenCredits]: 'Broken credits',
  [MetadataIssueType.WrongAlbumArtist]: 'Wrong album artist',
};
