/**
 * Last play intent — survives WebView reload / JS state loss while native ExoPlayer keeps playing.
 */

import { prefsGetItem, prefsRemoveItem, prefsSetItem } from './prefsStorage';
import type { MediaEnvelope, MediaProvider, MediaTransport } from './sandboxLayer1';
import type { NativeExoPlaybackStatus } from './androidNativePlayback';

export const LAST_PLAY_INTENT_KEY = 'sandbox_last_play_intent_v1';

export type LastPlayIntent = {
  envelopeId: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  url?: string;
  provider?: MediaProvider;
  transport?: MediaTransport;
  sourceId?: string;
  durationSeconds?: number;
  savedAt: number;
};

const PERSISTABLE_RESUME_PROVIDERS: ReadonlySet<MediaProvider> = new Set([
  'local-vault',
  'stream-cache',
  'indexeddb',
]);

/** Only locker / offline cache tracks may survive process death and resume on next launch. */
export function isPersistablePlayIntent(
  source: Pick<LastPlayIntent, 'provider' | 'sourceId' | 'url'> | MediaEnvelope,
): boolean {
  const provider = source.provider;
  if (!provider || !PERSISTABLE_RESUME_PROVIDERS.has(provider)) return false;
  if (provider === 'local-vault') {
    const id = source.sourceId?.replace(/^local-/, '').trim();
    return Boolean(id);
  }
  const url = source.url?.trim() ?? '';
  return Boolean(url && !url.startsWith('blob:'));
}

export function clearLastPlayIntent(): void {
  prefsRemoveItem(LAST_PLAY_INTENT_KEY);
}

/** Drop streaming/search ghosts left by older builds — runs automatically on cold start. */
export function discardNonPersistableLastPlayIntent(): void {
  const intent = loadLastPlayIntent();
  if (!intent) return;
  if (!isPersistablePlayIntent(intent)) {
    clearLastPlayIntent();
  }
}

export function saveLastPlayIntent(envelope: MediaEnvelope): void {
  if (!envelope.envelopeId?.trim() || !envelope.title?.trim()) return;
  if (!isPersistablePlayIntent(envelope)) return;
  const intent: LastPlayIntent = {
    envelopeId: envelope.envelopeId,
    title: envelope.title,
    artist: envelope.artist ?? '',
    album: envelope.album,
    artworkUrl: envelope.artworkUrl,
    url: envelope.url,
    provider: envelope.provider,
    transport: envelope.transport,
    sourceId: envelope.sourceId,
    durationSeconds: envelope.durationSeconds,
    savedAt: Date.now(),
  };
  prefsSetItem(LAST_PLAY_INTENT_KEY, JSON.stringify(intent));
}

