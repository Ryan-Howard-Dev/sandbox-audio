import type { MediaEnvelope } from '../sandboxLayer1';
import type { RepeatMode } from '../queuePersistence';
import type { MixRadioSession } from '../playerMixRadio';

export type QueueAdvanceInput = {
  queueIndex: number;
  queueLength: number;
  repeatMode: RepeatMode;
  shuffleOn: boolean;
  /** Distinct envelopeIds in queue — repeat-all must not loop a lone track. */
  distinctTrackCount?: number;
  /**
   * Queue positions shuffle has already used this cycle. Without it every advance is an
   * independent draw, which is not what anybody means by shuffle — see below.
   */
  playedIndices?: readonly number[];
  random?: () => number;
};

export type QueueAdvanceResult =
  | { action: 'none' }
  | { action: 'repeat-one'; index: number }
  | { action: 'advance'; index: number }
  | { action: 'wrap'; index: number };

/**
 * Shuffle as a cycle: every position once, in a random order, before any of them comes round again.
 *
 * This used to be `Math.floor(random() * queueLength)` on every advance — an independent draw over
 * the whole queue, including the track that had just finished. That is not what shuffle means to
 * anybody using it. On a short radio queue it produced exactly the reported symptom: a track, then
 * another, then back to the first, then a third, then the first again, while other tracks in the
 * queue never played at all. Drawing the same index twice running also replayed a track instantly.
 *
 * So the positions already used are remembered and excluded. When the cycle is exhausted the queue
 * has genuinely been heard end to end, which is a real stopping point — it continues only on
 * repeat-all, and even then it will not open the new cycle with the track just heard.
 */
function computeShuffledNext(input: QueueAdvanceInput): QueueAdvanceResult {
  const { queueIndex, queueLength, repeatMode } = input;
  const rnd = input.random ?? Math.random;
  const pick = (pool: number[]): number => pool[Math.floor(rnd() * pool.length)]!;

  // Stale positions are dropped rather than trusted: the queue can shrink under a saved history,
  // and an out-of-range entry would silently shorten the cycle.
  const played = new Set(
    (input.playedIndices ?? []).filter((i) => i >= 0 && i < queueLength),
  );
  played.add(queueIndex);

  const all = Array.from({ length: queueLength }, (_, i) => i);
  const unplayed = all.filter((i) => !played.has(i));
  if (unplayed.length > 0) {
    return { action: 'advance', index: pick(unplayed) };
  }

  if (repeatMode !== 'all') return { action: 'none' };
  const distinct = input.distinctTrackCount ?? queueLength;
  if (distinct <= 1) return { action: 'none' };

  const fresh = all.filter((i) => i !== queueIndex);
  if (fresh.length === 0) return { action: 'none' };
  return { action: 'wrap', index: pick(fresh) };
}

/** Next index after track ended or skip-forward (deterministic; pass seeded random in tests). */
export function computeNextQueueIndex(input: QueueAdvanceInput): QueueAdvanceResult {
  const { queueIndex, queueLength, repeatMode, shuffleOn } = input;
  if (queueLength === 0) return { action: 'none' };

  if (repeatMode === 'one') {
    return { action: 'repeat-one', index: queueIndex };
  }

  if (shuffleOn && queueLength > 1) {
    return computeShuffledNext(input);
  }

  const next = queueIndex + 1;
  if (next >= queueLength) {
    if (repeatMode === 'all') {
      const distinct = input.distinctTrackCount ?? queueLength;
      if (distinct <= 1) return { action: 'none' };
      return { action: 'wrap', index: 0 };
    }
    return { action: 'none' };
  }

  return { action: 'advance', index: next };
}

/**
 * The shuffle cycle after an advance, for the caller that holds it between tracks.
 *
 * A wrap is the start of a new cycle, so the history is cleared rather than appended to — otherwise
 * the second cycle is exhausted immediately and shuffle stops one track in.
 */
export function recordShuffleAdvance(
  played: readonly number[],
  from: number,
  result: QueueAdvanceResult,
): number[] {
  if (result.action === 'wrap') return [result.index];
  if (result.action !== 'advance') return [...played];
  const next = new Set(played);
  next.add(from);
  next.add(result.index);
  return [...next];
}

export type SkipBackInput = {
  queueIndex: number;
  queueLength: number;
  currentTimeSeconds: number;
  restartThresholdSeconds?: number;
};

export function computeSkipBackIndex(input: SkipBackInput): number | 'seek-start' {
  const threshold = input.restartThresholdSeconds ?? 3;
  if (input.currentTimeSeconds > threshold) return 'seek-start';
  if (input.queueLength === 0) return 'seek-start';
  return input.queueIndex > 0 ? input.queueIndex - 1 : input.queueLength - 1;
}

export type MixRadioExtendInput = {
  mixSession: MixRadioSession | null;
  current: MediaEnvelope | null;
  queue: MediaEnvelope[];
  buildContinuation: (
    seed: MediaEnvelope,
    exclude: Set<string>,
    count: number,
  ) => MediaEnvelope[];
  continuationCount?: number;
};

export type MixRadioExtendResult =
  | { action: 'none' }
  | { action: 'extend'; tracks: MediaEnvelope[]; startIndex: number };

/** At queue end with mix/radio session — append continuation tracks. */
export function tryExtendMixRadioQueue(input: MixRadioExtendInput): MixRadioExtendResult {
  if (!input.mixSession || !input.current) return { action: 'none' };
  const exclude = new Set(input.queue.map((t) => t.envelopeId));
  const extra = input.buildContinuation(
    input.current,
    exclude,
    input.continuationCount ?? 3,
  );
  if (extra.length === 0) return { action: 'none' };
  return { action: 'extend', tracks: extra, startIndex: input.queue.length };
}
