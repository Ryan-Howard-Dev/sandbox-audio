/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  contentTypesDiffer,
  playbackContentTypeFromEnvelopeId,
  playbackSwitchRequiresHardPreempt,
  resolveNowPlayingDisplay,
  resolveQueueNowPlaying,
  resolveQueueUpNext,
  seedPlaybackDisplayFromEnvelope,
  shouldSkipLockerPlaybackGate,
} from './playbackSession';

const podcastEnv: MediaEnvelope = {
  envelopeId: 'podcast:feed-1:ep-1',
  title: 'Joe Rogan on AI and the future',
  artist: 'Joe Rogan Experience',
  url: 'https://example.com/ep.mp3',
  durationSeconds: 3600,
  provider: 'https',
  transport: 'element-src',
  sourceId: 'ep-1',
  artworkUrl: 'https://example.com/podcast-art.jpg',
};

const lockerEnv: MediaEnvelope = {
  envelopeId: 'local-track-42',
  title: 'No Child Left Behind',
  artist: 'Kanye West',
  url: 'content://locker/track',
  durationSeconds: 240,
  provider: 'local-vault',
  transport: 'element-src',
  sourceId: 'track-42',
  artworkUrl: 'https://example.com/album-art.jpg',
};

const musicSearchEnv: MediaEnvelope = {
  envelopeId: 'search-track-a',
  title: 'Track A (search hit)',
  artist: 'Artist One',
  url: 'https://example.com/track-a.mp3',
  durationSeconds: 200,
  provider: 'https',
  transport: 'element-src',
  sourceId: 'track-a',
};

const musicSearchEnvB: MediaEnvelope = {
  envelopeId: 'search-track-b',
  title: 'Track B (search hit)',
  artist: 'Artist Two',
  url: 'https://example.com/track-b.mp3',
  durationSeconds: 230,
  provider: 'https',
  transport: 'element-src',
  sourceId: 'track-b',
};

const podcastEnvB: MediaEnvelope = {
  envelopeId: 'podcast:feed-1:ep-2',
  title: 'Episode 2',
  artist: 'What Bitcoin Did',
  url: 'https://example.com/ep2.mp3',
  durationSeconds: 3200,
  provider: 'https',
  transport: 'element-src',
  sourceId: 'ep-2',
};

describe('playbackContentTypeFromEnvelopeId', () => {
  it('classifies podcast envelopes', () => {
    expect(playbackContentTypeFromEnvelopeId(podcastEnv.envelopeId)).toBe('podcast');
  });

  it('classifies locker music', () => {
    expect(playbackContentTypeFromEnvelopeId(lockerEnv.envelopeId)).toBe('music');
  });
});

describe('contentTypesDiffer', () => {
  it('detects podcast vs music switch', () => {
    expect(contentTypesDiffer(podcastEnv.envelopeId, lockerEnv.envelopeId)).toBe(true);
  });

  it('ignores unknown ids', () => {
    expect(contentTypesDiffer('', lockerEnv.envelopeId)).toBe(false);
  });
});

describe('playbackSwitchRequiresHardPreempt', () => {
  it('preempts music to podcast', () => {
    expect(
      playbackSwitchRequiresHardPreempt(musicSearchEnv.envelopeId, podcastEnv.envelopeId),
    ).toBe(true);
  });

  it('preempts podcast to music', () => {
    expect(
      playbackSwitchRequiresHardPreempt(podcastEnv.envelopeId, lockerEnv.envelopeId),
    ).toBe(true);
  });

  it('preempts podcast to different podcast episode', () => {
    expect(
      playbackSwitchRequiresHardPreempt(podcastEnv.envelopeId, podcastEnvB.envelopeId),
    ).toBe(true);
  });

  it('does not preempt music to different music (crossfade may apply)', () => {
    expect(
      playbackSwitchRequiresHardPreempt(musicSearchEnv.envelopeId, musicSearchEnvB.envelopeId),
    ).toBe(false);
  });

  it('ignores same envelope', () => {
    expect(
      playbackSwitchRequiresHardPreempt(musicSearchEnv.envelopeId, musicSearchEnv.envelopeId),
    ).toBe(false);
  });

  it('ignores cold start with no prior envelope', () => {
    expect(playbackSwitchRequiresHardPreempt('', podcastEnv.envelopeId)).toBe(false);
    expect(playbackSwitchRequiresHardPreempt(null, musicSearchEnv.envelopeId)).toBe(false);
  });
});

describe('shouldSkipLockerPlaybackGate', () => {
  it('skips locker gate for podcasts', () => {
    expect(shouldSkipLockerPlaybackGate(podcastEnv.envelopeId)).toBe(true);
  });

  it('runs locker gate for music', () => {
    expect(shouldSkipLockerPlaybackGate(lockerEnv.envelopeId)).toBe(false);
  });
});

