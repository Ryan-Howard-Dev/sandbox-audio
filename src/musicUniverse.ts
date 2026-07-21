/**
 * Music universe backdrop — platform and viewport gating.
 * Enables full-screen ambient glow on Tauri (Win/Linux), Android TV playback,
 * and web tablets/laptops; skips phone portrait shells.
 */

import { useEffect, useMemo, useState } from 'react';
import { getPlatformDiagnostics, isCapacitorNative, isTauri } from './platformEnv';
import { detectTVPlatform } from './tvDetection';

export const MUSIC_UNIVERSE_TABLET_MIN_PX = 768;

export type MusicUniverseTvScreen = 'home' | 'playback';

export interface MusicUniverseGateContext {
  isCarMode: boolean;
  station: string;
  hasLoadedTrack: boolean;
  isTV: boolean;
  tvScreen: MusicUniverseTvScreen;
}

/** Capacitor phone (not TV/tablet) — skip heavy full-screen glow on narrow native viewports. */
export function isNativePhoneShell(): boolean {
  if (!isCapacitorNative() || detectTVPlatform()) return false;
  if (typeof window === 'undefined') return true;
  return !window.matchMedia(`(min-width: ${MUSIC_UNIVERSE_TABLET_MIN_PX}px)`).matches;
}

/** Tablet/laptop viewport or fine pointer (mouse/trackpad on small web layouts). */
export function isMusicUniverseViewport(): boolean {
  if (typeof window === 'undefined') return false;
  const wide = window.matchMedia(`(min-width: ${MUSIC_UNIVERSE_TABLET_MIN_PX}px)`).matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  return wide || finePointer;
}

/** Runtime platform supports music universe (Tauri, Android TV, or capable web viewport). */
export function isMusicUniversePlatform(): boolean {
  if (typeof window === 'undefined') return false;

  const { isAndroidTv } = getPlatformDiagnostics();
  if (isAndroidTv || detectTVPlatform()) return true;
  if (isTauri()) return true;

  return isMusicUniverseViewport();
}

/** Whether the full-screen music universe backdrop should render. */
export function shouldShowMusicUniverse(ctx: MusicUniverseGateContext): boolean {
  if (ctx.isCarMode) return false;
  if (ctx.station !== 'home') return false;
  if (!ctx.hasLoadedTrack) return false;
  if (!isMusicUniversePlatform()) return false;

  if (ctx.isTV) {
    return ctx.tvScreen === 'playback';
  }

  if (isNativePhoneShell()) return false;

  if (typeof window !== 'undefined') {
    const narrow = window.matchMedia(`(max-width: ${MUSIC_UNIVERSE_TABLET_MIN_PX - 1}px)`).matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (narrow && !finePointer) return false;
  }

  return true;
}

/** Re-renders when viewport crosses tablet / pointer capability thresholds. */
export function useMusicUniverseViewport(): boolean {
  const [capable, setCapable] = useState(isMusicUniverseViewport);

  useEffect(() => {
    const mqs = [
      window.matchMedia(`(min-width: ${MUSIC_UNIVERSE_TABLET_MIN_PX}px)`),
      window.matchMedia('(hover: hover) and (pointer: fine)'),
    ];
    const sync = () => setCapable(isMusicUniverseViewport());
    sync();
    for (const mq of mqs) mq.addEventListener('change', sync);
    return () => {
      for (const mq of mqs) mq.removeEventListener('change', sync);
    };
  }, []);

  return capable;
}

/** Reactive gate — re-evaluates when viewport capability changes. */
export function useShowMusicUniverse(ctx: MusicUniverseGateContext): boolean {
  const viewportCapable = useMusicUniverseViewport();
  return useMemo(
    () => shouldShowMusicUniverse(ctx),
    [
      viewportCapable,
      ctx.isCarMode,
      ctx.station,
      ctx.hasLoadedTrack,
      ctx.isTV,
      ctx.tvScreen,
    ],
  );
}
