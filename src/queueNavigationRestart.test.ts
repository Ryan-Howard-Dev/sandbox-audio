/**
 * Restarting the track that is already playing.
 *
 * Skipping back more than a few seconds in restarts the current track. That seek was aimed at the
 * cumulative offset of the queue position, which is only where a track begins when the whole queue
 * is one album-length stream. On an ordinary queue of separate files it aimed minutes past the end
 * of the track and the button did nothing at all, except at the top of the queue where the sum is
 * zero and it looked fine.
 */

import { describe, expect, it } from 'vitest';
import { resolveQueueTrackRestartSeconds } from './queueNavigation';
import type { MediaEnvelope } from './sandboxLayer1';

const track = (n: number, url: string, durationSeconds = 200): MediaEnvelope =>
  ({
    envelopeId: `t${n}`,
    title: `Track ${n}`,
    url,
    durationSeconds,
    provider: 'local-vault',
    transport: 'element-src',
  }) as MediaEnvelope;

describe('resolveQueueTrackRestartSeconds', () => {
  it('restarts an ordinary queue track at its own beginning', () => {
    const queue = [0, 1, 2, 3].map((n) => track(n, `file:///music/${n}.mp3`));
    // The bug: this returned 400, which is past the end of a 200 second track.
    expect(resolveQueueTrackRestartSeconds(queue, 2, 'file:///music/2.mp3')).toBe(0);
  });

  it('uses the offset when the queue really is one shared stream', () => {
    // An album uploaded as a single file: track three genuinely starts 400 seconds in.
    const shared = 'https://cdn.example/whole-album.mp3';
    const queue = [0, 1, 2, 3].map((n) => track(n, shared));
    expect(resolveQueueTrackRestartSeconds(queue, 2, shared)).toBe(400);
  });

  it('does not trust the offset when only some of the queue shares the stream', () => {
    const shared = 'https://cdn.example/whole-album.mp3';
    const queue = [track(0, shared), track(1, shared), track(2, 'file:///music/2.mp3')];
    expect(resolveQueueTrackRestartSeconds(queue, 2, shared)).toBe(0);
  });

  it('restarts at zero for a lone track or an unknown stream', () => {
    const queue = [track(0, 'file:///music/0.mp3')];
    expect(resolveQueueTrackRestartSeconds(queue, 0, 'file:///music/0.mp3')).toBe(0);
    expect(resolveQueueTrackRestartSeconds(queue, 0, '')).toBe(0);
  });

  it('was only ever right at the top of the queue, which is why this went unnoticed', () => {
    const queue = [0, 1, 2].map((n) => track(n, `file:///music/${n}.mp3`));
    expect(resolveQueueTrackRestartSeconds(queue, 0, 'file:///music/0.mp3')).toBe(0);
  });
});
