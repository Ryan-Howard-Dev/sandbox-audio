/**
 * Cron-style interval for podcast mirror pulls (Tier34 NAS air-gap prep).
 */

import { isPodcastMirrorEnabled, pullAllMirrorFeeds } from './podcastMirrorWorker.js';

let timer: ReturnType<typeof setInterval> | null = null;
let booted = false;

export function mirrorPullIntervalMs(): number {
  const raw = process.env.PODCAST_MIRROR_INTERVAL_MS?.trim();
  const n = raw ? parseInt(raw, 10) : 6 * 60 * 60 * 1000;
  return Number.isFinite(n) && n >= 60_000 ? n : 6 * 60 * 60 * 1000;
}

export function initPodcastMirrorScheduler(): void {
  if (booted) return;
  booted = true;
  if (!isPodcastMirrorEnabled()) {
    console.log('[tier34] podcast mirror disabled (PODCAST_MIRROR_ENABLED=0)');
    return;
  }
  const intervalMs = mirrorPullIntervalMs();
  console.log(
    `[tier34] podcast mirror scheduler every ${Math.round(intervalMs / 60_000)} min — LAN clients can play from NAS cache`,
  );
  const run = () => {
    void pullAllMirrorFeeds().then((results) => {
      const ok = results.filter((r) => r.ok).length;
      const dl = results.reduce((n, r) => n + r.downloaded, 0);
      if (results.length > 0) {
        console.log(`[tier34] podcast mirror pull: ${ok}/${results.length} feeds, ${dl} new episode(s)`);
      }
    });
  };
  timer = setInterval(run, intervalMs);
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
  setTimeout(run, 15_000);
}

export function stopPodcastMirrorScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  booted = false;
}
