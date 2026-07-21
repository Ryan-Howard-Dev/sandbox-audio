import { describe, expect, it } from 'vitest';
import type { NativeExoPlaybackStatus } from './androidNativePlayback';
import {
  clearLastPlayIntent,
  discardNonPersistableLastPlayIntent,
  effectiveNativeExoState,
  envelopeFromNativeStatus,
  isNativeExoAudible,
  isPersistablePlayIntent,
  lastPlayIntentToEnvelope,
  LAST_PLAY_INTENT_KEY,
  loadLastPlayIntent,
  nativeExoCanResumeSameTrack,
  nativeExoUiIsPlaying,
  nativeStatusMatchesEnvelope,
  reconcileEnvelopeFromNativeStatus,
  reconcileNativeExoPosition,
  resolvePauseHoldPos,
  saveLastPlayIntent,
  synthesizeNativeExoPosition,
  type LastPlayIntent,
} from './lastPlayIntent';
import { prefsSetItem } from './prefsStorage';

describe('lastPlayIntent native reconcile', () => {
  it('detects OnePlus stuck idle while position advances', () => {
    const status: NativeExoPlaybackStatus = {
      available: true,
      wired: true,
      message: 'ok',
      state: 'idle',
      positionSecs: 12.4,
    };
    expect(isNativeExoAudible(status, 12)).toBe(true);
    expect(effectiveNativeExoState(status, 12)).toBe('playing');
  });

  it('shows pause UI while Exo stays loading but scrubber advances', () => {
    const status: NativeExoPlaybackStatus = {
      available: true,
      wired: true,
      message: 'ok',
      state: 'loading',
      positionSecs: 29.0,
    };
    expect(nativeExoUiIsPlaying(status, 'loading', 28.95, 29.4)).toBe(true);
    expect(nativeExoUiIsPlaying(status, 'loading', 28.95, 0.1)).toBe(false);
  });

  it('restores envelope from native metadata', () => {
    const status: NativeExoPlaybackStatus = {
      available: true,
      wired: true,
      message: 'ok',
      state: 'playing',
      title: "God's Plan",
      artist: 'Drake',
      envelopeId: 'yt-abc',
      positionSecs: 4,
    };
    const env = reconcileEnvelopeFromNativeStatus(status, null);
    expect(env?.title).toBe("God's Plan");
    expect(env?.artist).toBe('Drake');
  });

  it('treats paused OEM polls as playing when position advances and user did not pause', () => {
    const status: NativeExoPlaybackStatus = {
      available: true,
      wired: true,
      message: 'ok',
      state: 'paused',
      positionSecs: 42.1,
    };
    expect(effectiveNativeExoState(status, 41.8)).toBe('playing');
    expect(isNativeExoAudible(status, 41.8)).toBe(true);
    expect(effectiveNativeExoState(status, 41.8, { userPaused: true })).toBe('paused');
    expect(reconcileNativeExoPosition(42.1, 'paused', 41.8, false, 41.8)).toBe(42.1);
    expect(reconcileNativeExoPosition(41.5, 'paused', 42, false, 41.8)).toBe(41.5);
    expect(reconcileNativeExoPosition(0, 'paused', 42, false, 42)).toBe(42);
    expect(reconcileNativeExoPosition(0, 'idle', 45, false, 44.5)).toBe(45);
  });

  it('clamps backward poll jitter while playing', () => {
    expect(reconcileNativeExoPosition(41.5, 'playing', 42, false)).toBe(42);
    expect(reconcileNativeExoPosition(42.4, 'playing', 42, false)).toBe(42.4);
  });

  it('accepts forward polls at track start instead of snapping back to 0', () => {
    expect(reconcileNativeExoPosition(3.2, 'playing', 0, false, 0)).toBe(3.2);
    expect(reconcileNativeExoPosition(0.4, 'playing', 0, false, 0)).toBe(0.4);
  });

  it('estimates wall-clock progress when OEM polls stay at 0 while playing', () => {
    const anchor = { pos: 0, atMs: Date.now() - 5000 };
    const { pos, anchor: next } = synthesizeNativeExoPosition(0, 'playing', anchor, 0, 37);
    expect(pos).toBeGreaterThanOrEqual(4.8);
    expect(pos).toBeLessThanOrEqual(5.2);
    expect(next?.pos).toBe(0);
  });

  it('snapshots pause position from wall-clock anchor when native polls are 0', () => {
    const anchor = { pos: 2, atMs: Date.now() - 8000 };
    const hold = resolvePauseHoldPos(
      37,
      anchor,
      { lastRendered: 0, latestDisplay: 0, currentTime: 0, nativePolled: 0 },
    );
    expect(hold).toBeGreaterThanOrEqual(9.8);
    expect(hold).toBeLessThanOrEqual(10.2);
  });

  it('prefers native polled position when UI refs are still zero', () => {
    const hold = resolvePauseHoldPos(210, null, {
      lastRendered: 0,
      latestDisplay: 0,
      currentTime: 0,
      nativePolled: 154.6,
    });
    expect(hold).toBeCloseTo(154.6, 1);
  });

  it('detects when native Exo can resume the same track without reload', () => {
    const paused: NativeExoPlaybackStatus = {
      available: true,
      wired: true,
      message: 'ok',
      state: 'paused',
      positionSecs: 88.2,
      queueLength: 1,
      envelopeId: 'track-a',
    };
    expect(nativeExoCanResumeSameTrack(paused, 'track-a', 88)).toBe(true);

    const idleMidTrack: NativeExoPlaybackStatus = {
      available: true,
      wired: true,
      message: 'ok',
      state: 'idle',
      positionSecs: 42,
      queueLength: 1,
      envelopeId: 'track-a',
    };
    expect(nativeExoCanResumeSameTrack(idleMidTrack, 'track-a', 41.5)).toBe(true);

    const freshIdle: NativeExoPlaybackStatus = {
      available: true,
      wired: true,
      message: 'ok',
      state: 'idle',
      positionSecs: 0,
      queueLength: 0,
    };
    expect(nativeExoCanResumeSameTrack(freshIdle, 'track-a')).toBe(false);
  });

  it('ignores native status from a previous envelope', () => {
    const status: NativeExoPlaybackStatus = {
      available: true,
      wired: true,
      message: 'ok',
      state: 'playing',
      envelopeId: 'old-track',
    };
    expect(nativeStatusMatchesEnvelope(status, 'new-track')).toBe(false);
    expect(nativeStatusMatchesEnvelope(status, 'old-track')).toBe(true);
  });

  it('accepts native polls without envelope id when intent matches', () => {
    const status: NativeExoPlaybackStatus = {
      available: true,
      wired: true,
      message: 'ok',
      state: 'playing',
      title: 'STUPID SONG',
      artist: 'Olivia Rodrigo',
    };
    expect(nativeStatusMatchesEnvelope(status, 'catalog-123')).toBe(false);
    expect(nativeStatusMatchesEnvelope(status, undefined)).toBe(true);
  });

  it('maps persisted intent to envelope', () => {
    const intent: LastPlayIntent = {
      envelopeId: 'yt-abc',
      title: 'One Dance',
      artist: 'Drake',
      savedAt: Date.now(),
    };
    const status: NativeExoPlaybackStatus = {
      available: true,
      wired: true,
      message: 'ok',
      state: 'playing',
      positionSecs: 2,
    };
    expect(envelopeFromNativeStatus(status)).toBeNull();
    const env = lastPlayIntentToEnvelope(intent);
    expect(env.title).toBe('One Dance');
  });
});

