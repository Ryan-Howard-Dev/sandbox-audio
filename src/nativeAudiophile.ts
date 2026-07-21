/**
 * Tauri native audiophile playback bridge — WASAPI (Windows) or cpal/ALSA/PipeWire (Linux).
 * Bypasses WebView HTMLAudioElement resampling when enabled in Settings → Playback.
 */

import { getCastRuntime } from './castPlatform';
import {
  loadAudiophileDeviceId,
  loadAudiophileEnabled,
  loadAudiophileExclusiveMode,
} from './sandboxSettings';

export interface AudioOutputDevice {
  id: string;
  name: string;
  isDefault: boolean;
  sampleRateHz: number | null;
  channels: number | null;
  exclusiveSupported: boolean;
}

export interface AudiophileSettings {
  enabled: boolean;
  deviceId: string | null;
  exclusiveMode: boolean;
}

export interface NativePlaybackStatus {
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error';
  positionSecs: number;
  durationSecs: number;
  sampleRateHz: number;
  bitsPerSample: number;
  channels: number;
  codec: string;
  exclusiveMode: boolean;
  resampling: boolean;
  error: string | null;
}

export interface AudiophilePlatformSupport {
  os: string;
  supported: boolean;
  exclusiveAvailable: boolean;
  message: string;
  backend?: string;
}

const DEFAULT_SETTINGS: AudiophileSettings = {
  enabled: false,
  deviceId: null,
  exclusiveMode: true,
};

let cachedPlatform: AudiophilePlatformSupport | null = null;

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

export function isTauriDesktop(): boolean {
  return getCastRuntime() === 'tauri' || isTauriRuntime();
}

export async function getAudiophilePlatformSupport(): Promise<AudiophilePlatformSupport> {
  if (!isTauriDesktop()) {
    return {
      os: 'web',
      supported: false,
      exclusiveAvailable: false,
      message: 'Native audiophile playback requires the Sovereign desktop (Tauri) build.',
    };
  }
  if (cachedPlatform) return cachedPlatform;
  try {
    cachedPlatform = await invoke<AudiophilePlatformSupport>('audiophile_platform_support');
    return cachedPlatform;
  } catch {
    return {
      os: 'unknown',
      supported: false,
      exclusiveAvailable: false,
      message: 'Native audiophile commands unavailable.',
    };
  }
}

export async function isNativeAudiophileSupported(): Promise<boolean> {
  const p = await getAudiophilePlatformSupport();
  return p.supported;
}

export async function listAudioOutputDevices(): Promise<AudioOutputDevice[]> {
  if (!isTauriDesktop()) return [];
  const res = await invoke<{ devices: AudioOutputDevice[] }>('list_audio_output_devices');
  return res.devices ?? [];
}

export async function getAudiophileSettings(): Promise<AudiophileSettings> {
  if (!isTauriDesktop()) return { ...DEFAULT_SETTINGS };
  try {
    return await invoke<AudiophileSettings>('get_audiophile_settings');
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setAudiophileSettings(settings: AudiophileSettings): Promise<void> {
  if (!isTauriDesktop()) return;
  await invoke('set_audiophile_settings', { settings });
}

export async function shouldUseNativeAudiophile(): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  if (!loadAudiophileEnabled()) return false;
  const platform = await getAudiophilePlatformSupport();
  return platform.supported;
}

/** Sync UI prefs → Rust backend (call after settings change). */
export async function syncAudiophileSettingsToBackend(): Promise<void> {
  if (!isTauriDesktop()) return;
  await setAudiophileSettings({
    enabled: loadAudiophileEnabled(),
    deviceId: loadAudiophileDeviceId(),
    exclusiveMode: loadAudiophileExclusiveMode(),
  });
}

export async function nativePlayUrl(url: string): Promise<void> {
  await invoke('native_play_url', { url });
}

export async function nativePause(): Promise<void> {
  await invoke('native_pause');
}

export async function nativeResume(): Promise<void> {
  await invoke('native_resume');
}

export async function nativeStop(): Promise<void> {
  await invoke('native_stop');
}

export async function nativeSeek(seconds: number): Promise<void> {
  await invoke('native_seek', { seconds });
}

export async function nativePlaybackStatus(): Promise<NativePlaybackStatus> {
  return invoke<NativePlaybackStatus>('native_playback_status');
}

/** Map native status → HTMLAudioElement-like FSM labels used by sandboxLayer1. */
export function mapNativeStateToFsm(
  state: NativePlaybackStatus['state'],
): 'Idle' | 'Resolving' | 'Connecting' | 'Ready' | 'Playing' | 'Failed' {
  switch (state) {
    case 'loading':
      return 'Connecting';
    case 'playing':
      return 'Playing';
    case 'paused':
      return 'Ready';
    case 'error':
      return 'Failed';
    case 'stopped':
    case 'idle':
      return 'Idle';
    default:
      return 'Idle';
  }
}
