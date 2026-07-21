/**
 * Flat selectable list for shell search dropdown keyboard navigation.
 */

import {
  catalogAlbumIdentityKey,
  catalogArtistNamesEquivalent,
  normalizeCatalogArtistKey,
  type CatalogAlbum,
  type CatalogArtist,
  type CatalogSearchResult,
  type CatalogTrack,
} from './searchCatalog';
import type { UnifiedPlaylistResult } from './unifiedSearch';
import type { SearchHistoryEntry } from './searchHistory';

export type SearchDropdownItem =
  | { kind: 'recent'; entry: SearchHistoryEntry }
  | { kind: 'suggestion'; query: string }
  | { kind: 'playlist'; playlist: UnifiedPlaylistResult }
  | { kind: 'artist'; artist: CatalogArtist }
  | { kind: 'album'; album: CatalogAlbum }
  | { kind: 'track'; track: CatalogTrack }
  | { kind: 'view-all' };

export type BuildSearchDropdownItemsInput = {
  query: string;
  recentSearches: SearchHistoryEntry[];
  catalog: CatalogSearchResult;
  playlists: UnifiedPlaylistResult[];
  includeViewAll: boolean;
};

function recentArtistKey(entry: Extract<SearchHistoryEntry, { kind: 'artist' }>): string {
  return normalizeCatalogArtistKey(entry.name);
}

function recentAlbumKey(entry: Extract<SearchHistoryEntry, { kind: 'album' }>): string {
  return catalogAlbumIdentityKey(entry.artist, entry.title);
}

function artistAlreadyListed(
  name: string,
  seenArtists: Set<string>,
): boolean {
  const key = normalizeCatalogArtistKey(name);
  if (seenArtists.has(key)) return true;
  for (const seen of seenArtists) {
    if (catalogArtistNamesEquivalent(name, seen)) return true;
  }
  return false;
}

function albumAlreadyListed(
  album: Pick<CatalogAlbum, 'artist' | 'title'>,
  seenAlbums: Set<string>,
): boolean {
  return seenAlbums.has(catalogAlbumIdentityKey(album.artist, album.title));
}

export function buildSearchDropdownItems(input: BuildSearchDropdownItemsInput): SearchDropdownItem[] {
  const trimmed = input.query.trim();
  if (trimmed.length < 2) return [];

  const suggestionSet = new Set(input.catalog.suggestions.map((s) => s.toLowerCase()));
  const seenArtists = new Set<string>();
  const seenAlbums = new Set<string>();
  const items: SearchDropdownItem[] = [];

  for (const entry of input.recentSearches) {
    const label =
      entry.kind === 'query'
        ? entry.query.toLowerCase()
        : entry.kind === 'artist'
          ? entry.name.toLowerCase()
          : entry.kind === 'album'
            ? entry.title.toLowerCase()
            : entry.title.toLowerCase();
    if (!suggestionSet.has(label)) {
      items.push({ kind: 'recent', entry });
      if (entry.kind === 'artist') {
        seenArtists.add(recentArtistKey(entry));
      } else if (entry.kind === 'album') {
        seenAlbums.add(recentAlbumKey(entry));
      }
    }
  }

  for (const suggestion of input.catalog.suggestions) {
    items.push({ kind: 'suggestion', query: suggestion });
  }

  for (const playlist of input.playlists) {
    items.push({ kind: 'playlist', playlist });
  }

  if (input.catalog.tracks.length > 0) {
    items.push({ kind: 'track', track: input.catalog.tracks[0]! });
  }

  for (const artist of input.catalog.artists) {
    if (artistAlreadyListed(artist.name, seenArtists)) continue;
    seenArtists.add(normalizeCatalogArtistKey(artist.name));
    items.push({ kind: 'artist', artist });
  }

  for (const album of input.catalog.albums) {
    if (albumAlreadyListed(album, seenAlbums)) continue;
    seenAlbums.add(catalogAlbumIdentityKey(album.artist, album.title));
    items.push({ kind: 'album', album });
  }

  for (const track of input.catalog.tracks.slice(1)) {
    items.push({ kind: 'track', track });
  }

  if (input.includeViewAll && items.length > 0) {
    items.push({ kind: 'view-all' });
  }

  return items;
}

export function clampSearchActiveIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return -1;
  if (index < 0) return -1;
  if (index >= itemCount) return itemCount - 1;
  return index;
}

export function nextSearchActiveIndex(current: number, itemCount: number): number {
  if (itemCount <= 0) return -1;
  if (current < 0) return 0;
  return Math.min(current + 1, itemCount - 1);
}

export function prevSearchActiveIndex(current: number, itemCount: number): number {
  if (itemCount <= 0) return -1;
  if (current <= 0) return -1;
  return current - 1;
}
