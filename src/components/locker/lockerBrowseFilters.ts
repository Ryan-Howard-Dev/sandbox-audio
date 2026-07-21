import type { AlbumCollection, AlbumEdition } from '../../collectionIntelligence';
import { editionToAlbumGroup } from '../../collectionIntelligence';
import type { LockerEntry } from '../../lockerStorage';

export type LockerBrowseFilterId = 'all' | 'artists' | 'downloaded' | 'synced';

export const LOCKER_BROWSE_FILTERS: LockerBrowseFilterId[] = [
  'all',
  'artists',
  'downloaded',
  'synced',
];

/** Track has local audio bytes ready to play offline. */
export function isLockerEntryDownloaded(entry: LockerEntry): boolean {
  if (entry.offlineReady === true) return true;
  if (entry.offlineReady === false) return false;
  const url = entry.url?.trim() ?? '';
  if (!url) return false;
  if (/^content:\/\//i.test(url)) return true;
  // blob: and API paths are not trusted without offlineReady — avoids false OFFLINE badges.
  return false;
}

export type LockerDownloadStatus = 'full' | 'partial' | 'none';

export function collectionDownloadStatus(
  tracks: LockerEntry[],
): LockerDownloadStatus {
  if (tracks.length === 0) return 'none';
  const downloaded = tracks.filter(isLockerEntryDownloaded).length;
  if (downloaded === 0) return 'none';
  if (downloaded === tracks.length) return 'full';
  return 'partial';
}

export function isLockerAlbumSynced(
  albumKey: string,
  collectionKey: string,
  syncFlags: Record<string, boolean>,
): boolean {
  return Boolean(syncFlags[albumKey] || syncFlags[collectionKey]);
}

export function isLockerTrackSynced(
  entry: LockerEntry,
  collections: AlbumCollection[],
  syncFlags: Record<string, boolean>,
): boolean {
  for (const collection of collections) {
    for (const edition of collection.editions) {
      if (!edition.tracks.some((t) => t.id === entry.id)) continue;
      if (isLockerAlbumSynced(edition.key, collection.key, syncFlags)) return true;
    }
  }
  return false;
}

export function filterCollectionsByBrowseFilter(
  collections: AlbumCollection[],
  filter: LockerBrowseFilterId,
  syncFlags: Record<string, boolean>,
  preferredEdition: (collection: AlbumCollection) => AlbumEdition,
  pendingDownloadTrackIds?: ReadonlySet<string>,
): AlbumCollection[] {
  if (filter === 'all' || filter === 'artists') return collections;

  if (filter === 'synced') {
    return collections.filter((collection) => {
      const edition = preferredEdition(collection);
      const group = editionToAlbumGroup(collection, edition);
      return isLockerAlbumSynced(group.key, collection.key, syncFlags);
    });
  }

  if (filter === 'downloaded') {
    return collections.filter((collection) => {
      const edition = preferredEdition(collection);
      const group = editionToAlbumGroup(collection, edition);
      return group.tracks.some(
        (t) => isLockerEntryDownloaded(t) || pendingDownloadTrackIds?.has(t.id),
      );
    });
  }

  return collections;
}

export function filterTracksByBrowseFilter(
  tracks: LockerEntry[],
  filter: LockerBrowseFilterId,
  collections: AlbumCollection[],
  syncFlags: Record<string, boolean>,
): LockerEntry[] {
  if (filter === 'all' || filter === 'artists') return tracks;
  if (filter === 'synced') {
    return tracks.filter((entry) => isLockerTrackSynced(entry, collections, syncFlags));
  }
  if (filter === 'downloaded') {
    return tracks.filter(isLockerEntryDownloaded);
  }
  return tracks;
}
