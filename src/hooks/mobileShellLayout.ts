import { Capacitor } from '@capacitor/core';
import { isCapacitorNative, isTauri } from '../platformEnv';
import { detectTVPlatform, isAndroidTabletNative } from '../tvDetection';

/** Matches Tailwind `md` breakpoint — phone shell below this width on web/PWA. */
export const MOBILE_SHELL_MAX_WIDTH_PX = 767;

/** Android `sw600dp` bucket — 7–10″ tablets (Fire HD 10 ≈ 600dp smallest width). */
export const TABLET_MIN_SMALLEST_WIDTH_DP = 600;

/** Web / wide-layout breakpoint — desktop shell at or above this width. */
export const TABLET_MIN_WIDTH_PX = 768;

/** Dev-only: `?mobile=1` forces phone shell in a desktop browser. */
export function isDevMobilePreview(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  if (isTauri()) return false;
  return new URLSearchParams(window.location.search).get('mobile') === '1';
}

/** Capacitor handset or tablet APK (not leanback TV). */
export function isNativeCapacitorNonTv(): boolean {
  return isCapacitorNative() && !detectTVPlatform();
}

/** Read layout viewport size — falls back to screen when WebView reports 0×0 during boot. */
export function getViewportDimensions(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  const screenW = window.screen?.width ?? 0;
  const screenH = window.screen?.height ?? 0;
  const w = window.innerWidth > 0 ? window.innerWidth : screenW;
  const h = window.innerHeight > 0 ? window.innerHeight : screenH;
  return { w, h };
}

/** Portrait when height ≥ width (Fire HD default). */
export function isPortraitViewport(): boolean {
  const { w, h } = getViewportDimensions();
  if (w <= 0 || h <= 0) return true;
  return h >= w;
}

/**
 * Tablet / large screen — Android `sw600dp` (native bridge or CSS) or wide web viewport.
 * Uses smallest CSS width (≈ dp in WebView) so phone landscape stays phone shell.
 * Native `isTabletFormFactor` wins when WebView CSS px undershoot sw600 (some Fire builds).
 */
export function isTabletViewport(): boolean {
  if (typeof window === 'undefined') return false;
  // Android native: trust Configuration.smallestScreenWidthDp via JS bridge only.
  if (isCapacitorNative() && Capacitor.getPlatform() === 'android') {
    return isAndroidTabletNative();
  }
  const { w, h } = getViewportDimensions();
  const smallest = Math.min(w, h);
  if (smallest >= TABLET_MIN_SMALLEST_WIDTH_DP) return true;
  return w >= TABLET_MIN_WIDTH_PX;
}

/** Capacitor phone (not TV, not tablet) — always uses mobile shell. */
export function isNativeMobileShellClient(): boolean {
  return isNativeCapacitorNonTv() && !isTabletViewport();
}

/**
 * Portrait tablets use the phone bottom-nav shell (sidebar is easy to miss).
 * Landscape tablets keep the desktop pinned rail.
 */
export function prefersTabletBottomNav(): boolean {
  return isTabletViewport() && isPortraitViewport();
}

/** Sync viewport check for web/PWA (also true for native mobile + dev preview). */
export function matchesMobileShellViewport(maxWidthPx = MOBILE_SHELL_MAX_WIDTH_PX): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches;
}

/**
 * Whether the app should use the Tidal-style mobile shell (sync).
 * Tauri desktop exe always uses desktop shell even on narrow windows.
 * Portrait tablets: bottom nav. Landscape tablets: desktop rail.
 */
export function usesMobileShellLayout(maxWidthPx = MOBILE_SHELL_MAX_WIDTH_PX): boolean {
  if (isTauri()) return false;
  if (prefersTabletBottomNav()) return true;
  if (isTabletViewport()) return false;
  if (isNativeMobileShellClient()) return true;
  if (isDevMobilePreview()) return true;
  return matchesMobileShellViewport(maxWidthPx);
}

/** Reactive shell selection for hooks — same rules as {@link usesMobileShellLayout}. */
export function computeMobileShellLayout(maxWidthPx = MOBILE_SHELL_MAX_WIDTH_PX): boolean {
  return usesMobileShellLayout(maxWidthPx);
}