describe('seedPlaybackDisplayFromEnvelope', () => {
  it('sets all fields atomically from one envelope', () => {
    const seed = seedPlaybackDisplayFromEnvelope(podcastEnv);
    expect(seed).toEqual({
      envelopeId: podcastEnv.envelopeId,
      contentType: 'podcast',
      title: podcastEnv.title,
      artist: podcastEnv.artist,
      album: undefined,
      artworkUrl: podcastEnv.artworkUrl,
      durationSeconds: podcastEnv.durationSeconds,
      positionSeconds: 0,
    });
  });
});

describe('resolveQueueNowPlaying', () => {
  it('returns podcast active envelope when music queue pointer is stale', () => {
    const playQueue = [musicSearchEnv, lockerEnv];
    const now = resolveQueueNowPlaying(playQueue, 0, podcastEnv, true);
    expect(now?.envelopeId).toBe(podcastEnv.envelopeId);
    expect(now?.title).toBe(podcastEnv.title);
  });

  it('returns queued item when it matches active playback', () => {
    const playQueue = [musicSearchEnv, lockerEnv];
    const now = resolveQueueNowPlaying(playQueue, 0, musicSearchEnv, true);
    expect(now?.envelopeId).toBe(musicSearchEnv.envelopeId);
  });

  it('returns null when idle with empty queue', () => {
    expect(resolveQueueNowPlaying([], 0, null, false)).toBeNull();
  });

  it('returns active envelope when queue is empty but podcast plays', () => {
    const now = resolveQueueNowPlaying([], 0, podcastEnv, true);
    expect(now?.envelopeId).toBe(podcastEnv.envelopeId);
  });
});

describe('resolveQueueUpNext', () => {
  it('excludes stale queue index item when now playing is outside queue', () => {
    const playQueue = [musicSearchEnv, lockerEnv];
    const upNext = resolveQueueUpNext(playQueue, 0, podcastEnv);
    expect(upNext).toHaveLength(2);
    expect(upNext.map((e) => e.envelopeId)).toEqual([
      musicSearchEnv.envelopeId,
      lockerEnv.envelopeId,
    ]);
  });

  it('slices after queue index when now playing matches queued item', () => {
    const playQueue = [musicSearchEnv, lockerEnv];
    const upNext = resolveQueueUpNext(playQueue, 0, musicSearchEnv);
    expect(upNext).toHaveLength(1);
    expect(upNext[0]?.envelopeId).toBe(lockerEnv.envelopeId);
  });
});

describe('resolveNowPlayingDisplay', () => {
  it('switching podcast to locker updates all metadata atomically', () => {
    const podcastSeed = seedPlaybackDisplayFromEnvelope(podcastEnv);
    const lockerSeed = seedPlaybackDisplayFromEnvelope(lockerEnv);

    const afterPodcast = resolveNowPlayingDisplay({
      audioEnvelope: podcastEnv,
      audioTitle: podcastEnv.title,
      audioArtist: podcastEnv.artist,
      audioState: 'Playing',
      displaySeed: podcastSeed,
      parallelArtworkUrl: podcastSeed.artworkUrl,
      lockerFeatured: {
        envelopeId: lockerEnv.envelopeId,
        title: lockerEnv.title,
        artist: lockerEnv.artist,
        artworkUrl: lockerEnv.artworkUrl,
      },
      currentTimeSeconds: 120,
      hasActivePlayback: true,
    });

    expect(afterPodcast.title).toBe(podcastEnv.title);
    expect(afterPodcast.artworkUrl).toBe(podcastEnv.artworkUrl);

    const staleParallelArt = podcastSeed.artworkUrl;
    const afterLocker = resolveNowPlayingDisplay({
      audioEnvelope: lockerEnv,
      audioTitle: lockerEnv.title,
      audioArtist: lockerEnv.artist,
      audioState: 'Resolving',
      displaySeed: lockerSeed,
      parallelArtworkUrl: staleParallelArt,
      lockerFeatured: {
        envelopeId: lockerEnv.envelopeId,
        title: lockerEnv.title,
        artist: lockerEnv.artist,
        artworkUrl: lockerEnv.artworkUrl,
      },
      currentTimeSeconds: 0,
      hasActivePlayback: true,
    });

    expect(afterLocker.title).toBe('No Child Left Behind');
    expect(afterLocker.artist).toBe('Kanye West');
    expect(afterLocker.artworkUrl).toBe(lockerEnv.artworkUrl);
    expect(afterLocker.artworkUrl).not.toBe(podcastEnv.artworkUrl);
  });

  it('does not mix locker featured preview during active playback', () => {
    const display = resolveNowPlayingDisplay({
      audioEnvelope: podcastEnv,
      audioTitle: podcastEnv.title,
      audioArtist: podcastEnv.artist,
      audioState: 'Playing',
      displaySeed: seedPlaybackDisplayFromEnvelope(podcastEnv),
      parallelArtworkUrl: podcastEnv.artworkUrl ?? '',
      lockerFeatured: {
        envelopeId: lockerEnv.envelopeId,
        title: 'No Child Left Behind',
        artist: 'Kanye West',
        artworkUrl: lockerEnv.artworkUrl,
      },
      currentTimeSeconds: 30,
      hasActivePlayback: true,
    });

    expect(display.title).toBe(podcastEnv.title);
    expect(display.title).not.toContain('No Child Left Behind');
  });
});
