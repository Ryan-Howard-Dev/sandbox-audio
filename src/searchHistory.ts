/**
 * Recent search entries for the shell search bar (queries, artists, albums).
 */

import type { CatalogAlbum, CatalogArtist, CatalogTrack } from './searchCatalog';
import { catalogDisplayArtistName } from './searchCatalog';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const SEARCH_HISTORY_KEY = 'sandbox_search_history_v2';
const LEGACY_SEARCH_HISTORY_KEY = 'sandbox_search_history_v1';
const MAX_SEARCH_HISTORY = 15;

export type SearchHistoryQueryEntry = {
  kind: 'query';
  query: string;
  at: number;
};

export type SearchHistoryArtistEntry = {
  kind: 'artist';
  id: string;
  name: string;
  artworkUrl?: string;
  at: number;
};

export type SearchHistoryAlbumEntry = {
  kind: 'album';
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  releaseYear?: string;
  explicit?: boolean;
  at: number;
};

export type SearchHistoryTrackEntry = {
  kind: 'track';
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  at: number;
};

export type SearchHistoryEntry =
  | SearchHistoryQueryEntry
  | SearchHistoryArtistEntry
  | SearchHistoryAlbumEntry
  | SearchHistoryTrackEntry;

function readRawHistory(): SearchHistoryEntry[] {
  try {
    const raw = prefsGetItem(SEARCH_HISTORY_KEY);
    if (!raw) return migrateLegacyHistory();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return migrateLegacyHistory();
    const out: SearchHistoryEntry[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const kind = (row as { kind?: string }).kind;
      const at = typeof (row as { at?: number }).at === 'number' ? (row as { at: number }).at : Date.now();
      if (kind === 'query' && typeof (row as SearchHistoryQueryEntry).query === 'string') {
        const query = (row as SearchHistoryQueryEntry).query.trim();
        if (query) out.push({ kind: 'query', query, at });
        continue;
      }
      if (kind === 'artist' && typeof (row as SearchHistoryArtistEntry).name === 'string') {
        const entry = row as SearchHistoryArtistEntry;
        const id = entry.id?.trim() || `artist:${entry.name.trim().toLowerCase()}`;
        if (entry.name.trim()) {
          out.push({
            kind: 'artist',
            id,
            name: entry.name.trim(),
            artworkUrl: entry.artworkUrl?.trim() || undefined,
            at,
          });
        }
        continue;
      }
      if (kind === 'album' && typeof (row as SearchHistoryAlbumEntry).title === 'string') {
        const entry = row as SearchHistoryAlbumEntry;
        const id = entry.id?.trim() || `album:${entry.title.trim().toLowerCase()}`;
        if (entry.title.trim()) {
          out.push({
            kind: 'album',
            id,
            title: entry.title.trim(),
            artist: entry.artist?.trim() || 'Unknown Artist',
            artworkUrl: entry.artworkUrl?.trim() || undefined,
            releaseYear: entry.releaseYear?.trim() || undefined,
            explicit: entry.explicit,
            at,
          });
        }
        continue;
      }
      if (kind === 'track' && typeof (row as SearchHistoryTrackEntry).title === 'string') {
        const entry = row as SearchHistoryTrackEntry;
        const id = entry.id?.trim() || `track:${entry.title.trim().toLowerCase()}`;
        if (entry.title.trim()) {
          out.push({
            kind: 'track',
            id,
            title: entry.title.trim(),
            artist: entry.artist?.trim() || 'Unknown Artist',
            artworkUrl: entry.artworkUrl?.trim() || undefined,
            at,
          });
        }
      }
    }
    return out;
  } catch {
    return migrateLegacyHistory();
  }
}

