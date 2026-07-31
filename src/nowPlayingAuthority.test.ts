/**
 * @vitest-environment node
 *
 * The scenario under test is the recorded device bug: HUMBLE. is coming out of the speaker,
 * euphoria has been tapped, and the stream behind euphoria has not landed yet.
 */
import { describe, expect, it } from 'vitest';
import type { AudioFsmState, MediaEnvelope } from './sandboxLayer1';
import type { PlaybackDisplayFields } from './playbackSession';
import {
  NOW_PLAYING_HOLD_TIMEOUT_MS,
  applyNowPlayingAuthority,
  isNowPlayingCommitCurrent,
  nextHeldNowPlaying,
  resolveAuthoritativeEnvelope,
  resolveHeldPositionSeconds,
  resolveNowPlayingAuthority,
  shouldCommitAudibleNowPlaying,
  type HeldNowPlaying,
  type NowPlayingAuthorityInput,
} from './nowPlayingAuthority';

const AUDIBLE = 'track-humble';
const LOADING = 'track-euphoria';

function input(overrides: Partial<NowPlayingAuthorityInput> = {}): NowPlayingAuthorityInput {
  return {
    loadingEnvelopeId: LOADING,
    heldEnvelopeId: AUDIBLE,
    heldStillAudible: true,
    audioState: 'Resolving',
    startedInstantly: false,
    loadElapsedMs: 400,
    ...overrides,
  };
}

function display(
  envelopeId: string,
  title: string,
  extra: Partial<PlaybackDisplayFields> = {},
): PlaybackDisplayFields {
  return {
    envelopeId,
    contentType: 'music',
    title,
    artist: 'Kendrick Lamar',
    album: 'DAMN.',
    artworkUrl: `https://art.example/${envelopeId}.jpg`,
    durationSeconds: 177,
    positionSeconds: 0,
    ...extra,
  };
}

describe('resolveNowPlayingAuthority — holding identity until the stream is audible', () => {
  it('keeps the audible track while the tapped track is still resolving', () => {
    const decision = resolveNowPlayingAuthority(input());
    expect(decision.source).toBe('held');
    expect(decision.envelopeId).toBe(AUDIBLE);
    expect(decision.reason).toBe('awaiting-stream');
  });

  it('still reports the skip as registered while holding', () => {
    const decision = resolveNowPlayingAuthority(input());
    expect(decision.showResolvingAffordance).toBe(true);
    expect(decision.resolvingEnvelopeId).toBe(LOADING);
    expect(decision.abandonLoad).toBe(false);
  });

  it('holds through Connecting as well as Resolving', () => {
    const decision = resolveNowPlayingAuthority(input({ audioState: 'Connecting' }));
    expect(decision.source).toBe('held');
    expect(decision.showResolvingAffordance).toBe(true);
  });

  it('holds when the native poll reports Idle mid-handoff', () => {
    // The old stream is still decoding; calling that "the new track is live" is the bug.
    const decision = resolveNowPlayingAuthority(input({ audioState: 'Idle' }));
    expect(decision.source).toBe('held');
    expect(decision.envelopeId).toBe(AUDIBLE);
  });

  it('hands over the moment the loading track is Playing', () => {
    const decision = resolveNowPlayingAuthority(input({ audioState: 'Playing' }));
    expect(decision.source).toBe('live');
    expect(decision.envelopeId).toBe(LOADING);
    expect(decision.reason).toBe('load-audible');
    expect(decision.showResolvingAffordance).toBe(false);
  });

  it('hands over on Ready, where the stream owns the output but autoplay is held back', () => {
    const decision = resolveNowPlayingAuthority(input({ audioState: 'Ready' }));
    expect(decision.source).toBe('live');
    expect(decision.envelopeId).toBe(LOADING);
  });
});

