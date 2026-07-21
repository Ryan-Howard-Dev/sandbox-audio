/**
 * Android native ExoPlayer bridge — default decode path outside the WebView.
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  loadAndroidNativePlaybackEnabled,
  loadAndroidUsbBitPerfectEnabled,
  loadAndroidWebViewCrossfadeEnabled,
} from './androidNativePlaybackSettings';
import { CROSSFADE_DURATION_SEC } from './sandboxSettings';
import { appendSandboxClientQuery } from './tier34/client';
import { wrapGoogleStreamForExo, logSuspectPlaybackUrl } from './nativeExoStreamResolver';
import { isBatterySaverEnabled } from './batterySaverSettings';
import {
  nextAndroidMediaMetadataRevision,
  resolveAndroidForegroundArtworkUrl,
} from './backgroundMedia';

/** Synchronous hint — async getStatus() may refine this on mount. */
export function isAndroidNativePlaybackLikely(): boolean {
  return (
    Capacitor.getPlatform() === 'android' &&
    loadAndroidNativePlaybackEnabled() &&
    !loadAndroidWebViewCrossfadeEnabled()
  );
}

function isNativeExoPlayableUrl(url: string): boolean {
  const trimmed = url?.trim() ?? '';
  return (
    /^https?:\/\//i.test(trimmed) ||
    /^content:\/\//i.test(trimmed) ||
    /^file:\/\//i.test(trimmed)
  );
}

export interface NativeExoPlaybackStatus {
  available: boolean;
  wired: boolean;
  message: string;
  state?: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error';
  positionSecs?: number;
  durationSecs?: number;
  queueIndex?: number;
  queueLength?: number;
  currentUrl?: string;
  gaplessEnabled?: boolean;
  crossfadeEnabled?: boolean;
  bitPerfectActive?: boolean;
  error?: string | null;
  /** Track metadata mirrored from last playUrl / MediaItem — survives WebView reload. */
  envelopeId?: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
}

