import { describe, expect, it } from 'vitest';
import { resolveAlbumRowArtwork } from './albumCover';

describe('resolveAlbumRowArtwork', () => {
  it('uses album artwork when present', () => {
    expect(
      resolveAlbumRowArtwork(
        { title: 'Heroes & Villains', artist: 'Metro Boomin', artworkUrl: 'https://x/cover.jpg' },
        [],
      ),
    ).toBe('https://x/cover.jpg');
  });

  it('falls back to a matching track cover in the same result set', () => {
    expect(
      resolveAlbumRowArtwork(
        { title: 'We Don\'t Trust You', artist: 'Future & Metro Boomin' },
        [
          {
            artist: 'Future',
            album: 'We Don\'t Trust You',
            artworkUrl: 'https://x/wdty.jpg',
          },
        ],
      ),
    ).toBe('https://x/wdty.jpg');
  });
});
