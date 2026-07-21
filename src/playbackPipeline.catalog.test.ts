import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateSource, MediaEnvelope } from './sandboxLayer1';

vi.mock('./catalogDirect', () => ({
  canResolveFullStreams: vi.fn(() => false),
  allowCatalogPreviewPlayback: vi.fn(() => true),
  catalogPlayUrlFromPreview: vi.fn((url?: string | null) => url?.trim() ?? ''),
}));

vi.mock('./addons/searchProviders', () => ({
  searchBuiltinPackAddons: vi.fn(async () => []),
  searchDebrid: vi.fn(async () => []),
  searchProxy: vi.fn(async () => []),
  searchUserManifestAddons: vi.fn(async () => []),
}));

vi.mock('./addonStorage', () => ({
  getEnabledAddons: vi.fn(() => []),
}));

vi.mock('./streamCache', () => ({
  getCachedStreamForTrack: vi.fn(() => null),
  getStreamCacheEnvelope: vi.fn(async () => null),
  putCachedStream: vi.fn(),
  resolutionQueryFromEnvelope: vi.fn((env: MediaEnvelope) => `${env.title}:${env.artist}`),
}));

vi.mock('./mobileResolverRegistry', () => ({
  tryMobileResolve: vi.fn(async () => null),
  preferFreshMobileResolve: vi.fn(() => false),
}));

vi.mock('./playUrlCache', () => ({
  getCachedPlayEnvelope: vi.fn(() => null),
  playCacheKey: vi.fn((env: MediaEnvelope) => `${env.title}:${env.artist}`),
  setCachedPlayEnvelope: vi.fn(),
}));

vi.mock('./catalogFetch', () => ({
  fetchCatalogApiResults: vi.fn(async () => [
    {
      trackName: 'Test Track',
      previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/test.m4a',
    },
  ]),
}));

vi.mock('./tier34/client', () => ({
  getTier34BaseUrl: vi.fn(() => ''),
  isTier34ReachableCached: vi.fn(() => false),
  isServerReachableCached: vi.fn(() => false),
  tier34DhtResolve: vi.fn(async () => null),
}));

import { executeTrack } from './playbackPipeline';
import { allowCatalogPreviewPlayback } from './catalogDirect';
import { tryMobileResolve, preferFreshMobileResolve } from './mobileResolverRegistry';

const catalogEnvelope = (): MediaEnvelope => ({
  envelopeId: 'catalog-1843895742',
  title: 'Test Track',
  artist: 'Test Artist',
  album: 'Test Album',
  url: '',
  durationSeconds: 210,
  provider: 'https',
  transport: 'element-src',
  sourceId: 'catalog-1843895742',
});

const previewCandidate = (): CandidateSource => ({
  id: 'catalog-1843895742',
  priority: 1,
  provider: 'https',
  transport: 'element-src',
  uri: 'https://audio-ssl.itunes.apple.com/itunes-assets/candidate.m4a',
  metadata: {
    title: 'Test Track',
    artist: 'Test Artist',
    durationSeconds: 210,
  },
});

describe('executeTrack catalog preview without tier34', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(allowCatalogPreviewPlayback).mockReturnValue(true);
  });

  it('resolves preview URL from catalog- prefixed sourceId via iTunes lookup', async () => {
    const result = await executeTrack(catalogEnvelope());
    expect(result.url).toContain('audio-ssl');
    expect(result.durationSeconds).toBe(30);
  });

  it('falls back to attached preview candidate uri when lookup is not needed', async () => {
    const result = await executeTrack(catalogEnvelope(), [previewCandidate()]);
    expect(result.url).toContain('audio-ssl');
    expect(result.durationSeconds).toBe(30);
  });

  it('does not resolve preview when dev preview mode is disabled', async () => {
    vi.mocked(allowCatalogPreviewPlayback).mockReturnValue(false);
    const result = await executeTrack(catalogEnvelope(), [previewCandidate()]);
    expect(result.url).toBe('');
  });

  it('resolves full stream via mobile yt-dlp when server is offline', async () => {
    vi.mocked(allowCatalogPreviewPlayback).mockReturnValue(false);
    vi.mocked(preferFreshMobileResolve).mockReturnValue(true);
    vi.mocked(tryMobileResolve).mockResolvedValue(
      'file:///data/user/0/com.sandbox.music/cache/yt-dlp/track.m4a',
    );
    const result = await executeTrack(catalogEnvelope());
    expect(result.url).toMatch(/^file:\/\//);
    expect(result.resolutionSource).toBe('mobile');
  });

  it('preserves mobile googlevideo stream when server is offline', async () => {
    vi.mocked(allowCatalogPreviewPlayback).mockReturnValue(false);
    vi.mocked(preferFreshMobileResolve).mockReturnValue(true);
    vi.mocked(tryMobileResolve).mockResolvedValue(
      'https://rr3---sn-abc.googlevideo.com/videoplayback?expire=9999999999',
    );
    const result = await executeTrack(catalogEnvelope());
    expect(result.url).toContain('googlevideo.com');
    expect(result.resolutionSource).toBe('mobile');
  });
});

