/**
 * In-memory download job queue for catalog → locker acquisition.
 */

export type DownloadJobStatus =
  | 'queued'
  | 'paused'
  | 'resolving'
  | 'downloading'
  | 'metadata'
  | 'done'
  | 'error';

export type DownloadTierPreference = 'best' | 'proxy' | 'debrid';

export type DownloadMode = 'album' | 'tracks';

export type TrackDownloadStatus =
  | 'pending'
  | 'resolving'
  | 'downloading'
  | 'metadata'
  | 'done'
  | 'error'
  | 'skipped';

export interface TrackDownloadState {
  trackId: string;
  title: string;
  status: TrackDownloadStatus;
  percent: number;
  errorMessage?: string;
}

export interface DownloadJob {
  id: string;
  label: string;
  artist: string;
  albumTitle?: string;
  albumId?: string;
  mode: DownloadMode;
  tier: DownloadTierPreference;
  status: DownloadJobStatus;
  progress: number;
  currentTrack?: string;
  totalTracks: number;
  completedTracks: number;
  tracks: Record<string, TrackDownloadState>;
  error?: string;
  startedAt: number;
  /** Playlist import job — links UI to download queue. */
  playlistId?: string;
}

const TIER_PREF_KEY = 'sandbox-download-tier-pref';
const QUEUE_STORAGE_KEY = 'sandbox_download_queue_v1';

const OFFLINE_COPY_STALE_RE =
  /offline cop(?:y|ies) missing/i;

function isStaleOfflineCopyJob(job: DownloadJob): boolean {
  if (OFFLINE_COPY_STALE_RE.test(job.error ?? '')) return true;
  const states = Object.values(job.tracks ?? {});
  if (states.length === 0) return false;
  return states.every(
    (s) =>
      s.status === 'error' &&
      OFFLINE_COPY_STALE_RE.test(s.errorMessage ?? job.error ?? ''),
  );
}

let jobs: DownloadJob[] = loadPersistedJobs();
const listeners = new Set<() => void>();

function loadPersistedJobs(): DownloadJob[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DownloadJob[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (j) =>
          j &&
          typeof j.id === 'string' &&
          typeof j.label === 'string' &&
          typeof j.status === 'string' &&
          !isStaleOfflineCopyJob(j),
      )
      .map((j) => {
        const staleMs = 45 * 60 * 1000;
        const active =
          j.status === 'queued' ||
          j.status === 'paused' ||
          j.status === 'resolving' ||
          j.status === 'downloading' ||
          j.status === 'metadata';
        if (
          active &&
          Date.now() - (j.startedAt ?? 0) > staleMs &&
          (j.completedTracks ?? 0) === 0
        ) {
          return {
            ...j,
            status: 'error' as const,
            error: 'Download interrupted — tap Download to retry',
          };
        }
        return j;
      });
  } catch {
    return [];
  }
}

function persistJobs(): void {
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    /* quota or private mode */
  }
}

function notify(options?: { immediate?: boolean }): void {
  schedulePersistJobs();
  if (options?.immediate !== false) {
    flushNotifyListeners();
    return;
  }
  scheduleNotifyListeners();
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let notifyPending = false;

function schedulePersistJobs(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistJobs();
  }, 400);
}

function flushNotifyListeners(): void {
  notifyPending = false;
  if (notifyTimer !== null) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  listeners.forEach((fn) => fn());
}

function scheduleNotifyListeners(): void {
  notifyPending = true;
  if (notifyTimer !== null) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    if (notifyPending) flushNotifyListeners();
  }, 300);
}

function normKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Fuzzy match for album-list titles vs search/envelope titles (feat., truncation). */
export function trackTitleKeysMatch(a: string, b: string): boolean {
  const na = normKey(a).replace(/\s+/g, ' ');
  const nb = normKey(b).replace(/\s+/g, ' ');
  if (na === nb) return true;
  if (na.startsWith(nb) || nb.startsWith(na)) return true;
  const stripFeat = (s: string) =>
    s
      .replace(/\s*[\(\[](feat\.?|ft\.?|featuring)[^)\]]*[\)\]]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  const sa = stripFeat(na);
  const sb = stripFeat(nb);
  if (sa === sb) return true;
  return sa.startsWith(sb) || sb.startsWith(sa);
}

