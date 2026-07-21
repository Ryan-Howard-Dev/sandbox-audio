/**
 * Cast Web Sender — device picker, media load, and visualizer sync.
 */

import {
  castBlockMessage,
  getCastBlockReason,
  isWebCastSenderSupported,
  isNativeAndroidCastRuntime,
  type CastBlockReason,
} from './castPlatform';
import { isCastAccessibleUrl } from './castStreamResolver';
import type { CinemaCastPayload } from './cinemaCast';
import {
  endNativeCastSession,
  getNativeCastDeviceName,
  getNativeCastSessionState,
  initNativeCast,
  isNativeCastConnected,
  requestNativeCastSession,
  subscribeNativeCastSession,
  syncNativeCastPlayback,
  type NativeCastQueueItem,
} from './nativeCast';

export const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';
export const CAST_VISUALIZER_NAMESPACE = 'urn:x-cast:com.sovereign.cinemacast';

const CAST_SDK_URL =
  'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

/** Optional custom receiver App ID from Cast Developer Console (enables TV visualizer). */
const CUSTOM_RECEIVER_APP_ID =
  (import.meta.env.VITE_CAST_RECEIVER_APP_ID as string | undefined)?.trim() || '';

export type CastSessionState = {
  connected: boolean;
  deviceName: string | null;
  sessionState: string;
};

export type CastErrorCode =
  | CastBlockReason
  | 'sdk_load_timeout'
  | 'sdk_unavailable'
  | 'init_failed'
  | 'cancelled'
  | 'no_session'
  | 'request_failed';

export type CastResult = {
  ok: boolean;
  error?: string;
  code?: CastErrorCode;
};

let lastInitError: CastResult | null = null;
let lastSessionError: CastResult | null = null;

let sdkInitPromise: Promise<CastResult> | null = null;
let initialized = false;
let remoteMediaClient: cast.framework.RemoteMediaClient | null = null;
let lastLoadedStreamUrl = '';
let lastPlayState: boolean | null = null;
let lastSeekSeconds = -1;

const sessionListeners = new Set<(state: CastSessionState) => void>();
let sessionState: CastSessionState = {
  connected: false,
  deviceName: null,
  sessionState: 'NO_SESSION',
};

function notifySession(): void {
  for (const listener of sessionListeners) listener({ ...sessionState });
}

function receiverAppId(): string {
  return CUSTOM_RECEIVER_APP_ID || DEFAULT_MEDIA_RECEIVER_APP_ID;
}

function usesCustomReceiver(): boolean {
  return Boolean(CUSTOM_RECEIVER_APP_ID);
}

export function getCastReceiverAppId(): string {
  return receiverAppId();
}

export function hasCustomCastReceiver(): boolean {
  return usesCustomReceiver();
}

export function isCastSdkSupported(): boolean {
  return isNativeAndroidCastRuntime() || isWebCastSenderSupported();
}

export function getCastUnsupportedMessage(): string | null {
  const reason = getCastBlockReason();
  return reason ? castBlockMessage(reason) : null;
}

export function getLastCastInitError(): CastResult | null {
  return lastInitError;
}

export function getLastCastSessionError(): CastResult | null {
  return lastSessionError;
}

function fail(
  code: CastErrorCode,
  message: string,
  target: 'init' | 'session',
): CastResult {
  const result: CastResult = { ok: false, code, error: message };
  if (target === 'init') lastInitError = result;
  else lastSessionError = result;
  return result;
}

function parseSessionError(err: unknown): CastResult {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();
  if (
    lower.includes('cancel') ||
    lower.includes('abort') ||
    lower.includes('user') ||
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      String((err as { code: unknown }).code).toLowerCase().includes('cancel'))
  ) {
    return fail('cancelled', 'Cast picker cancelled — no device selected.', 'session');
  }
  if (lower.includes('timeout')) {
    return fail('sdk_load_timeout', 'Cast SDK timed out. Check Wi‑Fi and try again.', 'session');
  }
  return fail(
    'request_failed',
    raw.trim() || 'Could not open the Sandbox Cast device picker. Use Chrome on the same Wi‑Fi as your TV.',
    'session',
  );
}

function loadCastSdkScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.cast?.framework) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="cast_sender.js"]',
    );
    if (existing) {
      const deadline = Date.now() + 15_000;
      const wait = () => {
        if (window.cast?.framework) resolve();
        else if (Date.now() > deadline) reject(new Error('Cast SDK load timeout'));
        else setTimeout(wait, 50);
      };
      wait();
      return;
    }

    window.__onGCastApiAvailable = (isAvailable) => {
      if (isAvailable) resolve();
      else reject(new Error('Cast API unavailable'));
    };

    const script = document.createElement('script');
    script.src = CAST_SDK_URL;
    script.async = true;
    script.dataset.sovereignCastSdk = '1';
    script.onerror = () => reject(new Error('Failed to load Cast SDK'));
    document.head.appendChild(script);
  });
}

function bindCastContextEvents(ctx: cast.framework.CastContext): void {
  const onSession = (ev: cast.framework.CastSessionEvent) => {
    const state = ev.sessionState;
    sessionState.sessionState = state;

    if (
      state === cast.framework.SessionState.SESSION_STARTED ||
      state === cast.framework.SessionState.SESSION_RESUMED
    ) {
      const session = ctx.getCurrentSession();
      sessionState.connected = true;
      sessionState.deviceName = session?.getCastDevice()?.friendlyName ?? 'Cast device';
      remoteMediaClient = null;
      lastLoadedStreamUrl = '';
      lastPlayState = null;
      lastSeekSeconds = -1;
    } else if (
      state === cast.framework.SessionState.SESSION_ENDED ||
      state === cast.framework.SessionState.NO_SESSION
    ) {
      sessionState.connected = false;
      sessionState.deviceName = null;
      remoteMediaClient = null;
      lastLoadedStreamUrl = '';
      lastPlayState = null;
      lastSeekSeconds = -1;
    }

    notifySession();
  };

  ctx.addEventListener(
    cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
    onSession,
  );
}

export async function initCastSender(): Promise<CastResult> {
  if (isNativeAndroidCastRuntime()) {
    const result = await initNativeCast(receiverAppId());
    if (!result.ok) {
      return fail(
        'init_failed',
        result.error ?? 'Native Cast initialization failed',
        'init',
      );
    }
    lastInitError = null;
    return { ok: true };
  }

  const block = getCastBlockReason();
  if (block) {
    return fail(block, castBlockMessage(block), 'init');
  }
  if (initialized) {
    lastInitError = null;
    return { ok: true };
  }
  if (sdkInitPromise) return sdkInitPromise;

  sdkInitPromise = (async (): Promise<CastResult> => {
    try {
      await loadCastSdkScript();
      if (!window.cast?.framework) {
        return fail(
          'sdk_unavailable',
          'Cast SDK did not load. Use Chrome or Edge on the same Wi‑Fi as your TV.',
          'init',
        );
      }
      const ctx = window.cast.framework.CastContext.getInstance();
      ctx.setOptions({
        receiverApplicationId: receiverAppId(),
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        language: 'en-US',
        resumeSavedSession: true,
      });
      bindCastContextEvents(ctx);
      initialized = true;
      lastInitError = null;
      return { ok: true };
    } catch (err) {
      console.warn('[castSender] init failed:', err);
      const message =
        err instanceof Error ? err.message : 'Cast SDK initialization failed';
      if (message.toLowerCase().includes('timeout')) {
        return fail(
          'sdk_load_timeout',
          'Cast SDK timed out. Ensure phone/PC and TV are on the same Wi‑Fi subnet.',
          'init',
        );
      }
      return fail(
        'init_failed',
        message || 'Cast SDK initialization failed. Use Chrome on the same Wi‑Fi as your TV.',
        'init',
      );
    }
  })();

  return sdkInitPromise;
}

export function getCastSessionState(): CastSessionState {
  if (isNativeAndroidCastRuntime()) {
    const native = getNativeCastSessionState();
    return {
      connected: native.connected,
      deviceName: native.deviceName,
      sessionState: native.sessionState,
    };
  }
  return { ...sessionState };
}

