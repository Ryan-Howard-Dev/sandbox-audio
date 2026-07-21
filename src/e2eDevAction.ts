/**
 * Debug / automation bridge — sandboxmusic://e2e/* deep links and Capacitor App URL events.
 * Logs `[SandboxE2E] AREA=<area> RESULT=PASS|FAIL ...` for adb logcat assertions.
 */

import { Capacitor } from '@capacitor/core';
import { markBootInteractiveFromAutomation } from './bootInteractivity';
import { releaseBootGateForE2e } from './bootInteractivity';

/** E2E bridge: Vite dev server or explicit SANDBOX_ANDROID_E2E=true builds only. */
export function isE2eBridgeEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  return typeof __SANDBOX_ANDROID_E2E__ !== 'undefined' && __SANDBOX_ANDROID_E2E__ === true;
}
import { detectTVPlatform } from './tvDetection';
import {
  getNativeExoPlaybackStatus,
  nativeExoPlayUrl,
  nativeExoResume,
  nativeExoStop,
  prepareNativeExoPlayback,
} from './androidNativePlayback';
import { nativeStatusMatchesEnvelope, effectiveNativeExoState, isNativeExoAudible } from './lastPlayIntent';
import { pickMobileExoPlayUrl, pickMobileExoPlayUrlAsync } from './nativeExoStreamResolver';
import {
  getEnabledMobileResolvers,
  getMobileResolvers,
  refreshYtDlpMobileStub,
  setMobileResolverEnabled,
} from './mobileResolverRegistry';
import {
  saveOnboardingComplete,
  saveServerSetupComplete,
} from './sandboxSettings';
import {
  refreshTier34Reachability,
  saveTier34BackendUrl,
  tier34FetchFeedResult,
  tier34HealthOk,
} from './tier34/client';
import { getYtDlpMobileStatus, resolveViaYtDlpMobile, waitForYtDlpInit } from './ytDlpMobile';
import { loadHeroDisplayMode, saveHeroDisplayMode, toggleHeroDisplayMode, type HeroDisplayMode } from './heroDisplaySettings';
import {
  clickHomeVinylToggleButton,
  probeHeroVisualFromDom,
  probeMiniPlayerBar,
  probeMobileHomeChrome,
  probeMobileVinylSettingsSheet,
  type HeroVisualProbe,
} from './homeHeroPlayerLogic';
import { getDownloadJobs, subscribeDownloadQueue, type DownloadJobStatus } from './downloadQueue';
import { clearStreamCache, getCachedStreamForTrack, isEnvelopeStreamCached } from './streamCache';
import { clearPlayUrlCache } from './playUrlCache';
import { clearUriResolutionCache } from './streamCache';
import { getLastResolvedSource } from './hybridResolution';
import { verifyLockerEntry } from './mobileAcquisition';
import {
  cancelAllActiveDownloadJobs,
  summarizeLockerAlbum,
} from './downloadLockerPrecheck';
import { loadPlaylists } from './playlistStorage';
import { LIKED_PLAYLIST_ID, LIKED_PLAYLIST_NAME } from './likedPlaylist';
import { getTrackTasteFeedback } from './tasteFeedback';
import {
  findLockerEntryForTrack,
  getLockerEntries,
  getLockerEntriesSnapshot,
  lockerEntryHasRecoverableAudio,
  lockerEntryIsPlayable,
  lockerTitleMatches,
  reconcileLockerBlobIntegrity,
  resolveLockerEnvelopeForPlayback,
  warmLockerNativePlaybackCache,
} from './lockerStorage';
import { applyThemePreset } from './engineTheme';
import { getThemePreset } from './themePresets';
import {
  loadVinylVisualSettings,
  saveVinylVisualSettings,
  MOBILE_VINYL_VISUAL_PRESETS,
  type MobileVinylVisualPresetId,
  type VinylVisualSettings,
} from './vinylVisualSettings';
import { savePodcastsEnabled } from './podcastSettings';
import { loadOfflinePodcastEpisodes } from './podcastOfflineEpisodes';
import { loadSubscriptions, removeSubscription } from './podcastStorage';
import { bumpPlayGeneration } from './playIntent';

export type E2ePlaybackProbe = {
  title: string;
  artist: string;
  album?: string;
  envelopeId?: string;
  state: string;
  positionSecs: number;
  durationSecs: number;
  artworkUrl?: string;
  nativeState?: string;
};

export type E2eNavTab = 'home' | 'locker' | 'discover' | 'search' | 'settings' | 'podcasts';

export type E2eHandlers = {
  runSearch?: (query: string) => Promise<number | void> | number | void;
  navigateTab?: (tab: E2eNavTab) => void;
  completeOnboarding?: () => void;
  getSearchHitCount?: () => number;
  /** Resolve + play via app pipeline so React player UI updates (title, mini player). */
  playMobileQuery?: (query: string) => Promise<boolean>;
  /** Search then play first catalog/streamable hit (UI tap path). */
  playSearchQuery?: (query: string, hitIndex?: number) => Promise<boolean>;
  /** Artist page tap path — play track by title from top tracks. */
  playArtistTrack?: (artist: string, trackTitle: string) => Promise<boolean>;
  /** Album drill tap path — play track by title from album listing. */
  playAlbumTrack?: (artist: string, album: string, trackTitle: string) => Promise<boolean>;
  /** Play N sequential tracks from an album (queue/advance). */
  playAlbumSequence?: (artist: string, album: string, count: number) => Promise<boolean>;
  /** Open album drill view via artist+album search. */
  openAlbum?: (artist: string, album: string) => Promise<boolean>;
  /** Open artist page from search (fast path for adb timing). */
  openSearchArtist?: (name: string) => boolean;
  /** Current album drill track list (after openAlbum). */
  listAlbumTracks?: () => { title: string; id: string }[];
  getPlaybackProbe?: () => E2ePlaybackProbe;
  toggleVinylMode?: () => HeroDisplayMode;
  setHeroDisplayMode?: (mode: HeroDisplayMode) => void;
  getHeroDisplayMode?: () => HeroDisplayMode;
  getHeroVisualProbe?: () => HeroVisualProbe;
  openMobileNowPlaying?: () => void;
  closeMobileNowPlaying?: () => void;
  openVinylSettingsSheet?: () => boolean;
  clickHomeVinylToggle?: () => boolean;
  pausePlayback?: () => void;
  resumePlayback?: () => void | Promise<void>;
  /** Download one catalog track to locker (mode=tracks|album). */
  downloadTrack?: (
    artist: string,
    title: string,
    mode?: 'tracks' | 'album',
    album?: string,
  ) => Promise<boolean>;
  /** Download full album to locker. */
  downloadAlbum?: (artist: string, album: string) => Promise<boolean>;
  /** Play from locker vault only (offline path). */
  playLockerTrack?: (artist: string, title: string, album?: string) => Promise<boolean>;
  /** Play sequential locker tracks (offline queue, no network). */
  playLockerSequence?: (artist: string, trackTitles: string[], album?: string) => Promise<boolean>;
  /** Play using the exact stored playlist row (same path as PlaylistsView tap). */
  playPlaylistTrack?: (playlistName: string, trackTitle: string) => Promise<boolean>;
  /** Inspect stored playlist track + locker linkage (device stress). */
  probePlaylistTrack?: (
    playlistName: string,
    trackTitle: string,
  ) => Promise<{
    found: boolean;
    provider?: string;
    sourceId?: string;
    lockerEntryId?: string;
    lockerPlayable?: boolean;
    envelopeId?: string;
  }>;
  /** Probe whether locker entry has persisted cover bytes. */
  probeLockerArt?: (artist: string, title: string, album?: string) => Promise<boolean>;
  /** Search global podcast catalog, subscribe if needed, play latest episode. */
  playPodcastQuery?: (query: string) => Promise<boolean>;
  /** Play a specific episode on a feed via HTTPS enclosure (optional online-only). */
  playPodcastEpisode?: (
    feedQuery: string,
    episodeQuery: string,
    options?: { online?: boolean },
  ) => Promise<boolean>;
  /** Play a downloaded podcast episode (stream cache only). */
  playOfflinePodcast?: (index?: number, titleQuery?: string) => Promise<boolean>;
  /** Subscribe/play latest episode online, then save to stream cache for offline. */
  cachePodcastQueryOffline?: (query: string) => Promise<boolean>;
  /** Re-sync JS playback envelope from native Exo after Android resume. */
  reconcileFromNativePlayback?: () => Promise<boolean>;
  /** Hardware / UI back stack (Android). */
  shellBack?: () => boolean;
  /** Fire the same thumbs-up handler as the media player (creates/updates Liked playlist). */
  thumbUpCurrent?: () => boolean;
  /** Fire the same thumbs-down handler as the media player. */
  thumbDownCurrent?: () => boolean;
  /** Clear queue/repeat/mix session after e2e probes (no pm clear). */
  resetPlaybackState?: () => void | Promise<void>;
};

const E2E_PREFIX = '[SandboxE2E]';
const YTDLP_INIT_TIMEOUT_MS = 90_000;
const EXO_PLAYBACK_TIMEOUT_MS = 120_000;
/** yt-dlp full download on emulator can exceed 2 min before Exo starts. */
const E2E_YTDLP_PLAY_WAIT_MS = 420_000;
const SEARCH_SETTLE_MS = 15_000;
const MAX_POSITION_REGRESSION_SECS = 2;

let handlers: E2eHandlers = {};

let e2eTail: Promise<unknown> = Promise.resolve();
let e2eDeepLinksInit: Promise<() => void> | null = null;
let e2eBridgeReady = false;
let e2eHandlersReady = false;
let e2ePlaybackHandlersLive = false;
const pendingE2eUrls: string[] = [];
let lastE2eUrlKey = '';
let lastE2eUrlAt = 0;

function flushPendingE2eUrls(): void {
  if (!e2eBridgeReady || !e2eHandlersReady) return;
  for (const url of pendingE2eUrls.splice(0)) {
    void handleE2eUrl(url);
  }
}

function hasE2ePlaybackHandlers(): boolean {
  return (
    typeof handlers.playLockerTrack === 'function' &&
    typeof handlers.getPlaybackProbe === 'function'
  );
}

function enqueueE2e<T>(fn: () => Promise<T>): Promise<T> {
  const run = e2eTail.then(fn);
  e2eTail = run.catch(() => {});
  return run;
}

export function registerE2eHandlers(next: E2eHandlers): void {
  if (!isE2eBridgeEnabled()) return;
  handlers = { ...handlers, ...next };
}

/** Flush queued deep links once E2E stubs or sandbox handlers are registered. */
export function markE2eHandlersReady(): void {
  if (!isE2eBridgeEnabled()) return;
  if (e2eHandlersReady) return;
  e2eHandlersReady = true;
  releaseBootGateForE2e();
  const playbackReady = hasE2ePlaybackHandlers();
  logE2e('handlers', playbackReady, playbackReady ? 'registered' : 'pending-playback');
  flushPendingE2eUrls();
}

/** Real playback handlers from sandboxLayer3 — probe-handlers waits for this. */
export function markE2ePlaybackHandlersLive(): void {
  if (!isE2eBridgeEnabled()) return;
  if (e2ePlaybackHandlersLive) return;
  e2ePlaybackHandlersLive = true;
  logE2e(
    'handlers-playback',
    hasE2ePlaybackHandlers(),
    hasE2ePlaybackHandlers() ? 'live' : 'missing',
  );
  flushPendingE2eUrls();
}

export function logE2e(area: string, pass: boolean, detail?: string): void {
  const result = pass ? 'PASS' : 'FAIL';
  const msg = detail ? `${E2E_PREFIX} AREA=${area} RESULT=${result} ${detail}` : `${E2E_PREFIX} AREA=${area} RESULT=${result}`;
  // console.warn — release WebView logcat drops console.log on device stress gates.
  console.warn(msg);
}

export function parseE2eUrl(raw: string): { action: string; params: URLSearchParams } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes('://') ? new URL(trimmed) : new URL(`sandboxmusic://${trimmed.replace(/^\/+/, '')}`);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/^\/+/, '');
    if (host !== 'e2e') return null;
    const action = path || url.host;
    if (!action || action === 'e2e') return null;
    return { action, params: url.searchParams };
  } catch {
    return null;
  }
}

