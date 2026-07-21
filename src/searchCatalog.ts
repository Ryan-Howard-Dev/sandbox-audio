/**
 * Structured music catalog search for typeahead dropdown and artist drill-down.
 *
 * Locker-first by design: iTunes metadata proxy + local locker merge — not a Spotify-scale
 * streaming catalog. See docs/offline-capability.md.
 */

import { isAirGapEnabled } from './airGapMode';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  applyCachedArtistImages,
  artistNeedsPhotoLookup,
  attachFallbackArtistArtwork,
  attachFallbackTrackArtwork,
  findArtistImage,
  getCachedArtistImage,
  resolveArtistImages,
} from './artistImage';
import { featuredArtistsFromTrackTitle, sanitizeCoverArtUrl } from './displaySanitize';
import { catalogLookupUrl, catalogSearchUrl } from './catalogApi';
import { fetchCatalogApiResults, fetchCatalogChartsPayload } from './catalogFetch';
import { catalogArtworkUrl, catalogPlayUrlFromPreview, hasSameOriginCatalogProxy } from './catalogDirect';
import { fetchWithTimeout, raceTimeout } from './fetchWithTimeout';
import {
  artistLineContainsLeakWatermark,
  getLockerEntries,
  isBadMediaStoreArtist,
  isJunkImportArchiveLabel,
  isLeakWatermarkArtistName,
  isUsableArtistName,
  type LockerEntry,
} from './lockerStorage';
import {
  loadSearchSortOrder,
  parseReleaseYear,
  sortByReleaseYear,
  type SearchSortOrder,
} from './searchSettings';
import {
  CACHE_KEYS,
  prefixedCacheKey,
  readResponseCache,
  writeResponseCache,
} from './responseCache';
import {
  canRunWebSearch,
  fetchWebCatalogTracks,
  mergeWebCatalogResults,
} from './webCatalogSearch';
import { tier34SearchLocker } from './tier34/client';
import {
  artistIdFromEntry,
  buildAlbumCollections,
  detectEditionType,
  editionLabelForKind,
  editionToAlbumGroup,
  groupLockerSearchHits,
  normalizeIdentityKey,
  resolveCanonicalArtistForTrack,
  resolvePreferredEdition,
  type EditionKind,
} from './collectionIntelligence';

export type CatalogItemKind = 'artist' | 'album' | 'track';

export interface CatalogArtist {
  kind: 'artist';
  id: string;
  name: string;
  artworkUrl?: string;
}

export interface CatalogAlbum {
  kind: 'album';
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  releaseYear?: string;
  explicit?: boolean;
  /** iTunes collectionExplicitness — explicit vs cleaned when titles match. */
  contentRating?: 'explicit' | 'clean';
  collectionId?: number;
  trackCount?: number;
  /** Collection intelligence — editions under a release group. */
  editionCount?: number;
  releaseGroupId?: string;
  isCollectionEdition?: boolean;
}

export interface CatalogTrack {
  kind: 'track';
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  releaseYear?: string;
  explicit?: boolean;
  previewUrl?: string;
  durationSeconds?: number;
  trackNumber?: number;
  discNumber?: number;
  envelope?: MediaEnvelope;
}

export interface CatalogSearchResult {
  suggestions: string[];
  artists: CatalogArtist[];
  albums: CatalogAlbum[];
  tracks: CatalogTrack[];
}

interface CatalogProviderItem {
  wrapperType?: string;
  kind?: string;
  artistId?: number;
  collectionId?: number;
  trackId?: number;
  artistName?: string;
  collectionName?: string;
  collectionType?: string;
  trackCount?: number;
  trackName?: string;
  trackNumber?: number;
  discNumber?: number;
  releaseDate?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  trackExplicitness?: string;
  collectionExplicitness?: string;
}

/** Resolved artist+album query — full search returns this album's tracklist only. */
export interface AlbumIntentMatch {
  album: CatalogAlbum;
  confidence: number;
}

const ALBUM_INTENT_MIN_SCORE = 1000;
const ALBUM_INTENT_CACHE_MS = 30_000;
const albumIntentCache = new Map<string, { match: AlbumIntentMatch | null; at: number }>();

const CATALOG_SEARCH_LIMIT = 50;
const CATALOG_LOOKUP_LIMIT = 200;

const CHART_QUERY_RE =
  /^(top\s*hits?|top\s*charts?|charts?|trending(\s+now)?|popular(\s+now)?|hot\s*100|billboard|new\s*releases?)$/i;

/** Chart / trending queries should not literal-match iTunes track titles. */
export function isChartQuery(query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return q.length > 0 && CHART_QUERY_RE.test(q);
}

const EMPTY_CATALOG: CatalogSearchResult = {
  suggestions: [],
  artists: [],
  albums: [],
  tracks: [],
};

function queryRelevantTokens(query: string): string[] {
  return normalizeName(query).split(' ').filter((t) => t.length > 1);
}

/** Levenshtein edit distance for typo-tolerant search (melros → melrose). */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) matrix[i]![0] = i;
  for (let j = 0; j < cols; j++) matrix[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[rows - 1]![cols - 1]!;
}

/** Token pairs that must never fuzzy-match (different words, similar spelling). */
const FUZZY_NEVER_EQUIVALENT: ReadonlyArray<readonly [string, string]> = [
  ['dress', 'drip'],
  ['dress', 'drop'],
  ['dress', 'trip'],
];

/** True when two tokens are equal or within typo distance. */
export function fuzzyTokensEquivalent(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  for (const [left, right] of FUZZY_NEVER_EQUIVALENT) {
    if ((na === left && nb === right) || (na === right && nb === left)) return false;
  }
  if (na.includes(nb) || nb.includes(na)) return true;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen < 4) return false;
  const threshold = maxLen <= 6 ? 1 : maxLen <= 9 ? 2 : 3;
  return levenshteinDistance(na, nb) <= threshold;
}

function fuzzyTokenInHaystack(hay: string, token: string): boolean {
  if (hay.includes(token)) return true;
  return hay.split(' ').some((word) => fuzzyTokensEquivalent(word, token));
}

const KNOWN_TRACK_TITLE_CORRECTIONS: Record<string, string> = {
  melros: 'melrose',
};

/** Expand common typos / aliases for catalog + web search terms. */
export function expandFuzzyQueryCorrections(query: string): string[] {
  const tokens = queryRelevantTokens(query);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const key = normalizeName(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };

  for (const token of tokens) {
    const corrected = KNOWN_TRACK_TITLE_CORRECTIONS[token];
    if (corrected) {
      push(query.replace(new RegExp(token, 'i'), corrected));
    }
    for (const [typo, fix] of Object.entries(KNOWN_TRACK_TITLE_CORRECTIONS)) {
      if (fuzzyTokensEquivalent(token, typo)) {
        push(query.replace(new RegExp(token, 'i'), fix));
      }
    }
  }

  if (tokens.length === 1) {
    for (const fix of Object.values(KNOWN_TRACK_TITLE_CORRECTIONS)) {
      if (fuzzyTokensEquivalent(tokens[0]!, fix)) push(fix);
    }
  }

  return out;
}

function collapseQueryAliases(query: string): string {
  return query
    .replace(/\bback\s*street\b/gi, 'backstreet')
    .replace(/\bes\s*dee\s*kid\b/gi, 'EsDeeKid')
    .replace(/\bwant\s+it\s+that\s+way\b/gi, 'i want it that way');
}

