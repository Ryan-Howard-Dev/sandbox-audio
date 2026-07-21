import { describe, expect, it } from 'vitest';
import { buildLockerArtistPopularTopTracks } from './lockerArtistHub';
import type { LockerEntry } from './lockerStorage';

function entry(
  id: string,
  title: string,
  addedAt: number,
  overrides: Partial<LockerEntry> = {},
): LockerEntry {
  return {
    id,
    title,
    artist: 'Kanye West',
    genre: 'Hip-Hop/Rap',
    albumName: 'Jesus Is King',
    albumArtist: 'Kanye West',
    addedAt,
    durationSeconds: 180,
    url: `blob:${id}`,
    ...overrides,
  };
}

describe('buildLockerArtistPopularTopTracks', () => {
  it('ranks locker tracks by catalog chart order, not play history', () => {
    const tracks = [
      entry('a', 'Follow God', 100),
      entry('b', 'Closed On Sunday', 300),
      entry('c', 'Feel The Love', 200),
    ];
    const catalog = [
      { title: 'Feel The Love', artworkUrl: 'https://example.com/feel.jpg' },
      { title: 'Follow God' },
      { title: 'Closed On Sunday' },
    ];

    const ranked = buildLockerArtistPopularTopTracks(tracks, catalog);
    expect(ranked.map((row) => row.entry.id)).toEqual(['c', 'a', 'b']);
    expect(ranked[0]?.source).toBe('catalog');
    expect(ranked[0]?.catalogArtworkUrl).toBe('https://example.com/feel.jpg');
  });

  it('appends unmatched locker tracks by date added after catalog matches', () => {
    const tracks = [
      entry('old', 'Old Song', 100),
      entry('new', 'New Song', 500),
      entry('hit', 'Stronger', 200),
    ];
    const catalog = [{ title: 'Stronger' }];

    const ranked = buildLockerArtistPopularTopTracks(tracks, catalog);
    expect(ranked.map((row) => row.entry.id)).toEqual(['hit', 'new', 'old']);
    expect(ranked[0]?.source).toBe('catalog');
    expect(ranked[1]?.source).toBe('locker-only');
    expect(ranked[2]?.source).toBe('locker-only');
  });

  it('falls back to recently added when no catalog chart is available', () => {
    const tracks = [
      entry('old', 'Old Song', 100),
      entry('new', 'New Song', 500),
    ];
    const ranked = buildLockerArtistPopularTopTracks(tracks, []);
    expect(ranked.map((row) => row.entry.id)).toEqual(['new', 'old']);
    expect(ranked.every((row) => row.source === 'locker-only')).toBe(true);
  });

  it('collapses duplicate title rows to one playable copy', () => {
    const tracks = [
      entry('dead', 'Take Off Your Dress', 100, { offlineReady: false, durationSeconds: 0 }),
      entry('live', 'Take Off Your Dress', 200, { offlineReady: true, durationSeconds: 210 }),
    ];
    const catalog = [{ title: 'Take Off Your Dress' }];
    const ranked = buildLockerArtistPopularTopTracks(tracks, catalog);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.entry.id).toBe('live');
  });
});
