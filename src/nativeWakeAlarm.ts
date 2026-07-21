/**
 * Android wake alarm bridge — AlarmManager + notification when app is backgrounded/killed.
 *
 * Web/desktop fall back to the JS interval in sleepTimer.ts.
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { MediaTransport } from './sandboxLayer1';
import type { WakeAlarmTrack } from './sleepTimer';

export interface WakeAlarmPlugin {
  schedule(options: { fireAtMs: number; track: WakeAlarmTrack }): Promise<{
    scheduled: boolean;
    fireAtMs?: number;
  }>;
  cancel(): Promise<{ scheduled: boolean }>;
  isScheduled(): Promise<{ scheduled: boolean; fireAtMs?: number }>;
  consumePending(): Promise<{ pending: boolean; track?: WakeAlarmTrack }>;
  addListener(
    eventName: 'wakeAlarmFired',
    listenerFunc: (track: WakeAlarmTrack) => void,
  ): Promise<PluginListenerHandle>;
}

const WakeAlarm = registerPlugin<WakeAlarmPlugin>('WakeAlarm', {
  web: () => import('./nativeWakeAlarm.web').then((m) => new m.WakeAlarmWeb()),
});

let listenerHandle: PluginListenerHandle | null = null;
let initialized = false;

export function isNativeWakeAlarmAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export async function scheduleNativeWakeAlarm(
  fireAtMs: number,
  track: WakeAlarmTrack,
): Promise<boolean> {
  if (!isNativeWakeAlarmAvailable()) return false;
  try {
    const result = await WakeAlarm.schedule({ fireAtMs, track });
    return Boolean(result.scheduled);
  } catch (err) {
    console.warn('[nativeWakeAlarm] schedule failed:', err);
    return false;
  }
}

export async function cancelNativeWakeAlarm(): Promise<void> {
  if (!isNativeWakeAlarmAvailable()) return;
  await WakeAlarm.cancel().catch((err) => {
    console.warn('[nativeWakeAlarm] cancel failed:', err);
  });
}

export async function syncNativeWakeAlarmFromStorage(
  fireAt: number,
  track: WakeAlarmTrack,
): Promise<void> {
  if (!isNativeWakeAlarmAvailable()) return;
  const status = await WakeAlarm.isScheduled().catch(() => ({ scheduled: false as const }));
  if (status.scheduled && 'fireAtMs' in status && status.fireAtMs === fireAt) return;
  await scheduleNativeWakeAlarm(fireAt, track);
}

function parseWakeTrack(raw: WakeAlarmTrack): WakeAlarmTrack | null {
  const envelopeId = raw.envelopeId ?? '';
  if (!envelopeId) return null;
  const transport = raw.transport;
  const validTransport: MediaTransport | undefined =
    transport === 'element-src' ||
    transport === 'mediasource' ||
    transport === 'webaudio-buffer' ||
    transport === 'stream-proxy' ||
    transport === 'proxy' ||
    transport === 'debrid' ||
    transport === 'p2p'
      ? transport
      : undefined;
  return {
    envelopeId,
    title: raw.title ?? '',
    artist: raw.artist ?? '',
    url: raw.url,
    artworkUrl: raw.artworkUrl,
    provider: raw.provider,
    sourceId: raw.sourceId,
    durationSeconds: raw.durationSeconds,
    transport: validTransport,
    album: raw.album,
  };
}

export async function initNativeWakeAlarm(
  onWakeAlarm: (track: WakeAlarmTrack) => void,
): Promise<void> {
  if (!isNativeWakeAlarmAvailable() || initialized) return;

  listenerHandle = await WakeAlarm.addListener('wakeAlarmFired', (track) => {
    const parsed = parseWakeTrack(track);
    if (parsed) onWakeAlarm(parsed);
  });

  const pending = await WakeAlarm.consumePending().catch(() => ({ pending: false as const }));
  if (pending.pending && 'track' in pending && pending.track) {
    const parsed = parseWakeTrack(pending.track);
    if (parsed) onWakeAlarm(parsed);
  }

  initialized = true;
}

export async function teardownNativeWakeAlarm(): Promise<void> {
  if (!initialized) return;
  await listenerHandle?.remove();
  listenerHandle = null;
  initialized = false;
}
