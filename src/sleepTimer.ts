/**
 * Sleep stop timer + optional wake alarm — persisted via prefsStorage.
 */

import { prefsGetItem, prefsSetItem, prefsRemoveItem } from './prefsStorage';
import {
  cancelNativeWakeAlarm,
  isNativeWakeAlarmAvailable,
  scheduleNativeWakeAlarm,
  syncNativeWakeAlarmFromStorage,
} from './nativeWakeAlarm';
import type { MediaEnvelope } from './sandboxLayer1';

export type SleepTimerPresetId = '15' | '30' | '45' | '60' | 'end_of_track' | 'end_of_queue';

export const SLEEP_TIMER_PRESETS: ReadonlyArray<{
  id: SleepTimerPresetId;
  label: string;
  minutes?: number;
}> = [
  { id: '15', label: '15 min', minutes: 15 },
  { id: '30', label: '30 min', minutes: 30 },
  { id: '45', label: '45 min', minutes: 45 },
  { id: '60', label: '60 min', minutes: 60 },
  { id: 'end_of_track', label: 'End of Track' },
  { id: 'end_of_queue', label: 'End of Queue' },
];

const SLEEP_TIMER_KEY = 'sandbox_sleep_timer';
const WAKE_ALARM_KEY = 'sandbox_wake_alarm';

const TICK_MS = 1000;

export type WakeAlarmTrack = Pick<
  MediaEnvelope,
  | 'envelopeId'
  | 'title'
  | 'artist'
  | 'url'
  | 'artworkUrl'
  | 'provider'
  | 'sourceId'
  | 'durationSeconds'
  | 'transport'
  | 'album'
>;

export interface SleepTimerSnapshot {
  active: boolean;
  preset: SleepTimerPresetId | null;
  endsAt: number | null;
  startedAt: number | null;
  remainingSeconds: number | null;
  isEventBased: boolean;
}

export interface WakeAlarmSnapshot {
  active: boolean;
  fireAt: number | null;
  track: WakeAlarmTrack | null;
}

interface PersistedSleepTimer {
  preset: SleepTimerPresetId;
  endsAt: number | null;
  startedAt: number;
}

interface PersistedWakeAlarm {
  fireAt: number;
  track: WakeAlarmTrack;
}

type SleepTimerCallbacks = {
  onSleepExpire: () => void;
  onWakeAlarm: (track: WakeAlarmTrack) => void;
};

let sleepPreset: SleepTimerPresetId | null = null;
let sleepEndsAt: number | null = null;
let sleepStartedAt: number | null = null;

let wakeFireAt: number | null = null;
let wakeTrack: WakeAlarmTrack | null = null;

const listeners = new Set<() => void>();
let tickHandle: ReturnType<typeof setInterval> | null = null;
let callbacks: SleepTimerCallbacks | null = null;
let nativeWakeArmed = false;

function notify(): void {
  listeners.forEach((fn) => fn());
}

