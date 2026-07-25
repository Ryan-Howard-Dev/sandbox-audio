import { describe, expect, it } from 'vitest';
import type { LockerEntry } from './lockerStorage';
import { buildMediaGraph } from './collectionIntelligence';
import {
  buildLockerGenreShelves,
  lockerGenreSourceCollections,
} from './lockerGenreShelf';
import {
  buildWeeklyGenrePlaylists,
  isoWeekStamp,
} from './weeklyGenrePlaylists';

function entry(id: string, overrides: Partial<LockerEntry> = {}): LockerEntry {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    genre: 'Pop',
    albumName: 'Album',
    albumArtist: 'Artist',
    addedAt: 1000,
    durationSeconds: 180,
    url: `blob:${id}`,
    albumArt: `https://art/${id}.jpg`,
    ...overrides,
  };
}

function popShelves(count: number) {
  const entries: LockerEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    entries.push(
      entry(`p${i}`, { albumName: undefined, genre: 'Pop', title: `Song ${i}` }),
    );
  }
  const graph = buildMediaGraph(entries);
  return buildLockerGenreShelves(lockerGenreSourceCollections(graph.collections, entries));
}

describe('isoWeekStamp', () => {
  it('formats an ISO year-week stamp', () => {
    expect(isoWeekStamp(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
    expect(isoWeekStamp(new Date('2026-07-23T12:00:00Z'))).toMatch(/^2026-W\d{2}$/);
  });
});

describe('buildWeeklyGenrePlaylists', () => {
  it('skips genres below the minimum track threshold', () => {
    const shelves = popShelves(5); // < default minTracks 8
    expect(buildWeeklyGenrePlaylists(shelves)).toEqual([]);
  });

  it('builds a capped, deterministic weekly mix per genre', () => {
    const shelves = popShelves(30);
    const w30 = buildWeeklyGenrePlaylists(shelves, { weekStamp: '2026-W30', maxTracks: 25 });
    expect(w30).toHaveLength(1);
    expect(w30[0].genreLabel).toBe('Pop');
    expect(w30[0].id).toBe('weekly-genre:pop:2026-W30');
    expect(w30[0].tracks).toHaveLength(25);
    expect(w30[0].artworkUrls.length).toBeGreaterThan(0);

    // Same week → identical order (stable within the week).
    const again = buildWeeklyGenrePlaylists(shelves, { weekStamp: '2026-W30', maxTracks: 25 });
    expect(again[0].tracks.map((t) => t.id)).toEqual(w30[0].tracks.map((t) => t.id));
  });

  it('rotates the order when the week changes', () => {
    const shelves = popShelves(30);
    const w30 = buildWeeklyGenrePlaylists(shelves, { weekStamp: '2026-W30' });
    const w31 = buildWeeklyGenrePlaylists(shelves, { weekStamp: '2026-W31' });
    expect(w31[0].tracks.map((t) => t.id)).not.toEqual(w30[0].tracks.map((t) => t.id));
  });

  it('honours the playlist cap, biggest genres first', () => {
    const entries: LockerEntry[] = [];
    for (let i = 0; i < 10; i += 1) entries.push(entry(`r${i}`, { albumName: undefined, genre: 'Rock' }));
    for (let i = 0; i < 12; i += 1) entries.push(entry(`j${i}`, { albumName: undefined, genre: 'Jazz' }));
    const graph = buildMediaGraph(entries);
    const shelves = buildLockerGenreShelves(
      lockerGenreSourceCollections(graph.collections, entries),
    );
    const playlists = buildWeeklyGenrePlaylists(shelves, { maxPlaylists: 1 });
    expect(playlists).toHaveLength(1);
    expect(playlists[0].genreLabel).toBe('Jazz'); // 12 tracks > 10
  });
});