export function subscribeCastSession(
  handler: (state: CastSessionState) => void,
): () => void {
  if (isNativeAndroidCastRuntime()) {
    return subscribeNativeCastSession((native) => {
      handler({
        connected: native.connected,
        deviceName: native.deviceName,
        sessionState: native.sessionState,
      });
    });
  }
  sessionListeners.add(handler);
  handler({ ...sessionState });
  return () => sessionListeners.delete(handler);
}

export function isCastConnected(): boolean {
  if (isNativeAndroidCastRuntime()) return isNativeCastConnected();
  return sessionState.connected;
}

export function getCastDeviceName(): string | null {
  if (isNativeAndroidCastRuntime()) return getNativeCastDeviceName();
  return sessionState.deviceName;
}

export async function requestCastSession(): Promise<CastResult> {
  if (isNativeAndroidCastRuntime()) {
    const init = await initCastSender();
    if (!init.ok) return init;
    const result = await requestNativeCastSession();
    if (result.ok) {
      lastSessionError = null;
      return { ok: true };
    }
    const code = (result.code as CastErrorCode | undefined) ?? 'request_failed';
    return fail(code, result.error ?? 'Could not connect to Sandbox Cast device', 'session');
  }

  const init = await initCastSender();
  if (!init.ok) return init;

  try {
    const ctx = window.cast!.framework.CastContext.getInstance();
    await ctx.requestSession();
    const session = ctx.getCurrentSession();
    if (session) {
      sessionState.connected = true;
      sessionState.deviceName = session.getCastDevice()?.friendlyName ?? 'Cast device';
      sessionState.sessionState = cast.framework.SessionState.SESSION_STARTED;
      notifySession();
      lastSessionError = null;
      return { ok: true };
    }
    return fail(
      'no_session',
      'No Sandbox Cast device selected. Pick a receiver in the picker.',
      'session',
    );
  } catch (err) {
    console.warn('[castSender] requestSession declined or failed:', err);
    return parseSessionError(err);
  }
}

export function endCastSession(): void {
  if (isNativeAndroidCastRuntime()) {
    void endNativeCastSession();
    return;
  }
  if (!initialized || !window.cast?.framework) return;
  try {
    window.cast.framework.CastContext.getInstance().endSession(true);
  } catch {
    /* already ended */
  }
  sessionState.connected = false;
  sessionState.deviceName = null;
  sessionState.sessionState = cast.framework.SessionState.SESSION_ENDED;
  remoteMediaClient = null;
  lastLoadedStreamUrl = '';
  lastPlayState = null;
  lastSeekSeconds = -1;
  notifySession();
}

export function absoluteCastUrl(url: string): string {
  if (!url?.trim()) return url;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (typeof window === 'undefined') return trimmed;
  const origin = window.location.origin;
  return trimmed.startsWith('/') ? `${origin}${trimmed}` : `${origin}/${trimmed}`;
}

function guessContentType(url: string): string {
  const lower = url.split('?')[0].toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.aac')) return 'audio/aac';
  return 'audio/mpeg';
}

function buildMediaInfo(payload: CinemaCastPayload) {
  const streamUrl = absoluteCastUrl(payload.streamUrl ?? '');
  const mediaInfo = new chrome.cast.media.MediaInfo(
    streamUrl,
    guessContentType(streamUrl),
  );
  mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;
  if (payload.durationSeconds > 0) {
    mediaInfo.duration = payload.durationSeconds;
  }

  const meta = new chrome.cast.media.MusicTrackMediaMetadata();
  meta.metadataType = chrome.cast.media.MetadataType.MUSIC_TRACK;
  meta.title = payload.title;
  meta.songName = payload.title;
  meta.artist = payload.artist;
  meta.artistName = payload.artist;
  if (payload.albumArt) {
    meta.images = [new chrome.cast.media.Image(absoluteCastUrl(payload.albumArt))];
  }
  mediaInfo.metadata = meta;
  return mediaInfo;
}

async function ensureRemoteClient(): Promise<cast.framework.RemoteMediaClient | null> {
  const ctx = window.cast?.framework.CastContext.getInstance();
  const session = ctx?.getCurrentSession();
  if (!session) return null;
  if (remoteMediaClient) return remoteMediaClient;
  return null;
}

