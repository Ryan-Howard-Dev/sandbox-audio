import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';

vi.mock('./catalogDirect', () => ({
  allowCatalogPreviewPlayback: vi.fn(() => false),
  catalogPlayUrlFromPreview: vi.fn(() => ''),
}));

vi.mock('./mobileResolverRegistry', () => ({
  tryMobileResolve: vi.fn(async () => null),
  preferFreshMobileResolve: vi.fn(() => false),
  hasActiveMobileResolvers: vi.fn(() => false),
}));

vi.mock('./platformEnv', () => ({
  isAndroid: vi.fn(() => false),
}));

vi.mock('./streamCache', () => ({
  getCachedStreamForTrack: vi.fn(() => null),
  getStreamCacheEnvelope: vi.fn(async () => null),
  putCachedStream: vi.fn(),
  removeCachedStream: vi.fn(),
  resolutionQueryFromEnvelope: vi.fn((env: MediaEnvelope) => `${env.title}|${env.artist}`),
}));

vi.mock('./nativeExoStreamResolver', () => ({
  isOfflineUnplayableStreamUrl: vi.fn(() => false),
  localDevicePlayUrlReachable: vi.fn(async () => true),
}));

vi.mock('./tier34/client', () => ({
  getTier34BaseUrl: vi.fn(() => ''),
  isServerReachableCached: vi.fn(() => false),
}));

vi.mock('./playbackPipeline', () => ({
  resolveSandboxServerStream: vi.fn(async () => null),
}));

import { resolvePlaybackSource, getResolutionOrder, HYBRID_RESOLUTION_ORDER, buildPlayQueries, primaryMobilePlayQuery, mobileFallbackPlayQuery } from './hybridResolution';
import { getCachedStreamForTrack, getStreamCacheEnvelope, putCachedStream } from './streamCache';
import { tryMobileResolve, preferFreshMobileResolve } from './mobileResolverRegistry';
import { allowCatalogPreviewPlayback } from './catalogDirect';
import { isServerReachableCached, getTier34BaseUrl } from './tier34/client';
import { resolveSandboxServerStream } from './playbackPipeline';

const baseTrack = (): MediaEnvelope => ({
  envelopeId: 'env-1',
  title: 'Test Song',
  artist: 'Test Artist',
  url: '',
  durationSeconds: 200,
  provider: 'https',
  transport: 'element-src',
  sourceId: 'track-1',
});

describe('getResolutionOrder', () => {
  it('returns locker → cache → server → mobile → preview', () => {
    expect(getResolutionOrder()).toEqual(HYBRID_RESOLUTION_ORDER);
    expect(getResolutionOrder()).toEqual(['locker', 'cache', 'server', 'mobile', 'preview']);
  });
});

