import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import {
  clearUriResolutionCache,
  getCachedStream,
  putCachedStream,
} from './streamCache';
import {
  registerMobileResolver,
  removeMobileResolver,
  setMobileResolverEnabled,
  tryMobileResolve,
} from './mobileResolverRegistry';

vi.mock('./tier34/client', () => ({
  getTier34BaseUrl: vi.fn(() => 'http://localhost:3001'),
  isServerReachableCached: vi.fn(() => true),
}));

vi.mock('./ytDlpMobile', () => ({
  isYtDlpMobileNativeAvailable: vi.fn(() => false),
  resolveViaYtDlpMobile: vi.fn(async () => null),
  getLastYtDlpMobileError: vi.fn(() => null),
}));

const TEST_RESOLVER_IDS = [
  'test-resolver-web',
  'test-resolver-cache',
  'test-resolver-hit',
  'test-resolver-disabled',
];

describe('tryMobileResolve', () => {
  beforeEach(() => {
    clearUriResolutionCache();
    for (const id of TEST_RESOLVER_IDS) removeMobileResolver(id);
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
  });

  it('returns null on web platform', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    registerMobileResolver({
      id: 'test-resolver-web',
      name: 'Test',
      enabled: true,
      resolve: async () => ({ uri: 'https://example.com/a.mp3', bitrate: 128, format: 'mp3' }),
    });
    await expect(tryMobileResolve('web-only-query')).resolves.toBeNull();
  });

  it('reads mobile URI cache before calling addons', async () => {
    putCachedStream({
      query: 'cached query',
      uri: 'https://cache.example/stream.m4a',
      source: 'mobile',
    });
    const resolve = vi.fn();
    registerMobileResolver({
      id: 'test-resolver-cache',
      name: 'Test',
      enabled: true,
      resolve,
    });
    await expect(tryMobileResolve('cached query')).resolves.toBe(
      'https://cache.example/stream.m4a',
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('caches successful addon resolutions for 6h bucket', async () => {
    registerMobileResolver({
      id: 'test-resolver-hit',
      name: 'Test',
      enabled: true,
      resolve: async () => ({
        uri: 'https://resolver.example/track.mp3',
        bitrate: 320,
        format: 'mp3',
      }),
    });
    const uri = await tryMobileResolve('resolver-hit-query');
    expect(uri).toBe('https://resolver.example/track.mp3');
    const cached = getCachedStream('resolver-hit-query');
    expect(cached?.uri).toBe('https://resolver.example/track.mp3');
    expect(cached?.source).toBe('mobile');
    expect((cached?.expiresAt ?? 0) - (cached?.resolvedAt ?? 0)).toBe(6 * 60 * 60 * 1000);
  });

  it('skips disabled resolvers', async () => {
    registerMobileResolver({
      id: 'test-resolver-disabled',
      name: 'Test',
      enabled: true,
      resolve: async () => ({
        uri: 'https://resolver.example/track.mp3',
        bitrate: 128,
        format: 'mp3',
      }),
    });
    setMobileResolverEnabled('test-resolver-disabled', false);
    await expect(tryMobileResolve('disabled-resolver-query')).resolves.toBeNull();
  });
});
