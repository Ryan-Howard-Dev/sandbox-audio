import { describe, expect, it } from 'vitest';
import {
  findLockerEntryForTrack,
  lockerArtistMatches,
  lockerTitleMatches,
} from './lockerStorage';
import type { LockerEntry } from './lockerStorage';

const entry = (id: string, title: string, artist: string): LockerEntry => ({
  id,
  title,
  artist,
  genre: 'Downloaded',
  durationSeconds: 200,
  url: 'blob:test',
  addedAt: Date.now(),
  offlineReady: true,
});

describe('locker fuzzy match', () => {
  it('matches playlist titles with punctuation and artist aliases', () => {
    const list = [
      entry('1', 'FRIED', '¥$, Ye'),
      entry('2', 'THE HERETIC ANTHEM', 'Slipknot'),
    ];
    expect(findLockerEntryForTrack('FRIED', '¥$', undefined, list)?.id).toBe('1');
    expect(findLockerEntryForTrack('fried', 'Kanye West', undefined, list)?.id).toBe('1');
    expect(findLockerEntryForTrack('The Heretic Anthem', 'Slipknot', undefined, list)?.id).toBe('2');
  });

  it('supports partial title overlap used by import rematch', () => {
    expect(lockerTitleMatches('WAIT AND BLEED', 'Wait and Bleed')).toBe(true);
    expect(lockerArtistMatches('¥$, Ye', '¥$')).toBe(true);
    expect(lockerArtistMatches('¥$, Ye', 'Ye')).toBe(true);
  });
});