describe('resolveNowPlayingAuthority — the fast path must not be slowed', () => {
  it('swaps immediately when the stream was already playable', () => {
    const decision = resolveNowPlayingAuthority(
      input({ startedInstantly: true, audioState: 'Resolving' }),
    );
    expect(decision.source).toBe('live');
    expect(decision.envelopeId).toBe(LOADING);
    expect(decision.reason).toBe('instant-handoff');
    expect(decision.showResolvingAffordance).toBe(false);
  });

  it('swaps immediately on a cold start, where no audible track can be contradicted', () => {
    const decision = resolveNowPlayingAuthority(
      input({ heldEnvelopeId: null, heldStillAudible: false }),
    );
    expect(decision.source).toBe('live');
    expect(decision.reason).toBe('nothing-audible-to-protect');
  });

  it('swaps immediately once the held stream has been torn down', () => {
    const decision = resolveNowPlayingAuthority(input({ heldStillAudible: false }));
    expect(decision.source).toBe('live');
    expect(decision.envelopeId).toBe(LOADING);
  });

  it('never withholds a reload of the track already on screen', () => {
    const decision = resolveNowPlayingAuthority(
      input({ loadingEnvelopeId: AUDIBLE, audioState: 'Resolving' }),
    );
    expect(decision.source).toBe('live');
    expect(decision.envelopeId).toBe(AUDIBLE);
    expect(decision.reason).toBe('same-envelope');
    expect(decision.showResolvingAffordance).toBe(false);
  });
});

describe('resolveNowPlayingAuthority — a stream that never arrives', () => {
  it('falls back to the still-playing track and asks the caller to surface the failure', () => {
    const decision = resolveNowPlayingAuthority(input({ audioState: 'Failed' }));
    expect(decision.source).toBe('held');
    expect(decision.envelopeId).toBe(AUDIBLE);
    expect(decision.abandonLoad).toBe(true);
    expect(decision.showResolvingAffordance).toBe(false);
    expect(decision.reason).toBe('load-failed');
  });

  it('gives up on the hold rather than spinning on the old track forever', () => {
    const decision = resolveNowPlayingAuthority(
      input({ loadElapsedMs: NOW_PLAYING_HOLD_TIMEOUT_MS }),
    );
    expect(decision.source).toBe('held');
    expect(decision.abandonLoad).toBe(true);
    expect(decision.showResolvingAffordance).toBe(false);
    expect(decision.reason).toBe('hold-timed-out');
  });

  it('keeps holding right up to the timeout', () => {
    const decision = resolveNowPlayingAuthority(
      input({ loadElapsedMs: NOW_PLAYING_HOLD_TIMEOUT_MS - 1 }),
    );
    expect(decision.reason).toBe('awaiting-stream');
    expect(decision.abandonLoad).toBe(false);
  });

  it('honours a caller-supplied timeout', () => {
    const decision = resolveNowPlayingAuthority(
      input({ loadElapsedMs: 6_000, holdTimeoutMs: 5_000 }),
    );
    expect(decision.reason).toBe('hold-timed-out');
  });

  it('shows the audible track when the audio layer has no load in flight', () => {
    const decision = resolveNowPlayingAuthority(input({ loadingEnvelopeId: '' }));
    expect(decision.source).toBe('held');
    expect(decision.envelopeId).toBe(AUDIBLE);
    expect(decision.reason).toBe('no-load-in-flight');
  });

  it('shows nothing when nothing is loaded and nothing is audible', () => {
    const decision = resolveNowPlayingAuthority(
      input({ loadingEnvelopeId: null, heldEnvelopeId: null, heldStillAudible: false }),
    );
    expect(decision.source).toBe('none');
    expect(decision.envelopeId).toBe('');
    expect(decision.reason).toBe('nothing-loaded');
  });

  it('treats whitespace ids as absent', () => {
    const decision = resolveNowPlayingAuthority(
      input({ loadingEnvelopeId: '   ', heldEnvelopeId: '  ' }),
    );
    expect(decision.source).toBe('none');
  });

  it('never holds without an audible track, in any state', () => {
    const states: AudioFsmState[] = [
      'Idle',
      'Resolving',
      'Connecting',
      'Ready',
      'Playing',
      'Failed',
    ];
    for (const audioState of states) {
      const decision = resolveNowPlayingAuthority(
        input({ audioState, heldEnvelopeId: null, heldStillAudible: false }),
      );
      expect(decision.source).toBe('live');
    }
  });
});

