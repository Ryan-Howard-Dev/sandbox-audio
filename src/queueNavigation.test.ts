import { describe, expect, it } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  cumulativeQueueOffset,
  resolveQueueTrackSeekTarget,
  shouldSeekQueueTrackInPlace,
} from './queueNavigation';

const track = (
  id: string,
  title: string,
  durationSeconds: number,
  album = 'Album',
): MediaEnvelope => ({
  envelopeId: id,
  title,
  artist: 'Artist',
  album,
  url: '',
  durationSeconds,
  provider: 'https',
  transport: 'element-src',
  sourceId: id,
});

describe('queueNavigation', () => {
  it('sums prior track lengths for album stream offsets', () => {
    const queue = [
      track('a', 'One', 210),
      track('b', 'Two', 180),
      track('c', 'Three', 240),
    ];
    expect(cumulativeQueueOffset(queue, 0)).toBe(0);
    expect(cumulativeQueueOffset(queue, 1)).toBe(210);
    expect(cumulativeQueueOffset(queue, 2)).toBe(390);
    expect(resolveQueueTrackSeekTarget(queue, 2)).toBe(390);
  });

  it('seeks in place only when target shares the same stream URL', () => {
    const sharedUrl = 'https://stream/album';
    const queue = [
      { ...track('a', 'One', 210), url: sharedUrl },
      { ...track('b', 'Two', 180), url: sharedUrl },
    ];
    expect(
      shouldSeekQueueTrackInPlace(queue, 1, 0, sharedUrl, 3297, 180),
    ).toBe(true);
    expect(
      shouldSeekQueueTrackInPlace(queue, 0, 1, sharedUrl, 3297, 210),
    ).toBe(true);
  });

  it('does not seek in place for same album metadata with different streams', () => {
    const queue = [track('a', 'One', 210), track('b', 'Two', 180)];
    expect(
      shouldSeekQueueTrackInPlace(queue, 1, 0, 'https://stream/album', 3297, 180),
    ).toBe(false);
  });

  it('does not seek in place for unrelated tracks', () => {
    const queue = [
      track('a', 'One', 210, 'Album A'),
      track('b', 'Two', 180, 'Album B'),
    ];
    expect(
      shouldSeekQueueTrackInPlace(queue, 0, 1, 'https://stream/a', 215, 210),
    ).toBe(false);
  });
});
