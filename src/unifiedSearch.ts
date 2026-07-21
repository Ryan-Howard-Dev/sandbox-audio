/**
 * Unified search orchestrator — locker (local + Meilisearch), catalog, playlists.
 * Ranking: locker-local > locker-meili > catalog > playlist name match.
 */

import {
  applyCachedArtistImages,
  attachFallbackArtistArtwork,
  attachFallbackTrackArtwork,
  artistNeedsPhotoLookup,
  resolveArtistImages,
} from './artistImage';
import { groupLockerSearchHits } from './collectionIntelligence';
import { displayPlaylistName } from './importPlatforms';
import { hitToEnvelope, processLockerSearchHits } from './lockerSearch';
import { getLockerEntries, getLockerEntriesSnapshot, type LockerEntry } from './lockerStorage';
import { isSmartPlaylist, loadPlaylists } from './playlistStorage';
import {
  fetchRemoteCatalogSearch,
  catalogAlbumIdentityKey,
  dedupeCatalogAlbums,
  normalizeCatalogArtistKey,
  catalogFieldsMatchSearchQuery,
  webCatalogTrackMatchesQuery,
  isLikelyTrackTitleQuery,
  textRelevanceScore,
  type CatalogAlbum,
  type CatalogArtist,
  type CatalogSearchResult,
  type CatalogTrack,
} from './searchCatalog';
import { mergeWebCatalogResults } from './webCatalogSearch';
import { tier34SearchLocker, type Tier34SearchHit } from './tier34/client';

export type UnifiedSearchSection = 'all' | 'tracks' | 'albums' | 'artists' | 'playlists' | 'locker';

export type UnifiedSearchSource = 'locker-local' | 'locker-meili' | 'catalog' | 'playlist';

export type UnifiedPlaylistResult = {
  kind: 'playlist';
  id: string;
  name: string;
  trackCount: number;
  isSmart: boolean;
  source: 'playlist';
};

export type UnifiedSearchResult = {
  tracks: CatalogTrack[];
  albums: CatalogAlbum[];
  artists: CatalogArtist[];
  playlists: UnifiedPlaylistResult[];
  /** Locker vault tracks (local + Meilisearch), deduped. */
  lockerItems: CatalogTrack[];
  sections: UnifiedSearchSection[];
  suggestions: string[];
  meiliAvailable: boolean;
  /** Legacy shape for SearchDropdown compatibility. */
  catalog: CatalogSearchResult;
};

export type RunUnifiedSearchOptions = {
  limit?: number;
  onArtistImagesUpdated?: (result: UnifiedSearchResult) => void;
};

const EMPTY_CATALOG: CatalogSearchResult = {
  suggestions: [],
  artists: [],
  albums: [],
  tracks: [],
};

export const EMPTY_UNIFIED: UnifiedSearchResult = {
  tracks: [],
  albums: [],
  artists: [],
  playlists: [],
  lockerItems: [],
  sections: [],
  suggestions: [],
  meiliAvailable: false,
  catalog: EMPTY_CATALOG,
};

const SOURCE_RANK: Record<UnifiedSearchSource, number> = {
  'locker-local': 3000,
  'locker-meili': 2500,
  catalog: 1000,
  playlist: 500,
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ÿý]/g, 'y')
    .trim()
    .replace(/\s+/g, ' ');
}

function queryTokens(query: string): string[] {
  return normalizeName(query).split(' ').filter((t) => t.length > 1);
}

function lockerEntryMatchesQuery(entry: LockerEntry, query: string): boolean {
  const tokens = queryTokens(query);
  if (!tokens.length) return false;
  const hay = normalizeName(
    `${entry.artist} ${entry.albumArtist ?? ''} ${entry.title} ${entry.albumName ?? ''} ${entry.genre}`,
  );
  return tokens.every((token) => hay.includes(token));
}

