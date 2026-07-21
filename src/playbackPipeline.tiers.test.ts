import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateSource, MediaEnvelope } from './sandboxLayer1';

vi.mock('./catalogDirect', () => ({
  canResolveFullStreams: vi.fn(() => true),
  allowCatalogPreviewPlayback: vi.fn(() => false),
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

vi.mock('./tier34/client', () => ({
  getTier34BaseUrl: vi.fn(() => 'http://127.0.0.1:3001'),
  isTier34ReachableCached: vi.fn(() => true),
  tier34DhtResolve: vi.fn(async () => null),
}));

import { searchDebrid, searchProxy } from './addons/searchProviders';
import { resolveSandboxServerStream } from './playbackPipeline';

const trackEnv = (): MediaEnvelope => ({
  envelopeId: 'env-1',
  title: 'Test Track',
  artist: 'Test Artist',
  url: '',
  durationSeconds: 210,
  provider: 'https',
  transport: 'element-src',
  sourceId: 'track-1',
});

const tierCandidate = (
  provider: 'proxy' | 'debrid',
  uri: string,
): CandidateSource => ({
  id: `${provider}-0`,
  priority: 1,
  provider,
  transport: provider,
  uri,
  mimeType: provider === 'debrid' ? 'audio/flac' : 'audio/mpeg',
  metadata: {
    title: 'Test Track',
    artist: 'Test Artist',
    durationSeconds: 210,
  },
});

describe('resolveSandboxServerStream tier ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      dispatchEvent: vi.fn(),
    });
    localStorage.setItem('sandbox_fidelity_policy', 'LOSSLESS');
  });

  it('LOSSLESS tries debrid before proxy and prefers debrid hit', async () => {
    vi.mocked(searchDebrid).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve([tierCandidate('debrid', 'https://archive.example/track.flac')]),
            30,
          );
        }),
    );
    vi.mocked(searchProxy).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve([
                tierCandidate('proxy', 'http://127.0.0.1:3001/api/proxy/stream?url=youtube'),
              ]),
            5,
          );
        }),
    );

    const resolved = await resolveSandboxServerStream(trackEnv());
    expect(resolved?.provider).toBe('debrid');
    expect(resolved?.url).toContain('archive.example');
    expect(searchDebrid).toHaveBeenCalled();
    expect(searchProxy).not.toHaveBeenCalled();
  });

  it('LOSSLESS falls back to proxy when debrid misses', async () => {
    vi.mocked(searchDebrid).mockResolvedValue([]);
    vi.mocked(searchProxy).mockResolvedValue([
      tierCandidate('proxy', 'http://127.0.0.1:3001/api/proxy/stream?url=youtube'),
    ]);

    const resolved = await resolveSandboxServerStream(trackEnv());
    expect(resolved?.provider).toBe('proxy');
    expect(searchDebrid).toHaveBeenCalled();
    expect(searchProxy).toHaveBeenCalled();
  });

  it('HIGH keeps parallel race so faster proxy can win', async () => {
    localStorage.setItem('sandbox_fidelity_policy', 'HIGH');
    vi.mocked(searchDebrid).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve([tierCandidate('debrid', 'https://archive.example/track.flac')]),
            50,
          );
        }),
    );
    vi.mocked(searchProxy).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve([
                tierCandidate('proxy', 'http://127.0.0.1:3001/api/proxy/stream?url=youtube'),
              ]),
            5,
          );
        }),
    );

    const resolved = await resolveSandboxServerStream(trackEnv());
    expect(resolved?.provider).toBe('proxy');
    expect(searchDebrid).toHaveBeenCalled();
    expect(searchProxy).toHaveBeenCalled();
  });
});