export interface NativeExoPlaybackPlugin {
  getStatus(): Promise<NativeExoPlaybackStatus>;
  /** Android localhost proxy — CORS-safe URL for WebView Web Audio graphs. */
  localStreamProxyUrl(options: { url: string }): Promise<{ url: string }>;
  prepare(): Promise<{ ok: boolean; message: string }>;
  playUrl(options: {
    url: string;
    autoPlay?: boolean;
    replayGainDb?: number;
    resetQueue?: boolean;
    gaplessEnabled?: boolean;
    crossfade?: boolean;
    envelopeId?: string;
    title?: string;
    artist?: string;
    album?: string;
    artworkUrl?: string;
    durationSeconds?: number;
  }): Promise<{ ok: boolean }>;
  enqueueNext(options: {
    url: string;
    replayGainDb?: number;
    title?: string;
    artist?: string;
    album?: string;
    artworkUrl?: string;
  }): Promise<{ ok: boolean }>;
  setGaplessEnabled(options: { enabled: boolean }): Promise<{ ok: boolean; gaplessEnabled: boolean }>;
  setCrossfadeEnabled(options: {
    enabled: boolean;
    durationMs?: number;
    gaplessDurationMs?: number;
  }): Promise<{ ok: boolean; crossfadeEnabled: boolean }>;
  setReplayGainDb(options: { replayGainDb: number }): Promise<{ ok: boolean }>;
  setUserVolume(options: { volume: number }): Promise<{ ok: boolean }>;
  setPlaybackSpeed(options: { speed: number }): Promise<{ ok: boolean; speed?: number }>;
  setBitPerfectEnabled(options: { enabled: boolean }): Promise<{ ok: boolean; bitPerfectActive?: boolean }>;
  setWiredDacStabilityEnabled(options: { enabled: boolean }): Promise<{ ok: boolean }>;
  getUsbBitPerfectSupport(): Promise<{
    available: boolean;
    usbDacConnected: boolean;
    active: boolean;
    apiLevel: number;
  }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  rerouteToWiredOutput(options?: {
    forceRestart?: boolean;
  }): Promise<{ ok: boolean; route?: string }>;
  stop(): Promise<void>;
  seek(options: { seconds: number }): Promise<void>;
  updateTrackMetadata(options: NativeExoPlayMetadata): Promise<{ ok: boolean }>;
  beginLockerBlob(options: { id: string; mimeType?: string }): Promise<{ ok: boolean }>;
  appendLockerBlobChunk(options: { id: string; chunkBase64: string }): Promise<{ ok: boolean }>;
  finishLockerBlob(options: { id: string }): Promise<{ ok: boolean; contentUri: string }>;
  abortLockerBlob(options: { id: string }): Promise<{ ok: boolean }>;
  getLockerBlobUri(options: { id: string }): Promise<{ contentUri?: string }>;
  importLockerBlobFromPath(options: {
    id: string;
    sourcePath: string;
    mimeType?: string;
  }): Promise<{ ok: boolean; contentUri?: string; bytes?: number }>;
  auditLockerStorage(): Promise<{
    migrationRan?: boolean;
    durableBlobCount?: number;
    durableBlobBytes?: number;
    durableYtdlpCount?: number;
    durableYtdlpBytes?: number;
    cacheBlobCount?: number;
    cacheBlobBytes?: number;
    cacheYtdlpCount?: number;
    cacheYtdlpBytes?: number;
  }>;
  probeLocalFile(options: { path: string }): Promise<{ exists: boolean; bytes?: number }>;
  addListener(
    eventName: 'playbackEvent',
    listenerFunc: (event: NativeExoPlaybackEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export interface NativeExoPlaybackEvent {
  event: string;
  index?: number;
  queueLength?: number;
  reason?: number;
  url?: string;
}

export function isNativeExoQueueEndedEvent(
  evt: NativeExoPlaybackEvent,
): evt is NativeExoPlaybackEvent & { event: 'queueEnded' } {
  return evt.event === 'queueEnded';
}

const NativeExoPlayback = registerPlugin<NativeExoPlaybackPlugin>('NativeExoPlayback', {
  web: () => import('./androidNativePlayback.web').then((m) => new m.NativeExoPlaybackWeb()),
});

export { NativeExoPlayback };

export function isAndroidNativePlaybackPlatform(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/** True when ExoPlayer should decode (default ON; legacy WebView path opts out). */
export async function shouldPreferAndroidNativePlayback(): Promise<boolean> {
  if (!isAndroidNativePlaybackPlatform()) return false;
  if (loadAndroidWebViewCrossfadeEnabled()) return false;
  if (!loadAndroidNativePlaybackEnabled()) return false;
  const status = await NativeExoPlayback.getStatus();
  return status.available && status.wired;
}

export async function getNativeExoPlaybackStatus(): Promise<NativeExoPlaybackStatus> {
  if (!isAndroidNativePlaybackPlatform()) {
    return {
      available: false,
      wired: false,
      message: 'Native ExoPlayer playback is Android-only.',
    };
  }
  try {
    return await NativeExoPlayback.getStatus();
  } catch {
    return {
      available: false,
      wired: false,
      message: 'Native ExoPlayer plugin unavailable in this build.',
    };
  }
}

export async function prepareNativeExoPlayback(): Promise<{ ok: boolean; message: string }> {
  if (!isAndroidNativePlaybackPlatform()) {
    return { ok: false, message: 'Native ExoPlayer playback is Android-only.' };
  }
  if (loadAndroidWebViewCrossfadeEnabled()) {
    return { ok: false, message: 'Disable WebView crossfade playback to use ExoPlayer.' };
  }
  if (!loadAndroidNativePlaybackEnabled()) {
    return { ok: false, message: 'Enable native playback in Settings first.' };
  }
  try {
    return await NativeExoPlayback.prepare();
  } catch {
    return { ok: false, message: 'Native ExoPlayer plugin unavailable in this build.' };
  }
}

export async function nativeExoSetGaplessEnabled(enabled: boolean): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  try {
    await NativeExoPlayback.setGaplessEnabled({ enabled });
  } catch {
    /* optional */
  }
}

export async function nativeExoSetCrossfadeEnabled(enabled: boolean): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  try {
    await NativeExoPlayback.setCrossfadeEnabled({
      enabled,
      durationMs: Math.round(CROSSFADE_DURATION_SEC * 1000),
      gaplessDurationMs: 600,
    });
  } catch {
    /* optional */
  }
}

export async function nativeExoSetReplayGainDb(replayGainDb: number): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  try {
    await NativeExoPlayback.setReplayGainDb({ replayGainDb });
  } catch {
    /* optional */
  }
}

/** App volume 0–1.5 — values above 1.0 use Android LoudnessEnhancer (software boost). */
export async function nativeExoSetUserVolume(volume: number): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  const clamped = Math.max(0, Math.min(1.5, volume));
  try {
    await NativeExoPlayback.setUserVolume({ volume: clamped });
  } catch {
    /* optional */
  }
}

