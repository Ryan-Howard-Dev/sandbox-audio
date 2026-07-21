/**
 * Cinema Cast — remote cast (primary) plus Presentation API / overlay fallback.
 * State syncs over BroadcastChannel for screen-mirror modes.
 */

import {
  endCastSession,
  getCastDeviceName,
  getCastSessionState,
  hasCustomCastReceiver,
  getCastUnsupportedMessage,
  initCastSender,
  isCastConnected,
  isCastSdkSupported,
  requestCastSession,
  subscribeCastSession as subscribeCastDeviceSession,
  syncCastPlayback,
  type CastResult,
  type CastSessionState,
} from './castSender';
import { loadCastingEnabled, saveCastingEnabled } from './sandboxSettings';

export const CINEMA_CAST_CHANNEL = 'sandbox-cinema-cast';

export type CinemaCastPayload = {
  title: string;
  artist: string;
  albumArt?: string;
  isPlaying: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
  fidelity?: string;
  /** Absolute or site-relative HTTP stream URL for cast media load. */
  streamUrl?: string;
};

export type CinemaCastMode =
  | 'idle'
  | 'remote_cast'
  | 'presentation'
  | 'overlay'
  | 'popout';

const IDLE_PAYLOAD: CinemaCastPayload = {
  title: 'Sovereign Music Console',
  artist: 'Ready to cast',
  isPlaying: false,
  currentTimeSeconds: 0,
  durationSeconds: 0,
};

type PresentationConnection = {
  url?: string;
  state?: string;
  terminate?: () => void;
  addEventListener?: (type: string, listener: () => void) => void;
};

type PresentationRequestLike = {
  start: () => Promise<PresentationConnection>;
};

type PresentationApi = {
  defaultRequest?: PresentationRequestLike;
};

let castWindow: Window | null = null;
let castChannel: BroadcastChannel | null = null;
let presentationConnection: PresentationConnection | null = null;
let castMode: CinemaCastMode = 'idle';
let lastPayload: CinemaCastPayload = { ...IDLE_PAYLOAD };

const sessionListeners = new Set<(mode: CinemaCastMode) => void>();

function notifySession(): void {
  for (const listener of sessionListeners) listener(castMode);
}

