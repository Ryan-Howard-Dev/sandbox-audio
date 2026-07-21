/**
 * Lightweight stem analyze — queue Demucs on tier34 without opening DJ Console.
 */

import {
  fetchStemUrlsForTrack,
  stemUrlsComplete,
  submitStemAnalyze,
  type StemAnalyzeJob,
} from './stemSeparation';

export type StemAnalyzeQueueResult =
  | { kind: 'already' }
  | { kind: 'queued'; jobId: string }
  | { kind: 'done'; job: StemAnalyzeJob };

export async function queueStemAnalyzeForLockerTrack(input: {
  trackId: string;
  title?: string;
  artist?: string;
}): Promise<StemAnalyzeQueueResult> {
  const trackId = input.trackId.trim();
  if (!trackId) throw new Error('Track id required for stem analysis.');

  const existing = await fetchStemUrlsForTrack(trackId).catch(() => null);
  if (existing && stemUrlsComplete(existing)) {
    return { kind: 'already' };
  }

  const jobId = await submitStemAnalyze({
    trackId,
    title: input.title,
    artist: input.artist,
  });
  return { kind: 'queued', jobId };
}