async function waitForExoPlaying(timeoutMs = EXO_PLAYBACK_TIMEOUT_MS): Promise<{
  ok: boolean;
  state?: string;
  positionSecs?: number;
  queueLength?: number;
}> {
  let lastPos = 0;
  let resumeNudges = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getNativeExoPlaybackStatus();
    const pos = status.positionSecs ?? 0;
    const dur = status.durationSecs ?? 0;
    const playing = status.state === 'playing';
    if (playing && (pos > 0.5 || pos > lastPos + 0.1)) {
      return {
        ok: true,
        state: status.state,
        positionSecs: pos,
        queueLength: status.queueLength,
      };
    }
    if (playing && (status.queueLength ?? 0) >= 1) {
      await sleep(1500);
      const again = await getNativeExoPlaybackStatus();
      const againPos = again.positionSecs ?? 0;
      if (again.state === 'playing' && againPos > pos) {
        return {
          ok: true,
          state: again.state,
          positionSecs: againPos,
          queueLength: again.queueLength,
        };
      }
    }
    if (
      resumeNudges < 3 &&
      dur > 5 &&
      (status.state === 'loading' || status.state === 'paused' || status.state === 'idle') &&
      (status.queueLength ?? 0) >= 1
    ) {
      resumeNudges += 1;
      try {
        await nativeExoResume();
      } catch {
        /* optional */
      }
    }
    lastPos = pos;
    await sleep(750);
  }
  const final = await getNativeExoPlaybackStatus();
  const finalPos = final.positionSecs ?? 0;
  return {
    ok:
      final.state === 'playing' &&
      (final.queueLength ?? 0) >= 1 &&
      (finalPos > 0.3 || finalPos > lastPos),
    state: final.state,
    positionSecs: finalPos,
    queueLength: final.queueLength,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function e2eCombinedPlaybackProbe(): Promise<{
  ui: number;
  native: number;
  pos: number;
  dur: number;
  state: string;
  title: string;
}> {
  const probe = handlers.getPlaybackProbe?.();
  const status = await getNativeExoPlaybackStatus();
  const ui = probe?.positionSecs ?? 0;
  const native = status.positionSecs ?? 0;
  return {
    ui,
    native,
    pos: Math.max(ui, native),
    dur: Math.max(status.durationSecs ?? 0, probe?.durationSecs ?? 0),
    state: status.state ?? probe?.state ?? '',
    title: probe?.title?.trim() ?? '',
  };
}

async function e2eEnsureNowPlayingChrome(): Promise<boolean> {
  handlers.navigateTab?.('home');
  await sleep(400);
  handlers.openMobileNowPlaying?.();
  await sleep(900);
  return Boolean(document.querySelector('.home-progress-slider'));
}

/** Probe thumbs up/down selected UI (aria-pressed + filled orange active attrs). */
function probeThumbVisualFromDom(which: 'up' | 'down'): {
  found: boolean;
  pressed: boolean;
  activeAttr: boolean;
  filled: boolean;
} {
  if (typeof document === 'undefined') {
    return { found: false, pressed: false, activeAttr: false, filled: false };
  }
  const candidates = document.querySelectorAll(`[data-thumb="${which}"]`);
  let btn: Element | null = null;
  for (const candidate of candidates) {
    if (candidate instanceof HTMLElement && candidate.offsetParent !== null) {
      btn = candidate;
      break;
    }
  }
  if (!btn && candidates.length > 0) btn = candidates[0] ?? null;
  if (!btn) {
    return { found: false, pressed: false, activeAttr: false, filled: false };
  }
  const pressed = btn.getAttribute('aria-pressed') === 'true';
  const activeAttr = btn.getAttribute('data-thumb-active') === 'true';
  const svg = btn.querySelector('svg');
  const filled =
    Boolean(svg?.classList.contains('fill-current')) ||
    (svg?.getAttribute('fill') ?? '').toLowerCase() === 'currentcolor';
  return { found: true, pressed, activeAttr, filled };
}

function e2eScrubHomeSlider(pct: number): boolean {
  const slider = document.querySelector('.home-progress-slider');
  if (!(slider instanceof HTMLInputElement)) return false;
  slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  slider.value = String(pct);
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.dispatchEvent(new Event('change', { bubbles: true }));
  slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  return true;
}

async function e2eWaitForPlaybackPos(minPos: number, timeoutMs = 180_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let best = 0;
  while (Date.now() < deadline) {
    const snap = await e2eCombinedPlaybackProbe();
    best = Math.max(best, snap.pos);
    if (snap.pos >= minPos && (snap.state === 'playing' || handlers.getPlaybackProbe?.()?.state === 'Playing')) {
      return snap.pos;
    }
    await sleep(500);
  }
  return best;
}

async function waitForDownloadJobDone(
  jobId: string,
  timeoutMs = 600_000,
): Promise<{ ok: boolean; status: DownloadJobStatus; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const finish = (ok: boolean, status: DownloadJobStatus, error?: string) => {
      unsub();
      resolve({ ok, status, error });
    };
    const check = () => {
      const job = getDownloadJobs().find((j) => j.id === jobId);
      if (!job) {
        finish(false, 'error', 'job missing');
        return;
      }
      if (job.status === 'done') {
        finish(true, 'done');
        return;
      }
      if (job.status === 'error') {
        finish(false, 'error', job.error);
        return;
      }
      if (Date.now() > deadline) {
        finish(false, job.status, 'download timeout');
        return;
      }
      window.setTimeout(check, 800);
    };
    const unsub = subscribeDownloadQueue(check);
    check();
  });
}

function titlesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Truncated-stream heal restarts Exo near 0 while the same title keeps playing. */
function isHealInducedPositionReset(
  maxPos: number,
  pos: number,
  title: string,
  baselineTitle: string,
): boolean {
  if (maxPos <= 8 || pos > maxPos * 0.45) return false;
  if (!baselineTitle.trim() || !title.trim()) return false;
  if (!titlesMatch(title, baselineTitle)) return false;
  return maxPos - pos > MAX_POSITION_REGRESSION_SECS;
}

async function waitForPlaybackProgress(
  minAdvanceSecs: number,
  timeoutMs = 90_000,
): Promise<{
  ok: boolean;
  start: number;
  end: number;
  duration: number;
  uiEnd: number;
  monotonic: boolean;
  maxPos: number;
  regressionSecs: number;
}> {
  const deadline = Date.now() + timeoutMs;
  let start = -1;
  let end = 0;
  let duration = 0;
  let uiEnd = 0;
  let maxPos = 0;
  let regressionSecs = 0;
  let resumeNudges = 0;
  let baselineTitle = '';
  while (Date.now() < deadline) {
    const status = await getNativeExoPlaybackStatus();
    const pos = status.positionSecs ?? 0;
    duration = status.durationSecs ?? 0;
    const probe = handlers.getPlaybackProbe?.();
    if (probe) {
      uiEnd = probe.positionSecs;
      if (duration <= 0 && probe.durationSecs > 0) {
        duration = probe.durationSecs;
      }
    }
    const combined = Math.max(pos, uiEnd);
    if (combined > maxPos) {
      maxPos = combined;
    } else if (maxPos - combined > MAX_POSITION_REGRESSION_SECS) {
      const healReset = isHealInducedPositionReset(
        maxPos,
        combined,
        probe?.title ?? status.title ?? '',
        baselineTitle || probe?.title || status.title || '',
      );
      if (healReset) {
        maxPos = combined;
        if (start >= 0 && combined < start) start = combined;
      } else {
        regressionSecs = Math.max(regressionSecs, maxPos - combined);
        return {
          ok: false,
          start: Math.max(0, start),
          end: combined,
          duration,
          uiEnd,
          monotonic: false,
          maxPos,
          regressionSecs,
        };
      }
    }
    if (start < 0 && (isNativeExoAudible(status, maxPos) || pos > 0.15 || uiEnd > 0.15 || status.state === 'playing' || effectiveNativeExoState(status, maxPos) === 'playing')) {
      start = combined;
      maxPos = combined;
      baselineTitle = probe?.title?.trim() || status.title?.trim() || baselineTitle;
    }
    if (start >= 0) {
      end = combined;
      const effective = effectiveNativeExoState(status, maxPos);
      const advancingWhilePaused = status.state === 'paused' && combined > maxPos + 0.05;
      if (end >= start + minAdvanceSecs) {
        return {
          ok: true,
          start,
          end,
          duration,
          uiEnd,
          monotonic: regressionSecs <= MAX_POSITION_REGRESSION_SECS,
          maxPos,
          regressionSecs,
        };
      }
      if (
        (status.state === 'playing' || effective === 'playing' || advancingWhilePaused) &&
        end >= start + minAdvanceSecs * 0.85 &&
        duration >= 45
      ) {
        return {
          ok: true,
          start,
          end,
          duration,
          uiEnd,
          monotonic: regressionSecs <= MAX_POSITION_REGRESSION_SECS,
          maxPos,
          regressionSecs,
        };
      }
    }
    if (
      probe &&
      probe.durationSecs > 0 &&
      probe.positionSecs >= start + minAdvanceSecs &&
      start >= 0
    ) {
      return {
        ok: true,
        start,
        end: probe.positionSecs,
        duration: probe.durationSecs,
        uiEnd: probe.positionSecs,
        monotonic: regressionSecs <= MAX_POSITION_REGRESSION_SECS,
        maxPos: Math.max(maxPos, probe.positionSecs),
        regressionSecs,
      };
    }
    if (
      resumeNudges < 24 &&
      (status.state === 'paused' || status.state === 'idle' || status.state === 'loading') &&
      duration > 0
    ) {
      resumeNudges += 1;
      try {
        await nativeExoResume();
      } catch {
        /* optional */
      }
      await sleep(400);
    }
    await sleep(750);
  }
  return {
    ok: false,
    start: Math.max(0, start),
    end: Math.max(end, uiEnd),
    duration,
    uiEnd,
    monotonic: regressionSecs <= MAX_POSITION_REGRESSION_SECS,
    maxPos,
    regressionSecs,
  };
}

type StreamIntegritySample = {
  elapsedSecs: number;
  title: string;
  artist: string;
  envelopeId: string;
  nativeEnvelopeId: string;
  positionSecs: number;
  nativeState: string;
  uiState: string;
};

