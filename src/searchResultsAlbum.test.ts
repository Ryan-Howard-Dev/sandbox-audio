import { describe, expect, it, vi } from 'vitest';
import type { CandidateSource, MediaEnvelope } from './sandboxLayer1';
import type { ResolvedSearchHit } from './sandboxLayer2';

vi.mock('./tier34/client', () => ({
  getTier34BaseUrl: vi.fn(() => ''),
  isTier34ReachableCached: vi.fn(() => false),
  isServerReachableCached: vi.fn(() => false),
  tier34DhtResolve: vi.fn(async () => null),
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
  getStreamCacheEnvelope: vi.fn(async () => null),
  getCachedStreamForTrack: vi.fn(() => null),
  putCachedStream: vi.fn(),
  resolutionQueryFromEnvelope: vi.fn((env: MediaEnvelope) => `${env.title}:${env.artist}`),
}));

vi.mock('./mobileResolverRegistry', () => ({
  tryMobileResolve: vi.fn(async () => null),
  getEnabledMobileResolvers: vi.fn(() => []),
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
      trackName: 'Latino Essentials',
      previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a',
      trackId: 1843895742,
    },
  ]),
}));

vi.mock('./catalogDirect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./catalogDirect')>();
  return {
    ...actual,
    allowCatalogPreviewPlayback: vi.fn(() => false),
  };
});

import { executeTrack } from './playbackPipeline';

const previewUri = 'https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a';

function catalogHit(): ResolvedSearchHit {
  const catalogCandidate: CandidateSource = {
    id: 'catalog-1843895742',
    priority: 1,
    provider: 'https',
    transport: 'element-src',
    uri: previewUri,
    metadata: {
      title: 'Latino Essentials',
      artist: 'Various Artists',
      durationSeconds: 210,
    },
  };
  const tierCandidate: CandidateSource = {
    id: 'proxy-0',
    priority: 5,
    provider: 'proxy',
    transport: 'proxy',
    uri: '/api/proxy/stream?url=https%3A%2F%2Fexample.com%2Ftrack.mp3',
    metadata: {
      title: 'Latino Essentials',
      artist: 'Various Artists',
      durationSeconds: 210,
    },
  };
  const primaryEnvelope: MediaEnvelope = {
    envelopeId: 'catalog-1843895742',
    title: 'Latino Essentials',
    artist: 'Various Artists',
    url: previewUri,
    durationSeconds: 210,
    provider: 'https',
    transport: 'element-src',
    sourceId: '1843895742',
  };
  return {
    identityId: 'identity-0-latino',
    title: 'Latino Essentials',
    artist: 'Various Artists',
    sources: [catalogCandidate, tierCandidate],
    primaryEnvelope,
  };
}

describe('album catalog playback without tier34', () => {
  it('does not play preview when tier34 is offline even with tier proxy attached', async () => {
    const hit = catalogHit();
    const result = await executeTrack(hit.primaryEnvelope, hit.sources);
    expect(result.url).toBe('');
    expect(result.sourceId).toBe('1843895742');
  });

  it('does not play preview when tier proxy primary would fail without catalog sourceId', async () => {
    const hit = catalogHit();
    const corruptedPrimary: MediaEnvelope = {
      ...hit.primaryEnvelope,
      url: hit.sources[1].uri ?? '',
      sourceId: 'proxy-0',
      provider: 'proxy',
      transport: 'proxy',
    };
    const result = await executeTrack(corruptedPrimary, hit.sources);
    expect(result.url).toBe('');
  });
});
