import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  areAllTracksInLocker,
  filterTracksNeedingDownload,
  resolveCatalogLockerCoverage,
} from './downloadLockerPrecheck';
import type { CatalogTrack } from './searchCatalog';

vi.mock('./lockerStorage', () => ({
  findPlayableLockerEntryForTrack: vi.fn(async (title: string) =>
    title === 'Already Here' || title === 'Sked' ? { id: 'e1' } : null,
  ),
  findLockerEntryForTrackIncludingHollow: vi.fn((title: string) =>
    title === 'Heal Only' ? { id: 'heal-1' } : null,
  ),
  lockerEntryHasRecoverableAudio: vi.fn(async (id: string) => id === 'heal-1'),
  getLockerEntries: vi.fn(async () => []),
  tracksForAlbumGroup: vi.fn(() => []),
}));

describe('downloadLockerPrecheck', () => {
  const tracks: CatalogTrack[] = [
    {
      kind: 'track',
      id: '1',
      title: 'Already Here',
      artist: 'Artist',
      album: 'Album',
    },
    {
      kind: 'track',
      id: '2',
      title: 'Need This',
      artist: 'Artist',
      album: 'Album',
    },
  ];

  it('filters tracks already in locker', async () => {
    const result = await filterTracksNeedingDownload(tracks, 'Album');
    expect(result.skipped).toBe(1);
    expect(result.needing).toHaveLength(1);
    expect(result.needing[0]?.title).toBe('Need This');
  });

  it('detects when all tracks are local', async () => {
    const allLocal: CatalogTrack[] = [
      { kind: 'track', id: '1', title: 'Already Here', artist: 'Artist' },
      { kind: 'track', id: '2', title: 'Already Here', artist: 'Artist' },
    ];
    await expect(areAllTracksInLocker(allLocal, 'Album', 2)).resolves.toBe(true);
    await expect(areAllTracksInLocker(tracks, 'Album', 2)).resolves.toBe(false);
  });

  it('treats short listings as partial when metadata expects more tracks', async () => {
    const oneLocal: CatalogTrack[] = [
      { kind: 'track', id: '1', title: 'Already Here', artist: 'Artist', album: 'Album' },
    ];
    await expect(areAllTracksInLocker(oneLocal, 'Album', 15)).resolves.toBe(false);
  });
  it('skips hollow locker rows with recoverable audio', async () => {
    const withHeal: CatalogTrack[] = [
      { kind: 'track', id: 'h', title: 'Heal Only', artist: 'Artist', album: 'Album' },
      { kind: 'track', id: '2', title: 'Need This', artist: 'Artist', album: 'Album' },
    ];
    const result = await filterTracksNeedingDownload(withHeal, 'Album');
    expect(result.skipped).toBe(1);
    expect(result.needing).toHaveLength(1);
    expect(result.needing[0]?.title).toBe('Need This');
  });

  it('resolveCatalogLockerCoverage treats 1/15 locker rows as partial', async () => {
    const listing: CatalogTrack[] = [
      { kind: 'track', id: '1', title: 'Sked', artist: 'Denzel Curry', album: 'South Vol. 2' },
      ...Array.from({ length: 14 }, (_, i) => ({
        kind: 'track' as const,
        id: `t-${i + 2}`,
        title: `Track ${i + 2}`,
        artist: 'Denzel Curry',
        album: 'South Vol. 2',
      })),
    ];
    const coverage = await resolveCatalogLockerCoverage(
      {
        kind: 'album',
        id: 'album-1',
        title: 'King Of The Mischievous South Vol. 2',
        artist: 'Denzel Curry',
        trackCount: 15,
      },
      { listing },
    );
    expect(coverage.expectedTrackCount).toBe(15);
    expect(coverage.fullyInLocker).toBe(false);
    expect(coverage.needing).toHaveLength(14);
  });

  it('resolveCatalogLockerCoverage requires full listing before fullyInLocker', async () => {
    const oneLocal: CatalogTrack[] = [
      { kind: 'track', id: '1', title: 'Already Here', artist: 'Artist', album: 'Album' },
    ];
    const coverage = await resolveCatalogLockerCoverage(
      { kind: 'album', id: 'a', title: 'Album', artist: 'Artist', trackCount: 15 },
      { listing: oneLocal },
    );
    expect(coverage.fullyInLocker).toBe(false);
    expect(coverage.needing).toHaveLength(0);
  });

  it('nightcore album is not covered by standard american dream locker rows', async () => {
    const listing: CatalogTrack[] = [
      {
        kind: 'track',
        id: 'nc-1',
        title: 'Redrum',
        artist: '21 Savage',
        album: 'American Dream (Nightcore Version)',
      },
      {
        kind: 'track',
        id: 'nc-2',
        title: 'Nee Nah',
        artist: '21 Savage',
        album: 'American Dream (Nightcore Version)',
      },
    ];
    const coverage = await resolveCatalogLockerCoverage(
      {
        kind: 'album',
        id: 'ad-nc',
        title: 'American Dream (Nightcore Version)',
        artist: '21 Savage',
        trackCount: 2,
      },
      { listing, albumName: 'American Dream (Nightcore Version)' },
    );
    expect(coverage.fullyInLocker).toBe(false);
    expect(coverage.needing).toHaveLength(2);
  });
});
