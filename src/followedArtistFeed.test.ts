import { describe, expect, it } from 'vitest';
import {
  isRecentReleaseDate,
  isStubFollowedReleaseTitle,
  RECENT_RELEASE_DAYS,
} from './followedArtistFeed';

describe('followedArtistFeed release helpers', () => {
  it('treats missing or ancient years as not recent', () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RECENT_RELEASE_DAYS);
    expect(isRecentReleaseDate(undefined, cutoff)).toBe(false);
    expect(isRecentReleaseDate(new Date('2007-06-15'), cutoff)).toBe(false);
  });

  it('accepts releases inside the recent window', () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 14);
    expect(isRecentReleaseDate(recent)).toBe(true);
  });

  it('flags artist-name stubs and empty titles', () => {
    expect(isStubFollowedReleaseTitle('EsDeeKid', 'EsDeeKid')).toBe(true);
    expect(isStubFollowedReleaseTitle('ESDEEKID', 'ESDEEKID')).toBe(true);
    expect(isStubFollowedReleaseTitle('', 'Artist')).toBe(true);
    expect(isStubFollowedReleaseTitle('Heartless', 'Kanye West')).toBe(false);
  });
});
