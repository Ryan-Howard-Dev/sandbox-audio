import { describe, expect, it } from 'vitest';
import { extractFirstImportUrlFromText, isValidImportPlatformUrl } from './importPlatforms';
import { parsePlaylistImportDeepLink } from './playlistImportShare';

describe('playlistImportShare', () => {
  it('extracts tidal playlist URL from share text blob', () => {
    const resolved = extractFirstImportUrlFromText(
      'God Mode\nhttps://tidal.com/playlist/84d27945-eeb8-4c0a-a1f2-1234567890ab',
    );
    expect(resolved?.platformId).toBe('tidal');
    expect(resolved?.url).toContain('tidal.com/playlist/');
  });

  it('accepts short tidal playlist share links', () => {
    const resolved = extractFirstImportUrlFromText('https://tidal.com/playlist/39cfdc5a');
    expect(resolved?.platformId).toBe('tidal');
    expect(
      isValidImportPlatformUrl('tidal', resolved?.url ?? ''),
    ).toBe(true);
  });

  it('parses import deep link query params', () => {
    const payload = parsePlaylistImportDeepLink(
      'sandboxmusic://import/playlist?text=https%3A%2F%2Ftidal.com%2Fplaylist%2Fabc&name=God%20Mode',
    );
    expect(payload?.text).toContain('tidal.com/playlist/abc');
    expect(payload?.name).toBe('God Mode');
  });
});