describe('persistable play intent', () => {
  it('rejects streaming/search hits from resume persistence', () => {
    expect(
      isPersistablePlayIntent({
        provider: 'https',
        sourceId: 'search-hit-1',
        url: 'https://example.com/stream',
      }),
    ).toBe(false);
    expect(
      isPersistablePlayIntent({
        provider: 'local-vault',
        sourceId: 'locker-abc',
        url: 'content://locker/locker-abc',
      }),
    ).toBe(true);
  });

  it('does not save non-locker envelopes', () => {
    clearLastPlayIntent();
    saveLastPlayIntent({
      envelopeId: 'search-1',
      title: 'Creep',
      artist: 'Radiohead',
      url: '',
      durationSeconds: 200,
      provider: 'https',
      transport: 'element-src',
      sourceId: 'search-1',
    });
    expect(loadLastPlayIntent()).toBeNull();
  });

  it('auto-discards legacy streaming intent on cold-start cleanup', () => {
    prefsSetItem(
      LAST_PLAY_INTENT_KEY,
      JSON.stringify({
        envelopeId: 'search-1',
        title: 'Creep',
        artist: 'Radiohead',
        provider: 'https',
        savedAt: Date.now(),
      }),
    );
    discardNonPersistableLastPlayIntent();
    expect(loadLastPlayIntent()).toBeNull();
  });
});
