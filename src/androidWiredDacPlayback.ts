/**
 * Wired USB-C DAC stability — playback prefs and Android route recovery.
 *
 * Jul 7 semantics: larger buffers / no gapless-crossfade (native), debounced route
 * recovery that resumes mid-track glitches — without pause/resume loops on every
 * wired event (those broke play start after the Jul 14 hot-plug patch).
 *
 * Soft preferred-device bind runs once when transitioning onto wired (or mid-track
 * glitch recovery) — never on every route tick while already playing on wired.
 */

import { loadCrossfadeEnabled, loadGaplessEnabled } from './sandboxSettings';
import {
  loadAndroidWebViewCrossfadeEnabled,
  loadAndroidWiredDacStabilityEnabled,
} from './androidNativePlaybackSettings';
import {
  BackgroundMedia,
  configureAndroidAudioSession,
  getAndroidAudioOutputRoute,
  isAndroidBackgroundMediaAvailable,
  startAndroidAudioRouteWatcher,
  stopAndroidAudioRouteWatcher,
  syncAndroidWiredDacStabilityNative,
  type AndroidAudioOutputRoute,
} from './backgroundMedia';
import {
  nativeExoPlaybackStatus,
  nativeExoRerouteToWired,
  nativeExoResume,
  nativeExoSetWiredDacStabilityEnabled,
  syncNativeExoPlaybackPrefs,
} from './androidNativePlayback';

export function resolveNativeExoTransitionPrefs(): {
  gapless: boolean;
  crossfade: boolean;
} {
  if (loadAndroidWiredDacStabilityEnabled()) {
    return { gapless: false, crossfade: false };
  }
  return {
    gapless: loadGaplessEnabled(),
    crossfade: loadCrossfadeEnabled() && !loadAndroidWebViewCrossfadeEnabled(),
  };
}

export async function syncWiredDacStabilityNative(): Promise<void> {
  if (!isAndroidBackgroundMediaAvailable()) return;
  const enabled = loadAndroidWiredDacStabilityEnabled();
  await syncAndroidWiredDacStabilityNative(enabled);
  await nativeExoSetWiredDacStabilityEnabled(enabled);
  await syncNativeExoPlaybackPrefs(resolveNativeExoTransitionPrefs());
}

export type WiredDacStabilityOptions = {
  reconcileFromNativeExo: () => Promise<boolean>;
  resumePlayback: () => void;
};

/** Pure gate — skip mid-playback soft-rebind when already on wired and stable. */
export function shouldSkipWiredRouteRecover(args: {
  route: AndroidAudioOutputRoute;
  prevRoute: AndroidAudioOutputRoute;
  playbackState: string;
  reason?: string;
}): boolean {
  if (args.route !== 'wired') return true;
  // Already wired + playing: do not reconfigure Exo / preferred device.
  // Still allow becomingNoisyRecovered (DAC micro-glitch) and transitions onto wired.
  if (
    args.prevRoute === 'wired' &&
    args.playbackState === 'playing' &&
    args.reason !== 'becomingNoisyRecovered'
  ) {
    return true;
  }
  return false;
}

let routeRecoverTimer: number | null = null;
let lastKnownRoute: AndroidAudioOutputRoute = 'unknown';

async function recoverWiredRoute(
  route: AndroidAudioOutputRoute,
  options: WiredDacStabilityOptions,
  reason?: string,
): Promise<void> {
  if (!loadAndroidWiredDacStabilityEnabled()) return;

  const prev = lastKnownRoute;
  lastKnownRoute = route;
  if (route !== 'wired') return;

  const status = await nativeExoPlaybackStatus();

  if (
    shouldSkipWiredRouteRecover({
      route,
      prevRoute: prev,
      playbackState: status.state ?? 'idle',
      reason,
    })
  ) {
    return;
  }

  await configureAndroidAudioSession();

  const pos = status.positionSecs ?? 0;
  const dur = status.durationSecs ?? 0;
  const midTrack =
    dur > 0 && pos > 0.25 && pos < dur - 1 && status.state !== 'playing';

  // Hot-plug while audio is already flowing on speaker: recreate AudioTrack on DAC.
  // Soft preferred-device apply otherwise (transition onto wired / glitch recovery).
  const hotPlugWhilePlaying =
    status.state === 'playing' &&
    prev !== 'wired' &&
    (reason === 'deviceChange' || reason === 'becomingNoisyRecovered');

  await nativeExoRerouteToWired({ forceRestart: hotPlugWhilePlaying });
  await options.reconcileFromNativeExo();

  // Jul 7: only nudge resume for mid-track glitches / recovered becomingNoisy pause (wired only).
  if (
    midTrack ||
    (status.state === 'paused' && reason === 'becomingNoisyRecovered')
  ) {
    await nativeExoResume();
    options.resumePlayback();
  }
}

/** Listen for USB/wired route changes and debounce micro-disconnect glitches. */
export function initAndroidWiredDacStability(
  options: WiredDacStabilityOptions,
): () => void {
  if (!isAndroidBackgroundMediaAvailable()) return () => {};

  void syncWiredDacStabilityNative();

  const cleanups: Array<() => void> = [];

  const onSettings = () => {
    void syncWiredDacStabilityNative();
  };
  window.addEventListener('sandbox-settings-change', onSettings);
  cleanups.push(() => window.removeEventListener('sandbox-settings-change', onSettings));

  void startAndroidAudioRouteWatcher();
  void BackgroundMedia.addListener('audioRouteChange', (event) => {
    if (routeRecoverTimer !== null) {
      window.clearTimeout(routeRecoverTimer);
      routeRecoverTimer = null;
    }
    routeRecoverTimer = window.setTimeout(() => {
      routeRecoverTimer = null;
      void recoverWiredRoute(event.route, options, event.reason);
    }, 400);
  }).then((handle) => {
    cleanups.push(() => {
      void handle.remove();
    });
  });

  // Jul 7: probe route only — do not force recover on cold start (breaks first play on DAC).
  void getAndroidAudioOutputRoute().then((route) => {
    lastKnownRoute = route;
  });

  return () => {
    if (routeRecoverTimer !== null) {
      window.clearTimeout(routeRecoverTimer);
      routeRecoverTimer = null;
    }
    for (const fn of cleanups) fn();
    void stopAndroidAudioRouteWatcher();
  };
}
