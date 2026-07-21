import { describe, expect, it } from 'vitest';
import type { MediaEnvelope } from '../sandboxLayer1';
import {
  countDistinctQueueEnvelopeIds,
  dedupeConsecutiveQueueEnvelopes,
  repeatAllAllowedForQueue,
} from './radioQueueDedupe';

function env(id: string, title: string): MediaEnvelope {
  return {
    envelopeId: id,
    title,
    artist: 'Artist',
    album: 'Album',
    url: 'content://locker/' + id,
    durationSeconds: 180,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: id,
  };
}

describe('radioQueueDedupe', () => {
  it('removes consecutive duplicate envelopeIds', () => {
    const a = env('a', 'A');
    const b = env('b', 'B');
    expect(dedupeConsecutiveQueueEnvelopes([a, a, b, b, b])).toEqual([a, b]);
  });

  it('counts distinct envelopeIds', () => {
    const queue = [env('a', 'A'), env('a', 'A'), env('b', 'B')];
    expect(countDistinctQueueEnvelopeIds(queue)).toBe(2);
  });

  it('disallows repeat-all for single distinct track', () => {
    expect(repeatAllAllowedForQueue([env('solo', 'Solo')])).toBe(false);
    expect(repeatAllAllowedForQueue([env('a', 'A'), env('b', 'B')])).toBe(true);
  });
});
