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