describe('resolvePlaybackSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(getCachedStreamForTrack).mockReturnValue(null);
    vi.mocked(getStreamCacheEnvelope).mockResolvedValue(null);
    vi.mocked(tryMobileResolve).mockResolvedValue(null);
    vi.mocked(preferFreshMobileResolve).mockReturnValue(false);
    vi.mocked(isServerReachableCached).mockReturnValue(false);
    vi.mocked(getTier34BaseUrl).mockReturnValue('');
    vi.mocked(allowCatalogPreviewPlayback).mockReturnValue(false);
    vi.mocked(resolveSandboxServerStream).mockResolvedValue(null);
  });

  it('resolves locker local-vault first', async () => {
    const track: MediaEnvelope = {
      ...baseTrack(),
      url: 'blob:locker-abc',
      provider: 'local-vault',
    };
    const hit = await resolvePlaybackSource(track);
    expect(hit?.source).toBe('locker');
    expect(hit?.uri).toBe('blob:locker-abc');
  });

  it('resolves URI cache before server', async () => {
    vi.mocked(getCachedStreamForTrack).mockReturnValue({
      query: 'test',
      uri: 'https://cdn.example/track.mp3',
      source: 'server',
      resolvedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    const hit = await resolvePlaybackSource(baseTrack());
    expect(hit?.source).toBe('cache');
    expect(resolveSandboxServerStream).not.toHaveBeenCalled();
  });

  it('skips server when unreachable (fail closed)', async () => {
    vi.mocked(isServerReachableCached).mockReturnValue(false);
    vi.mocked(getTier34BaseUrl).mockReturnValue('http://127.0.0.1:3001');
    const hit = await resolvePlaybackSource(baseTrack());
    expect(resolveSandboxServerStream).not.toHaveBeenCalled();
    expect(hit).toBeNull();
  });

  it('resolves server when reachable', async () => {
    vi.mocked(isServerReachableCached).mockReturnValue(true);
    vi.mocked(getTier34BaseUrl).mockReturnValue('http://127.0.0.1:3001');
    vi.mocked(resolveSandboxServerStream).mockResolvedValue({
      ...baseTrack(),
      url: '/api/proxy/stream?url=https%3A%2F%2Fcdn.example%2Fa.mp3',
      provider: 'proxy',
      transport: 'proxy',
    });
    const hit = await resolvePlaybackSource(baseTrack());
    expect(hit?.source).toBe('server');
    expect(putCachedStream).toHaveBeenCalled();
  });

  it('runs mobile resolvers when server fails', async () => {
    vi.mocked(tryMobileResolve).mockResolvedValue('https://mobile.example/a.m4a');
    const hit = await resolvePlaybackSource(baseTrack());
    expect(hit?.source).toBe('mobile');
    expect(hit?.uri).toBe('https://mobile.example/a.m4a');
  });

  it('skips stale blob locker candidates so mobile can resolve', async () => {
    vi.mocked(tryMobileResolve).mockResolvedValue('https://mobile.example/a.m4a');
    const hit = await resolvePlaybackSource(baseTrack(), [
      {
        id: 'locker-stale',
        provider: 'local-vault',
        uri: 'blob:https://localhost/revoked',
        transport: 'element-src',
        priority: 1,
      },
    ]);
    expect(hit?.source).toBe('mobile');
    expect(tryMobileResolve).toHaveBeenCalled();
  });

  it('prefers mobile over cache when preferFreshMobileResolve is active', async () => {
    vi.mocked(preferFreshMobileResolve).mockReturnValue(true);
    vi.mocked(getCachedStreamForTrack).mockReturnValue({
      query: 'test',
      uri: 'https://cdn.example/stale.mp3',
      source: 'server',
      resolvedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    vi.mocked(tryMobileResolve).mockResolvedValue('https://www.youtube.com/watch?v=abc');
    const hit = await resolvePlaybackSource(baseTrack());
    expect(hit?.source).toBe('mobile');
    expect(resolveSandboxServerStream).not.toHaveBeenCalled();
  });

  it('does not fall back to preview when preferFreshMobileResolve is active', async () => {
    vi.mocked(preferFreshMobileResolve).mockReturnValue(true);
    vi.mocked(allowCatalogPreviewPlayback).mockReturnValue(true);
    const track: MediaEnvelope = {
      ...baseTrack(),
      sourceId: 'catalog-12345',
      url: 'https://audio-ssl.itunes.apple.com/preview.m4a',
    };
    const hit = await resolvePlaybackSource(track);
    expect(hit).toBeNull();
  });

  it('falls back to catalog preview last', async () => {
    vi.mocked(allowCatalogPreviewPlayback).mockReturnValue(true);
    const track: MediaEnvelope = {
      ...baseTrack(),
      sourceId: 'catalog-12345',
      url: 'https://audio-ssl.itunes.apple.com/preview.m4a',
    };
    const hit = await resolvePlaybackSource(track);
    expect(hit?.source).toBe('preview');
    expect(hit?.uri).toContain('audio-ssl');
  });
});

describe('primaryMobilePlayQuery', () => {
  it('uses album-qualified query first for distinct album titles', () => {
    const env = {
      envelopeId: 'env-bully-father',
      title: 'FATHER',
      artist: 'Kanye West',
      album: 'Bully',
      url: '',
      durationSeconds: 200,
      provider: 'https' as const,
      transport: 'element-src' as const,
      sourceId: 'track-father',
    };
    expect(primaryMobilePlayQuery(env)).toBe('Kanye West Bully FATHER');
    expect(mobileFallbackPlayQuery(env)).toBe('Kanye West FATHER');
  });
});

describe('buildPlayQueries', () => {
  it('prefers album-qualified queries before bare artist+title', () => {
    const queries = buildPlayQueries({
      envelopeId: 'env-bully-father',
      title: 'FATHER',
      artist: 'Kanye West',
      album: 'Bully',
      url: '',
      durationSeconds: 200,
      provider: 'https',
      transport: 'element-src',
      sourceId: 'track-father',
    });
    expect(queries[0]).toBe('Kanye West Bully FATHER');
    expect(queries).toContain('Kanye West FATHER');
    expect(queries.indexOf('Kanye West Bully FATHER')).toBeLessThan(
      queries.indexOf('Kanye West FATHER'),
    );
  });

  it('skips truncated album names and prefers artist+title', () => {
    const queries = buildPlayQueries({
      envelopeId: 'env-holy-grail',
      title: 'Holy Grail',
      artist: 'JAY-Z',
      album: 'Magna Carta... Holy Grail',
      url: '',
      durationSeconds: 218,
      provider: 'https',
      transport: 'element-src',
      sourceId: '123',
    });
    expect(queries[0]).toBe('JAY-Z Holy Grail');
    expect(queries.some((q) => q.includes('...'))).toBe(false);
  });
});
