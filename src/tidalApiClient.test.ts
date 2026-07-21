import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractTidalCountryCodeFromEmbedHtml,
  extractTidalPlaylistUuidFromEmbedHtml,
  fetchAllTidalPlaylistItems,
  isTidalFullPlaylistUuid,
  resetTidalApiClientForTests,
} from './tidalApiClient';
import { fetchWithTimeout } from './fetchWithTimeout';

vi.mock('./fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}));

const fetchMock = vi.mocked(fetchWithTimeout);

describe('tidalApiClient', () => {
  afterEach(() => {
    vi.resetAllMocks();
    resetTidalApiClientForTests();
  });

  it('detects full playlist uuids', () => {
    expect(isTidalFullPlaylistUuid('4118d525-d0b1-454e-8d4b-342ea519122f')).toBe(true);
    expect(isTidalFullPlaylistUuid('39cfdc5a')).toBe(false);
  });

  it('extracts playlist uuid and country from embed html', () => {
    const html = `
      <script>window.tidalCountryCode='GB';</script>
      <a href="https://tidal.com/playlist/4118d525-d0b1-454e-8d4b-342ea519122f">God Mode</a>
    `;
    expect(extractTidalPlaylistUuidFromEmbedHtml(html)).toBe(
      '4118d525-d0b1-454e-8d4b-342ea519122f',
    );
    expect(extractTidalCountryCodeFromEmbedHtml(html)).toBe('GB');
  });

  it('paginates playlist items from the tidal api', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
        });
      }
      if (url.includes('offset=0')) {
        return new Response(
          JSON.stringify({
            totalNumberOfItems: 153,
            items: Array.from({ length: 100 }, (_, i) => ({
              item: { title: `Track ${i + 1}`, duration: 200, artist: { name: 'Artist' } },
            })),
          }),
          { status: 200 },
        );
      }
      if (url.includes('offset=100')) {
        return new Response(
          JSON.stringify({
            totalNumberOfItems: 153,
            items: Array.from({ length: 53 }, (_, i) => ({
              item: { title: `Track ${i + 101}`, duration: 200, artist: { name: 'Artist' } },
            })),
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const result = await fetchAllTidalPlaylistItems('4118d525-d0b1-454e-8d4b-342ea519122f', {
      preferredCountryCode: 'GB',
    });

    expect(result.tracks).toHaveLength(153);
    expect(result.total).toBe(153);
    expect(result.countryCode).toBe('GB');
    expect(result.tracks[0]?.title).toBe('Track 1');
    expect(result.tracks[152]?.title).toBe('Track 153');
  });
});
