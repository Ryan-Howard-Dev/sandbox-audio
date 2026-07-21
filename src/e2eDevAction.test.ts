import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  handleE2eAction,
  parseE2eUrl,
  registerE2eHandlers,
} from './e2eDevAction';

vi.mock('./nativeExoStreamResolver', () => ({
  pickMobileExoPlayUrlAsync: vi.fn(async (resolved: { uri: string }) => resolved.uri),
  pickMobileExoPlayUrl: vi.fn((resolved: { uri: string }) => resolved.uri),
}));

vi.mock('./ytDlpMobile', () => ({
  getYtDlpMobileStatus: vi.fn(async () => ({
    available: true,
    initialized: true,
    version: '2024.1',
  })),
  waitForYtDlpInit: vi.fn(async () => true),
  resolveViaYtDlpMobile: vi.fn(async () => ({
    uri: 'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc',
    watchUrl: 'https://www.youtube.com/watch?v=abc12345678',
    bitrate: 128,
    format: 'm4a',
  })),
}));

vi.mock('./androidNativePlayback', () => ({
  prepareNativeExoPlayback: vi.fn(async () => ({ ok: true, message: 'ready' })),
  nativeExoPlayUrl: vi.fn(async () => {}),
  getNativeExoPlaybackStatus: vi.fn(async () => ({
    available: true,
    wired: true,
    message: 'ok',
    state: 'playing',
    positionSecs: 2,
    queueLength: 1,
  })),
}));

vi.mock('./mobileResolverRegistry', () => ({
  refreshYtDlpMobileStub: vi.fn(),
  setMobileResolverEnabled: vi.fn(),
  getEnabledMobileResolvers: vi.fn(() => [{ id: 'yt-dlp-mobile', enabled: true }]),
  getMobileResolvers: vi.fn(() => [{ id: 'yt-dlp-mobile', name: 'yt-dlp (mobile)', enabled: true }]),
}));

vi.mock('./sandboxSettings', () => ({
  saveOnboardingComplete: vi.fn(),
  saveServerSetupComplete: vi.fn(),
}));

vi.mock('./tier34/client', () => ({
  getTier34BaseUrl: vi.fn(() => ''),
  saveTier34BackendUrl: vi.fn(),
  refreshTier34Reachability: vi.fn(async () => true),
  tier34HealthOk: vi.fn(async () => true),
  tier34FetchFeedResult: vi.fn(async () => ({
    ok: true,
    items: [{ id: '1' }],
  })),
}));

vi.mock('./streamCache', () => ({
  clearStreamCache: vi.fn(async () => {}),
  clearUriResolutionCache: vi.fn(),
  getCachedStreamForTrack: vi.fn(() => null),
  isEnvelopeStreamCached: vi.fn(() => false),
}));

vi.mock('./playUrlCache', () => ({
  clearPlayUrlCache: vi.fn(),
}));

describe('parseE2eUrl', () => {
  it('parses sandboxmusic mobile-play deep link', () => {
    const parsed = parseE2eUrl('sandboxmusic://e2e/mobile-play?query=Shake+It+Off');
    expect(parsed?.action).toBe('mobile-play');
    expect(parsed?.params.get('query')).toBe('Shake It Off');
  });

  it('returns null for unrelated URLs', () => {
    expect(parseE2eUrl('https://example.com/foo')).toBeNull();
  });
});

describe('handleE2eAction', () => {
  beforeEach(() => {
    registerE2eHandlers({
      runSearch: vi.fn(),
      navigateTab: vi.fn(),
      completeOnboarding: vi.fn(),
      getSearchHitCount: () => 3,
    });
  });

  it('handles skip-onboarding', async () => {
    await expect(handleE2eAction('skip-onboarding', new URLSearchParams())).resolves.toBe(true);
  });

  it('handles mobile-play with query', async () => {
    const params = new URLSearchParams({ query: 'Shake It Off' });
    await expect(handleE2eAction('mobile-play', params)).resolves.toBe(true);
  });

  it('fails mobile-play without query', async () => {
    await expect(handleE2eAction('mobile-play', new URLSearchParams())).resolves.toBe(false);
  });

  it('clears server URL for mobile-only mode', async () => {
    await expect(handleE2eAction('clear-server', new URLSearchParams())).resolves.toBe(true);
  });

  it('clears playback caches for fresh-resolve E2E', async () => {
    await expect(handleE2eAction('clear-playback-caches', new URLSearchParams())).resolves.toBe(true);
  });
});
