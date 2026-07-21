import { beforeEach, describe, expect, it } from 'vitest';
import {
  historyEntryKey,
  loadSearchHistory,
  matchSearchHistory,
  recordSearchAlbum,
  recordSearchArtist,
  recordSearchQuery,
} from './searchHistory';

describe('searchHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records and dedupes queries case-insensitively', () => {
    recordSearchQuery('Kanye West');
    recordSearchQuery('Radiohead');
    recordSearchQuery('kanye west');
    expect(loadSearchHistory().map((e) => (e.kind === 'query' ? e.query : ''))).toEqual([
      'kanye west',
      'Radiohead',
    ]);
  });

  it('records artist and album entries with artwork', () => {
    recordSearchArtist({
      kind: 'artist',
      id: 'a1',
      name: 'Metro Boomin',
      artworkUrl: 'https://example.com/metro.jpg',
    });
    recordSearchAlbum({
      kind: 'album',
      id: 'al1',
      title: 'HEROES & VILLAINS',
      artist: 'Metro Boomin',
      artworkUrl: 'https://example.com/hv.jpg',
      releaseYear: '2022',
    });
    const history = loadSearchHistory();
    expect(history[0]?.kind).toBe('album');
    expect(history[1]?.kind).toBe('artist');
    if (history[0]?.kind === 'album') {
      expect(history[0].title).toBe('HEROES & VILLAINS');
      expect(history[0].artworkUrl).toContain('hv.jpg');
    }
  });

  it('matches prefix and substring while typing', () => {
    recordSearchQuery('Kendrick Lamar');
    recordSearchArtist({ kind: 'artist', id: 'a2', name: 'Kenny G' });
    recordSearchQuery('Radiohead');
    expect(matchSearchHistory('ken').map((e) => (e.kind === 'artist' ? e.name : e.kind === 'query' ? e.query : ''))).toEqual([
      'Kenny G',
      'Kendrick Lamar',
    ]);
    expect(matchSearchHistory('mar').map((e) => (e.kind === 'query' ? e.query : ''))).toEqual([
      'Kendrick Lamar',
    ]);
    expect(matchSearchHistory('rad').map((e) => (e.kind === 'query' ? e.query : ''))).toEqual([
      'Radiohead',
    ]);
  });

  it('returns recent list when query is empty', () => {
    recordSearchQuery('First');
    recordSearchQuery('Second');
    expect(matchSearchHistory('').map((e) => (e.kind === 'query' ? e.query : ''))).toEqual([
      'Second',
      'First',
    ]);
  });

  it('dedupes artist entries by id', () => {
    recordSearchArtist({ kind: 'artist', id: 'mb:1', name: 'Ye' });
    recordSearchArtist({ kind: 'artist', id: 'mb:1', name: 'Kanye West', artworkUrl: 'https://x/y.jpg' });
    expect(loadSearchHistory()).toHaveLength(1);
    expect(historyEntryKey(loadSearchHistory()[0]!)).toBe('a:mb:1');
  });
});
