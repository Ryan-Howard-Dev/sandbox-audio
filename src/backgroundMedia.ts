/**
 * Android background playback bridge — foreground MediaSession service.
 *
 * HTML5 audio still runs in the WebView; native code keeps the process alive,
 * shows lock-screen / notification controls, handles audio focus, and forwards
 * headset / OS media keys to the existing audio engine via `mediaAction` events.
 *
 * Limitations (see docs/android-playback.md):
 * - Bit-perfect / gapless crossfade still uses Web Audio in the WebView.
 * - Reliable background on aggressive OEM ROMs may eventually need native ExoPlayer.
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { MediaSessionTrackMetadata } from './keyboardShortcuts';
import {
  loadAndroidMiniPlayerMode,
  type AndroidMiniPlayerMode,
} from './androidMiniPlayerSettings';
import { isBatterySaverEnabled } from './batterySaverSettings';
import { resolveAppProxyUrl } from './catalogDirect';
import { canonicalArtworkSrc, proxiedArtworkUrl } from './displaySanitize';

export type BackgroundMediaAction =
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'seekBackward'
  | 'seekForward'
  | 'seekTo';

export type AndroidAudioOutputRoute = 'speaker' | 'bluetooth' | 'wired' | 'unknown';

export interface AndroidAudioSessionConfig {
  route: AndroidAudioOutputRoute;
  audioFocusGranted: boolean;
}

export interface BackgroundMediaActionEvent {
  action: BackgroundMediaAction;
  positionMs?: number;
}

export interface BackgroundMediaRouteChangeEvent {
  route: AndroidAudioOutputRoute;
  reason?: string;
}

export interface BackgroundMediaPlugin {
  initialize(options?: { stayAliveOnMinimize?: boolean }): Promise<void>;
  configureAudioSession(): Promise<AndroidAudioSessionConfig>;
  getAudioOutputRoute(): Promise<{ route: AndroidAudioOutputRoute }>;
  startAudioRouteWatcher(): Promise<void>;
  stopAudioRouteWatcher(): Promise<void>;
  setWiredDacStabilityEnabled(options: { enabled: boolean }): Promise<void>;
  startForeground(): Promise<void>;
  stopForeground(): Promise<void>;
  updateMetadata(options: {
    title: string;
    artist: string;
    album?: string;
    artworkUrl?: string;
    envelopeId?: string;
    revision?: number;
  }): Promise<void>;
  updatePlaybackState(options: {
    isPlaying: boolean;
    positionMs?: number;
    durationMs?: number;
    playbackRate?: number;
    revision?: number;
  }): Promise<void>;
  setMiniPlayerMode(options: { mode: AndroidMiniPlayerMode }): Promise<void>;
  enterPictureInPicture(): Promise<void>;
  requestBatteryOptimizationExemption(): Promise<{ granted: boolean }>;
  addListener(
    eventName: 'mediaAction',
    listenerFunc: (event: BackgroundMediaActionEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'audioRouteChange',
    listenerFunc: (event: BackgroundMediaRouteChangeEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export const BackgroundMedia = registerPlugin<BackgroundMediaPlugin>('BackgroundMedia', {
  web: () => import('./backgroundMedia.web').then((m) => new m.BackgroundMediaWeb()),
});

let initialized = false;
let listenerHandle: PluginListenerHandle | null = null;
let batteryRequested = false;
let syncedMiniPlayerMode: AndroidMiniPlayerMode | null = null;
let audioSessionConfigured = false;
let cachedAudioRoute: AndroidAudioOutputRoute = 'unknown';
let metadataSyncGeneration = 0;
let lastSyncedMetadataKey = '';
let lastMetadataRevision = 0;

/** Strictly monotonic revision shared with MediaPlaybackForegroundService.applyMetadataRevision. */
export function nextAndroidMediaMetadataRevision(): number {
  let next = Date.now();
  if (next <= lastMetadataRevision) next = lastMetadataRevision + 1;
  lastMetadataRevision = next;
  return next;
}