describe('isNowPlayingCommitCurrent — five fast presses of next', () => {
  it('accepts the commit for the track the user actually landed on', () => {
    expect(
      isNowPlayingCommitCurrent(
        { envelopeId: 'track-5', playToken: 5 },
        { envelopeId: 'track-5', playToken: 5 },
      ),
    ).toBe(true);
  });

  it('discards a resolution for a track already skipped past', () => {
    expect(
      isNowPlayingCommitCurrent(
        { envelopeId: 'track-2', playToken: 2 },
        { envelopeId: 'track-5', playToken: 5 },
      ),
    ).toBe(false);
  });

  it('discards a stale generation even when the envelope matches', () => {
    // Skip away and back: same track, but the earlier resolve no longer speaks for it.
    expect(
      isNowPlayingCommitCurrent(
        { envelopeId: 'track-5', playToken: 3 },
        { envelopeId: 'track-5', playToken: 5 },
      ),
    ).toBe(false);
  });

  it('discards a commit with no envelope at all', () => {
    expect(
      isNowPlayingCommitCurrent({ envelopeId: '' }, { envelopeId: 'track-5' }),
    ).toBe(false);
    expect(
      isNowPlayingCommitCurrent({ envelopeId: null }, { envelopeId: null }),
    ).toBe(false);
  });

  it('falls back to envelope identity when no generation is tracked', () => {
    expect(
      isNowPlayingCommitCurrent({ envelopeId: 'track-5' }, { envelopeId: 'track-5' }),
    ).toBe(true);
  });
});

describe('shouldCommitAudibleNowPlaying', () => {
  it('commits only once the stream owns the output', () => {
    expect(shouldCommitAudibleNowPlaying('Playing', LOADING)).toBe(true);
    expect(shouldCommitAudibleNowPlaying('Ready', LOADING)).toBe(true);
    expect(shouldCommitAudibleNowPlaying('Resolving', LOADING)).toBe(false);
    expect(shouldCommitAudibleNowPlaying('Connecting', LOADING)).toBe(false);
    expect(shouldCommitAudibleNowPlaying('Failed', LOADING)).toBe(false);
    expect(shouldCommitAudibleNowPlaying('Idle', LOADING)).toBe(false);
  });

  it('has nothing to commit without an envelope', () => {
    expect(shouldCommitAudibleNowPlaying('Playing', '')).toBe(false);
    expect(shouldCommitAudibleNowPlaying('Playing', null)).toBe(false);
  });
});

describe('resolveHeldPositionSeconds', () => {
  it('follows the native clock, which keeps advancing on the held stream', () => {
    expect(resolveHeldPositionSeconds(61, 64)).toBe(64);
  });

  it('ignores the web element resetting to zero mid-handoff', () => {
    expect(resolveHeldPositionSeconds(61, 0)).toBe(61);
  });

  it('never reports a negative or non-finite position', () => {
    expect(resolveHeldPositionSeconds(-4, -1)).toBe(0);
    expect(resolveHeldPositionSeconds(Number.NaN, 12)).toBe(12);
    expect(resolveHeldPositionSeconds(12, Number.NaN)).toBe(12);
  });
});

function envelope(envelopeId: string, title: string): MediaEnvelope {
  return {
    envelopeId,
    title,
    artist: 'Kendrick Lamar',
    url: `https://stream.example/${envelopeId}.m4a`,
    durationSeconds: 177,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: envelopeId,
  };
}

describe('applyNowPlayingAuthority', () => {
  const live = display(LOADING, 'euphoria');
  const held: HeldNowPlaying = {
    envelopeId: AUDIBLE,
    display: display(AUDIBLE, 'HUMBLE.', { positionSeconds: 61 }),
    envelope: envelope(AUDIBLE, 'HUMBLE.'),
  };

  it('paints every field from the audible track while holding', () => {
    const decision = resolveNowPlayingAuthority(input());
    const painted = applyNowPlayingAuthority(decision, live, held, {
      heldPositionSeconds: 61,
      livePositionSeconds: 64,
    });
    expect(painted.envelopeId).toBe(AUDIBLE);
    expect(painted.title).toBe('HUMBLE.');
    expect(painted.artworkUrl).toBe(held.display.artworkUrl);
    expect(painted.durationSeconds).toBe(held.display.durationSeconds);
    expect(painted.positionSeconds).toBe(64);
  });

  it('keeps the held clock when the web element has been torn down', () => {
    const decision = resolveNowPlayingAuthority(input());
    const painted = applyNowPlayingAuthority(decision, live, held, {
      heldPositionSeconds: 61,
      livePositionSeconds: 0,
    });
    expect(painted.positionSeconds).toBe(61);
  });

  it('paints the live track once it is audible', () => {
    const decision = resolveNowPlayingAuthority(input({ audioState: 'Playing' }));
    expect(
      applyNowPlayingAuthority(decision, live, held, {
        heldPositionSeconds: 61,
        livePositionSeconds: 2,
      }),
    ).toBe(live);
  });

  it('cannot hold what it does not have', () => {
    const decision = resolveNowPlayingAuthority(input());
    expect(
      applyNowPlayingAuthority(decision, live, null, {
        heldPositionSeconds: 61,
        livePositionSeconds: 2,
      }),
    ).toBe(live);
  });
});