export async function nativeExoSetPlaybackSpeed(speed: number): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  const clamped = Math.max(0.5, Math.min(3, speed));
  try {
    await NativeExoPlayback.setPlaybackSpeed({ speed: clamped });
  } catch {
    /* optional */
  }
}

export async function nativeExoSetBitPerfectEnabled(enabled: boolean): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  try {
    await NativeExoPlayback.setBitPerfectEnabled({ enabled });
  } catch {
    /* optional */
  }
}

export async function nativeExoSetWiredDacStabilityEnabled(enabled: boolean): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  try {
    await NativeExoPlayback.setWiredDacStabilityEnabled({ enabled });
  } catch {
    /* optional */
  }
}

export async function getNativeExoUsbBitPerfectSupport(): Promise<{
  available: boolean;
  usbDacConnected: boolean;
  active: boolean;
  apiLevel: number;
} | null> {
  if (!isAndroidNativePlaybackPlatform()) return null;
  try {
    return await NativeExoPlayback.getUsbBitPerfectSupport();
  } catch {
    return null;
  }
}

/** Sync gapless, crossfade, and bit-perfect prefs with the native plugin. */
export async function syncNativeExoPlaybackPrefs(options: {
  gapless: boolean;
  crossfade: boolean;
  bitPerfect?: boolean;
}): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  await nativeExoSetGaplessEnabled(options.gapless);
  await nativeExoSetCrossfadeEnabled(options.crossfade);
  if (options.bitPerfect !== undefined) {
    await nativeExoSetBitPerfectEnabled(options.bitPerfect);
  } else {
    await nativeExoSetBitPerfectEnabled(loadAndroidUsbBitPerfectEnabled());
  }
}

export type NativeExoPlayMetadata = {
  envelopeId?: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  durationSeconds?: number;
  revision?: number;
};

