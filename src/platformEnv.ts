/**
 * Runtime platform detection — Tauri desktop, Capacitor native, Web/PWA, Android TV.
 */

import { Capacitor } from '@capacitor/core';
import { detectTVPlatform } from './tvDetection';

export type SandboxPlatform = 'tauri' | 'android' | 'ios' | 'android-tv' | 'web';

export type DesktopOs = 'windows' | 'linux' | 'macos' | 'chromeos' | 'other' | null;

export interface SandboxPlatformDiagnostics {
  platform: SandboxPlatform;
  label: string;
  isTauri: boolean;
  isCapacitorNative: boolean;
  isAndroid: boolean;
  isWeb: boolean;
  isAndroidTv: boolean;
  /** True when runtime UA/platform indicates desktop Linux (incl. Tauri on Linux). */
  isLinux: boolean;
  /** Alias for diagnostics — desktop Linux WebView / Tauri shell. */
  isDesktopLinux: boolean;
  desktopOs: DesktopOs;
  capacitorPlatform: string | null;
}

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  return Capacitor.isNativePlatform();
}

export function isAndroid(): boolean {
  if (typeof window === 'undefined') return false;
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function isWeb(): boolean {
  return !isTauri() && !isCapacitorNative();
}

/** Sandbox Server anchor (bundled sidecar) — Tauri desktop only; not Capacitor mobile or web. */
export function canHostSandboxServerAnchor(): boolean {
  return isTauri();
}

/** How this device participates in the Sandbox Server mesh. */
export type ServerCapability = 'anchor' | 'client' | 'locker-only';

export interface ServerCapabilityInfo {
  capability: ServerCapability;
  canHostAnchor: boolean;
  platform: SandboxPlatform;
  desktopOs: DesktopOs;
  isMobile: boolean;
}

export function getServerCapability(): ServerCapabilityInfo {
  const platform = getPlatform();
  const desktopOs = detectDesktopOs();
  const canHostAnchor = canHostSandboxServerAnchor();
  if (canHostAnchor) {
    return {
      capability: 'anchor',
      canHostAnchor: true,
      platform,
      desktopOs,
      isMobile: false,
    };
  }
  if (isCapacitorNative()) {
    return {
      capability: 'client',
      canHostAnchor: false,
      platform,
      desktopOs,
      isMobile: platform === 'android' || platform === 'ios',
    };
  }
  return {
    capability: 'client',
    canHostAnchor: false,
    platform,
    desktopOs,
    isMobile: false,
  };
}

/** User-facing guidance for server setup — always includes a path forward. */
export function getServerCapabilityMessage(cap = getServerCapability()): string {
  if (cap.capability === 'anchor') {
    if (cap.desktopOs === 'linux') {
      return 'Sandbox Server runs on this Linux PC — starts with the app or from Settings → Vault → Sandbox Server.';
    }
    if (cap.desktopOs === 'windows') {
      return 'Sandbox Server is included on this Windows PC — starts automatically or from Settings → Vault → Sandbox Server.';
    }
    if (cap.desktopOs === 'macos') {
      return 'Sandbox Server runs on this Mac — starts with the desktop app or from Settings → Vault → Sandbox Server.';
    }
    return 'Sandbox Server is included with this desktop install — use Local device mode in Settings → Vault.';
  }
  if (cap.platform === 'android' || cap.platform === 'android-tv') {
    return 'Connect to Sandbox Server on your home network — scan LAN, enter your PC or NAS address, or use a remote overlay URL. Locker tracks on this device work without a server.';
  }
  if (cap.platform === 'ios') {
    return 'Point this device at a Sandbox Server on your LAN or overlay network. Locker playback works offline on this device.';
  }
  return 'Connect to a Sandbox Server on your LAN or overlay network, or use locker-only mode. Full catalog and sync need a server running somewhere on your network.';
}

export function getPlatform(): SandboxPlatform {
  if (typeof window === 'undefined') return 'web';

  if (isTauri()) return 'tauri';

  if (Capacitor.isNativePlatform()) {
    const capacitorPlatform = Capacitor.getPlatform();
    if (capacitorPlatform === 'android') {
      return detectTVPlatform() ? 'android-tv' : 'android';
    }
    if (capacitorPlatform === 'ios') return 'ios';
  }

  return 'web';
}

const PLATFORM_LABELS: Record<SandboxPlatform, string> = {
  tauri: 'Tauri Desktop',
  android: 'Android',
  ios: 'iOS (planned)',
  'android-tv': 'Android TV',
  web: 'Web / PWA',
};

/** Best-effort desktop OS from UA/platform (WebView + Tauri). */
export function detectDesktopOs(): DesktopOs {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() ?? '';
  if (/win/i.test(platform) || /windows nt/i.test(ua)) return 'windows';
  if (/mac/i.test(platform) || /macintosh/i.test(ua)) return 'macos';
  if (/cros/i.test(ua)) return 'chromeos';
  if (/linux/i.test(platform) || /linux x86/i.test(ua) || /x11/i.test(ua)) return 'linux';
  return 'other';
}

export function getPlatformLabel(
  platform: SandboxPlatform = getPlatform(),
  desktopOs: DesktopOs = detectDesktopOs(),
): string {
  if (platform === 'tauri' && desktopOs === 'linux') return 'Tauri Desktop (Linux)';
  if (platform === 'tauri' && desktopOs === 'windows') return 'Tauri Desktop (Windows)';
  if (platform === 'web' && desktopOs === 'linux') return 'Web / PWA (desktop Linux)';
  return PLATFORM_LABELS[platform];
}

export function getPlatformDiagnostics(): SandboxPlatformDiagnostics {
  const platform = getPlatform();
  const desktopOs = detectDesktopOs();
  const isLinux = desktopOs === 'linux';
  return {
    platform,
    label: getPlatformLabel(platform, desktopOs),
    isTauri: isTauri(),
    isCapacitorNative: isCapacitorNative(),
    isAndroid: isAndroid(),
    isWeb: isWeb(),
    isAndroidTv: platform === 'android-tv',
    isLinux,
    isDesktopLinux: isLinux && (platform === 'tauri' || platform === 'web'),
    desktopOs,
    capacitorPlatform:
      typeof window !== 'undefined' ? Capacitor.getPlatform() : null,
  };
}

/** Capacitor loads bundled assets; PWA service workers can cache stale web builds. */
function disablePwaServiceWorkerOnNative(): void {
  if (!isCapacitorNative() || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const sw = navigator.serviceWorker;
  const blockedRegister = (): Promise<ServiceWorkerRegistration> =>
    Promise.reject(
      new DOMException('Service workers are disabled on Capacitor native', 'AbortError'),
    );

  try {
    Object.defineProperty(sw, 'register', {
      value: blockedRegister,
      configurable: true,
      writable: true,
    });
  } catch {
    (sw as ServiceWorkerContainer & { register: typeof blockedRegister }).register =
      blockedRegister;
  }

  void sw.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister();
    }
  });

  if (typeof caches !== 'undefined') {
    void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
  }
}

/** Apply `data-platform` on :root and expose read-only `window.__SANDBOX_PLATFORM__`. */
export function initPlatformEnv(): SandboxPlatform {
  const diagnostics = getPlatformDiagnostics();
  const { platform } = diagnostics;

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.platform = platform;
    if (diagnostics.desktopOs) {
      document.documentElement.dataset.desktopOs = diagnostics.desktopOs;
    }
  }

  if (typeof window !== 'undefined') {
    window.__SANDBOX_PLATFORM__ = Object.freeze({ ...diagnostics });
  }

  disablePwaServiceWorkerOnNative();

  return platform;
}
