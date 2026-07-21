/**
 * Android TV / Leanback detection for 10-foot UI routing.
 * Uses UA heuristics, Capacitor platform, and screen geometry.
 */

import { Capacitor } from '@capacitor/core';
import { isTauri } from './platformEnv';

const TV_UA_RE =
  /tv|googletv|androidtv|smarttv|leanback|hbbtv|aft[bkmst]|bravia|shield|firetv|fire\s*tv|tizen|webos/i;

const TABLET_MIN_SMALLEST_WIDTH_DP = 600;

type SandboxNativeBridge = {
  isLeanbackTv?: () => boolean;
  isTabletFormFactor?: () => boolean;
};

function getSandboxNativeBridge(): SandboxNativeBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { SandboxNative?: SandboxNativeBridge }).SandboxNative;
}

function getBootViewportSmallest(): number {
  if (typeof window === 'undefined') return 0;
  const screenW = window.screen?.width ?? 0;
  const screenH = window.screen?.height ?? 0;
  const w = window.innerWidth > 0 ? window.innerWidth : screenW;
  const h = window.innerHeight > 0 ? window.innerHeight : screenH;
  return Math.min(w, h);
}

export function isTvUserAgent(ua = navigator.userAgent): boolean {
  return TV_UA_RE.test(ua);
}

export function isAndroidTvUserAgent(ua = navigator.userAgent): boolean {
  const lower = ua.toLowerCase();
  if (TV_UA_RE.test(lower)) return true;
  // Android without "Mobile" is common on TV boxes (Shield, Fire TV sideload, etc.)
  return /android/i.test(lower) && !/mobile/i.test(lower);
}

export function isAndroidLeanbackNative(): boolean {
  try {
    return getSandboxNativeBridge()?.isLeanbackTv?.() === true;
  } catch {
    return false;
  }
}

/** Native Android tablet (`sw600dp`) — excludes touch tablets from TV UA heuristics. */
export function isAndroidTabletNative(): boolean {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  try {
    const fromBridge = getSandboxNativeBridge()?.isTabletFormFactor?.();
    if (typeof fromBridge === 'boolean') return fromBridge;
  } catch {
    /* bridge not ready */
  }
  // Do not compare raw WebView CSS px to dp — high-res phones (e.g. OnePlus 12) report ~1440px
  // and false-positive as tablets, forcing desktop Discover tabs (Playlists) on handhelds.
  return false;
}

/**
 * Returns true when the shell should render the 10-foot TV experience.
 */
export function detectTVPlatform(): boolean {
  if (typeof window === 'undefined') return false;

  // Dev-only: `?tv=1` forces Android TV / 10-foot shell in a desktop browser (matches `?mobile=1`).
  if (import.meta.env.DEV && !isTauri() && new URLSearchParams(window.location.search).get('tv') === '1') {
    return true;
  }

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && isAndroidTabletNative()) {
    return false;
  }

  if (isAndroidLeanbackNative()) return true;

  const ua = navigator.userAgent;
  if (isTvUserAgent(ua)) return true;

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    if (isAndroidTvUserAgent(ua)) return true;
    // Leanback WebView on some devices omits TV tokens — large landscape + no touch
    const { width, height } = window.screen;
    const landscape = width > height && width >= 1280;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const noHover = window.matchMedia('(hover: none)').matches;
    if (landscape && coarsePointer && noHover && height >= 720) return true;
  }

  return false;
}
