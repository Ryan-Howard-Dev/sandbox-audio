import { describe, expect, it } from 'vitest';
import { extractTidalPlaylistIdFromUrl } from './playlistMetadataTidal';

describe('playlistMetadataTidal', () => {
  it('extracts short tidal share playlist ids', () => {
    expect(extractTidalPlaylistIdFromUrl('https://tidal.com/playlist/39cfdc5a')).toBe('39cfdc5a');
    expect(
      extractTidalPlaylistIdFromUrl('https://tidal.com/browse/playlist/39cfdc5a'),
    ).toBe('39cfdc5a');
  });

  it('extracts full uuid tidal playlist ids', () => {
    expect(
      extractTidalPlaylistIdFromUrl(
        'https://tidal.com/playlist/84d27945-eeb8-4c0a-a1f2-1234567890ab',
      ),
    ).toBe('84d27945-eeb8-4c0a-a1f2-1234567890ab');
  });
});
