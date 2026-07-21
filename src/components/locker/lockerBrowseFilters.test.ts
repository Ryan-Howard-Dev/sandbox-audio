import { describe, expect, it } from 'vitest';
import {
  filterCollectionsByBrowseFilter,
  filterTracksByBrowseFilter,
  isLockerEntryDownloaded,
  isLockerTrackSynced,
} from './lockerBrowseFilters';
import type { AlbumCollection } from '../../collectionIntelligence';
import type { LockerEntry } from '../../lockerStorage';

const entry = (id: string, url: string, offlineReady?: boolean): LockerEntry => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  genre: '',
  durationSeconds: 180,
  url,
  addedAt: 1,
  ...(offlineReady !== undefined ? { offlineReady } : {}),
});

const collection = (key: string, trackIds: string[], urls: string[]): AlbumCollection => ({
  key,
  releaseGroupId: null,
  title: 'Album',
  displayName: 'Album',
  artist: 'Artist',
  editionCount: 1,
  duplicateAlbumCount: 0,
  totalTracks: trackIds.length,
  preferredEditionKey: `${key}::Artist`,
  editions: [
    {
      key: `${key}::Artist`,
      name: key,
      displayName: 'Album',
      label: 'Original',
      kind: 'original',
      trackCount: trackIds.length,
      duplicateTrackCopies: 0,
      tracks: trackIds.map((id, i) => entry(id, urls[i] ?? '')),
      releaseGroupId: null,
    },
  ],
});

describe('lockerBrowseFilters', () => {
  it('detects downloaded blob URLs', () => {
    expect(isLockerEntryDownloaded(entry('1', 'blob:http://local/abc', true))).toBe(true);
    expect(isLockerEntryDownloaded(entry('1', 'blob:http://local/abc'))).toBe(false);
    expect(isLockerEntryDownloaded(entry('2', ''))).toBe(false);
    expect(isLockerEntryDownloaded({ ...entry('3', 'content://locker/x'), offlineReady: true })).toBe(true);
  });

  it('filters downloaded collections', () => {
    const cols = [
      collection('a', ['1'], ['content://locker/a']),
      collection('b', ['2'], ['']),
    ];
    cols[0].editions[0].tracks[0] = { ...cols[0].editions[0].tracks[0], offlineReady: true };
    const result = filterCollectionsByBrowseFilter(cols, 'downloaded', {}, (c) => c.editions[0]);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('a');
  });

  it('filters synced tracks', () => {
    const cols = [collection('album', ['1', '2'], ['blob:a', 'blob:b'])];
    const syncFlags = { 'album::Artist': true };
    expect(isLockerTrackSynced(entry('1', 'blob:a'), cols, syncFlags)).toBe(true);
    const tracks = filterTracksByBrowseFilter(
      cols[0].editions[0].tracks,
      'synced',
      cols,
      syncFlags,
    );
    expect(tracks).toHaveLength(2);
  });
});
