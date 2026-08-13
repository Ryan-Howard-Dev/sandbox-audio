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

describe('ordered release into the native queue', () => {
  const env = (n: number) => ({ envelopeId: `t${n}` }) as MediaEnvelope;
  const run = async () => {
    const { createOrderedRelease } = await import('./trackPrefetch');
    const seen: number[] = [];
    const rel = createOrderedRelease([1, 2, 3, 4, 5], (url) => seen.push(Number(url)));
    return { rel, seen };
  };

  it('holds a result back until the positions before it have settled', async () => {
    const { rel, seen } = await run();
    // Arrives backwards, which is what a warm track behind a cold one looks like.
    rel.settle(3, { url: '3', envelope: env(3) });
    rel.settle(2, { url: '2', envelope: env(2) });
    expect(seen).toEqual([]);
    rel.settle(1, { url: '1', envelope: env(1) });
    expect(seen).toEqual([1, 2, 3]);
  });

  it('steps over a position that resolved to nothing', async () => {
    // Otherwise one dead entry costs the lookahead for everything behind it.
    const { rel, seen } = await run();
    rel.settle(1, { url: '1', envelope: env(1) });
    rel.settle(3, { url: '3', envelope: env(3) });
    expect(seen).toEqual([1]);
    rel.settle(2, null);
    expect(seen).toEqual([1, 3]);
  });

  it('ignores a run that has been overtaken', async () => {
    /*
     * The skip case. A second skip starts a new window while the first is still resolving, and
     * both released correctly into the same queue, interleaved. On device that left the player
     * holding positions 2, 7, 4, 5, 6, 3 where it should have held 2 through 7.
     */
    const { createOrderedRelease } = await import('./trackPrefetch');
    const seen: number[] = [];
    let stale = false;
    const rel = createOrderedRelease([1, 2, 3], (url) => seen.push(Number(url)), () => stale);
    rel.settle(1, { url: '1', envelope: env(1) });
    stale = true;
    rel.settle(2, { url: '2', envelope: env(2) });
    rel.settle(3, { url: '3', envelope: env(3) });
    expect(seen).toEqual([1]);
  });

  it('never emits the same position twice', async () => {
    const { rel, seen } = await run();
    rel.settle(1, { url: '1', envelope: env(1) });
    rel.settle(1, { url: '1', envelope: env(1) });
    rel.settle(2, { url: '2', envelope: env(2) });
    expect(seen).toEqual([1, 2]);
  });
});

describe('a queue reset abandons work in flight', () => {
  it('stops an ordered release that was writing to the old queue', async () => {
    /*
     * The skip case, end to end in miniature. Playing a track resets the native queue, and the
     * prefetch run for the position just left is still resolving. Its results used to land after
     * the reset, into a queue rebuilt at a different position, in completion order. On device that
     * left the player holding positions 0, 4, 2, 5, 3, 1.
     */
    const { createOrderedRelease } = await import('./trackPrefetch');
    const { abandonNativeQueueWrites, currentNativeQueueWriteGeneration, nativeQueueWritesSuperseded } =
      await import('./nativeQueueWrites');

    const token = currentNativeQueueWriteGeneration();
    const seen: number[] = [];
    const rel = createOrderedRelease([1, 2, 3], (url) => seen.push(Number(url)), () =>
      nativeQueueWritesSuperseded(token),
    );

    rel.settle(1, { url: '1', envelope: { envelopeId: 't1' } as MediaEnvelope });
    expect(seen).toEqual([1]);

    abandonNativeQueueWrites();
    rel.settle(2, { url: '2', envelope: { envelopeId: 't2' } as MediaEnvelope });
    rel.settle(3, { url: '3', envelope: { envelopeId: 't3' } as MediaEnvelope });
    expect(seen).toEqual([1]);
  });

  it('lets a run started after the reset write normally', async () => {
    const { createOrderedRelease } = await import('./trackPrefetch');
    const { abandonNativeQueueWrites, currentNativeQueueWriteGeneration, nativeQueueWritesSuperseded } =
      await import('./nativeQueueWrites');

    abandonNativeQueueWrites();
    const token = currentNativeQueueWriteGeneration();
    const seen: number[] = [];
    const rel = createOrderedRelease([1, 2], (url) => seen.push(Number(url)), () =>
      nativeQueueWritesSuperseded(token),
    );
    rel.settle(2, { url: '2', envelope: { envelopeId: 't2' } as MediaEnvelope });
    rel.settle(1, { url: '1', envelope: { envelopeId: 't1' } as MediaEnvelope });
    expect(seen).toEqual([1, 2]);
  });
});
