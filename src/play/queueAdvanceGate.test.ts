import { describe, expect, it } from 'vitest';
import {
  resolveActivePlayQueue,
  shouldSuppressJsAdvanceAfterNativeGapless,
  trackPlaybackMatureForAdvance,
} from './queueAdvanceGate';

describe('trackPlaybackMatureForAdvance', () => {
  it('accepts when Playing was reached', () => {
    expect(
      trackPlaybackMatureForAdvance({
        reachedPlaying: true,
        peakSeconds: 0,
        currentSeconds: 0,
      }),
    ).toBe(true);
  });

  it('accepts native-audible playback before FSM Playing', () => {
    expect(
      trackPlaybackMatureForAdvance({
        reachedPlaying: false,
        peakSeconds: 2.4,
        currentSeconds: 2.1,
      }),
    ).toBe(true);
  });

  it('rejects spurious ended before meaningful playback', () => {
    expect(
      trackPlaybackMatureForAdvance({
        reachedPlaying: false,
        peakSeconds: 0.2,
        currentSeconds: 0.1,
      }),
    ).toBe(false);
  });
});

describe('shouldSuppressJsAdvanceAfterNativeGapless', () => {
  const queue = [
    { envelopeId: 'a' },
    { envelopeId: 'b' },
    { envelopeId: 'c' },
  ];

  it('suppresses when native already advanced past ended track', () => {
    expect(
      shouldSuppressJsAdvanceAfterNativeGapless({
        seamless: true,
        gaplessTransitionAtMs: Date.now() - 500,
        endedEnvelopeId: 'a',
        queueIndex: 1,
        playQueue: queue,
      }),
    ).toBe(true);
  });

  it('does not suppress when still on ended track (native queue exhausted)', () => {
    expect(
      shouldSuppressJsAdvanceAfterNativeGapless({
        seamless: true,
        gaplessTransitionAtMs: Date.now() - 500,
        endedEnvelopeId: 'b',
        queueIndex: 1,
        playQueue: queue,
      }),
    ).toBe(false);
  });

  it('does not suppress outside gapless window', () => {
    expect(
      shouldSuppressJsAdvanceAfterNativeGapless({
        seamless: true,
        gaplessTransitionAtMs: Date.now() - 10_000,
        endedEnvelopeId: 'a',
        queueIndex: 2,
        playQueue: queue,
      }),
    ).toBe(false);
  });
});

describe('resolveActivePlayQueue', () => {
  const album = [
    { envelopeId: 'local-locker-a' },
    { envelopeId: 'local-locker-b' },
    { envelopeId: 'local-locker-c' },
  ];
  const staleAlbum = [
    { envelopeId: 'local-locker-x' },
    { envelopeId: 'local-locker-y' },
    { envelopeId: 'local-locker-z' },
  ];

  it('keeps ref album when state is same length but stale', () => {
    const result = resolveActivePlayQueue({
      envEnvelopeId: 'local-locker-a',
      refQueue: album,
      stateQueue: staleAlbum,
    });
    expect(result.collapsed).toBe(false);
    expect(result.queue).toEqual(album);
  });

  it('collapses for explicit new selection outside any queue', () => {
    const result = resolveActivePlayQueue({
      envEnvelopeId: 'search-new',
      refQueue: album,
      stateQueue: staleAlbum,
    });
    expect(result.collapsed).toBe(true);
    expect(result.queue).toEqual([{ envelopeId: 'search-new' }]);
  });

  it('honors preservePlayQueue on advance', () => {
    const result = resolveActivePlayQueue({
      envEnvelopeId: 'local-locker-b',
      refQueue: album,
      stateQueue: [],
      preservePlayQueue: true,
    });
    expect(result.collapsed).toBe(false);
    expect(result.queue).toEqual(album);
  });
});
