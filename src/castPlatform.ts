/**
 * Cast platform detection — Web Sender SDK works in Chrome/Edge browsers.
 * Capacitor Android uses the native Cast SDK via NativeCast plugin.
 * Tauri desktop serves the UI on localhost for external-browser Chromecast.
 */

import { Capacitor } from '@capacitor/core';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import { isNativeCastSupported } from './nativeCast';

export type CastBrowserChoice = 'default' | 'chrome' | 'edge' | 'firefox';

const CAST_BROWSER_CHOICE_KEY = 'sandbox_cast_browser_choice';

export function loadCastBrowserChoice(): CastBrowserChoice {
  const raw = prefsGetItem(CAST_BROWSER_CHOICE_KEY);
  if (raw === 'chrome' || raw === 'edge' || raw === 'firefox' || raw === 'default') {
    return raw;
  }
  return 'default';
}

export function saveCastBrowserChoice(choice: CastBrowserChoice): void {
  prefsSetItem(CAST_BROWSER_CHOICE_KEY, choice);
}

export type CastRuntime =
  | 'chrome-browser'
  | 'edge-browser'
  | 'firefox'
  | 'capacitor-android'
  | 'capacitor-ios'
  | 'tauri'
  | 'embedded-webview'
  | 'other-browser';

export type CastBlockReason =
  | 'firefox'
  | 'capacitor-android'
  | 'capacitor-ios'
  | 'tauri-webview'
  | 'embedded-webview'
  | 'insecure-origin'
  | 'no-presentation-api'
  | 'unknown';

/** Default port for the packaged-desktop cast browser mini-server (see cast_browser_server.rs). */
export const CAST_BROWSER_PORT_HINT = 13789;

const BLOCK_MESSAGES: Record<CastBlockReason, string> = {
  firefox:
    'Chromecast (Google Cast) requires a Chromium browser — Chrome or Edge. Firefox does not support the Cast Web Sender SDK. Sonos / UPnP casting still works in this app when Sandbox Server is running.',
  'capacitor-android':
    'Chromecast needs an up-to-date Android device with Google Play services, or open in Chrome on the same Wi‑Fi.',
  'capacitor-ios':
    'Native iOS builds are not supported yet. Open Sandbox Music in Chrome on this device, or use a desktop browser on the same Wi‑Fi.',
  'tauri-webview':
    'Chromecast is unavailable inside the desktop app WebView. Sonos and UPnP speakers work here via Cast → Scan network. For Chromecast, open Sandbox Music in Chrome or Edge on this PC.',
  'embedded-webview':
    'Chromecast is not available in this embedded browser. Use Chrome or Edge on the same Wi‑Fi network as your TV.',
  'insecure-origin':
    'Chromecast requires HTTPS (or localhost). Open the app over a secure URL.',
  'no-presentation-api':
    'This browser cannot show the Chromecast device picker. Use Chrome or Edge on the same Wi‑Fi as your TV.',
  unknown:
    'Chromecast is not supported in this environment. Use Chrome or Edge on the same Wi‑Fi as your TV.',
};

export const TAURI_CAST_HELPER =
  'Sonos / UPnP: use Cast → Scan in this app. Chromecast: open in Chrome or Edge on this PC (same Wi‑Fi as your TV).';

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

/** True when running inside the Tauri desktop shell (WebView). */
export function isTauriDesktop(): boolean {
  return getCastRuntime() === 'tauri' || isTauriRuntime();
}

/** Origins that load embedded Tauri assets — not reachable from an external browser. */
export function isTauriEmbeddedOrigin(protocol: string, hostname: string): boolean {
  return (
    protocol === 'tauri:' ||
    hostname === 'tauri.localhost' ||
    (protocol === 'https:' && hostname === 'asset.localhost')
  );
}

function isAndroidWebViewUa(): boolean {
  return /; wv\)/.test(navigator.userAgent);
}

function isIosWebViewUa(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(ua) &&
    /AppleWebKit/.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|Safari/.test(ua)
  );
}

export function getCastRuntime(): CastRuntime {
  if (typeof window === 'undefined') return 'other-browser';

  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform();
    if (platform === 'android') return 'capacitor-android';
    if (platform === 'ios') return 'capacitor-ios';
  }

  if (isTauriRuntime()) return 'tauri';

  const ua = navigator.userAgent;
  if (/Firefox/i.test(ua)) return 'firefox';
  if (isAndroidWebViewUa() || isIosWebViewUa()) return 'embedded-webview';
  if (/Edg\//i.test(ua)) return 'edge-browser';
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) return 'chrome-browser';

  return 'other-browser';
}

/** True when Capacitor Android can use the native Cast SDK plugin. */
export function isNativeAndroidCastRuntime(): boolean {
  return getCastRuntime() === 'capacitor-android' && isNativeCastSupported();
}

