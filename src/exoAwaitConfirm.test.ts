import { describe, expect, it } from 'vitest';
import { exoAwaitResolved, resolveExoAwait, type ExoAwaitInput } from './exoAwaitConfirm';

const input = (overrides: Partial<ExoAwaitInput> = {}): ExoAwaitInput => ({
  awaitingEnvelopeId: 'track:abc',
  nativeEnvelopeId: undefined,
  state: 'playing',
  error: undefined,
  positionSecs: 0,
  previousPositionSecs: 0,
  waitedMs: 0,
  timeoutMs: 2_000,
  ...overrides,
});

describe('resolveExoAwait', () => {
  it('confirms when the player names the track we handed it', () => {
    expect(resolveExoAwait(input({ nativeEnvelopeId: 'track:abc' }))).toBe('confirmed');
  });

  it('confirms despite surrounding whitespace, which the bridge adds', () => {
    expect(resolveExoAwait(input({ nativeEnvelopeId: '  track:abc  ' }))).toBe('confirmed');
  });

  it('assumes ours when the player reports no id but is plainly playing', () => {
    /*
     * The bug. The player reports nothing, strict equality never matched, the wait never ended,
     * and every poll pinned the clock to zero for the whole track while the audio played fine.
     */
    expect(resolveExoAwait(input({ nativeEnvelopeId: undefined, positionSecs: 3 }))).toBe(
      'assumed',
    );
    expect(resolveExoAwait(input({ nativeEnvelopeId: '', positionSecs: 3 }))).toBe('assumed');
    expect(resolveExoAwait(input({ nativeEnvelopeId: '   ', positionSecs: 3 }))).toBe('assumed');
  });

  it('keeps waiting when no id is reported and nothing is playing yet', () => {
    // A track that really is still loading should keep its zero rather than run a clock before
    // there is any sound.
    expect(resolveExoAwait(input({ nativeEnvelopeId: undefined, positionSecs: 0 }))).toBe(
      'waiting',
    );
  });

  it('releases on a failed load without waiting out the timeout', () => {
    expect(resolveExoAwait(input({ state: 'error' }))).toBe('failed');
    expect(resolveExoAwait(input({ error: new Error('boom') }))).toBe('failed');
  });

  it('prefers a real confirmation over an error, when both are somehow present', () => {
    expect(resolveExoAwait(input({ nativeEnvelopeId: 'track:abc', state: 'error' }))).toBe(
      'confirmed',
    );
  });

  it('waits out the window when a different track is named, then believes the audio', () => {
    const mismatched = { nativeEnvelopeId: 'track:other', positionSecs: 5, previousPositionSecs: 4 };
    expect(resolveExoAwait(input({ ...mismatched, waitedMs: 500 }))).toBe('waiting');
    expect(resolveExoAwait(input({ ...mismatched, waitedMs: 2_500 }))).toBe('timed-out');
  });

  it('does not time out on a stalled player, however long it has been', () => {
    // Position not moving means nothing is playing, and a clock that runs during a stall is worse
    // than one that waits.
    expect(
      resolveExoAwait(
        input({
          nativeEnvelopeId: 'track:other',
          positionSecs: 4,
          previousPositionSecs: 4,
          waitedMs: 60_000,
        }),
      ),
    ).toBe('waiting');
  });
});

describe('exoAwaitResolved', () => {
  it('lets the position through for every outcome except still waiting', () => {
    expect(exoAwaitResolved('confirmed')).toBe(true);
    expect(exoAwaitResolved('assumed')).toBe(true);
    expect(exoAwaitResolved('failed')).toBe(true);
    expect(exoAwaitResolved('timed-out')).toBe(true);
    expect(exoAwaitResolved('waiting')).toBe(false);
  });
});