function artistKeysMatch(a: string, b: string): boolean {
  const ak = normKey(a);
  const bk = normKey(b);
  if (ak === bk) return true;
  const ap = ak.split(',')[0]?.trim() ?? ak;
  const bp = bk.split(',')[0]?.trim() ?? bk;
  return ap === bp || ak.includes(bp) || bk.includes(ap);
}

export function subscribeDownloadQueue(listener: () => void): () => void {
  pruneStaleActiveDownloadJobs();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDownloadJobs(): DownloadJob[] {
  return jobs;
}

export type DownloadJobErrorSummary = {
  id: string;
  label: string;
  artist: string;
  albumTitle?: string;
  status: DownloadJobStatus;
  jobError?: string;
  failedTracks: Array<{ title: string; error?: string }>;
};

/** Flatten errored download jobs for diagnostics / adb export. */
export function summarizeDownloadJobErrors(source?: DownloadJob[]): DownloadJobErrorSummary[] {
  const list = source ?? jobs;
  const out: DownloadJobErrorSummary[] = [];
  for (const job of list) {
    const failedTracks = Object.values(job.tracks ?? {}).filter((t) => t.status === 'error');
    if (job.status !== 'error' && failedTracks.length === 0) continue;
    out.push({
      id: job.id,
      label: job.label,
      artist: job.artist,
      albumTitle: job.albumTitle,
      status: job.status,
      jobError: job.error,
      failedTracks: failedTracks.map((t) => ({ title: t.title, error: t.errorMessage })),
    });
  }
  return out;
}

export function formatDownloadJobErrorsText(source?: DownloadJob[]): string {
  const errors = summarizeDownloadJobErrors(source);
  if (errors.length === 0) return 'No download errors in local queue.';
  return errors
    .map((job) => {
      const lines = [
        `${job.label} (${job.status})`,
        job.jobError ? `  job: ${job.jobError}` : null,
        ...job.failedTracks.map((t) => `  ${t.title}: ${t.error ?? 'unknown error'}`),
      ].filter(Boolean);
      return lines.join('\n');
    })
    .join('\n\n');
}

export function getActiveDownloadJobs(): DownloadJob[] {
  return jobs.filter((j) => j.status !== 'done' && j.status !== 'error');
}

export function findAlbumDownloadJob(
  artist: string,
  albumTitle: string,
  albumId?: string,
): DownloadJob | undefined {
  const artistKey = normKey(artist);
  const albumKey = normKey(albumTitle);
  return jobs.find((j) => {
    if (j.mode !== 'album' || !j.albumTitle) return false;
    if (normKey(j.artist) !== artistKey) return false;
    if (normKey(j.albumTitle) !== albumKey) return false;
    if (albumId && j.albumId && j.albumId !== albumId) return false;
    return true;
  });
}

export function findTrackDownloadJob(
  artist: string,
  trackTitle: string,
  trackId?: string,
): DownloadJob | undefined {
  return jobs.find((j) => {
    if (j.mode !== 'tracks') return false;
    if (trackId && j.tracks[trackId]) return true;
    const titleMatch =
      trackTitleKeysMatch(j.label, trackTitle) ||
      Object.values(j.tracks).some((t) => trackTitleKeysMatch(t.title, trackTitle));
    if (!titleMatch) return false;
    if (!artist.trim()) return true;
    return artistKeysMatch(j.artist, artist);
  });
}

export function loadDownloadTierPreference(): DownloadTierPreference {
  try {
    const raw = localStorage.getItem(TIER_PREF_KEY);
    if (raw === 'proxy' || raw === 'debrid' || raw === 'best') return raw;
  } catch {
    /* ignore */
  }
  return 'best';
}

export function saveDownloadTierPreference(tier: DownloadTierPreference): void {
  try {
    localStorage.setItem(TIER_PREF_KEY, tier);
  } catch {
    /* ignore */
  }
}

export function enqueueDownloadJob(
  partial: Pick<
    DownloadJob,
    'label' | 'artist' | 'albumTitle' | 'albumId' | 'mode' | 'tier' | 'totalTracks'
  > & { playlistId?: string },
): DownloadJob {
  const job: DownloadJob = {
    id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'queued',
    progress: 0,
    completedTracks: 0,
    tracks: {},
    startedAt: Date.now(),
    ...partial,
  };
  jobs = [job, ...jobs].slice(0, 12);
  notify();
  return job;
}

export function initJobTracks(
  jobId: string,
  catalogTracks: Array<{ id: string; title: string }>,
): void {
  const tracks: Record<string, TrackDownloadState> = {};
  for (const track of catalogTracks) {
    tracks[track.id] = {
      trackId: track.id,
      title: track.title,
      status: 'pending',
      percent: 0,
    };
  }
  patchDownloadJob(jobId, { tracks, totalTracks: catalogTracks.length });
}

/** Register a single track on a job (for large playlist downloads). */
export function ensureJobTrack(
  jobId: string,
  track: { id: string; title: string },
): void {
  const job = jobs.find((j) => j.id === jobId);
  if (!job || job.tracks[track.id]) return;
  patchDownloadJob(jobId, {
    tracks: {
      ...job.tracks,
      [track.id]: {
        trackId: track.id,
        title: track.title,
        status: 'pending',
        percent: 0,
      },
    },
  });
}

export function patchTrackDownload(
  jobId: string,
  trackId: string,
  patch: Partial<Pick<TrackDownloadState, 'status' | 'percent' | 'errorMessage'>>,
): void {
  jobs = jobs.map((j) => {
    if (j.id !== jobId) return j;
    const existing = j.tracks[trackId] ?? {
      trackId,
      title: j.currentTrack ?? j.label,
      status: 'pending' as const,
      percent: 0,
    };
    return {
      ...j,
      tracks: {
        ...j.tracks,
        [trackId]: { ...existing, ...patch },
      },
    };
  });
  const progressOnly =
    patch.percent !== undefined &&
    (patch.status === undefined ||
      patch.status === 'downloading' ||
      patch.status === 'resolving' ||
      patch.status === 'metadata') &&
    patch.errorMessage === undefined;
  notify({ immediate: !progressOnly });
}

export function patchDownloadJob(
  id: string,
  patch: Partial<Omit<DownloadJob, 'id'>>,
): void {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  const progressOnly = Object.keys(patch).every((key) =>
    key === 'progress' || key === 'completedTracks' || key === 'currentTrack',
  );
  notify({ immediate: !progressOnly });
}

export function clearFinishedDownloadJobs(): void {
  jobs = jobs.filter((j) => j.status !== 'done' && j.status !== 'error');
  notify();
}

export function removeDownloadJob(id: string): void {
  jobs = jobs.filter((j) => j.id !== id);
  notify();
}

const STALE_ACTIVE_JOB_MS = 25 * 60 * 1000;
const STALE_LOW_PROGRESS = 8;
const DOWNLOAD_RUNTIME_KEY = 'sandbox_download_runtime_active';
const PAUSED_DOWNLOAD_MESSAGE =
  'Download paused — resuming remaining tracks…';

export function isActiveDownloadJobStatus(status: DownloadJobStatus): boolean {
  return (
    status === 'queued' ||
    status === 'paused' ||
    status === 'resolving' ||
    status === 'downloading' ||
    status === 'metadata'
  );
}

function trackIsActivelyDownloading(state: TrackDownloadState): boolean {
  return (
    state.status === 'resolving' ||
    state.status === 'downloading' ||
    state.status === 'metadata'
  );
}

/** True when the job or any track is mid-acquisition — must not pause/revalidate. */
export function isDownloadJobActivelyRunning(job: DownloadJob): boolean {
  if (
    job.status === 'resolving' ||
    job.status === 'downloading' ||
    job.status === 'metadata'
  ) {
    return true;
  }
  return Object.values(job.tracks).some(trackIsActivelyDownloading);
}

function trackNeedsResume(state: TrackDownloadState): boolean {
  return state.status !== 'done' && state.status !== 'skipped';
}

/** Human-readable resume hint for the downloads sheet. */
export function describeDownloadJobResume(job: DownloadJob): string | undefined {
  const stats = computeAlbumDownloadProgress(job);
  if (stats.total <= 0) return undefined;
  if (stats.completed > 0 && stats.completed < stats.total) {
    return `${stats.completed} of ${stats.total} in locker — tap Retry for the rest`;
  }
  if (stats.failed > 0) {
    return `${stats.failed} track(s) failed`;
  }
  return undefined;
}

/** Full error text for UI — prefers first failed track message over truncated job summary. */
export function formatDownloadJobErrorDetail(job: DownloadJob): string {
  const failedTrack = Object.values(job.tracks).find(
    (t) => t.status === 'error' && (t.errorMessage?.trim() || t.title?.trim()),
  );
  if (failedTrack?.errorMessage?.trim()) {
    const title = failedTrack.title?.trim();
    const msg = failedTrack.errorMessage.trim();
    if (title && !msg.startsWith(title)) return `${title}: ${msg}`;
    return msg;
  }
  return job.error?.trim() || 'Download failed';
}

export type DownloadJobKind = 'album' | 'single' | 'tracks';

export interface DownloadJobDisplay {
  title: string;
  kind: DownloadJobKind;
  statusLine: string;
  detailLine?: string;
  progressPercent: number;
}

function resolveDownloadJobKind(job: DownloadJob, total: number): DownloadJobKind {
  if (job.mode === 'album') return 'album';
  if (total <= 1) return 'single';
  return 'tracks';
}

function resolveActiveTrackNumber(job: DownloadJob, stats: ReturnType<typeof computeAlbumDownloadProgress>): number | undefined {
  const total = stats.total > 0 ? stats.total : job.totalTracks;
  if (total <= 0) return undefined;
  const states = Object.values(job.tracks);
  const activeIdx = states.findIndex((s) =>
    s.status === 'resolving' || s.status === 'downloading' || s.status === 'metadata',
  );
  if (activeIdx >= 0) return activeIdx + 1;
  if (!job.currentTrack || stats.completed >= total) return undefined;
  return Math.min(stats.completed + 1, total);
}

/** Labels for the downloads activity sheet — album vs single vs multi-track. */
export function formatDownloadJobDisplay(job: DownloadJob): DownloadJobDisplay {
  const stats = computeAlbumDownloadProgress(job);
  const total = stats.total > 0 ? stats.total : job.totalTracks;
  const kind = resolveDownloadJobKind(job, total);
  const currentTrack = job.currentTrack?.trim();
  const trackNumber = resolveActiveTrackNumber(job, stats);

  if (kind === 'album') {
    const title = job.albumTitle?.trim() || job.label;
    let statusLine: string;
    if (job.status === 'queued') {
      statusLine = 'Queued';
    } else if (job.status === 'paused') {
      statusLine = job.error?.trim() || 'Paused';
    } else if (total > 0 && trackNumber) {
      statusLine = `Downloading album · track ${trackNumber}/${total}`;
    } else if (total > 0) {
      statusLine = `Downloading album · ${total} tracks`;
    } else {
      statusLine = 'Downloading album';
    }
    let detailLine: string | undefined;
    if (currentTrack === 'Resolving catalog…') {
      detailLine = currentTrack;
    } else if (currentTrack && trackNumber && total > 0) {
      detailLine = `Track ${trackNumber} of ${total}: ${currentTrack}`;
    } else if (currentTrack) {
      detailLine = currentTrack;
    }
    return {
      title,
      kind,
      statusLine,
      detailLine,
      progressPercent: stats.total > 0 ? stats.percent : job.progress,
    };
  }

  if (kind === 'single') {
    const statusLine =
      job.status === 'queued'
        ? 'Queued'
        : job.status === 'paused'
          ? job.error?.trim() || 'Paused'
          : 'Downloading single';
    const detailLine = currentTrack && currentTrack !== job.label ? currentTrack : job.artist?.trim() || undefined;
    return {
      title: job.label,
      kind,
      statusLine,
      detailLine,
      progressPercent: job.progress,
    };
  }

  const statusLine =
    job.status === 'queued'
      ? 'Queued'
      : job.status === 'paused'
        ? job.error?.trim() || 'Paused'
        : total > 0
          ? `Downloading tracks · ${stats.completed}/${total}`
          : 'Downloading tracks';
  const detailLine =
    currentTrack && currentTrack !== 'Resolving catalog…'
      ? currentTrack
      : currentTrack === 'Resolving catalog…'
        ? currentTrack
        : job.artist?.trim() || undefined;

  return {
    title: job.label,
    kind,
    statusLine,
    detailLine,
    progressPercent: stats.total > 0 ? stats.percent : job.progress,
  };
}

/**
 * On cold app start, active jobs cannot still be running — mark them paused so Retry works.
 * Uses sessionStorage so in-session navigation does not interrupt live downloads.
 */
export function reconcileOrphanedActiveJobsOnColdStart(): number {
  let sessionAlive = false;
  try {
    sessionAlive = sessionStorage.getItem(DOWNLOAD_RUNTIME_KEY) === '1';
    if (!sessionAlive) sessionStorage.setItem(DOWNLOAD_RUNTIME_KEY, '1');
  } catch {
    return 0;
  }
  if (sessionAlive) return 0;

  let changed = 0;
  jobs = jobs.map((j) => {
    if (!isActiveDownloadJobStatus(j.status)) return j;

    const tracks: Record<string, TrackDownloadState> = {};
    for (const [trackId, state] of Object.entries(j.tracks)) {
      tracks[trackId] = trackNeedsResume(state)
        ? { ...state, status: 'pending', percent: 0, errorMessage: undefined }
        : state;
    }
    const draft = { ...j, tracks };
    const stats = computeAlbumDownloadProgress(draft);
    changed += 1;
    return {
      ...draft,
      status: 'error' as const,
      error: PAUSED_DOWNLOAD_MESSAGE,
      progress: stats.percent,
      completedTracks: stats.completed,
      currentTrack: undefined,
    };
  });
  if (changed > 0) notify({ immediate: true });
  return changed;
}

/** Mark long-stuck active jobs as failed so the download badge clears. */
export function pruneStaleActiveDownloadJobs(now = Date.now()): number {
  let pruned = 0;
  jobs = jobs.map((j) => {
    if (!isActiveDownloadJobStatus(j.status)) {
      return j;
    }
    const age = now - (j.startedAt ?? now);
    if (age < STALE_ACTIVE_JOB_MS) return j;
    if (j.progress > STALE_LOW_PROGRESS) return j;
    pruned += 1;
    return {
      ...j,
      status: 'error' as const,
      error: 'Download timed out — dismiss or retry',
      currentTrack: undefined,
    };
  });
  if (pruned > 0) notify();
  return pruned;
}

/** Reset a failed or paused job for retry — keeps finished tracks, re-queues the rest. */
export function resetDownloadJobForRetry(id: string): DownloadJob | undefined {
  let found: DownloadJob | undefined;
  jobs = jobs.map((j) => {
    if (j.id !== id) return j;
    const tracks: Record<string, TrackDownloadState> = {};
    for (const [trackId, state] of Object.entries(j.tracks)) {
      tracks[trackId] = trackNeedsResume(state)
        ? { ...state, status: 'pending', percent: 0, errorMessage: undefined }
        : state;
    }
    const draft = {
      ...j,
      status: 'queued' as const,
      error: undefined,
      currentTrack: undefined,
      tracks,
    };
    const stats = computeAlbumDownloadProgress(draft);
    found = {
      ...draft,
      progress: stats.percent,
      completedTracks: stats.completed,
    };
    return found;
  });
  if (found) notify();
  return found;
}

export function resetTrackDownloadForRetry(jobId: string, trackId: string): void {
  jobs = jobs.map((j) => {
    if (j.id !== jobId) return j;
    const existing = j.tracks[trackId];
    if (!existing) return j;
    return {
      ...j,
      status: j.status === 'error' || j.status === 'paused' ? 'queued' : j.status,
      error: undefined,
      tracks: {
        ...j.tracks,
        [trackId]: {
          ...existing,
          status: 'pending',
          percent: 0,
          errorMessage: undefined,
        },
      },
    };
  });
  notify();
}

export function computeAlbumDownloadProgress(job: DownloadJob): {
  /** Tracks saved or skipped (already in locker). */
  completed: number;
  /** Tracks finished attempting (saved, skipped, or failed). */
  processed: number;
  failed: number;
  total: number;
  percent: number;
} {
  const states = Object.values(job.tracks);
  const total = states.length > 0 ? states.length : job.totalTracks;
  if (total <= 0) {
    return {
      completed: job.completedTracks,
      processed: job.completedTracks,
      failed: 0,
      total: 0,
      percent: job.progress,
    };
  }

  let completed = 0;
  let processed = 0;
  let failed = 0;
  let weighted = 0;
  for (const state of states) {
    if (state.status === 'done' || state.status === 'skipped') {
      completed += 1;
      processed += 1;
      weighted += 100;
    } else if (state.status === 'error') {
      processed += 1;
      failed += 1;
      weighted += 0;
    } else {
      weighted += state.percent;
    }
  }

  return {
    completed,
    processed,
    failed,
    total,
    percent: Math.min(100, Math.round(weighted / total)),
  };
}

/** Track ids still pending in any non-finished download job (for locker UI). */
export function getInProgressDownloadTrackIds(): Set<string> {
  const ids = new Set<string>();
  for (const job of jobs) {
    if (job.status === 'done') continue;
    for (const [trackId, state] of Object.entries(job.tracks)) {
      if (state.status !== 'done' && state.status !== 'skipped') {
        ids.add(trackId);
      }
    }
  }
  return ids;
}

/** Drop stale "done" flags when locker audio was hollow — keep job so Retry/auto-resume works. */
export async function revalidateDownloadQueueAgainstLocker(): Promise<number> {
  const {
    findLockerEntryForTrackIncludingHollow,
    findPlayableLockerEntryForTrack,
    lockerEntryHasRecoverableAudio,
  } = await import('./lockerStorage');
  let fixed = 0;
  const next: DownloadJob[] = [];

  for (const job of jobs) {
    // Never interrupt a live download — hollow checks run after the job finishes or pauses.
    if (isDownloadJobActivelyRunning(job)) {
      next.push(job);
      continue;
    }

    let hollowReset = false;
    const tracks: Record<string, TrackDownloadState> = {};
    for (const [trackId, state] of Object.entries(job.tracks)) {
      if (state.status !== 'done' && state.status !== 'skipped') {
        tracks[trackId] = state;
        continue;
      }
      const playable = await findPlayableLockerEntryForTrack(
        state.title,
        job.artist,
        job.albumTitle,
      );
      const hollow = findLockerEntryForTrackIncludingHollow(
        state.title,
        job.artist,
        job.albumTitle,
      );
      const recoverable =
        Boolean(playable) ||
        (hollow ? await lockerEntryHasRecoverableAudio(hollow.id) : false);
      if (!recoverable) {
        hollowReset = true;
        fixed += 1;
        tracks[trackId] = {
          ...state,
          status: 'pending',
          percent: 0,
          errorMessage: undefined,
        };
      } else {
        tracks[trackId] = state;
      }
    }

    if (isStaleOfflineCopyJob(job) && !hollowReset) {
      const anyDone = Object.values(tracks).some(
        (s) => s.status === 'done' || s.status === 'skipped',
      );
      if (!anyDone) {
        fixed += 1;
        continue;
      }
    }

    if (hollowReset) {
      const draft = { ...job, tracks, error: undefined };
      const stats = computeAlbumDownloadProgress(draft);
      next.push({
        ...draft,
        status: 'error',
        error: PAUSED_DOWNLOAD_MESSAGE,
        progress: stats.percent,
        completedTracks: stats.completed,
        currentTrack: undefined,
      });
    } else {
      next.push({ ...job, tracks });
    }
  }

  if (fixed > 0) {
    jobs = next;
    notify({ immediate: true });
  }
  return fixed;
}

/** Jobs that were paused on cold start / hollow revalidation and should auto-resume. */
export function listDownloadJobsNeedingResume(): DownloadJob[] {
  return jobs.filter((j) => {
    if (isDownloadJobActivelyRunning(j)) return false;
    if (j.status === 'paused') return false;
    if (j.status !== 'error' && j.status !== 'queued') return false;

    // Serial queue handles normal queued album/track jobs — only orphan queued jobs need resume.
    if (j.status === 'queued' && Object.keys(j.tracks).length > 0) return false;

    const paused =
      j.error === PAUSED_DOWNLOAD_MESSAGE ||
      j.error === 'Paused — charge device' ||
      /interrupted|timed out|paused/i.test(j.error ?? '');
    if (!paused && j.status !== 'queued') return false;
    const stats = computeAlbumDownloadProgress(j);
    return stats.completed < stats.total || stats.failed > 0 || Object.keys(j.tracks).length === 0;
  });
}

pruneStaleActiveDownloadJobs();
reconcileOrphanedActiveJobsOnColdStart();