async function monitorStreamIntegrity(
  monitorSecs: number,
  expectedTitle?: string,
): Promise<{
  ok: boolean;
  samples: StreamIntegritySample[];
  failReason?: string;
  baselineEnvelopeId: string;
  baselineTitle: string;
}> {
  const intervalMs = 5000;
  const startTime = Date.now();
  const deadline = startTime + monitorSecs * 1000;
  const samples: StreamIntegritySample[] = [];
  let baselineEnvelopeId = '';
  let baselineTitle = '';
  let baselineArtist = '';
  let maxPos = 0;
  let failReason: string | undefined;

  while (Date.now() < deadline && !failReason) {
    const status = await getNativeExoPlaybackStatus();
    const probe = handlers.getPlaybackProbe?.();
    const title = probe?.title?.trim() ?? status.title?.trim() ?? '';
    const artist = probe?.artist?.trim() ?? status.artist?.trim() ?? '';
    const envelopeId = probe?.envelopeId?.trim() ?? '';
    const nativeEnvelopeId = status.envelopeId?.trim() ?? '';
    const pos = Math.max(status.positionSecs ?? 0, probe?.positionSecs ?? 0);
    const effectiveNativeState = effectiveNativeExoState(status, maxPos);
    const nativeState = status.state ?? 'unknown';
    const uiState = probe?.state ?? 'unknown';
    const elapsedSecs = Math.round((Date.now() - startTime) / 1000);

    if (!baselineTitle && title) {
      baselineTitle = title;
      baselineArtist = artist;
      baselineEnvelopeId = envelopeId || nativeEnvelopeId;
    }

    const sample: StreamIntegritySample = {
      elapsedSecs,
      title,
      artist,
      envelopeId,
      nativeEnvelopeId,
      positionSecs: pos,
      nativeState,
      uiState,
    };
    samples.push(sample);

    console.log(
      `${E2E_PREFIX} AREA=stream-integrity SAMPLE t=${elapsedSecs} title=${title} artist=${artist} envelopeId=${envelopeId || 'n/a'} nativeEnvelopeId=${nativeEnvelopeId || 'n/a'} pos=${pos.toFixed(1)} native=${nativeState} ui=${uiState}`,
    );

    if (expectedTitle && title && !titlesMatch(title, expectedTitle)) {
      failReason = `title-changed expected=${expectedTitle} actual=${title}`;
    } else if (baselineTitle && title && !titlesMatch(title, baselineTitle)) {
      failReason = `title-changed baseline=${baselineTitle} actual=${title}`;
    } else if (baselineArtist && artist && baselineArtist.toLowerCase() !== artist.toLowerCase()) {
      failReason = `artist-changed baseline=${baselineArtist} actual=${artist}`;
    } else if (
      baselineEnvelopeId &&
      envelopeId &&
      envelopeId !== baselineEnvelopeId
    ) {
      failReason = `ui-envelope-changed baseline=${baselineEnvelopeId} actual=${envelopeId}`;
    } else if (
      baselineEnvelopeId &&
      nativeEnvelopeId &&
      !nativeStatusMatchesEnvelope(status, baselineEnvelopeId)
    ) {
      failReason = `native-envelope-mismatch expected=${baselineEnvelopeId} native=${nativeEnvelopeId}`;
    } else if (pos > maxPos) {
      maxPos = pos;
    } else if (maxPos - pos > MAX_POSITION_REGRESSION_SECS) {
      if (isHealInducedPositionReset(maxPos, pos, title, baselineTitle)) {
        maxPos = pos;
      } else {
        failReason = `position-regression max=${maxPos.toFixed(1)} current=${pos.toFixed(1)} drop=${(maxPos - pos).toFixed(1)}`;
      }
    } else if (
      (effectiveNativeState === 'idle' || effectiveNativeState === 'error') &&
      !isNativeExoAudible(status, maxPos) &&
      pos < (status.durationSecs ?? probe?.durationSecs ?? 0) - 5 &&
      uiState !== 'Connecting' &&
      uiState !== 'Resolving' &&
      status.state !== 'loading'
    ) {
      failReason = `native-${effectiveNativeState}-mid-play pos=${pos.toFixed(1)}`;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }

  return {
    ok: !failReason && samples.length > 0 && Boolean(baselineTitle),
    samples,
    failReason,
    baselineEnvelopeId,
    baselineTitle,
  };
}

async function waitForPlayingState(timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let resumeNudges = 0;
  let lastPos = 0;
  while (Date.now() < deadline) {
    const probe = handlers.getPlaybackProbe?.();
    const status = await getNativeExoPlaybackStatus();
    const dur = Math.max(probe?.durationSecs ?? 0, status.durationSecs ?? 0);
    const pos = Math.max(probe?.positionSecs ?? 0, status.positionSecs ?? 0);
    const audible = isNativeExoAudible(status, lastPos);
    const uiPlaying =
      probe &&
      (probe.state === 'Playing' ||
        probe.state === 'Ready' ||
        probe.nativeState === 'playing');
    if ((audible || uiPlaying) && (dur > 0 || pos > 0.15 || (status.queueLength ?? 0) >= 1)) {
      if (
        resumeNudges < 6 &&
        (status.state === 'paused' || status.state === 'idle' || status.state === 'loading') &&
        dur > 0
      ) {
        resumeNudges += 1;
        try {
          await nativeExoResume();
        } catch {
          /* optional */
        }
        await sleep(500);
        lastPos = pos;
        continue;
      }
      if (status.state === 'playing' || (audible && pos > lastPos + 0.15)) return true;
      // Full yt-dlp stream loaded but OEM reports paused — accept advancing position.
      if (dur >= 45 && pos > 0.4 && pos > lastPos + 0.05) return true;
    }
    lastPos = pos;
    const playback = await waitForExoPlaying(3000);
    if (playback.ok) return true;
    await sleep(500);
  }
  return false;
}

function playbackTitleMatches(expected: string, probe?: E2ePlaybackProbe): boolean {
  if (!expected.trim()) return false;
  if (probe?.title && titlesMatch(probe.title, expected)) return true;
  return false;
}

async function playbackTitleMatchesAsync(expected: string): Promise<boolean> {
  const probe = handlers.getPlaybackProbe?.();
  if (playbackTitleMatches(expected, probe)) return true;
  const status = await getNativeExoPlaybackStatus();
  if (status.title?.trim() && titlesMatch(status.title, expected)) return true;
  return false;
}

function ensureYtDlpEnabled(): void {
  refreshYtDlpMobileStub();
  setMobileResolverEnabled('yt-dlp-mobile', true);
}

async function runStreamContinuityMonitors(
  trackTitle: string,
  params: URLSearchParams,
): Promise<{ progressOk: boolean; integrityOk: boolean }> {
  const progressSecs = Number(params.get('progressSeconds') ?? '0');
  const integritySecs = Number(params.get('integritySeconds') ?? '0');
  let progressOk = true;
  let integrityOk = true;

  if (Number.isFinite(progressSecs) && progressSecs > 0) {
    const result = await waitForPlaybackProgress(progressSecs, (progressSecs + 90) * 1000);
    const probe = handlers.getPlaybackProbe?.();
    const effectiveDur =
      result.duration > 0 ? result.duration : (probe?.durationSecs ?? 0);
    const advance = result.end - result.start;
    progressOk =
      result.ok &&
      result.monotonic &&
      advance >= progressSecs * 0.85 &&
      effectiveDur > 0;
    logE2e(
      'playback-progress',
      progressOk,
      `advance=${advance.toFixed(1)}s start=${result.start.toFixed(1)} end=${result.end.toFixed(1)} max=${result.maxPos.toFixed(1)} monotonic=${result.monotonic}${result.regressionSecs > 0 ? ` regression=${result.regressionSecs.toFixed(1)}s` : ''} dur=${effectiveDur.toFixed(1)} ui=${probe?.positionSecs?.toFixed(1) ?? 'n/a'}`,
    );
  }

  if (Number.isFinite(integritySecs) && integritySecs > 0) {
    const result = await monitorStreamIntegrity(integritySecs, trackTitle);
    const last = result.samples[result.samples.length - 1];
    integrityOk = result.ok;
    logE2e(
      'stream-integrity',
      integrityOk,
      integrityOk
        ? `seconds=${integritySecs} samples=${result.samples.length} title=${result.baselineTitle} envelopeId=${result.baselineEnvelopeId} endPos=${last?.positionSecs.toFixed(1) ?? '0'}`
        : `seconds=${integritySecs} reason=${result.failReason ?? 'no-baseline'} title=${result.baselineTitle || 'unknown'} envelopeId=${result.baselineEnvelopeId || 'n/a'}`,
    );
  }

  return { progressOk, integrityOk };
}

export async function handleE2eAction(action: string, params: URLSearchParams): Promise<boolean> {
  releaseBootGateForE2e();
  switch (action) {
    case 'skip-onboarding': {
      saveOnboardingComplete(true);
      saveServerSetupComplete(true);
      handlers.completeOnboarding?.();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('sandbox-e2e-onboarding-complete'));
      }
      logE2e('onboarding', true, 'skipped');
      return true;
    }
    case 'set-server': {
      const url = params.get('url')?.trim();
      if (!url) {
        logE2e('server-url', false, 'missing url param');
        return false;
      }
      saveTier34BackendUrl(url);
      const ok = await refreshTier34Reachability();
      logE2e('server-url', ok, `url=${url} reachable=${ok}`);
      return ok;
    }
    case 'clear-server': {
      saveTier34BackendUrl('');
      logE2e('server-url', true, 'cleared for mobile-only playback');
      return true;
    }
    case 'clear-playback-caches': {
      clearPlayUrlCache();
      clearUriResolutionCache();
      await clearStreamCache();
      if (params.get('podcasts') === '1' || params.get('podcasts') === 'true') {
        for (const sub of [...loadSubscriptions()]) {
          removeSubscription(sub.id);
        }
        logE2e('playback-caches', true, 'cleared play-url + stream caches + podcast library');
      } else {
        logE2e('playback-caches', true, 'cleared play-url + stream caches');
      }
      return true;
    }
    case 'probe-server': {
      const ok = await tier34HealthOk();
      logE2e('server-health', ok, `health=${ok}`);
      return ok;
    }
    case 'probe-feed': {
      const result = await tier34FetchFeedResult();
      const count = result.ok ? (result.items?.length ?? 0) : 0;
      const pass = result.ok && count > 0;
      logE2e(
        'discover-feed',
        pass,
        `ok=${result.ok} items=${count}${result.ok ? '' : ` error=${'error' in result ? result.error : 'unknown'}`}`,
      );
      return pass;
    }
    case 'check-ytdlp': {
      ensureYtDlpEnabled();
      const ready = await waitForYtDlpInit();
      const status = await getYtDlpMobileStatus();
      const enabled = getEnabledMobileResolvers().some((r) => r.id === 'yt-dlp-mobile');
      const pass = ready && enabled && status.available;
      if (ready) {
        console.log('[YtDlpMobile] init ready for E2E', {
          version: status.version ?? 'unknown',
          elapsedMs: 'see native logcat YtDlpMobile tag',
        });
      }
      logE2e(
        'ytdlp-mobile',
        pass,
        `initialized=${status.initialized} enabled=${enabled} version=${status.version ?? 'n/a'}`,
      );
      return pass;
    }
    case 'check-exo': {
      const status = await getNativeExoPlaybackStatus();
      const playing =
        status.state === 'playing' &&
        (status.queueLength ?? 0) >= 1 &&
        (status.positionSecs ?? 0) >= 0;
      const pass = status.available && status.wired && playing;
      logE2e(
        'exo-status',
        pass,
        `state=${status.state ?? 'unknown'} queueLength=${status.queueLength ?? 0} positionSecs=${status.positionSecs ?? 0}`,
      );
      return pass;
    }
    case 'probe-exo': {
      const status = await getNativeExoPlaybackStatus();
      const url = status.currentUrl?.trim() ?? '';
      const dur = status.durationSecs ?? 0;
      const pos = status.positionSecs ?? 0;
      const isFile = /^file:\/\//i.test(url);
      const isProxy = /local\/proxy|127\.0\.0\.1/i.test(url);
      logE2e(
        'exo-probe',
        true,
        `url=${url.slice(0, 160)} dur=${dur.toFixed(1)} pos=${pos.toFixed(1)} state=${status.state ?? 'unknown'} file=${isFile} proxy=${isProxy}`,
      );
      return true;
    }
    case 'verify-snippet-gate': {
      const minDur = Number(params.get('minDuration') ?? '90');
      const stableSecs = Number(params.get('stableSeconds') ?? '30');
      const pollMs = Number(params.get('pollMs') ?? '5000');
      const deadline = Date.now() + (Number(params.get('timeoutMs') ?? '180000') || 180_000);
      let stableSince = 0;
      let lastDur = 0;
      let lastUrl = '';
      while (Date.now() < deadline) {
        const status = await getNativeExoPlaybackStatus();
        const url = status.currentUrl?.trim() ?? '';
        const dur = status.durationSecs ?? 0;
        const isFile = /^file:\/\//i.test(url);
        const isProxy = /local\/proxy|127\.0\.0\.1/i.test(url);
        if (isFile) {
          logE2e(
            'snippet-gate',
            true,
            `mode=file url=${url.slice(0, 120)} dur=${dur.toFixed(1)} proxy=${isProxy}`,
          );
          return true;
        }
        if (dur >= minDur && !isProxy) {
          if (Math.abs(dur - lastDur) < 1 && url === lastUrl) {
            stableSince += pollMs;
          } else {
            stableSince = 0;
          }
          lastDur = dur;
          lastUrl = url;
          if (stableSince >= stableSecs * 1000) {
            logE2e(
              'snippet-gate',
              true,
              `mode=duration dur=${dur.toFixed(1)} stable=${stableSecs}s url=${url.slice(0, 80)}`,
            );
            return true;
          }
        } else {
          stableSince = 0;
          lastDur = dur;
          lastUrl = url;
        }
        await sleep(pollMs);
      }
      const final = await getNativeExoPlaybackStatus();
      const finalUrl = final.currentUrl?.trim() ?? '';
      const finalDur = final.durationSecs ?? 0;
      logE2e(
        'snippet-gate',
        false,
        `mode=timeout url=${finalUrl.slice(0, 120)} dur=${finalDur.toFixed(1)} minDur=${minDur} proxy=${/local\/proxy|127\.0\.0\.1/i.test(finalUrl)}`,
      );
      return false;
    }
    case 'navigate': {
      const tab = (params.get('tab') ?? 'home') as E2eNavTab;
      if (!handlers.navigateTab) {
        logE2e('navigation', false, 'navigateTab handler not registered');
        return false;
      }
      handlers.navigateTab(tab);
      await sleep(800);
      logE2e('navigation', true, `tab=${tab}`);
      return true;
    }
    case 'search': {
      const query = params.get('query')?.trim();
      if (!query || !handlers.runSearch) {
        logE2e('search', false, 'missing query or runSearch handler');
        return false;
      }
      handlers.navigateTab?.('search');
      await sleep(600);
      const outcome = await handlers.runSearch(query);
      await sleep(SEARCH_SETTLE_MS);
      const count =
        typeof outcome === 'number'
          ? outcome
          : (handlers.getSearchHitCount?.() ?? 0);
      const pass = count > 0;
      logE2e('search', pass, `query=${query} hits=${count}`);
      return pass;
    }
    case 'search-play': {
      const query = params.get('query')?.trim();
      const hitIndex = Number(params.get('index') ?? '0');
      const playTimeoutMs = Number(params.get('playTimeoutMs') ?? '300000');
      if (!query || !handlers.playSearchQuery) {
        logE2e('search-play', false, 'missing query or playSearchQuery handler');
        return false;
      }
      const started = await handlers.playSearchQuery(
        query,
        Number.isFinite(hitIndex) ? hitIndex : 0,
      );
      const playing = started || (await waitForPlayingState(playTimeoutMs));
      const probe = handlers.getPlaybackProbe?.();
      const status = await getNativeExoPlaybackStatus();
      const pos = Math.max(probe?.positionSecs ?? 0, status.positionSecs ?? 0);
      const pass =
        playing &&
        (pos > 0.2 ||
          status.state === 'playing' ||
          (status.queueLength ?? 0) >= 1);
      logE2e(
        'search-play',
        pass,
        `query=${query} index=${hitIndex} started=${started} playing=${playing} pos=${pos.toFixed(2)} state=${status.state ?? probe?.state ?? 'unknown'} via=catalog-pipeline`,
      );
      return pass;
    }
    case 'mobile-play': {
      const query = params.get('query')?.trim();
      if (!query) {
        logE2e('mobile-play', false, 'missing query param');
        return false;
      }
      if (handlers.playMobileQuery) {
        const pass = await handlers.playMobileQuery(query);
        logE2e('mobile-play', pass, `query=${query} via=app-pipeline`);
        return pass;
      }
      ensureYtDlpEnabled();
      const initOk = await waitForYtDlpInit();
      if (!initOk) {
        const st = await getYtDlpMobileStatus();
        logE2e('mobile-play', false, `ytdlp init timeout error=${st.error ?? 'none'}`);
        return false;
      }
      const resolved = await resolveViaYtDlpMobile(query);
      if (!resolved?.uri) {
        logE2e('mobile-play', false, `resolve failed query=${query}`);
        return false;
      }
      console.log('[YtDlpMobile] E2E resolve transport=MOBILE uriLen=' + resolved.uri.length);
      const prep = await prepareNativeExoPlayback();
      if (!prep.ok) {
        logE2e('mobile-play', false, `exo prepare failed: ${prep.message}`);
        return false;
      }
      const playUrl = await pickMobileExoPlayUrlAsync(resolved);
      await nativeExoPlayUrl(playUrl, { autoPlay: true, resetQueue: true });
      const playback = await waitForExoPlaying();
      const pass = playback.ok;
      logE2e(
        'mobile-play',
        pass,
        `query=${query} state=${playback.state ?? 'unknown'} queueLength=${playback.queueLength ?? 0} positionSecs=${playback.positionSecs ?? 0}`,
      );
      return pass;
    }
    case 'reset-playback': {
      bumpPlayGeneration();
      await nativeExoStop();
      await handlers.resetPlaybackState?.();
      logE2e('reset-playback', true, 'exo-stopped queue-cleared repeat=none');
      return true;
    }
    case 'stop-exo': {
      await nativeExoStop();
      logE2e('exo-stop', true, 'stopped');
      return true;
    }
    case 'cancel-play': {
      bumpPlayGeneration();
      await nativeExoStop();
      logE2e('cancel-play', true, 'cancelled');
      return true;
    }
    case 'enable-podcasts': {
      savePodcastsEnabled(true);
      logE2e('podcasts-enabled', true, 'on');
      return true;
    }
    case 'podcast-play': {
      const query = params.get('query')?.trim();
      if (!query || !handlers.playPodcastQuery) {
        logE2e('podcast-play', false, 'missing query or playPodcastQuery handler');
        return false;
      }
      savePodcastsEnabled(true);
      bumpPlayGeneration();
      await nativeExoStop();
      handlers.navigateTab?.('podcasts');
      await sleep(600);
      const played = await handlers.playPodcastQuery(query);
      if (!played) {
        logE2e('podcast-play', false, `query=${query} play=false`);
        return false;
      }
      const playWaitMs = Number(params.get('playTimeoutMs') ?? '180000');
      const ok = await waitForPlayingState(
        Number.isFinite(playWaitMs) && playWaitMs > 0 ? playWaitMs : 180_000,
      );
      logE2e('podcast-play', ok, `query=${query} playing=${ok}`);
      return ok;
    }
    case 'podcast-play-episode': {
      const feed = params.get('feed')?.trim();
      const episode = params.get('episode')?.trim();
      const online = params.get('online') !== '0';
      if (!feed || !episode || !handlers.playPodcastEpisode) {
        logE2e('podcast-play-episode', false, 'missing feed/episode or playPodcastEpisode handler');
        return false;
      }
      savePodcastsEnabled(true);
      bumpPlayGeneration();
      await nativeExoStop();
      handlers.navigateTab?.('podcasts');
      await sleep(600);
      const played = await handlers.playPodcastEpisode(feed, episode, { online });
      if (!played) {
        logE2e('podcast-play-episode', false, `feed=${feed} episode=${episode} play=false`);
        return false;
      }
      const playWaitMs = Number(params.get('playTimeoutMs') ?? '240000');
      const ok = await waitForPlayingState(
        Number.isFinite(playWaitMs) && playWaitMs > 0 ? playWaitMs : 240_000,
      );
      const probe = handlers.getPlaybackProbe?.();
      const urlHint = probe?.title ? ` title=${probe.title}` : '';
      logE2e(
        'podcast-play-episode',
        ok,
        `feed=${feed} episode=${episode} online=${online} playing=${ok}${urlHint}`,
      );
      return ok;
    }
    case 'probe-offline-podcasts': {
      const rows = loadOfflinePodcastEpisodes();
      const pass = rows.length > 0;
      const sample = rows
        .slice(0, 3)
        .map((r) => `${r.feedTitle}|${r.episode.title}`)
        .join('; ');
      logE2e(
        'probe-offline-podcasts',
        pass,
        pass
          ? `count=${rows.length} sample=${sample}`
          : 'count=0 no stream-cache podcast episodes',
      );
      return pass;
    }
    case 'play-offline-podcast': {
      const index = Number(params.get('index') ?? '0');
      const query = params.get('query')?.trim() || params.get('title')?.trim();
      if (!handlers.playOfflinePodcast) {
        logE2e('play-offline-podcast', false, 'missing playOfflinePodcast handler');
        return false;
      }
      savePodcastsEnabled(true);
      bumpPlayGeneration();
      await nativeExoStop();
      handlers.navigateTab?.('podcasts');
      await sleep(400);
      const played = await handlers.playOfflinePodcast(
        Number.isFinite(index) ? index : 0,
        query,
      );
      if (!played) {
        logE2e('play-offline-podcast', false, `index=${index} query=${query ?? 'none'} play=false`);
        return false;
      }
      const playWaitMs = Number(params.get('playTimeoutMs') ?? '180000');
      const ok = await waitForPlayingState(
        Number.isFinite(playWaitMs) && playWaitMs > 0 ? playWaitMs : 180_000,
      );
      const probe = handlers.getPlaybackProbe?.();
      logE2e(
        'play-offline-podcast',
        ok,
        `index=${index} query=${query ?? 'none'} playing=${ok} title=${probe?.title ?? 'unknown'}`,
      );
      return ok;
    }
    case 'cache-podcast-offline': {
      const query = params.get('query')?.trim();
      if (!query || !handlers.cachePodcastQueryOffline) {
        logE2e('cache-podcast-offline', false, 'missing query or cachePodcastQueryOffline handler');
        return false;
      }
      savePodcastsEnabled(true);
      const saved = await handlers.cachePodcastQueryOffline(query);
      const rows = loadOfflinePodcastEpisodes();
      logE2e(
        'cache-podcast-offline',
        saved && rows.length > 0,
        `query=${query} saved=${saved} offlineCount=${rows.length}`,
      );
      return saved && rows.length > 0;
    }
    case 'probe-bridge': {
      logE2e('bridge-probe', e2eBridgeReady, e2eBridgeReady ? 'active' : 'missing');
      return e2eBridgeReady;
    }
    case 'probe-handlers': {
      const ready =
        e2eBridgeReady && e2eHandlersReady && e2ePlaybackHandlersLive && hasE2ePlaybackHandlers();
      logE2e(
        'handlers-probe',
        ready,
        ready
          ? 'registered'
          : `pending bridge=${e2eBridgeReady} handlers=${e2eHandlersReady} live=${e2ePlaybackHandlersLive} playback=${hasE2ePlaybackHandlers()}`,
      );
      return ready;
    }
    case 'probe-tv-mode': {
      const tv = detectTVPlatform();
      logE2e('tv-mode', tv, `detectTVPlatform=${tv}`);
      return tv;
    }
    case 'play-artist-track': {
      const artist = params.get('artist')?.trim();
      const track = params.get('track')?.trim();
      if (!artist || !track || !handlers.playArtistTrack) {
        logE2e('artist-track-play', false, 'missing artist/track or handler');
        return false;
      }
      const played = await handlers.playArtistTrack(artist, track);
      if (!played) {
        logE2e('artist-track-play', false, `artist=${artist} track=${track} play=false`);
        return false;
      }
      const playWaitMs = Number(params.get('playTimeoutMs') ?? String(E2E_YTDLP_PLAY_WAIT_MS));
      const playWaitMsResolved =
        Number.isFinite(playWaitMs) && playWaitMs > 0 ? playWaitMs : E2E_YTDLP_PLAY_WAIT_MS;
      const playing = await waitForPlayingState(playWaitMsResolved);
      const probe = handlers.getPlaybackProbe?.();
      const status = await getNativeExoPlaybackStatus();
      const actualTitle = probe?.title?.trim() || status.title?.trim() || 'unknown';
      const titleOk = playing && (await playbackTitleMatchesAsync(track));
      const pass = playing && titleOk;
      logE2e(
        'artist-track-play',
        pass,
        `artist=${artist} expected=${track} actual=${actualTitle} playing=${playing} native=${status.state ?? 'unknown'} dur=${(status.durationSecs ?? 0).toFixed(1)}`,
      );
      if (!pass) return false;
      const monitors = await runStreamContinuityMonitors(track, params);
      return monitors.progressOk && monitors.integrityOk;
    }
    case 'play-album-track': {
      const artist = params.get('artist')?.trim();
      const album = params.get('album')?.trim();
      const track = params.get('track')?.trim();
      if (!artist || !album || !track || !handlers.playAlbumTrack) {
        logE2e('album-track-play', false, 'missing artist/album/track or handler');
        return false;
      }
      const played = await handlers.playAlbumTrack(artist, album, track);
      if (!played) {
        logE2e('album-track-play', false, `album=${album} track=${track} play=false`);
        return false;
      }
      const playWaitMs = Number(params.get('playTimeoutMs') ?? String(E2E_YTDLP_PLAY_WAIT_MS));
      const playWaitMsResolved =
        Number.isFinite(playWaitMs) && playWaitMs > 0 ? playWaitMs : E2E_YTDLP_PLAY_WAIT_MS;
      const playing = await waitForPlayingState(playWaitMsResolved);
      const probe = handlers.getPlaybackProbe?.();
      const status = await getNativeExoPlaybackStatus();
      const actualTitle = probe?.title?.trim() || status.title?.trim() || 'unknown';
      const titleOk = playing && (await playbackTitleMatchesAsync(track));
      const pass = playing && titleOk;
      logE2e(
        'album-track-play',
        pass,
        `album=${album} expected=${track} actual=${actualTitle} playing=${playing} native=${status.state ?? 'unknown'} dur=${(status.durationSecs ?? 0).toFixed(1)}`,
      );
      if (!pass) return false;
      const monitors = await runStreamContinuityMonitors(track, params);
      return monitors.progressOk && monitors.integrityOk;
    }
    case 'play-album-sequence': {
      const artist = params.get('artist')?.trim();
      const album = params.get('album')?.trim();
      const count = Number(params.get('count') ?? '3');
      if (!artist || !album || !handlers.playAlbumSequence) {
        logE2e('album-sequence', false, 'missing artist/album or handler');
        return false;
      }
      const pass = await handlers.playAlbumSequence(
        artist,
        album,
        Number.isFinite(count) && count > 0 ? count : 3,
      );
      const probe = handlers.getPlaybackProbe?.();
      logE2e(
        'album-sequence',
        pass,
        `artist=${artist} album=${album} count=${count} lastTitle=${probe?.title ?? 'none'}`,
      );
      return pass;
    }
    case 'open-album': {
      const artist = params.get('artist')?.trim();
      const album = params.get('album')?.trim();
      if (!artist || !album || !handlers.openAlbum) {
        logE2e('open-album', false, 'missing artist/album or handler');
        return false;
      }
      const pass = await handlers.openAlbum(artist, album);
      const tracks = handlers.listAlbumTracks?.() ?? [];
      logE2e(
        'open-album',
        pass && tracks.length > 0,
        `artist=${artist} album=${album} trackCount=${tracks.length}`,
      );
      return pass && tracks.length > 0;
    }
    case 'open-search-artist': {
      const name = params.get('name')?.trim() ?? params.get('artist')?.trim();
      if (!name || !handlers.openSearchArtist) {
        logE2e('open-search-artist', false, 'missing name or handler');
        return false;
      }
      const pass = handlers.openSearchArtist(name);
      logE2e('open-search-artist', pass, `name=${name}`);
      return pass;
    }
    case 'list-album-tracks': {
      const tracks = handlers.listAlbumTracks?.() ?? [];
      const titles = tracks.map((t) => t.title).join('|');
      const pass = tracks.length > 0;
      logE2e('album-tracks', pass, `count=${tracks.length} tracks=${titles}`);
      return pass;
    }
    case 'probe-playback': {
      const probe = handlers.getPlaybackProbe?.();
      if (!probe) {
        logE2e('playback-probe', false, 'no probe handler');
        return false;
      }
      const status = await getNativeExoPlaybackStatus();
      const pass = Boolean(probe.title?.trim());
      logE2e(
        'playback-probe',
        pass,
        `title=${probe.title} artist=${probe.artist} album=${probe.album ?? ''} state=${probe.state} pos=${probe.positionSecs.toFixed(1)} dur=${probe.durationSecs.toFixed(1)} native=${status.state ?? 'unknown'} queueLength=${status.queueLength ?? 0} queueIndex=${status.queueIndex ?? 0}`,
      );
      return pass;
    }
    case 'wait-progress': {
      const minSecs = Number(params.get('seconds') ?? '30');
      const target = Number.isFinite(minSecs) && minSecs > 0 ? minSecs : 30;
      for (let nudge = 0; nudge < 4; nudge += 1) {
        try {
          await nativeExoResume();
        } catch {
          /* optional */
        }
        await sleep(300);
      }
      const result = await waitForPlaybackProgress(target, (target + 75) * 1000);
      const probe = handlers.getPlaybackProbe?.();
      const effectiveDur =
        result.duration > 0 ? result.duration : (probe?.durationSecs ?? 0);
      const advance = result.end - result.start;
      const pass =
        result.ok &&
        result.monotonic &&
        advance >= target * 0.85 &&
        effectiveDur > 0;
      logE2e(
        'playback-progress',
        pass,
        `advance=${advance.toFixed(1)}s start=${result.start.toFixed(1)} end=${result.end.toFixed(1)} max=${result.maxPos.toFixed(1)} monotonic=${result.monotonic}${result.regressionSecs > 0 ? ` regression=${result.regressionSecs.toFixed(1)}s` : ''} dur=${effectiveDur.toFixed(1)} ui=${probe?.positionSecs?.toFixed(1) ?? 'n/a'}`,
      );
      return pass;
    }
    case 'stream-integrity': {
      const monitorSecs = Number(params.get('seconds') ?? '90');
      const target = Number.isFinite(monitorSecs) && monitorSecs > 0 ? monitorSecs : 90;
      const expectedTitle = params.get('title')?.trim() || undefined;
      const result = await monitorStreamIntegrity(target, expectedTitle);
      const last = result.samples[result.samples.length - 1];
      const pass = result.ok;
      logE2e(
        'stream-integrity',
        pass,
        pass
          ? `seconds=${target} samples=${result.samples.length} title=${result.baselineTitle} envelopeId=${result.baselineEnvelopeId} endPos=${last?.positionSecs.toFixed(1) ?? '0'}`
          : `seconds=${target} reason=${result.failReason ?? 'no-baseline'} title=${result.baselineTitle || 'unknown'} envelopeId=${result.baselineEnvelopeId || 'n/a'}`,
      );
      return pass;
    }
    case 'toggle-vinyl': {
      const useUi = params.get('via')?.trim() === 'ui';
      if (useUi) {
        const before = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
        const modeBefore = handlers.getHeroDisplayMode?.() ?? loadHeroDisplayMode();
        const clicked = handlers.clickHomeVinylToggle?.() ?? clickHomeVinylToggleButton();
        await sleep(450);
        const after = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
        const modeAfter = handlers.getHeroDisplayMode?.() ?? loadHeroDisplayMode();
        const expectedVisual =
          modeAfter === 'album-cover' && after.hasArt ? 'poster' : 'vinyl';
        const pass =
          clicked &&
          modeAfter !== modeBefore &&
          after.visual === expectedVisual &&
          after.visual !== before.visual;
        logE2e(
          'vinyl-toggle',
          pass,
          `via=ui before=${before.visual} after=${after.visual} mode=${modeBefore}->${modeAfter}`,
        );
        return pass;
      }
      const mode = handlers.toggleVinylMode?.() ?? toggleHeroDisplayMode();
      logE2e('vinyl-toggle', true, `mode=${mode}`);
      return true;
    }
    case 'toggle-vinyl-ui': {
      const before = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const modeBefore = handlers.getHeroDisplayMode?.() ?? loadHeroDisplayMode();
      const clicked = handlers.clickHomeVinylToggle?.() ?? clickHomeVinylToggleButton();
      if (!clicked) {
        logE2e('vinyl-toggle-ui', false, 'home-vinyl-settings-btn missing');
        return false;
      }
      await sleep(450);
      const after = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const modeAfter = handlers.getHeroDisplayMode?.() ?? loadHeroDisplayMode();
      const expectedVisual =
        modeAfter === 'album-cover' && after.hasArt ? 'poster' : 'vinyl';
      const pass =
        modeAfter !== modeBefore &&
        after.visual === expectedVisual &&
        after.visual !== before.visual;
      logE2e(
        'vinyl-toggle-ui',
        pass,
        `before=${before.visual} after=${after.visual} mode=${modeBefore}->${modeAfter}`,
      );
      return pass;
    }
    case 'playback-pause-resume': {
      const minPos = Math.max(3, Number(params.get('minPos') ?? '8'));
      const deadline = Date.now() + 180_000;
      let posBeforePause = 0;
      while (Date.now() < deadline) {
        const probe = handlers.getPlaybackProbe?.();
        posBeforePause = Math.max(
          probe?.positionSecs ?? 0,
          (await getNativeExoPlaybackStatus()).positionSecs ?? 0,
        );
        if (posBeforePause >= minPos) break;
        await sleep(500);
      }
      if (posBeforePause < minPos * 0.85) {
        logE2e(
          'playback-pause-resume',
          false,
          `minPos=${minPos} reached=${posBeforePause.toFixed(1)}`,
        );
        return false;
      }
      handlers.pausePlayback?.();
      await sleep(900);
      const pausedPos = handlers.getPlaybackProbe?.()?.positionSecs ?? posBeforePause;
      await handlers.resumePlayback?.();
      await sleep(1800);
      const after = Math.max(
        handlers.getPlaybackProbe?.()?.positionSecs ?? 0,
        (await getNativeExoPlaybackStatus()).positionSecs ?? 0,
      );
      const pass = after >= pausedPos - 2 && after >= minPos * 0.85;
      logE2e(
        'playback-pause-resume',
        pass,
        `pauseAt=${pausedPos.toFixed(1)} resumeAt=${after.toFixed(1)} minPos=${minPos}`,
      );
      return pass;
    }
    case 'playback-scrub-stress': {
      const minPos = Math.max(8, Number(params.get('minPos') ?? '10'));
      const cycles = Math.min(6, Math.max(1, Number(params.get('cycles') ?? '3')));
      const artist = params.get('artist')?.trim();
      const track = params.get('track')?.trim();
      const failures: string[] = [];

      if (artist && track && handlers.playArtistTrack) {
        const played = await handlers.playArtistTrack(artist, track);
        if (!played) {
          logE2e('playback-scrub-stress', false, 'playArtistTrack failed');
          return false;
        }
        await sleep(2500);
      }

      const reached = await e2eWaitForPlaybackPos(minPos);
      if (reached < minPos * 0.85) {
        logE2e(
          'playback-scrub-stress',
          false,
          `never reached minPos=${minPos} best=${reached.toFixed(1)}`,
        );
        return false;
      }

      handlers.navigateTab?.('home');
      await sleep(800);
      if (!(await e2eEnsureNowPlayingChrome())) {
        failures.push('now-playing-chrome-missing');
      }
      const titleAtStart = (await e2eCombinedPlaybackProbe()).title;

      handlers.pausePlayback?.();
      await sleep(1100);
      let paused = await e2eCombinedPlaybackProbe();
      if (paused.state !== 'paused') {
        failures.push(`pause-hold-state=${paused.state}`);
      }
      if (paused.pos < minPos * 0.65) {
        failures.push(
          `pause-hold ui=${paused.ui.toFixed(1)} native=${paused.native.toFixed(1)} need>=${(minPos * 0.65).toFixed(1)}`,
        );
      }

      const scrubCheck = async (pct: number, label: string) => {
        const uiDur = handlers.getPlaybackProbe?.()?.durationSecs ?? paused.dur;
        const expected = (pct / 100) * uiDur;
        if (!e2eScrubHomeSlider(pct)) {
          failures.push(`${label}-no-slider`);
          return;
        }
        await sleep(1000);
        const snap = await e2eCombinedPlaybackProbe();
        if (uiDur > 0 && Math.abs(snap.pos - expected) > uiDur * 0.12) {
          failures.push(
            `${label} ui=${snap.ui.toFixed(1)} native=${snap.native.toFixed(1)} expected~=${expected.toFixed(1)} dur=${uiDur.toFixed(1)}`,
          );
        }
      };

      for (const pct of [20, 55, 12]) {
        await scrubCheck(pct, `scrub-paused-${pct}`);
      }

      await handlers.resumePlayback?.();
      await sleep(1400);
      const resumed = await e2eCombinedPlaybackProbe();
      if (resumed.pos < 8) {
        failures.push(`resume-low ui=${resumed.ui.toFixed(1)} native=${resumed.native.toFixed(1)}`);
      }

      for (let i = 0; i < cycles; i += 1) {
        handlers.pausePlayback?.();
        await sleep(450);
        const p = await e2eCombinedPlaybackProbe();
        if (p.dur > 30 && p.pos < 5) {
          failures.push(`rapid-pause-${i} ui=${p.ui.toFixed(1)} native=${p.native.toFixed(1)}`);
        }
        await handlers.resumePlayback?.();
        await sleep(650);
      }

      for (const pct of [35, 72, 48]) {
        const uiDur = handlers.getPlaybackProbe?.()?.durationSecs ?? resumed.dur;
        const expected = (pct / 100) * uiDur;
        if (!e2eScrubHomeSlider(pct)) {
          failures.push(`scrub-playing-${pct}-no-slider`);
          continue;
        }
        await sleep(1000);
        const snap = await e2eCombinedPlaybackProbe();
        if (uiDur > 0 && snap.pos < expected - uiDur * 0.14) {
          failures.push(
            `scrub-playing-${pct} ui=${snap.ui.toFixed(1)} native=${snap.native.toFixed(1)} expected~=${expected.toFixed(1)} dur=${uiDur.toFixed(1)}`,
          );
        }
      }

      const skipFwd = document.querySelector('[data-testid="home-hero-skip-forward"]');
      if (skipFwd instanceof HTMLElement) {
        const beforeSkip = await e2eCombinedPlaybackProbe();
        skipFwd.click();
        await sleep(5000);
        const afterSkip = await e2eCombinedPlaybackProbe();
        const titleChanged = afterSkip.title && afterSkip.title !== beforeSkip.title;
        const posResetOnly = afterSkip.pos < 8 && beforeSkip.pos > 20;
        if (!titleChanged && posResetOnly) {
          failures.push(
            `skip-forward title=${afterSkip.title || 'none'} pos=${afterSkip.pos.toFixed(1)}`,
          );
        }
      } else {
        failures.push('skip-forward-btn-missing');
      }

      const pass = failures.length === 0;
      logE2e(
        'playback-scrub-stress',
        pass,
        pass
          ? `cycles=${cycles} start=${titleAtStart} pauseHold=${paused.pos.toFixed(1)} resume=${resumed.pos.toFixed(1)}`
          : failures.join(' | '),
      );
      return pass;
    }
    case 'rapid-toggle-vinyl': {
      const count = Math.min(20, Math.max(1, Number(params.get('count') ?? '8')));
      const expectedFinal = params.get('final')?.trim();
      let mode = loadHeroDisplayMode();
      for (let i = 0; i < count; i += 1) {
        mode = handlers.toggleVinylMode?.() ?? toggleHeroDisplayMode();
        await sleep(40);
      }
      const stored = loadHeroDisplayMode();
      const modeMatch = stored === mode;
      const finalOk = !expectedFinal || stored === expectedFinal;
      const probe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const visualOk =
        stored === 'album-cover' && probe.hasArt
          ? probe.visual === 'poster'
          : stored === 'vinyl-shades'
            ? probe.visual === 'vinyl'
            : probe.visual !== 'none';
      const pass = modeMatch && finalOk;
      logE2e(
        'rapid-toggle-vinyl',
        pass,
        `toggles=${count} mode=${stored} visual=${probe.visual} modeMatch=${modeMatch} finalOk=${finalOk} visualOk=${visualOk}`,
      );
      return pass;
    }
    case 'toggle-vinyl-mid-play': {
      const before = await getNativeExoPlaybackStatus();
      const mode = handlers.toggleVinylMode?.() ?? toggleHeroDisplayMode();
      await sleep(350);
      const after = await getNativeExoPlaybackStatus();
      const probe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const stillPlaying =
        after.state === 'playing' ||
        (after.queueLength ?? 0) >= 1 ||
        after.state === 'paused' && (after.positionSecs ?? 0) > 0.2;
      const posOk = (after.positionSecs ?? 0) >= (before.positionSecs ?? 0) - 0.5;
      const pass = stillPlaying && posOk;
      logE2e(
        'toggle-mid-play',
        pass,
        `mode=${mode} visual=${probe.visual} state=${after.state ?? 'unknown'} pos=${(after.positionSecs ?? 0).toFixed(1)}`,
      );
      return pass;
    }
    case 'expand-now-playing': {
      handlers.openMobileNowPlaying?.();
      await sleep(700);
      const probe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const mode = loadHeroDisplayMode();
      const expectedVisual =
        mode === 'album-cover' && probe.hasArt ? 'poster' : mode === 'vinyl-shades' ? 'vinyl' : probe.visual;
      const pass = probe.expanded && (expectedVisual === 'none' || probe.visual === expectedVisual);
      logE2e(
        'expand-now-playing',
        pass,
        `expanded=${probe.expanded} visual=${probe.visual} mode=${mode} expected=${expectedVisual}`,
      );
      return pass;
    }
    case 'tap-mini-player': {
      const track = document.querySelector('.player-bar-track');
      if (!(track instanceof HTMLElement)) {
        logE2e('tap-mini-player', false, 'player-bar-track missing');
        return false;
      }
      track.click();
      await sleep(800);
      const probe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const chrome = probeMobileHomeChrome();
      const pass = probe.expanded || chrome.nowPlayingOpen || chrome.shellNowPlayingClass;
      logE2e(
        'tap-mini-player',
        pass,
        `expanded=${probe.expanded} shellNp=${chrome.shellNowPlayingClass} nowOpen=${chrome.nowPlayingOpen}`,
      );
      return pass;
    }
    case 'podcast-back-stress': {
      if (!loadSubscriptions().length && handlers.playPodcastQuery) {
        await handlers.playPodcastQuery('Joe Rogan Experience');
        await sleep(2500);
        handlers.closeMobileNowPlaying?.();
        handlers.pausePlayback?.();
        await sleep(600);
      }
      handlers.navigateTab?.('podcasts');
      await sleep(800);
      window.dispatchEvent(new CustomEvent('sandbox-e2e-podcast-drill', { detail: { phase: 'open-first-show' } }));
      await sleep(900);
      const backShow = handlers.shellBack?.() ?? false;
      await sleep(400);
      window.dispatchEvent(new CustomEvent('sandbox-e2e-podcast-drill', { detail: { phase: 'downloaded-tab' } }));
      await sleep(600);
      const backDownloaded = handlers.shellBack?.() ?? false;
      await sleep(400);
      window.dispatchEvent(new CustomEvent('sandbox-e2e-podcast-drill', { detail: { phase: 'discover-tab' } }));
      await sleep(600);
      const backDiscover = handlers.shellBack?.() ?? false;
      await sleep(400);
      handlers.openMobileNowPlaying?.();
      await sleep(700);
      const backNowPlaying = handlers.shellBack?.() ?? false;
      await sleep(1200);
      const probe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const pass = backShow && backDownloaded && backDiscover && backNowPlaying && !probe.expanded;
      logE2e(
        'podcast-back-stress',
        pass,
        `show=${backShow} downloaded=${backDownloaded} discover=${backDiscover} np=${backNowPlaying} expanded=${probe.expanded}`,
      );
      return pass;
    }
    case 'collapse-now-playing': {
      handlers.closeMobileNowPlaying?.();
      await sleep(500);
      const probe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const pass = !probe.expanded;
      logE2e('collapse-now-playing', pass, `expanded=${probe.expanded} visual=${probe.visual}`);
      return pass;
    }
    case 'probe-hero-visual': {
      const expectedVisual = params.get('visual')?.trim();
      const probe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const pass = !expectedVisual || probe.visual === expectedVisual;
      logE2e(
        'hero-visual',
        pass,
        `visual=${probe.visual} expanded=${probe.expanded} settingsOpen=${probe.settingsOpen} hasArt=${probe.hasArt} expected=${expectedVisual ?? 'any'}`,
      );
      return pass;
    }
    case 'open-vinyl-settings': {
      const opened = handlers.openVinylSettingsSheet?.() ?? false;
      await sleep(400);
      const probe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const mode = loadHeroDisplayMode();
      const pass = opened && probe.settingsOpen;
      logE2e('vinyl-settings-open', pass, `open=${probe.settingsOpen} mode=${mode}`);
      return pass;
    }
    case 'tab-switch-stability': {
      const startStatus = await getNativeExoPlaybackStatus();
      const startPos = startStatus.positionSecs ?? 0;
      const tabs: E2eNavTab[] = ['search', 'home', 'search', 'home'];
      for (const tab of tabs) {
        handlers.navigateTab?.(tab);
        await sleep(900);
      }
      const after = await getNativeExoPlaybackStatus();
      const probe = handlers.getPlaybackProbe?.();
      const posOk = (after.positionSecs ?? 0) >= startPos - 0.5;
      const playing =
        after.state === 'playing' ||
        (after.queueLength ?? 0) >= 1 ||
        (probe?.nativeState === 'playing');
      const pass = playing && posOk;
      logE2e(
        'tab-switch-stability',
        pass,
        `start=${startPos.toFixed(1)} end=${(after.positionSecs ?? 0).toFixed(1)} title=${probe?.title ?? ''}`,
      );
      return pass;
    }
    case 'probe-mini-player': {
      const probe = probeMiniPlayerBar();
      const maxHeight = Number(params.get('maxHeightPx') ?? '100');
      const maxRatio = Number(params.get('maxViewportRatio') ?? '0.14');
      const pass =
        probe.present &&
        probe.onNonHomeStation &&
        probe.compact &&
        probe.heightPx <= maxHeight &&
        probe.viewportRatio <= maxRatio;
      logE2e(
        'mini-player',
        pass,
        `present=${probe.present} onNonHome=${probe.onNonHomeStation} compact=${probe.compact} heightPx=${probe.heightPx} ratio=${probe.viewportRatio.toFixed(3)} maxH=${maxHeight} maxRatio=${maxRatio}`,
      );
      return pass;
    }
    case 'playback-fraction': {
      const fraction = Math.min(0.98, Math.max(0.5, Number(params.get('fraction') ?? '0.88')));
      const timeoutMs = Number(params.get('timeoutMs') ?? String(600_000));
      const deadline = Date.now() + (Number.isFinite(timeoutMs) ? timeoutMs : 600_000);
      let targetDur = 0;
      let lastPos = 0;
      while (Date.now() < deadline) {
        const status = await getNativeExoPlaybackStatus();
        const uiProbe = handlers.getPlaybackProbe?.();
        const dur = Math.max(status.durationSecs ?? 0, uiProbe?.durationSecs ?? 0);
        const pos = Math.max(status.positionSecs ?? 0, uiProbe?.positionSecs ?? 0);
        if (dur >= 30) targetDur = dur;
        if (targetDur > 0 && pos >= targetDur * fraction - 2) {
          logE2e(
            'playback-fraction',
            true,
            `fraction=${fraction} pos=${pos.toFixed(1)} dur=${targetDur.toFixed(1)} native=${status.state ?? 'unknown'}`,
          );
          return true;
        }
        if (
          status.state === 'stopped' &&
          pos > 10 &&
          targetDur > 0 &&
          pos < targetDur * fraction - 8 &&
          pos <= lastPos + 0.05
        ) {
          logE2e(
            'playback-fraction',
            false,
            `stopped early pos=${pos.toFixed(1)} need=${(targetDur * fraction).toFixed(1)} dur=${targetDur.toFixed(1)}`,
          );
          return false;
        }
        lastPos = pos;
        await sleep(1000);
      }
      logE2e('playback-fraction', false, `timeout fraction=${fraction} lastDur=${targetDur.toFixed(1)}`);
      return false;
    }
    case 'home-vinyl-while-playing': {
      const minPos = Math.max(8, Number(params.get('minPos') ?? '12'));
      const deadline = Date.now() + 180_000;
      let startPos = 0;
      while (Date.now() < deadline) {
        const probe = handlers.getPlaybackProbe?.();
        const status = await getNativeExoPlaybackStatus();
        startPos = Math.max(probe?.positionSecs ?? 0, status.positionSecs ?? 0);
        if (startPos >= minPos && (status.state === 'playing' || probe?.state === 'Playing')) break;
        await sleep(500);
      }
      if (startPos < minPos * 0.85) {
        logE2e('home-vinyl-playing', false, `minPos=${minPos} reached=${startPos.toFixed(1)}`);
        return false;
      }
      handlers.navigateTab?.('home');
      await sleep(1200);
      if (loadHeroDisplayMode() !== 'album-cover') {
        handlers.setHeroDisplayMode?.('album-cover');
        saveHeroDisplayMode('album-cover');
        await sleep(400);
      }
      const coverProbe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const coverOk = coverProbe.visual === 'poster';
      const toggle1 = handlers.clickHomeVinylToggle?.() ?? clickHomeVinylToggleButton();
      await sleep(500);
      const vinylProbe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const vinylOk = toggle1 && vinylProbe.visual === 'vinyl';
      const toggle2 = handlers.clickHomeVinylToggle?.() ?? clickHomeVinylToggleButton();
      await sleep(500);
      const posterAfter = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const posterOk = toggle2 && posterAfter.visual === 'poster';
      const afterProbe = handlers.getPlaybackProbe?.();
      const afterStatus = await getNativeExoPlaybackStatus();
      const endPos = Math.max(afterProbe?.positionSecs ?? 0, afterStatus.positionSecs ?? 0);
      const posOk = endPos >= startPos - 2;
      const stillPlaying =
        afterStatus.state === 'playing' ||
        afterProbe?.state === 'Playing' ||
        endPos > startPos + 1;
      const pass = coverOk && vinylOk && posterOk && posOk && stillPlaying;
      logE2e(
        'home-vinyl-playing',
        pass,
        `startPos=${startPos.toFixed(1)} endPos=${endPos.toFixed(1)} cover=${coverProbe.visual} vinyl=${vinylProbe.visual} poster=${posterAfter.visual} posOk=${posOk} playing=${stillPlaying}`,
      );
      return pass;
    }
    case 'probe-vinyl': {
      const expected = params.get('mode')?.trim() as HeroDisplayMode | undefined;
      const mode = handlers.getHeroDisplayMode?.() ?? loadHeroDisplayMode();
      const probe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const expectedVisual =
        expected === 'album-cover' && probe.hasArt
          ? 'poster'
          : expected === 'vinyl-shades'
            ? 'vinyl'
            : null;
      const modeOk = !expected || mode === expected;
      const visualOk = !expectedVisual || probe.visual === expectedVisual;
      const pass = modeOk && visualOk;
      logE2e(
        'vinyl-mode',
        pass,
        `mode=${mode} visual=${probe.visual} expected=${expected ?? 'any'} modeOk=${modeOk} visualOk=${visualOk}`,
      );
      return pass;
    }
    case 'set-vinyl-mode': {
      const mode = params.get('mode')?.trim();
      if (mode !== 'album-cover' && mode !== 'vinyl-shades') {
        logE2e('vinyl-mode-set', false, 'mode must be album-cover or vinyl-shades');
        return false;
      }
      saveHeroDisplayMode(mode);
      handlers.setHeroDisplayMode?.(mode);
      logE2e('vinyl-mode-set', true, `mode=${mode}`);
      return true;
    }
    case 'set-vinyl-visual-preset': {
      const preset = params.get('preset')?.trim() as MobileVinylVisualPresetId | undefined;
      if (!preset || !(preset in MOBILE_VINYL_VISUAL_PRESETS)) {
        logE2e('vinyl-visual-preset', false, 'preset must be subtle or glow');
        return false;
      }
      saveVinylVisualSettings({
        ...loadVinylVisualSettings(),
        ...MOBILE_VINYL_VISUAL_PRESETS[preset],
      });
      logE2e('vinyl-visual-preset', true, `preset=${preset}`);
      return true;
    }
    case 'set-vinyl-visual-slider': {
      const key = params.get('key')?.trim() as keyof VinylVisualSettings | undefined;
      const value = Number(params.get('value'));
      const allowed: (keyof VinylVisualSettings)[] = [
        'universeIntensity',
        'colorThrow',
        'pulse',
      ];
      if (!key || !allowed.includes(key) || !Number.isFinite(value)) {
        logE2e('vinyl-visual-slider', false, 'key/value invalid');
        return false;
      }
      const next = { ...loadVinylVisualSettings(), [key]: Math.max(0, Math.min(100, Math.round(value))) };
      saveVinylVisualSettings(next);
      logE2e('vinyl-visual-slider', true, `${key}=${next[key]}`);
      return true;
    }
    case 'set-theme-preset': {
      const toneKey = params.get('tone')?.trim();
      const preset = toneKey ? getThemePreset(toneKey) : undefined;
      if (!preset) {
        logE2e('theme-preset', false, 'unknown tone');
        return false;
      }
      applyThemePreset(preset.toneKey, {
        h: preset.focusH,
        s: preset.focusS,
        l: preset.focusL,
        hex: preset.focusHex,
      });
      logE2e('theme-preset', true, `tone=${preset.toneKey}`);
      return true;
    }
    case 'close-vinyl-settings': {
      const closeBtn = document.querySelector('.mobile-home-vinyl-sheet-close');
      if (closeBtn instanceof HTMLElement) closeBtn.click();
      await sleep(350);
      const probe = probeHeroVisualFromDom();
      const pass = !probe.settingsOpen;
      logE2e('vinyl-settings-close', pass, `open=${probe.settingsOpen}`);
      return pass;
    }
    case 'probe-mobile-vinyl-settings': {
      handlers.navigateTab?.('home');
      await sleep(500);
      let opened = handlers.openVinylSettingsSheet?.() ?? false;
      if (!opened) {
        window.dispatchEvent(new Event('sandbox-e2e-open-vinyl-settings'));
        opened = true;
      }
      await sleep(450);
      const probe = probeMobileVinylSettingsSheet();
      const pass =
        opened &&
        probe.open &&
        !probe.hasDmtPreset &&
        !probe.hasTripPreset &&
        probe.hasGlowPreset &&
        probe.hasSubtlePreset &&
        probe.themeCount === 3 &&
        probe.sliderKeys.length === 3;
      logE2e(
        'mobile-vinyl-settings-probe',
        pass,
        `open=${probe.open} presets=${probe.presetIds.join(',')} sliders=${probe.sliderKeys.join(',')} themes=${probe.themeCount} dmt=${probe.hasDmtPreset} trip=${probe.hasTripPreset}`,
      );
      return pass;
    }
    case 'test-hero-controls': {
      const mode = (params.get('mode')?.trim() ?? loadHeroDisplayMode()) as HeroDisplayMode;
      if (mode !== 'album-cover' && mode !== 'vinyl-shades') {
        logE2e('hero-controls', false, 'invalid mode');
        return false;
      }
      handlers.navigateTab?.('home');
      saveHeroDisplayMode(mode);
      await sleep(400);
      handlers.openMobileNowPlaying?.();
      await sleep(900);
      const playBtn = document.querySelector('.home-console-play');
      if (!(playBtn instanceof HTMLElement)) {
        logE2e('hero-controls', false, 'play button missing');
        return false;
      }
      const before = handlers.getPlaybackProbe?.();
      const titleBefore = before?.title?.trim() ?? '';
      if (!titleBefore) {
        logE2e('hero-controls', false, 'no track loaded');
        return false;
      }
      const posBefore = before?.positionSecs ?? 0;
      playBtn.click();
      await sleep(800);
      playBtn.click();
      await sleep(800);
      const afterToggle = handlers.getPlaybackProbe?.();
      const titleOk = (afterToggle?.title?.trim() ?? '') === titleBefore;
      const slider = document.querySelector('.home-progress-slider');
      let seekOk = false;
      if (slider instanceof HTMLInputElement) {
        slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        slider.value = '40';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        await sleep(900);
        const afterSeek = handlers.getPlaybackProbe?.();
        const nativeAfter = await getNativeExoPlaybackStatus();
        const seekPos = Math.max(afterSeek?.positionSecs ?? 0, nativeAfter.positionSecs ?? 0);
        const dur = Math.max(afterSeek?.durationSecs ?? 0, nativeAfter.durationSecs ?? 0);
        seekOk = dur > 0 ? seekPos >= dur * 0.32 : seekPos > posBefore + 1.5;
      }
      handlers.openMobileNowPlaying?.();
      await sleep(700);
      const expandedProbe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const expandOk = expandedProbe.expanded;
      handlers.closeMobileNowPlaying?.();
      await sleep(500);
      const collapsedProbe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const collapseOk = !collapsedProbe.expanded;
      const settingsOpened = handlers.openVinylSettingsSheet?.() ?? false;
      await sleep(450);
      const settingsProbe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const settingsOk = settingsOpened && settingsProbe.settingsOpen;
      if (settingsOk) {
        const closeBtn = document.querySelector('.mobile-home-vinyl-sheet-close');
        if (closeBtn instanceof HTMLElement) closeBtn.click();
        await sleep(350);
      }
      const visualProbe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const expectedVisual =
        mode === 'album-cover' && visualProbe.hasArt
          ? 'poster'
          : mode === 'vinyl-shades'
            ? 'vinyl'
            : visualProbe.visual;
      const visualOk = expectedVisual === 'none' || visualProbe.visual === expectedVisual;
      const pass = titleOk && seekOk && expandOk && collapseOk && settingsOk && visualOk;
      logE2e(
        'hero-controls',
        pass,
        `mode=${mode} title=${titleOk} seek=${seekOk} expand=${expandOk} collapse=${collapseOk} settings=${settingsOk} visual=${visualProbe.visual}`,
      );
      return pass;
    }
    case 'download-track': {
      const artist = params.get('artist')?.trim();
      const title = params.get('title')?.trim();
      const album = params.get('album')?.trim() || undefined;
      const mode = (params.get('mode')?.trim() === 'album' ? 'album' : 'tracks') as
        | 'tracks'
        | 'album';
      if (!artist || !title || !handlers.downloadTrack) {
        logE2e('download-track', false, 'missing artist/title or handler');
        return false;
      }
      const started = await handlers.downloadTrack(artist, title, mode, album);
      if (!started) {
        logE2e('download-track', false, `artist=${artist} title=${title} start=false`);
        return false;
      }
      const jobs = getDownloadJobs();
      const job = jobs[0];
      if (!job) {
        logE2e('download-track', false, 'no download job');
        return false;
      }
      const outcome = await waitForDownloadJobDone(job.id);
      const pass = outcome.ok;
      logE2e(
        'download-track',
        pass,
        `artist=${artist} title=${title} mode=${mode} album=${album ?? ''} status=${outcome.status}${outcome.error ? ` error=${outcome.error}` : ''}`,
      );
      return pass;
    }
    case 'stop-downloads': {
      const cancelled = await cancelAllActiveDownloadJobs();
      logE2e('stop-downloads', true, `cancelled=${cancelled}`);
      return true;
    }
    case 'verify-locker-album': {
      const artist = params.get('artist')?.trim();
      const album = params.get('album')?.trim();
      if (!artist || !album) {
        logE2e('verify-locker-album', false, 'missing artist/album');
        return false;
      }
      const summary = await summarizeLockerAlbum(album, artist);
      logE2e(
        'verify-locker-album',
        summary.fullyDownloaded,
        `artist=${artist} album=${album} playable=${summary.playableCount} lockerRows=${summary.totalInLocker}`,
      );
      return summary.fullyDownloaded;
    }
    case 'download-album': {
      const artist = params.get('artist')?.trim();
      const album = params.get('album')?.trim();
      if (!artist || !album || !handlers.downloadAlbum) {
        logE2e('download-album', false, 'missing artist/album or handler');
        return false;
      }
      const started = await handlers.downloadAlbum(artist, album);
      if (!started) {
        logE2e('download-album', false, `artist=${artist} album=${album} start=false`);
        return false;
      }
      const job = getDownloadJobs()[0];
      if (!job) {
        const summary = await summarizeLockerAlbum(album, artist);
        if (summary.fullyDownloaded) {
          logE2e(
            'download-album',
            true,
            `artist=${artist} album=${album} skipped=all-in-locker playable=${summary.playableCount}`,
          );
          return true;
        }
        logE2e('download-album', false, 'no download job');
        return false;
      }
      const outcome = await waitForDownloadJobDone(job.id, 900_000);
      const pass = outcome.ok;
      logE2e(
        'download-album',
        pass,
        `artist=${artist} album=${album} tracks=${job.totalTracks} status=${outcome.status}${outcome.error ? ` error=${outcome.error}` : ''}`,
      );
      return pass;
    }
    case 'dump-locker': {
      const entries = getLockerEntriesSnapshot() ?? (await getLockerEntries());
      let playable = 0;
      for (const entry of entries.slice(0, 96)) {
        if (
          entry.offlineReady === true ||
          (await lockerEntryHasRecoverableAudio(entry.id))
        ) {
          playable += 1;
        }
      }
      const report = `entries=${entries.length} playable=${playable}`;
      const pass = entries.length >= 50 && playable >= 1;
      logE2e('dump-locker', pass, report);
      return pass;
    }
    case 'verify-locker-cache': {
      const artist = params.get('artist')?.trim();
      const title = params.get('title')?.trim();
      const album = params.get('album')?.trim() || undefined;
      if (!artist || !title) {
        logE2e('verify-locker-cache', false, 'missing artist/title');
        return false;
      }
      const probe = await verifyLockerEntry(title, artist, album);
      const pass = probe.ok;
      logE2e(
        'verify-locker-cache',
        pass,
        pass
          ? `title=${title} artist=${artist} album=${probe.albumName ?? album ?? 'single'} entryId=${probe.entryId}`
          : `title=${title} artist=${artist} album=${album ?? 'single'} missing`,
      );
      return pass;
    }
    case 'probe-playlist-track': {
      const playlistName = params.get('playlist')?.trim();
      const trackTitle = params.get('track')?.trim();
      if (!playlistName || !trackTitle) {
        logE2e('probe-playlist-track', false, 'missing playlist/track');
        return false;
      }
      const pl = loadPlaylists().find((p) =>
        p.name.toLowerCase().includes(playlistName.toLowerCase()),
      );
      if (!pl) {
        logE2e('probe-playlist-track', false, `playlist=${playlistName} not found`);
        return false;
      }
      const track = pl.tracks.find((t) => lockerTitleMatches(t.title, trackTitle));
      if (!track) {
        logE2e(
          'probe-playlist-track',
          false,
          `playlist=${pl.name} track=${trackTitle} not in tracks (${pl.tracks.length} rows)`,
        );
        return false;
      }
      const locker = findLockerEntryForTrack(
        track.title,
        track.artist,
        track.album,
        getLockerEntriesSnapshot(),
      );
      const resolved = await resolveLockerEnvelopeForPlayback({
        ...track,
        provider: 'local-vault',
        sourceId: locker?.id ?? track.sourceId,
      });
      const lockerPlayable = Boolean(resolved?.url?.trim());
      const resolvedLockerId = resolved?.sourceId ?? locker?.id ?? 'none';
      logE2e(
        'probe-playlist-track',
        lockerPlayable,
        `playlist=${pl.name} track=${track.title} artist=${track.artist} provider=${track.provider ?? 'none'} sourceId=${track.sourceId ?? 'none'} lockerId=${resolvedLockerId} playable=${lockerPlayable} envelopeId=${track.envelopeId}`,
      );
      return lockerPlayable;
    }
    case 'play-playlist-track': {
      const playlistName = params.get('playlist')?.trim();
      const trackTitle = params.get('track')?.trim();
      if (!playlistName || !trackTitle || !handlers.playPlaylistTrack) {
        logE2e('play-playlist-track', false, 'missing playlist/track or handler');
        return false;
      }
      const played = await handlers.playPlaylistTrack(playlistName, trackTitle);
      if (!played) {
        logE2e('play-playlist-track', false, `playlist=${playlistName} track=${trackTitle} start=false`);
        return false;
      }
      const playing = await waitForPlayingState(120_000);
      const probe = handlers.getPlaybackProbe?.();
      const titleOk = probe ? titlesMatch(probe.title, trackTitle) : false;
      const pass = playing && titleOk;
      logE2e(
        'play-playlist-track',
        pass,
        `playlist=${playlistName} track=${trackTitle} playing=${playing} actual=${probe?.title ?? 'unknown'} state=${probe?.state ?? 'unknown'}`,
      );
      return pass;
    }
    case 'play-offline': {
      const artist = params.get('artist')?.trim();
      const track = params.get('track')?.trim() ?? params.get('title')?.trim();
      const album = params.get('album')?.trim() || undefined;
      if (!artist || !track || !handlers.playLockerTrack) {
        logE2e('play-offline', false, 'missing artist/track or handler');
        return false;
      }
      const played = await handlers.playLockerTrack(artist, track, album);
      if (!played) {
        logE2e('play-offline', false, `artist=${artist} track=${track} play=false`);
        return false;
      }
      const playing = await waitForPlayingState();
      const probe = handlers.getPlaybackProbe?.();
      const titleOk = probe ? titlesMatch(probe.title, track) : false;
      let queueLength = 0;
      if (album) {
        const queueDeadline = Date.now() + 120_000;
        while (Date.now() < queueDeadline) {
          const status = await getNativeExoPlaybackStatus();
          queueLength = status.queueLength ?? 0;
          if (queueLength >= 2) break;
          await sleep(1000);
        }
      } else {
        const status = await getNativeExoPlaybackStatus();
        queueLength = status.queueLength ?? 0;
      }
      const pass = playing && titleOk;
      logE2e(
        'play-offline',
        pass,
        `artist=${artist} track=${track} playing=${playing} actual=${probe?.title ?? 'unknown'} queueLength=${queueLength}`,
      );
      return pass;
    }
    case 'play-locker-sequence': {
      const artist = params.get('artist')?.trim();
      const album = params.get('album')?.trim() || undefined;
      const tracksRaw = params.get('tracks')?.trim();
      if (!artist || !tracksRaw || !handlers.playLockerSequence) {
        logE2e('locker-sequence', false, 'missing artist/tracks or handler');
        return false;
      }
      const trackTitles = tracksRaw
        .split('|')
        .map((t) => t.trim())
        .filter(Boolean);
      if (trackTitles.length < 2) {
        logE2e('locker-sequence', false, 'need 2+ tracks pipe-separated');
        return false;
      }
      const pass = await handlers.playLockerSequence(artist, trackTitles, album);
      logE2e(
        'locker-sequence',
        pass,
        `artist=${artist} album=${album ?? 'single'} tracks=${trackTitles.join('|')} count=${trackTitles.length}`,
      );
      return pass;
    }
    case 'verify-art-cache': {
      const artist = params.get('artist')?.trim();
      const title = params.get('title')?.trim();
      const album = params.get('album')?.trim() || undefined;
      if (!artist || !title || !handlers.probeLockerArt) {
        logE2e('verify-art-cache', false, 'missing artist/title or handler');
        return false;
      }
      const pass = await handlers.probeLockerArt(artist, title, album);
      logE2e(
        'verify-art-cache',
        pass,
        `artist=${artist} title=${title} album=${album ?? 'single'} hasBlob=${pass}`,
      );
      return pass;
    }
    case 'verify-stream-cache': {
      const artist = params.get('artist')?.trim();
      const track = params.get('track')?.trim() ?? params.get('title')?.trim();
      if (!artist || !track || !handlers.playArtistTrack) {
        logE2e('verify-stream-cache', false, 'missing artist/track or handler');
        return false;
      }
      ensureYtDlpEnabled();
      const initOk = await waitForYtDlpInit();
      if (!initOk) {
        logE2e('verify-stream-cache', false, 'ytdlp init failed');
        return false;
      }
      const first = await handlers.playArtistTrack(artist, track);
      if (!first) {
        logE2e('verify-stream-cache', false, 'first play failed');
        return false;
      }
      await waitForPlayingState(90_000);
      const probe = handlers.getPlaybackProbe?.();
      if (!probe?.title) {
        logE2e('verify-stream-cache', false, 'no playback probe after first play');
        return false;
      }
      const env = {
        envelopeId: probe.envelopeId ?? `e2e-${track}`,
        title: probe.title,
        artist: probe.artist,
        url: '',
        durationSeconds: probe.durationSecs ?? 0,
        provider: 'https' as const,
        transport: 'element-src' as const,
        sourceId: probe.envelopeId ?? `e2e-${track}`,
      };
      const uriCached = Boolean(getCachedStreamForTrack(env)?.uri?.trim());
      const blobCached = await isEnvelopeStreamCached(env);
      await nativeExoStop();
      await sleep(1500);
      const resolveCountBefore = getCachedStreamForTrack(env)?.uri ? 1 : 0;
      const second = await handlers.playArtistTrack(artist, track);
      if (!second) {
        logE2e('verify-stream-cache', false, 'second play failed');
        return false;
      }
      await waitForPlayingState(90_000);
      const last = getLastResolvedSource();
      const secondUriCached = Boolean(getCachedStreamForTrack(env)?.uri?.trim());
      const pass =
        (uriCached || blobCached || secondUriCached) &&
        (last?.source === 'cache' || last?.source === 'mobile' || secondUriCached);
      logE2e(
        'verify-stream-cache',
        pass,
        `track=${track} uriCached=${uriCached || secondUriCached} blobCached=${blobCached} lastSource=${last?.source ?? 'none'} resolveHits=${resolveCountBefore}`,
      );
      return pass;
    }
    case 'probe-mobile-home-chrome': {
      handlers.navigateTab?.('home');
      await sleep(700);
      await handlers.reconcileFromNativePlayback?.();
      await sleep(400);
      const minHeroPx = Math.max(64, Number(params.get('minVinylPx') ?? params.get('minHeroPx') ?? '96'));
      const probe = probeMobileHomeChrome();
      const playback = handlers.getPlaybackProbe?.();
      const title = playback?.title?.trim() ?? '';
      const playing =
        playback?.state === 'Playing' ||
        playback?.state === 'Ready' ||
        playback?.nativeState === 'playing' ||
        (playback?.positionSecs ?? 0) > 1;
      const failures: string[] = [];
      if (!title && !probe.hasHeroTitle) failures.push('no-title');
      if (playing && probe.heroVisualPx < minHeroPx) {
        failures.push(`hero=${probe.heroVisualPx}px(${probe.heroVisualKind})`);
      }
      if (playing && !probe.miniPlayerVisible) failures.push('no-mini-player');
      if (probe.shellNowPlayingClass && !probe.nowPlayingOpen) failures.push('stuck-np-shell');
      const pass = failures.length === 0;
      logE2e(
        'mobile-home-chrome',
        pass,
        pass
          ? `hero=${probe.heroVisualPx}px(${probe.heroVisualKind}) mini=${probe.miniPlayerVisible} title=${title || probe.hasHeroTitle}`
          : failures.join(' '),
      );
      return pass;
    }
    case 'app-lifecycle-stress': {
      const cycles = Math.min(5, Math.max(1, Number(params.get('cycles') ?? '3')));
      const minHeroPx = Math.max(64, Number(params.get('minVinylPx') ?? params.get('minHeroPx') ?? '96'));
      handlers.navigateTab?.('home');
      await sleep(700);
      const failures: string[] = [];

      for (let i = 0; i < cycles; i += 1) {
        await handlers.reconcileFromNativePlayback?.();
        await sleep(300);
        const probe = probeMobileHomeChrome();
        const playback = handlers.getPlaybackProbe?.();
        const title = playback?.title?.trim() ?? '';
        const playing =
          playback?.state === 'Playing' ||
          playback?.state === 'Ready' ||
          playback?.nativeState === 'playing' ||
          (playback?.positionSecs ?? 0) > 1;

        if (!title && !probe.hasHeroTitle) failures.push(`cycle${i + 1}:no-title`);
        if (playing && probe.heroVisualPx < minHeroPx) {
          failures.push(`cycle${i + 1}:hero=${probe.heroVisualPx}px`);
        }
        if (playing && !probe.miniPlayerVisible) {
          failures.push(`cycle${i + 1}:no-mini-player`);
        }
        if (probe.shellNowPlayingClass && !probe.nowPlayingOpen) {
          failures.push(`cycle${i + 1}:stuck-np-shell`);
        }

        window.dispatchEvent(new Event('sandbox-e2e-simulate-background'));
        await sleep(450);
        window.dispatchEvent(new Event('sandbox-e2e-simulate-foreground'));
        await sleep(900);
        await handlers.reconcileFromNativePlayback?.();
        await sleep(500);
      }

      handlers.navigateTab?.('home');
      await sleep(600);
      const finalProbe = probeMobileHomeChrome();
      const finalPlayback = handlers.getPlaybackProbe?.();
      const finalTitle = finalPlayback?.title?.trim() ?? '';
      const finalPlaying =
        finalPlayback?.state === 'Playing' ||
        finalPlayback?.state === 'Ready' ||
        (finalPlayback?.positionSecs ?? 0) > 1;
      if (!finalTitle && !finalProbe.hasHeroTitle) failures.push('final:no-title');
      if (finalPlaying && finalProbe.heroVisualPx < minHeroPx) {
        failures.push(`final:hero=${finalProbe.heroVisualPx}px`);
      }
      if (finalPlaying && !finalProbe.miniPlayerVisible) {
        failures.push('final:no-mini-player');
      }
      if (finalProbe.shellNowPlayingClass && !finalProbe.nowPlayingOpen) {
        failures.push('final:stuck-np-shell');
      }

      const pass = failures.length === 0;
      logE2e(
        'app-lifecycle-stress',
        pass,
        pass
          ? `cycles=${cycles} hero=${finalProbe.heroVisualPx}px(${finalProbe.heroVisualKind}) mini=${finalProbe.miniPlayerVisible}`
          : failures.join(' '),
      );
      return pass;
    }
    case 'thumb-up': {
      if (!handlers.thumbUpCurrent) {
        logE2e('thumb-up', false, 'thumbUpCurrent handler not registered');
        return false;
      }
      await e2eEnsureNowPlayingChrome();
      const probeBefore = handlers.getPlaybackProbe?.();
      const titleBefore = probeBefore?.title?.trim() ?? '';
      const envelopeId = probeBefore?.envelopeId?.trim() ?? '';
      if (!titleBefore && !envelopeId) {
        logE2e('thumb-up', false, 'no current track to thumbs-up');
        return false;
      }
      const ok = handlers.thumbUpCurrent();
      if (!ok) {
        logE2e(
          'thumb-up',
          false,
          `handler returned false title=${titleBefore || 'unknown'} envelopeId=${envelopeId || 'none'}`,
        );
        return false;
      }
      const feedback = envelopeId ? getTrackTasteFeedback(envelopeId) : null;
      const liked = loadPlaylists().find((p) => p.id === LIKED_PLAYLIST_ID);
      const inLiked = Boolean(
        liked?.tracks.some(
          (t) =>
            (envelopeId && t.envelopeId === envelopeId) ||
            (titleBefore &&
              t.title.trim().toLowerCase() === titleBefore.toLowerCase()),
        ),
      );
      await sleep(200);
      const visual = probeThumbVisualFromDom('up');
      const downVisual = probeThumbVisualFromDom('down');
      // Visual check is required when thumb buttons are mounted (now playing / player bar).
      const visualOk = !visual.found
        ? false
        : visual.pressed && visual.activeAttr && visual.filled && !downVisual.pressed;
      const pass = feedback === 'like' && Boolean(liked) && inLiked && visualOk;
      logE2e(
        'thumb-up',
        pass,
        `title=${titleBefore || 'unknown'} envelopeId=${envelopeId || 'none'} feedback=${feedback ?? 'none'} playlistId=${liked?.id ?? 'missing'} playlistName=${liked?.name ?? 'missing'} tracks=${liked?.tracks.length ?? 0} inLiked=${inLiked} visualFound=${visual.found} ariaPressed=${visual.pressed} activeAttr=${visual.activeAttr} filled=${visual.filled} downPressed=${downVisual.pressed}`,
      );
      return pass;
    }
    case 'thumb-down': {
      if (!handlers.thumbDownCurrent) {
        logE2e('thumb-down', false, 'thumbDownCurrent handler not registered');
        return false;
      }
      await e2eEnsureNowPlayingChrome();
      const probeBefore = handlers.getPlaybackProbe?.();
      const titleBefore = probeBefore?.title?.trim() ?? '';
      const envelopeId = probeBefore?.envelopeId?.trim() ?? '';
      if (!titleBefore && !envelopeId) {
        logE2e('thumb-down', false, 'no current track to thumbs-down');
        return false;
      }
      const ok = handlers.thumbDownCurrent();
      if (!ok) {
        logE2e(
          'thumb-down',
          false,
          `handler returned false title=${titleBefore || 'unknown'} envelopeId=${envelopeId || 'none'}`,
        );
        return false;
      }
      const feedback = envelopeId ? getTrackTasteFeedback(envelopeId) : null;
      const liked = loadPlaylists().find((p) => p.id === LIKED_PLAYLIST_ID);
      const stillInLiked = Boolean(
        liked?.tracks.some(
          (t) =>
            (envelopeId && t.envelopeId === envelopeId) ||
            (titleBefore &&
              t.title.trim().toLowerCase() === titleBefore.toLowerCase()),
        ),
      );
      await sleep(200);
      const visual = probeThumbVisualFromDom('down');
      const upVisual = probeThumbVisualFromDom('up');
      const visualOk =
        visual.found && visual.pressed && visual.activeAttr && visual.filled && !upVisual.pressed;
      const pass = feedback === 'dislike' && !stillInLiked && visualOk;
      logE2e(
        'thumb-down',
        pass,
        `title=${titleBefore || 'unknown'} envelopeId=${envelopeId || 'none'} feedback=${feedback ?? 'none'} stillInLiked=${stillInLiked} visualFound=${visual.found} ariaPressed=${visual.pressed} activeAttr=${visual.activeAttr} filled=${visual.filled} upPressed=${upVisual.pressed}`,
      );
      return pass;
    }
    case 'probe-thumb-visual': {
      const which = (params.get('which')?.trim().toLowerCase() === 'down' ? 'down' : 'up') as
        | 'up'
        | 'down';
      const expect = params.get('expect')?.trim().toLowerCase();
      await e2eEnsureNowPlayingChrome();
      await sleep(150);
      const visual = probeThumbVisualFromDom(which);
      const other = probeThumbVisualFromDom(which === 'up' ? 'down' : 'up');
      const wantActive = expect !== 'false' && expect !== 'off' && expect !== 'inactive';
      const pass = wantActive
        ? visual.found && visual.pressed && visual.activeAttr && visual.filled && !other.pressed
        : visual.found && !visual.pressed && !visual.activeAttr;
      logE2e(
        'probe-thumb-visual',
        pass,
        `which=${which} expect=${wantActive ? 'active' : 'inactive'} found=${visual.found} ariaPressed=${visual.pressed} activeAttr=${visual.activeAttr} filled=${visual.filled} otherPressed=${other.pressed}`,
      );
      return pass;
    }
    case 'probe-liked-playlist': {
      const trackTitle = params.get('track')?.trim() || params.get('title')?.trim();
      const liked = loadPlaylists().find((p) => p.id === LIKED_PLAYLIST_ID);
      if (!liked) {
        logE2e(
          'probe-liked-playlist',
          false,
          `playlist missing expectedId=${LIKED_PLAYLIST_ID} expectedName=${LIKED_PLAYLIST_NAME}`,
        );
        return false;
      }
      const titles = liked.tracks
        .map((t) => t.title?.trim())
        .filter(Boolean)
        .slice(0, 12)
        .join('|');
      if (!trackTitle) {
        const pass = liked.tracks.length > 0;
        logE2e(
          'probe-liked-playlist',
          pass,
          `playlistId=${liked.id} playlistName=${liked.name} tracks=${liked.tracks.length} titles=${titles || 'none'}`,
        );
        return pass;
      }
      const hit = liked.tracks.find(
        (t) => t.title.trim().toLowerCase() === trackTitle.toLowerCase(),
      );
      const pass = Boolean(hit);
      logE2e(
        'probe-liked-playlist',
        pass,
        `playlistId=${liked.id} playlistName=${liked.name} tracks=${liked.tracks.length} track=${trackTitle} found=${pass} titles=${titles || 'none'}`,
      );
      return pass;
    }
    case 'probe-track-radio': {
      const { TRACK_RADIO_PLAYLIST_ID, TRACK_RADIO_PLAYLIST_NAME } = await import(
        './radioSessionPlaylist'
      );
      const pl = loadPlaylists().find((p) => p.id === TRACK_RADIO_PLAYLIST_ID);
      if (!pl) {
        logE2e(
          'probe-track-radio',
          false,
          `playlist missing expectedId=${TRACK_RADIO_PLAYLIST_ID} expectedName=${TRACK_RADIO_PLAYLIST_NAME}`,
        );
        return false;
      }
      const titles = pl.tracks
        .map((t) => t.title?.trim())
        .filter(Boolean)
        .slice(0, 8)
        .join('|');
      const pass = pl.tracks.length > 1;
      logE2e(
        'probe-track-radio',
        pass,
        `playlistId=${pl.id} playlistName=${pl.name} tracks=${pl.tracks.length} titles=${titles || 'none'}`,
      );
      return pass;
    }
    default: {
      logE2e(action, false, 'unknown action');
      return false;
    }
  }
}

