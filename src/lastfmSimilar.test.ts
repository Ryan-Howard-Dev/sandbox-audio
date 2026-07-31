import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLastFmSimilarCacheForTests,
  getLastFmSimilarArtists,
  getLastFmSimilarTracks,
  isLastFmSimilarAvailable,
} from './lastfmSimilar';
import { saveScrobbleSettings } from './scrobbleSettings';

describe('lastfmSimilar', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    clearLastFmSimilarCacheForTests();
    saveScrobbleSettings({ lastfmApiKey: '' });
  });

  it('reports unavailable with no API key', () => {
    expect(isLastFmSimilarAvailable()).toBe(false);
  });

  it('reports available once a key is set', () => {
    saveScrobbleSettings({ lastfmApiKey: 'test-key' });
    expect(isLastFmSimilarAvailable()).toBe(true);
  });

  it('no-ops similar lookups when no key is configured', async () => {
    await expect(getLastFmSimilarArtists('Metallica')).resolves.toEqual([]);
    await expect(getLastFmSimilarTracks('Metallica', 'One')).resolves.toEqual([]);
  });

  it('guards empty inputs', async () => {
    saveScrobbleSettings({ lastfmApiKey: 'test-key' });
    await expect(getLastFmSimilarArtists('  ')).resolves.toEqual([]);
    await expect(getLastFmSimilarTracks('', 'x')).resolves.toEqual([]);
    await expect(getLastFmSimilarTracks('x', '')).resolves.toEqual([]);
  });
});
