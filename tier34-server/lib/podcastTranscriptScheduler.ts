/**
 * Cron-style Whisper transcription for mirrored podcast episodes.
 */

import { runPodcastTranscriptBatch, isPodcastWhisperEnabled } from './podcastTranscriptWorker.js';

let timer: ReturnType<typeof setInterval> | null = null;
let booted = false;

export function whisperIntervalMs(): number {
  const raw = process.env.PODCAST_WHISPER_INTERVAL_MS?.trim();
  const n = raw ? parseInt(raw, 10) : 30 * 60 * 1000;
  return Number.isFinite(n) && n >= 120_000 ? n : 30 * 60 * 1000;
}

export function initPodcastTranscriptScheduler(): void {
  if (booted) return;
  booted = true;
  if (!isPodcastWhisperEnabled()) {
    console.log('[tier34] podcast whisper disabled (PODCAST_WHISPER_ENABLED=0)');
    return;
  }
  const intervalMs = whisperIntervalMs();
  console.log(
    `[tier34] podcast whisper scheduler every ${Math.round(intervalMs / 60_000)} min — local transcripts on NAS`,
  );
  const run = () => {
    void runPodcastTranscriptBatch().then((results) => {
      const ok = results.filter((r) => r.ok).length;
      if (results.length > 0) {
        console.log(`[tier34] podcast whisper: ${ok}/${results.length} episode(s) transcribed`);
      }
    });
  };
  timer = setInterval(run, intervalMs);
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
  setTimeout(run, 45_000);
}
