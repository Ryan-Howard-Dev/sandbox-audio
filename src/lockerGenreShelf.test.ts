import { describe, expect, it } from 'vitest';
import type { LockerEntry } from './lockerStorage';
import { buildMediaGraph } from './collectionIntelligence';
import {
  buildLockerGenreShelves,
  dominantCollectionGenre,
  genreShelfTracks,
  lockerGenreSourceCollections,
  normalizeGenreLabel,
} from './lockerGenreShelf';

function entry(
  id: string,
  overrides: Partial<LockerEntry> = {},
): LockerEntry {
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

function sourceCollections(entries: LockerEntry[]) {
  const graph = buildMediaGraph(entries);
  return lockerGenreSourceCollections(graph.collections, entries);
}

describe('normalizeGenreLabel', () => {
  it('folds synonymous spellings to one canonical label', () => {
    expect(normalizeGenreLabel('Hip-Hop/Rap')).toBe('Hip-Hop');
    expect(normalizeGenreLabel('hip hop')).toBe('Hip-Hop');
    expect(normalizeGenreLabel('RAP')).toBe('Hip-Hop');
    expect(normalizeGenreLabel('R&B/Soul')).toBe('R&B');
    expect(normalizeGenreLabel('nu-metal')).toBe('Nu Metal');
    expect(normalizeGenreLabel('dnb')).toBe('Drum & Bass');
  });

  it('preserves sub-genres instead of collapsing them into parents', () => {
    // The whole point of the Genres shelf — folding these into Hip-Hop/Rock
    // would leave one useless mega-shelf.
    expect(normalizeGenreLabel('trap')).toBe('Trap');
    expect(normalizeGenreLabel('boom bap')).toBe('Boom Bap');
    expect(normalizeGenreLabel('drill')).toBe('Drill');
    expect(normalizeGenreLabel('grime')).toBe('Grime');
    expect(normalizeGenreLabel('indie rock')).toBe('Indie Rock');
    expect(normalizeGenreLabel('conscious hip hop')).toBe('Conscious Hip Hop');
  });

  it('keeps acronym casing readable', () => {
    expect(normalizeGenreLabel('uk drill')).toBe('UK Drill');
    expect(normalizeGenreLabel('EDM')).toBe('EDM');
  });

  it('takes the first token of multi-genre tags and title-cases', () => {
    expect(normalizeGenreLabel('electronic, ambient')).toBe('Electronic');
    expect(normalizeGenreLabel('jazz')).toBe('Jazz');
  });

  it('treats blank / numeric ID3 genres as Unknown', () => {
    expect(normalizeGenreLabel('')).toBe('Unknown');
    expect(normalizeGenreLabel(undefined)).toBe('Unknown');
    expect(normalizeGenreLabel('(17)')).toBe('Unknown');
    expect(normalizeGenreLabel('13')).toBe('Unknown');
  });
});

describe('dominantCollectionGenre', () => {
  it('picks the most common track genre in a collection', () => {
    const entries = [
      entry('a', { albumName: 'Mixed', genre: 'Rock' }),
      entry('b', { albumName: 'Mixed', genre: 'Rock' }),
      entry('c', { albumName: 'Mixed', genre: 'Pop' }),
    ];
    const [collection] = sourceCollections(entries);
    expect(dominantCollectionGenre(collection)).toBe('Rock');
  });
});

describe('buildLockerGenreShelves', () => {
  it('groups albums + singles into genre shelves, biggest first', () => {
    const entries = [
      // 3-track hip-hop album
      entry('h1', { artist: 'MC', albumName: 'Rhymes', genre: 'Hip-Hop/Rap', trackNumber: 1 }),
      entry('h2', { artist: 'MC', albumName: 'Rhymes', genre: 'Hip-Hop/Rap', trackNumber: 2 }),
      entry('h3', { artist: 'MC', albumName: 'Rhymes', genre: 'Rap', trackNumber: 3 }),
      // jazz single (orphan)
      entry('j1', { artist: 'Trio', albumName: undefined, genre: 'Jazz' }),
    ];
    const shelves = buildLockerGenreShelves(sourceCollections(entries));
    expect(shelves.map((s) => s.label)).toEqual(['Hip-Hop', 'Jazz']);

    const hip = shelves[0];
    expect(hip.key).toBe('hip-hop');
    expect(hip.bucket).toBe('hip-hop');
    expect(hip.trackCount).toBe(3);
    expect(hip.artworkUrls.length).toBeGreaterThan(0);
    expect(genreShelfTracks(hip).map((t) => t.id).sort()).toEqual(['h1', 'h2', 'h3']);
  });

  it('excludes Unknown genre by default and includes it on request', () => {
    const entries = [
      entry('u1', { albumName: 'NoGenre', genre: '' }),
      entry('p1', { albumName: 'PopOne', genre: 'Pop' }),
    ];
    const collections = sourceCollections(entries);
    expect(buildLockerGenreShelves(collections).map((s) => s.label)).toEqual(['Pop']);
    const withUnknown = buildLockerGenreShelves(collections, { includeUnknown: true });
    expect(withUnknown.map((s) => s.label).sort()).toEqual(['Pop', 'Unknown']);
  });
});