async function waitForNativeExoPlaying(maxMs = 2500): Promise<void> {
  const deadline = Date.now() + maxMs;
  await nativeExoResume();
  while (Date.now() < deadline) {
    const status = await nativeExoPlaybackStatus();
    if (status.state === 'playing') return;
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  await nativeExoResume();
}

async function resolveNativeExoForegroundArtwork(
  artworkUrl?: string,
): Promise<string | undefined> {
  return resolveAndroidForegroundArtworkUrl(artworkUrl);
}

export async function nativeExoPlayUrl(
  url: string,
  options?: {
    autoPlay?: boolean;
    replayGainDb?: number;
    resetQueue?: boolean;
    gaplessEnabled?: boolean;
    crossfade?: boolean;
  } & NativeExoPlayMetadata,
): Promise<void> {
  const trimmed = url?.trim() ?? '';
  if (!trimmed || trimmed.startsWith('data:')) {
    throw new Error('Native ExoPlayer requires an HTTP(S), content://, or file:// stream URL.');
  }
  if (trimmed.startsWith('blob:')) {
    throw new Error('Resolve blob locker URLs via content:// or tier34 HTTP before ExoPlayer playback.');
  }
  if (!isNativeExoPlayableUrl(trimmed)) {
    throw new Error('Native ExoPlayer requires an HTTP(S), content://, or file:// stream URL.');
  }
  const proxied = wrapGoogleStreamForExo(trimmed);
  logSuspectPlaybackUrl(proxied, 'exo-play', options?.durationSeconds);
  const playUrl =
    /^https?:\/\//i.test(proxied) && proxied.includes('/api/')
      ? appendSandboxClientQuery(proxied)
      : proxied;
  const autoPlay = options?.autoPlay !== false;
  const artworkUrl = await resolveNativeExoForegroundArtwork(options?.artworkUrl);
  try {
    await NativeExoPlayback.playUrl({
      url: playUrl,
      autoPlay,
      replayGainDb: options?.replayGainDb,
      resetQueue: options?.resetQueue !== false,
      gaplessEnabled: options?.gaplessEnabled,
      crossfade: options?.crossfade,
      envelopeId: options?.envelopeId,
      title: options?.title,
      artist: options?.artist,
      album: options?.album,
      artworkUrl,
      durationSeconds: options?.durationSeconds,
    });
    if (autoPlay) {
      await waitForNativeExoPlaying();
    }
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function nativeExoEnqueueNext(
  url: string,
  options?: { replayGainDb?: number } & NativeExoPlayMetadata,
): Promise<void> {
  const trimmed = url?.trim() ?? '';
  if (!trimmed || !isNativeExoPlayableUrl(trimmed)) return;
  const proxied = wrapGoogleStreamForExo(trimmed);
  const playUrl =
    /^https?:\/\//i.test(proxied) && proxied.includes('/api/')
      ? appendSandboxClientQuery(proxied)
      : proxied;
  const artworkUrl = await resolveNativeExoForegroundArtwork(options?.artworkUrl);
  try {
    await NativeExoPlayback.enqueueNext({
      url: playUrl,
      replayGainDb: options?.replayGainDb,
      title: options?.title,
      artist: options?.artist,
      album: options?.album,
      artworkUrl,
    });
  } catch {
    /* optional preload */
  }
}

let playbackEventHandle: PluginListenerHandle | null = null;

/** Subscribe to ExoPlayer gapless queue transitions (mediaItemTransition). */
export async function initNativeExoPlaybackEvents(
  onTransition: (event: NativeExoPlaybackEvent) => void,
): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  await playbackEventHandle?.remove();
  playbackEventHandle = await NativeExoPlayback.addListener('playbackEvent', onTransition);
}

export async function teardownNativeExoPlaybackEvents(): Promise<void> {
  await playbackEventHandle?.remove();
  playbackEventHandle = null;
}

export async function nativeExoPause(): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  try {
    await NativeExoPlayback.pause();
  } catch {
    /* optional */
  }
}

export async function nativeExoResume(): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  try {
    await NativeExoPlayback.resume();
  } catch {
    /* optional */
  }
}

/**
 * Bind Exo to USB/wired output.
 * Soft (default): setPreferredAudioDevice only.
 * forceRestart: pause/resume while playing so hot-plug leaves the speaker.
 */
export async function nativeExoRerouteToWired(options?: {
  forceRestart?: boolean;
}): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  try {
    await NativeExoPlayback.rerouteToWiredOutput({
      forceRestart: options?.forceRestart === true,
    });
  } catch {
    /* optional */
  }
}

export async function nativeExoStop(): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  try {
    await NativeExoPlayback.stop();
  } catch {
    /* optional */
  }
}

export async function nativeExoSeek(seconds: number): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  try {
    await NativeExoPlayback.seek({ seconds });
  } catch {
    /* optional */
  }
}

/** Lock-screen / notification metadata for in-place queue seek (same stream URL). */
export async function nativeExoUpdateTrackMetadata(
  options: NativeExoPlayMetadata,
): Promise<void> {
  if (!isAndroidNativePlaybackPlatform()) return;
  try {
    const artworkUrl = await resolveAndroidForegroundArtworkUrl(options.artworkUrl);
    await NativeExoPlayback.updateTrackMetadata({
      envelopeId: options.envelopeId,
      title: options.title,
      artist: options.artist,
      album: options.album,
      artworkUrl,
      durationSeconds: options.durationSeconds,
      revision: options.revision ?? 0,
    });
  } catch {
    /* optional */
  }
}

