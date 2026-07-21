/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';

vi.mock('./platformEnv', () => ({ isCapacitorNative: () => true }));
vi.mock('./tier34/client', () => ({
  getTier34BaseUrl: () => '',
  getTier34LanBaseUrl: () => '',
  isTier34ReachableCached: () => false,
}));
vi.mock('./streamCache', () => ({
  getStreamCacheEnvelope: vi.fn(async () => null),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
}));
vi.mock('./androidNativePlayback', () => ({
  NativeExoPlayback: {
    localStreamProxyUrl: vi.fn(async ({ url }: { url: string }) => ({ url })),
  },
}));

function podcastEnv(url: string, id = 'podcast:feed-jre:ep-191'): MediaEnvelope {
  return {
    envelopeId: id,
    title: '#191 - Thomas Pacchia - AI Will Expose The Fake World',
    artist: 'Joe Rogan Experience',
    album: 'Joe Rogan Experience',
    url,
    durationSeconds: 3600,
    provider: 'https',
    transport: 'element-src',
    sourceId: 'ep-191',
    mimeType: 'audio/mpeg',
  };
}

describe('podcast play path', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'https://localhost' } });
  });

  it('unwraps localhost proxy URLs to direct HTTPS on native', async () => {
    const direct = 'https://media.blubrry.com/whatbitcoindid/media.blubrry.com/whatbitcoindid/content/audio/episode.mp3';
    const proxy = `https://localhost/api/podcast-audio-proxy?url=${encodeURIComponent(direct)}`;
    const { resolvePodcastEnvelopeForPlayback } = await import('./podcastPlayback');
    const playable = await resolvePodcastEnvelopeForPlayback(podcastEnv(proxy));
    expect(playable.url).toBe(direct);
  });

  it('keeps direct HTTPS enclosure URLs on native without tier34', async () => {
    const direct = 'https://cdn.example.com/episodes/191.mp3';
    const { resolvePodcastEnvelopeForPlayback } = await import('./podcastPlayback');
    const playable = await resolvePodcastEnvelopeForPlayback(podcastEnv(direct));
    expect(playable.url).toBe(direct);
  });

  it('rejects envelopes with no audio URL', async () => {
    const { resolvePodcastEnvelopeForPlayback, PodcastPlaybackError } = await import(
      './podcastPlayback'
    );
    await expect(resolvePodcastEnvelopeForPlayback(podcastEnv(''))).rejects.toBeInstanceOf(
      PodcastPlaybackError,
    );
  });

  it('hasPlayablePodcastStreamUrl accepts direct HTTPS and rejects empty', async () => {
    const { hasPlayablePodcastStreamUrl } = await import('./podcastPlayback');
    expect(
      hasPlayablePodcastStreamUrl(
        podcastEnv('https://cdn.example.com/a.mp3', 'podcast:feed:ep-189'),
      ),
    ).toBe(true);
    expect(hasPlayablePodcastStreamUrl(podcastEnv('', 'podcast:feed:ep-190'))).toBe(false);
  });

  it('episodeEnvelope never throws for YouTube URLs without server', async () => {
    vi.resetModules();
    vi.doMock('./platformEnv', () => ({ isCapacitorNative: () => true }));
    vi.doMock('./tier34/client', () => ({
      getTier34BaseUrl: () => '',
      isTier34ReachableCached: () => false,
    }));
    const { episodeEnvelope } = await import('./podcastSearch');
    const env = episodeEnvelope(
      {
        id: 'feed:ep-yt',
        feedId: 'feed-pmc',
        title: 'YouTube episode',
        audioUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
      'Joe Rogan Experience',
    );
    expect(env.url).toContain('youtube.com');
  });
});

describe('safePodcastPlaybackUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'https://localhost' } });
  });

  it('unwraps relative proxy paths on native instead of localhost proxy', async () => {
    vi.doMock('./platformEnv', () => ({ isCapacitorNative: () => true }));
    vi.doMock('./tier34/client', () => ({
      getTier34BaseUrl: () => '',
      getTier34LanBaseUrl: () => '',
      isTier34ReachableCached: () => false,
    }));
    const direct = 'https://cdn.example.com/ep190.mp3';
    const relative = `/api/podcast-audio-proxy?url=${encodeURIComponent(direct)}`;
    const { safePodcastPlaybackUrl } = await import('./podcastRss');
    expect(safePodcastPlaybackUrl(relative)).toBe(direct);
  });
});
