import { describe, expect, it, vi } from 'vitest';
import type { LockerEntry } from './lockerStorage';

vi.mock('./lockerStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lockerStorage')>();
  return {
    ...actual,
    lockerEntryIsPlayable: vi.fn(async (id: string) => id.endsWith('-playable')),
    getLockerEntries: vi.fn(),
    removeLockerEntry: vi.fn(async () => undefined),
    pruneMetadataOnlyLockerDuplicates: vi.fn(async () => 0),
    pruneHollowLockerEntriesFromStorage: vi.fn(async () => 0),
    recoverOrphanedLockerBlobs: vi.fn(async () => 0),
    warmLockerNativePlaybackCache: vi.fn(async () => 0),
    auditLockerVaultHealth: vi.fn(async () => ({
      trackRows: 0,
      blobStoreKeys: 0,
      orphanedBlobs: 0,
      playableTracks: 0,
      healableTracks: 0,
      metadataOnlyTracks: 0,
    })),
    reconcileLockerBlobIntegrity: vi.fn(async () => ({
      trackRows: 0,
      blobStoreKeys: 0,
      playable: 0,
      clearedFalseFlags: 0,
      healedFromBlobs: 0,
    })),
    refreshLockerCache: vi.fn(async () => []),
  };
});

import { lockerEntryIsPlayable } from './lockerStorage';
import { scanMetadataOnlyLockerTracks } from './lockerAudioRepair';

describe('lockerAudioRepair', () => {
  it('lists metadata-only rows and marks playable siblings', async () => {
    const entries: LockerEntry[] = [
      {
        id: 'locker-a-playable',
        title: 'True Love',
        artist: 'Kanye West',
        genre: '',
        albumName: 'Donda (Deluxe)',
        url: 'content://x',
        durationSeconds: 200,
        addedAt: 2,
      },
      {
        id: 'locker-b-hollow',
        title: 'True Love',
        artist: 'Kanye West',
        genre: '',
        albumName: 'Donda (Deluxe)',
        url: 'blob:stale',
        durationSeconds: 200,
        addedAt: 1,
      },
      {
        id: 'locker-c-hollow',
        title: 'Ghost',
        artist: 'Kanye West',
        genre: '',
        url: '',
        durationSeconds: 100,
        addedAt: 0,
      },
    ];

    vi.mocked(lockerEntryIsPlayable).mockImplementation(async (id) =>
      id.endsWith('-playable'),
    );

    const scan = await scanMetadataOnlyLockerTracks(entries);
    expect(scan.playableTracks).toBe(1);
    expect(scan.metadataOnlyCount).toBe(2);
    expect(scan.duplicateMetadataOnlyCount).toBe(1);
    expect(scan.issues.find((i) => i.id === 'locker-b-hollow')?.hasPlayableSibling).toBe(true);
    expect(scan.issues.find((i) => i.id === 'locker-c-hollow')?.hasPlayableSibling).toBe(false);
  });
});
