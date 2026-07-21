import { describe, expect, it } from 'vitest';
import type { LockerEntry } from './lockerStorage';
import { compareLockerTrackOrder, parseId3Position, sortLockerTracks } from './lockerTrackOrder';

function track(partial: Partial<LockerEntry> & Pick<LockerEntry, 'id' | 'title'>): LockerEntry {
  return {
    id: partial.id,
    title: partial.title,
    artist: partial.artist ?? 'Artist',
    genre: partial.genre ?? 'Hip-Hop',
    durationSeconds: partial.durationSeconds ?? 180,
    url: partial.url ?? 'blob:test',
    addedAt: partial.addedAt ?? 1,
    trackNumber: partial.trackNumber,
    discNumber: partial.discNumber,
  };
}

describe('lockerTrackOrder', () => {
  it('parses TRCK positions', () => {
    expect(parseId3Position('3/24')).toEqual({ index: 3, total: 24 });
    expect(parseId3Position('12')).toEqual({ index: 12, total: undefined });
  });

  it('sorts by disc then track number', () => {
    const ordered = sortLockerTracks([
      track({ id: 'c', title: 'Come to Life', trackNumber: 3 }),
      track({ id: 'j', title: 'Jail', trackNumber: 1 }),
      track({ id: 'd2', title: 'Disc 2 Opener', discNumber: 2, trackNumber: 1 }),
    ]);
    expect(ordered.map((t) => t.title)).toEqual(['Jail', 'Come to Life', 'Disc 2 Opener']);
  });

  it('falls back to addedAt when track numbers are missing', () => {
    expect(
      compareLockerTrackOrder(
        track({ id: 'b', title: 'Beta', addedAt: 20 }),
        track({ id: 'a', title: 'Alpha', addedAt: 10 }),
      ),
    ).toBeGreaterThan(0);
  });
});