describe('preserveTappedEnvelopeIdentity', () => {
  it('keeps tapped title and artist over resolved metadata', async () => {
    const { preserveTappedEnvelopeIdentity } = await import('./playbackPipeline');
    const tapped = {
      envelopeId: 'hit-1',
      title: 'Tapped Title',
      artist: 'Tapped Artist',
      album: 'Tapped Album',
      url: '',
      durationSeconds: 200,
      provider: 'stream-proxy',
      transport: 'element-src',
      sourceId: 'hit-1',
    } as MediaEnvelope;
    const resolved = {
      ...tapped,
      title: 'Wrong Title',
      artist: 'Wrong Artist',
      url: 'file:///cache/ytdlp-playback/track.mp4',
      resolutionSource: 'mobile',
    } as MediaEnvelope;
    const merged = preserveTappedEnvelopeIdentity(tapped, resolved);
    expect(merged.title).toBe('Tapped Title');
    expect(merged.artist).toBe('Tapped Artist');
    expect(merged.envelopeId).toBe('hit-1');
    expect(merged.url).toContain('file://');
  });

  it('prefers resolved locker sourceId over stale playlist sourceId', async () => {
    const { preserveTappedEnvelopeIdentity } = await import('./playbackPipeline');
    const tapped = {
      envelopeId: 'playlist-row-1',
      title: 'FRIED',
      artist: '¥$',
      album: '',
      url: '',
      durationSeconds: 200,
      provider: 'local-vault',
      transport: 'element-src',
      sourceId: 'locker-orphan-old',
    } as MediaEnvelope;
    const resolved = {
      envelopeId: 'local-locker-new',
      title: 'FRIED',
      artist: 'Future, Metro Boomin',
      album: 'WE DONT TRUST YOU',
      url: 'content://rd.sheepskin.sandboxmusic.locker/locker-new',
      durationSeconds: 200,
      provider: 'local-vault',
      transport: 'element-src',
      sourceId: 'locker-new',
    } as MediaEnvelope;
    const merged = preserveTappedEnvelopeIdentity(tapped, resolved);
    expect(merged.envelopeId).toBe('playlist-row-1');
    expect(merged.title).toBe('FRIED');
    expect(merged.artist).toBe('Future, Metro Boomin');
    expect(merged.album).toBe('WE DONT TRUST YOU');
    expect(merged.sourceId).toBe('locker-new');
    expect(merged.url).toContain('content://');
  });

  it('keeps tapped catalog duration over resolved album-length stream metadata', async () => {
    const { preserveTappedEnvelopeIdentity } = await import('./playbackPipeline');
    const tapped = {
      envelopeId: 'catalog-1',
      title: 'Track One',
      artist: 'JPEGMAFIA',
      album: 'LP!',
      url: '',
      durationSeconds: 187,
      provider: 'https',
      transport: 'element-src',
      sourceId: 'catalog-1',
    } as MediaEnvelope;
    const resolved = {
      ...tapped,
      url: 'file:///cache/ytdlp-playback/album.m4a',
      durationSeconds: 3297,
      resolutionSource: 'mobile',
    } as MediaEnvelope;
    const merged = preserveTappedEnvelopeIdentity(tapped, resolved);
    expect(merged.durationSeconds).toBe(187);
  });
});
