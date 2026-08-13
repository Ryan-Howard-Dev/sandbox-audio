/**
 * Two priming runs must never interleave their enqueues.
 *
 * Native Exo takes its queue order from the order enqueueNext calls arrive in. Priming is kicked
 * off on every track advance and walks the whole remaining queue, so on a long queue one run is
 * still resolving when the next begins, and both append to the same serialised chain. The queue
 * native ends up holding is then in a different order to the one JS holds, and playback wanders
 * back to tracks it has already played.
 *
 * The resolves are given uneven delays here on purpose. With equal timings an interleave still
 * comes out in order by luck, which is the version of this test that would have passed while the
 * bug was live.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';

const delays = new Map<string, number>();

vi.mock('./lockerStorage', () => ({
  findLockerEntryForTrack: () => null,
  getLockerEntriesSnapshot: () => [],
  refreshLockerEntryPlayUrl: async () => null,
  resolveLockerEnvelopeForPlayback: async (track: MediaEnvelope) => {
    const ms = delays.get(track.envelopeId) ?? 1;
    await new Promise((r) => setTimeout(r, ms));
    return { ...track, url: `file://${track.envelopeId}` };
  },
}));

vi.mock('./nativeExoStreamResolver', () => ({
  resolveNativeExoStreamUrlAsync: async (env: MediaEnvelope) => `exo://${env.envelopeId}`,
  isOfflineUnplayableStreamUrl: () => false,
}));

const { primeLockerNativeQueue } = await import('./trackPrefetch');

const queue = (n: number): MediaEnvelope[] =>
  Array.from(
    { length: n },
    (_, i) =>
      ({
        envelopeId: `t${i}`,
        title: `Track ${i}`,
        url: `file://t${i}`,
        provider: 'local-vault',
        transport: 'element-src',
      }) as MediaEnvelope,
  );

beforeEach(() => {
  delays.clear();
});

describe('priming the native queue', () => {
  it('enqueues in queue order', async () => {
    const seen: string[] = [];
    await primeLockerNativeQueue(queue(6), 0, (url) => seen.push(url));
    expect(seen).toEqual(['exo://t1', 'exo://t2', 'exo://t3', 'exo://t4', 'exo://t5']);
  });

  it('does not interleave when a second run starts mid-flight', async () => {
    // The first run stalls on an early track, which is exactly when the advance to the next track
    // fires its own run.
    delays.set('t1', 40);
    delays.set('t2', 40);
    delays.set('t3', 40);

    const seen: string[] = [];
    const first = primeLockerNativeQueue(queue(8), 0, (url) => seen.push(url));
    await new Promise((r) => setTimeout(r, 10));
    const second = primeLockerNativeQueue(queue(8), 4, (url) => seen.push(url));
    await Promise.all([first, second]);

    // Only the newer run may enqueue. The abandoned one contributes nothing, rather than
    // dropping its late resolves into the middle of the newer run's sequence.
    expect(seen).toEqual(['exo://t5', 'exo://t6', 'exo://t7']);
  });

  it('leaves the queue in an order that matches the list it was given', async () => {
    /*
     * The shape of the reported failure: a run per advance over a long queue. Whatever survives,
     * the enqueued sequence must be strictly increasing in queue position, because that ordering
     * is the whole contract native relies on.
     */
    delays.set('t2', 30);
    delays.set('t5', 25);
    delays.set('t9', 15);

    const seen: string[] = [];
    const tracks = queue(14);
    const runs = [0, 1, 2].map((from) =>
      primeLockerNativeQueue(tracks, from, (url) => seen.push(url)),
    );
    await Promise.all(runs);

    const positions = seen.map((u) => Number(u.replace('exo://t', '')));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe('what may join the native queue', () => {
  it('offers only the contiguous run ahead', async () => {
    const { enqueueableQueueIndices } = await import('./trackPrefetch');
    expect(enqueueableQueueIndices(3, 20)).toEqual([4, 5, 6, 7, 8]);
  });

  it('never offers the previous track, however tempting a fast back-skip is', async () => {
    const { enqueueableQueueIndices, prefetchQueueIndices } = await import('./trackPrefetch');
    // The prefetch list wants it. The queue must not have it: under repeat-all the track before
    // the first is the last one, and enqueueing that played position 60 sixth on a real device.
    expect(prefetchQueueIndices(0, 61, 'all')).toContain(60);
    expect(enqueueableQueueIndices(0, 61)).not.toContain(60);
  });

  it('stops at the end rather than wrapping into the queue', async () => {
    const { enqueueableQueueIndices, prefetchQueueIndices } = await import('./trackPrefetch');
    expect(prefetchQueueIndices(58, 61, 'all')).toContain(0);
    expect(enqueueableQueueIndices(58, 61)).toEqual([59, 60]);
  });
});