export function getCastBlockReason(): CastBlockReason | null {
  if (typeof window === 'undefined') return 'unknown';

  if (isNativeAndroidCastRuntime()) return null;

  const runtime = getCastRuntime();
  if (runtime === 'firefox') return 'firefox';
  if (runtime === 'capacitor-android') return 'capacitor-android';
  if (runtime === 'capacitor-ios') return 'capacitor-ios';
  if (runtime === 'tauri') return 'tauri-webview';
  if (runtime === 'embedded-webview') return 'embedded-webview';

  const isSecure =
    window.isSecureContext ||
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  if (!isSecure) return 'insecure-origin';

  if (!('presentation' in navigator)) return 'no-presentation-api';

  return null;
}

export function castBlockMessage(reason: CastBlockReason): string {
  return BLOCK_MESSAGES[reason] ?? BLOCK_MESSAGES.unknown;
}

export function isWebCastSenderSupported(): boolean {
  return getCastBlockReason() === null && !isNativeAndroidCastRuntime();
}

/** Cast available via Web Sender or native Android Cast SDK. */
export function isCastAvailable(): boolean {
  return getCastBlockReason() === null;
}

export function canOpenInChromeWorkaround(): boolean {
  return getCastRuntime() === 'capacitor-android' && !isNativeAndroidCastRuntime();
}

/** True when cast is blocked but opening the app in a system browser may work. */
export function canOpenCastInBrowser(): boolean {
  const runtime = getCastRuntime();
  return canOpenInChromeWorkaround() || runtime === 'tauri' || runtime === 'embedded-webview';
}

/** Resolve cast browser URL from a location snapshot (testable, sync). */
export function resolveCastBrowserUrlFromLocation(
  origin: string,
  protocol: string,
  hostname: string,
  devFallback = 'http://localhost:3002',
  packagedFallback = `http://127.0.0.1:${CAST_BROWSER_PORT_HINT}/`,
): string {
  if (origin && !isTauriEmbeddedOrigin(protocol, hostname)) {
    return origin.replace(/\/$/, '');
  }
  if (
    (hostname === 'localhost' || hostname === '127.0.0.1') &&
    (protocol === 'http:' || protocol === 'https:')
  ) {
    return origin.replace(/\/$/, '');
  }
  return packagedFallback.replace(/\/$/, '');
}

let cachedCastBrowserUrl: string | null = null;

/** Best-effort URL shown in UI before the desktop mini-server starts. */
export function getCastBrowserUrl(): string {
  if (cachedCastBrowserUrl) return cachedCastBrowserUrl;
  if (typeof window === 'undefined') {
    return `http://127.0.0.1:${CAST_BROWSER_PORT_HINT}/`;
  }

  const runtime = getCastRuntime();
  if (runtime === 'tauri' || runtime === 'embedded-webview') {
    const { origin, protocol, hostname } = window.location;
    return resolveCastBrowserUrlFromLocation(origin, protocol, hostname);
  }
  return window.location.href;
}

/** Starts the packaged-desktop mini-server when needed; returns a reachable localhost URL. */
export async function resolveCastBrowserUrl(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const url = await invoke<string>('ensure_cast_browser_server');
      cachedCastBrowserUrl = url.replace(/\/$/, '');
      return cachedCastBrowserUrl;
    } catch {
      return getCastBrowserUrl();
    }
  }
  return getCastBrowserUrl();
}

async function openViaTauriCastCommand(browser: CastBrowserChoice): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const url = await invoke<string>('open_cast_in_browser', {
      browser: browser === 'default' ? null : browser,
    });
    cachedCastBrowserUrl = url.replace(/\/$/, '');
    return cachedCastBrowserUrl;
  } catch {
    return null;
  }
}

async function openViaTauriShell(url: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('plugin:shell|open', { path: url });
    return true;
  } catch {
    return false;
  }
}

export interface OpenCastInBrowserOptions {
  url?: string;
  browser?: CastBrowserChoice;
}

/** Open Sandbox Music in an external browser for Chromecast (starts desktop mini-server when packaged). */
export async function openCastInExternalBrowser(options?: OpenCastInBrowserOptions): Promise<void> {
  const browser = options?.browser ?? loadCastBrowserChoice();

  const opened = await openViaTauriCastCommand(browser);
  if (opened) return;

  const target = (options?.url ?? (await resolveCastBrowserUrl())).trim();
  if (!target) return;

  if (await openViaTauriShell(target)) return;

  if (Capacitor.getPlatform() === 'android') {
    const withoutScheme = target.replace(/^https?:\/\//, '');
    const intent = `intent://${withoutScheme}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(target)};end`;
    window.location.href = intent;
    return;
  }

  window.open(target, '_blank', 'noopener,noreferrer');
}

export const CAST_BROWSER_OPTIONS: { value: CastBrowserChoice; labelKey: string }[] = [
  { value: 'default', labelKey: 'shell.castBrowserDefault' },
  { value: 'chrome', labelKey: 'shell.castBrowserChrome' },
  { value: 'edge', labelKey: 'shell.castBrowserEdge' },
  { value: 'firefox', labelKey: 'shell.castBrowserFirefox' },
];
