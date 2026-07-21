/**
 * Sovereign Music Console — keyboard shortcuts & Media Session
 *
 * Keyboard shortcuts (window keydown, one binding per key when not typing):
 *   Space / K     Play / pause
 *   M             Toggle mute
 *   ← / →         Skip back / forward (Spotify-style restart if >3s)
 *   ↑ / ↓         Volume ±5%
 *   Shift+← / →   Seek ±10s
 *   Ctrl+K / ⌘+K  Focus search (works even in inputs)
 *   /             Focus search (shell only, not when typing)
 *
 * Intentionally unbound: Ctrl+Space, Alt+arrows (browser / OS reserved).
 * Touch / TV: keyboard shortcuts N/A; Media Session handles headset / OS keys
 * on Android, desktop, and other browsers that expose navigator.mediaSession.
 *
 * Platform: Meta+K on macOS, Ctrl+K on Windows/Linux (event.metaKey || event.ctrlKey).
 */

import { Capacitor } from '@capacitor/core';
import { getPlaybackVolumeCap } from './sandboxSettings';

export function isTextEntryFocused(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (active.isContentEditable) return true;
  return Boolean(active.closest('[contenteditable="true"]'));
}

export function isModalOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
}

/** Skip global playback shortcuts when typing or a modal overlay is open. */
export function shouldIgnoreShortcut(): boolean {
  return isTextEntryFocused() || isModalOpen();
}

export type ShortcutCategory = 'playback' | 'navigation';

export interface ShortcutLegendEntry {
  keys: string;
  action: string;
  category: ShortcutCategory;
}

export const SHORTCUT_LEGEND: ShortcutLegendEntry[] = [
  { keys: 'Space / K', action: 'Play / pause', category: 'playback' },
  { keys: 'M', action: 'Mute / unmute', category: 'playback' },
  { keys: '←', action: 'Skip back (restart if >3s)', category: 'playback' },
  { keys: '→', action: 'Skip forward', category: 'playback' },
  { keys: '↑ / ↓', action: 'Volume ±5%', category: 'playback' },
  { keys: 'Shift+← / →', action: 'Seek ±10s', category: 'playback' },
  { keys: 'Ctrl+K / ⌘+K', action: 'Focus search', category: 'navigation' },
  { keys: '/', action: 'Focus search', category: 'navigation' },
];

export interface KeyboardShortcutOptions {
  /** When true, arrow keys are left to TV D-pad focus navigation (no skip/volume). */
  tvMode?: boolean;
  /** When true, search focus shortcuts are disabled (car mode lock). */
  carMode?: boolean;
}

export interface KeyboardShortcutHandlers {
  togglePlay: () => void;
  toggleMute: () => void;
  skipBack: () => void;
  skipForward: () => void;
  seekRelative: (deltaSeconds: number) => void;
  getVolume: () => number;
  setVolume: (level: number) => void;
  focusSearch: () => void;
  isIdle: () => boolean;
}

function isAltArrow(event: KeyboardEvent): boolean {
  return (
    event.altKey &&
    (event.code === 'ArrowLeft' ||
      event.code === 'ArrowRight' ||
      event.code === 'ArrowUp' ||
      event.code === 'ArrowDown')
  );
}

function isCtrlSpace(event: KeyboardEvent): boolean {
  return event.ctrlKey && (event.code === 'Space' || event.key === ' ');
}