function lockerTrackEnvelope(entry: LockerEntry): CatalogTrack['envelope'] {
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

function meiliHitToTrack(hit: Tier34SearchHit): CatalogTrack {
  return {
    kind: 'track',
    id: `local-track-${hit.envelopeId}`,
    title: hit.title,
    artist: hit.artist,
    album: hit.album,
    releaseYear: hit.year,
    envelope: hitToEnvelope(hit),
  };
}

function trackKey(track: Pick<CatalogTrack, 'artist' | 'title'>): string {
  return `${normalizeName(track.artist)}::${normalizeName(track.title)}`;
}

function albumKey(album: Pick<CatalogAlbum, 'artist' | 'title'>): string {
  return catalogAlbumIdentityKey(album.artist, album.title);
}

function artistKey(artist: Pick<CatalogArtist, 'name'>): string {
  return normalizeCatalogArtistKey(artist.name);
}

function relevanceScore(text: string, query: string): number {
  const fuzzy = textRelevanceScore(text, query);
  if (fuzzy > 0) return fuzzy;
  const n = normalizeName(text);
  const q = normalizeName(query);
  if (!q || !n) return 0;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 900;
  const qWords = q.split(' ').filter(Boolean);
  if (qWords.length > 1 && qWords.every((w) => n.includes(w))) {
    return n.startsWith(qWords[0]) ? 700 : 500;
  }
  if (n.includes(q)) return 300;
  if (qWords.some((w) => n.includes(w))) return 100;
  return 0;
}

function trackScore(track: CatalogTrack, query: string, source: UnifiedSearchSource): number {
  let score = SOURCE_RANK[source];
  if (isLikelyTrackTitleQuery(query)) {
    score += relevanceScore(track.title, query) * 14;
    score += relevanceScore(track.artist, query) * 4;
  } else {
    score += relevanceScore(track.artist, query) * 10;
    score += relevanceScore(track.title, query);
  }
  if (track.album) score += relevanceScore(track.album, query);
  return score;
}

function albumScore(album: CatalogAlbum, query: string, source: UnifiedSearchSource): number {
  let score = SOURCE_RANK[source];
  score += relevanceScore(album.artist, query) * 10;
  score += relevanceScore(album.title, query) * 2;
  return score;
}

function artistScore(artist: CatalogArtist, query: string, source: UnifiedSearchSource): number {
  let score = SOURCE_RANK[source] + relevanceScore(artist.name, query) * 10;
  if (isLikelyTrackTitleQuery(query)) score -= 300;
  return score;
}

function playlistScore(name: string, query: string): number {
  return SOURCE_RANK.playlist + relevanceScore(name, query) * 10;
}

function mergeRankedTracks(
  rows: Array<{ track: CatalogTrack; source: UnifiedSearchSource }>,
  query: string,
): CatalogTrack[] {
  const byKey = new Map<string, { track: CatalogTrack; score: number }>();
  for (const { track, source } of rows) {
    const key = trackKey(track);
    const score = trackScore(track, query, source);
    const existing = byKey.get(key);
    if (!existing || score > existing.score) {
      byKey.set(key, { track, score });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .map((row) => row.track);
}

function rankAlbumRows(
  rows: Array<{ album: CatalogAlbum; source: UnifiedSearchSource }>,
  query: string,
): CatalogAlbum[] {
  return [...rows]
    .sort(
      (a, b) =>
        albumScore(b.album, query, b.source) - albumScore(a.album, query, a.source),
    )
    .map((row) => row.album);
}

function mergeRankedArtists(
  rows: Array<{ artist: CatalogArtist; source: UnifiedSearchSource }>,
  query: string,
): CatalogArtist[] {
  const byKey = new Map<string, { artist: CatalogArtist; score: number }>();
  for (const { artist, source } of rows) {
    const key = artistKey(artist);
    const score = artistScore(artist, query, source);
    const existing = byKey.get(key);
    if (!existing || score > existing.score) {
      byKey.set(key, { artist, score });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .map((row) => row.artist);
}

function buildLocalLockerMatches(
  entries: LockerEntry[],
  query: string,
  limit: number,
): {
  tracks: CatalogTrack[];
  albums: CatalogAlbum[];
  artists: CatalogArtist[];
} {
  const matches = entries.filter((entry) => lockerEntryMatchesQuery(entry, query));
  if (!matches.length) return { tracks: [], albums: [], artists: [] };

  const artistMap = new Map<string, CatalogArtist>();
  const albumMap = new Map<string, CatalogAlbum>();
  const tracks: CatalogTrack[] = [];

  for (const entry of matches) {
    tracks.push({
      kind: 'track',
      id: `local-track-${entry.id}`,
      title: entry.title,
      artist: entry.artist,
      album: entry.albumName,
      artworkUrl: entry.albumArt,
      releaseYear: entry.releaseYear,
      envelope: lockerTrackEnvelope(entry),
    });

    const artistName = (entry.albumArtist || entry.artist).trim();
    if (artistName && relevanceScore(artistName, query) > 0) {
      const key = normalizeName(artistName);
      if (!artistMap.has(key)) {
        artistMap.set(key, {
          kind: 'artist',
          id: `local-artist-${key.replace(/\s+/g, '-')}`,
          name: artistName,
        });
      }
    }

    if (entry.albumName) {
      const albumArtist = (entry.albumArtist || entry.artist).trim();
      const key = albumKey({ artist: albumArtist, title: entry.albumName });
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          kind: 'album',
          id: `local-album-${key.replace(/\s+/g, '-')}`,
          title: entry.albumName,
          artist: albumArtist,
          artworkUrl: entry.albumArt,
          releaseYear: entry.releaseYear,
        });
      }
    }
  }

  return {
    tracks: tracks.slice(0, limit),
    albums: [...albumMap.values()].slice(0, limit),
    artists: [...artistMap.values()].slice(0, limit),
  };
}

/** Synchronous locker-only preview for instant typeahead (no network). */
export function instantLocalLockerSearch(query: string, limit = 16): CatalogSearchResult {
  const q = query.trim();
  if (q.length < 1) return EMPTY_CATALOG;
  const entries = getLockerEntriesSnapshot() ?? [];
  const local = buildLocalLockerMatches(entries, q, limit);
  const suggestions = buildSuggestions(q, local.artists, local.albums, []);
  return toCatalogShape(local.tracks, local.albums, local.artists, suggestions);
}

async function scanLocalLocker(query: string, limit: number): Promise<{
  tracks: CatalogTrack[];
  albums: CatalogAlbum[];
  artists: CatalogArtist[];
}> {
  let entries: LockerEntry[];
  try {
    entries = await getLockerEntries();
  } catch {
    return { tracks: [], albums: [], artists: [] };
  }
  return buildLocalLockerMatches(entries, query, limit);
}

async function searchMeiliLocker(query: string, limit: number): Promise<{
  ok: boolean;
  tracks: CatalogTrack[];
  albums: CatalogAlbum[];
  artists: CatalogArtist[];
  collections: CatalogAlbum[];
}> {
  const result = await tier34SearchLocker(query, { limit });
  if (!result.ok || result.hits.length === 0) {
    return { ok: result.ok, tracks: [], albums: [], artists: [], collections: [] };
  }

  const processed = processLockerSearchHits(result.hits);
  const tracks = processed.tracks.map(meiliHitToTrack);

  const grouped = groupLockerSearchHits(result.hits, (hit) => ({
    kind: 'track' as const,
    id: `local-track-${hit.envelopeId}`,
    title: hit.title,
    artist: hit.artist,
    album: hit.album || undefined,
    releaseYear: hit.year,
    envelope: hitToEnvelope(hit),
  }));

  const collections: CatalogAlbum[] = grouped.map((g) => {
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

  const albums: CatalogAlbum[] = processed.albums.map((album) => ({
    kind: 'album',
    id: `local-album-${album.key}`,
    title: album.title,
    artist: album.artist,
    releaseYear: album.year,
    trackCount: album.trackCount,
    editionCount: album.editionCount,
    releaseGroupId: album.releaseGroupId,
    isCollectionEdition: album.editionCount > 1,
  }));

  const artists: CatalogArtist[] = processed.artists.map((artist) => ({
    kind: 'artist',
    id: `local-artist-${artist.key.replace(/\s+/g, '-')}`,
    name: artist.name,
  }));

  return { ok: true, tracks, albums, artists, collections };
}

function searchPlaylists(query: string, limit: number): UnifiedPlaylistResult[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];

  return loadPlaylists()
    .map((pl) => {
      const name = displayPlaylistName(pl);
      const hay = normalizeName(name);
      const matches =
        relevanceScore(name, query) > 0 ||
        tokens.every((t) => hay.includes(t));
      if (!matches) return null;
      return {
        kind: 'playlist' as const,
        id: pl.id,
        name,
        trackCount: pl.tracks.length,
        isSmart: isSmartPlaylist(pl),
        source: 'playlist' as const,
      };
    })
    .filter((row): row is UnifiedPlaylistResult => row != null)
    .sort((a, b) => playlistScore(b.name, query) - playlistScore(a.name, query))
    .slice(0, limit);
}

function buildSuggestions(
  query: string,
  artists: CatalogArtist[],
  albums: CatalogAlbum[],
  playlists: UnifiedPlaylistResult[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(value.trim());
  };

  push(query);
  for (const artist of artists) push(artist.name);
  for (const album of albums) push(`${album.artist} ${album.title}`);
  return out.slice(0, 6);
}

function computeSections(result: Omit<UnifiedSearchResult, 'sections' | 'catalog'>): UnifiedSearchSection[] {
  const sections: UnifiedSearchSection[] = ['all'];
  if (result.tracks.length > 0) sections.push('tracks');
  if (result.albums.length > 0) sections.push('albums');
  if (result.artists.length > 0) sections.push('artists');
  if (result.playlists.length > 0) sections.push('playlists');
  if (result.lockerItems.length > 0) sections.push('locker');
  return sections;
}

function toCatalogShape(
  tracks: CatalogTrack[],
  albums: CatalogAlbum[],
  artists: CatalogArtist[],
  suggestions: string[],
): CatalogSearchResult {
  return {
    suggestions,
    artists: artists.slice(0, 4),
    albums: albums.slice(0, 6),
    tracks: tracks.slice(0, 8),
  };
}

function cloneUnifiedWithArtists(
  result: UnifiedSearchResult,
  artists: CatalogArtist[],
  catalog: CatalogSearchResult,
): UnifiedSearchResult {
  const artistCopies = artists.map((artist) => ({ ...artist }));
  return {
    ...result,
    artists: artistCopies,
    catalog: {
      ...catalog,
      artists: artistCopies.slice(0, 4),
    },
  };
}

export async function runUnifiedSearch(
  query: string,
  options?: RunUnifiedSearchOptions,
): Promise<UnifiedSearchResult> {
  const q = query.trim();
  const limit = options?.limit ?? 40;
  if (q.length < 2) return EMPTY_UNIFIED;

  const [localLocker, meiliLocker, remoteCatalog, playlists] = await Promise.all([
    scanLocalLocker(q, limit),
    searchMeiliLocker(q, limit),
    fetchRemoteCatalogSearch(q),
    Promise.resolve(searchPlaylists(q, limit)),
  ]);

  const trackRows: Array<{ track: CatalogTrack; source: UnifiedSearchSource }> = [];
  const albumRows: Array<{ album: CatalogAlbum; source: UnifiedSearchSource }> = [];
  const artistRows: Array<{ artist: CatalogArtist; source: UnifiedSearchSource }> = [];

  for (const track of localLocker.tracks) {
    trackRows.push({ track, source: 'locker-local' });
  }
  for (const album of localLocker.albums) {
    albumRows.push({ album, source: 'locker-local' });
  }
  for (const artist of localLocker.artists) {
    artistRows.push({ artist, source: 'locker-local' });
  }

  if (meiliLocker.ok) {
    for (const track of meiliLocker.tracks) {
      trackRows.push({ track, source: 'locker-meili' });
    }
    for (const album of [...meiliLocker.collections, ...meiliLocker.albums]) {
      albumRows.push({ album, source: 'locker-meili' });
    }
    for (const artist of meiliLocker.artists) {
      artistRows.push({ artist, source: 'locker-meili' });
    }
  }

  for (const track of remoteCatalog.tracks) {
    trackRows.push({ track, source: 'catalog' });
  }
  for (const album of remoteCatalog.albums) {
    albumRows.push({ album, source: 'catalog' });
  }
  for (const artist of remoteCatalog.artists) {
    artistRows.push({ artist, source: 'catalog' });
  }

  const tracks = mergeRankedTracks(trackRows, q).filter((track) =>
    track.id.startsWith('youtube-')
      ? webCatalogTrackMatchesQuery(track, q)
      : catalogFieldsMatchSearchQuery(
          { artist: track.artist, album: track.album, title: track.title },
          q,
        ),
  );
  const albums = dedupeCatalogAlbums(rankAlbumRows(albumRows, q));
  const rankedArtists = mergeRankedArtists(artistRows, q);
  const artists = isLikelyTrackTitleQuery(q)
    ? rankedArtists.filter((a) => {
        if (/backstreet/i.test(a.name) && /kany|ye/i.test(q)) return false;
        return relevanceScore(a.name, q) >= 300;
      }).slice(0, 2)
    : rankedArtists;
  const lockerItems = mergeRankedTracks(
    trackRows.filter((row) => row.source !== 'catalog'),
    q,
  );

  const suggestions = buildSuggestions(q, artists, albums, playlists);
  applyCachedArtistImages(artists);
  attachFallbackArtistArtwork(artists, albums, tracks);
  attachFallbackTrackArtwork(tracks, albums);
  const catalog = toCatalogShape(tracks, albums, artists, suggestions);

  const base: Omit<UnifiedSearchResult, 'sections'> = {
    tracks,
    albums,
    artists,
    playlists,
    lockerItems,
    suggestions,
    meiliAvailable: meiliLocker.ok,
    catalog,
  };

  const result: UnifiedSearchResult = {
    ...base,
    sections: computeSections(base),
  };

  if (artists.some(artistNeedsPhotoLookup)) {
    if (options?.onArtistImagesUpdated) {
      void resolveArtistImages(artists).then(() => {
        options.onArtistImagesUpdated!(cloneUnifiedWithArtists(result, artists, catalog));
      });
    } else {
      await resolveArtistImages(artists);
    }
  }

  return result;
}

/** Merge progressive YouTube/web hits into an in-flight unified search result. */
export function applyWebSupplementToUnified(
  unified: UnifiedSearchResult,
  webTracks: CatalogTrack[],
  query: string,
): UnifiedSearchResult {
  if (!webTracks.length) return unified;

  const catalog = mergeWebCatalogResults(unified.catalog, webTracks, query);
  const existingNonWeb = unified.tracks.filter((t) => !t.id.startsWith('youtube-'));
  const webFromCatalog = catalog.tracks.filter((t) => t.id.startsWith('youtube-'));
  const seen = new Set<string>();
  const tracks: CatalogTrack[] = [];
  for (const track of [...webFromCatalog, ...existingNonWeb]) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    tracks.push(track);
  }

  const sections = [...unified.sections];
  if (tracks.length > 0 && !sections.includes('tracks')) {
    sections.splice(1, 0, 'tracks');
  }

  return {
    ...unified,
    catalog,
    tracks: tracks.slice(0, 12),
    sections,
  };
}