async function blobUrlToDataUrl(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/** Resolve locker blob / proxy art to a URL native MediaSession can decode. */
export async function resolveAndroidForegroundArtworkUrl(
  artUrl?: string,
): Promise<string | undefined> {
  const trimmed = artUrl?.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith('blob:')) {
    return blobUrlToDataUrl(trimmed);
  }
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }
  if (trimmed.startsWith('content://') || trimmed.startsWith('file://')) {
    return trimmed;
  }

  let resolved = canonicalArtworkSrc(trimmed) ?? trimmed;
  resolved = proxiedArtworkUrl(resolved) ?? resolved;

  if (resolved.startsWith('/')) {
    resolved = resolveAppProxyUrl(resolved);
    if (resolved.startsWith('/') && typeof window !== 'undefined') {
      resolved = `${window.location.origin}${resolved}`;
    }
  }

  return /^https?:\/\//i.test(resolved) ? resolved : undefined;
}

function metadataIdentityKey(metadata: MediaSessionTrackMetadata): string {
  return [
    metadata.envelopeId ?? '',
    metadata.title,
    metadata.artist,
    metadata.album ?? '',
    metadata.artworkUrl ?? '',
  ].join('\u0001');
}

export function isAndroidBackgroundMediaAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/** Human-readable label for Settings → Playback audio output row. */
export function formatAndroidAudioOutputRoute(route: AndroidAudioOutputRoute): string {
  switch (route) {
    case 'speaker':
      return 'Phone speaker';
    case 'bluetooth':
      return 'Bluetooth';
    case 'wired':
      return 'Wired headphones';
    default:
      return 'Unknown';
  }
}

export function getCachedAndroidAudioOutputRoute(): AndroidAudioOutputRoute {
  return cachedAudioRoute;
}

/**
 * Configure STREAM_MUSIC volume keys, MODE_NORMAL routing, and audio focus before WebView play.
 * Safe to call multiple times; no-op on web/desktop.
 */
export async function configureAndroidAudioSession(): Promise<AndroidAudioSessionConfig | null> {
  if (!isAndroidBackgroundMediaAvailable()) return null;
  try {
    const result = await BackgroundMedia.configureAudioSession();
    cachedAudioRoute = result.route;
    audioSessionConfigured = true;
    return result;
  } catch {
    return null;
  }
}

export async function getAndroidAudioOutputRoute(): Promise<AndroidAudioOutputRoute> {
  if (!isAndroidBackgroundMediaAvailable()) return 'unknown';
  try {
    const result = await BackgroundMedia.getAudioOutputRoute();
    cachedAudioRoute = result.route;
    return result.route;
  } catch {
    return cachedAudioRoute;
  }
}

export async function startAndroidAudioRouteWatcher(): Promise<void> {
  if (!isAndroidBackgroundMediaAvailable()) return;
  try {
    await BackgroundMedia.startAudioRouteWatcher();
  } catch {
    /* optional */
  }
}

export async function stopAndroidAudioRouteWatcher(): Promise<void> {
  if (!isAndroidBackgroundMediaAvailable()) return;
  try {
    await BackgroundMedia.stopAudioRouteWatcher();
  } catch {
    /* optional */
  }
}

export async function syncAndroidWiredDacStabilityNative(enabled: boolean): Promise<void> {
  if (!isAndroidBackgroundMediaAvailable()) return;
  try {
    await BackgroundMedia.setWiredDacStabilityEnabled({ enabled });
  } catch {
    /* optional */
  }
}

export async function initAndroidBackgroundMedia(
  onAction: (event: BackgroundMediaActionEvent) => void,
): Promise<void> {
  if (!isAndroidBackgroundMediaAvailable() || initialized) return;

  await BackgroundMedia.initialize({ stayAliveOnMinimize: true });
  await configureAndroidAudioSession();
  listenerHandle = await BackgroundMedia.addListener('mediaAction', (event) => {
    onAction(event);
  });
  initialized = true;
}

