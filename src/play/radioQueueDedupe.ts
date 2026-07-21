import type { MediaEnvelope } from '../sandboxLayer1';

/** Drop back-to-back duplicates — radio must never enqueue the same envelopeId twice in a row. */
export function dedupeConsecutiveQueueEnvelopes(queue: MediaEnvelope[]): MediaEnvelope[] {
  const out: MediaEnvelope[] = [];
  for (const track of queue) {
    const id = track.envelopeId?.trim();
    const prevId = out[out.length - 1]?.envelopeId?.trim();
    if (id && prevId && id === prevId) continue;
    out.push(track);
  }
  return out;
}

export function countDistinctQueueEnvelopeIds(queue: MediaEnvelope[]): number {
  const seen = new Set<string>();
  for (const track of queue) {
    const id = track.envelopeId?.trim();
    if (id) seen.add(id);
  }
  return seen.size;
}

/** Repeat-all is only meaningful with 2+ distinct tracks. */
export function repeatAllAllowedForQueue(queue: MediaEnvelope[]): boolean {
  return countDistinctQueueEnvelopeIds(queue) >= 2;
}
