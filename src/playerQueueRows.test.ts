import { describe, expect, it } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  buildPlayerQueueRows,
  resolvePlayerQueueCurrentIndex,
} from './playerQueueRows';

function env(id: string): MediaEnvelope {
  return {
    envelopeId: id,
    title: id,
    artist: 'A',
    url: '',
    provider: 'local-vault',
    transport: 'element-src',
    // MediaEnvelope requires both, and the cast without them does not compile. Queue rows never
    // read either field, so any value is fine — but the fixture has to be a real envelope, not a
    // shape that merely resembles one.
    durationSeconds: 0,
    sourceId: id,
  } as MediaEnvelope;
}

const queue = [env('a'), env('b'), env('c')];

describe('resolvePlayerQueueCurrentIndex', () => {
  it('prefers the engine envelope over a stale queue index', () => {
    expect(resolvePlayerQueueCurrentIndex(queue, 0, env('c'))).toBe(2);
  });

  it('marks nothing when the engine is playing something outside the queue', () => {
    expect(resolvePlayerQueueCurrentIndex(queue, 1, env('podcast'))).toBe(-1);
  });

  it('falls back to the queue index when no envelope is playing', () => {
    expect(resolvePlayerQueueCurrentIndex(queue, 1, null)).toBe(1);
  });

  it('marks nothing when the queue index is out of range', () => {
    expect(resolvePlayerQueueCurrentIndex(queue, 9, null)).toBe(-1);
    expect(resolvePlayerQueueCurrentIndex([], 0, null)).toBe(-1);
  });
});

describe('buildPlayerQueueRows', () => {
  it('keeps absolute queue positions so remove and reorder target the right track', () => {
    const rows = buildPlayerQueueRows(queue, 1, env('b'));
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.current)).toEqual([false, true, false]);
  });

  it('marks exactly one row', () => {
    const rows = buildPlayerQueueRows([...queue, env('a')], 0, env('a'));
    expect(rows.filter((r) => r.current)).toHaveLength(1);
  });
});