function stripCoverMarkersFromQuery(query: string): string {
  return collapseQueryAliases(query)
    .replace(/\b(cover(?:ed|ing|s)?|karaoke|tribute)\b/gi, ' ')
    .replace(/\bthe\s+song\b/gi, ' ')
    .replace(/\bsong\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTokensBeyondArtist(artistHaystack: string, query: string): string[] {
  const hay = normalizeName(artistHaystack);
  return queryRelevantTokens(query).filter((t) => !hay.includes(t));
}

function extraQueryTokensMatchAlbumOrTitle(
  albumName: string | undefined,
  title: string,
  extraTokens: string[],
): boolean {
  if (extraTokens.length === 0) return true;
  const hay = normalizeName(`${albumName ?? ''} ${title}`);
  return extraTokens.every((t) => hay.includes(t));
}

function lockerEntryMatchesQuery(entry: LockerEntry, query: string): boolean {
  const tokens = queryRelevantTokens(query);
  if (!tokens.length) return false;

  const artistField = (entry.albumArtist || entry.artist).trim();
  const extraTokens = queryTokensBeyondArtist(artistField, query);
  if (
    extraTokens.length > 0 &&
    !extraQueryTokensMatchAlbumOrTitle(entry.albumName, entry.title, extraTokens)
  ) {
    return false;
  }

  const hay = normalizeName(
    `${entry.artist} ${entry.albumArtist ?? ''} ${entry.title} ${entry.albumName ?? ''} ${entry.genre}`,
  );
  return tokens.every((token) => hay.includes(token));
}

function albumTitleRelevanceScore(albumTitle: string, query: string): number {
  if (albumTitlesAreExclusiveVariants(query, albumTitle)) return 0;
  const n = normalizeName(albumTitle);
  const q = normalizeName(query);
  if (!q || !n) return 0;
  if (n === q) return 1000;
  if (albumTitlesFuzzyMatch(query, albumTitle)) return 700;
  const qWords = q.split(' ').filter(Boolean);
  if (qWords.length > 0 && qWords.every((w) => n.includes(w))) return 500;
  return 0;
}

function trackSearchRelevanceScore(track: CatalogTrack, query: string): number {
  const artistField = (track.artist ?? '').trim();
  const extraTokens = queryTokensBeyondArtist(artistField, query);
  let score = artistRelevanceScore(track.artist, query) * 10;
  score += artistRelevanceScore(track.title, query);
  score += textRelevanceScore(track.title, query);

  if (isLikelyTrackTitleQuery(query)) {
    const titleScore = textRelevanceScore(track.title, query);
    if (titleScore >= 350) score += titleScore * 2;
    const combined = parseCombinedTrackQuery(query);
    if (combined && artistRelevanceScore(track.artist, combined.artist) >= 500) {
      score += 400;
    }
    const cover = parseCoverTrackQuery(query);
    if (cover && artistRelevanceScore(track.artist, cover.performer) >= 500) {
      score += 400;
    }
  }

  if (track.album) {
    score += albumTitleRelevanceScore(track.album, query);
    if (extraTokens.length > 0) {
      const albumHay = normalizeName(track.album);
      const albumHits = extraTokens.filter((t) => albumHay.includes(t)).length;
      score += albumHits >= extraTokens.length ? 1200 : albumHits * 200;
    }
  }

  if (
    extraTokens.length > 0 &&
    extraQueryTokensMatchAlbumOrTitle(track.album, track.title, extraTokens)
  ) {
    score += 800;
  }

  const isLocal = track.id.startsWith('local-');
  if (isLocal && extraTokens.length > 0) {
    score -= 500;
  } else if (isLocal) {
    score += 100;
  }

  return score;
}

function rankTracksByQueryRelevance(tracks: CatalogTrack[], query: string): CatalogTrack[] {
  return [...tracks].sort(
    (a, b) => trackSearchRelevanceScore(b, query) - trackSearchRelevanceScore(a, query),
  );
}

function lockerTrackEnvelope(entry: LockerEntry): MediaEnvelope {
  return {
    envelopeId: `local-${entry.id}`,
    title: entry.title,
    artist: entry.artist,
    url: entry.url,
    durationSeconds: entry.durationSeconds || 210,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: entry.id,
    artworkUrl: entry.albumArt,
    releaseYear: entry.releaseYear,
  };
}

async function fetchLocalSearchCatalog(query: string): Promise<CatalogSearchResult> {
  const q = query.trim();
  if (q.length < 2) return EMPTY_CATALOG;

  const meili = await tier34SearchLocker(q, { limit: 24 });
  if (meili.ok && meili.hits.length > 0) {
    const grouped = groupLockerSearchHits(meili.hits, (hit) => ({
      kind: 'track' as const,
      id: `local-track-${hit.envelopeId}`,
      title: hit.title,
      artist: hit.artist,
      album: hit.album || undefined,
      releaseYear: hit.year || undefined,
      envelope: {
        envelopeId: `local-${hit.envelopeId}`,
        title: hit.title,
        artist: hit.artist,
        album: hit.album,
        url: `/api/locker/blob/${hit.hash}`,
        durationSeconds: 210,
        provider: 'local-vault',
        transport: 'element-src',
        sourceId: hit.envelopeId,
        releaseYear: hit.year,
      },
    }));

    const tracks = grouped.flatMap((g) => g.tracks);
    const albums: CatalogAlbum[] = grouped.map((g) => {
      const primary = g.albums[0];
      return {
        kind: 'album',
        id: `local-collection-${g.collectionKey}`,
        title: g.title,
        artist: g.artist,
        releaseYear: primary?.releaseYear,
        trackCount: g.tracks.length,
        editionCount: g.editionCount,
        releaseGroupId: g.releaseGroupId ?? undefined,
        isCollectionEdition: g.editionCount > 1,
      };
    });

    const artistMap = new Map<string, CatalogArtist>();
    for (const track of tracks) {
      const key = normalizeName(track.artist);
      if (!artistMap.has(key)) {
        artistMap.set(key, {
          kind: 'artist',
          id: `local-artist-${key.replace(/\s+/g, '-')}`,
          name: track.artist,
        });
      }
    }

    return {
      suggestions: [q],
      artists: [...artistMap.values()].slice(0, 4),
      albums: albums.slice(0, 6),
      tracks: rankTracksByQueryRelevance(tracks, q).slice(0, 8),
    };
  }

  let entries: LockerEntry[];
  try {
    entries = await getLockerEntries();
  } catch {
    return EMPTY_CATALOG;
  }

  const matches = entries.filter((entry) => lockerEntryMatchesQuery(entry, q));
  if (matches.length === 0) return EMPTY_CATALOG;

  const tracks: CatalogTrack[] = matches.map((entry) => ({
    kind: 'track' as const,
    id: `local-track-${entry.id}`,
    title: entry.title,
    artist: entry.artist,
    album: entry.albumName,
    artworkUrl: entry.albumArt,
    releaseYear: entry.releaseYear,
    envelope: lockerTrackEnvelope(entry),
  }));

  const artistMap = new Map<string, CatalogArtist>();
  for (const entry of matches) {
    const { name: artistName } = resolveCanonicalArtistForTrack(entry);
    if (artistName && artistRelevanceScore(artistName, q) > 0) {
      const artistKey = normalizeName(artistName);
      if (!artistMap.has(artistKey)) {
        artistMap.set(artistKey, {
          kind: 'artist',
          id: `local-artist-${artistKey.replace(/\s+/g, '-')}`,
          name: artistName,
        });
      }
    }
  }

  const collections = buildAlbumCollections(matches);
  const albumMap = new Map<string, CatalogAlbum>();
  for (const collection of collections) {
    const edition = resolvePreferredEdition(collection);
    const group = editionToAlbumGroup(collection, edition);
    const artwork = group.tracks.find((t) => t.albumArt)?.albumArt;
    albumMap.set(collection.key, {
      kind: 'album',
      id: collection.releaseGroupId
        ? `local-collection-${collection.key}`
        : `local-album-${group.key.replace(/\s+/g, '-')}`,
      title: collection.displayName,
      artist: collection.artist,
      artworkUrl: artwork,
      releaseYear: edition.year ?? group.tracks.find((t) => t.releaseYear)?.releaseYear,
      trackCount: edition.trackCount,
      editionCount: collection.editionCount,
      releaseGroupId: collection.releaseGroupId ?? undefined,
      isCollectionEdition: collection.editionCount > 1,
    });
  }

  const suggestions: string[] = [];
  const seenSuggestions = new Set<string>();
  const pushSuggestion = (value: string) => {
    const key = value.trim().toLowerCase();
    if (!key || seenSuggestions.has(key)) return;
    seenSuggestions.add(key);
    suggestions.push(value.trim());
  };

  pushSuggestion(q);
  for (const artist of artistMap.values()) pushSuggestion(artist.name);
  for (const album of albumMap.values()) pushSuggestion(`${album.artist} ${album.title}`);

  const artists = rankArtistsByRelevance([...artistMap.values()], q)
    .filter((artist) => artistRelevanceScore(artist.name, q) > 0)
    .slice(0, 4);

  const albums = sortByReleaseYear([...albumMap.values()])
    .sort((a, b) => albumRelevanceScore(b.artist, q) - albumRelevanceScore(a.artist, q))
    .slice(0, 6);

  return {
    suggestions: suggestions.slice(0, 6),
    artists,
    albums,
    tracks: tracks.slice(0, 8),
  };
}

function mergeCatalogResults(
  local: CatalogSearchResult,
  remote: CatalogSearchResult,
  query: string,
): CatalogSearchResult {
  const suggestionSeen = new Set<string>();
  const suggestions: string[] = [];
  for (const suggestion of [...local.suggestions, ...remote.suggestions]) {
    const key = suggestion.toLowerCase();
    if (suggestionSeen.has(key)) continue;
    suggestionSeen.add(key);
    suggestions.push(suggestion);
  }

  const artistSeen = new Set<string>();
  const mergedArtists: CatalogArtist[] = [];
  for (const artist of [...local.artists, ...remote.artists]) {
    const key = normalizeName(artist.name);
    if (artistSeen.has(key)) continue;
    artistSeen.add(key);
    mergedArtists.push(artist);
  }

  const albumSeen = new Set<string>();
  const mergedAlbums: CatalogAlbum[] = [];
  for (const album of [...local.albums, ...remote.albums]) {
    const key = `${normalizeName(album.artist)}::${normalizeName(album.title)}`;
    if (albumSeen.has(key)) continue;
    albumSeen.add(key);
    mergedAlbums.push(album);
  }

  const trackSeen = new Set<string>();
  const mergedTracks: CatalogTrack[] = [];
  for (const track of rankTracksByQueryRelevance([...local.tracks, ...remote.tracks], query)) {
    const key = `${normalizeName(track.artist)}::${normalizeName(track.title)}`;
    if (trackSeen.has(key)) continue;
    trackSeen.add(key);
    mergedTracks.push(track);
  }

  const artists = rankArtistsByRelevance(mergedArtists, query)
    .filter((artist) => artistRelevanceScore(artist.name, query) > 0)
    .slice(0, 4);

  const rankedAlbums = sortByReleaseYear(mergedAlbums).sort(
    (a, b) => albumRelevanceScore(b.artist, query) - albumRelevanceScore(a.artist, query),
  );
  const topArtistScore = artists[0] ? artistRelevanceScore(artists[0].name, query) : 0;
  const albumCandidates =
    topArtistScore >= 900
      ? rankedAlbums.filter((album) => albumRelevanceScore(album.artist, query) >= 500)
      : rankedAlbums.filter((album) => albumRelevanceScore(album.artist, query) > 0);
  const albums = (albumCandidates.length > 0 ? albumCandidates : rankedAlbums).slice(0, 6);

  return {
    suggestions: suggestions.slice(0, 6),
    artists,
    albums,
    tracks: mergedTracks.slice(0, 8),
  };
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ÿý]/g, 'y')
    .replace(/[¥$,]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** iTunes billing splits (Ye vs Kanye West, JAŸ-Z vs Jay-Z, EsDeeKid spellings, …). */
const ARTIST_ALIAS_GROUPS: readonly string[][] = [
  ['kanye west', 'ye', 'kanye', 'kanye omari west'],
  ['ty dolla sign', 'ty dolla ign', 'ty dolla $ign'],
  ['jay z', 'jay-z', 'jaÿ-z', 'jaÿ z'],
  // UK drill — iTunes entity is EsDeeKid; fans type Esdeekid / Esdee Kid / ESD EEKID.
  ['esdeekid', 'esdee kid', 'es dee kid', 'esd eekid'],
];

/** Canonical iTunes artist id — sparse billing duplicates (6776577113) have no discography. */
const KANYE_WEST_CATALOG_ID = 2715720;
const KANYE_SPARSE_BILLING_IDS = new Set([6776577113]);

function forcedCanonicalCatalogArtistId(name: string, hintId?: number): number | undefined {
  if (hintId != null && KANYE_SPARSE_BILLING_IDS.has(hintId)) {
    return KANYE_WEST_CATALOG_ID;
  }
  const aliasKey = artistAliasKey(name);
  const kanyeKey = artistAliasKey('Kanye West');
  if (aliasKey != null && kanyeKey != null && aliasKey === kanyeKey) {
    return KANYE_WEST_CATALOG_ID;
  }
  return undefined;
}

function artistAliasKey(name: string): string | undefined {
  const n = normalizeName(name);
  for (const group of ARTIST_ALIAS_GROUPS) {
    if (group.some((alias) => normalizeName(alias) === n)) {
      return group.map((alias) => normalizeName(alias)).sort().join('|');
    }
  }
  return undefined;
}

function artistNamesEquivalent(name: string, query: string): boolean {
  const a = artistAliasKey(name);
  const b = artistAliasKey(query);
  return a != null && b != null && a === b;
}

const MIXTAPE_TITLE_MARKERS =
  /\b(mixtape|mix\s*tape|bootleg|unofficial|fan\s*made|street\s*album|demos?)\b/gi;
const COVER_ARTIST_PREFIX_RE = /^(?:kan\s+the|kon\s+the|kanye\s+the|the)\s+/i;

export interface KnownMixtapeMatch {
  artist: string;
  releaseYear?: string;
}

/**
 * Last-resort fallback for obscure fan mixtapes not findable via iTunes/MusicBrainz alone.
 * Official studio albums (The Chronic, MBDTF, etc.) must match through catalog APIs without this table.
 */
export function lookupKnownMixtapeArtist(title: string): KnownMixtapeMatch | null {
  const core = normalizeAlbumTitleForMatch(title);
  if (core.includes('louis vuitton don')) {
    return { artist: 'Kanye West', releaseYear: '2004' };
  }
  return null;
}

function extractDjHostFromAlbumTitle(title: string): string | null {
  const match = title.match(
    /\bDJ\s+([A-Za-z][A-Za-z0-9\s.'-]{1,28}?)(?:\s*[-–—]|\s+(?:present|presents)|\s*$)/i,
  );
  if (!match?.[1]?.trim()) return null;
  return `DJ ${match[1].trim()}`;
}

/** Strip mixtape/bootleg markers and cover-art nicknames for fuzzy album matching. */
export function normalizeAlbumTitleForMatch(title: string): string {
  let t = title.trim();
  t = t.replace(MIXTAPE_TITLE_MARKERS, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(COVER_ARTIST_PREFIX_RE, '').trim();
  return normalizeName(t);
}

function albumTitleSearchVariants(title: string): string[] {
  const trimmed = title.trim();
  const stripped = trimmed.replace(MIXTAPE_TITLE_MARKERS, ' ').replace(/\s+/g, ' ').trim();
  const core = normalizeAlbumTitleForMatch(trimmed);
  const variants = new Set<string>();
  if (trimmed.length >= 4) variants.add(trimmed);
  if (stripped.length >= 4 && stripped !== trimmed) variants.add(stripped);
  if (core.length >= 4) variants.add(core);
  return [...variants];
}

function primaryArtistName(artistName: string): string {
  const segment = artistName.split(/\s*(?:&|feat\.?|ft\.?|featuring|with)\s*/i)[0] ?? artistName;
  return normalizeName(segment);
}

function isPrimaryArtistAlbum(artistName: string, targetName: string): boolean {
  const target = normalizeName(targetName);
  const full = normalizeName(artistName);
  if (full === target) return true;
  if (artistNamesEquivalent(artistName, targetName)) return true;
  if (artistNamesEquivalent(primaryArtistName(artistName), targetName)) return true;
  return primaryArtistName(artistName) === target;
}

/** True when target artist is billed anywhere on the release (e.g. JPEGMAFIA & Danny Brown). */
function artistBillingIncludesTarget(artistName: string, targetName: string): boolean {
  if (isPrimaryArtistAlbum(artistName, targetName)) return true;
  return parseCatalogArtistBilling(artistName).some(
    (billed) =>
      isPrimaryArtistAlbum(billed, targetName) || artistNamesEquivalent(billed, targetName),
  );
}

function albumRelevanceScore(artistName: string, query: string): number {
  const base = artistRelevanceScore(artistName, query);
  if (base === 0) return 0;
  if (isPrimaryArtistAlbum(artistName, query)) return base + 200;
  return Math.max(0, base - 150);
}

function artistRelevanceScore(name: string, query: string): number {
  const n = normalizeName(name);
  const q = normalizeName(query);
  if (!q) return 0;
  if (artistNamesEquivalent(name, query)) return 1000;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 900;
  const qWords = q.split(' ').filter(Boolean);
  if (qWords.length > 1 && qWords.every((w) => n.includes(w))) {
    return n.startsWith(qWords[0]) ? 700 : 500;
  }
  if (n.includes(q)) return 300;
  if (qWords.some((w) => n.includes(w))) return 100;
  if (qWords.length === 1 && qWords[0]!.length >= 4) {
    const nWords = n.split(' ').filter(Boolean);
    if (nWords.some((w) => fuzzyTokensEquivalent(w, qWords[0]!))) return 400;
    if (fuzzyTokensEquivalent(n, qWords[0]!)) return 500;
  }
  return 0;
}

/** Relevance with fuzzy token overlap — shared by catalog + unified search. */
export function textRelevanceScore(text: string, query: string): number {
  let score = artistRelevanceScore(text, query);
  if (score > 0) return score;
  const n = normalizeName(text);
  const tokens = queryRelevantTokens(query).filter((t) => !TRACK_QUERY_STOP_WORDS.has(t));
  if (!tokens.length || !n) return 0;
  const matched = tokens.filter((t) => fuzzyTokenInHaystack(n, t)).length;
  if (matched === tokens.length) return 600;
  if (matched >= Math.max(1, tokens.length - 1)) return 350;
  if (trackTitlesFuzzyMatch(text, query)) return 450;
  return 0;
}

function rankArtistsByRelevance(artists: CatalogArtist[], query: string): CatalogArtist[] {
  return [...artists].sort(
    (a, b) => artistRelevanceScore(b.name, query) - artistRelevanceScore(a.name, query),
  );
}

function isSingleCollection(item: CatalogProviderItem): boolean {
  const type = item.collectionType?.toLowerCase();
  const trackCount = item.trackCount;

  if (type === 'single') return true;

  // Multi-track releases (albums, EPs) belong in Albums — not Singles.
  if ((trackCount ?? 0) >= 2) return false;

  // iTunes often labels 1-track singles as collectionType Album.
  if (type === 'album' && trackCount === 1) return true;

  const wrapper = (item.wrapperType ?? item.kind ?? '').toLowerCase();
  if (wrapper === 'track' && item.trackName && item.collectionName) {
    const coll = item.collectionName.toLowerCase();
    if (coll === item.trackName.toLowerCase()) return true;
    if (coll.includes('- single') || coll.endsWith(' single')) return true;
  }
  const name = item.collectionName?.toLowerCase() ?? '';
  if (name.includes('- single') || name.endsWith(' single')) return true;
  if (name.includes(' - ep') || name.endsWith(' ep')) {
    return trackCount === undefined || trackCount <= 1;
  }
  if (trackCount === 1) return true;
  return false;
}

function isCompilationCollection(item: CatalogProviderItem): boolean {
  const type = item.collectionType?.toLowerCase();
  if (type === 'compilation') return true;
  const name = item.collectionName?.toLowerCase() ?? '';
  return (
    name.includes('greatest hits') ||
    name.includes('best of') ||
    name.includes(' anthology') ||
    name.includes('complete collection') ||
    name.includes('box set') ||
    name.includes('various artists') ||
    name.includes('summer hits') ||
    name.includes('party mix') ||
    name.includes('workout mix') ||
    name.includes('dj mix') ||
    name.includes('continuous mix')
  );
}

const CLUTTER_COLLECTION_RE =
  /\b(remix|remixes|rework|edit|bootleg|tribute|karaoke|instrumental|acapella|a\s*cappella|cover version|dj mix|mixed by|continuous mix|raws|playlist|soundtrack|original motion picture|original cast|vs\.|versus)\b/i;

const CLUTTER_TRACK_RE =
  /\b(remix|rework|edit|bootleg|karaoke|instrumental|acapella|a\s*cappella|dj mix|mixed by|continuous mix)\b/i;

/** DJ mixes, compilation remixes, tribute/karaoke rows — not artist-owned singles or albums. */
function isClutterCollection(item: CatalogProviderItem): boolean {
  if (isCompilationCollection(item)) return true;
  const coll = item.collectionName ?? '';
  if (coll && CLUTTER_COLLECTION_RE.test(coll)) return true;
  const track = item.trackName ?? '';
  if (track && CLUTTER_TRACK_RE.test(track) && !/\boriginal\b/i.test(track)) return true;
  return false;
}

const DISCOGRAPHY_NOISE_RE =
  /\b(live at|live in|live from|unplugged|concert film|symphony orchestra|collector'?s edition|super deluxe|complete studio albums|curated edition)\b/i;

/** Live recordings, collab billing, and heavy reissue box noise — not core studio albums. */
function isDiscographyNoiseCollection(
  item: CatalogProviderItem,
  artistName: string,
): boolean {
  const coll = item.collectionName ?? '';
  if (!coll) return false;
  if (DISCOGRAPHY_NOISE_RE.test(coll)) return true;
  if (!isPrimaryArtistAlbum(item.artistName ?? '', artistName)) {
    if (/\b(feat\.|featuring|with |& |\/ )\b/i.test(coll)) return true;
  }
  return false;
}

function topTrackPriority(item: CatalogProviderItem, artistName: string): number {
  if (isClutterCollection(item)) return -10_000;
  if (!isPrimaryArtistAlbum(item.artistName ?? '', artistName)) return -5_000;
  let score = parseReleaseYear(releaseYearFrom(item.releaseDate));
  if (isSingleCollection(item)) score += 500;
  else if (!isCompilationCollection(item)) score += 200;
  if (item.trackNumber === 1) score += 50;
  return score;
}

/** Score how well query tokens split into artist + album for a catalog album row. */
function scoreAlbumIntentMatch(
  artistName: string,
  albumTitle: string,
  query: string,
): number {
  const qTokens = queryRelevantTokens(query);
  if (qTokens.length < 2) return 0;

  const nAlbum = normalizeName(albumTitle);
  let best = 0;

  const trySplit = (artistTokens: string[], albumTokens: string[]) => {
    if (artistTokens.length === 0 || albumTokens.length === 0) return;
    const artistPart = artistTokens.join(' ');
    const albumPart = albumTokens.join(' ');
    const artistScore = artistRelevanceScore(artistName, artistPart);
    if (artistScore < 500) return;
    if (albumTitlesAreExclusiveVariants(albumPart, albumTitle)) return;
    const albumHay = nAlbum;
    if (!albumTokens.every((t) => albumHay.includes(t))) return;
    const albumScore = albumTitleRelevanceScore(albumTitle, albumPart);
    if (albumScore < 300) return;
    let total = artistScore + albumScore * 2;
    if (isPrimaryArtistAlbum(artistName, artistPart)) total += 300;
    if (albumTokens.every((t) => normalizeName(albumTitle) === t || nAlbum === t)) {
      total += 200;
    }
    best = Math.max(best, total);
  };

  for (let split = 1; split < qTokens.length; split++) {
    trySplit(qTokens.slice(0, split), qTokens.slice(split));
    trySplit(qTokens.slice(split), qTokens.slice(0, split));
  }

  return best;
}

function providerItemToAlbum(item: CatalogProviderItem): CatalogAlbum | null {
  if (!item.collectionName || !item.artistName) return null;
  return {
    kind: 'album',
    id: `album-${item.collectionId ?? item.collectionName}`,
    title: item.collectionName,
    artist: item.artistName,
    artworkUrl: upscaleArtwork(item.artworkUrl100 ?? item.artworkUrl60),
    releaseYear: releaseYearFrom(item.releaseDate),
    explicit: isExplicit(item),
    contentRating: catalogContentRating(item),
    collectionId: item.collectionId,
    trackCount: item.trackCount,
  };
}

/**
 * Upgrade a partial duplicate (e.g. 4-track BULLY) to the canonical fuller release.
 */
export async function canonicalizeAlbumHint(album: CatalogAlbum): Promise<CatalogAlbum> {
  const title = album.title.trim();
  if (!title || isLikelyPartialReleaseTitle(title)) return album;

  const knownCount = album.trackCount ?? 0;
  if (knownCount >= 8 && album.collectionId) return album;

  const resolved = await resolveAlbumIntent(`${album.artist} ${title}`);
  if (!resolved?.album.collectionId) return album;
  if (!albumTitlesFuzzyMatch(resolved.album.title, title)) return album;

  const resolvedCount = resolved.album.trackCount ?? 0;
  if (resolvedCount > knownCount) {
    return resolved.album;
  }
  return album;
}

/**
 * Detect artist+album search intent (e.g. "Kanye West Bully", "Drake Views").
 * Returns the best-matching catalog album when confidence is high enough.
 */
export async function resolveAlbumIntent(query: string): Promise<AlbumIntentMatch | null> {
  if (isAirGapEnabled()) return null;
  const q = query.trim();
  if (q.length < 3 || isChartQuery(q)) return null;

  const cacheKey = normalizeName(q);
  const cached = albumIntentCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ALBUM_INTENT_CACHE_MS) {
    return cached.match;
  }

  const match = await resolveAlbumIntentUncached(q);
  albumIntentCache.set(cacheKey, { match, at: Date.now() });
  return match;
}

async function resolveAlbumIntentUncached(query: string): Promise<AlbumIntentMatch | null> {
  const qTokens = queryRelevantTokens(query);
  if (qTokens.length < 2) return null;

  const [albumItems, songItems] = await Promise.all([
    fetchCatalogApiResults(
      catalogSearchUrl({ term: query, entity: 'album', limit: 25 }),
    ),
    fetchCatalogApiResults(
      catalogSearchUrl({ term: query, entity: 'song', limit: 50 }),
    ),
  ]);

  const candidates = new Map<
    number,
    { item: CatalogProviderItem; score: number; songHits: number }
  >();

  const consider = (item: CatalogProviderItem, songHits = 0) => {
    if (!item.collectionName || !item.artistName || !item.collectionId) return;
    if (isSingleCollection(item) || isCompilationCollection(item) || isClutterCollection(item)) {
      return;
    }

    const baseScore = scoreAlbumIntentMatch(
      item.artistName,
      item.collectionName,
      query,
    );
    if (baseScore < ALBUM_INTENT_MIN_SCORE) return;

    const clusterBoost = Math.min(songHits * 40, 500);
    const trackBoost = Math.min((item.trackCount ?? 0) * 12, 360);
    const score = baseScore + clusterBoost + trackBoost;

    const existing = candidates.get(item.collectionId);
    if (!existing || score > existing.score) {
      candidates.set(item.collectionId, { item, score, songHits });
    }
  };

  for (const item of albumItems) {
    consider(item, 0);
  }

  const songClusters = new Map<number, number>();
  for (const item of songItems) {
    if (!item.collectionId || !item.collectionName || !item.artistName) continue;
    if (isSingleCollection(item) || isCompilationCollection(item) || isClutterCollection(item)) {
      continue;
    }
    const baseScore = scoreAlbumIntentMatch(
      item.artistName,
      item.collectionName,
      query,
    );
    if (baseScore < ALBUM_INTENT_MIN_SCORE) continue;
    songClusters.set(item.collectionId, (songClusters.get(item.collectionId) ?? 0) + 1);
  }

  for (const item of songItems) {
    if (!item.collectionId) continue;
    const hits = songClusters.get(item.collectionId) ?? 0;
    if (hits === 0) continue;
    consider(item, hits);
  }

  collapseDuplicateAlbumCandidates(candidates);

  let best: AlbumIntentMatch | null = null;
  for (const { item, score } of candidates.values()) {
    const album = providerItemToAlbum(item);
    if (!album) continue;
    if (!best || score > best.confidence) {
      best = { album, confidence: score };
    } else if (
      score === best.confidence &&
      (album.trackCount ?? 0) > (best.album.trackCount ?? 0)
    ) {
      best = { album, confidence: score };
    }
  }

  if (!best) {
    best = await resolveAlbumIntentViaArtistLookup(qTokens);
  }

  return best;
}

/**
 * iTunes text search often misses new/indie albums (e.g. EsDeeKid "Rebel").
 * Fall back to artist lookup + album token match on the artist discography.
 */
async function resolveAlbumIntentViaArtistLookup(
  qTokens: string[],
): Promise<AlbumIntentMatch | null> {
  let best: AlbumIntentMatch | null = null;

  const tryArtistAlbum = async (artistPart: string, albumTokens: string[]) => {
    if (!artistPart || albumTokens.length === 0) return;

    const artistItems = await fetchCatalogApiResults(
      catalogSearchUrl({ term: artistPart, entity: 'musicArtist', limit: 8 }),
    );
    const rankedArtists = artistItems
      .filter((item) => item.artistId && item.artistName)
      .map((item) => ({
        item,
        score: artistRelevanceScore(item.artistName!, artistPart),
      }))
      .filter((x) => x.score >= 500)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const { item: artistItem } of rankedArtists) {
      const albumItems = await fetchCatalogApiResults(
        catalogLookupUrl({
          id: artistItem.artistId!,
          entity: 'album',
          limit: 100,
        }),
      );

      for (const item of albumItems) {
        if (!item.collectionName || !item.collectionId) continue;
        if (isSingleCollection(item) || isCompilationCollection(item) || isClutterCollection(item)) {
          continue;
        }

        const albumPart = albumTokens.join(' ');
        const nAlbum = normalizeName(item.collectionName);
        if (albumTitlesAreExclusiveVariants(albumPart, item.collectionName)) continue;
        if (!albumTokens.every((t) => nAlbum.includes(t))) continue;

        const albumScore = albumTitleRelevanceScore(item.collectionName, albumPart);
        if (albumScore < 300) continue;

        let score =
          artistRelevanceScore(artistItem.artistName!, artistPart) + albumScore * 2;
        if (isPrimaryArtistAlbum(artistItem.artistName!, artistPart)) score += 300;
        if (score < ALBUM_INTENT_MIN_SCORE) continue;

        const album = providerItemToAlbum({
          ...item,
          artistName: artistItem.artistName,
        });
        if (!album) continue;
        if (!best || score > best.confidence) {
          best = { album, confidence: score };
        } else if (
          score === best.confidence &&
          (album.trackCount ?? 0) > (best.album.trackCount ?? 0)
        ) {
          best = { album, confidence: score };
        }
      }
    }
  };

  for (let split = 1; split < qTokens.length; split++) {
    await tryArtistAlbum(qTokens.slice(0, split).join(' '), qTokens.slice(split));
    await tryArtistAlbum(qTokens.slice(split).join(' '), qTokens.slice(0, split));
  }

  return best;
}

/** Exact album tracklist when the query targets a specific album. */
export async function fetchAlbumIntentTracks(query: string): Promise<CatalogTrack[]> {
  const match = await resolveAlbumIntent(query);
  if (!match) return [];
  return fetchAlbumTracks(match.album);
}

export interface AlbumIdentificationHints {
  trackCount?: number;
  artistHint?: string;
  /** Local track titles — enables tracklist fingerprint matching when album artist tags are wrong. */
  trackTitles?: string[];
  releaseYear?: string;
}

export type CatalogMatchKind = 'official' | 'partial' | 'artist_only';

export interface CatalogIdentificationMatch {
  album: CatalogAlbum;
  confidence: number;
  matchKind: CatalogMatchKind;
  source: 'catalog' | 'musicbrainz';
}

const ALBUM_TITLE_IDENTIFY_MIN_SCORE = 1200;
const ALBUM_TITLE_PARTIAL_MIN_SCORE = 550;
const albumTitleIdentifyCache = new Map<
  string,
  { match: CatalogIdentificationMatch | null; at: number }
>();

function catalogIdentificationFromIntent(
  intent: AlbumIntentMatch,
  matchKind: CatalogMatchKind = 'official',
): CatalogIdentificationMatch {
  return {
    album: intent.album,
    confidence: intent.confidence,
    matchKind,
    source: 'catalog',
  };
}

const TRACK_TITLE_PAREN_FEAT_RE =
  /\s*[\(\[](?:feat\.?|ft\.?|featuring|with)\s+[^)\]]+[\)\]]/gi;

/** Normalize a track title for fingerprint comparison (strip feat markers, punctuation). */
export function normalizeTrackTitleForMatch(title: string): string {
  let t = title.trim();
  t = t.replace(TRACK_TITLE_PAREN_FEAT_RE, '');
  t = t.replace(/[''`´]/g, "'");
  t = t.replace(/[^\w\s']/g, ' ');
  return normalizeName(t);
}

/** Fuzzy match between local and catalog track titles. */
export function trackTitlesFuzzyMatch(a: string, b: string): boolean {
  if (titlesLooseMatch(a, b)) return true;
  const na = normalizeTrackTitleForMatch(a);
  const nb = normalizeTrackTitleForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wordsA = na.split(' ').filter((w) => w.length > 1);
  const wordsB = nb.split(' ').filter((w) => w.length > 1);
  if (wordsA.length >= 2 && wordsB.length >= 2) {
    const overlap = wordsA.filter((w) => wordsB.includes(w)).length;
    const minLen = Math.min(wordsA.length, wordsB.length);
    if (overlap >= Math.max(2, minLen - 2)) return true;
  }
  return false;
}

/** Score how well a local tracklist matches a catalog album tracklist (0–1500+). */
export function scoreTracklistFingerprint(
  localTitles: string[],
  catalogTitles: string[],
): { score: number; matched: number; ratio: number } {
  const locals = localTitles.map((t) => t.trim()).filter(Boolean);
  const catalogs = catalogTitles.map((t) => t.trim()).filter(Boolean);
  if (locals.length === 0 || catalogs.length === 0) {
    return { score: 0, matched: 0, ratio: 0 };
  }

  const used = new Set<number>();
  let matched = 0;
  for (const local of locals) {
    const idx = catalogs.findIndex(
      (cat, i) => !used.has(i) && trackTitlesFuzzyMatch(local, cat),
    );
    if (idx >= 0) {
      matched += 1;
      used.add(idx);
    }
  }

  const total = Math.max(locals.length, catalogs.length);
  const ratio = total > 0 ? matched / total : 0;
  const score = Math.round(ratio * 1000) + matched * 50;
  return { score, matched, ratio };
}

function fingerprintCacheSuffix(trackTitles: string[]): string {
  const core = trackTitles
    .slice(0, 8)
    .map((t) => normalizeTrackTitleForMatch(t))
    .join('|');
  return core.slice(0, 120);
}

const FINGERPRINT_MIN_MATCHED = 4;
const FINGERPRINT_MIN_RATIO = 0.45;

/**
 * Identify an album by comparing local track titles against catalog tracklists.
 * Resolves famous releases (e.g. The Chronic → Dr. Dre) when ID3 artist tags are leak watermarks.
 */
export async function identifyAlbumByTrackFingerprint(
  albumName: string,
  tracks: { title: string }[],
  year?: string,
): Promise<CatalogIdentificationMatch | null> {
  if (isAirGapEnabled()) return null;
  const albumTitle = albumName.trim();
  const trackTitles = tracks.map((t) => t.title.trim()).filter(Boolean);
  if (albumTitle.length < 4 || trackTitles.length < FINGERPRINT_MIN_MATCHED) return null;

  const trackCount = trackTitles.length;
  const candidateMap = new Map<string, CatalogAlbum>();

  for (const variant of albumTitleSearchVariants(albumTitle)) {
    const items = await fetchCatalogApiResults(
      catalogSearchUrl({ term: variant, entity: 'album', limit: 25 }),
    );
    for (const item of items) {
      if (!item.collectionName || !item.artistName || !item.collectionId) continue;
      if (catalogArtistIsLeakWatermark(item.artistName)) continue;
      if (isSingleCollection(item) || isCompilationCollection(item) || isClutterCollection(item)) {
        continue;
      }
      if (!albumTitlesFuzzyMatch(item.collectionName, albumTitle)) continue;
      if (item.trackCount) {
        const diff = Math.abs(item.trackCount - trackCount);
        if (diff > 5) continue;
      }
      const album = providerItemToAlbum(item);
      if (!album) continue;
      const key = String(album.collectionId ?? album.id);
      if (!candidateMap.has(key)) candidateMap.set(key, album);
    }
  }

  const mbTitleMatch = await searchMbReleaseForIdentification(albumTitle, undefined);
  if (mbTitleMatch) {
    const mbArtist = primaryArtistFromCredit(mbTitleMatch.album.artist);
    if (mbArtist && isUsableArtistName(mbArtist)) {
      for (const variant of albumTitleSearchVariants(albumTitle)) {
        const viaArtist = await searchItunesAlbumViaArtistDiscography(
          mbArtist,
          variant,
          albumTitle,
          trackCount,
        );
        if (viaArtist?.album.collectionId) {
          candidateMap.set(String(viaArtist.album.collectionId), viaArtist.album);
        }
      }
    }
  }

  let best: CatalogIdentificationMatch | null = null;
  const candidates = [...candidateMap.values()].slice(0, 10);

  for (const album of candidates) {
    if (catalogArtistIsLeakWatermark(album.artist)) continue;
    const catalogTracks = await fetchAlbumTracks(album);
    if (catalogTracks.length < FINGERPRINT_MIN_MATCHED) continue;

    const fp = scoreTracklistFingerprint(
      trackTitles,
      catalogTracks.map((t) => t.title),
    );
    const minMatched = Math.max(
      FINGERPRINT_MIN_MATCHED,
      Math.ceil(trackCount * FINGERPRINT_MIN_RATIO),
    );
    if (fp.matched < minMatched || fp.ratio < FINGERPRINT_MIN_RATIO) continue;

    let confidence = fp.score + 500;
    if (year && album.releaseYear === year) confidence += 250;
    if (album.trackCount && Math.abs(album.trackCount - trackCount) <= 1) confidence += 150;
    if (fp.ratio >= 0.75) confidence += 350;
    if (fp.ratio >= 0.9) confidence += 200;

    const matchKind: CatalogMatchKind =
      fp.ratio >= 0.7 && fp.matched >= Math.ceil(trackCount * 0.65) ? 'official' : 'partial';

    if (!best || confidence > best.confidence) {
      best = { album, confidence, matchKind, source: 'catalog' };
    }

    await new Promise((r) => setTimeout(r, 60));
  }

  if (import.meta.env?.DEV && best) {
    console.debug('[catalog-fingerprint]', albumTitle, '→', best.album.artist, best.confidence);
  }

  return best;
}

/** Score an iTunes album row for locker identification — requires a trusted artist hint. */
export function scoreCatalogAlbumIdentification(
  item: CatalogProviderItem,
  albumTitle: string,
  artistHint?: string,
  trackCount?: number,
): { score: number; matchKind: CatalogMatchKind } | null {
  if (!item.collectionName || !item.artistName || !item.collectionId) return null;
  if (catalogArtistIsLeakWatermark(item.artistName)) return null;
  if (isSingleCollection(item) || isCompilationCollection(item) || isClutterCollection(item)) {
    return null;
  }
  if (!albumTitlesFuzzyMatch(item.collectionName, albumTitle)) return null;

  const trustedHint = artistHint?.trim() && isUsableArtistName(artistHint) ? artistHint.trim() : undefined;
  // Title-only iTunes matches collide across artists (e.g. Anne Wilson "REBEL" vs EsDeeKid "Rebel").
  if (!trustedHint) return null;

  let score = albumTitleRelevanceScore(item.collectionName, albumTitle);
  if (score < 300) return null;
  if (normalizeName(item.collectionName) === normalizeName(albumTitle)) score += 400;
  else if (albumTitlesFuzzyMatch(item.collectionName, albumTitle)) score += 200;

  if (trackCount && item.trackCount) {
    const diff = Math.abs(item.trackCount - trackCount);
    if (diff === 0) score += 300;
    else if (diff <= 2) score += 150;
    else if (diff <= 4) score -= 200;
    else return null;
  } else if (trackCount && trackCount >= 10 && (item.trackCount ?? 0) < trackCount - 4) {
    return null;
  }

  const artistScore = artistRelevanceScore(item.artistName, trustedHint);
  if (artistScore < 500) return null;
  score += Math.round(artistScore * 0.6);

  score += Math.min((item.trackCount ?? 0) * 8, 200);

  const exactTitle =
    normalizeName(item.collectionName) === normalizeName(albumTitle) ||
    normalizeAlbumTitleForMatch(item.collectionName) === normalizeAlbumTitleForMatch(albumTitle);
  const minScore =
    artistScore >= 700 ? ALBUM_TITLE_PARTIAL_MIN_SCORE : ALBUM_TITLE_IDENTIFY_MIN_SCORE;
  if (score < minScore) return null;

  let matchKind: CatalogMatchKind = 'partial';
  if (score >= ALBUM_TITLE_IDENTIFY_MIN_SCORE && exactTitle && artistScore >= 500) {
    matchKind = 'official';
  } else if (!exactTitle && artistScore >= 700) {
    matchKind = 'artist_only';
  }

  return { score, matchKind };
}

function primaryArtistFromCredit(artistCredit: string): string {
  const segment = artistCredit.split(/\s*(?:&|feat\.?|ft\.?|featuring|with|,)\s*/i)[0] ?? artistCredit;
  return segment.trim();
}

/** Reject catalog matches whose credited artist is a scene leak watermark (CANSE, etc.). */
function catalogArtistIsLeakWatermark(artistCredit: string): boolean {
  const trimmed = artistCredit.trim();
  if (!trimmed) return false;
  const primary = primaryArtistFromCredit(trimmed);
  return (
    isLeakWatermarkArtistName(primary) ||
    isLeakWatermarkArtistName(trimmed) ||
    artistLineContainsLeakWatermark(trimmed)
  );
}

function isUsableCatalogIdentificationMatch(
  match: CatalogIdentificationMatch | null,
): match is CatalogIdentificationMatch {
  if (!match) return false;
  if (catalogArtistIsLeakWatermark(match.album.artist)) return false;
  const primary = primaryArtistFromCredit(match.album.artist);
  if (isJunkImportArchiveLabel(primary) || isJunkImportArchiveLabel(match.album.artist)) {
    return false;
  }
  if (isBadMediaStoreArtist(primary) || isBadMediaStoreArtist(match.album.artist)) {
    return false;
  }
  return true;
}

/** iTunes artist lookup + discography scan — finds albums text search misses (e.g. Dr. Dre — The Chronic). */
async function searchItunesAlbumViaArtistDiscography(
  artistName: string,
  albumSearchTitle: string,
  albumTitle: string,
  trackCount?: number,
): Promise<CatalogIdentificationMatch | null> {
  const artistItems = await fetchCatalogApiResults(
    catalogSearchUrl({ term: artistName, entity: 'musicArtist', limit: 8 }),
  );
  const rankedArtists = artistItems
    .filter((item) => item.artistId && item.artistName)
    .map((item) => ({
      item,
      score: artistRelevanceScore(item.artistName!, artistName),
    }))
    .filter((x) => x.score >= 500)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  let best: CatalogIdentificationMatch | null = null;

  for (const { item: artistItem } of rankedArtists) {
    const albumItems = await fetchCatalogApiResults(
      catalogLookupUrl({
        id: artistItem.artistId!,
        entity: 'album',
        limit: 100,
      }),
    );

    for (const item of albumItems) {
      const scored = scoreCatalogAlbumIdentification(
        { ...item, artistName: artistItem.artistName },
        albumTitle,
        artistName,
        trackCount,
      );
      if (!scored) continue;
      if (!albumTitlesFuzzyMatch(item.collectionName ?? '', albumSearchTitle)) continue;

      const album = providerItemToAlbum({
        ...item,
        artistName: artistItem.artistName,
      });
      if (!album) continue;

      const confidence = scored.score + 150;
      if (!best || confidence > best.confidence) {
        best = {
          album,
          confidence,
          matchKind: scored.matchKind,
          source: 'catalog',
        };
      }
    }
  }

  return best;
}

async function searchCatalogAlbumsForIdentification(
  searchTerm: string,
  albumTitle: string,
  artistHint?: string,
  trackCount?: number,
): Promise<CatalogIdentificationMatch | null> {
  const items = await fetchCatalogApiResults(
    catalogSearchUrl({ term: searchTerm, entity: 'album', limit: 25 }),
  );

  let best: CatalogIdentificationMatch | null = null;
  for (const item of items) {
    const scored = scoreCatalogAlbumIdentification(item, albumTitle, artistHint, trackCount);
    if (!scored) continue;

    const album = providerItemToAlbum(item);
    if (!album) continue;

    if (!best || scored.score > best.confidence) {
      best = {
        album,
        confidence: scored.score,
        matchKind: scored.matchKind,
        source: 'catalog',
      };
    } else if (
      scored.score === best.confidence &&
      (album.trackCount ?? 0) > (best.album.trackCount ?? 0)
    ) {
      best = {
        album,
        confidence: scored.score,
        matchKind: scored.matchKind,
        source: 'catalog',
      };
    }
  }
  return best;
}

/**
 * Match a locker upload to a catalog album by title (MusicBrainz first; iTunes only with artist hint).
 * Used when ID3 album artist (TPE2) is wrong but the release title is known.
 */
export async function identifyCatalogAlbumByTitle(
  title: string,
  hints?: AlbumIdentificationHints,
): Promise<CatalogIdentificationMatch | null> {
  if (isAirGapEnabled()) return null;
  const albumTitle = title.trim();
  if (albumTitle.length < 4) return null;

  const rawHint = hints?.artistHint?.trim();
  const knownMixtape = lookupKnownMixtapeArtist(albumTitle);
  const artistHint = isUsableArtistName(rawHint) ? rawHint : undefined;

  if (import.meta.env?.DEV) {
    console.debug('[catalog-identify] queries for', albumTitle, {
      rawHint: rawHint || '(none)',
      artistHint: artistHint ?? '(title-only / MusicBrainz first)',
      trackCount: hints?.trackCount,
    });
  }

  const cacheKey = `${normalizeName(albumTitle)}|${hints?.trackCount ?? 0}|${normalizeName(artistHint ?? '')}|${hints?.releaseYear ?? ''}|${hints?.trackTitles?.length ? fingerprintCacheSuffix(hints.trackTitles) : ''}`;
  const cached = albumTitleIdentifyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ALBUM_INTENT_CACHE_MS) {
    return cached.match;
  }

  const trackCount = hints?.trackCount;
  const trackTitles = hints?.trackTitles?.map((t) => t.trim()).filter(Boolean);
  const releaseYear = hints?.releaseYear?.trim();
  let best: CatalogIdentificationMatch | null = null;

  let fingerprintMatch: CatalogIdentificationMatch | null = null;

  const consider = (candidate: CatalogIdentificationMatch | null) => {
    if (!isUsableCatalogIdentificationMatch(candidate)) return;
    if (!best || candidate.confidence > best.confidence) best = candidate;
  };

  // Tracklist fingerprint — strongest signal when album artist tags are garbage (CANSE, etc.).
  if (trackTitles && trackTitles.length >= FINGERPRINT_MIN_MATCHED) {
    fingerprintMatch = await identifyAlbumByTrackFingerprint(
      albumTitle,
      trackTitles.map((title) => ({ title })),
      releaseYear,
    );
    if (isUsableCatalogIdentificationMatch(fingerprintMatch)) {
      consider(fingerprintMatch);
    } else {
      fingerprintMatch = null;
    }
  }

  // MusicBrainz title search first — canonical artist for famous albums (Dr. Dre, Kanye West, …).
  const mbTitleMatch = await searchMbReleaseForIdentification(albumTitle, undefined);
  consider(mbTitleMatch);

  if (mbTitleMatch && mbTitleMatch.matchKind !== 'artist_only') {
    const mbArtist = primaryArtistFromCredit(mbTitleMatch.album.artist);
    if (mbArtist && isUsableArtistName(mbArtist)) {
      for (const variant of albumTitleSearchVariants(albumTitle)) {
        consider(
          await searchItunesAlbumViaArtistDiscography(
            mbArtist,
            variant,
            albumTitle,
            trackCount,
          ),
        );
        const intent = await resolveAlbumIntent(`${mbArtist} ${variant}`);
        if (intent && albumTitlesFuzzyMatch(intent.album.title, albumTitle)) {
          consider(catalogIdentificationFromIntent(intent, 'official'));
        }
      }
    }
  }

  // iTunes album search requires a trusted artist hint — title-only hits wrong releases.
  if (artistHint) {
    for (const variant of albumTitleSearchVariants(albumTitle)) {
      consider(
        await searchCatalogAlbumsForIdentification(
          `${artistHint} ${variant}`,
          albumTitle,
          artistHint,
          trackCount,
        ),
      );
    }
  }

  if (artistHint) {
    for (const variant of albumTitleSearchVariants(albumTitle)) {
      const intent = await resolveAlbumIntent(`${artistHint} ${variant}`);
      if (intent && albumTitlesFuzzyMatch(intent.album.title, albumTitle)) {
        consider(catalogIdentificationFromIntent(intent, 'official'));
      }
    }
    consider(await searchMbReleaseForIdentification(albumTitle, artistHint));
    consider(await resolveCatalogArtistAsFallback(artistHint, albumTitle));
  }

  const djHost = extractDjHostFromAlbumTitle(albumTitle);
  if (djHost && djHost !== artistHint) {
    consider(await resolveCatalogArtistAsFallback(djHost, albumTitle));
  }

  // Obscure fan mixtapes only — after all catalog API paths.
  if (knownMixtape) {
    if (!best || best.confidence < ALBUM_TITLE_PARTIAL_MIN_SCORE) {
      consider({
        album: {
          kind: 'album',
          id: `mixtape-${normalizeName(knownMixtape.artist)}-${normalizeName(albumTitle)}`,
          title: albumTitle,
          artist: knownMixtape.artist,
          releaseYear: knownMixtape.releaseYear,
        },
        confidence: 850,
        matchKind: 'partial',
        source: 'catalog',
      });
    }
    consider(await resolveCatalogArtistAsFallback(knownMixtape.artist, albumTitle));
    consider(await searchMbReleaseForIdentification(albumTitle, knownMixtape.artist));
    for (const variant of albumTitleSearchVariants(albumTitle)) {
      consider(
        await searchCatalogAlbumsForIdentification(
          `${knownMixtape.artist} ${variant}`,
          albumTitle,
          knownMixtape.artist,
          trackCount,
        ),
      );
    }
  }

  if (
    fingerprintMatch &&
    isUsableCatalogIdentificationMatch(fingerprintMatch) &&
    best &&
    best.source === 'catalog' &&
    best.matchKind === 'partial' &&
    fingerprintMatch.confidence >= best.confidence - 250
  ) {
    best = fingerprintMatch;
  }

  // Title-only: prefer MusicBrainz over any residual iTunes/catalog hit.
  if (
    !artistHint &&
    mbTitleMatch &&
    isUsableCatalogIdentificationMatch(mbTitleMatch) &&
    (!best || best.source === 'catalog' || mbTitleMatch.confidence >= best.confidence - 200)
  ) {
    best = mbTitleMatch;
  }

  albumTitleIdentifyCache.set(cacheKey, { match: best, at: Date.now() });
  return best;
}

export function trackBelongsToAlbum(
  track: { artist?: string; album?: string },
  album: CatalogAlbum,
): boolean {
  if (!track.album) return false;
  if (!collectionMatchesTargetAlbum(track.album, album.title)) return false;
  if (track.artist && !artistMatchesDiscography(track.artist, album.artist)) return false;
  return true;
}

function parseArtistNumericId(catalogId?: string): number | undefined {
  if (!catalogId) return undefined;
  const match = catalogId.match(/^artist-(\d+)$/);
  return match ? parseInt(match[1], 10) : undefined;
}

async function searchCatalogArtistId(name: string): Promise<number | undefined> {
  const items = await fetchCatalogApiResults(
    catalogSearchUrl({
      term: name,
      entity: 'musicArtist',
      limit: 10,
    }),
  );
  const candidates = items.filter(
    (item) => item.wrapperType === 'artist' && item.artistId && item.artistName,
  );
  if (candidates.length === 0) return undefined;

  candidates.sort(
    (a, b) =>
      artistRelevanceScore(b.artistName ?? '', name) -
      artistRelevanceScore(a.artistName ?? '', name),
  );
  const best = candidates[0];
  if (!best?.artistId || artistRelevanceScore(best.artistName ?? '', name) < 500) {
    return undefined;
  }
  return best.artistId;
}

interface InferredArtistMatch {
  artistId: number;
  artistName: string;
  confidence: number;
}

/**
 * Split "Artist Track Title" queries into a catalog artist id (system-wide, not per-artist hacks).
 */
async function inferArtistFromCompositeQuery(
  query: string,
): Promise<InferredArtistMatch | null> {
  const tokens = queryRelevantTokens(query);
  if (tokens.length < 2) return null;

  let best: InferredArtistMatch | null = null;

  const consider = (
    artistId: number,
    artistName: string,
    artistScore: number,
    restTokens: string[],
  ) => {
    let confidence = artistScore;
    if (restTokens.length > 0) {
      confidence += 120;
    }
    if (!best || confidence > best.confidence) {
      best = { artistId, artistName, confidence };
    }
  };

  for (let split = 1; split < tokens.length; split++) {
    const attempts: [string, string[]][] = [
      [tokens.slice(0, split).join(' '), tokens.slice(split)],
      [tokens.slice(split).join(' '), tokens.slice(0, split)],
    ];
    for (const [artistPart, restTokens] of attempts) {
      const items = await fetchCatalogApiResults(
        catalogSearchUrl({ term: artistPart, entity: 'musicArtist', limit: 8 }),
      );
      const ranked = items
        .filter((item) => item.artistId && item.artistName)
        .map((item) => ({
          item,
          score: artistRelevanceScore(item.artistName!, artistPart),
        }))
        .filter((x) => x.score >= 500)
        .sort((a, b) => b.score - a.score);

      for (const { item, score } of ranked.slice(0, 2)) {
        if (restTokens.length > 0) {
          const songs = await fetchCatalogApiResults(
            catalogSearchUrl({ term: query, entity: 'song', limit: 20 }),
          );
          const trackHit = songs.some(
            (song) =>
              song.trackName &&
              (song.artistId === item.artistId ||
                artistMatchesDiscography(song.artistName ?? '', item.artistName!)) &&
              extraQueryTokensMatchAlbumOrTitle(
                song.collectionName,
                song.trackName,
                restTokens,
              ),
          );
          if (!trackHit) continue;
        }
        consider(item.artistId!, item.artistName!, score, restTokens);
      }
    }
  }

  return best && best.confidence >= 500 ? best : null;
}

async function resolveCatalogArtistId(
  name: string,
  hintId?: number,
): Promise<number | undefined> {
  const forced = forcedCanonicalCatalogArtistId(name, hintId);
  if (forced) return forced;

  let searched: number | undefined;
  try {
    searched = await searchCatalogArtistId(name);
  } catch {
    searched = undefined;
  }

  if (hintId) {
    try {
      const verify = await fetchCatalogApiResults(
        catalogLookupUrl({ id: hintId, entity: 'musicArtist' }),
      );
      const entity = verify.find(
        (item) => item.wrapperType === 'artist' && item.artistId === hintId,
      );
      if (
        entity?.artistName &&
        (artistNamesEquivalent(entity.artistName, name) ||
          artistRelevanceScore(entity.artistName, name) >= 500)
      ) {
        if (searched && searched !== hintId) {
          const hintAlbums = await fetchCatalogApiResults(
            catalogLookupUrl({ id: hintId, entity: 'album', limit: 10 }),
          );
          const albumCount = hintAlbums.filter(
            (item) => item.wrapperType === 'collection' || item.collectionName,
          ).length;
          if (albumCount < 2) return searched;
        }
        return hintId;
      }
    } catch {
      /* fall through to name search */
    }
  }

  if (searched) return searched;

  const composite = await inferArtistFromCompositeQuery(name);
  if (composite) return composite.artistId;

  const n = normalizeName(name);
  for (const group of ARTIST_ALIAS_GROUPS) {
    if (!group.some((alias) => normalizeName(alias) === n)) continue;
    for (const alias of group) {
      if (normalizeName(alias) === n) continue;
      try {
        const aliasId = await searchCatalogArtistId(alias);
        if (aliasId) return aliasId;
      } catch {
        /* try next alias */
      }
    }
  }
  if (hintId) return hintId;
  return undefined;
}

function artistMatchesDiscography(artistName: string, targetName: string): boolean {
  if (artistBillingIncludesTarget(artistName, targetName)) return true;
  const score = artistRelevanceScore(artistName, targetName);
  return score >= 700;
}

function pickArtworkFromItems(items: CatalogProviderItem[], targetName: string): string | undefined {
  for (const item of items) {
    const url = item.artworkUrl100 ?? item.artworkUrl60;
    if (!url || !item.artistName) continue;
    if (isPrimaryArtistAlbum(item.artistName, targetName)) {
      return upscaleArtwork(url);
    }
  }
  for (const item of items) {
    const url = item.artworkUrl100 ?? item.artworkUrl60;
    if (url) return upscaleArtwork(url);
  }
  return undefined;
}


/** Strip remaster/deluxe/anniversary/collector suffixes for canonical album grouping. */
function stripCatalogEditionSuffixes(title: string): string {
  let t = (title ?? '').trim();
  t = t.replace(/\s*[\(\[]([^\)\]]*)[\)\]]/gi, (match, inner: string) => {
    const hay = inner.toLowerCase();
    if (
      /\b(deluxe|remaster|anniversary|collector|super deluxe|expanded|special edition|complete edition|bonus tracks?|hi[- ]?res|24[- ]?bit|50th|40th|30th|20th|anniv|digital master|half[- ]speed)\b/.test(
        hay,
      )
    ) {
      return '';
    }
    return match;
  });
  t = t.replace(
    /\s*-\s*(deluxe edition|deluxe|remaster(ed)?(\s+edition)?|anniversary edition|super deluxe|collector'?s edition|expanded edition|special edition|half[- ]speed master)\s*$/gi,
    '',
  );
  t = t.replace(/\s*-\s*(single|ep)$/i, '');
  return t.trim();
}

function normalizeAlbumDedupeKey(title: string): string {
  return normalizeIdentityKey(stripCatalogEditionSuffixes(title));
}

/** Collapse billing variants (Future & Metro Boomin vs Future, Metro Boomin) for dedupe keys. */
export function normalizeCatalogArtistKey(name: string): string {
  return normalizeIdentityKey(name)
    .replace(/\s*&\s*/g, ' and ')
    .replace(/,/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

function catalogAlbumDedupeKey(artist: string, title: string): string {
  return `${normalizeCatalogArtistKey(artist)}::${normalizeAlbumDedupeKey(title)}`;
}

/** Dedupe key for singles — same title normalization as albums (strips "- Single", edition tags). */
export function catalogSingleDedupeKey(artist: string, title: string): string {
  const aliasKey = artistAliasKey(artist);
  const artistKey = aliasKey ?? normalizeCatalogArtistKey(artist);
  return `${artistKey}::${normalizeAlbumDedupeKey(title)}`;
}

function catalogSingleDisplayTitle(title: string): string {
  return title.replace(/\s*-\s*Single$/i, '').trim();
}

function catalogArtworkQualityScore(url?: string): number {
  if (!url) return 0;
  if (url.includes('1200x1200') || url.includes('1000x1000')) return 6;
  if (url.includes('600x600')) return 5;
  if (url.includes('100x100')) return 2;
  return 1;
}

function preferCatalogSingle(a: CatalogTrack, b: CatalogTrack): CatalogTrack {
  const score = (t: CatalogTrack) =>
    catalogArtworkQualityScore(t.artworkUrl) +
    (t.envelope ? 10 : 0) +
    (t.previewUrl ? 1 : 0);
  return score(a) >= score(b) ? a : b;
}

function upsertCatalogSingle(map: Map<string, CatalogTrack>, track: CatalogTrack): void {
  const key = catalogSingleDedupeKey(track.artist, track.title);
  const existing = map.get(key);
  map.set(key, existing ? preferCatalogSingle(existing, track) : track);
}

/** Move 1-track "album" rows into Singles; keep only multi-track releases in Albums. */
function partitionDiscographyAlbums(
  albums: CatalogAlbum[],
  singlesMap: Map<string, CatalogTrack>,
): CatalogAlbum[] {
  const kept: CatalogAlbum[] = [];
  for (const album of albums) {
    if (album.trackCount === 1) {
      upsertCatalogSingle(singlesMap, {
        kind: 'track',
        id: album.id,
        title: catalogSingleDisplayTitle(album.title),
        artist: album.artist,
        album: album.title,
        artworkUrl: album.artworkUrl,
        releaseYear: album.releaseYear,
        explicit: album.explicit,
      });
      continue;
    }
    kept.push(album);
  }
  return kept;
}

export function dedupeCatalogSingles(singles: CatalogTrack[]): CatalogTrack[] {
  const byKey = new Map<string, CatalogTrack>();
  for (const single of singles) {
    upsertCatalogSingle(byKey, single);
  }
  return [...byKey.values()];
}

export function catalogAlbumIdentityKey(
  artist: string,
  title: string,
): string {
  return catalogAlbumDedupeKey(artist, title);
}

export function dedupeCatalogAlbums(albums: CatalogAlbum[]): CatalogAlbum[] {
  return listCatalogAlbumEditions(albums);
}

/** Keep each iTunes collection visible (Deluxe, Standard, …) — only merge exact duplicates. */
export function listCatalogAlbumEditions(albums: CatalogAlbum[]): CatalogAlbum[] {
  const byCollectionId = new Map<number, CatalogAlbum>();
  const withoutId: CatalogAlbum[] = [];

  for (const album of albums) {
    const collectionId = album.collectionId;
    if (collectionId != null && collectionId > 0) {
      const existing = byCollectionId.get(collectionId);
      byCollectionId.set(
        collectionId,
        existing ? preferCatalogEdition(existing, album) : album,
      );
      continue;
    }
    withoutId.push(album);
  }

  const fromIds = [...byCollectionId.values()];
  const byExact = new Map<string, CatalogAlbum>();
  for (const album of withoutId) {
    const key = `${normalizeCatalogArtistKey(album.artist)}::${normalizeName(album.title)}`;
    const existing = byExact.get(key);
    byExact.set(key, existing ? preferCatalogEdition(existing, album) : album);
  }

  return collapsePartialAlbumReleases([...fromIds, ...byExact.values()]);
}

/** Drop obvious sampler/partial tiles when a much fuller sibling shares the same album identity. */
function collapsePartialAlbumReleases(albums: CatalogAlbum[]): CatalogAlbum[] {
  const byIdentity = new Map<string, CatalogAlbum[]>();
  for (const album of albums) {
    const key = catalogAlbumIdentityKey(album.artist, album.title);
    const group = byIdentity.get(key) ?? [];
    group.push(album);
    byIdentity.set(key, group);
  }

  const out: CatalogAlbum[] = [];
  for (const group of byIdentity.values()) {
    if (group.length < 2) {
      out.push(...group);
      continue;
    }
    const ranked = [...group].sort(
      (a, b) => (b.trackCount ?? 0) - (a.trackCount ?? 0),
    );
    const keeperCount = ranked[0]!.trackCount ?? 0;
    for (const album of ranked) {
      const count = album.trackCount ?? 0;
      if (
        album !== ranked[0] &&
        keeperCount >= 6 &&
        count < keeperCount &&
        keeperCount >= count * 2
      ) {
        continue;
      }
      out.push(album);
    }
  }
  return out;
}

function isSparseCatalogAlbumGhost(album: CatalogAlbum): boolean {
  return (
    album.id.startsWith('mb-rg-') &&
    (album.collectionId == null || album.collectionId <= 0) &&
    (album.trackCount == null || album.trackCount <= 0) &&
    !album.artworkUrl?.trim()
  );
}

function catalogAlbumRichnessScore(album: CatalogAlbum): number {
  return (
    (album.collectionId != null && album.collectionId > 0 ? 1000 : 0) +
    (album.trackCount ?? 0) * 10 +
    catalogArtworkQualityScore(album.artworkUrl) * 50
  );
}

/** Remove MusicBrainz placeholder tiles when a fuller iTunes sibling shares the title. */
export function dropSparseMbAlbumGhosts(albums: CatalogAlbum[]): CatalogAlbum[] {
  if (!albums.some(isSparseCatalogAlbumGhost)) return albums;
  return albums.filter((album) => {
    if (!isSparseCatalogAlbumGhost(album)) return true;
    const ghostScore = catalogAlbumRichnessScore(album);
    return !albums.some(
      (other) =>
        other !== album &&
        !isSparseCatalogAlbumGhost(other) &&
        albumTitlesFuzzyMatch(other.title, album.title) &&
        catalogAlbumRichnessScore(other) > ghostScore,
    );
  });
}

function selectArtistDiscographyAlbums(
  albums: CatalogAlbum[],
  artistName: string,
  artistId?: number,
): CatalogAlbum[] {
  const soloAlbums = albums.filter((a) => isPrimaryArtistAlbum(a.artist, artistName));
  const billedCollabAlbums = albums.filter(
    (a) => !isPrimaryArtistAlbum(a.artist, artistName) && artistBillingIncludesTarget(a.artist, artistName),
  );
  if (artistId || soloAlbums.length < 2) return albums;
  const billedIds = new Set(billedCollabAlbums.map((a) => a.id));
  return albums.filter(
    (a) => isPrimaryArtistAlbum(a.artist, artistName) || billedIds.has(a.id),
  );
}

function editionKindRank(kind: EditionKind): number {
  return kind === 'original'
    ? 0
    : kind === 'remaster'
      ? 1
      : kind === 'anniversary'
        ? 2
        : kind === 'deluxe' || kind === 'expanded'
          ? 3
          : 4;
}

/** Prefer original/studio edition — earliest sensible year, locker rows win. */
function preferCatalogEdition(a: CatalogAlbum, b: CatalogAlbum): CatalogAlbum {
  const aLocal = a.id.startsWith('local-') ? 0 : 1;
  const bLocal = b.id.startsWith('local-') ? 0 : 1;
  if (aLocal !== bLocal) return aLocal < bLocal ? a : b;

  const aKind = detectEditionType({ title: a.title });
  const bKind = detectEditionType({ title: b.title });
  const kr = editionKindRank(aKind) - editionKindRank(bKind);
  if (kr !== 0) return kr < 0 ? a : b;

  const aYear = parseReleaseYear(a.releaseYear);
  const bYear = parseReleaseYear(b.releaseYear);
  if (aYear !== bYear) return aYear < bYear ? a : b;

  const aCount = a.trackCount ?? 0;
  const bCount = b.trackCount ?? 0;
  if (aCount !== bCount) return aCount > bCount ? a : b;

  return a;
}

function sortAlbumsForArtist(
  albums: CatalogAlbum[],
  targetName: string,
  order?: SearchSortOrder,
): CatalogAlbum[] {
  const dir = order ?? loadSearchSortOrder();
  return [...albums].sort((a, b) => {
    const aPrimary = isPrimaryArtistAlbum(a.artist, targetName) ? 1 : 0;
    const bPrimary = isPrimaryArtistAlbum(b.artist, targetName) ? 1 : 0;
    if (aPrimary !== bPrimary) return bPrimary - aPrimary;
    const ya = parseReleaseYear(a.releaseYear);
    const yb = parseReleaseYear(b.releaseYear);
    if (ya !== yb) return dir === 'oldest' ? ya - yb : yb - ya;
    return a.title.localeCompare(b.title, undefined, { numeric: true });
  });
}

function isLikelyPartialReleaseTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.includes('single') ||
    t.includes(' - ep') ||
    t.endsWith(' ep') ||
    t.includes('sampler') ||
    t.includes('preview')
  );
}

function collapseDuplicateAlbumCandidates(
  candidates: Map<
    number,
    { item: CatalogProviderItem; score: number; songHits: number }
  >,
): void {
  const byTitle = new Map<string, number[]>();
  for (const [id, { item }] of candidates) {
    if (!item.collectionName || !item.artistName) continue;
    const key = `${primaryArtistName(item.artistName)}::${normalizeAlbumDedupeKey(item.collectionName)}`;
    const ids = byTitle.get(key) ?? [];
    ids.push(id);
    byTitle.set(key, ids);
  }

  for (const ids of byTitle.values()) {
    if (ids.length < 2) continue;
    const ranked = ids
      .map((id) => {
        const entry = candidates.get(id)!;
        return {
          id,
          trackCount: entry.item.trackCount ?? 0,
          score: entry.score,
        };
      })
      .sort((a, b) => b.trackCount - a.trackCount || b.score - a.score);
    const keeper = ranked[0]!;
    for (const entry of ranked.slice(1)) {
      if (
        keeper.trackCount >= 6 &&
        entry.trackCount < keeper.trackCount &&
        keeper.trackCount >= entry.trackCount * 2
      ) {
        candidates.delete(entry.id);
      }
    }
  }
}

function upscaleArtwork(url?: string): string | undefined {
  const safe = sanitizeCoverArtUrl(url);
  if (!safe) return undefined;
  return catalogArtworkUrl(safe) ?? safe;
}

function releaseYearFrom(date?: string): string | undefined {
  if (!date) return undefined;
  return date.slice(0, 4);
}

function isExplicit(item: CatalogProviderItem): boolean {
  return (
    item.trackExplicitness === 'explicit' ||
    item.collectionExplicitness === 'explicit'
  );
}

function catalogContentRating(
  item: CatalogProviderItem,
): 'explicit' | 'clean' | undefined {
  const coll = item.collectionExplicitness?.toLowerCase();
  const track = item.trackExplicitness?.toLowerCase();
  if (coll === 'explicit' || track === 'explicit') return 'explicit';
  if (coll === 'cleaned' || track === 'cleaned') return 'clean';
  return undefined;
}

const EDITION_PHRASE_RE =
  /\b(explicit|clean|edited|deluxe|remaster|anniversary|edition|expanded|special|collector|bonus|hi[- ]?res|24[- ]?bit|digital master|half[- ]speed|version|reissue|director'?s? cut)\b/i;

function isEditionPhrase(text: string): boolean {
  const hay = text.toLowerCase();
  if (/\b(feat|ft|featuring|with)\b/.test(hay)) return false;
  return EDITION_PHRASE_RE.test(hay);
}

/** Parenthetical / dash suffix edition text still present in the catalog title. */
function extractCatalogEditionPhrase(title: string): string | null {
  const parts: string[] = [];
  const parenRe = /\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = parenRe.exec(title)) !== null) {
    const inner = match[1]?.trim();
    if (inner && isEditionPhrase(inner)) parts.push(inner);
  }
  const bracketRe = /\[([^\]]+)\]/g;
  while ((match = bracketRe.exec(title)) !== null) {
    const inner = match[1]?.trim();
    if (inner && isEditionPhrase(inner)) parts.push(inner);
  }
  const dashMatch = title.match(/\s+-\s+(.+)$/);
  if (dashMatch?.[1] && isEditionPhrase(dashMatch[1])) {
    parts.push(dashMatch[1].trim());
  }
  if (!parts.length) return null;
  return [...new Set(parts.map((p) => p.replace(/\s+/g, ' ').trim()))].join(' · ');
}

/** Group key for catalog albums that share a base title + artist + year (edition variants). */
export function catalogAlbumVersionGroupKey(album: CatalogAlbum): string {
  const artist = normalizeIdentityKey(album.artist);
  const baseTitle = normalizeAlbumDedupeKey(album.title);
  const year = album.releaseYear ?? '';
  return `${artist}::${baseTitle}::${year}`;
}

function catalogAlbumVersionSiblings(
  album: CatalogAlbum,
  context: readonly CatalogAlbum[],
): CatalogAlbum[] {
  const key = catalogAlbumVersionGroupKey(album);
  return context.filter(
    (candidate) =>
      candidate.id !== album.id && catalogAlbumVersionGroupKey(candidate) === key,
  );
}

function editionLabelAlreadyInTitle(title: string, label: string): boolean {
  return title.toLowerCase().includes(label.toLowerCase());
}

/**
 * Short subtitle for album tiles when multiple catalog editions share a base title.
 * Driven by: iTunes collectionExplicitness (explicit/clean), title edition suffixes,
 * detectEditionType() heuristics, and track-count deltas among siblings.
 *
 * Pass `context` (all albums in the grid) to only surface labels when duplicates exist.
 */
export function catalogAlbumVersionLabel(
  album: CatalogAlbum,
  context?: readonly CatalogAlbum[],
): string | null {
  const siblings = context ? catalogAlbumVersionSiblings(album, context) : [];
  const inDuplicateGroup = siblings.length > 0;

  if (context && !inDuplicateGroup) return null;

  const parts: string[] = [];
  const sameRawTitleAsSibling = siblings.some((s) => s.title === album.title);

  if (album.contentRating === 'explicit' || album.explicit) {
    parts.push('Explicit');
  } else if (album.contentRating === 'clean') {
    parts.push('Clean');
  }

  const fromTitle = extractCatalogEditionPhrase(album.title);
  if (fromTitle && (sameRawTitleAsSibling || !context)) {
    parts.push(fromTitle);
  }

  const kind = detectEditionType({ title: album.title });
  if (kind !== 'original' && kind !== 'other') {
    const kindLabel = editionLabelForKind(kind, album.title);
    const lowerParts = parts.map((p) => p.toLowerCase());
    if (
      kindLabel &&
      !editionLabelAlreadyInTitle(album.title, kindLabel) &&
      !lowerParts.some((p) => p.includes(kindLabel.toLowerCase()))
    ) {
      parts.push(kindLabel);
    }
  }

  if (inDuplicateGroup && album.trackCount) {
    const siblingCounts = siblings
      .map((s) => s.trackCount)
      .filter((count): count is number => count != null && count > 0);
    if (siblingCounts.some((count) => count !== album.trackCount)) {
      const trackPart = `${album.trackCount} tracks`;
      if (!parts.some((p) => p.includes(String(album.trackCount)))) {
        parts.unshift(trackPart);
      }
    }
  }

  if (inDuplicateGroup && album.id.startsWith('local-') && parts.length === 0) {
    parts.push('Locker');
  }

  if (inDuplicateGroup && parts.length === 0) {
    parts.push('Standard');
  }

  if (!parts.length) return null;
  return [...new Set(parts)].join(' · ');
}

function trackToEnvelope(item: CatalogProviderItem): MediaEnvelope | undefined {
  if (!item.trackName) return undefined;
  const trackId = item.trackId ?? Math.floor(Math.random() * 1_000_000);
  return {
    envelopeId: `catalog-${trackId}`,
    title: item.trackName,
    artist: item.artistName ?? 'Unknown Artist',
    album: item.collectionName,
    url: catalogPlayUrlFromPreview(item.previewUrl),
    durationSeconds: item.trackTimeMillis
      ? Math.floor(item.trackTimeMillis / 1000)
      : undefined,
    provider: 'https',
    transport: 'element-src',
    sourceId: String(trackId),
    mimeType: 'audio/mpeg',
    artworkUrl: upscaleArtwork(item.artworkUrl100 ?? item.artworkUrl60),
    releaseYear: releaseYearFrom(item.releaseDate),
  };
}

function buildSuggestions(query: string, items: CatalogProviderItem[]): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (s: string) => {
    const key = s.toLowerCase();
    if (seen.has(key) || key.length < 2) return;
    seen.add(key);
    out.push(s);
  };

  push(q);

  for (const item of items) {
    const artist = item.artistName?.trim();
    const track = item.trackName?.trim();
    const album = item.collectionName?.trim();
    if (artist && artist.toLowerCase().includes(q)) push(artist);
    if (track && artist) {
      if (track.toLowerCase().includes(q) || artist.toLowerCase().includes(q)) {
        push(`${artist} ${track}`);
      }
    }
    if (album && artist && album.toLowerCase().includes(q)) {
      push(`${artist} ${album}`);
    }
  }

  return out.slice(0, 6);
}

function preferCatalogArtistRecord(a: CatalogArtist, b: CatalogArtist): CatalogArtist {
  const aName = catalogDisplayArtistName(a.name);
  const bName = catalogDisplayArtistName(b.name);
  const name =
    aName.length <= bName.length
      ? aName
      : bName;
  const base = aName.length <= bName.length ? a : b;
  const other = base === a ? b : a;
  return {
    ...base,
    name,
    artworkUrl: base.artworkUrl ?? other.artworkUrl,
  };
}

function upsertCatalogArtist(
  map: Map<string, CatalogArtist>,
  artist: CatalogArtist,
): void {
  const normalized: CatalogArtist = {
    ...artist,
    name: catalogDisplayArtistName(artist.name),
  };
  const numericId = normalized.id.match(/^artist-(\d+)$/)?.[1];
  const key = numericId
    ? `id:${numericId}`
    : `name:${normalizeCatalogArtistKey(normalized.name)}`;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, normalized);
    return;
  }
  map.set(key, preferCatalogArtistRecord(existing, normalized));
}

function upsertCatalogAlbum(
  map: Map<string, CatalogAlbum>,
  album: CatalogAlbum,
): void {
  const key = catalogAlbumDedupeKey(album.artist, album.title);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, album);
    return;
  }
  const preferred = preferCatalogEdition(existing, album);
  map.set(key, {
    ...preferred,
    artworkUrl: preferred.artworkUrl ?? album.artworkUrl ?? existing.artworkUrl,
    collectionId: preferred.collectionId ?? album.collectionId ?? existing.collectionId,
    trackCount: Math.max(preferred.trackCount ?? 0, album.trackCount ?? 0) || undefined,
  });
}

function filterCatalogArtistsForQuery(artists: CatalogArtist[], query: string): CatalogArtist[] {
  if (!isLikelyTrackTitleQuery(query)) return artists;

  const combined = parseCombinedTrackQuery(query);
  const cover = parseCoverTrackQuery(query);
  const performer = combined?.artist ?? cover?.performer;

  if (performer) {
    const matched = artists.filter(
      (a) =>
        artistRelevanceScore(a.name, performer) >= 500 || artistNamesEquivalent(a.name, performer),
    );
    if (matched.length > 0) return matched;
  }

  return artists
    .filter((a) => {
      if (/backstreet/i.test(a.name) && /kany|ye/i.test(query)) return false;
      return artistRelevanceScore(a.name, query) >= 500;
    })
    .slice(0, 2);
}

function processCatalogItems(
  raw: CatalogProviderItem[],
  q: string,
): CatalogSearchResult {
  const artistMap = new Map<string, CatalogArtist>();
  const albumMap = new Map<string, CatalogAlbum>();
  const tracks: CatalogTrack[] = [];

  for (const item of raw) {
    const wrapper = item.wrapperType ?? item.kind ?? '';

    if (wrapper === 'artist' && item.artistName && item.artistId) {
      upsertCatalogArtist(artistMap, {
        kind: 'artist',
        id: `artist-${item.artistId}`,
        name: item.artistName,
      });
      continue;
    }

    if (
      (wrapper === 'collection' || wrapper === 'album') &&
      item.collectionName &&
      item.artistName &&
      !isSingleCollection(item) &&
      !isClutterCollection(item)
    ) {
      const album = providerItemToAlbum(item);
      if (album) upsertCatalogAlbum(albumMap, album);
      continue;
    }

    if (wrapper === 'track' && item.trackName) {
      const envelope = trackToEnvelope(item);
      tracks.push({
        kind: 'track',
        id: `track-${item.trackId ?? item.trackName}`,
        title: item.trackName,
        artist: item.artistName ?? 'Unknown Artist',
        album: item.collectionName,
        artworkUrl: upscaleArtwork(item.artworkUrl100 ?? item.artworkUrl60),
        releaseYear: releaseYearFrom(item.releaseDate),
        explicit: isExplicit(item),
        previewUrl: item.previewUrl,
        durationSeconds: item.trackTimeMillis
          ? Math.floor(item.trackTimeMillis / 1000)
          : undefined,
        envelope,
      });

      if (item.artistName && item.artistId && artistRelevanceScore(item.artistName, q) > 0) {
        upsertCatalogArtist(artistMap, {
          kind: 'artist',
          id: `artist-${item.artistId}`,
          name: item.artistName,
        });
      }

      if (item.collectionName && item.artistName && !isSingleCollection(item)) {
        const album = providerItemToAlbum(item);
        if (album) upsertCatalogAlbum(albumMap, album);
      }
    }
  }

  const artists = filterCatalogArtistsForQuery(
    rankArtistsByRelevance([...artistMap.values()], q).filter((a) => artistRelevanceScore(a.name, q) > 0),
    q,
  ).slice(0, 4);

  const rankedAlbums = sortByReleaseYear(listCatalogAlbumEditions([...albumMap.values()])).sort(
    (a, b) => albumRelevanceScore(b.artist, q) - albumRelevanceScore(a.artist, q),
  );
  const topArtistScore = artists[0] ? artistRelevanceScore(artists[0].name, q) : 0;
  const albumCandidates =
    topArtistScore >= 900
      ? rankedAlbums.filter((a) => albumRelevanceScore(a.artist, q) >= 500)
      : rankedAlbums.filter((a) => albumRelevanceScore(a.artist, q) > 0);
  const parsedAlbumQuery = parseArtistAlbumQuery(q);
  const albumPool = albumCandidates.length > 0 ? albumCandidates : rankedAlbums;
  const albums = (parsedAlbumQuery
    ? albumPool.filter((album) =>
        catalogFieldsMatchSearchQuery(
          { artist: album.artist, album: album.title, title: '' },
          q,
        ),
      )
    : albumPool
  ).slice(0, 6);

  const relevantTracks = rankTracksByQueryRelevance(tracks, q).filter((track) =>
    catalogTrackMeetsSearchThreshold(track, q),
  );

  return {
    suggestions: buildSuggestions(q, raw),
    artists,
    albums,
    tracks: sortByReleaseYear(relevantTracks).slice(0, 8),
  };
}

interface ChartRssSong {
  id?: string;
  name?: string;
  artistName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  contentAdvisoryRating?: string;
}

/** Current Apple Music chart — used for "top hits" / trending searches. */
async function fetchChartCatalogTracksUncached(limit = 25): Promise<CatalogTrack[]> {
  if (isAirGapEnabled()) return [];
  try {
    const data = await fetchCatalogChartsPayload(limit);
    if (!data) return [];
    const chartSongs = (data.feed?.results ?? []).slice(0, limit);
    if (chartSongs.length === 0) return [];

    const ids = chartSongs.map((s) => s.id).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];

    const lookupItems = await fetchCatalogApiResults(
      catalogLookupUrl({ id: ids.join(','), entity: 'song' }),
    );
    const lookupById = new Map<string, CatalogProviderItem>();
    for (const item of lookupItems) {
      if (item.trackId) lookupById.set(String(item.trackId), item);
    }

    const tracks: CatalogTrack[] = [];
    for (const song of chartSongs) {
      const item = song.id ? lookupById.get(song.id) : undefined;
      const merged: CatalogProviderItem = {
        trackId: item?.trackId ?? (song.id ? parseInt(song.id, 10) : undefined),
        trackName: item?.trackName ?? song.name,
        artistName: item?.artistName ?? song.artistName,
        collectionName: item?.collectionName,
        previewUrl: item?.previewUrl,
        trackTimeMillis: item?.trackTimeMillis,
        releaseDate: item?.releaseDate ?? song.releaseDate,
        artworkUrl100: item?.artworkUrl100 ?? song.artworkUrl100,
        trackExplicitness:
          item?.trackExplicitness ??
          (song.contentAdvisoryRating?.toLowerCase().includes('explicit')
            ? 'explicit'
            : undefined),
      };
      if (!merged.trackName) continue;

      tracks.push({
        kind: 'track',
        id: `track-${merged.trackId ?? merged.trackName}`,
        title: merged.trackName,
        artist: merged.artistName ?? 'Unknown Artist',
        album: merged.collectionName,
        artworkUrl: upscaleArtwork(merged.artworkUrl100),
        releaseYear: releaseYearFrom(merged.releaseDate),
        explicit: isExplicit(merged),
        previewUrl: merged.previewUrl,
        durationSeconds: merged.trackTimeMillis
          ? Math.floor(merged.trackTimeMillis / 1000)
          : undefined,
        envelope: trackToEnvelope(merged),
      });
    }
    return tracks;
  } catch {
    return [];
  }
}

export async function fetchChartCatalogTracks(limit = 25): Promise<CatalogTrack[]> {
  const cacheKey = `${CACHE_KEYS.CHART_TRACKS}:${limit}`;
  const cached = readResponseCache<CatalogTrack[]>(cacheKey);
  if (cached?.isFresh) return cached.data;
  if (isAirGapEnabled()) return cached?.data ?? [];

  const tracks = await fetchChartCatalogTracksUncached(limit);
  if (tracks.length > 0) {
    writeResponseCache(cacheKey, tracks);
    return tracks;
  }
  return cached?.data ?? [];
}

const REMOTE_CATALOG_HARD_TIMEOUT_MS = 45_000;
/** Match web search caps — never block catalog UI longer than this for YouTube. */
const WEB_SUPPLEMENT_TIMEOUT_MS = 75_000;

async function fetchRemoteSearchCatalogUncached(query: string): Promise<CatalogSearchResult> {
  if (isAirGapEnabled()) return EMPTY_CATALOG;

  const q = query.trim();
  if (q.length < 2) return EMPTY_CATALOG;

  if (isChartQuery(q)) {
    const tracks = await fetchChartCatalogTracks(25);
    return {
      suggestions: ['Top charts', 'Trending now'],
      artists: [],
      albums: [],
      tracks: tracks.slice(0, 8),
    };
  }

  const trackQuery = isLikelyCombinedTrackQuery(q) || isLikelyTrackTitleQuery(q);
  const albumIntent =
    isLikelyArtistNameQuery(q) || trackQuery ? null : await resolveAlbumIntent(q);

  const searchTerms = buildCatalogSearchTerms(q);
  const artistUrl =
    isLikelyTrackTitleQuery(q) && !isLikelyArtistNameQuery(q)
      ? null
      : catalogSearchUrl({
          term: q,
          entity: 'musicArtist',
          limit: 10,
        });

  const [searchBatches, artistItems, albumTracks] = await Promise.all([
    Promise.all(
      searchTerms.map((term) =>
        fetchCatalogApiResults(
          catalogSearchUrl({
            term,
            media: 'music',
            limit: CATALOG_SEARCH_LIMIT,
          }),
        ),
      ),
    ),
    artistUrl ? fetchCatalogApiResults(artistUrl) : Promise.resolve([] as CatalogProviderItem[]),
    albumIntent ? fetchAlbumTracks(albumIntent.album) : Promise.resolve([] as CatalogTrack[]),
  ]);

  const searchItems: CatalogProviderItem[] = [];
  const seenTrackIds = new Set<number>();
  for (const batch of searchBatches) {
    for (const item of batch) {
      const trackId = item.trackId;
      if (trackId != null) {
        if (seenTrackIds.has(trackId)) continue;
        seenTrackIds.add(trackId);
      }
      searchItems.push(item);
    }
  }

  if (searchItems.length === 0 && artistItems.length === 0 && albumTracks.length === 0) {
    return EMPTY_CATALOG;
  }

  const base = processCatalogItems([...artistItems, ...searchItems], q);

  if (albumIntent && albumTracks.length > 0) {
    const intentAlbum = albumIntent.album;
    const albumInList = base.albums.some(
      (a) =>
        a.collectionId === intentAlbum.collectionId ||
        albumTitlesFuzzyMatch(a.title, intentAlbum.title),
    );
    return {
      suggestions: base.suggestions.includes(`${intentAlbum.artist} ${intentAlbum.title}`)
        ? base.suggestions
        : [`${intentAlbum.artist} ${intentAlbum.title}`, ...base.suggestions].slice(0, 6),
      artists: base.artists.length > 0 ? base.artists : [{
        kind: 'artist',
        id: `artist-${normalizeName(intentAlbum.artist)}`,
        name: intentAlbum.artist,
      }],
      albums: albumInList
        ? base.albums
        : [intentAlbum, ...base.albums].slice(0, 6),
      tracks: albumTracks.slice(0, 25),
    };
  }

  return base;
}

async function fetchRemoteSearchCatalog(query: string): Promise<CatalogSearchResult> {
  return Promise.race([
    fetchRemoteSearchCatalogUncached(query),
    new Promise<CatalogSearchResult>((resolve) => {
      setTimeout(() => resolve(EMPTY_CATALOG), REMOTE_CATALOG_HARD_TIMEOUT_MS);
    }),
  ]);
}

async function enrichRemoteArtistImages(catalog: CatalogSearchResult): Promise<void> {
  if (isAirGapEnabled()) return;
  await resolveArtistImages(catalog.artists);
}

function artistsNeedImageFetch(artists: CatalogArtist[]): boolean {
  return artists.some(artistNeedsPhotoLookup);
}

export interface FetchSearchCatalogOptions {
  /** When set, dropdown returns immediately; images update via callback when resolved. */
  onArtistImagesUpdated?: (catalog: CatalogSearchResult) => void;
}

/** Locker-only search (Meilisearch when online, IndexedDB fallback). */
export async function fetchLockerCatalogSearch(query: string): Promise<CatalogSearchResult> {
  return fetchLocalSearchCatalog(query.trim());
}

const WEB_SUPPLEMENT_NOISE = new Set(['dollar', 'sign', 'ty', 'dolla', 'ign']);

/** True when iTunes already has a strong match for title-specific tokens (not just the artist). */
function catalogSatisfiesSpecificTrackQuery(
  tracks: CatalogTrack[],
  query: string,
): boolean {
  if (!tracks.length) return false;

  const extraTokens = queryRelevantTokens(query).filter((t) => !WEB_SUPPLEMENT_NOISE.has(t));
  const titleFocusTokens = extraTokens.filter(
    (t) => !tracks.slice(0, 12).some((track) => normalizeName(track.artist).includes(t)),
  );

  if (titleFocusTokens.length === 0) {
    return tracks.some((track) => trackSearchRelevanceScore(track, query) >= 200);
  }

  return tracks.some(
    (track) =>
      trackSearchRelevanceScore(track, query) >= 200 &&
      extraQueryTokensMatchAlbumOrTitle(track.album, track.title, titleFocusTokens),
  );
}

/** Remote iTunes/catalog API search (no locker), with YouTube supplement when catalog is thin. */
export async function fetchRemoteCatalogSearch(query: string): Promise<CatalogSearchResult> {
  const q = query.trim();
  if (!canRunWebSearch()) return fetchRemoteSearchCatalog(q);

  const forceWeb = needsWebTrackSupplement(q);
  const webPromise = forceWeb
    ? fetchWebCatalogTracks(q, { maxWaitMs: WEB_SUPPLEMENT_TIMEOUT_MS }).catch(
        () => [] as CatalogTrack[],
      )
    : Promise.resolve([] as CatalogTrack[]);

  const [remote, web] = await Promise.all([fetchRemoteSearchCatalog(q), webPromise]);

  if (!forceWeb && catalogSatisfiesSpecificTrackQuery(remote.tracks, q)) {
    return remote;
  }
  if (web.length === 0) return remote;
  return mergeWebCatalogResults(remote, web, q);
}

export async function fetchSearchCatalog(
  query: string,
  options?: FetchSearchCatalogOptions,
): Promise<CatalogSearchResult> {
  const q = query.trim();
  if (q.length < 2) {
    return EMPTY_CATALOG;
  }

  const cacheKey = prefixedCacheKey(CACHE_KEYS.CATALOG_SEARCH, q);
  const cached = readResponseCache<CatalogSearchResult>(cacheKey);

  if (isAirGapEnabled()) {
    const local = await fetchLocalSearchCatalog(q);
    if (local.tracks.length > 0 || local.artists.length > 0 || local.albums.length > 0) {
      return local;
    }
    return cached?.data ?? local;
  }

  if (cached?.isFresh) {
    applyCachedArtistImages(cached.data.artists);
    attachFallbackArtistArtwork(
      cached.data.artists,
      cached.data.albums,
      cached.data.tracks,
    );
    attachFallbackTrackArtwork(cached.data.tracks, cached.data.albums);
    if (artistsNeedImageFetch(cached.data.artists)) {
      if (options?.onArtistImagesUpdated) {
        void enrichRemoteArtistImages(cached.data).then(() => {
          options.onArtistImagesUpdated!({
            ...cached.data,
            artists: [...cached.data.artists],
          });
        });
      } else {
        await enrichRemoteArtistImages(cached.data);
      }
    }
    return cached.data;
  }

  const [local, remote] = await Promise.all([
    fetchLocalSearchCatalog(q),
    fetchRemoteCatalogSearch(q),
  ]);

  let merged = mergeCatalogResults(local, remote, q);
  applyCachedArtistImages(merged.artists);
  attachFallbackArtistArtwork(merged.artists, merged.albums, merged.tracks);
  attachFallbackTrackArtwork(merged.tracks, merged.albums);

  if (merged.tracks.length > 0 || merged.artists.length > 0 || merged.albums.length > 0) {
    writeResponseCache(cacheKey, merged);
  } else if (cached) {
    return cached.data;
  }

  if (artistsNeedImageFetch(merged.artists)) {
    if (options?.onArtistImagesUpdated) {
      void enrichRemoteArtistImages(merged).then(() => {
        options.onArtistImagesUpdated!({
          ...merged,
          artists: [...merged.artists],
        });
      });
    } else {
      await enrichRemoteArtistImages(merged);
    }
  }

  return merged;
}

export interface ArtistDiscography {
  albums: CatalogAlbum[];
  singles: CatalogTrack[];
  artworkUrl?: string;
  /** True when the online catalog returned a capped page and MB did not fill gaps. */
  catalogPartial?: boolean;
  /** True when MusicBrainz release groups added titles beyond the online catalog slice. */
  catalogSupplemented?: boolean;
  catalogSource?: string;
  /** Raw catalog album count before edition deduplication. */
  catalogAlbumCount?: number;
  /** True when live catalog fetch failed and results may be locker-only. */
  catalogUnreachable?: boolean;
}

/** In-memory session cache — avoids repeat slow iTunes scans when revisiting an artist. */
const discographySessionCache = new Map<string, ArtistDiscography>();

/** Safety net for hung requests — core catalog should finish well before this. */
const DISCOGRAPHY_FETCH_TIMEOUT_MS = 15_000;
const MB_SUPPLEMENT_TIMEOUT_MS = 12_000;
const DISCOGRAPHY_ARTIST_IMAGE_TIMEOUT_MS = 6_000;
const MB_SUPPLEMENT_MAX_ALBUMS = 12;

function rememberDiscography(cacheKey: string, data: ArtistDiscography): ArtistDiscography {
  discographySessionCache.set(cacheKey, data);
  return data;
}

const MB_USER_AGENT =
  'SandboxMusic/1.0.0 (https://github.com/sandbox-music; discography)';

const MB_DISCOGRAPHY_EXCLUDE_SECONDARY = new Set([
  'Live',
  'Compilation',
  'Soundtrack',
  'Remix',
  'DJ-mix',
  'Mixtape/Street',
  'Interview',
  'Audiobook',
  'Spokenword',
  'Demo',
  'Audio drama',
]);

interface MbReleaseGroup {
  id: string;
  title?: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
  'first-release-date'?: string;
}

function mbBaseUrl(): string {
  if (typeof window !== 'undefined' && hasSameOriginCatalogProxy()) return '/musicbrainz';
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

function escapeMbLucene(value: string): string {
  return value.replace(/[\\"+&|!(){}[\]^~*?:/-]/g, '\\$&');
}

async function searchMbReleaseForIdentification(
  albumTitle: string,
  artistHint?: string,
): Promise<CatalogIdentificationMatch | null> {
  const coreTitle = normalizeAlbumTitleForMatch(albumTitle);
  const escapedFull = escapeMbLucene(albumTitle);
  const escapedCore = escapeMbLucene(coreTitle);
  const queries: string[] = [];

  const trustedHint = artistHint?.trim() && isUsableArtistName(artistHint) ? artistHint.trim() : undefined;

  queries.push(`release:"${escapedFull}"`);
  if (escapedCore !== escapedFull) queries.push(`release:"${escapedCore}"`);

  if (trustedHint) {
    const escapedArtist = escapeMbLucene(trustedHint);
    queries.unshift(`release:"${escapedFull}" AND artist:"${escapedArtist}"`);
    if (escapedCore !== escapedFull) {
      queries.unshift(`release:"${escapedCore}" AND artist:"${escapedArtist}"`);
    }
  }

  let best: CatalogIdentificationMatch | null = null;

  for (const q of queries) {
    try {
      const res = await mbFetch(
        `/ws/2/release?query=${encodeURIComponent(q)}&fmt=json&limit=12`,
      );
      if (!res.ok) continue;
      const data = (await res.json()) as {
        releases?: Array<{
          id: string;
          title?: string;
          date?: string;
          'artist-credit'?: Array<{ name?: string }>;
        }>;
      };
      const releases = data.releases ?? [];

      for (const release of releases) {
        const releaseTitle = release.title ?? '';
        const artistNames = (release['artist-credit'] ?? [])
          .map((ac) => ac.name?.trim())
          .filter(Boolean)
          .join(' ');
        if (!artistNames || catalogArtistIsLeakWatermark(artistNames)) continue;

        const titleMatch = albumTitlesFuzzyMatch(releaseTitle, albumTitle);
        const artistScore = trustedHint ? artistRelevanceScore(artistNames, trustedHint) : 0;

        let matchKind: CatalogMatchKind | null = null;
        if (titleMatch && artistScore >= 500) matchKind = 'official';
        else if (titleMatch) matchKind = 'partial';
        else if (trustedHint && artistScore >= 700) matchKind = 'artist_only';
        else continue;

        let score = 0;
        if (titleMatch) score += albumTitleRelevanceScore(releaseTitle, albumTitle);
        score += Math.round(artistScore * 0.8);
        if (release.date) score += 80;

        const album: CatalogAlbum = {
          kind: 'album',
          id: `mb-release-${release.id}`,
          title: releaseTitle || albumTitle,
          artist: artistNames,
          releaseYear: release.date?.split('-')[0],
        };

        if (!best || score > best.confidence) {
          best = { album, confidence: score, matchKind, source: 'musicbrainz' };
        }
      }

      if (best) return best;
    } catch {
      /* network */
    }
    await new Promise((r) => setTimeout(r, 110));
  }

  return best;
}

async function resolveCatalogArtistAsFallback(
  artistHint: string | undefined,
  albumTitle: string,
): Promise<CatalogIdentificationMatch | null> {
  if (!artistHint?.trim() || !isUsableArtistName(artistHint)) return null;

  const items = await fetchCatalogApiResults(
    catalogSearchUrl({ term: artistHint, entity: 'musicArtist', limit: 8 }),
  );

  let bestName: string | null = null;
  let bestScore = 0;
  for (const item of items) {
    if (item.wrapperType !== 'artist' || !item.artistName) continue;
    const score = artistRelevanceScore(item.artistName, artistHint);
    if (score > bestScore) {
      bestScore = score;
      bestName = item.artistName;
    }
  }

  if (!bestName || bestScore < 700) return null;

  return {
    album: {
      kind: 'album',
      id: `artist-fallback-${normalizeName(bestName)}`,
      title: albumTitle,
      artist: bestName,
    },
    confidence: bestScore,
    matchKind: 'artist_only',
    source: 'catalog',
  };
}

function isMbDiscographyNoise(rg: MbReleaseGroup): boolean {
  const title = rg.title ?? '';
  if (DISCOGRAPHY_NOISE_RE.test(title)) return true;
  const secondary = rg['secondary-types'] ?? [];
  if (secondary.some((t) => MB_DISCOGRAPHY_EXCLUDE_SECONDARY.has(t))) return true;
  if (rg['primary-type'] === 'Other') return true;
  return false;
}

export async function resolveArtistMusicBrainzId(artistName: string): Promise<string | undefined> {
  try {
    const entries = await getLockerEntries();
    for (const entry of entries) {
      const canonical = resolveCanonicalArtistForTrack(entry);
      if (
        artistMatchesDiscography(canonical.name, artistName) ||
        artistMatchesDiscography(entry.artist, artistName) ||
        artistMatchesDiscography(entry.albumArtist ?? '', artistName)
      ) {
        const mbId = artistIdFromEntry(entry);
        if (mbId) return mbId;
      }
    }
  } catch {
    /* locker unavailable */
  }

  const q = encodeURIComponent(`artist:"${escapeMbLucene(artistName)}"`);
  try {
    const res = await mbFetch(`/ws/2/artist?query=${q}&fmt=json&limit=8`);
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      artists?: Array<{ id: string; name?: string }>;
    };
    const candidates = (data.artists ?? [])
      .filter((a) => a.id && a.name)
      .map((a) => ({
        id: a.id,
        score: artistRelevanceScore(a.name!, artistName),
      }))
      .filter((c) => c.score >= 700)
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.id;
  } catch {
    return undefined;
  }
}

async function fetchMbReleaseGroups(
  artistMbid: string,
  primaryType: 'album' | 'single',
): Promise<MbReleaseGroup[]> {
  const type = primaryType === 'album' ? 'album' : 'single';
  try {
    const res = await mbFetch(
      `/ws/2/release-group?artist=${artistMbid}&type=${type}&fmt=json&limit=100`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { 'release-groups'?: MbReleaseGroup[] };
    return (data['release-groups'] ?? []).filter(
      (rg) => rg.id && rg.title && !isMbDiscographyNoise(rg),
    );
  } catch {
    return [];
  }
}

async function matchMbAlbumToCatalog(
  title: string,
  artistName: string,
  releaseGroupId: string,
  releaseYear?: string,
): Promise<CatalogAlbum> {
  const fallback: CatalogAlbum = {
    kind: 'album',
    id: `mb-rg-${releaseGroupId}`,
    title,
    artist: artistName,
    releaseYear,
    releaseGroupId,
  };

  const items = await fetchCatalogApiResults(
    catalogSearchUrl({
      term: `${artistName} ${title}`,
      entity: 'album',
      limit: 8,
    }),
  );

  let best: { item: CatalogProviderItem; score: number } | null = null;
  for (const item of items) {
    if (!item.collectionName || !item.artistName) continue;
    if (isSingleCollection(item) || isClutterCollection(item) || isCompilationCollection(item)) {
      continue;
    }
    if (!artistMatchesDiscography(item.artistName, artistName)) continue;
    const score = albumTitleRelevanceScore(item.collectionName, title);
    if (score < 500) continue;
    if (!best || score > best.score) best = { item, score };
  }

  if (best) {
    const album = providerItemToAlbum(best.item);
    if (album) {
      return {
        ...album,
        releaseYear: album.releaseYear ?? releaseYear,
        releaseGroupId,
      };
    }
  }

  for (const variant of albumTitleSearchVariants(title)) {
    const viaDiscography = await searchItunesAlbumViaArtistDiscography(
      artistName,
      variant,
      title,
      undefined,
    );
    if (viaDiscography?.album.collectionId) {
      return {
        ...viaDiscography.album,
        releaseYear: viaDiscography.album.releaseYear ?? releaseYear,
        releaseGroupId,
      };
    }
  }
  return fallback;
}

async function matchMbSingleToCatalog(
  title: string,
  artistName: string,
  releaseGroupId: string,
  releaseYear?: string,
): Promise<CatalogTrack> {
  const items = await fetchCatalogApiResults(
    catalogSearchUrl({
      term: `${artistName} ${title}`,
      entity: 'song',
      limit: 10,
    }),
  );

  for (const item of items) {
    if (!item.trackName || !item.artistName) continue;
    if (!artistMatchesDiscography(item.artistName, artistName)) continue;
    if (albumTitleRelevanceScore(item.trackName, title) < 500) continue;
    return {
      kind: 'track',
      id: `track-${item.trackId ?? item.trackName}`,
      title: item.trackName,
      artist: item.artistName,
      album: item.collectionName,
      artworkUrl: upscaleArtwork(item.artworkUrl100 ?? item.artworkUrl60),
      releaseYear: releaseYearFrom(item.releaseDate) ?? releaseYear,
      explicit: isExplicit(item),
      previewUrl: item.previewUrl,
      durationSeconds: item.trackTimeMillis
        ? Math.floor(item.trackTimeMillis / 1000)
        : undefined,
      envelope: trackToEnvelope(item),
    };
  }

  return {
    kind: 'track',
    id: `mb-single-${releaseGroupId}`,
    title,
    artist: artistName,
    releaseYear,
  };
}

async function supplementDiscographyFromMusicBrainz(
  artistName: string,
  existingAlbums: CatalogAlbum[],
  existingSingleKeys: Set<string>,
): Promise<{ albums: CatalogAlbum[]; singles: CatalogTrack[]; supplemented: boolean }> {
  const mbArtistId = await resolveArtistMusicBrainzId(artistName);
  if (!mbArtistId) return { albums: [], singles: [], supplemented: false };

  const mbAlbums = await fetchMbReleaseGroups(mbArtistId, 'album');
  await new Promise((r) => setTimeout(r, 110));
  const mbSingles = await fetchMbReleaseGroups(mbArtistId, 'single');

  const existingAlbumKeys = new Set(
    existingAlbums.map((album) => catalogAlbumDedupeKey(album.artist, album.title)),
  );
  const existingAlbumTitleKeys = new Set(
    existingAlbums.map((album) => normalizeAlbumDedupeKey(album.title)),
  );

  const missingAlbums = mbAlbums.filter((rg) => {
    const title = rg.title!;
    const titleKey = normalizeAlbumDedupeKey(title);
    if (existingAlbumTitleKeys.has(titleKey)) return false;
    const key = catalogAlbumDedupeKey(artistName, title);
    if (existingAlbumKeys.has(key)) return false;
    return !existingAlbums.some((album) => albumTitlesFuzzyMatch(album.title, title));
  });

  const missingSingles = mbSingles.filter((rg) => {
    const key = catalogSingleDedupeKey(artistName, rg.title!);
    return !existingSingleKeys.has(key);
  });

  if (missingAlbums.length === 0 && missingSingles.length === 0) {
    return { albums: [], singles: [], supplemented: false };
  }

  const enrichedAlbums = await Promise.all(
    missingAlbums.slice(0, MB_SUPPLEMENT_MAX_ALBUMS).map((rg) => {
      const year = rg['first-release-date']?.slice(0, 4);
      return matchMbAlbumToCatalog(rg.title!, artistName, rg.id, year);
    }),
  );

  const enrichedSingles = await Promise.all(
    missingSingles.slice(0, MB_SUPPLEMENT_MAX_ALBUMS).map((rg) => {
      const year = rg['first-release-date']?.slice(0, 4);
      return matchMbSingleToCatalog(rg.title!, artistName, rg.id, year);
    }),
  );

  return {
    albums: enrichedAlbums,
    singles: enrichedSingles,
    supplemented: enrichedAlbums.length > 0 || enrichedSingles.length > 0,
  };
}

async function fetchLocalArtistDiscography(artistName: string): Promise<ArtistDiscography> {
  const name = artistName.trim();
  if (!name) return { albums: [], singles: [] };

  let entries: LockerEntry[];
  try {
    entries = await getLockerEntries();
  } catch {
    return { albums: [], singles: [] };
  }

  const matching = entries.filter((entry) => {
    const canonical = resolveCanonicalArtistForTrack(entry);
    return (
      artistMatchesDiscography(canonical.name, name) ||
      artistMatchesDiscography(entry.artist, name) ||
      artistMatchesDiscography(entry.albumArtist ?? '', name)
    );
  });

  const collections = buildAlbumCollections(matching);
  const albums: CatalogAlbum[] = collections.map((collection) => {
    const edition = resolvePreferredEdition(collection);
    const group = editionToAlbumGroup(collection, edition);
    const artwork = group.tracks.find((t) => t.albumArt)?.albumArt;
    return {
      kind: 'album',
      id: collection.releaseGroupId
        ? `local-collection-${collection.key}`
        : `local-album-${group.key.replace(/\s+/g, '-')}`,
      title: collection.displayName,
      artist: collection.artist,
      artworkUrl: artwork,
      releaseYear: edition.year ?? group.tracks.find((t) => t.releaseYear)?.releaseYear,
      trackCount: edition.trackCount,
      editionCount: collection.editionCount,
      releaseGroupId: collection.releaseGroupId ?? undefined,
      isCollectionEdition: collection.editionCount > 1,
    };
  });

  const sorted = sortByReleaseYear(albums);
  return {
    albums: sorted,
    singles: [],
    artworkUrl: sorted.find((album) => album.artworkUrl)?.artworkUrl,
  };
}

async function fetchLocalArtistTracks(artistName: string): Promise<CatalogTrack[]> {
  const name = artistName.trim();
  if (!name) return [];

  let entries: LockerEntry[];
  try {
    entries = await getLockerEntries();
  } catch {
    return [];
  }

  const tracks: CatalogTrack[] = [];
  for (const entry of entries) {
    const canonical = resolveCanonicalArtistForTrack(entry);
    if (
      !artistMatchesDiscography(canonical.name, name) &&
      !artistMatchesDiscography(entry.artist, name) &&
      !artistMatchesDiscography(entry.albumArtist ?? '', name)
    ) {
      continue;
    }
    tracks.push({
      kind: 'track',
      id: `local-track-${entry.id}`,
      title: entry.title,
      artist: entry.artist,
      album: entry.albumName,
      artworkUrl: entry.albumArt,
      releaseYear: entry.releaseYear,
      durationSeconds: entry.durationSeconds || undefined,
      envelope: lockerTrackEnvelope(entry),
    });
  }
  return tracks;
}

function instrumentalCatalogTitle(title: string): boolean {
  return /\b(instrumental|karaoke)\b/i.test(title);
}

function catalogTracksAreDuplicates(a: CatalogTrack, b: CatalogTrack): boolean {
  if (
    a.trackNumber != null &&
    b.trackNumber != null &&
    a.trackNumber !== b.trackNumber
  ) {
    return false;
  }
  if (!trackTitlesFuzzyMatch(a.title, b.title)) return false;
  if (instrumentalCatalogTitle(a.title) !== instrumentalCatalogTitle(b.title)) return false;
  const durA = a.durationSeconds ?? 0;
  const durB = b.durationSeconds ?? 0;
  if (durA > 0 && durB > 0 && Math.abs(durA - durB) > 2) return false;
  return true;
}

function preferDuplicateCatalogTrack(a: CatalogTrack, b: CatalogTrack): CatalogTrack {
  const instA = instrumentalCatalogTitle(a.title);
  const instB = instrumentalCatalogTitle(b.title);
  if (instA !== instB) return instA ? b : a;

  const numA = a.trackNumber ?? 9999;
  const numB = b.trackNumber ?? 9999;
  if (numA !== numB) return numA < numB ? a : b;

  const featA = /\b(feat\.?|ft\.?|featuring)\b/i.test(a.title);
  const featB = /\b(feat\.?|ft\.?|featuring)\b/i.test(b.title);
  if (featA !== featB) return featA ? b : a;

  if (a.previewUrl && !b.previewUrl) return a;
  if (b.previewUrl && !a.previewUrl) return b;

  return a.title.length <= b.title.length ? a : b;
}

/** Collapse iTunes duplicate rows (clean/feat billing, multiple track ids) for album views. */
export function dedupeAlbumTracklist(tracks: CatalogTrack[]): CatalogTrack[] {
  const byTrackId = new Map<number, CatalogTrack>();
  const withoutId: CatalogTrack[] = [];
  for (const track of tracks) {
    const idMatch = track.id.match(/^track-(\d+)$/);
    const trackId = idMatch ? parseInt(idMatch[1], 10) : undefined;
    if (trackId != null && !byTrackId.has(trackId)) {
      byTrackId.set(trackId, track);
    } else if (trackId == null) {
      withoutId.push(track);
    }
  }

  const seeded = [...byTrackId.values(), ...withoutId];
  const out: CatalogTrack[] = [];
  for (const track of seeded) {
    const dupIdx = out.findIndex((existing) => catalogTracksAreDuplicates(existing, track));
    if (dupIdx < 0) {
      out.push(track);
      continue;
    }
    out[dupIdx] = preferDuplicateCatalogTrack(out[dupIdx]!, track);
  }
  return out;
}

function dedupeTracks(tracks: CatalogTrack[]): CatalogTrack[] {
  const seen = new Set<string>();
  const out: CatalogTrack[] = [];
  for (const track of tracks) {
    const key = `${normalizeName(track.artist)}::${normalizeName(track.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
  }
  return out;
}

function sortTopTracks(tracks: CatalogTrack[], artistName: string): CatalogTrack[] {
  return [...tracks].sort((a, b) => {
    const aLocal = a.id.startsWith('local-') ? 1 : 0;
    const bLocal = b.id.startsWith('local-') ? 1 : 0;
    if (aLocal !== bLocal) return bLocal - aLocal;
    const aPrimary = isPrimaryArtistAlbum(a.artist, artistName) ? 1 : 0;
    const bPrimary = isPrimaryArtistAlbum(b.artist, artistName) ? 1 : 0;
    if (aPrimary !== bPrimary) return bPrimary - aPrimary;
    return parseReleaseYear(b.releaseYear) - parseReleaseYear(a.releaseYear);
  });
}

/** Top tracks for an artist — locker vault merged with catalog previews. */
export async function fetchArtistTopTracks(
  artistName: string,
  artistCatalogId?: string,
  limit = 10,
): Promise<CatalogTrack[]> {
  const name = artistName.trim();
  if (!name) return [];

  const localTracks = await fetchLocalArtistTracks(name);
  if (isAirGapEnabled()) {
    return sortTopTracks(localTracks, name).slice(0, limit);
  }

  try {
    const hintId = parseArtistNumericId(artistCatalogId);
    const artistId = await resolveCatalogArtistId(name, hintId);

    let songItems: CatalogProviderItem[] = [];
    if (artistId) {
      songItems = await fetchCatalogApiResults(
        catalogLookupUrl({
          id: artistId,
          entity: 'song',
          limit: CATALOG_LOOKUP_LIMIT,
        }),
      );
    } else {
      songItems = await fetchCatalogApiResults(
        catalogSearchUrl({
          term: name,
          entity: 'song',
          limit: CATALOG_SEARCH_LIMIT,
        }),
      );
    }

    const catalogTracks: CatalogTrack[] = [];
    const rankedItems: Array<{ item: CatalogProviderItem; priority: number }> = [];
    for (const item of songItems) {
      if (!item.trackName || !item.artistName) continue;
      if (!artistId && !artistMatchesDiscography(item.artistName, name)) continue;
      if (isClutterCollection(item)) continue;

      rankedItems.push({ item, priority: topTrackPriority(item, name) });
    }

    rankedItems.sort((a, b) => b.priority - a.priority);
    for (const { item } of rankedItems) {
      catalogTracks.push({
        kind: 'track',
        id: `track-${item.trackId ?? item.trackName}`,
        title: item.trackName,
        artist: item.artistName,
        album: item.collectionName,
        artworkUrl: upscaleArtwork(item.artworkUrl100 ?? item.artworkUrl60),
        releaseYear: releaseYearFrom(item.releaseDate),
        explicit: isExplicit(item),
        previewUrl: item.previewUrl,
        durationSeconds: item.trackTimeMillis
          ? Math.floor(item.trackTimeMillis / 1000)
          : undefined,
        envelope: trackToEnvelope(item),
      });
    }

    return sortTopTracks(dedupeTracks([...localTracks, ...catalogTracks]), name).slice(0, limit);
  } catch {
    return sortTopTracks(localTracks, name).slice(0, limit);
  }
}

function mergeAlbumProviderItems(
  primary: CatalogProviderItem[],
  supplement: CatalogProviderItem[],
): CatalogProviderItem[] {
  const byTrackId = new Map<number, CatalogProviderItem>();
  const withoutId: CatalogProviderItem[] = [];
  for (const item of [...primary, ...supplement]) {
    if (item.trackId != null) {
      if (!byTrackId.has(item.trackId)) byTrackId.set(item.trackId, item);
      continue;
    }
    withoutId.push(item);
  }
  return [...byTrackId.values(), ...withoutId];
}

/** @internal test hook — detect sparse/partial iTunes tracklists (e.g. only tracks 28–31). */
export function albumProviderItemsHaveTrackGaps(
  items: CatalogProviderItem[],
  targetCount: number,
): boolean {
  if (items.length < 2) return items.length > 0 && targetCount > items.length;
  const nums = items
    .map((item) => item.trackNumber)
    .filter((n): n is number => n != null && n > 0);
  if (nums.length === 0) return targetCount > 0 && items.length < targetCount;
  const unique = [...new Set(nums)].sort((a, b) => a - b);
  const maxNum = unique[unique.length - 1] ?? 0;
  if (targetCount > 0 && unique.length < targetCount * 0.75) return true;
  if (maxNum > unique.length + 1) return true;
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i]! - unique[i - 1]! > 1) return true;
  }
  return false;
}

function albumTitleKeepsEditionIdentity(title: string): boolean {
  return /\b(anniversary|deluxe|remaster|collector|expanded|bonus|super deluxe)\b/i.test(title);
}

async function enrichAlbumHintForTrackFetch(album: CatalogAlbum): Promise<CatalogAlbum> {
  let canonical = await canonicalizeAlbumHint(album);
  if (canonical.collectionId) return canonical;

  const intent = await resolveAlbumIntent(`${canonical.artist} ${canonical.title}`);
  if (intent?.album.collectionId && albumTitlesFuzzyMatch(intent.album.title, canonical.title)) {
    canonical = {
      ...canonical,
      collectionId: intent.album.collectionId,
      trackCount:
        Math.max(canonical.trackCount ?? 0, intent.album.trackCount ?? 0) || canonical.trackCount,
      artworkUrl: canonical.artworkUrl ?? intent.album.artworkUrl,
      releaseYear: canonical.releaseYear ?? intent.album.releaseYear,
    };
    return canonical;
  }

  if ((canonical.trackCount ?? 0) >= 2) {
    const identified = await identifyCatalogAlbumByTitle(canonical.title, {
      artistHint: canonical.artist,
      trackCount: canonical.trackCount,
    });
    if (identified?.album.collectionId && albumTitlesFuzzyMatch(identified.album.title, canonical.title)) {
      canonical = {
        ...canonical,
        collectionId: identified.album.collectionId,
        trackCount:
          Math.max(canonical.trackCount ?? 0, identified.album.trackCount ?? 0) ||
          canonical.trackCount,
        artworkUrl: canonical.artworkUrl ?? identified.album.artworkUrl,
        releaseYear: canonical.releaseYear ?? identified.album.releaseYear,
      };
    }
  }
  return canonical;
}

async function lookupAlbumProviderItemsByCollectionId(
  collectionId: number,
  title: string,
): Promise<CatalogProviderItem[]> {
  const lookupItems = await fetchCatalogApiResults(
    catalogLookupUrl({
      id: collectionId,
      entity: 'song',
      limit: CATALOG_LOOKUP_LIMIT,
    }),
  );
  return lookupItems.filter(
    (item) =>
      item.trackName &&
      (!item.collectionName || collectionMatchesTargetAlbum(item.collectionName, title)),
  );
}

async function searchAlbumTrackProviderItems(
  artist: string,
  title: string,
  collectionId?: number,
): Promise<CatalogProviderItem[]> {
  const terms = new Set<string>([`${artist} ${title}`]);
  const baseTitle = stripCatalogEditionSuffixes(title);
  if (!albumTitleKeepsEditionIdentity(title) && baseTitle !== title) {
    terms.add(`${artist} ${baseTitle}`);
  }
  const batches = await Promise.all(
    [...terms].map((term) =>
      fetchCatalogApiResults(
        catalogSearchUrl({ term, entity: 'song', limit: CATALOG_LOOKUP_LIMIT }),
      ),
    ),
  );
  const out: CatalogProviderItem[] = [];
  for (const batch of batches) {
    for (const item of batch) {
      if (!item.trackName) continue;
      if (
        collectionId != null &&
        item.collectionId != null &&
        item.collectionId === collectionId
      ) {
        out.push(item);
        continue;
      }
      if (
        item.collectionName &&
        collectionMatchesTargetAlbum(item.collectionName, title) &&
        artistMatchesDiscography(item.artistName ?? artist, artist)
      ) {
        out.push(item);
      }
    }
  }
  return out;
}

function providerItemsToCatalogTracks(
  items: CatalogProviderItem[],
  canonical: CatalogAlbum,
  artist: string,
  title: string,
): CatalogTrack[] {
  const tracks: CatalogTrack[] = [];
  for (const item of items) {
    if (!item.trackName) continue;
    tracks.push({
      kind: 'track',
      id: `track-${item.trackId ?? item.trackName}`,
      title: item.trackName,
      artist: item.artistName ?? artist,
      album: item.collectionName ?? title,
      artworkUrl: upscaleArtwork(item.artworkUrl100 ?? item.artworkUrl60) ?? canonical.artworkUrl,
      releaseYear: releaseYearFrom(item.releaseDate) ?? canonical.releaseYear,
      explicit: isExplicit(item),
      previewUrl: item.previewUrl,
      durationSeconds: item.trackTimeMillis
        ? Math.floor(item.trackTimeMillis / 1000)
        : undefined,
      trackNumber: item.trackNumber,
      discNumber: item.discNumber,
      envelope: trackToEnvelope(item),
    });
  }
  return tracks;
}

function sortAlbumCatalogTracks(
  tracks: CatalogTrack[],
  items: CatalogProviderItem[],
): CatalogTrack[] {
  const deduped = dedupeAlbumTracklist(tracks);
  const trackNumById = new Map<string, number>();
  for (const item of items) {
    if (item.trackId && item.trackNumber != null) {
      trackNumById.set(String(item.trackId), item.trackNumber);
    }
  }
  return deduped.sort((a, b) => {
    const discA = a.discNumber ?? 1;
    const discB = b.discNumber ?? 1;
    if (discA !== discB) return discA - discB;
    const idA = a.id.match(/^track-(\d+)$/)?.[1];
    const idB = b.id.match(/^track-(\d+)$/)?.[1];
    const numA = idA ? trackNumById.get(idA) : undefined;
    const numB = idB ? trackNumById.get(idB) : undefined;
    if (numA != null && numB != null && numA !== numB) return numA - numB;
    if (numA != null && numB == null) return -1;
    if (numA == null && numB != null) return 1;
    return a.title.localeCompare(b.title, undefined, { numeric: true });
  });
}

/** Track listing for a catalog album (iTunes lookup by collection id, or search fallback). */
export async function fetchAlbumTracks(album: CatalogAlbum): Promise<CatalogTrack[]> {
  if (isAirGapEnabled()) return [];
  const canonical = await enrichAlbumHintForTrackFetch(album);
  const title = (canonical.title ?? '').trim();
  const artist = (canonical.artist ?? '').trim();
  if (!title) return [];

  let items: CatalogProviderItem[] = [];
  const targetCount = Math.max(canonical.trackCount ?? 0, album.trackCount ?? 0);

  if (canonical.collectionId) {
    items = await lookupAlbumProviderItemsByCollectionId(canonical.collectionId, title);
  }

  const needsSearchFallback =
    items.length === 0 ||
    (targetCount > 0 && items.length < targetCount) ||
    albumProviderItemsHaveTrackGaps(items, targetCount);
  if (needsSearchFallback) {
    const searchItems = await searchAlbumTrackProviderItems(
      artist,
      title,
      canonical.collectionId,
    );
    items =
      items.length > 0 ? mergeAlbumProviderItems(items, searchItems) : searchItems;
  }

  if (
    canonical.collectionId &&
    targetCount > 0 &&
    (items.length < targetCount || albumProviderItemsHaveTrackGaps(items, targetCount))
  ) {
    const retryItems = await lookupAlbumProviderItemsByCollectionId(canonical.collectionId, title);
    if (retryItems.length > items.length) {
      items = mergeAlbumProviderItems(retryItems, items);
    }
  }

  return sortAlbumCatalogTracks(providerItemsToCatalogTracks(items, canonical, artist, title), items);
}

export interface CatalogDiscSection {
  discNumber: number;
  label: string;
  tracks: CatalogTrack[];
}

/** Split iTunes billing into individual credited artists (preserves order). */
export function parseCatalogArtistBilling(billing: string): string[] {
  const trimmed = billing.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/\s*,\s*|\s*&\s*|\s+(?:feat\.?|ft\.?|featuring|with)\s+/i)
    .map((part) => catalogDisplayArtistName(part))
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of parts) {
    const key = normalizeCatalogArtistKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export const ALBUM_ARTIST_DISPLAY_CAP = 8;

export type AlbumTrackArtistCredit = Pick<CatalogTrack, 'title' | 'artist'> & {
  /** Per-track performer billing from locker enrichment or catalog supplement. */
  trackPerformers?: string;
  /** Featured / vocal credits (MusicBrainz soloists, locker trackSoloists). */
  trackSoloists?: string;
};

/** Merge album artist credit lists — preserves order, dedupes by normalized key. */
export function mergeAlbumArtistCreditLists(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const name of list) {
      const key = normalizeCatalogArtistKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/** Cap long collab lists for album headers — top N plus overflow count. */
export function formatCappedArtistList(
  names: string[],
  cap = ALBUM_ARTIST_DISPLAY_CAP,
): { visible: string[]; overflow: number } {
  if (names.length <= cap) return { visible: names, overflow: 0 };
  return { visible: names.slice(0, cap), overflow: names.length - cap };
}

/** Comma-separated artist line with optional "and N more" suffix. */
export function formatCappedArtistLine(
  names: string[],
  cap = ALBUM_ARTIST_DISPLAY_CAP,
  overflowLabel = (count: number) => `and ${count} more`,
): string {
  const { visible, overflow } = formatCappedArtistList(names, cap);
  const base = visible.join(', ');
  return overflow > 0 ? `${base}, ${overflowLabel(overflow)}` : base;
}

/** All billed artists on an album — album header, per-track billing, and title feat. credits. */
export function collectAlbumArtistCredits(
  albumArtist: string,
  tracks: AlbumTrackArtistCredit[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const pushBilling = (billing: string) => {
    for (const name of parseCatalogArtistBilling(billing)) push(name);
  };
  const push = (name: string) => {
    const key = normalizeCatalogArtistKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  pushBilling(albumArtist);
  for (const track of tracks) {
    pushBilling(track.artist);
    if (track.trackPerformers) pushBilling(track.trackPerformers);
    if (track.trackSoloists) pushBilling(track.trackSoloists);
    const featFromTitle = featuredArtistsFromTrackTitle(track.title);
    if (featFromTitle) pushBilling(featFromTitle);
  }
  return out;
}

/** Locker album credits — resolves per-track artist lines before aggregation. */
export function collectLockerAlbumArtistCredits(
  albumArtist: string,
  tracks: Pick<
    LockerEntry,
    'title' | 'artist' | 'trackPerformers' | 'trackSoloists' | 'albumArtist' | 'albumName' | 'creditsJson'
  >[],
  resolveTrackArtist: (
    track: Pick<
      LockerEntry,
      'title' | 'artist' | 'trackPerformers' | 'trackSoloists' | 'albumArtist' | 'albumName'
    >,
  ) => string,
  supplementalCredits: string[] = [],
): string[] {
  const mapped: AlbumTrackArtistCredit[] = tracks.map((track) => ({
    title: track.title,
    artist: resolveTrackArtist(track),
    trackPerformers: track.trackPerformers,
    trackSoloists: track.trackSoloists,
  }));
  const base = collectAlbumArtistCredits(albumArtist, mapped);
  if (supplementalCredits.length === 0) return base;
  return mergeAlbumArtistCreditLists(base, supplementalCredits);
}

/** Section label for multi-disc albums (Tidal-style Volume N, or B-Sides when hinted). */
export function catalogDiscSectionLabel(
  discNumber: number,
  discCount: number,
  albumTitle?: string,
): string {
  if (discCount <= 1) return '';
  const titleHay = (albumTitle ?? '').toLowerCase();
  if (discNumber > 1 && /\b(b[- ]?sides?|bonus tracks?)\b/.test(titleHay)) {
    return discNumber === 2 && discCount === 2 ? 'B-Sides' : `Disc ${discNumber}`;
  }
  return `Volume ${discNumber}`;
}

/** When iTunes omits discNumber, split where track numbers reset (e.g. disc 2 starts at 1). */
function inferDiscBreakIndices(tracks: CatalogTrack[]): number[] {
  const breaks: number[] = [0];
  for (let i = 1; i < tracks.length; i++) {
    const prevNum = tracks[i - 1]!.trackNumber;
    const currNum = tracks[i]!.trackNumber;
    if (prevNum == null || currNum == null) continue;
    if (currNum < prevNum && prevNum >= 3) breaks.push(i);
  }
  return breaks.length > 1 ? breaks : [0];
}

/** Group album tracks by discNumber for Volume 1 / Volume 2 headers. */
export function groupCatalogTracksByDisc(
  tracks: CatalogTrack[],
  albumTitle?: string,
): CatalogDiscSection[] {
  if (tracks.length === 0) return [];

  const discs = new Set(tracks.map((t) => t.discNumber ?? 1));
  if (discs.size > 1) {
    const byDisc = new Map<number, CatalogTrack[]>();
    for (const track of tracks) {
      const disc = track.discNumber ?? 1;
      const list = byDisc.get(disc) ?? [];
      list.push(track);
      byDisc.set(disc, list);
    }
    const discCount = byDisc.size;
    return [...byDisc.entries()]
      .sort(([a], [b]) => a - b)
      .map(([discNumber, discTracks]) => ({
        discNumber,
        label: catalogDiscSectionLabel(discNumber, discCount, albumTitle),
        tracks: discTracks,
      }));
  }

  const breakIndices = inferDiscBreakIndices(tracks);
  if (breakIndices.length <= 1 && breakIndices[0] === 0) {
    return [{ discNumber: 1, label: '', tracks }];
  }

  const sections: CatalogDiscSection[] = [];
  for (let s = 0; s < breakIndices.length; s++) {
    const start = breakIndices[s]!;
    const end = breakIndices[s + 1] ?? tracks.length;
    const discTracks = tracks.slice(start, end);
    if (discTracks.length === 0) continue;
    const discNumber = s + 1;
    sections.push({
      discNumber,
      label: catalogDiscSectionLabel(discNumber, breakIndices.length, albumTitle),
      tracks: discTracks,
    });
  }
  return sections.length > 1 ? sections : [{ discNumber: 1, label: '', tracks }];
}

/** Featured / guest artists on an album (excludes primary album billing). */
export function collectAlbumGuestArtists(
  albumArtist: string,
  tracks: AlbumTrackArtistCredit[],
): string[] {
  const primaryKeys = new Set(
    parseCatalogArtistBilling(albumArtist).map((n) => normalizeCatalogArtistKey(n)),
  );
  const all = collectAlbumArtistCredits(albumArtist, tracks);
  return all.filter((name) => !primaryKeys.has(normalizeCatalogArtistKey(name)));
}

/** Sibling deluxe/remaster editions for the same release group (iTunes search). */
export async function fetchCatalogAlbumEditionVariants(
  album: CatalogAlbum,
): Promise<CatalogAlbum[]> {
  if (isAirGapEnabled()) return [];
  const artist = album.artist.trim();
  const title = album.title.trim();
  if (!artist || !title) return [];

  const baseKey = catalogAlbumIdentityKey(artist, title);
  const searchTerm = `${artist} ${stripCatalogEditionSuffixes(title)}`.trim();
  const items = await fetchCatalogApiResults(
    catalogSearchUrl({
      term: searchTerm,
      entity: 'album',
      limit: CATALOG_SEARCH_LIMIT,
    }),
  );

  const variants: CatalogAlbum[] = [];
  const seenIds = new Set<number>();
  for (const item of items) {
    if (!item.collectionName || !item.artistName) continue;
    if (!artistMatchesDiscography(item.artistName, artist)) continue;
    if (isClutterCollection(item) || isDiscographyNoiseCollection(item, artist)) continue;
    if (isSingleCollection(item)) continue;
    const key = catalogAlbumIdentityKey(item.artistName, item.collectionName);
    if (key !== baseKey) continue;
    const collectionId = item.collectionId;
    if (collectionId != null) {
      if (seenIds.has(collectionId)) continue;
      seenIds.add(collectionId);
    }
    const album = providerItemToAlbum(item);
    if (album) variants.push(album);
  }

  if (variants.length <= 1) return [];
  return sortByReleaseYear(variants);
}

/** Find the catalog track that best matches a local locker track title. */
export function matchCatalogTrackForTitle(
  localTitle: string,
  catalogTracks: CatalogTrack[],
): CatalogTrack | undefined {
  return catalogTracks.find((ct) => trackTitlesFuzzyMatch(ct.title, localTitle));
}

function titlesLooseMatch(a: string, b: string): boolean {
  if (albumTitlesAreExclusiveVariants(a, b)) return false;
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

const ALBUM_EXCLUSIVE_VARIANT_WORDS = new Set([
  'still',
  'deluxe',
  'expanded',
  'remaster',
  'remastered',
  'anniversary',
  'vol',
  'pt',
  'part',
]);

/** True when two titles are sibling releases that must not merge (e.g. WE DON'T vs WE STILL DON'T TRUST YOU). */
export function albumTitlesAreExclusiveVariants(a: string, b: string): boolean {
  const na = normalizeAlbumTitleForMatch(a);
  const nb = normalizeAlbumTitleForMatch(b);
  if (!na || !nb || na === nb) return false;

  const wordsA = na.split(' ').filter(Boolean);
  const wordsB = nb.split(' ').filter(Boolean);
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const onlyInA = wordsA.filter((word) => !setB.has(word));
  const onlyInB = wordsB.filter((word) => !setA.has(word));
  const hasExclusiveMarker = [...onlyInA, ...onlyInB].some((word) =>
    ALBUM_EXCLUSIVE_VARIANT_WORDS.has(word),
  );
  if (!hasExclusiveMarker) {
    const longer = na.length >= nb.length ? na : nb;
    const shorter = na.length >= nb.length ? nb : na;
    if (!longer.includes(shorter)) return false;
    const extraTokens = longer
      .slice(longer.indexOf(shorter) + shorter.length)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return extraTokens.some((token) => ALBUM_EXCLUSIVE_VARIANT_WORDS.has(token));
  }

  const overlap = wordsA.filter((word) => setB.has(word)).length;
  const minCore = Math.min(wordsA.length, wordsB.length);
  return overlap >= 3 && minCore >= 3;
}

function collectionMatchesTargetAlbum(collectionName: string, albumTitle: string): boolean {
  if (albumTitlesAreExclusiveVariants(collectionName, albumTitle)) return false;
  const normalizedCollection = normalizeName(collectionName);
  const normalizedTitle = normalizeName(albumTitle);
  if (normalizedCollection === normalizedTitle) return true;
  return albumTitlesFuzzyMatch(collectionName, albumTitle);
}

/** Fuzzy album title match — mixtapes, fan titles, and cover-art wording. */
export function albumTitlesFuzzyMatch(a: string, b: string): boolean {
  if (albumTitlesAreExclusiveVariants(a, b)) return false;
  if (titlesLooseMatch(a, b)) return true;
  const na = normalizeAlbumTitleForMatch(a);
  const nb = normalizeAlbumTitleForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wordsA = na.split(' ').filter((w) => w.length > 2);
  const wordsB = nb.split(' ').filter((w) => w.length > 2);
  if (wordsA.length >= 2 && wordsB.length >= 2) {
    const overlap = wordsA.filter((w) => wordsB.includes(w)).length;
    const minLen = Math.min(wordsA.length, wordsB.length);
    if (overlap >= Math.max(2, minLen - 1)) return true;
  }
  return false;
}

function discographyHasCatalogContent(data: ArtistDiscography): boolean {
  return data.albums.length > 0 || data.singles.length > 0;
}

function sanitizeArtistDiscography(data: ArtistDiscography): ArtistDiscography {
  const albums = dropSparseMbAlbumGhosts(data.albums);
  if (albums === data.albums) return data;
  return { ...data, albums };
}

/** @internal test hook — clears in-memory discography session cache between tests. */
export function clearArtistDiscographySessionCacheForTests(): void {
  discographySessionCache.clear();
}

export async function fetchArtistDiscography(
  artistName: string,
  artistCatalogId?: string,
  onSupplement?: (disc: ArtistDiscography) => void,
): Promise<ArtistDiscography> {
  const name = artistName.trim();
  if (!name) return { albums: [], singles: [] };

  const cacheKey = prefixedCacheKey(
    CACHE_KEYS.ARTIST_DISCOGRAPHY,
    `${name}|${artistCatalogId ?? ''}`,
  );
  const sessionHit = discographySessionCache.get(cacheKey);
  if (
    sessionHit &&
    discographyHasCatalogContent(sessionHit) &&
    !sessionHit.catalogUnreachable
  ) {
    return sanitizeArtistDiscography(sessionHit);
  }

  const cached = readResponseCache<ArtistDiscography>(cacheKey);

  if (isAirGapEnabled()) {
    const local = await fetchLocalArtistDiscography(name);
    if (local.albums.length > 0 || local.singles.length > 0) {
      return rememberDiscography(cacheKey, { ...local, catalogUnreachable: true });
    }
    return rememberDiscography(cacheKey, {
      ...(cached?.data ?? local),
      catalogUnreachable: true,
    });
  }

  if (cached?.isFresh && discographyHasCatalogContent(cached.data)) {
    return rememberDiscography(cacheKey, sanitizeArtistDiscography(cached.data));
  }

  const staleData =
    cached?.data && discographyHasCatalogContent(cached.data)
      ? sanitizeArtistDiscography(cached.data)
      : undefined;
  if (staleData) {
    void raceTimeout(
      fetchArtistDiscographyLive(name, artistCatalogId, cacheKey, staleData, onSupplement),
      DISCOGRAPHY_FETCH_TIMEOUT_MS,
    ).then((fresh) => {
      if (fresh && onSupplement && discographyHasCatalogContent(fresh)) onSupplement(fresh);
    }).catch(() => {});
    return rememberDiscography(cacheKey, staleData);
  }

  const live = await raceTimeout(
    fetchArtistDiscographyLive(name, artistCatalogId, cacheKey, cached?.data, onSupplement),
    DISCOGRAPHY_FETCH_TIMEOUT_MS,
  );
  if (live) return live;

  const fallback = staleData ?? (await fetchLocalArtistDiscography(name));
  if (discographyHasCatalogContent(fallback)) {
    return rememberDiscography(cacheKey, {
      ...fallback,
      catalogUnreachable: !staleData,
    });
  }
  return {
    ...fallback,
    catalogUnreachable: true,
  };
}

async function fetchArtistDiscographyLive(
  name: string,
  artistCatalogId: string | undefined,
  cacheKey: string,
  cachedData: ArtistDiscography | undefined,
  onSupplement?: (disc: ArtistDiscography) => void,
): Promise<ArtistDiscography | null> {
  try {
    const hintId = parseArtistNumericId(artistCatalogId);
    const [artistId, localDisc] = await Promise.all([
      resolveCatalogArtistId(name, hintId),
      fetchLocalArtistDiscography(name),
    ]);

    let collectionItems: CatalogProviderItem[] = [];
    let songItems: CatalogProviderItem[] = [];

    if (artistId) {
      [collectionItems, songItems] = await Promise.all([
        fetchCatalogApiResults(
          catalogLookupUrl({
            id: artistId,
            entity: 'album',
            limit: CATALOG_LOOKUP_LIMIT,
          }),
        ),
        fetchCatalogApiResults(
          catalogLookupUrl({
            id: artistId,
            entity: 'song',
            limit: CATALOG_LOOKUP_LIMIT,
          }),
        ),
      ]);
    } else {
      [collectionItems, songItems] = await Promise.all([
        fetchCatalogApiResults(
          catalogSearchUrl({
            term: name,
            entity: 'album',
            limit: CATALOG_SEARCH_LIMIT,
          }),
        ),
        fetchCatalogApiResults(
          catalogSearchUrl({
            term: name,
            entity: 'song',
            limit: CATALOG_SEARCH_LIMIT,
          }),
        ),
      ]);
    }

    const albumMap = new Map<string, CatalogAlbum>();
    const singlesMap = new Map<string, CatalogTrack>();

    for (const item of collectionItems) {
      if (!item.collectionName || !item.artistName) continue;
      if (!artistId && !artistMatchesDiscography(item.artistName, name)) continue;
      if (isClutterCollection(item)) continue;
      if (isDiscographyNoiseCollection(item, name)) continue;

      const collKey = String(item.collectionId ?? item.collectionName.toLowerCase());

      if (isSingleCollection(item)) {
        upsertCatalogSingle(singlesMap, {
          kind: 'track',
          id: `single-${item.collectionId ?? collKey}`,
          title: catalogSingleDisplayTitle(item.collectionName),
          artist: item.artistName,
          album: item.collectionName,
          artworkUrl: upscaleArtwork(item.artworkUrl100 ?? item.artworkUrl60),
          releaseYear: releaseYearFrom(item.releaseDate),
          explicit: isExplicit(item),
        });
        continue;
      }

      if (!albumMap.has(collKey)) {
        const album = providerItemToAlbum(item);
        if (album) albumMap.set(collKey, album);
      }
    }

    const albumTitles = new Set([...albumMap.values()].map((a) => a.title.toLowerCase()));

    for (const item of songItems) {
      if (!item.trackName || !item.artistName) continue;
      if (!artistId && !artistMatchesDiscography(item.artistName, name)) continue;
      if (isClutterCollection(item)) continue;

      const coll = item.collectionName?.toLowerCase() ?? '';
      const trackIsSingle =
        isSingleCollection(item) ||
        (item.wrapperType ?? item.kind ?? '').toLowerCase() === 'track' ||
        !coll ||
        coll.includes('single') ||
        coll.includes(' - ep') ||
        coll.endsWith(' ep') ||
        !albumTitles.has(coll);

      if (!trackIsSingle) continue;

      upsertCatalogSingle(singlesMap, {
        kind: 'track',
        id: `track-${item.trackId ?? item.trackName}`,
        title: item.trackName,
        artist: item.artistName,
        album: item.collectionName,
        artworkUrl: upscaleArtwork(item.artworkUrl100 ?? item.artworkUrl60),
        releaseYear: releaseYearFrom(item.releaseDate),
        explicit: isExplicit(item),
        previewUrl: item.previewUrl,
        durationSeconds: item.trackTimeMillis
          ? Math.floor(item.trackTimeMillis / 1000)
          : undefined,
        envelope: trackToEnvelope(item),
      });
    }

    const catalogAlbumCount = albumMap.size;
    const allItems = [...collectionItems, ...songItems];
    const itunesCapped =
      collectionItems.length >= CATALOG_LOOKUP_LIMIT ||
      (!artistId && collectionItems.length >= CATALOG_SEARCH_LIMIT);

    const buildResult = (supplemented: boolean, image?: string): ArtistDiscography => {
      const deduped = dropSparseMbAlbumGhosts(
        listCatalogAlbumEditions([...localDisc.albums, ...albumMap.values()]),
      );
      const candidateAlbums = selectArtistDiscographyAlbums(deduped, name, artistId);
      const albums = sortAlbumsForArtist(
        partitionDiscographyAlbums(candidateAlbums, singlesMap),
        name,
        'oldest',
      );
      const quickArtwork =
        localDisc.artworkUrl ??
        pickArtworkFromItems(allItems, name) ??
        albums.find((a) => a.artworkUrl)?.artworkUrl;
      return {
        albums,
        singles: sortByReleaseYear(dedupeCatalogSingles([...singlesMap.values()])),
        artworkUrl: quickArtwork ?? image ?? undefined,
        catalogPartial: itunesCapped && !supplemented,
        catalogSupplemented: supplemented,
        catalogSource: supplemented ? 'catalog+musicbrainz' : 'catalog',
        catalogAlbumCount,
        catalogUnreachable: false,
      };
    };

    const existingCatalogAlbums = [...albumMap.values()];
    const existingSingleKeys = new Set(
      [...singlesMap.values()].map((s) => catalogSingleDedupeKey(s.artist, s.title)),
    );

    // App path: return iTunes core immediately, enrich (MusicBrainz + artist image) in the
    // background. The artist page then paints albums in <1s instead of waiting up to ~18s.
    if (onSupplement) {
      const coreResult = buildResult(false);
      if (discographyHasCatalogContent(coreResult)) {
        writeResponseCache(cacheKey, coreResult);
        rememberDiscography(cacheKey, coreResult);
      }
      void (async () => {
        try {
          const [mbSupplement, image] = await Promise.all([
            raceTimeout(
              supplementDiscographyFromMusicBrainz(name, existingCatalogAlbums, existingSingleKeys),
              MB_SUPPLEMENT_TIMEOUT_MS,
            ).then((r) => r ?? { albums: [], singles: [], supplemented: false }),
            coreResult.artworkUrl
              ? Promise.resolve(undefined)
              : raceTimeout(findArtistImage(name), DISCOGRAPHY_ARTIST_IMAGE_TIMEOUT_MS),
          ]);
          let changed = false;
          for (const album of mbSupplement.albums) {
            albumMap.set(album.id, album);
            changed = true;
          }
          for (const single of mbSupplement.singles) {
            upsertCatalogSingle(singlesMap, single);
            changed = true;
          }
          if (!changed && !mbSupplement.supplemented && !image) return;
          const enriched = buildResult(mbSupplement.supplemented, image ?? undefined);
          if (discographyHasCatalogContent(enriched)) {
            writeResponseCache(cacheKey, enriched);
            rememberDiscography(cacheKey, enriched);
            onSupplement(enriched);
          }
        } catch {
          /* background enrichment best-effort */
        }
      })();
      return coreResult;
    }

    const mbSupplement =
      (await raceTimeout(
        supplementDiscographyFromMusicBrainz(name, existingCatalogAlbums, existingSingleKeys),
        MB_SUPPLEMENT_TIMEOUT_MS,
      )) ?? { albums: [], singles: [], supplemented: false };
    for (const album of mbSupplement.albums) {
      albumMap.set(album.id, album);
    }
    for (const single of mbSupplement.singles) {
      upsertCatalogSingle(singlesMap, single);
    }
    const blockingCore = buildResult(mbSupplement.supplemented);
    const artistPhoto =
      blockingCore.artworkUrl ??
      (await raceTimeout(findArtistImage(name), DISCOGRAPHY_ARTIST_IMAGE_TIMEOUT_MS)) ??
      undefined;
    const result: ArtistDiscography = { ...blockingCore, artworkUrl: artistPhoto };
    if (discographyHasCatalogContent(result)) {
      writeResponseCache(cacheKey, result);
      return rememberDiscography(cacheKey, result);
    }
    return result;
  } catch {
    const fallback = cachedData ?? (await fetchLocalArtistDiscography(name));
    if (discographyHasCatalogContent(fallback)) {
      return rememberDiscography(cacheKey, {
        ...fallback,
        catalogUnreachable: true,
      });
    }
    return {
      ...fallback,
      catalogUnreachable: true,
    };
  }
}

/** Exported for unit tests — iTunes billing splits (Ye / Kanye West, …). */
export function catalogArtistNamesEquivalent(name: string, query: string): boolean {
  if (artistNamesEquivalent(name, query)) return true;
  return normalizeCatalogArtistKey(name) === normalizeCatalogArtistKey(query);
}

/** First billed artist before collab splits — for artist pages, not album credit lines. */
export function catalogPrimaryArtistName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const beforeComma = trimmed.split(',')[0]?.trim() ?? trimmed;
  const segment =
    beforeComma.split(/\s*(?:&|feat\.?|ft\.?|featuring|with)\s*/i)[0] ?? beforeComma;
  return segment.trim();
}

/** Prefer canonical display names over iTunes billing duplicates (Kanye Omari West → Kanye West). */
export function catalogDisplayArtistName(name: string): string {
  const primary = catalogPrimaryArtistName(name);
  if (artistNamesEquivalent(primary, 'Kanye West') || artistNamesEquivalent(name, 'Kanye West')) {
    return 'Kanye West';
  }
  return primary || name.trim();
}

const ARTIST_NAME_PARTICLE_WORDS = new Set(['the', 'and', 'of', 'van', 'von', 'de', 'del', 'mc', 'mac']);

/** Verbs / title openers — bad artist prefix for "Artist Album" splits. */
const TITLE_STARTER_WORDS = new Set([
  'take',
  'see',
  'run',
  'get',
  'let',
  'all',
  'how',
  'when',
  'where',
  'what',
  'why',
  'like',
  'love',
  'need',
  'want',
  'feel',
  'go',
  'come',
  'back',
  'look',
  'make',
  'give',
]);

/** Single-token artist hints (Ye, Drake, …) for title+artist query splits. */
const KNOWN_SHORT_ARTIST_TOKENS = new Set([
  'kanye',
  'ye',
  'drake',
  'jay',
  'beyonce',
  'rihanna',
  'eminem',
  'travis',
  'kendrick',
  'sza',
  'weeknd',
]);

const NON_ARTIST_QUERY_TOKENS = new Set([
  'dress',
  'off',
  'zone',
  'plan',
  'views',
  'view',
  'power',
  'gods',
  'holy',
  'grail',
  'love',
  'life',
  'again',
  'party',
  'dreams',
  'classic',
  'hero',
  'heroes',
  'trust',
  'mask',
  'draco',
  'melrose',
  'your',
  'my',
  'the',
  'and',
  'backstreet',
  'boys',
  'street',
  'way',
  'want',
  'cover',
  'covered',
  'karaoke',
]);

const COVER_QUERY_MARKERS = new Set(['cover', 'covers', 'covered', 'covering', 'karaoke', 'tribute']);

const REFERENCE_ARTIST_FRAGMENTS: Array<{
  tokens: string[];
  canonical: string;
  titleHint: string;
}> = [
  { tokens: ['backstreet'], canonical: 'Backstreet Boys', titleHint: 'I Want It That Way' },
];

export type CoverTrackQuery = {
  performer: string;
  referenceArtist?: string;
  titleHint?: string;
};

/** Parse cover / karaoke queries (e.g. "kanye backstreet", "backstreet boys kanye cover"). */
export function parseCoverTrackQuery(query: string): CoverTrackQuery | null {
  const collapsed = collapseQueryAliases(query);
  const stripped = stripCoverMarkersFromQuery(collapsed);
  const raw = stripped || collapsed;
  const tokens = queryRelevantTokens(raw);
  if (!tokens.length) return null;

  const hasCoverMarker =
    COVER_QUERY_MARKERS.has(tokens[tokens.length - 1]!) ||
    tokens.some((t) => COVER_QUERY_MARKERS.has(t)) ||
    /\bcover(?:ed|ing|s)?\b/i.test(query) ||
    /\bkaraoke\b/i.test(query);

  const hasKanye = tokens.some((t) => t === 'kanye' || t === 'ye' || t.startsWith('kany'));
  const hasBackstreet = /backstreet/i.test(raw) || tokens.includes('backstreet');

  if (!hasCoverMarker && !(hasKanye && hasBackstreet)) return null;

  let performer: string | undefined;
  for (const t of tokens) {
    if (KNOWN_SHORT_ARTIST_TOKENS.has(t) || t.startsWith('kany')) {
      performer = t === 'ye' || t.startsWith('kany') ? 'kanye' : t;
      break;
    }
  }
  if (!performer) {
    const trailing = tokens[tokens.length - 1];
    if (trailing && KNOWN_SHORT_ARTIST_TOKENS.has(trailing)) {
      performer = trailing === 'ye' ? 'kanye' : trailing;
    }
  }
  if (!performer && hasKanye) performer = 'kanye';
  if (!performer) return null;

  let referenceArtist: string | undefined;
  let titleHint: string | undefined;
  for (const ref of REFERENCE_ARTIST_FRAGMENTS) {
    if (ref.tokens.every((t) => tokens.includes(t) || raw.includes(t))) {
      referenceArtist = ref.canonical;
      titleHint = ref.titleHint;
      break;
    }
  }
  if (hasBackstreet && !referenceArtist) {
    referenceArtist = 'Backstreet Boys';
    titleHint = 'I Want It That Way';
  }
  if (/want.*that.*way/i.test(raw)) {
    titleHint = 'I Want It That Way';
  }

  return { performer, referenceArtist, titleHint };
}

/** True when the query is probably a song/track title search (not artist-only). */
export function isLikelyTrackTitleQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return false;
  if (isLikelyCombinedTrackQuery(trimmed)) return true;
  if (parseCoverTrackQuery(trimmed)) return true;

  const tokens = queryRelevantTokens(stripCoverMarkersFromQuery(trimmed) || trimmed);
  if (tokens.length === 1) {
    const t = tokens[0]!;
    if (TITLE_LIKE_QUERY_TOKENS.has(t) || NON_ARTIST_QUERY_TOKENS.has(t)) return true;
    for (const fix of Object.values(KNOWN_TRACK_TITLE_CORRECTIONS)) {
      if (fuzzyTokensEquivalent(t, fix)) return true;
    }
    // Do NOT treat every long mononym as a track title. That skipped musicArtist
    // lookup for stylized artists (EsDeeKid) while iTunes text search only returns
    // type-beat spam that never bills the real artist — so albums/singles vanished.
  }

  if (tokens.length >= 2) {
    if (isPlainMultiWordArtistName(trimmed)) return false;
    if (tokens.some((t) => TITLE_STARTER_WORDS.has(t))) return true;
    if (tokens.some((t) => COVER_QUERY_MARKERS.has(t))) return true;
    if (tokens.includes('backstreet') || /backstreet/i.test(trimmed)) return true;
    if (
      tokens.some((t) => NON_ARTIST_QUERY_TOKENS.has(t) && !KNOWN_SHORT_ARTIST_TOKENS.has(t))
    ) {
      return true;
    }
    const hasPerformer =
      KNOWN_SHORT_ARTIST_TOKENS.has(tokens[0]!) ||
      KNOWN_SHORT_ARTIST_TOKENS.has(tokens[tokens.length - 1]!);
    if (hasPerformer && tokens.length >= 2) {
      const nonPerformer = tokens.filter(
        (t) => !KNOWN_SHORT_ARTIST_TOKENS.has(t) && t !== 'west',
      );
      if (nonPerformer.length > 0) return true;
    }
    if (!parseArtistAlbumQuery(trimmed)) {
      const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
      if (wordCount >= 3) return true;
    }
  }

  return false;
}

/** True when iTunes is unlikely to have results — force YouTube/web supplement. */
export function needsWebTrackSupplement(query: string): boolean {
  if (parseCoverTrackQuery(query)) return true;
  const combined = parseCombinedTrackQuery(query);
  if (combined && /kany|ye|melrose|dress|backstreet/i.test(`${combined.title} ${query}`)) {
    return true;
  }
  if (isLikelyTrackTitleQuery(query) && /cover|karaoke|backstreet|dress/i.test(query)) {
    return true;
  }
  return false;
}

/** True when catalog/streamable rows already match the title tokens from a track query. */
export function catalogSatisfiesTrackQuery(
  tracks: Array<{ title?: string; album?: string; artist?: string }>,
  query: string,
): boolean {
  return catalogSatisfiesSpecificTrackQuery(
    tracks.map((t, i) => ({
      kind: 'track' as const,
      id: `probe-${i}`,
      title: t.title ?? '',
      artist: t.artist ?? '',
      album: t.album,
    })),
    query,
  );
}

/** Relaxed match for YouTube/web supplement rows (artist metadata is often wrong). */
export function webCatalogTrackMatchesQuery(
  track: Pick<CatalogTrack, 'title' | 'artist' | 'id'>,
  query: string,
): boolean {
  if (!track.id.startsWith('youtube-')) {
    return catalogFieldsMatchSearchQuery(
      { artist: track.artist, title: track.title },
      query,
    );
  }
  const combined = parseCombinedTrackQuery(query);
  const titleHay = normalizeName(track.title);
  if (combined) {
    return titleTokensMatchHay(combined.title, titleHay);
  }
  const cover = parseCoverTrackQuery(query);
  if (cover?.titleHint) {
    return titleTokensMatchHay(cover.titleHint, titleHay);
  }
  return catalogFieldsMatchSearchQuery({ artist: track.artist, title: track.title }, query);
}

export type CombinedTrackQuery = { title: string; artist: string };

function isPlainMultiWordArtistName(query: string): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 3) return false;
  if (words.length === 3) {
    const middle = words[1]!.toLowerCase();
    return middle === 'the' || middle === 'and';
  }
  if (words.length === 2) {
    if (words[1]!.length <= 2) return true;
    const second = normalizeName(words[1]!);
    if (TITLE_LIKE_QUERY_TOKENS.has(second)) return false;
    if (KNOWN_SHORT_ARTIST_TOKENS.has(normalizeName(words[0]!)) && second === 'west') return true;
    return false;
  }
  const token = normalizeName(words[0]!);
  if (TITLE_LIKE_QUERY_TOKENS.has(token) || NON_ARTIST_QUERY_TOKENS.has(token)) return false;
  return true;
}

function scoreArtistQueryPart(part: string): number {
  const trimmed = part.trim();
  if (!trimmed) return 0;
  const tokens = normalizeName(trimmed).split(' ').filter(Boolean);
  if (tokens.some((t) => NON_ARTIST_QUERY_TOKENS.has(t))) return 0;
  if (tokens.length === 1 && TITLE_STARTER_WORDS.has(tokens[0]!)) return 0;
  if (isPlainMultiWordArtistName(trimmed) && tokens.length <= 2) return 800;
  const token = normalizeName(trimmed);
  if (KNOWN_SHORT_ARTIST_TOKENS.has(token)) return 700;
  for (const group of ARTIST_ALIAS_GROUPS) {
    if (group.some((alias) => normalizeName(alias) === token)) return 750;
  }
  if (artistRelevanceScore(trimmed, trimmed) >= 500) return 600;
  return 0;
}

function titleTokensMatchHay(titlePart: string, hay: string): boolean {
  const titleTokens = queryRelevantTokens(titlePart).filter(
    (t) => !TRACK_QUERY_STOP_WORDS.has(t),
  );
  if (!titleTokens.length) return false;
  const matched = titleTokens.filter(
    (t) => hay.includes(t) || fuzzyTokenInHaystack(hay, t),
  ).length;
  return matched >= Math.max(1, titleTokens.length - 1);
}

const TRACK_QUERY_STOP_WORDS = new Set(['the', 'and', 'a', 'an', 'your', 'my', 'to', 'of', 'in', 'on', 'at']);

/**
 * Split "Title Artist" / "Artist Title" track queries (e.g. "Take off your dress Kanye").
 * Requires at least three tokens so two-word album intents ("Future Zone") stay intact.
 */
export function parseCombinedTrackQuery(query: string): CombinedTrackQuery | null {
  const normalized = stripCoverMarkersFromQuery(query) || collapseQueryAliases(query);
  const tokens = queryRelevantTokens(normalized);
  if (tokens.length < 2) return null;

  if (tokens.length === 3) {
    const middle = tokens[1]!.toLowerCase();
    if (middle === 'the' || middle === 'and') return null;
  }

  if (tokens.length === 2) {
    const [first, second] = tokens;
    const firstArtistScore = scoreArtistQueryPart(first!);
    const secondArtistScore = scoreArtistQueryPart(second!);
    if (KNOWN_SHORT_ARTIST_TOKENS.has(second!) && firstArtistScore < 500) {
      return { title: first!, artist: second! };
    }
    if (KNOWN_SHORT_ARTIST_TOKENS.has(first!) && secondArtistScore < 500) {
      return { title: second!, artist: first! };
    }
    if (second === 'backstreet' || first === 'backstreet') {
      const performer = KNOWN_SHORT_ARTIST_TOKENS.has(second!) ? second! : first!;
      const ref = performer === first ? second! : first!;
      if (KNOWN_SHORT_ARTIST_TOKENS.has(performer)) {
        return { title: ref, artist: performer };
      }
    }
    if (isPlainMultiWordArtistName(query.trim())) return null;
    return null;
  }

  let best: { title: string; artist: string; score: number } | null = null;

  const consider = (title: string, artist: string, bonus: number) => {
    const artistScore = scoreArtistQueryPart(artist);
    if (artistScore < 500 || title.trim().length < 2) return;
    const score = artistScore + bonus + Math.min(title.length, 40);
    if (!best || score > best.score) {
      best = { title: title.trim(), artist: artist.trim(), score };
    }
  };

  for (let artistLen = 1; artistLen <= Math.min(3, tokens.length - 1); artistLen++) {
    consider(tokens.slice(0, -artistLen).join(' '), tokens.slice(-artistLen).join(' '), 120);
    consider(tokens.slice(artistLen).join(' '), tokens.slice(0, artistLen).join(' '), 80);
  }

  return best ? { title: best.title, artist: best.artist } : null;
}

/** True when the query is probably "track title + artist" (not a pure album intent). */
export function isLikelyCombinedTrackQuery(query: string): boolean {
  return parseCombinedTrackQuery(query) != null;
}

/** iTunes-friendly search terms for combined title/artist queries. */
export function buildCatalogSearchTerms(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    const q = value.trim().replace(/\s+/g, ' ');
    const key = normalizeName(q);
    if (q.length < 2 || !key || seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };

  push(trimmed);
  push(collapseQueryAliases(trimmed));

  for (const corrected of expandFuzzyQueryCorrections(trimmed)) {
    push(corrected);
  }

  const cover = parseCoverTrackQuery(trimmed);
  if (cover) {
    push(`${cover.performer} ${cover.referenceArtist ?? ''}`.trim());
    if (cover.titleHint) {
      push(`${cover.performer} ${cover.titleHint}`);
      push(`Kanye West ${cover.titleHint} cover`);
      push(`Ye ${cover.titleHint} karaoke`);
    }
    if (cover.referenceArtist) {
      push(`${cover.referenceArtist} ${cover.performer} cover`);
    }
  }

  const combined = parseCombinedTrackQuery(trimmed);
  if (combined) {
    push(`${combined.artist} ${combined.title}`);
    push(`${combined.title} ${combined.artist}`);
    push(combined.title);
    if (/kany|ye/i.test(combined.artist)) {
      push(`Kanye West ${combined.title}`);
      push(`Ye ${combined.title}`);
    }
  }

  const albumSplit = parseArtistAlbumQuery(trimmed);
  if (albumSplit) {
    push(`${albumSplit.artist} ${albumSplit.album}`);
  }

  return out.slice(0, 6);
}

const TITLE_LIKE_QUERY_TOKENS = new Set([
  'zone',
  'views',
  'view',
  'power',
  'plan',
  'gods',
  'holy',
  'grail',
  'love',
  'life',
  'again',
  'party',
  'dreams',
  'classic',
  'hero',
  'heroes',
  'trust',
  'bully',
  'rebel',
  'gnx',
  'mask',
  'draco',
  'temptation',
  'melrose',
  'dress',
  'backstreet',
]);

function isLikelyPersonNamePair(first: string, second: string): boolean {
  if (TITLE_LIKE_QUERY_TOKENS.has(second)) return false;
  if (second.length <= 2) return true;
  if (first.length <= 2) return false;
  return true;
}

/**
 * Split "Artist Album" / "Artist Track" queries (e.g. "Future Zone", "Drake Gods Plan").
 * Returns null for plain artist names ("Kanye West") and multi-word artist names ("Tyler The Creator").
 */
export function parseArtistAlbumQuery(query: string): { artist: string; album: string } | null {
  const tokens = queryRelevantTokens(query);
  if (tokens.length < 2) return null;

  if (tokens.length === 2) {
    const [first, second] = tokens;
    if (isLikelyPersonNamePair(first!, second!)) return null;
    return { artist: first!, album: second! };
  }

  if (tokens.length === 3) {
    const middle = tokens[1]!.toLowerCase();
    if (middle === 'the' || middle === 'and') return null;
    return { artist: tokens[0]!, album: tokens.slice(1).join(' ') };
  }

  if (parseCombinedTrackQuery(query)) return null;

  let best: { artist: string; album: string; score: number } | null = null;
  for (let split = 1; split < tokens.length; split++) {
    const pivot = tokens[split]!.toLowerCase();
    if (ARTIST_NAME_PARTICLE_WORDS.has(pivot)) continue;
    const artist = tokens.slice(0, split).join(' ');
    const album = tokens.slice(split).join(' ');
    let score = 0;
    if (isLikelyArtistNameQuery(artist)) score += 500;
    if (TITLE_LIKE_QUERY_TOKENS.has(pivot)) score += 150;
    if (TITLE_STARTER_WORDS.has(tokens[0]!.toLowerCase())) score -= 350;
    if (!best || score > best.score) {
      best = { artist, album, score };
    }
  }

  if (best && best.score >= 200) {
    return { artist: best.artist, album: best.album };
  }

  return null;
}

/** Require token overlap between a catalog row and the query (strict for artist+album splits). */
export function catalogFieldsMatchSearchQuery(
  fields: { artist?: string; album?: string; title?: string },
  query: string,
): boolean {
  const combined = parseCombinedTrackQuery(query);
  if (combined) {
    const artistField = fields.artist ?? '';
    if (
      artistRelevanceScore(artistField, combined.artist) < 500 &&
      !artistNamesEquivalent(artistField, combined.artist)
    ) {
      return false;
    }
    const titleHay = normalizeName(`${fields.title ?? ''} ${fields.album ?? ''}`);
    if (titleTokensMatchHay(combined.title, titleHay)) return true;
    const cover = parseCoverTrackQuery(query);
    if (cover?.titleHint && titleTokensMatchHay(cover.titleHint, titleHay)) return true;
    return false;
  }

  const cover = parseCoverTrackQuery(query);
  if (cover) {
    const artistField = fields.artist ?? '';
    if (
      artistRelevanceScore(artistField, cover.performer) < 500 &&
      !artistNamesEquivalent(artistField, cover.performer)
    ) {
      return false;
    }
    const titleHay = normalizeName(`${fields.title ?? ''} ${fields.album ?? ''}`);
    if (cover.titleHint) {
      const hintTokens = queryRelevantTokens(cover.titleHint).filter(
        (t) => !TRACK_QUERY_STOP_WORDS.has(t),
      );
      if (
        hintTokens.length > 0 &&
        hintTokens.filter((t) => fuzzyTokenInHaystack(titleHay, t)).length >=
          Math.max(1, hintTokens.length - 1)
      ) {
        return true;
      }
    }
    const refTokens = queryRelevantTokens(
      `${cover.referenceArtist ?? ''} ${stripCoverMarkersFromQuery(query)}`,
    ).filter((t) => !COVER_QUERY_MARKERS.has(t) && !TRACK_QUERY_STOP_WORDS.has(t));
    if (refTokens.length === 0) return true;
    const matched = refTokens.filter((t) => fuzzyTokenInHaystack(titleHay, t)).length;
    return matched >= Math.max(1, refTokens.length - 2);
  }

  const parsed = parseArtistAlbumQuery(query);
  if (parsed) {
    if (artistRelevanceScore(fields.artist ?? '', parsed.artist) < 500) return false;
    const titleHay = normalizeName(`${fields.album ?? ''} ${fields.title ?? ''}`);
    const albumToken = normalizeName(parsed.album);
    if (!albumToken) return false;
    if (titleHay.includes(albumToken)) return true;
    return albumTokensMatchQueryAlbum(parsed.album, fields.album, fields.title);
  }

  const tokens = queryRelevantTokens(query);
  if (!tokens.length) return false;
  const hay = normalizeName(`${fields.artist ?? ''} ${fields.album ?? ''} ${fields.title ?? ''}`);

  if (isLikelyTrackTitleQuery(query) && !parseArtistAlbumQuery(query)) {
    const titleHay = normalizeName(`${fields.title ?? ''} ${fields.album ?? ''}`);
    const focusTokens = tokens.filter(
      (t) => !COVER_QUERY_MARKERS.has(t) && !TRACK_QUERY_STOP_WORDS.has(t),
    );
    if (focusTokens.length > 0) {
      const matched = focusTokens.filter((t) => fuzzyTokenInHaystack(titleHay, t)).length;
      if (matched >= Math.max(1, focusTokens.length - 1)) return true;
    }
  }

  return tokens.every((token) => hay.includes(token) || fuzzyTokenInHaystack(hay, token));
}

function albumTokensMatchQueryAlbum(
  albumQuery: string,
  albumName?: string,
  trackTitle?: string,
): boolean {
  const albumTokens = normalizeName(albumQuery).split(' ').filter((t) => t.length > 1);
  if (!albumTokens.length) return false;
  const hay = normalizeName(`${albumName ?? ''} ${trackTitle ?? ''}`);
  return albumTokens.every((token) => hay.includes(token));
}

const CATALOG_TRACK_SEARCH_MIN_SCORE = 200;

function catalogTrackMeetsSearchThreshold(track: CatalogTrack, query: string): boolean {
  if (!catalogFieldsMatchSearchQuery(
    { artist: track.artist, album: track.album, title: track.title },
    query,
  )) {
    return false;
  }
  return trackSearchRelevanceScore(track, query) >= CATALOG_TRACK_SEARCH_MIN_SCORE;
}

/** True when a search string is probably an artist name (not a track/album phrase). */
export function isLikelyArtistNameQuery(query: string): boolean {
  const trimmed = query.trim();
  if (isLikelyTrackTitleQuery(trimmed)) return false;
  if (trimmed.length < 2 || trimmed.length > 48) return false;
  if (/\b(feat\.?|ft\.?|remix|live at|official video|podcast)\b/i.test(trimmed)) {
    return false;
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 3) return false;
  if (words.length === 3 && /\b(you|again|feat|ft|remix|live|official)\b/i.test(trimmed)) {
    return false;
  }
  // Three-word strings are usually "artist + track" unless a multi-word artist pattern.
  if (words.length === 3) {
    const middle = words[1]!.toLowerCase();
    if (middle !== 'the' && middle !== 'and') return false;
  }
  if (words.length === 2) {
    if (words[1]!.length <= 2) return true;
    if (parseArtistAlbumQuery(trimmed)) return false;
  }
  if (words.length === 1) {
    const token = normalizeName(words[0]!);
    if (TITLE_LIKE_QUERY_TOKENS.has(token) || NON_ARTIST_QUERY_TOKENS.has(token)) return false;
    for (const fix of Object.values(KNOWN_TRACK_TITLE_CORRECTIONS)) {
      if (fuzzyTokensEquivalent(token, fix)) return false;
    }
  }
  return true;
}

function pickBestCatalogArtistForQuery(
  artists: CatalogArtist[],
  query: string,
): CatalogArtist | undefined {
  const ranked = rankArtistsByRelevance(artists, query);
  if (ranked.length === 0) return undefined;
  if (artistRelevanceScore(ranked[0].name, query) >= 500) {
    return ranked[0];
  }
  const tokens = queryRelevantTokens(query);
  for (let split = tokens.length - 1; split >= 1; split--) {
    const prefix = tokens.slice(0, split).join(' ');
    const hit = ranked.find((a) => artistRelevanceScore(a.name, prefix) >= 500);
    if (hit) return hit;
  }
  return undefined;
}

export function buildCatalogArtistStub(name: string): CatalogArtist {
  const display = catalogDisplayArtistName(name.trim());
  const slug = display.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    kind: 'artist',
    id: `artist-${slug || 'unknown'}`,
    name: display,
  };
}

export function findCatalogArtistByName(
  name: string,
  ...artistLists: CatalogArtist[][]
): CatalogArtist | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  for (const list of artistLists) {
    for (const artist of list) {
      if (artist.name.trim().toLowerCase() === key) return artist;
      if (artistNamesEquivalent(artist.name, name)) return artist;
    }
  }
  return undefined;
}

/** Resolve a display artist name to a catalog artist (for locker / local navigation). */
export async function resolveCatalogArtistByName(artistName: string): Promise<CatalogArtist> {
  const name = artistName.trim();
  if (!name) {
    return { kind: 'artist', id: 'artist-unknown', name: '' };
  }

  const catalog = await fetchSearchCatalog(name);
  const direct = pickBestCatalogArtistForQuery(catalog.artists, name);
  if (direct) return direct;

  const composite = await inferArtistFromCompositeQuery(name);
  if (composite) {
    return {
      kind: 'artist',
      id: `artist-${composite.artistId}`,
      name: catalogDisplayArtistName(composite.artistName),
    };
  }

  if (catalog.artists.length > 0) {
    return rankArtistsByRelevance(catalog.artists, name)[0];
  }

  return buildCatalogArtistStub(name);
}
