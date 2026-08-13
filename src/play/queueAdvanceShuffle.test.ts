/**
 * Shuffle advance: every track once per cycle, in some order, and never the one just heard.
 *
 * These exist because the reported failure was not "shuffle picks a strange order" but "the same
 * track keeps coming back while others never play", which is what independent random draws look
 * like from the listener's chair. The cycle property is the thing worth pinning, so most of this
 * plays a queue all the way through rather than asserting a single index.
 */

import { describe, expect, it } from 'vitest';
import {
  computeNextQueueIndex,
  recordShuffleAdvance,
  type QueueAdvanceResult,
} from './queueAdvancePolicy';

/** A small LCG, so an order is arbitrary but the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Play a queue the way the shell does: advance, record, repeat. */
function playThrough(options: {
  queueLength: number;
  repeatMode: 'none' | 'all';
  seed: number;
  steps: number;
  startIndex?: number;
}): { visited: number[]; results: QueueAdvanceResult[] } {
  const random = seededRandom(options.seed);
  let index = options.startIndex ?? 0;
  let played: number[] = [];
  const visited = [index];
  const results: QueueAdvanceResult[] = [];

  for (let step = 0; step < options.steps; step += 1) {
    const result = computeNextQueueIndex({
      queueIndex: index,
      queueLength: options.queueLength,
      repeatMode: options.repeatMode,
      shuffleOn: true,
      distinctTrackCount: options.queueLength,
      playedIndices: played,
      random,
    });
    results.push(result);
    if (result.action === 'none') break;
    played = recordShuffleAdvance(played, index, result);
    index = (result as { index: number }).index;
    visited.push(index);
  }
  return { visited, results };
}

describe('shuffle advance', () => {
  it('never hands back the track that just played', () => {
    // The old draw was uniform over the whole queue, so it could return the current index and
    // replay a track the instant it finished.
    for (let seed = 1; seed <= 200; seed += 1) {
      const { visited } = playThrough({
        queueLength: 4,
        repeatMode: 'all',
        seed,
        steps: 12,
      });
      for (let i = 1; i < visited.length; i += 1) {
        expect(visited[i]).not.toBe(visited[i - 1]);
      }
    }
  });

  it('plays every position once before any of them comes round again', () => {
    const queueLength = 6;
    const { visited } = playThrough({
      queueLength,
      repeatMode: 'none',
      seed: 7,
      steps: queueLength - 1,
    });
    expect(visited).toHaveLength(queueLength);
    expect(new Set(visited).size).toBe(queueLength);
  });

  it('does not strand tracks the way the reported failure did', () => {
    /*
     * The symptom, in the shape it was described: a short queue that played one track, another,
     * back to the first, a third, then the first again. Whatever order comes out, three tracks
     * across three plays must be three different tracks.
     */
    const { visited } = playThrough({
      queueLength: 3,
      repeatMode: 'none',
      seed: 42,
      steps: 2,
    });
    expect(new Set(visited)).toEqual(new Set([0, 1, 2]));
  });

  it('stops at the end of a cycle when repeat is off', () => {
    const { results } = playThrough({
      queueLength: 3,
      repeatMode: 'none',
      seed: 3,
      steps: 5,
    });
    expect(results[results.length - 1]).toEqual({ action: 'none' });
    // Two advances for a queue of three, then the queue has genuinely been heard.
    expect(results.filter((r) => r.action === 'advance')).toHaveLength(2);
  });

  it('starts a fresh cycle on repeat-all without opening it on the track just heard', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const { visited, results } = playThrough({
        queueLength: 4,
        repeatMode: 'all',
        seed,
        steps: 4,
      });
      const wrapAt = results.findIndex((r) => r.action === 'wrap');
      expect(wrapAt).toBe(3);
      expect(visited[4]).not.toBe(visited[3]);
    }
  });

  it('will not loop a queue whose tracks are all the same envelope', () => {
    expect(
      computeNextQueueIndex({
        queueIndex: 1,
        queueLength: 2,
        repeatMode: 'all',
        shuffleOn: true,
        distinctTrackCount: 1,
        playedIndices: [0, 1],
        random: () => 0,
      }),
    ).toEqual({ action: 'none' });
  });

  it('ignores remembered positions that the queue no longer has', () => {
    // A queue can shrink under a saved cycle. Trusting the stale entries would mark tracks as
    // heard that are not even the same tracks, and shuffle would stop almost immediately.
    expect(
      computeNextQueueIndex({
        queueIndex: 0,
        queueLength: 2,
        repeatMode: 'none',
        shuffleOn: true,
        playedIndices: [5, 6, 7],
        random: () => 0,
      }),
    ).toEqual({ action: 'advance', index: 1 });
  });
});

describe('recordShuffleAdvance', () => {
  it('keeps both the track left and the track arrived at', () => {
    expect(recordShuffleAdvance([], 0, { action: 'advance', index: 2 })).toEqual([0, 2]);
  });

  it('does not record the same position twice', () => {
    expect(recordShuffleAdvance([0, 2], 2, { action: 'advance', index: 1 })).toEqual([0, 2, 1]);
  });

  it('clears on a wrap, because a wrap is the start of a new cycle', () => {
    // Appending here would leave the second cycle already exhausted, and shuffle would stop one
    // track into it.
    expect(recordShuffleAdvance([0, 1, 2], 2, { action: 'wrap', index: 1 })).toEqual([1]);
  });

  it('leaves the cycle alone when nothing advanced', () => {
    expect(recordShuffleAdvance([0, 1], 1, { action: 'none' })).toEqual([0, 1]);
  });
});