export function loadLastPlayIntent(): LastPlayIntent | null {
  const raw = prefsGetItem(LAST_PLAY_INTENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LastPlayIntent;
    if (!parsed?.envelopeId?.trim() || !parsed.title?.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function lastPlayIntentToEnvelope(intent: LastPlayIntent): MediaEnvelope {
  return {
    envelopeId: intent.envelopeId,
    title: intent.title,
    artist: intent.artist ?? '',
    album: intent.album,
    artworkUrl: intent.artworkUrl,
    url: intent.url ?? '',
    durationSeconds: intent.durationSeconds ?? 0,
    provider: intent.provider ?? 'unknown',
    transport: intent.transport ?? 'element-src',
    sourceId: intent.sourceId ?? intent.envelopeId,
  };
}

/** True when ExoPlayer is audibly active or mid-track (incl. OnePlus stuck-idle OEM quirks). */
export function isNativeExoAudible(
  status: NativeExoPlaybackStatus,
  previousPositionSecs = 0,
): boolean {
  const state = status.state;
  const pos = status.positionSecs ?? 0;
  if (state === 'playing') return true;
  if (state === 'loading' && pos > previousPositionSecs + 0.2) return true;
  if (state === 'idle' && pos > previousPositionSecs + 0.25) return true;
  if (state === 'paused' && pos > previousPositionSecs + 0.2) return true;
  return false;
}

/** Coerce OEM status when position advances but isPlaying() lies. */
export function effectiveNativeExoState(
  status: NativeExoPlaybackStatus,
  previousPositionSecs = 0,
  options?: { userPaused?: boolean },
): NonNullable<NativeExoPlaybackStatus['state']> {
  const state = status.state ?? 'idle';
  const pos = status.positionSecs ?? 0;
  if (state === 'stopped' || state === 'error') return state;
  if (state === 'paused') {
    if (!options?.userPaused && pos > previousPositionSecs + 0.2) return 'playing';
    return 'paused';
  }
  if (state === 'idle' && pos > previousPositionSecs + 0.25) return 'playing';
  if (state === 'loading' && pos > previousPositionSecs + 0.25) return 'playing';
  return state;
}

/** Play/pause UI — true when audio is audibly progressing, not only when isPlaying() is honest. */
export function nativeExoUiIsPlaying(
  status: NativeExoPlaybackStatus,
  effectiveState: NonNullable<NativeExoPlaybackStatus['state']>,
  previousPositionSecs: number,
  renderedPositionSecs = status.positionSecs ?? 0,
): boolean {
  if (effectiveState === 'playing') return true;
  if (status.state === 'playing') return true;
  if (isNativeExoAudible(status, previousPositionSecs)) return true;
  // Buffered streams: Exo can stay "loading" while wall-clock synth advances the scrubber.
  if (
    (effectiveState === 'loading' || status.state === 'loading') &&
    renderedPositionSecs > 0.25
  ) {
    return true;
  }
  return false;
}

/** True when native Exo still has the same track loaded and can resume without playUrl reload. */
export function nativeExoCanResumeSameTrack(
  status: NativeExoPlaybackStatus,
  envelopeId: string | undefined,
  previousPositionSecs = 0,
): boolean {
  if (!nativeStatusMatchesEnvelope(status, envelopeId)) return false;
  const hasMedia =
    (status.queueLength ?? 0) >= 1 || Boolean(status.currentUrl?.trim());
  if (!hasMedia) return false;
  const pos = status.positionSecs ?? 0;
  const effective = effectiveNativeExoState(status, previousPositionSecs);
  if (effective === 'playing') return true;
  if (effective === 'error') return false;
  return (
    effective === 'paused' ||
    effective === 'loading' ||
    ((effective === 'idle' || effective === 'stopped') && pos > 0.25)
  );
}

/** Clamp spurious backward jumps from OEM polls unless the user just seeked. */
export type NativeExoPlaybackAnchor = {
  pos: number;
  atMs: number;
};

/** Estimate progress when OEM Exo polls report 0 while audio is audibly playing. */
export function synthesizeNativeExoPosition(
  polledPos: number,
  effectiveState: NonNullable<NativeExoPlaybackStatus['state']>,
  anchor: NativeExoPlaybackAnchor | null,
  lastRendered: number,
  durationSecs: number,
): { pos: number; anchor: NativeExoPlaybackAnchor | null } {
  const active = effectiveState === 'playing' || effectiveState === 'loading';
  if (!active) {
    return { pos: polledPos, anchor: null };
  }

  const safePolled = Math.max(0, polledPos);
  let nextAnchor = anchor;
  if (!nextAnchor || safePolled >= nextAnchor.pos + 0.15) {
    nextAnchor = {
      pos: Math.max(safePolled, lastRendered),
      atMs: Date.now(),
    };
  }

  let pos = safePolled;
  if (safePolled <= nextAnchor.pos + 0.25) {
    const elapsed = Math.max(0, (Date.now() - nextAnchor.atMs) / 1000);
    const estimated = nextAnchor.pos + elapsed;
    const cap = durationSecs > 0 ? durationSecs : estimated;
    pos = Math.min(estimated, cap);
  }
  if (safePolled > pos) pos = safePolled;

  return { pos, anchor: nextAnchor };
}

/** Snapshot UI position when pausing — includes wall-clock anchor before it is cleared. */
export function resolvePauseHoldPos(
  durationSecs: number,
  anchor: NativeExoPlaybackAnchor | null,
  refs: {
    lastRendered: number;
    latestDisplay: number;
    currentTime: number;
    nativePolled: number;
  },
): number {
  let hold = Math.max(
    refs.lastRendered,
    refs.latestDisplay,
    refs.currentTime,
    refs.nativePolled,
  );
  if (anchor) {
    const elapsed = Math.max(0, (Date.now() - anchor.atMs) / 1000);
    const anchored = anchor.pos + elapsed;
    hold = Math.max(hold, durationSecs > 0 ? Math.min(anchored, durationSecs) : anchored);
  }
  return Math.max(0, hold);
}

export function reconcileNativeExoPosition(
  reportedPos: number,
  effectiveState: NonNullable<NativeExoPlaybackStatus['state']>,
  lastRendered: number,
  allowRegression: boolean,
  previousReportedPos = 0,
): number {
  if (allowRegression) return reportedPos;
  // OnePlus/OEM: paused/idle polls often report 0 while audio was mid-track.
  if (
    lastRendered > 2 &&
    reportedPos < 1 &&
    (effectiveState === 'paused' ||
      effectiveState === 'idle' ||
      effectiveState === 'loading')
  ) {
    return lastRendered;
  }
  const positionAdvancing =
    effectiveState === 'paused' && reportedPos > previousReportedPos + 0.2;
  if (effectiveState === 'playing' || effectiveState === 'loading' || positionAdvancing) {
    if (reportedPos + 0.2 < lastRendered) return lastRendered;
    return reportedPos;
  }
  if (effectiveState === 'paused' || effectiveState === 'stopped') {
    if (reportedPos + 0.5 < lastRendered) return lastRendered;
    return reportedPos;
  }
  if (reportedPos + 1.5 < lastRendered) return lastRendered;
  return Math.max(lastRendered, reportedPos);
}

/** Ignore native status from a previous track while a new resolve is in flight. */
export function nativeStatusMatchesEnvelope(
  status: NativeExoPlaybackStatus,
  envelopeId: string | undefined,
): boolean {
  const nativeId = status.envelopeId?.trim();
  const expected = envelopeId?.trim();
  if (!expected) return true;
  if (nativeId === expected) return true;
  if (!nativeId) {
    const intent = loadLastPlayIntent();
    return intent?.envelopeId?.trim() === expected;
  }
  return false;
}

export function envelopeFromNativeStatus(
  status: NativeExoPlaybackStatus,
): MediaEnvelope | null {
  const title = status.title?.trim();
  if (!title) return null;
  const envelopeId = status.envelopeId?.trim() || `native-${Date.now()}`;
  return {
    envelopeId,
    title,
    artist: status.artist?.trim() ?? '',
    album: status.album,
    artworkUrl: status.artworkUrl,
    url: status.currentUrl ?? '',
    durationSeconds: status.durationSecs ?? 0,
    provider: 'unknown',
    transport: 'element-src',
    sourceId: envelopeId,
  };
}

/** Restore UI envelope when native is playing but JS lost track metadata. */
export function reconcileEnvelopeFromNativeStatus(
  status: NativeExoPlaybackStatus,
  current: MediaEnvelope | null,
): MediaEnvelope | null {
  if (current?.title?.trim() && current?.url?.trim()) return null;
  const nativeId = status.envelopeId?.trim();
  const currentId = current?.envelopeId?.trim();
  if (currentId && nativeId && currentId !== nativeId) return null;
  if (!isNativeExoAudible(status)) return null;

  const fromNative = envelopeFromNativeStatus(status);
  if (fromNative) return fromNative;

  const intent = loadLastPlayIntent();
  if (intent && isPersistablePlayIntent(intent)) {
    return lastPlayIntentToEnvelope(intent);
  }

  return null;
}