function migrateLegacyHistory(): SearchHistoryEntry[] {
  try {
    const raw = prefsGetItem(LEGACY_SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const entries = parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((query) => query.trim())
      .filter(Boolean)
      .map((query, index) => ({
        kind: 'query' as const,
        query,
        at: now - index,
      }));
    if (entries.length > 0) writeHistory(entries);
    return entries;
  } catch {
    return [];
  }
}

function writeHistory(entries: SearchHistoryEntry[]): void {
  try {
    prefsSetItem(
      SEARCH_HISTORY_KEY,
      JSON.stringify(entries.slice(0, MAX_SEARCH_HISTORY)),
    );
  } catch {
    /* quota / private mode */
  }
}

export function historyEntryKey(entry: SearchHistoryEntry): string {
  switch (entry.kind) {
    case 'query':
      return `q:${entry.query.toLowerCase()}`;
    case 'artist':
      return `a:${entry.id}`;
    case 'album':
      return `al:${entry.id}`;
    case 'track':
      return `t:${entry.id}`;
    default:
      return `x:${Date.now()}`;
  }
}

function entrySearchText(entry: SearchHistoryEntry): string {
  switch (entry.kind) {
    case 'query':
      return entry.query;
    case 'artist':
      return entry.name;
    case 'album':
      return `${entry.title} ${entry.artist}`;
    case 'track':
      return `${entry.title} ${entry.artist}`;
    default:
      return '';
  }
}

function prependEntry(entry: SearchHistoryEntry): void {
  const key = historyEntryKey(entry);
  const next = [
    entry,
    ...readRawHistory().filter((existing) => historyEntryKey(existing) !== key),
  ];
  writeHistory(next);
}

export function loadSearchHistory(): SearchHistoryEntry[] {
  return readRawHistory();
}

/** Store a completed text search (most recent first). */
export function recordSearchQuery(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  prependEntry({ kind: 'query', query: trimmed, at: Date.now() });
}

export function recordSearchArtist(artist: CatalogArtist): void {
  const name = catalogDisplayArtistName(artist.name);
  if (!name) return;
  prependEntry({
    kind: 'artist',
    id: artist.id,
    name,
    artworkUrl: artist.artworkUrl,
    at: Date.now(),
  });
}

export function recordSearchAlbum(album: CatalogAlbum): void {
  const title = album.title.trim();
  if (!title) return;
  prependEntry({
    kind: 'album',
    id: album.id,
    title,
    artist: album.artist.trim() || 'Unknown Artist',
    artworkUrl: album.artworkUrl,
    releaseYear: album.releaseYear,
    explicit: album.explicit,
    at: Date.now(),
  });
}

export function recordSearchTrack(track: CatalogTrack): void {
  const title = track.title.trim();
  if (!title) return;
  prependEntry({
    kind: 'track',
    id: track.id,
    title,
    artist: track.artist.trim() || 'Unknown Artist',
    artworkUrl: track.artworkUrl,
    at: Date.now(),
  });
}

/** Persist artwork on a recent search row after async cover lookup. */
export function patchSearchHistoryArtwork(
  entry: SearchHistoryEntry,
  artworkUrl: string,
): void {
  const art = artworkUrl.trim();
  if (!art) return;
  if (entry.kind !== 'album' && entry.kind !== 'track' && entry.kind !== 'artist') return;
  if (entry.artworkUrl?.trim() === art) return;

  const key = historyEntryKey(entry);
  const next = readRawHistory().map((row) => {
    if (historyEntryKey(row) !== key) return row;
    if (row.kind === 'album' || row.kind === 'track' || row.kind === 'artist') {
      return { ...row, artworkUrl: art };
    }
    return row;
  });
  writeHistory(next);
}

/** Prefix + substring matches for the dropdown while typing (most recent first). */
export function matchSearchHistory(input: string, limit = 8): SearchHistoryEntry[] {
  const q = input.trim().toLowerCase();
  const history = readRawHistory();
  if (!q) return history.slice(0, limit);

  const prefix: SearchHistoryEntry[] = [];
  const contains: SearchHistoryEntry[] = [];
  for (const entry of history) {
    const lower = entrySearchText(entry).toLowerCase();
    if (lower.startsWith(q)) prefix.push(entry);
    else if (lower.includes(q)) contains.push(entry);
  }
  return [...prefix, ...contains].slice(0, limit);
}

export function removeSearchHistoryEntry(entryOrKey: SearchHistoryEntry | string): void {
  const key =
    typeof entryOrKey === 'string'
      ? entryOrKey
      : historyEntryKey(entryOrKey);
  writeHistory(readRawHistory().filter((entry) => historyEntryKey(entry) !== key));
}

export function clearSearchHistory(): void {
  writeHistory([]);
}

export function historyEntryToArtist(entry: SearchHistoryArtistEntry): CatalogArtist {
  return {
    kind: 'artist',
    id: entry.id,
    name: catalogDisplayArtistName(entry.name),
    artworkUrl: entry.artworkUrl,
  };
}

export function historyEntryToAlbum(entry: SearchHistoryAlbumEntry): CatalogAlbum {
  return {
    kind: 'album',
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    artworkUrl: entry.artworkUrl,
    releaseYear: entry.releaseYear,
    explicit: entry.explicit,
  };
}

export function historyEntryToTrack(entry: SearchHistoryTrackEntry): CatalogTrack {
  return {
    kind: 'track',
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    artworkUrl: entry.artworkUrl,
    envelope: {
      envelopeId: entry.id,
      title: entry.title,
      artist: entry.artist,
      url: '',
      durationSeconds: 0,
      provider: 'https',
      transport: 'element-src',
      sourceId: entry.id,
    },
  };
}
