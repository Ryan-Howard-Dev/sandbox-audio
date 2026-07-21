/**
 * E2E-only: register forwarding playback stubs at main.tsx load so deep links queue
 * can flush before the heavy sandboxLayer3 chunk finishes parsing on large vaults.
 */
import {
  type E2eHandlers,
  type E2ePlaybackProbe,
  isE2eBridgeEnabled,
  markE2eHandlersReady,
  registerE2eHandlers,
} from './e2eDevAction';

let liveHandlers: E2eHandlers | null = null;

function emptyProbe(): E2ePlaybackProbe {
  return {
    title: '',
    artist: '',
    state: 'idle',
    positionSecs: 0,
    durationSecs: 0,
  };
}

function requireLive<T>(fn: (h: E2eHandlers) => T, fallback: T): T {
  if (!liveHandlers) return fallback;
  return fn(liveHandlers);
}

async function requireLiveAsync(
  fn: (h: E2eHandlers) => Promise<boolean> | boolean | undefined,
): Promise<boolean> {
  if (!liveHandlers) return false;
  const result = fn(liveHandlers);
  return typeof result === 'boolean' ? result : Boolean(await result);
}

/** Install no-op forwards; real handlers replace via installE2eLiveHandlers from sandboxLayer3. */
export function installE2eHandlerStubs(): void {
  if (!isE2eBridgeEnabled()) return;

  registerE2eHandlers({
    getPlaybackProbe: () =>
      requireLive((h) => h.getPlaybackProbe?.() ?? emptyProbe(), emptyProbe()),
    playLockerTrack: async (artist, track, album) =>
      requireLiveAsync((h) => h.playLockerTrack?.(artist, track, album) ?? false),
    playLockerSequence: async (artist, tracks, album) =>
      requireLiveAsync((h) => h.playLockerSequence?.(artist, tracks, album) ?? false),
    playPlaylistTrack: async (playlist, track) =>
      requireLiveAsync((h) => h.playPlaylistTrack?.(playlist, track) ?? false),
    thumbUpCurrent: () => requireLive((h) => h.thumbUpCurrent?.() ?? false, false),
    thumbDownCurrent: () => requireLive((h) => h.thumbDownCurrent?.() ?? false, false),
    probeLockerArt: async (artist, title, album) =>
      requireLiveAsync((h) => h.probeLockerArt?.(artist, title, album) ?? false),
    setHeroDisplayMode: (mode) => requireLive((h) => h.setHeroDisplayMode?.(mode), undefined),
    getHeroVisualProbe: () => requireLive((h) => h.getHeroVisualProbe?.(), undefined),
    resetPlaybackState: async () =>
      requireLive((h) => h.resetPlaybackState?.() ?? Promise.resolve(), undefined),
  });

  markE2eHandlersReady();
}

/** Called from sandboxLayer3 once real playback handlers are wired. */
export function installE2eLiveHandlers(next: E2eHandlers): void {
  if (!isE2eBridgeEnabled()) return;
  liveHandlers = { ...liveHandlers, ...next };
  registerE2eHandlers(next);
}
