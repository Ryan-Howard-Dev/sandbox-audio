/**
 * Locker Search 2.0 — result shaping by mode + collection intelligence grouping.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { groupLockerSearchHits } from './collectionIntelligence';
import { getLockerEntries, type LockerEntry } from './lockerStorage';
import type {
  LockerSearchFacets,
  LockerSearchFilters,
  LockerSearchMode,
  Tier34SearchHit,
} from './tier34/client';

export type LockerSearchAlbumResult = {
  key: string;
  title: string;
  artist: string;
  year?: string;
  genre?: string;
  source?: string;
  trackCount: number;
  releaseGroupId?: string;
  editionCount: number;
  hits: Tier34SearchHit[];
};

export type LockerSearchArtistResult = {
  key: string;
  name: string;
  trackCount: number;
  albumCount: number;
};

export type LockerSearchCollectionResult = {
  collectionKey: string;
  title: string;
  artist: string;
  releaseGroupId: string | null;
  editionCount: number;
  trackCount: number;
  albums: LockerSearchAlbumResult[];
  tracks: Tier34SearchHit[];
};

export type LockerSearchProcessed = {
  tracks: Tier34SearchHit[];
  albums: LockerSearchAlbumResult[];
  artists: LockerSearchArtistResult[];
  collections: LockerSearchCollectionResult[];
  totalHits: number;
};

export const LOCKER_SEARCH_FACETS = [
  'artist',
  'genre',
  'year',
  'source',
  'musicbrainzReleaseGroupId',
  'lossless',
] as const;

export function hitToEnvelope(
  hit: Pick<Tier34SearchHit, 'envelopeId' | 'title' | 'artist' | 'album' | 'year' | 'hash'>,
): MediaEnvelope {
  return {
    envelopeId: `local-${hit.envelopeId}`,
    title: hit.title,
    artist: hit.artist,
    album: hit.album || undefined,
    url: `/api/locker/blob/${hit.hash}`,
    durationSeconds: 210,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: hit.envelopeId,
    releaseYear: hit.year,
  };
}

function albumKey(hit: Tier34SearchHit): string {
  const artist = (hit.albumArtist || hit.artist || 'Unknown').trim();
  const album = (hit.album || 'Unknown Album').trim();
  return `${artist.toLowerCase()}::${album.toLowerCase()}`;
}

function artistKey(name: string): string {
  return name.trim().toLowerCase();
}

export function processLockerSearchHits(hits: Tier34SearchHit[]): LockerSearchProcessed {
  const tracks = hits;

  const albumMap = new Map<string, LockerSearchAlbumResult>();
  for (const hit of hits) {
    const key = albumKey(hit);
    const existing = albumMap.get(key);
    if (existing) {
      existing.hits.push(hit);
      existing.trackCount += 1;
    } else {
      albumMap.set(key, {
        key,
        title: hit.album?.trim() || 'Unknown Album',
        artist: (hit.albumArtist || hit.artist || 'Unknown Artist').trim(),
        year: hit.year,
        genre: hit.genre,
        source: hit.source,
        trackCount: 1,
        releaseGroupId: hit.musicbrainzReleaseGroupId,
        editionCount: 1,
        hits: [hit],
      });
    }
  }
  const albums = [...albumMap.values()].sort((a, b) => b.trackCount - a.trackCount);

  const artistMap = new Map<string, LockerSearchArtistResult>();
  const artistAlbums = new Map<string, Set<string>>();
  for (const hit of hits) {
    const name = (hit.albumArtist || hit.artist || 'Unknown Artist').trim();
    const aKey = artistKey(name);
    const existing = artistMap.get(aKey);
    if (existing) {
      existing.trackCount += 1;
    } else {
      artistMap.set(aKey, { key: aKey, name, trackCount: 1, albumCount: 0 });
      artistAlbums.set(aKey, new Set());
    }
    if (hit.album?.trim()) {
      artistAlbums.get(aKey)?.add(albumKey(hit));
    }
  }
  for (const [aKey, albumSet] of artistAlbums) {
    const row = artistMap.get(aKey);
    if (row) row.albumCount = albumSet.size;
  }
  const artists = [...artistMap.values()].sort((a, b) => b.trackCount - a.trackCount);

  const grouped = groupLockerSearchHits(hits, (hit) => ({
    kind: 'track' as const,
    id: `local-track-${hit.envelopeId}`,
    title: hit.title,
    artist: hit.artist,
    album: hit.album || undefined,
    releaseYear: hit.year,
    envelope: hitToEnvelope(hit),
  }));

  const collections: LockerSearchCollectionResult[] = grouped.map((g) => {
    const editionHits = new Map<string, Tier34SearchHit[]>();
    for (const hit of hits) {
      const rg = hit.musicbrainzReleaseGroupId?.trim();
      const matchesCollection =
        (rg && g.releaseGroupId === rg) ||
        (!rg &&
          !g.releaseGroupId &&
          g.collectionKey ===
            `album:${hit.artist.toLowerCase()}::${(hit.album || '').toLowerCase()}`);
      if (!matchesCollection) continue;
      const ek = albumKey(hit);
      const list = editionHits.get(ek) ?? [];
      list.push(hit);
      editionHits.set(ek, list);
    }

    const editionAlbums: LockerSearchAlbumResult[] = [...editionHits.entries()].map(
      ([ek, editionHitList]) => {
        const sample = editionHitList[0]!;
        return {
          key: ek,
          title: sample.album?.trim() || g.title,
          artist: (sample.albumArtist || sample.artist || g.artist).trim(),
          year: sample.year,
          genre: sample.genre,
          source: sample.source,
          trackCount: editionHitList.length,
          releaseGroupId: g.releaseGroupId ?? undefined,
          editionCount: g.editionCount,
          hits: editionHitList,
        };
      },
    );

    const collectionHits = hits.filter((hit) => {
      const rg = hit.musicbrainzReleaseGroupId?.trim();
      if (rg && g.releaseGroupId) return rg === g.releaseGroupId;
      return (
        g.collectionKey ===
        `album:${hit.artist.toLowerCase()}::${(hit.album || '').toLowerCase()}`
      );
    });

    return {
      collectionKey: g.collectionKey,
      title: g.title,
      artist: g.artist,
      releaseGroupId: g.releaseGroupId,
      editionCount: g.editionCount,
      trackCount: collectionHits.length,
      albums: editionAlbums,
      tracks: collectionHits,
    };
  });

  return {
    tracks,
    albums,
    artists,
    collections,
    totalHits: hits.length,
  };
}

export function facetOptions(
  facetDistribution: LockerSearchFacets | undefined,
  field: string,
  limit = 12,
): string[] {
  const bucket = facetDistribution?.[field];
  if (!bucket) return [];
  return Object.entries(bucket)
    .filter(([value]) => value.trim().length > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}

export function releaseGroupFacetOptions(
  facetDistribution: LockerSearchFacets | undefined,
): Array<{ id: string; count: number }> {
  const bucket = facetDistribution?.musicbrainzReleaseGroupId;
  if (!bucket) return [];
  return Object.entries(bucket)
    .filter(([id]) => id.trim().length > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id, count]) => ({ id, count }));
}

export function activeFilterCount(filters: LockerSearchFilters): number {
  let n = 0;
  if (filters.artist) n += 1;
  if (filters.genre) n += 1;
  if (filters.year) n += 1;
  if (filters.source) n += 1;
  if (filters.releaseGroupId) n += 1;
  if (filters.lossless !== undefined) n += 1;
  return n;
}

export function resultsForMode(
  processed: LockerSearchProcessed,
  mode: LockerSearchMode,
): LockerSearchProcessed[keyof LockerSearchProcessed] {
  switch (mode) {
    case 'tracks':
      return processed.tracks;
    case 'albums':
      return processed.albums;
    case 'artists':
      return processed.artists;
    case 'collections':
      return processed.collections;
    default:
      return processed.tracks;
  }
}

function normalizeLockerQuery(value: string): string {
  return value.trim().toLowerCase();
}

function lockerEntryMatchesLocalQuery(entry: LockerEntry, query: string): boolean {
  const tokens = normalizeLockerQuery(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const hay = normalizeLockerQuery(
    `${entry.artist} ${entry.albumArtist ?? ''} ${entry.title} ${entry.albumName ?? ''} ${entry.genre}`,
  );
  return tokens.every((token) => hay.includes(token));
}

function lockerEntryMatchesFilters(
  entry: LockerEntry,
  filters?: LockerSearchFilters,
): boolean {
  if (!filters) return true;
  if (filters.artist) {
    const artist = (entry.albumArtist || entry.artist).trim();
    if (normalizeLockerQuery(artist) !== normalizeLockerQuery(filters.artist)) return false;
  }
  if (filters.genre && normalizeLockerQuery(entry.genre) !== normalizeLockerQuery(filters.genre)) {
    return false;
  }
  if (filters.year && (entry.releaseYear ?? '').trim() !== filters.year.trim()) return false;
  if (filters.source && normalizeLockerQuery(filters.source) !== 'local-device') return false;
  if (filters.lossless === true) return false;
  return true;
}

function lockerEntryToSearchHit(entry: LockerEntry): Tier34SearchHit {
  return {
    id: entry.id,
    envelopeId: entry.id,
    title: entry.title,
    artist: entry.artist,
    albumArtist: entry.albumArtist,
    album: entry.albumName ?? '',
    genre: entry.genre,
    year: entry.releaseYear,
    hash: entry.id,
    source: 'local-device',
  };
}

/** IndexedDB locker scan when Meilisearch or tier34 search proxy is unavailable. */
export async function searchLockerLocalFallback(
  query: string,
  options?: { limit?: number; filters?: LockerSearchFilters },
): Promise<Tier34SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  let entries: LockerEntry[];
  try {
    entries = await getLockerEntries();
  } catch {
    return [];
  }

  const limit = options?.limit ?? 60;
  const filters = options?.filters;
  const hits: Tier34SearchHit[] = [];

  for (const entry of entries) {
    if (!lockerEntryMatchesLocalQuery(entry, q)) continue;
    if (!lockerEntryMatchesFilters(entry, filters)) continue;
    hits.push(lockerEntryToSearchHit(entry));
    if (hits.length >= limit) break;
  }

  return hits;
}
