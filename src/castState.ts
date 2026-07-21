/**
 * Speaker cast state — Sonos / UPnP / remote cast picker (extends cinema cast, does not replace it).
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { requestCinemaCast, type CinemaCastPayload } from './cinemaCast';
import {
  endCastSession,
  getCastDeviceName,
  isCastConnected,
  syncCastPlayback,
} from './castSender';
import type { NativeCastQueueItem } from './nativeCast';
import { saveCastingEnabled } from './sandboxSettings';
import { resolveSpeakerCastStreamUrl } from './castStreamResolver';
import {
  tier34SonosPause,
  tier34SonosPlay,
  tier34SonosVolume,
  type CastDevice,
} from './tier34/client';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

export type SpeakerCastDeviceType = 'sonos' | 'upnp' | 'remote_cast';

export interface CastState {
  isActive: boolean;
  deviceName: string | null;
  deviceIp: string | null;
  deviceType: SpeakerCastDeviceType | null;
  volume: number;
}

const DEFAULT_CAST_STATE: CastState = {
  isActive: false,
  deviceName: null,
  deviceIp: null,
  deviceType: null,
  volume: 50,
};

const DEFAULT_DEVICE_KEY = 'sandbox_cast_default_device';
const AUTO_CAST_KEY = 'sandbox_cast_auto_cast';
const LAST_SCAN_KEY = 'sandbox_cast_last_scan';

let castState: CastState = { ...DEFAULT_CAST_STATE };
const listeners = new Set<(state: CastState) => void>();

function notify(): void {
  const snapshot = { ...castState };
  for (const listener of listeners) listener(snapshot);
}

export function getCastState(): CastState {
  return { ...castState };
}

export function subscribeCastState(handler: (state: CastState) => void): () => void {
  listeners.add(handler);
  handler({ ...castState });
  return () => listeners.delete(handler);
}

export function loadDefaultCastDevice(): CastDevice | null {
  try {
    const raw = prefsGetItem(DEFAULT_DEVICE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CastDevice;
  } catch {
    return null;
  }
}

export function saveDefaultCastDevice(device: CastDevice | null): void {
  if (!device) {
    prefsSetItem(DEFAULT_DEVICE_KEY, '');
    return;
  }
  prefsSetItem(DEFAULT_DEVICE_KEY, JSON.stringify(device));
}

export function loadAutoCastEnabled(): boolean {
  return prefsGetItem(AUTO_CAST_KEY) === 'true';
}

export function saveAutoCastEnabled(enabled: boolean): void {
  prefsSetItem(AUTO_CAST_KEY, String(enabled));
}

export function loadLastCastScan(): CastDevice[] {
  try {
    const raw = prefsGetItem(LAST_SCAN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { devices?: CastDevice[] };
    return Array.isArray(parsed?.devices) ? parsed.devices : [];
  } catch {
    return [];
  }
}

export function saveLastCastScan(devices: CastDevice[]): void {
  prefsSetItem(LAST_SCAN_KEY, JSON.stringify({ devices, at: Date.now() }));
}

function isSpeakerDeviceType(type: CastDevice['type']): type is 'sonos' | 'upnp' {
  return type === 'sonos' || type === 'upnp';
}

export async function startCastToDevice(
  device: CastDevice,
  envelope: MediaEnvelope | null,
  meta?: {
    title?: string;
    artist?: string;
    artworkUrl?: string;
    isPlaying?: boolean;
    currentTimeSeconds?: number;
    durationSeconds?: number;
  },
): Promise<{ ok: boolean; error?: string }> {
  if (device.type === 'remote_cast') {
    saveCastingEnabled(true);
    if (!isCastConnected()) {
      const session = await requestCinemaCast();
      if (!session.ok) {
        return { ok: false, error: session.error ?? 'Cast session unavailable' };
      }
    }
    castState = {
      isActive: true,
      deviceName: getCastDeviceName() ?? device.name,
      deviceIp: device.ip || null,
      deviceType: 'remote_cast',
      volume: castState.volume,
    };
    notify();
    if (envelope) await syncCastEnvelope(envelope, meta);
    return { ok: true };
  }

  if (!isSpeakerDeviceType(device.type)) {
    return { ok: false, error: 'Unsupported device type' };
  }

  if (!envelope) {
    return { ok: false, error: 'No track loaded' };
  }

  const streamUrl = await resolveSpeakerCastStreamUrl(envelope);
  if (!streamUrl) {
    return {
      ok: false,
      error: 'No LAN stream URL — set tier34 to your machine IP and use locker or proxy tracks',
    };
  }

  const result = await tier34SonosPlay({
    ip: device.ip,
    streamUrl,
    title: meta?.title ?? envelope.title,
    artist: meta?.artist ?? envelope.artist,
  });

  if (!result.ok) return result;

  castState = {
    isActive: true,
    deviceName: device.name,
    deviceIp: device.ip,
    deviceType: device.type,
    volume: castState.volume,
  };
  notify();
  return { ok: true };
}

export async function stopSpeakerCast(): Promise<void> {
  if (castState.deviceType === 'remote_cast' || isCastConnected()) {
    endCastSession();
  } else if (
    castState.deviceIp &&
    (castState.deviceType === 'sonos' || castState.deviceType === 'upnp')
  ) {
    await tier34SonosPause(castState.deviceIp).catch(() => undefined);
  }
  castState = { ...DEFAULT_CAST_STATE, volume: castState.volume };
  notify();
}

export async function setSpeakerCastVolume(volume: number): Promise<void> {
  const vol = Math.max(0, Math.min(100, Math.round(volume)));
  castState = { ...castState, volume: vol };
  notify();
  if (castState.deviceIp && castState.deviceType !== 'remote_cast') {
    await tier34SonosVolume(castState.deviceIp, vol).catch(() => undefined);
  }
}

export async function resolveCastQueueItems(
  queue: MediaEnvelope[],
): Promise<NativeCastQueueItem[]> {
  const items: NativeCastQueueItem[] = [];
  for (const envelope of queue) {
    const streamUrl = await resolveSpeakerCastStreamUrl(envelope);
    if (!streamUrl) continue;
    items.push({
      streamUrl,
      title: envelope.title,
      artist: envelope.artist,
      album: envelope.album,
      artworkUrl: envelope.artworkUrl,
      durationSeconds: envelope.durationSeconds,
    });
  }
  return items;
}

export async function syncCastEnvelope(
  envelope: MediaEnvelope,
  meta?: {
    title?: string;
    artist?: string;
    artworkUrl?: string;
    isPlaying?: boolean;
    currentTimeSeconds?: number;
    durationSeconds?: number;
  },
  queueContext?: { queue: MediaEnvelope[]; index: number },
): Promise<void> {
  if (!castState.isActive) return;

  if (castState.deviceType === 'remote_cast' || isCastConnected()) {
    const streamUrl = await resolveSpeakerCastStreamUrl(envelope);
    let queue: NativeCastQueueItem[] | undefined;
    let queueIndex: number | undefined;
    if (queueContext && queueContext.queue.length > 0) {
      queue = await resolveCastQueueItems(queueContext.queue);
      queueIndex = Math.max(0, Math.min(queueContext.index, queue.length - 1));
    }
    const payload: CinemaCastPayload = {
      title: meta?.title ?? envelope.title,
      artist: meta?.artist ?? envelope.artist,
      albumArt: meta?.artworkUrl ?? envelope.artworkUrl,
      isPlaying: meta?.isPlaying ?? true,
      currentTimeSeconds: meta?.currentTimeSeconds ?? 0,
      durationSeconds: meta?.durationSeconds ?? envelope.durationSeconds ?? 0,
      streamUrl: streamUrl ?? undefined,
    };
    await syncCastPlayback({
      ...payload,
      album: envelope.album,
      queue,
      queueIndex,
    });
    return;
  }

  if (!castState.deviceIp || !isSpeakerDeviceType(castState.deviceType ?? 'upnp')) return;

  const streamUrl = await resolveSpeakerCastStreamUrl(envelope);
  if (!streamUrl) return;

  await tier34SonosPlay({
    ip: castState.deviceIp,
    streamUrl,
    title: meta?.title ?? envelope.title,
    artist: meta?.artist ?? envelope.artist,
  }).catch(() => undefined);
}

export function isSpeakerCastActive(): boolean {
  return castState.isActive;
}
