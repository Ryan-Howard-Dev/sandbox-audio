import { describe, expect, it } from 'vitest';
import {
  lockerAlbumMatches,
  lockerTitleMatches,
  normalizeLockerFuzzyKey,
} from './lockerStorage';

describe('lockerAlbumMatches editions', () => {
  it('does not treat nightcore edition as the standard album', () => {
    expect(
      lockerAlbumMatches('american dream', 'American Dream (Nightcore Version)'),
    ).toBe(false);
    expect(
      lockerAlbumMatches('American Dream Nightcore Version', 'american dream'),
    ).toBe(false);
  });

  it('still matches same edition loosely', () => {
    expect(lockerAlbumMatches('american dream', 'American Dream')).toBe(true);
    expect(
      lockerAlbumMatches(
        'american dream nightcore version',
        'American Dream (Nightcore Version)',
      ),
    ).toBe(true);
  });

  it('normalizes punctuation', () => {
    expect(normalizeLockerFuzzyKey('American Dream (2024)')).toBe('american dream 2024');
  });
});

describe('Nee Nah / Née Nah title matching', () => {
  it('matches accented album track to ASCII tap/query', () => {
    expect(lockerTitleMatches('Née Nah', 'Nee Nah')).toBe(true);
    expect(lockerTitleMatches('Nee Nah', 'Née Nah')).toBe(true);
    expect(normalizeLockerFuzzyKey('Née Nah')).toBe('nee nah');
  });
});
