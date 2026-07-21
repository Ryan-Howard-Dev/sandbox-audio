import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EXPLORE_GENRES } from './exploreBrowseData';

const tasteState = {
  seeds: null as { genres: string[] } | null,
  genreAffinity: {} as Record<string, number>,
};

vi.mock('./sandboxSettings', () => ({
  loadOnboardingTasteSeeds: () => tasteState.seeds,
}));

vi.mock('./tasteProfile', () => ({
  getTasteProfile: () => ({
    schemaVersion: 1,
    trackAffinity: {},
    artistAffinity: {},
    albumAffinity: {},
    genreAffinity: tasteState.genreAffinity,
    explicitFeedback: {},
    updatedAt: Date.now(),
  }),
}));

import {
  getPersonalizedExploreGenreLabels,
  personalizedGenreCacheFingerprint,
} from './personalizedGenres';

describe('personalizedGenres', () => {
  beforeEach(() => {
    tasteState.seeds = null;
    tasteState.genreAffinity = {};
  });

  it('prioritizes onboarding genres then taste affinity', () => {
    tasteState.seeds = { genres: ['Metal', 'Hip-Hop'] };
    tasteState.genreAffinity = { pop: 9, jazz: 2 };
    expect(getPersonalizedExploreGenreLabels(4)).toEqual([
      'Metal',
      'Hip-Hop',
      'Pop',
      'Jazz',
    ]);
  });

  it('maps affinity keys to canonical explore labels', () => {
    tasteState.genreAffinity = { 'rock / indie': 5 };
    const labels = getPersonalizedExploreGenreLabels(2);
    expect(labels[0]).toBe('Rock / Indie');
    expect(EXPLORE_GENRES).toContain(labels[0]);
  });

  it('builds stable cache fingerprints per taste set', () => {
    const a = personalizedGenreCacheFingerprint(['Metal', 'Hip-Hop']);
    const b = personalizedGenreCacheFingerprint(['Metal', 'Hip-Hop']);
    const c = personalizedGenreCacheFingerprint(['Pop']);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
