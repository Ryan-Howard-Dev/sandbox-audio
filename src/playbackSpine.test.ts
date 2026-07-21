import { describe, expect, it } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  estimateStreamDownloadMb,
  formatCellularDownloadNotice,
  isCellularNetwork,
  needsUncachedRemoteResolve,
  shouldRunAggressiveCacheOnNetwork,
} from './networkPlayPolicy';
import {
  buildHealAttemptKey,
  resolveHealAction,
} from './play/playbackHealPolicy';
import {
  computeNextQueueIndex,
  computeSkipBackIndex,
  tryExtendMixRadioQueue,
} from './play/queueAdvancePolicy';
import {
  isImmediateLocalPlayable,
  needsMobileResolveEarly,
} from './play/playTapFastPath';

const env = (
  partial: Partial<MediaEnvelope> & Pick<MediaEnvelope, 'envelopeId' | 'title'>,
): MediaEnvelope => ({
  artist: 'Artist',
  album: 'Album',
  url: '',
  durationSeconds: 210,
  provider: 'https',
  transport: 'element-src',
  sourceId: partial.envelopeId,
  ...partial,
});

describe('playback spine — queue advance', () => {
  it('advances to next index', () => {
    expect(
      computeNextQueueIndex({
        queueIndex: 1,
        queueLength: 5,
        repeatMode: 'none',
        shuffleOn: false,
      }),
    ).toEqual({ action: 'advance', index: 2 });
  });

  it('wraps on repeat all', () => {
    expect(
      computeNextQueueIndex({
        queueIndex: 4,
        queueLength: 5,
        repeatMode: 'all',
        shuffleOn: false,
        distinctTrackCount: 5,
      }),
    ).toEqual({ action: 'wrap', index: 0 });
  });

  it('does not wrap repeat-all on a lone track (stale repeat + single queue)', () => {
    expect(
      computeNextQueueIndex({
        queueIndex: 0,
        queueLength: 1,
        repeatMode: 'all',
        shuffleOn: false,
        distinctTrackCount: 1,
      }),
    ).toEqual({ action: 'none' });
  });

  it('repeats one track', () => {
    expect(
      computeNextQueueIndex({
        queueIndex: 2,
        queueLength: 5,
        repeatMode: 'one',
        shuffleOn: false,
      }),
    ).toEqual({ action: 'repeat-one', index: 2 });
  });

  it('stops at queue end without repeat', () => {
    expect(
      computeNextQueueIndex({
        queueIndex: 4,
        queueLength: 5,
        repeatMode: 'none',
        shuffleOn: false,
      }),
    ).toEqual({ action: 'none' });
  });

  it('uses deterministic shuffle index', () => {
    expect(
      computeNextQueueIndex({
        queueIndex: 0,
        queueLength: 4,
        repeatMode: 'none',
        shuffleOn: true,
        random: () => 0.5,
      }),
    ).toEqual({ action: 'advance', index: 2 });
  });
});

describe('playback spine — skip back', () => {
  it('seeks to track start when past threshold', () => {
    expect(
      computeSkipBackIndex({
        queueIndex: 2,
        queueLength: 5,
        currentTimeSeconds: 12,
      }),
    ).toBe('seek-start');
  });

  it('goes to previous track when near start', () => {
    expect(
      computeSkipBackIndex({
        queueIndex: 2,
        queueLength: 5,
        currentTimeSeconds: 1,
      }),
    ).toBe(1);
  });
});

describe('playback spine — mix radio extend', () => {
  it('appends continuation tracks at queue end', () => {
    const current = env({ envelopeId: 'a', title: 'Seed' });
    const result = tryExtendMixRadioQueue({
      mixSession: { kind: 'mix', seedArtist: 'A', seedTitle: 'Seed' },
      current,
      queue: [current],
      buildContinuation: () => [
        env({ envelopeId: 'b', title: 'Next' }),
        env({ envelopeId: 'c', title: 'After' }),
      ],
    });
    expect(result).toEqual({
      action: 'extend',
      tracks: [
        expect.objectContaining({ envelopeId: 'b' }),
        expect.objectContaining({ envelopeId: 'c' }),
      ],
      startIndex: 1,
    });
  });

  it('does nothing without mix session', () => {
    expect(
      tryExtendMixRadioQueue({
        mixSession: null,
        current: env({ envelopeId: 'a', title: 'Seed' }),
        queue: [],
        buildContinuation: () => [],
      }),
    ).toEqual({ action: 'none' });
  });
});

describe('playback spine — heal policy', () => {
  it('refreshes local vault once', () => {
    const track = env({
      envelopeId: 'local-1',
      title: 'Local',
      provider: 'local-vault',
      sourceId: '1',
    });
    expect(buildHealAttemptKey(track)).toBe('local:1');
    expect(resolveHealAction(track, null)).toEqual({
      kind: 'local-refresh',
      sourceId: '1',
    });
    expect(resolveHealAction(track, 'local:1')).toEqual({ kind: 'fail' });
  });

  it('tier34-heals remote streams once', () => {
    const track = env({ envelopeId: 'remote-1', title: 'Remote', provider: 'proxy' });
    expect(resolveHealAction(track, null)).toEqual({ kind: 'tier34-heal' });
    expect(resolveHealAction(track, 'remote-1')).toEqual({ kind: 'fail' });
  });
});

describe('playback spine — fast tap paths', () => {
  it('detects immediate locker play', () => {
    expect(
      isImmediateLocalPlayable(
        env({
          envelopeId: 'local-1',
          title: 'Hit',
          provider: 'local-vault',
          url: 'content://locker/1',
        }),
      ),
    ).toBe(true);
    expect(
      isImmediateLocalPlayable(
        env({ envelopeId: 'local-1', title: 'Hit', provider: 'local-vault', url: '' }),
      ),
    ).toBe(false);
  });

  it('flags mobile resolve for preview URLs', () => {
    expect(
      needsMobileResolveEarly(
        env({
          envelopeId: 'c-1',
          title: 'Preview',
          url: 'https://audio-ssl.itunes.apple.com/preview.m4a',
        }),
      ),
    ).toBe(true);
  });
});

describe('network play policy', () => {
  it('estimates download size from duration', () => {
    expect(estimateStreamDownloadMb(env({ envelopeId: 'x', title: 'T', durationSeconds: 210 }))).toBeCloseTo(
      3.28,
      1,
    );
  });

  it('formats cellular notice', () => {
    expect(formatCellularDownloadNotice(4.2)).toBe('Streaming ~4.2 MB on cellular');
  });

  it('detects uncached remote resolve need', () => {
    expect(needsUncachedRemoteResolve(env({ envelopeId: 'x', title: 'T', provider: 'proxy' }))).toBe(
      true,
    );
    expect(
      needsUncachedRemoteResolve(
        env({
          envelopeId: 'local-1',
          title: 'T',
          provider: 'local-vault',
          url: 'content://x',
        }),
      ),
    ).toBe(false);
  });

  it('defaults network helpers without throwing in node', () => {
    expect(typeof isCellularNetwork()).toBe('boolean');
    expect(typeof shouldRunAggressiveCacheOnNetwork()).toBe('boolean');
  });
});
