import { describe, expect, it } from 'vitest';
import { extractSpotifyAccessTokenFromState, parseSpotifyEmbedHtml } from './spotifyPlaylistImport';
import { extractDeezerPlaylistIdFromUrl } from './deezerPlaylistImport';
import { extractYoutubePlaylistIdFromUrl } from './youtubeMusicPlaylistImport';
import { extractAppleMusicPlaylistFromUrl } from './appleMusicPlaylistImport';

describe('playlist import platform parsers', () => {
  it('extracts spotify access token from embed state paths', () => {
    const token = extractSpotifyAccessTokenFromState({
      settings: { session: { accessToken: 'test-access-token-1234567890' } },
    });
    expect(token).toBe('test-access-token-1234567890');
  });

  it('parses spotify embed track list', () => {
    const html = `<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"state":{"settings":{"session":{"accessToken":"test-access-token-1234567890"}},"data":{"entity":{"name":"My Mix","subtitle":"Ryan","trackList":[{"title":"Song A","subtitle":"Artist A","duration":180000}]}}}}}}</script></html>`;
    const parsed = parseSpotifyEmbedHtml(html);
    expect(parsed?.title).toBe('My Mix');
    expect(parsed?.tracks).toHaveLength(1);
    expect(parsed?.accessToken).toBe('test-access-token-1234567890');
  });

  it('extracts deezer playlist id', () => {
    expect(extractDeezerPlaylistIdFromUrl('https://www.deezer.com/playlist/908622995')).toBe(
      '908622995',
    );
  });

  it('extracts youtube playlist id', () => {
    expect(
      extractYoutubePlaylistIdFromUrl('https://music.youtube.com/playlist?list=PLabc123'),
    ).toBe('PLabc123');
  });

  it('extracts apple music playlist parts', () => {
    expect(
      extractAppleMusicPlaylistFromUrl(
        'https://music.apple.com/us/playlist/todays-hits/pl.u-2aoq8mWv07XJ8',
      ),
    ).toEqual({ storefront: 'us', playlistId: 'pl.u-2aoq8mWv07XJ8' });
  });
});
