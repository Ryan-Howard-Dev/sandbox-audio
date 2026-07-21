/**
 * Serial download queue — one active album/job at a time; additional jobs stay queued.
 */

import {
  getDownloadJobs,
  isDownloadJobActivelyRunning,
  patchDownloadJob,
  subscribeDownloadQueue,
  type DownloadJob,
  type DownloadJobStatus,
} from './downloadQueue';
import {
  DOWNLOAD_BATTERY_PAUSE_MESSAGE,
  shouldPauseDownloadsForBattery,
  subscribeDownloadBattery,
} from './downloadBatteryGate';
import { syncDownloadForegroundState } from './downloadForeground';

export { DOWNLOAD_BATTERY_PAUSE_MESSAGE };

type JobRunner = () => Promise<void>;
const pendingRunners = new Map<string, JobRunner>();
const acquiringJobIds = new Set<string>();
const orphanResumeRequested = new Set<string>();
let draining = false;

export function isDownloadJobAcquiring(jobId: string): boolean {
  return acquiringJobIds.has(jobId);
}

export function beginDownloadJobAcquire(jobId?: string): () => void {
  if (!jobId) return () => undefined;
  acquiringJobIds.add(jobId);
  return () => {
    acquiringJobIds.delete(jobId);
  };
}

function hasRunningDownloadJob(): boolean {
  return getDownloadJobs().some(
    (j) =>
      acquiringJobIds.has(j.id) ||
      j.status === 'resolving' ||
      j.status === 'downloading' ||
      j.status === 'metadata',
  );
}

function pickNextQueuedJob(): DownloadJob | undefined {
  const all = getDownloadJobs();
  const queued = all.filter((j) => j.status === 'queued');
  if (queued.length === 0) return undefined;
  return queued.sort((a, b) => {
    if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt;
    return all.indexOf(b) - all.indexOf(a);
  })[0];
}

function pauseJobForBattery(job: DownloadJob): void {
  const tracks = { ...job.tracks };
  for (const [trackId, state] of Object.entries(tracks)) {
    if (
      state.status === 'resolving' ||
      state.status === 'downloading' ||
      state.status === 'metadata'
    ) {
      tracks[trackId] = { ...state, status: 'pending', percent: 0, errorMessage: undefined };
    }
  }
  patchDownloadJob(job.id, {
    status: 'paused' as DownloadJobStatus,
    error: DOWNLOAD_BATTERY_PAUSE_MESSAGE,
    currentTrack: undefined,
    tracks,
  });
}

function pauseActiveJobsForBattery(): void {
  for (const job of getDownloadJobs()) {
    if (job.status === 'queued') {
      patchDownloadJob(job.id, {
        status: 'paused',
        error: DOWNLOAD_BATTERY_PAUSE_MESSAGE,
      });
      continue;
    }
    if (isDownloadJobActivelyRunning(job) || isDownloadJobAcquiring(job.id)) {
      pauseJobForBattery(job);
    }
  }
}

function resumeBatteryPausedJobs(): void {
  let changed = false;
  for (const job of getDownloadJobs()) {
    if (job.status !== 'paused') continue;
    if (job.error !== DOWNLOAD_BATTERY_PAUSE_MESSAGE) continue;
    patchDownloadJob(job.id, { status: 'queued', error: undefined });
    changed = true;
  }
  if (changed) void drainDownloadQueue();
}

/** Register work for a queued job and try to start it when the runner is idle. */
export function scheduleDownloadJob(jobId: string, run: JobRunner): void {
  pendingRunners.set(jobId, run);
  void drainDownloadQueue();
}

export async function drainDownloadQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      if (await shouldPauseDownloadsForBattery()) {
        pauseActiveJobsForBattery();
        return;
      }

      if (hasRunningDownloadJob()) return;

      const next = pickNextQueuedJob();
      if (!next) return;

      const run = pendingRunners.get(next.id);
      if (!run) {
        if (!orphanResumeRequested.has(next.id)) {
          orphanResumeRequested.add(next.id);
          const { resumeOrphanQueuedDownloadJob } = await import('./acquisitionPipeline');
          await resumeOrphanQueuedDownloadJob(next.id);
          continue;
        }
        return;
      }

      pendingRunners.delete(next.id);
      try {
        await run();
      } catch (err) {
        const live = getDownloadJobs().find((j) => j.id === next.id);
        if (
          live &&
          (live.status === 'resolving' ||
            live.status === 'downloading' ||
            live.status === 'metadata')
        ) {
          patchDownloadJob(next.id, { status: 'error', error: String(err) });
        }
      }
    }
  } finally {
    draining = false;
  }
}

/** After any job finishes — start the next queued download if battery allows. */
export function notifyDownloadJobFinished(_jobId?: string): void {
  void drainDownloadQueue();
}

/** True when a new album download should enqueue instead of starting immediately. */
export function isDownloadRunnerBusy(): boolean {
  return hasRunningDownloadJob() || draining;
}

/** Test-only reset for runner module state. */
export function resetDownloadQueueRunnerStateForTests(): void {
  pendingRunners.clear();
  acquiringJobIds.clear();
  orphanResumeRequested.clear();
  draining = false;
}

function isForegroundRelevantJob(job: DownloadJob): boolean {
  return (
    job.status === 'queued' ||
    job.status === 'resolving' ||
    job.status === 'downloading' ||
    job.status === 'metadata'
  );
}

function syncAndroidDownloadForeground(): void {
  const active = getDownloadJobs().filter(isForegroundRelevantJob);
  if (active.length === 0) {
    void syncDownloadForegroundState({ active: false });
    return;
  }

  const running =
    active.find(
      (job) =>
        job.status === 'resolving' ||
        job.status === 'downloading' ||
        job.status === 'metadata',
    ) ?? active[0];

  void syncDownloadForegroundState({
    active: true,
    title: running.label,
    completedTracks: active.reduce((sum, job) => sum + job.completedTracks, 0),
    totalTracks: active.reduce((sum, job) => sum + job.totalTracks, 0),
    queueCount: active.length,
  });
}

if (typeof window !== 'undefined') {
  subscribeDownloadQueue(() => {
    syncAndroidDownloadForeground();
  });

  // Native DownloadForegroundService posts this while backgrounded so the JS
  // queue keeps draining when Chromium freezes timers behind another app.
  window.addEventListener('sandbox-download-keepalive', () => {
    syncAndroidDownloadForeground();
    void drainDownloadQueue();
  });

  void import('@capacitor/app').then(({ App }) => {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void drainDownloadQueue();
        return;
      }
      // Leaving the app: re-assert FGS + WebView keepalive while jobs are active.
      syncAndroidDownloadForeground();
    });
  });

  subscribeDownloadBattery(() => {
    void (async () => {
      if (await shouldPauseDownloadsForBattery()) {
        pauseActiveJobsForBattery();
        return;
      }
      resumeBatteryPausedJobs();
    })();
  });
}
