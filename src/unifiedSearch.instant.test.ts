import { describe, expect, it, vi } from 'vitest';
import { instantLocalLockerSearch } from './unifiedSearch';

vi.mock('./lockerStorage', () => ({
  getLockerEntries: vi.fn(async () => []),
  getLockerEntriesSnapshot: vi.fn(() => [
    {
      id: '1',
      title: 'Luther',
      artist: 'Kendrick Lamar',
      genre: 'hip-hop',
      durationSeconds: 200,
      url: 'blob:test',
      addedAt: 0,
      albumName: 'GNX',
    },
  ]),
}));

describe('instantLocalLockerSearch', () => {
  it('returns locker matches synchronously from snapshot', () => {
    const result = instantLocalLockerSearch('kendrick', 8);
    expect(result.tracks.length).toBeGreaterThan(0);
    expect(result.tracks[0]?.artist).toBe('Kendrick Lamar');
  });
});
