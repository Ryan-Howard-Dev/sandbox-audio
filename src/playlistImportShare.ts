/**
 * Android share target + deep links for external playlist import.
 * sandboxmusic://import/playlist?text=…&name=…
 */

import { Capacitor } from '@capacitor/core';
import { extractFirstImportUrlFromText } from './importPlatforms';

export type PlaylistImportSharePayload = {
  text: string;
  name?: string;
};

export type ExternalPlaylistImportSeed = {
  url: string;
  name?: string;
  platformId?: import('./importPlatforms').ImportPlatformId;
};

let handler: ((seed: ExternalPlaylistImportSeed) => void) | null = null;
let initPromise: Promise<() => void> | null = null;

export function registerPlaylistImportShareHandler(
  fn: ((seed: ExternalPlaylistImportSeed) => void) | null,
): void {
  handler = fn;
}

export function parsePlaylistImportDeepLink(raw: string): PlaylistImportSharePayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(`sandboxmusic://${trimmed.replace(/^\/+/, '')}`);
    if (url.hostname !== 'import') return null;
    const path = url.pathname.replace(/^\/+/, '');
    if (!path.startsWith('playlist')) return null;
    const text = url.searchParams.get('text') ?? url.searchParams.get('url');
    if (!text?.trim()) return null;
    const name = url.searchParams.get('name')?.trim() || undefined;
    return { text: text.trim(), name };
  } catch {
    return null;
  }
}

function payloadToSeed(payload: PlaylistImportSharePayload): ExternalPlaylistImportSeed | null {
  const resolved = extractFirstImportUrlFromText(payload.text);
  if (resolved) {
    return {
      url: resolved.url,
      platformId: resolved.platformId,
      name: payload.name,
    };
  }
  if (!payload.text.trim()) return null;
  return { url: payload.text.trim(), name: payload.name };
}

function dispatchSharePayload(payload: PlaylistImportSharePayload): boolean {
  const seed = payloadToSeed(payload);
  if (!seed) return false;
  handler?.(seed);
  return true;
}

function onNativeShareEvent(event: Event): void {
  const detail = (event as CustomEvent<PlaylistImportSharePayload>).detail;
  if (!detail?.text?.trim()) return;
  dispatchSharePayload(detail);
}

/** Listen for share intents and import deep links. */
export function initPlaylistImportShare(): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) {
    return Promise.resolve(() => {});
  }
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const cleanups: Array<() => void> = [];
    window.addEventListener('sandbox-playlist-import-share', onNativeShareEvent);
    cleanups.push(() =>
      window.removeEventListener('sandbox-playlist-import-share', onNativeShareEvent),
    );

    try {
      const { App } = await import('@capacitor/app');
      const sub = await App.addListener('appUrlOpen', (event) => {
        const payload = parsePlaylistImportDeepLink(event.url);
        if (payload) dispatchSharePayload(payload);
      });
      cleanups.push(() => {
        void sub.remove();
      });

      try {
        const launch = await App.getLaunchUrl();
        if (launch?.url) {
          const payload = parsePlaylistImportDeepLink(launch.url);
          if (payload) dispatchSharePayload(payload);
        }
      } catch {
        /* no cold-start URL */
      }
    } catch (err) {
      console.warn('[Sandbox] playlist import share unavailable:', err);
    }

    return () => {
      for (const fn of cleanups) fn();
      initPromise = null;
    };
  })();
  return initPromise;
}
