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
  random?: () => number;
};

export type QueueAdvanceResult =
  | { action: 'none' }
  | { action: 'repeat-one'; index: number }
  | { action: 'advance'; index: number }
  | { action: 'wrap'; index: number };

/** Next index after track ended or skip-forward (deterministic; pass seeded random in tests). */
export function computeNextQueueIndex(input: QueueAdvanceInput): QueueAdvanceResult {
  const { queueIndex, queueLength, repeatMode, shuffleOn } = input;
  if (queueLength === 0) return { action: 'none' };

  if (repeatMode === 'one') {
    return { action: 'repeat-one', index: queueIndex };
  }

  let next = queueIndex + 1;
  if (next >= queueLength) {
    if (repeatMode === 'all') {
      const distinct = input.distinctTrackCount ?? queueLength;
      if (distinct <= 1) return { action: 'none' };
      return { action: 'wrap', index: 0 };
    }
    return { action: 'none' };
  }

  if (shuffleOn && queueLength > 1) {
    const rnd = input.random ?? Math.random;
    next = Math.floor(rnd() * queueLength);
  }

  return { action: 'advance', index: next };
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