export async function handleE2eUrl(raw: string): Promise<boolean> {
  const parsed = parseE2eUrl(raw);
  if (!parsed) return false;
  return enqueueE2e(() => handleE2eAction(parsed.action, parsed.params));
}

function queueOrHandleE2eUrl(raw: string): void {
  markBootInteractiveFromAutomation();
  const parsed = parseE2eUrl(raw);
  // Bootstrap / probe actions must not wait behind the sandboxLayer3 chunk on large vaults.
  if (parsed?.action === 'skip-onboarding' || parsed?.action === 'probe-handlers') {
    void enqueueE2e(() => handleE2eAction(parsed.action, parsed.params));
    return;
  }
  // Capacitor often delivers the same deep link 2–3×; ignore duplicates while busy.
  const dedupeKey = raw.trim();
  const now = Date.now();
  if (
    dedupeKey &&
    dedupeKey === lastE2eUrlKey &&
    now - lastE2eUrlAt < 2_500
  ) {
    return;
  }
  lastE2eUrlKey = dedupeKey;
  lastE2eUrlAt = now;
  if (!e2eBridgeReady || !e2eHandlersReady) {
    pendingE2eUrls.push(raw);
    return;
  }
  void handleE2eUrl(raw);
}

export async function initE2eDeepLinks(): Promise<() => void> {
  if (!isE2eBridgeEnabled() || !Capacitor.isNativePlatform()) {
    return () => {};
  }
  if (e2eDeepLinksInit) {
    return e2eDeepLinksInit;
  }
  e2eDeepLinksInit = (async () => {
    const { App } = await import('@capacitor/app');
    const sub = await App.addListener('appUrlOpen', (event) => {
      queueOrHandleE2eUrl(event.url);
    });
    e2eBridgeReady = true;
    logE2e('bridge', true, 'ready');
    flushPendingE2eUrls();
    try {
      const launch = await App.getLaunchUrl();
      if (launch?.url) {
        queueOrHandleE2eUrl(launch.url);
      }
    } catch {
      /* no cold-start URL */
    }
    return () => {
      e2eBridgeReady = false;
      e2eHandlersReady = false;
      e2ePlaybackHandlersLive = false;
      void sub.remove();
      e2eDeepLinksInit = null;
    };
  })();
  return e2eDeepLinksInit;
}

/** Expose resolver state for automation without UI. */
export function getE2eYtDlpResolverState(): {
  present: boolean;
  enabled: boolean;
  resolvers: ReturnType<typeof getMobileResolvers>;
} {
  const resolvers = getMobileResolvers();
  const yt = resolvers.find((r) => r.id === 'yt-dlp-mobile');
  return {
    present: Boolean(yt),
    enabled: Boolean(yt?.enabled),
    resolvers,
  };
}