export function registerKeyboardShortcuts(
  handlers: KeyboardShortcutHandlers,
  options: KeyboardShortcutOptions = {},
): () => void {
  const tvMode = options.tvMode ?? false;
  const carMode = options.carMode ?? false;

  const onKeyDown = (event: KeyboardEvent) => {
    if (isCtrlSpace(event) || isAltArrow(event)) return;

    if (!carMode && (event.ctrlKey || event.metaKey) && event.code === 'KeyK') {
      event.preventDefault();
      handlers.focusSearch();
      return;
    }

    if (
      !carMode &&
      event.key === '/' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      if (isTextEntryFocused()) return;
      event.preventDefault();
      handlers.focusSearch();
      return;
    }

    if (shouldIgnoreShortcut()) return;

    if (event.code === 'Space' || event.key === ' ') {
      if (event.repeat || handlers.isIdle()) return;
      event.preventDefault();
      handlers.togglePlay();
      return;
    }

    if (
      event.code === 'KeyK' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      if (event.repeat || handlers.isIdle()) return;
      event.preventDefault();
      handlers.togglePlay();
      return;
    }

    if (
      event.code === 'KeyM' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      if (event.repeat) return;
      event.preventDefault();
      handlers.toggleMute();
      return;
    }

    if (!tvMode) {
      if (
        event.shiftKey &&
        event.code === 'ArrowLeft' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        handlers.seekRelative(-10);
        return;
      }

      if (
        event.shiftKey &&
        event.code === 'ArrowRight' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        handlers.seekRelative(10);
        return;
      }

      if (
        !event.shiftKey &&
        event.code === 'ArrowLeft' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        handlers.skipBack();
        return;
      }

      if (
        !event.shiftKey &&
        event.code === 'ArrowRight' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        handlers.skipForward();
        return;
      }

      if (
        !event.shiftKey &&
        event.code === 'ArrowUp' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        handlers.setVolume(Math.min(getPlaybackVolumeCap(), handlers.getVolume() + 0.05));
        return;
      }

      if (
        !event.shiftKey &&
        event.code === 'ArrowDown' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        handlers.setVolume(Math.max(0, handlers.getVolume() - 0.05));
        return;
      }
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

export interface MediaSessionTrackMetadata {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  envelopeId?: string;
}

export interface MediaSessionHandlers {
  play: () => void;
  pause: () => void;
  skipBack: () => void;
  skipForward: () => void;
  seekRelative: (deltaSeconds: number) => void;
  getMetadata: () => MediaSessionTrackMetadata | null;
}

export function registerMediaSession(handlers: MediaSessionHandlers): () => void {
  if (!('mediaSession' in navigator)) {
    return () => {};
  }

  const syncMetadata = () => {
    const meta = handlers.getMetadata();
    if (!meta?.title) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const artwork: MediaImage[] = [];
    if (meta.artworkUrl) {
      artwork.push({ src: meta.artworkUrl, sizes: '512x512', type: 'image/jpeg' });
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist,
      album: meta.album ?? '',
      artwork,
    });
  };

  try {
    navigator.mediaSession.setActionHandler('play', () => {
      handlers.play();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      handlers.pause();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      handlers.skipBack();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      handlers.skipForward();
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      handlers.seekRelative(-(details?.seekOffset ?? 10));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      handlers.seekRelative(details?.seekOffset ?? 10);
    });
  } catch (err) {
    console.warn('[registerMediaSession] setActionHandler failed:', err);
  }

  syncMetadata();

  return () => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    } catch {
      // ignore teardown errors
    }
  };
}

export function syncMediaSessionState(
  metadata: MediaSessionTrackMetadata | null,
  isPlaying: boolean,
  positionSeconds = 0,
  durationSeconds = 0,
): void {
  if (!('mediaSession' in navigator)) return;

  // Android lock-screen metadata is owned by MediaPlaybackForegroundService — avoid
  // competing WebView MediaSession metadata that can stick on the lock screen.
  if (Capacitor.getPlatform() === 'android') {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    return;
  }

  if (metadata?.title) {
    const artwork: MediaImage[] = [];
    if (metadata.artworkUrl) {
      artwork.push({ src: metadata.artworkUrl, sizes: '512x512', type: 'image/jpeg' });
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album ?? '',
      artwork,
    });
  } else {
    navigator.mediaSession.metadata = null;
  }

  navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

  if (
    durationSeconds > 0 &&
    Number.isFinite(positionSeconds) &&
    typeof navigator.mediaSession.setPositionState === 'function'
  ) {
    try {
      navigator.mediaSession.setPositionState({
        duration: durationSeconds,
        position: Math.max(0, Math.min(positionSeconds, durationSeconds)),
        playbackRate: 1,
      });
    } catch {
      // Some WebViews reject position updates before playback starts.
    }
  }
}
