import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { formatEpisodeDate } from './podcastFormat';

describe('formatEpisodeDate', () => {
  it('uses Gregorian year for Buddhist-locale formatting', () => {
    const ms = Date.parse('2025-07-02T12:00:00Z');
    const formatted = formatEpisodeDate(ms);
    expect(formatted).toMatch(/2025/);
    expect(formatted).not.toMatch(/2568|2569/);
  });

  it('returns em dash when missing', () => {
    expect(formatEpisodeDate(undefined)).toBe('—');
  });
});

describe('podcastPlaybackUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'https://app.test' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns direct HTTPS on native when no tier34 server', async () => {
    vi.doMock('./platformEnv', () => ({ isCapacitorNative: () => true }));
    vi.doMock('./tier34/client', () => ({
      getTier34BaseUrl: () => '',
      getTier34LanBaseUrl: () => '',
      isTier34ReachableCached: () => false,
    }));
    const { podcastPlaybackUrl } = await import('./podcastRss');
    const url = 'https://cdn.example.com/episode.mp3';
    expect(podcastPlaybackUrl(url)).toBe(url);
  });

  it('uses dev proxy on web when no tier34 server', async () => {
    vi.doMock('./platformEnv', () => ({ isCapacitorNative: () => false }));
    vi.doMock('./tier34/client', () => ({
      getTier34BaseUrl: () => '',
      getTier34LanBaseUrl: () => '',
      isTier34ReachableCached: () => false,
    }));
    const { podcastPlaybackUrl } = await import('./podcastRss');
    const url = 'https://cdn.example.com/episode.mp3';
    expect(podcastPlaybackUrl(url)).toBe(
      '/api/podcast-audio-proxy?url=' + encodeURIComponent(url),
    );
  });

  it('uses direct HTTPS on native when tier34 is configured but unreachable', async () => {
    vi.doMock('./platformEnv', () => ({ isCapacitorNative: () => true }));
    vi.doMock('./tier34/client', () => ({
      getTier34BaseUrl: () => 'http://192.168.1.10:3001',
      getTier34LanBaseUrl: () => '',
      isTier34ReachableCached: () => false,
    }));
    const { podcastPlaybackUrl } = await import('./podcastRss');
    const url = 'https://cdn.example.com/episode.mp3';
    expect(podcastPlaybackUrl(url)).toBe(url);
  });
});
