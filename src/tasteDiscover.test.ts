import { describe, expect, it } from 'vitest';
import { seedWindowForKind } from './tasteDiscover';

const seeds = ['Kanye West', 'Denzel Curry', 'JPEGMAFIA', 'Future', 'Danny Brown', 'Rick Ross'];

describe('seedWindowForKind', () => {
  const day = 86_400_000;

  it('returns no seeds when the taste profile is empty', () => {
    expect(seedWindowForKind([], 'daily')).toEqual([]);
  });

  it('rotates the daily window from one day to the next', () => {
    const a = seedWindowForKind(seeds, 'daily', 10 * day).join(',');
    const b = seedWindowForKind(seeds, 'daily', 11 * day).join(',');
    expect(a).not.toBe(b);
  });

  it('keeps the daily window stable within the same day', () => {
    const morning = seedWindowForKind(seeds, 'daily', 10 * day + 1_000).join(',');
    const evening = seedWindowForKind(seeds, 'daily', 10 * day + 60_000_000).join(',');
    expect(morning).toBe(evening);
  });

  it('keeps the weekly window stable across days in the same week', () => {
    const mon = seedWindowForKind(seeds, 'weekly', 70 * day).join(',');
    const wed = seedWindowForKind(seeds, 'weekly', 72 * day).join(',');
    expect(mon).toBe(wed);
  });

  it('uses a wider seed window for weekly than daily', () => {
    expect(seedWindowForKind(seeds, 'weekly', 0).length).toBeGreaterThan(
      seedWindowForKind(seeds, 'daily', 0).length,
    );
  });

  it('never returns more seeds than are available', () => {
    expect(seedWindowForKind(['Only One'], 'weekly', 0)).toEqual(['Only One']);
  });
});

describe('weekly is not daily', () => {
  const day = 86_400_000;

  /**
   * The shelf that shipped showing the same three covers twice.
   *
   * `take` is clamped to the seed count, and the start offset is `(bucket * take) % length`, which
   * is zero for every bucket once take equals length. A listener with three taste artists therefore
   * got the identical window for both kinds, on every day, forever — with "a wider sweep across
   * your taste" printed under the second copy.
   */
  it('does not hand a small taste profile the same window twice', () => {
    const small = ['Kanye West', 'Denzel Curry', 'JPEGMAFIA'];
    const daily = seedWindowForKind(small, 'daily', 10 * day);
    const weekly = seedWindowForKind(small, 'weekly', 10 * day, daily);
    expect(weekly.join(',')).not.toBe(daily.join(','));
  });

  it('shares no artist with the daily window', () => {
    const daily = seedWindowForKind(seeds, 'daily', 10 * day);
    const weekly = seedWindowForKind(seeds, 'weekly', 10 * day, daily);
    expect(weekly.some((artist) => daily.includes(artist))).toBe(false);
  });

  it('draws nothing rather than repeat when the profile cannot support two shelves', () => {
    /*
     * Three artists cannot make two different recommendations. Returning empty hides the shelf,
     * which is the honest outcome; showing the same one twice does not make it two.
     */
    const tiny = ['Kanye West'];
    const daily = seedWindowForKind(tiny, 'daily', 0);
    expect(seedWindowForKind(tiny, 'weekly', 0, daily)).toEqual([]);
  });

  it('still rotates week to week once daily has taken its share', () => {
    /*
     * Excluding daily leaves three artists here, so the window is the whole remaining pool and
     * only its order can change. That is a real limit of a small library, not a bug — what would
     * be a bug is the window never moving at all, which is what the old stride did.
     */
    const daily = seedWindowForKind(seeds, 'daily', 0);
    const week1 = seedWindowForKind(seeds, 'weekly', 0, daily).join(',');
    const week2 = seedWindowForKind(seeds, 'weekly', 7 * day, daily).join(',');
    expect(week1).not.toBe(week2);
  });
});
