/**
 * Android native Cast bridge — Capacitor plugin wrapping Cast SDK.
 * Used instead of the Web Sender SDK inside the Capacitor WebView.
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { CinemaCastPayload } from './cinemaCast';

export type NativeCastSessionState = {
  connected: boolean;
  deviceName: string | null;
  sessionState: string;
};

export type NativeCastQueueItem = {
  streamUrl: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationSeconds?: number;
};

export type NativeCastResult = {
  ok: boolean;
  error?: string;
  code?: string;
  deviceName?: string;
};

export interface NativeCastPlugin {
  initialize(options: { receiverApplicationId?: string }): Promise<{ ok: boolean; error?: string }>;
  isAvailable(): Promise<{ available: boolean }>;
  showDevicePicker(): Promise<void>;
  requestSession(): Promise<NativeCastResult>;
  endSession(): Promise<void>;
  syncPlayback(options: {
    streamUrl?: string;
    title: string;
    artist: string;
    album?: string;
    artworkUrl?: string;
    isPlaying: boolean;
    currentTimeSeconds: number;
    durationSeconds: number;
    queue?: NativeCastQueueItem[];
    queueIndex?: number;
  }): Promise<void>;
  addListener(
    eventName: 'sessionStateChanged',
    listenerFunc: (state: NativeCastSessionState) => void,
  ): Promise<PluginListenerHandle>;
}

const NativeCast = registerPlugin<NativeCastPlugin>('NativeCast', {
  web: () => import('./nativeCast.web').then((m) => new m.NativeCastWeb()),
});

let initialized = false;
let initPromise: Promise<NativeCastResult> | null = null;
let listenerHandle: PluginListenerHandle | null = null;

const sessionListeners = new Set<(state: NativeCastSessionState) => void>();
let sessionState: NativeCastSessionState = {
  connected: false,
  deviceName: null,
  sessionState: 'NO_SESSION',
};

function notifySession(): void {
  for (const listener of sessionListeners) listener({ ...sessionState });
}

export function isNativeCastPlatform(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export function isNativeCastSupported(): boolean {
  return isNativeCastPlatform();
}

export async function probeNativeCastAvailable(): Promise<boolean> {
  if (!isNativeCastPlatform()) return false;
  try {
    const { available } = await NativeCast.isAvailable();
    return available;
  } catch {
    return false;
  }
}

export async function initNativeCast(receiverApplicationId?: string): Promise<NativeCastResult> {
  if (!isNativeCastPlatform()) {
    return { ok: false, error: 'Native Cast is Android-only', code: 'unsupported' };
  }
  if (initialized) return { ok: true };
  if (initPromise) return initPromise;

  initPromise = (async (): Promise<NativeCastResult> => {
    try {
      const result = await NativeCast.initialize({ receiverApplicationId });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error ?? 'Sandbox Cast unavailable on this device',
          code: 'init_failed',
        };
      }
      if (!listenerHandle) {
        listenerHandle = await NativeCast.addListener('sessionStateChanged', (state) => {
          sessionState = {
            connected: Boolean(state.connected),
            deviceName: state.deviceName ?? null,
            sessionState: state.sessionState ?? 'NO_SESSION',
          };
          notifySession();
        });
      }
      initialized = true;
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Native Cast initialization failed';
      return { ok: false, error: message, code: 'init_failed' };
    }
  })();

  return initPromise;
}

export function getNativeCastSessionState(): NativeCastSessionState {
  return { ...sessionState };
}

export function subscribeNativeCastSession(
  handler: (state: NativeCastSessionState) => void,
): () => void {
  sessionListeners.add(handler);
  handler({ ...sessionState });
  return () => sessionListeners.delete(handler);
}

export function isNativeCastConnected(): boolean {
  return sessionState.connected;
}

export function getNativeCastDeviceName(): string | null {
  return sessionState.deviceName;
}

export async function requestNativeCastSession(): Promise<NativeCastResult> {
  const init = await initNativeCast();
  if (!init.ok) return init;

  try {
    const result = await NativeCast.requestSession();
    if (result.ok && result.deviceName) {
      sessionState = {
        connected: true,
        deviceName: result.deviceName,
        sessionState: 'STARTED',
      };
      notifySession();
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cast session request failed';
    return { ok: false, error: message, code: 'request_failed' };
  }
}

export async function showNativeCastDevicePicker(): Promise<void> {
  const init = await initNativeCast();
  if (!init.ok) throw new Error(init.error ?? 'Native Cast unavailable');
  await NativeCast.showDevicePicker();
}

export async function endNativeCastSession(): Promise<void> {
  if (!isNativeCastPlatform()) return;
  try {
    await NativeCast.endSession();
  } catch {
    /* already ended */
  }
  sessionState = {
    connected: false,
    deviceName: null,
    sessionState: 'ENDED',
  };
  notifySession();
}

export async function syncNativeCastPlayback(
  payload: CinemaCastPayload & {
    album?: string;
    queue?: NativeCastQueueItem[];
    queueIndex?: number;
  },
): Promise<void> {
  if (!sessionState.connected || !isNativeCastPlatform()) return;

  await NativeCast.syncPlayback({
    streamUrl: payload.streamUrl,
    title: payload.title,
    artist: payload.artist,
    album: payload.album,
    artworkUrl: payload.albumArt,
    isPlaying: payload.isPlaying,
    currentTimeSeconds: payload.currentTimeSeconds,
    durationSeconds: payload.durationSeconds,
    queue: payload.queue,
    queueIndex: payload.queueIndex,
  }).catch((err) => {
    console.warn('[nativeCast] syncPlayback failed:', err);
  });
}
