import { describe, expect, it } from 'vitest';
import {
  JS_NAV_TRANSITION_OWNERSHIP_MS,
  resolveActivePlayQueue,
  shouldAdoptNativeExoTransition,
  shouldSuppressJsAdvanceAfterNativeGapless,
  trackPlaybackMatureForAdvance,
} from './queueAdvanceGate';

/*
 * Regression cover for the two playback breakages caused by keying the native queue off a stable
 * mediaId (#36). URL matching missed often enough to hide a real defect: native fires a
 * transition for every item change, including ones JS just caused, and adopting those re-drove
 * the queue index on top of the JS advance. Reliable matching made every echo land, so skipping
 * jumped between tracks and tapping a song played a different one.
 *
 * These enumerate the race directly, including the ordering an E2E cannot reach: the native echo
 * arriving before the JS advance has updated the active envelope ref.
 */
describe('shouldAdoptNativeExoTransition', () => {
  const now = 10_000;

  it('adopts a genuine gapless advance JS did not initiate', () => {
    expect(
      shouldAdoptNativeExoTransition({
        transitionEnvelopeId: 'track-2',
        activeEnvelopeId: 'track-1',
        nowMs: now,
      }),
    ).toBe(true);
  });

  it('ignores a transition to the track already playing', () => {
    expect(
      shouldAdoptNativeExoTransition({
        transitionEnvelopeId: 'track-1',
        activeEnvelopeId: 'track-1',
        nowMs: now,
      }),
    ).toBe(false);
  });

  it('ignores the native echo of a JS-initiated skip', () => {
    expect(
      shouldAdoptNativeExoTransition({
        transitionEnvelopeId: 'track-2',
        activeEnvelopeId: 'track-2',
        pendingJsNavEnvelopeId: 'track-2',
        pendingJsNavAtMs: now - 50,
        nowMs: now,
      }),
    ).toBe(false);
  });

  /*
   * The case the active-envelope guard alone cannot catch, and the one that actually shipped
   * broken: the echo lands before JS has updated its active ref, so activeEnvelopeId is still
   * the *previous* track and the comparison passes. Only the navigation claim rejects it.
   */
  it('ignores the echo even when it beats the JS ref update', () => {
    expect(
      shouldAdoptNativeExoTransition({
        transitionEnvelopeId: 'track-2',
        activeEnvelopeId: 'track-1',
        pendingJsNavEnvelopeId: 'track-2',
        pendingJsNavAtMs: now - 10,
        nowMs: now,
      }),
    ).toBe(false);
  });

  /*
   * R-018. A skip calls playUrl with resetQueue, then the prefetch effect enqueues the next five
   * tracks. Each enqueue produced a transition whose envelope was *not* the navigation target, so
   * the old narrower rule adopted every one and each re-drove setQueueIndex — the observed
   * overshoot of five to seven against a native queue of about six. Ownership now covers the
   * whole window, not just the navigation's own envelope.
   */
  it('ignores prefetch transitions to tracks beyond the skip target', () => {
    for (const ahead of ['track-3', 'track-4', 'track-5', 'track-6', 'track-7']) {
      expect(
        shouldAdoptNativeExoTransition({
          transitionEnvelopeId: ahead,
          activeEnvelopeId: 'track-2',
          pendingJsNavEnvelopeId: 'track-2',
          pendingJsNavAtMs: now - 40,
          nowMs: now,
        }),
      ).toBe(false);
    }
  });

  /* Once the window has passed, a genuine advance to a later track is adopted again. */
  it('adopts a later track once the navigation window has expired', () => {
    expect(
      shouldAdoptNativeExoTransition({
        transitionEnvelopeId: 'track-3',
        activeEnvelopeId: 'track-2',
        pendingJsNavEnvelopeId: 'track-2',
        pendingJsNavAtMs: now - JS_NAV_TRANSITION_OWNERSHIP_MS - 1,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it('releases ownership once the window expires, so a stale claim cannot wedge it shut', () => {
    expect(
      shouldAdoptNativeExoTransition({
        transitionEnvelopeId: 'track-2',
        activeEnvelopeId: 'track-1',
        pendingJsNavEnvelopeId: 'track-2',
        pendingJsNavAtMs: now - JS_NAV_TRANSITION_OWNERSHIP_MS,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it('rejects a transition with no resolvable envelope', () => {
    expect(
      shouldAdoptNativeExoTransition({ transitionEnvelopeId: '  ', nowMs: now }),
    ).toBe(false);
  });
});

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

  it('rejects reachedPlaying that flipped true only milliseconds ago (no peak proof either)', () => {
    expect(
      trackPlaybackMatureForAdvance({
        reachedPlaying: true,
        peakSeconds: 0,
        currentSeconds: 0,
        msSinceReachedPlaying: 15,
      }),
    ).toBe(false);
  });

  it('accepts reachedPlaying once it has held past the minimum window', () => {
    expect(
      trackPlaybackMatureForAdvance({
        reachedPlaying: true,
        peakSeconds: 0,
        currentSeconds: 0,
        msSinceReachedPlaying: 450,
      }),
    ).toBe(true);
  });

  it('still accepts on real listened time even if reachedPlaying flipped just now', () => {
    expect(
      trackPlaybackMatureForAdvance({
        reachedPlaying: true,
        peakSeconds: 2.1,
        currentSeconds: 2.1,
        msSinceReachedPlaying: 10,
      }),
    ).toBe(true);
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