export async function syncCastPlayback(
  payload: CinemaCastPayload & {
    album?: string;
    queue?: NativeCastQueueItem[];
    queueIndex?: number;
  },
): Promise<void> {
  if (isNativeAndroidCastRuntime()) {
    if (!isNativeCastConnected()) return;
    const streamUrl = payload.streamUrl?.trim();
    if (streamUrl && !isCastAccessibleUrl(absoluteCastUrl(streamUrl))) {
      return;
    }
    await syncNativeCastPlayback(payload);
    return;
  }

  if (!sessionState.connected || !initialized || !window.cast?.framework) return;

  const ctx = window.cast.framework.CastContext.getInstance();
  const session = ctx.getCurrentSession();
  if (!session) return;

  const streamUrl = payload.streamUrl?.trim();
  if (streamUrl && !isCastAccessibleUrl(absoluteCastUrl(streamUrl))) {
    if (usesCustomReceiver()) {
      sendCastVisualizerState(payload);
    }
    return;
  }

  const shouldPlayMedia = Boolean(streamUrl) && payload.isPlaying;

  if (shouldPlayMedia) {
    const absUrl = absoluteCastUrl(streamUrl!);
    if (absUrl !== lastLoadedStreamUrl) {
      try {
        const request = new chrome.cast.media.LoadRequest(buildMediaInfo(payload));
        request.autoplay = true;
        request.currentTime = payload.currentTimeSeconds;
        remoteMediaClient = await session.loadMedia(request);
        lastLoadedStreamUrl = absUrl;
        lastPlayState = true;
        lastSeekSeconds = payload.currentTimeSeconds;
      } catch (err) {
        console.warn('[castSender] loadMedia failed:', err);
      }
      return;
    }

    const client = remoteMediaClient ?? (await ensureRemoteClient());
    if (!client) return;

    try {
      if (payload.isPlaying !== lastPlayState) {
        if (payload.isPlaying) await client.play();
        else await client.pause();
        lastPlayState = payload.isPlaying;
      }

      const seekDelta = Math.abs(payload.currentTimeSeconds - lastSeekSeconds);
      if (seekDelta > 2 && payload.durationSeconds > 0) {
        await client.seek({ currentTime: payload.currentTimeSeconds });
        lastSeekSeconds = payload.currentTimeSeconds;
      }
    } catch (err) {
      console.warn('[castSender] playback sync failed:', err);
    }
    return;
  }

  if (usesCustomReceiver()) {
    sendCastVisualizerState(payload);
    return;
  }

  if (streamUrl && !payload.isPlaying && absUrlChanged(streamUrl, payload)) {
    try {
      const request = new chrome.cast.media.LoadRequest(buildMediaInfo(payload));
      request.autoplay = false;
      request.currentTime = payload.currentTimeSeconds;
      remoteMediaClient = await session.loadMedia(request);
      lastLoadedStreamUrl = absoluteCastUrl(streamUrl);
      lastPlayState = false;
      lastSeekSeconds = payload.currentTimeSeconds;
      if (!payload.isPlaying) await remoteMediaClient.pause();
    } catch (err) {
      console.warn('[castSender] paused metadata load failed:', err);
    }
  }
}

function absUrlChanged(streamUrl: string, payload: CinemaCastPayload): boolean {
  return absoluteCastUrl(streamUrl) !== lastLoadedStreamUrl;
}

export function sendCastVisualizerState(payload: CinemaCastPayload): void {
  if (!sessionState.connected || !usesCustomReceiver()) return;
  const ctx = window.cast?.framework.CastContext.getInstance();
  const session = ctx?.getCurrentSession();
  if (!session) return;

  const message = {
    type: 'visualizer',
    title: payload.title,
    artist: payload.artist,
    albumArt: payload.albumArt ? absoluteCastUrl(payload.albumArt) : undefined,
    isPlaying: payload.isPlaying,
    currentTimeSeconds: payload.currentTimeSeconds,
    durationSeconds: payload.durationSeconds,
    fidelity: payload.fidelity,
  };

  session.sendMessage(CAST_VISUALIZER_NAMESPACE, message).catch((err) => {
    console.warn('[castSender] visualizer message failed:', err);
  });
}
