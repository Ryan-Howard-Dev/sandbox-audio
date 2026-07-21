/**
 * One-tap acquire → play preview → locker when download completes.
 */

import { scheduleSearchHitDownload } from './acquisitionPipeline';
import {
  enqueueDownloadJob,
  getDownloadJobs,
  initJobTracks,
  subscribeDownloadQueue,
  type DownloadTierPreference,
} from './downloadQueue';
import { findLockerEntryForTrack, refreshLockerEntryPlayUrl } from './lockerStorage';
import { lockerEntryToEnvelope } from './smartPlaylistEngine';
import type { CandidateSource, MediaEnvelope } from './sandboxLayer1';
import type { ResolvedSearchHit } from './sandboxLayer2';
import {
  notifyAcquireProgress,
  dismissAcquireProgress,
} from './acquireProgressNotify';

export type AcquireAndPlayOptions = {
  tier: DownloadTierPreference;
  onPlay: (env: MediaEnvelope, candidates?: CandidateSource[]) => void;
  onToast?: (message: string) => void;
  /** Play catalog preview/stream immediately while acquire runs. Default true. */
  playPreviewFirst?: boolean;
};

function waitForJobDone(jobId: string, timeoutMs = 600_000): Promise<'done' | 'error'> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let pollTimer: number | null = null;

    const finish = (result: 'done' | 'error') => {
      if (pollTimer) clearTimeout(pollTimer);
      unsub();
      dismissAcquireProgress(jobId);
      resolve(result);
    };

    const check = () => {
      const job = getDownloadJobs().find((j) => j.id === jobId);
      if (!job) {
        finish('error');
        return;
      }
      notifyAcquireProgress(job);
      if (job.status === 'done') {
        finish('done');
        return;
      }
      if (job.status === 'error') {
        finish('error');
        return;
      }
      if (job.status === 'paused') {
        pollTimer = window.setTimeout(check, 800);
        return;
      }
      if (Date.now() > deadline) {
        finish('error');
        return;
      }
      pollTimer = window.setTimeout(check, 800);
    };

    const unsub = subscribeDownloadQueue(check);
    check();
  });
}

async function playFromLocker(title: string, artist: string): Promise<MediaEnvelope | null> {
  const entry = findLockerEntryForTrack(title, artist);
  if (!entry?.url?.trim()) return null;
  const url = (await refreshLockerEntryPlayUrl(entry.id)) ?? entry.url;
  return lockerEntryToEnvelope({ ...entry, url });
}

/** Acquire catalog hit to locker, play preview immediately, swap to locker URL when ready. */
export async function acquireAndPlayHit(
  hit: ResolvedSearchHit,
  options: AcquireAndPlayOptions,
): Promise<void> {
  const { tier, onPlay, onToast, playPreviewFirst = true } = options;
  const env = hit.primaryEnvelope;

  if (playPreviewFirst && env.url?.trim()) {
    onPlay(env, hit.sources);
    onToast?.(`Playing preview — saving "${env.title}" to locker…`);
  }

  const job = enqueueDownloadJob({
    label: env.title,
    artist: env.artist,
    mode: 'tracks',
    tier,
    totalTracks: 1,
  });
  initJobTracks(job.id, [{ id: env.envelopeId, title: env.title }]);
  notifyAcquireProgress(job);

  try {
    scheduleSearchHitDownload(env, tier, job.id, hit.sources);
    const outcome = await waitForJobDone(job.id);
    if (outcome === 'done') {
      const lockerEnv = await playFromLocker(env.title, env.artist);
      if (lockerEnv) {
        onPlay(lockerEnv);
        onToast?.(`"${env.title}" saved — now playing from locker (offline).`);
        return;
      }
      onToast?.(`"${env.title}" saved to locker.`);
      return;
    }
    onToast?.(`Could not save "${env.title}" — check Settings → Server.`);
  } catch (err) {
    dismissAcquireProgress(job.id);
    onToast?.(err instanceof Error ? err.message : String(err));
  }
}