type NativeExoStatusListener = (status: NativeExoPlaybackStatus) => void;

let sharedStatusPollId: number | null = null;
let sharedStatusSubscribers = 0;
let sharedStatusPollPlaying = false;
const nativeExoStatusListeners = new Set<NativeExoStatusListener>();

const NATIVE_EXO_POLL_MS_IDLE = 1200;
const NATIVE_EXO_POLL_MS_ACTIVE = 450;
const NATIVE_EXO_POLL_MS_IDLE_SAVER = 2800;
const NATIVE_EXO_POLL_MS_ACTIVE_SAVER = 1100;

function scheduleSharedNativeExoStatusPoll(): void {
  if (sharedStatusPollId !== null) {
    window.clearInterval(sharedStatusPollId);
    sharedStatusPollId = null;
  }
  const saver = isBatterySaverEnabled();
  const ms = sharedStatusPollPlaying
    ? saver
      ? NATIVE_EXO_POLL_MS_ACTIVE_SAVER
      : NATIVE_EXO_POLL_MS_ACTIVE
    : saver
      ? NATIVE_EXO_POLL_MS_IDLE_SAVER
      : NATIVE_EXO_POLL_MS_IDLE;
  sharedStatusPollId = window.setInterval(() => void tickSharedNativeExoStatus(), ms);
}

async function tickSharedNativeExoStatus(): Promise<void> {
  if (nativeExoStatusListeners.size === 0) return;
  const status = await nativeExoPlaybackStatus();
  const playing = status.state === 'playing' || status.state === 'loading';
  if (playing !== sharedStatusPollPlaying) {
    sharedStatusPollPlaying = playing;
    scheduleSharedNativeExoStatusPoll();
  }
  for (const listener of nativeExoStatusListeners) {
    listener(status);
  }
}

function ensureSharedNativeExoStatusPoll(): void {
  if (sharedStatusPollId !== null) return;
  sharedStatusPollPlaying = false;
  scheduleSharedNativeExoStatusPoll();
  void tickSharedNativeExoStatus();
}

function stopSharedNativeExoStatusPollIfIdle(): void {
  if (sharedStatusSubscribers > 0 || sharedStatusPollId === null) return;
  window.clearInterval(sharedStatusPollId);
  sharedStatusPollId = null;
}

/** Single shared Exo status poll — avoids duplicate 250/400ms bridge timers. */
export function subscribeNativeExoStatus(listener: NativeExoStatusListener): () => void {
  if (!isAndroidNativePlaybackPlatform()) return () => {};
  nativeExoStatusListeners.add(listener);
  sharedStatusSubscribers += 1;
  ensureSharedNativeExoStatusPoll();
  void nativeExoPlaybackStatus().then(listener);
  return () => {
    nativeExoStatusListeners.delete(listener);
    sharedStatusSubscribers = Math.max(0, sharedStatusSubscribers - 1);
    stopSharedNativeExoStatusPollIfIdle();
  };
}

export async function nativeExoPlaybackStatus(): Promise<NativeExoPlaybackStatus> {
  try {
    return await NativeExoPlayback.getStatus();
  } catch {
    return {
      available: false,
      wired: false,
      message: 'Native ExoPlayer plugin unavailable in this build.',
    };
  }
}

/** Map native status → HTMLAudioElement-like FSM labels used by sandboxLayer1. */
export function mapNativeExoStateToFsm(
  state: NonNullable<NativeExoPlaybackStatus['state']>,
): 'Idle' | 'Resolving' | 'Connecting' | 'Ready' | 'Playing' | 'Failed' {
  switch (state) {
    case 'loading':
      return 'Connecting';
    case 'playing':
      return 'Playing';
    case 'paused':
      return 'Ready';
    case 'error':
      return 'Failed';
    case 'stopped':
    case 'idle':
      return 'Idle';
    default:
      return 'Idle';
  }
}