function readSleep(): PersistedSleepTimer | null {
  const raw = prefsGetItem(SLEEP_TIMER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedSleepTimer;
    if (!parsed?.preset) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSleep(data: PersistedSleepTimer | null): void {
  if (!data) {
    prefsRemoveItem(SLEEP_TIMER_KEY);
    return;
  }
  prefsSetItem(SLEEP_TIMER_KEY, JSON.stringify(data));
}

function readWake(): PersistedWakeAlarm | null {
  const raw = prefsGetItem(WAKE_ALARM_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedWakeAlarm;
    if (!parsed?.fireAt || !parsed?.track?.envelopeId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeWake(data: PersistedWakeAlarm | null): void {
  if (!data) {
    prefsRemoveItem(WAKE_ALARM_KEY);
    return;
  }
  prefsSetItem(WAKE_ALARM_KEY, JSON.stringify(data));
}

function clearSleepState(): void {
  sleepPreset = null;
  sleepEndsAt = null;
  sleepStartedAt = null;
  writeSleep(null);
}

function clearWakeState(): void {
  wakeFireAt = null;
  wakeTrack = null;
  writeWake(null);
}

function ensureTick(): void {
  if (tickHandle !== null) return;
  tickHandle = setInterval(() => tick(), TICK_MS);
}

function stopTickIfIdle(): void {
  if (sleepPreset !== null || wakeFireAt !== null) return;
  if (tickHandle !== null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

function tick(): void {
  const now = Date.now();

  if (sleepPreset !== null && sleepEndsAt !== null && now >= sleepEndsAt) {
    clearSleepState();
    callbacks?.onSleepExpire();
  }

  if (!nativeWakeArmed && wakeFireAt !== null && wakeTrack && now >= wakeFireAt) {
    const track = wakeTrack;
    clearWakeState();
    callbacks?.onWakeAlarm(track);
  }

  notify();
  stopTickIfIdle();
}

function hydrateFromStorage(): void {
  const sleep = readSleep();
  if (sleep) {
    if (sleep.endsAt !== null && sleep.endsAt <= Date.now()) {
      writeSleep(null);
    } else {
      sleepPreset = sleep.preset;
      sleepEndsAt = sleep.endsAt;
      sleepStartedAt = sleep.startedAt;
      ensureTick();
    }
  }

  const wake = readWake();
  if (wake) {
    if (wake.fireAt <= Date.now()) {
      writeWake(null);
    } else {
      wakeFireAt = wake.fireAt;
      wakeTrack = wake.track;
      ensureTick();
      if (isNativeWakeAlarmAvailable()) {
        nativeWakeArmed = true;
        void syncNativeWakeAlarmFromStorage(wake.fireAt, wake.track);
      }
    }
  }
}

hydrateFromStorage();

export function registerSleepTimerCallbacks(next: SleepTimerCallbacks): () => void {
  callbacks = next;
  return () => {
    if (callbacks === next) callbacks = null;
  };
}

export function subscribeSleepTimer(listener: () => void): () => void {
  listeners.add(listener);
  listener();
  return () => listeners.delete(listener);
}

export function getSleepTimerSnapshot(): SleepTimerSnapshot {
  const active = sleepPreset !== null;
  let remainingSeconds: number | null = null;
  if (active && sleepEndsAt !== null) {
    remainingSeconds = Math.max(0, Math.ceil((sleepEndsAt - Date.now()) / 1000));
  }
  return {
    active,
    preset: sleepPreset,
    endsAt: sleepEndsAt,
    startedAt: sleepStartedAt,
    remainingSeconds,
    isEventBased: active && sleepEndsAt === null,
  };
}

export function getWakeAlarmSnapshot(): WakeAlarmSnapshot {
  return {
    active: wakeFireAt !== null && wakeTrack !== null,
    fireAt: wakeFireAt,
    track: wakeTrack,
  };
}

export function startSleepTimer(preset: SleepTimerPresetId): void {
  const def = SLEEP_TIMER_PRESETS.find((p) => p.id === preset);
  if (!def) return;

  const startedAt = Date.now();
  const endsAt =
    def.minutes !== undefined ? startedAt + def.minutes * 60_000 : null;

  sleepPreset = preset;
  sleepEndsAt = endsAt;
  sleepStartedAt = startedAt;
  writeSleep({ preset, endsAt, startedAt });
  ensureTick();
  notify();
}

export function cancelSleepTimer(): void {
  if (sleepPreset === null) return;
  clearSleepState();
  notify();
  stopTickIfIdle();
}

export function setWakeAlarm(fireAt: number, track: WakeAlarmTrack): void {
  wakeFireAt = fireAt;
  wakeTrack = track;
  writeWake({ fireAt, track });
  if (isNativeWakeAlarmAvailable()) {
    nativeWakeArmed = true;
    void scheduleNativeWakeAlarm(fireAt, track).then((ok) => {
      if (!ok) nativeWakeArmed = false;
    });
  }
  ensureTick();
  notify();
}

export function cancelWakeAlarm(): void {
  if (wakeFireAt === null) return;
  if (nativeWakeArmed) {
    nativeWakeArmed = false;
    void cancelNativeWakeAlarm();
  }
  clearWakeState();
  notify();
  stopTickIfIdle();
}

/** Called when the native Android alarm fires (background/killed). */
export function handleNativeWakeAlarmFired(track: WakeAlarmTrack): void {
  nativeWakeArmed = false;
  clearWakeState();
  notify();
  stopTickIfIdle();
  callbacks?.onWakeAlarm(track);
}

export function formatSleepRemaining(seconds: number | null, isEventBased: boolean, preset: SleepTimerPresetId | null): string {
  if (!preset) return '--:--';
  if (isEventBased) {
    if (preset === 'end_of_track') return 'Track end';
    if (preset === 'end_of_queue') return 'Queue end';
    return 'Active';
  }
  if (seconds === null || !Number.isFinite(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type TrackEndContext = {
  queueLength: number;
  queueIndex: number;
  repeatMode: 'none' | 'one' | 'all';
};

/** Returns true when sleep timer handled track end (caller should pause and skip queue advance). */
export function handleSleepTimerTrackEnd(ctx: TrackEndContext): boolean {
  if (sleepPreset === null) return false;

  if (sleepPreset === 'end_of_track') {
    clearSleepState();
    notify();
    stopTickIfIdle();
    callbacks?.onSleepExpire();
    return true;
  }

  if (sleepPreset === 'end_of_queue') {
    let next = ctx.queueIndex + 1;
    if (next >= ctx.queueLength) {
      if (ctx.repeatMode === 'all') return false;
      clearSleepState();
      notify();
      stopTickIfIdle();
      callbacks?.onSleepExpire();
      return true;
    }
  }

  return false;
}

export function presetLabel(id: SleepTimerPresetId): string {
  return SLEEP_TIMER_PRESETS.find((p) => p.id === id)?.label ?? id;
}
