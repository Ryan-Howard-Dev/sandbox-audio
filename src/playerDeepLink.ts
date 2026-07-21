/**
 * Deep links for in-app player navigation (notification / lock screen / media chip).
 * sandboxmusic://player/home → Home vinyl hero with the current track.
 */

import { Capacitor } from '@capacitor/core';

export const PLAYER_HOME_URL = 'sandboxmusic://player/home';

let openHomePlayerHandler: (() => void) | null = null;
let initPromise: Promise<() => void> | null = null;
let launchUrlConsumed = false;
let lastHomeDispatchMs = 0;
const HOME_DISPATCH_DEBOUNCE_MS = 750;

export function registerOpenHomePlayerHandler(fn: (() => void) | null): void {
  openHomePlayerHandler = fn;
}

export function isPlayerHomeUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const url = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(`sandboxmusic://${trimmed.replace(/^\/+/, '')}`);
    return url.hostname === 'player' && url.pathname.replace(/^\/+/, '') === 'home';
  } catch {
    return trimmed.includes('player/home');
  }
}

function dispatchPlayerHomeUrl(raw: string): boolean {
  if (!isPlayerHomeUrl(raw)) return false;
  const now = Date.now();
  if (now - lastHomeDispatchMs < HOME_DISPATCH_DEBOUNCE_MS) return true;
  lastHomeDispatchMs = now;
  openHomePlayerHandler?.();
  return true;
}

/** Listen for sandboxmusic://player/home from notification, lock screen, or media chip. */
export function initPlayerDeepLinks(): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) {
    return Promise.resolve(() => {});
  }
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const { App } = await import('@capacitor/app');
      const sub = await App.addListener('appUrlOpen', (event) => {
        dispatchPlayerHomeUrl(event.url);
      });
      if (!launchUrlConsumed) {
        launchUrlConsumed = true;
        try {
          const launch = await App.getLaunchUrl();
          if (launch?.url) dispatchPlayerHomeUrl(launch.url);
        } catch {
          /* no cold-start URL */
        }
      }
      return () => {
        void sub.remove();
        initPromise = null;
      };
    } catch (err) {
      initPromise = null;
      console.warn('[Sandbox] player deep links unavailable:', err);
      return () => {};
    }
  })();
  return initPromise;
}