describe('nextHeldNowPlaying', () => {
  const env = envelope(AUDIBLE, 'HUMBLE.');

  it('keeps the same snapshot object when only the clock has moved', () => {
    const first = nextHeldNowPlaying(null, {
      envelopeId: AUDIBLE,
      display: display(AUDIBLE, 'HUMBLE.', { positionSeconds: 12 }),
      envelope: env,
    });
    const second = nextHeldNowPlaying(first, {
      envelopeId: AUDIBLE,
      display: display(AUDIBLE, 'HUMBLE.', { positionSeconds: 13 }),
      envelope: env,
    });
    expect(second).toBe(first);
  });

  it('replaces the snapshot when artwork is corrected late', () => {
    const first = nextHeldNowPlaying(null, {
      envelopeId: AUDIBLE,
      display: display(AUDIBLE, 'HUMBLE.', { artworkUrl: '' }),
      envelope: env,
    });
    const second = nextHeldNowPlaying(first, {
      envelopeId: AUDIBLE,
      display: display(AUDIBLE, 'HUMBLE.', { artworkUrl: 'https://art.example/late.jpg' }),
      envelope: env,
    });
    expect(second).not.toBe(first);
    expect(second.display.artworkUrl).toBe('https://art.example/late.jpg');
  });

  it('replaces the snapshot on a new track', () => {
    const first = nextHeldNowPlaying(null, {
      envelopeId: AUDIBLE,
      display: display(AUDIBLE, 'HUMBLE.'),
      envelope: env,
    });
    const nextEnv = envelope(LOADING, 'euphoria');
    const second = nextHeldNowPlaying(first, {
      envelopeId: LOADING,
      display: display(LOADING, 'euphoria'),
      envelope: nextEnv,
    });
    expect(second.envelopeId).toBe(LOADING);
    expect(second.envelope).toBe(nextEnv);
  });

  it('replaces the snapshot when the envelope object is swapped for the same track', () => {
    // URL repair mints a new envelope for the same id; the art/provider fields come off that object.
    const first = nextHeldNowPlaying(null, {
      envelopeId: AUDIBLE,
      display: display(AUDIBLE, 'HUMBLE.'),
      envelope: env,
    });
    const repaired = envelope(AUDIBLE, 'HUMBLE.');
    const second = nextHeldNowPlaying(first, {
      envelopeId: AUDIBLE,
      display: display(AUDIBLE, 'HUMBLE.'),
      envelope: repaired,
    });
    expect(second.envelope).toBe(repaired);
  });
});

describe('resolveAuthoritativeEnvelope — cover art must follow the held title', () => {
  const liveEnvelope = envelope(LOADING, 'euphoria');
  const held: HeldNowPlaying = {
    envelopeId: AUDIBLE,
    display: display(AUDIBLE, 'HUMBLE.'),
    envelope: envelope(AUDIBLE, 'HUMBLE.'),
  };

  it('points art resolution at the audible envelope while holding', () => {
    const decision = resolveNowPlayingAuthority(input());
    expect(resolveAuthoritativeEnvelope(decision, liveEnvelope, held)).toBe(held.envelope);
  });

  it('points art resolution at the live envelope once it is audible', () => {
    const decision = resolveNowPlayingAuthority(input({ audioState: 'Playing' }));
    expect(resolveAuthoritativeEnvelope(decision, liveEnvelope, held)).toBe(liveEnvelope);
  });

  it('falls back to the live envelope when the snapshot carries none', () => {
    const decision = resolveNowPlayingAuthority(input());
    expect(
      resolveAuthoritativeEnvelope(decision, liveEnvelope, { ...held, envelope: null }),
    ).toBe(liveEnvelope);
  });
});
