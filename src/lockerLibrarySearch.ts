import type { AlbumCollection, AlbumEdition } from './collectionIntelligence';
import { editionToAlbumGroup } from './collectionIntelligence';
import type { LockerEntry } from './lockerStorage';

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function entryMatchesQuery(entry: LockerEntry, q: string): boolean {
  if (!q) return true;
  const hay = [
    entry.title,
    entry.artist,
    entry.albumName,
    entry.albumArtist,
    entry.genre,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

/** In-place library filter — keeps browse context (no overlay panel). */
export function filterTracksByLibraryQuery(tracks: LockerEntry[], query: string): LockerEntry[] {
  const q = normalizeQuery(query);
  if (!q || q.length < 2) return tracks;
  return tracks.filter((entry) => entryMatchesQuery(entry, q));
}

export function filterCollectionsByLibraryQuery(
  collections: AlbumCollection[],
  query: string,
  preferredEdition: (collection: AlbumCollection) => AlbumEdition,
): AlbumCollection[] {
  const q = normalizeQuery(query);
  if (!q || q.length < 2) return collections;

  return collections.filter((collection) => {
    if (collection.displayName.toLowerCase().includes(q)) return true;
    if (collection.artist.toLowerCase().includes(q)) return true;
    const edition = preferredEdition(collection);
    const group = editionToAlbumGroup(collection, edition);
    return group.tracks.some((track) => entryMatchesQuery(track, q));
  });
}

export function sortCollectionsForLocker(
  collections: AlbumCollection[],
  sortBy: 'title' | 'added' | 'artist',
  preferredEdition: (collection: AlbumCollection) => AlbumEdition,
): AlbumCollection[] {
  const copy = [...collections];
  if (sortBy === 'artist') {
    return copy.sort((a, b) =>
      a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }),
    );
  }
  if (sortBy === 'added') {
    return copy.sort((a, b) => {
      const aTracks = preferredEdition(a).tracks;
      const bTracks = preferredEdition(b).tracks;
      const aAdded = Math.max(...aTracks.map((t) => t.addedAt), 0);
      const bAdded = Math.max(...bTracks.map((t) => t.addedAt), 0);
      return bAdded - aAdded;
    });
  }
  return copy.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  );
}