function castUrl(): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?cast=1`;
}

export function isCinemaCastView(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('cast') === '1';
}

function getChannel(): BroadcastChannel {
  if (!castChannel) castChannel = new BroadcastChannel(CINEMA_CAST_CHANNEL);
  return castChannel;
}

export function getLastCinemaCastPayload(): CinemaCastPayload {
  return lastPayload;
}

function syncRemoteCastIfActive(): void {
  if (castMode === 'remote_cast' || isCastConnected()) {
    void syncCastPlayback(lastPayload);
  }
}

export function publishCinemaCast(payload: CinemaCastPayload): void {
  lastPayload = payload;
  if (!loadCastingEnabled() && castMode === 'idle' && !isCastConnected()) return;

  syncRemoteCastIfActive();

  if (castMode === 'idle' && !isCastConnected()) return;
  try {
    getChannel().postMessage(payload);
  } catch {
    /* BroadcastChannel unavailable */
  }
}

export function subscribeCinemaCast(
  handler: (payload: CinemaCastPayload) => void,
): () => void {
  handler(lastPayload);
  const ch = getChannel();
  const onMsg = (ev: MessageEvent<CinemaCastPayload>) => {
    if (ev.data && typeof ev.data === 'object') {
      lastPayload = ev.data;
      handler(ev.data);
    }
  };
  ch.addEventListener('message', onMsg);
  return () => ch.removeEventListener('message', onMsg);
}

export function getCinemaCastMode(): CinemaCastMode {
  if (isCastConnected()) return 'remote_cast';
  return castMode;
}

export function isCastSessionActive(): boolean {
  return castMode !== 'idle' || isCastConnected();
}

export function subscribeCastSession(
  handler: (mode: CinemaCastMode) => void,
): () => void {
  sessionListeners.add(handler);
  handler(getCinemaCastMode());
  const unsubRemoteCast = subscribeCastDeviceSession((state) => {
    if (state.connected) {
      if (castMode !== 'remote_cast') {
        castMode = 'remote_cast';
        notifySession();
      }
    } else if (castMode === 'remote_cast') {
      castMode = 'idle';
      notifySession();
    }
    handler(getCinemaCastMode());
  });
  return () => {
    sessionListeners.delete(handler);
    unsubRemoteCast();
  };
}

export {
  getCastDeviceName,
  getCastSessionState,
  hasCustomCastReceiver,
  isCastSdkSupported,
  type CastSessionState,
};

export async function requestCinemaCast(): Promise<CastResult> {
  saveCastingEnabled(true);
  const result = await requestCastSession();
  if (result.ok) {
    castMode = 'remote_cast';
    notifySession();
    syncRemoteCastIfActive();
    try {
      getChannel().postMessage(lastPayload);
    } catch {
      /* ignore */
    }
  }
  return result;
}

/** Pre-warm Cast SDK (call once on settings mount). */
export function warmCastSdk(): void {
  if (!isCastSdkSupported()) return;
  void initCastSender().then((result) => {
    if (!result.ok) {
      console.warn('[cinemaCast] Cast SDK warm-up failed:', result.error);
    }
  });
}

export { getCastUnsupportedMessage };

function bindPresentationConnection(conn: PresentationConnection): void {
  presentationConnection = conn;
  conn.addEventListener?.('close', () => {
    if (castMode === 'presentation') {
      castMode = 'idle';
      presentationConnection = null;
      notifySession();
    }
  });
  conn.addEventListener?.('terminate', () => {
    if (castMode === 'presentation') {
      castMode = 'idle';
      presentationConnection = null;
      notifySession();
    }
  });
}

async function tryPresentationApi(): Promise<boolean> {
  const pres = (window as Window & { presentation?: PresentationApi }).presentation;
  if (!pres) return false;

  const candidates: PresentationRequestLike[] = [];
  try {
    const PresentationRequestCtor = (
      window as Window & {
        PresentationRequest?: new (urls: string[]) => PresentationRequestLike;
      }
    ).PresentationRequest;
    if (PresentationRequestCtor) {
      candidates.push(new PresentationRequestCtor([castUrl()]));
    }
  } catch {
    /* PresentationRequest unavailable */
  }
  if (pres.defaultRequest) candidates.push(pres.defaultRequest);

  for (const request of candidates) {
    try {
      const conn = await request.start();
      if (conn) {
        bindPresentationConnection(conn);
        castMode = 'presentation';
        notifySession();
        publishCinemaCast(lastPayload);
        return true;
      }
    } catch {
      /* user declined or display unavailable */
    }
  }
  return false;
}

/** Screen mirror fallback — Presentation API or in-window overlay (not remote cast). */
export async function startScreenMirror(): Promise<CinemaCastMode> {
  saveCastingEnabled(true);
  if (castMode !== 'idle' && castMode !== 'remote_cast') return castMode;

  const presented = await tryPresentationApi();
  if (presented) return 'presentation';

  castMode = 'overlay';
  notifySession();
  publishCinemaCast(lastPayload);
  return 'overlay';
}

/** @deprecated Use startScreenMirror */
export async function startCinemaCast(): Promise<CinemaCastMode> {
  return startScreenMirror();
}

export function openCinemaCastPopout(): Window | null {
  saveCastingEnabled(true);
  if (castWindow && !castWindow.closed) {
    castWindow.focus();
    castMode = 'popout';
    notifySession();
    return castWindow;
  }
  const features = 'noopener,noreferrer,width=1280,height=720,menubar=no,toolbar=no';
  castWindow = window.open(castUrl(), 'sandbox-cinema-cast', features);
  if (castWindow) {
    castMode = 'popout';
    notifySession();
    publishCinemaCast(lastPayload);
    const timer = window.setInterval(() => {
      if (!castWindow || castWindow.closed) {
        window.clearInterval(timer);
        if (castMode === 'popout') {
          castMode = 'idle';
          castWindow = null;
          notifySession();
        }
      }
    }, 1000);
  }
  return castWindow;
}

export function stopCinemaCast(): void {
  if (isCastConnected()) {
    endCastSession();
  }

  if (presentationConnection?.terminate) {
    try {
      presentationConnection.terminate();
    } catch {
      /* already closed */
    }
  }
  presentationConnection = null;

  if (castWindow && !castWindow.closed) {
    castWindow.close();
  }
  castWindow = null;

  if (castMode !== 'idle') {
    castMode = 'idle';
    notifySession();
  }
}

/** @deprecated Use openCinemaCastPopout — kept for compatibility */
export function openCinemaCastWindow(): Window | null {
  return openCinemaCastPopout();
}

export function closeCinemaCastWindow(): void {
  if (castMode === 'popout') stopCinemaCast();
}

export function setCinemaCastEnabled(enabled: boolean): void {
  saveCastingEnabled(enabled);
  if (enabled) {
    publishCinemaCast(lastPayload);
  } else {
    stopCinemaCast();
  }
}
