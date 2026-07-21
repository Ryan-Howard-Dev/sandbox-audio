/**
 * Android WebView often reports env(safe-area-inset-*) as 0.
 * Capacitor SystemBars injects --safe-area-inset-*; MainActivity mirrors --sandbox-inset-*.
 */

import { isAndroid } from './platformEnv';

const INSET_VARS = ['top', 'right', 'bottom', 'left'] as const;

function px(n: number): string {
  return `${Math.max(0, Math.round(n))}px`;
}

function readVar(name: string): number {
  if (typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return parseFloat(raw) || 0;
}

function setInsetVar(edge: (typeof INSET_VARS)[number], cssPx: number): void {
  document.documentElement.style.setProperty(`--sandbox-inset-${edge}`, px(cssPx));
}

function readEffectiveBottomInset(): number {
  return Math.max(
    readVar('--sandbox-inset-bottom'),
    readVar('--safe-area-inset-bottom'),
  );
}

/** Called from MainActivity via evaluateJavascript. */
export function applyNativeSafeAreaInsets(
  top: number,
  right: number,
  bottom: number,
  left: number,
): void {
  if (typeof document === 'undefined') return;
  // MainActivity shrinks the WebView with system-bar margins — CSS insets double-count on Android.
  const layoutInsets =
    isAndroid()
      ? { top: 0, right: 0, bottom: 0, left: 0 }
      : { top, right, bottom, left };
  setInsetVar('top', layoutInsets.top);
  setInsetVar('right', layoutInsets.right);
  setInsetVar('bottom', layoutInsets.bottom);
  setInsetVar('left', layoutInsets.left);
  document.documentElement.dataset.insetsReady = 'true';
  window.dispatchEvent(new Event('sandbox-safe-area-inset'));
}

function applyVisualViewportFallback(): void {
  // MainActivity shrinks the WebView for IME — visualViewport fallback double-counts keyboard.
  if (document.documentElement.dataset.insetsReady === 'true') {
    return;
  }
  if (isAndroid()) {
    return;
  }
  const vv = window.visualViewport;
  if (!vv) return;
  const bottomGap = Math.max(0, window.innerHeight - vv.offsetTop - vv.height);
  const topGap = Math.max(0, vv.offsetTop);
  if (bottomGap > readEffectiveBottomInset() + 0.5) {
    setInsetVar('bottom', bottomGap);
  }
  if (topGap > readVar('--sandbox-inset-top') + 0.5) {
    setInsetVar('top', topGap);
  }
}

/** Clear stale keyboard CSS vars after search/IME dismiss (Android). */
export function resetMobileKeyboardInsets(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--keyboard-height', '0px');
}

export function initAndroidSafeAreaInsets(): void {
  if (!isAndroid() || typeof window === 'undefined') return;

  (window as Window & { __sandboxApplySafeAreaInsets?: typeof applyNativeSafeAreaInsets }).__sandboxApplySafeAreaInsets =
    applyNativeSafeAreaInsets;

  if (!document.documentElement.dataset.insetsReady) {
    setInsetVar('bottom', 0);
  }

  const sync = () => {
    applyVisualViewportFallback();
  };

  window.visualViewport?.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('scroll', sync);
  window.addEventListener('orientationchange', () => {
    if (document.querySelector('.mobile-now-playing--sheet-open')) return;
    window.setTimeout(sync, 120);
  });
  window.addEventListener('sandbox-safe-area-inset', sync);
  sync();
  window.setTimeout(sync, 250);
  window.setTimeout(sync, 800);
  window.setTimeout(sync, 1500);
}
