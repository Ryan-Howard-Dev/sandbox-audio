import { describe, expect, it, vi } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import { getSyncCachedPlayable } from './trackPrefetch';

const mockGetCachedPlayEnvelope = vi.fn();
const mockGetCachedStreamForTrack = vi.fn();

vi.mock('./playUrlCache', () => ({
  playCacheKey: vi.fn(() => 'test-key'),
  getCachedPlayEnvelope: (...args: unknown[]) => mockGetCachedPlayEnvelope(...args),
}));

vi.mock('./streamCache', () => ({
  getCachedStreamForTrack: (...args: unknown[]) => mockGetCachedStreamForTrack(...args),
}));

vi.mock('./nativeExoStreamResolver', () => ({
  isLocalDevicePlayUrl: (url: string) => /^file:\/\//i.test(url) || /^content:\/\//i.test(url),
  isOfflineUnplayableStreamUrl: vi.fn(
    (url: string) => /googlevideo\.com/i.test(url),
  ),
}));

describe('getSyncCachedPlayable', () => {
  const env: MediaEnvelope = {
    envelopeId: 'catalog-1',
    title: 'Test Song',
    artist: 'Artist',
    url: '',
    durationSeconds: 0,
    provider: 'https',
    transport: 'element-src',
    sourceId: '1',
  };

  it('skips offline-unplayable googlevideo session cache on mobile', () => {
    mockGetCachedPlayEnvelope.mockReturnValue({
      envelopeId: 'catalog-1',
      title: 'Test Song',
      artist: 'Artist',
      url: 'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc',
      provider: 'https',
      transport: 'element-src',
      sourceId: '1',
    });
    mockGetCachedStreamForTrack.mockReturnValue(null);
    expect(getSyncCachedPlayable(env)).toBeNull();
  });

  it('returns yt-dlp file cache from mobile URI cache when session cache is stale CDN', () => {
    mockGetCachedPlayEnvelope.mockReturnValue({
      envelopeId: 'catalog-1',
      title: 'Test Song',
      artist: 'Artist',
      url: 'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc',
      provider: 'https',
      transport: 'element-src',
      sourceId: '1',
    });
    mockGetCachedStreamForTrack.mockReturnValue({
      query: 'test-key',
      uri: 'file:///data/user/0/rd.sheepskin.sandboxmusic/cache/ytdlp-playback/U2beixNMeWA.mp4',
      source: 'mobile',
      resolvedAt: Date.now(),
      expiresAt: Date.now() + 3600_000,
    });
    const hit = getSyncCachedPlayable(env);
    expect(hit?.url).toMatch(/^file:\/\//);
    expect(hit?.envelopeId).toBe('catalog-1');
  });
});