export async function teardownAndroidBackgroundMedia(): Promise<void> {
  if (!initialized) return;
  await listenerHandle?.remove();
  listenerHandle = null;
  await BackgroundMedia.stopForeground().catch(() => {});
  initialized = false;
}

export async function syncAndroidMiniPlayerMode(
  mode: AndroidMiniPlayerMode = loadAndroidMiniPlayerMode(),
): Promise<void> {
  if (!isAndroidBackgroundMediaAvailable()) return;
  if (syncedMiniPlayerMode === mode) return;
  syncedMiniPlayerMode = mode;
  await BackgroundMedia.setMiniPlayerMode({ mode }).catch(() => {});
}

export async function enterAndroidPictureInPicture(): Promise<void> {
  if (!isAndroidBackgroundMediaAvailable()) return;
  await BackgroundMedia.enterPictureInPicture().catch(() => {});
}

export async function syncAndroidBackgroundMedia(
  metadata: MediaSessionTrackMetadata | null,
  isPlaying: boolean,
  positionMs: number,
  durationMs: number,
  options?: { nativeExoActive?: boolean },
): Promise<void> {
  if (!isAndroidBackgroundMediaAvailable()) return;

  const syncGeneration = ++metadataSyncGeneration;
  const nativeExoActive = options?.nativeExoActive === true;

  if (isPlaying && !audioSessionConfigured) {
    await configureAndroidAudioSession();
  }

  if (syncGeneration !== metadataSyncGeneration) return;

  await syncAndroidMiniPlayerMode();

  if (syncGeneration !== metadataSyncGeneration) return;

  if (!metadata?.title) {
    if (nativeExoActive) {
      // Native Exo owns lock-screen metadata while WebView timers freeze.
      return;
    }
    lastSyncedMetadataKey = '';
    await BackgroundMedia.stopForeground().catch(() => {});
    return;
  }

  if (!isPlaying && isBatterySaverEnabled()) {
    if (nativeExoActive) {
      return;
    }
    await BackgroundMedia.stopForeground().catch(() => {});
    return;
  }

  await BackgroundMedia.startForeground().catch(() => {});

  if (syncGeneration !== metadataSyncGeneration) return;

  if (syncGeneration !== metadataSyncGeneration) return;

  const metadataKey = metadataIdentityKey(metadata);
  const metadataChanged = metadataKey !== lastSyncedMetadataKey;
  if (metadataChanged) {
    const artworkUrl = await resolveAndroidForegroundArtworkUrl(metadata.artworkUrl);
    if (syncGeneration !== metadataSyncGeneration) return;
    if (nativeExoActive) {
      const { nativeExoUpdateTrackMetadata } = await import('./androidNativePlayback');
      await nativeExoUpdateTrackMetadata({
        envelopeId: metadata.envelopeId,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        artworkUrl,
        revision: 0,
      });
    } else {
      const revision = nextAndroidMediaMetadataRevision();
      await BackgroundMedia.updateMetadata({
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        artworkUrl,
        envelopeId: metadata.envelopeId,
        revision,
      });
    }
    if (syncGeneration !== metadataSyncGeneration) return;
    lastSyncedMetadataKey = metadataKey;
  }

  const playbackRevision = nativeExoActive
    ? 0
    : nextAndroidMediaMetadataRevision();
  await BackgroundMedia.updatePlaybackState({
    isPlaying,
    positionMs: Math.max(0, Math.round(positionMs)),
    durationMs: Math.max(0, Math.round(durationMs)),
    playbackRate: 1,
    revision: playbackRevision,
  });

  if (!batteryRequested && isPlaying) {
    batteryRequested = true;
    await BackgroundMedia.requestBatteryOptimizationExemption().catch(() => ({
      granted: false,
    }));
  }
}
