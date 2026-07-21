/**
 * Procedural sleep sounds via Web Audio — no external URLs or licensing.
 */

import {
  cancelSleepTimer,
  getSleepTimerSnapshot,
  startSleepTimer,
  subscribeSleepTimer,
  type SleepTimerPresetId,
} from './sleepTimer';

export type SleepSoundId =
  | 'white_noise'
  | 'pink_noise'
  | 'brown_noise'
  | 'fan'
  | 'rain'
  | 'ocean'
  | 'thunder'
  | 'whales'
  | 'forest'
  | 'singing_bowls'
  | 'meditation_drone';

export type SleepSoundCategory = 'noise' | 'nature' | 'ambient';

export const SLEEP_SOUND_CATEGORIES: ReadonlyArray<{
  id: SleepSoundCategory | 'all';
  label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'noise', label: 'Noise' },
  { id: 'nature', label: 'Nature' },
  { id: 'ambient', label: 'Ambient' },
];

export const SLEEP_SOUNDS: ReadonlyArray<{
  id: SleepSoundId;
  label: string;
  category: SleepSoundCategory;
}> = [
  { id: 'white_noise', label: 'White Noise', category: 'noise' },
  { id: 'pink_noise', label: 'Pink Noise', category: 'noise' },
  { id: 'brown_noise', label: 'Brown Noise', category: 'noise' },
  { id: 'fan', label: 'Fan', category: 'noise' },
  { id: 'rain', label: 'Rain', category: 'nature' },
  { id: 'ocean', label: 'Ocean', category: 'nature' },
  { id: 'thunder', label: 'Thunder', category: 'nature' },
  { id: 'whales', label: 'Whales', category: 'nature' },
  { id: 'forest', label: 'Forest Birds', category: 'nature' },
  { id: 'singing_bowls', label: 'Singing Bowls', category: 'ambient' },
  { id: 'meditation_drone', label: 'Meditation Drone', category: 'ambient' },
];

export const SLEEP_SOUND_TIMER_PRESETS: ReadonlyArray<{
  id: SleepTimerPresetId;
  label: string;
}> = [
  { id: '15', label: '15 min' },
  { id: '30', label: '30 min' },
  { id: '45', label: '45 min' },
  { id: '60', label: '60 min' },
];

export interface SleepSoundSnapshot {
  active: boolean;
  soundId: SleepSoundId | null;
  timerLinked: boolean;
}

type SoundCleanup = () => void;

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let activeSoundId: SleepSoundId | null = null;
let cleanupFn: SoundCleanup | null = null;
let timerLinked = false;
let fadeHandle: ReturnType<typeof setInterval> | null = null;
let intervalHandles: ReturnType<typeof setInterval>[] = [];
let timeoutHandles: ReturnType<typeof setTimeout>[] = [];

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function getMaster(): GainNode {
  const ctx = getCtx();
  if (!masterGain) {
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.35;
    masterGain.connect(ctx.destination);
  }
  return masterGain;
}

function createNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function playNoiseLoop(
  ctx: AudioContext,
  master: GainNode,
  variant: 'white' | 'pink' | 'brown',
): SoundCleanup {
  const source = ctx.createBufferSource();
  source.buffer = createNoiseBuffer(ctx, 4);
  source.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';

  if (variant === 'white') {
    filter.frequency.value = 8000;
  } else if (variant === 'pink') {
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.5;
  } else {
    filter.type = 'lowpass';
    filter.frequency.value = 120;
    filter.Q.value = 1.2;
  }

  const gain = ctx.createGain();
  gain.gain.value = variant === 'brown' ? 0.9 : 0.55;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start();

  return () => {
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

function playFan(ctx: AudioContext, master: GainNode): SoundCleanup {
  const source = ctx.createBufferSource();
  source.buffer = createNoiseBuffer(ctx, 4);
  source.loop = true;

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 160;
  band.Q.value = 0.8;

  const gain = ctx.createGain();
  gain.gain.value = 0.5;

  source.connect(band);
  band.connect(gain);
  gain.connect(master);
  source.start();

  return () => {
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    source.disconnect();
    band.disconnect();
    gain.disconnect();
  };
}

function playRain(ctx: AudioContext, master: GainNode): SoundCleanup {
  const cleanups: SoundCleanup[] = [];
  cleanups.push(playNoiseLoop(ctx, master, 'white'));

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2800;
  band.Q.value = 0.4;

  const rainGain = ctx.createGain();
  rainGain.gain.value = 0.25;
  band.connect(rainGain);
  rainGain.connect(master);

  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx, 3);
  src.loop = true;
  src.connect(band);
  src.start();
  cleanups.push(() => {
    try {
      src.stop();
    } catch {
      /* noop */
    }
    src.disconnect();
    band.disconnect();
    rainGain.disconnect();
  });

  const drip = () => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 900 + Math.random() * 600;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    osc.connect(g);
    g.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
    timeoutHandles.push(
      setTimeout(() => {
        osc.disconnect();
        g.disconnect();
      }, 200),
    );
  };

  intervalHandles.push(setInterval(drip, 180 + Math.random() * 220));

  return () => cleanups.forEach((fn) => fn());
}

function playOcean(ctx: AudioContext, master: GainNode): SoundCleanup {
  const cleanup = playNoiseLoop(ctx, master, 'brown');
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.08;
  lfoGain.gain.value = 0.12;
  lfo.connect(lfoGain);
  lfoGain.connect(master.gain);
  lfo.start();

  return () => {
    cleanup();
    try {
      lfo.stop();
    } catch {
      /* noop */
    }
    lfo.disconnect();
    lfoGain.disconnect();
  };
}

function playThunder(ctx: AudioContext, master: GainNode): SoundCleanup {
  const rainCleanup = playRain(ctx, master);

  const rumble = () => {
    const src = ctx.createBufferSource();
    src.buffer = createNoiseBuffer(ctx, 1.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 90;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.5);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start();
    src.stop(ctx.currentTime + 2.6);
    timeoutHandles.push(
      setTimeout(() => {
        src.disconnect();
        filter.disconnect();
        g.disconnect();
      }, 3000),
    );
  };

  intervalHandles.push(setInterval(rumble, 12000 + Math.random() * 18000));

  return rainCleanup;
}

function playWhales(ctx: AudioContext, master: GainNode): SoundCleanup {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  g.gain.value = 0.08;
  osc.connect(g);
  g.connect(master);
  osc.start();

  const sweep = () => {
    const now = ctx.currentTime;
    const start = 60 + Math.random() * 40;
    const end = 180 + Math.random() * 80;
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.exponentialRampToValueAtTime(end, now + 3.5);
    osc.frequency.exponentialRampToValueAtTime(start * 0.8, now + 7);
  };

  sweep();
  intervalHandles.push(setInterval(sweep, 9000 + Math.random() * 6000));

  return () => {
    try {
      osc.stop();
    } catch {
      /* noop */
    }
    osc.disconnect();
    g.disconnect();
  };
}

function playForest(ctx: AudioContext, master: GainNode): SoundCleanup {
  const base = playNoiseLoop(ctx, master, 'pink');

  const chirp = () => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = 1800 + Math.random() * 2200;
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.6, ctx.currentTime + 0.06);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    osc.connect(g);
    g.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    timeoutHandles.push(
      setTimeout(() => {
        osc.disconnect();
        g.disconnect();
      }, 300),
    );
  };

  intervalHandles.push(setInterval(chirp, 1400 + Math.random() * 2800));

  return base;
}

function playSingingBowls(ctx: AudioContext, master: GainNode): SoundCleanup {
  const strike = () => {
    const now = ctx.currentTime;
    const freqs = [220, 330, 440];
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * (0.98 + Math.random() * 0.04);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.12 / freqs.length, now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 6);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + 6.2);
      timeoutHandles.push(
        setTimeout(() => {
          osc.disconnect();
          g.disconnect();
        }, 7000),
      );
    }
  };

  strike();
  intervalHandles.push(setInterval(strike, 10000 + Math.random() * 8000));

  return () => {
    /* oscillators self-stop */
  };
}

function playMeditationDrone(ctx: AudioContext, master: GainNode): SoundCleanup {
  const freqs = [55, 82.5, 110];
  const oscillators: OscillatorNode[] = [];

  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * (0.995 + Math.random() * 0.01);
    g.gain.value = 0.04;
    osc.connect(g);
    g.connect(master);
    osc.start();
    oscillators.push(osc);
  }

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.03;
  lfoGain.gain.value = 0.015;
  lfo.connect(lfoGain);
  lfoGain.connect(master.gain);
  lfo.start();

  return () => {
    for (const osc of oscillators) {
      try {
        osc.stop();
      } catch {
        /* noop */
      }
      osc.disconnect();
    }
    try {
      lfo.stop();
    } catch {
      /* noop */
    }
    lfo.disconnect();
    lfoGain.disconnect();
  };
}

function buildSound(id: SleepSoundId, ctx: AudioContext, master: GainNode): SoundCleanup {
  switch (id) {
    case 'white_noise':
      return playNoiseLoop(ctx, master, 'white');
    case 'pink_noise':
      return playNoiseLoop(ctx, master, 'pink');
    case 'brown_noise':
      return playNoiseLoop(ctx, master, 'brown');
    case 'fan':
      return playFan(ctx, master);
    case 'rain':
      return playRain(ctx, master);
    case 'ocean':
      return playOcean(ctx, master);
    case 'thunder':
      return playThunder(ctx, master);
    case 'whales':
      return playWhales(ctx, master);
    case 'forest':
      return playForest(ctx, master);
    case 'singing_bowls':
      return playSingingBowls(ctx, master);
    case 'meditation_drone':
      return playMeditationDrone(ctx, master);
    default:
      return () => {};
  }
}

function clearScheduled(): void {
  for (const handle of intervalHandles) clearInterval(handle);
  intervalHandles = [];
  for (const handle of timeoutHandles) clearTimeout(handle);
  timeoutHandles = [];
  if (fadeHandle) {
    clearInterval(fadeHandle);
    fadeHandle = null;
  }
}

function internalStop(): void {
  clearScheduled();
  cleanupFn?.();
  cleanupFn = null;
  activeSoundId = null;
  timerLinked = false;
  if (masterGain) {
    masterGain.gain.cancelScheduledValues(getCtx().currentTime);
    masterGain.gain.value = 0.35;
  }
  notify();
}

export function getSleepSoundSnapshot(): SleepSoundSnapshot {
  return {
    active: activeSoundId !== null,
    soundId: activeSoundId,
    timerLinked,
  };
}

export function subscribeSleepSounds(listener: () => void): () => void {
  listeners.add(listener);
  listener();
  return () => listeners.delete(listener);
}

export async function startSleepSound(
  soundId: SleepSoundId,
  timerPreset?: SleepTimerPresetId | null,
): Promise<void> {
  stopSleepSound();

  const ctx = getCtx();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  const master = getMaster();
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.value = 0.35;

  cleanupFn = buildSound(soundId, ctx, master);
  activeSoundId = soundId;

  if (timerPreset) {
    startSleepTimer(timerPreset);
    timerLinked = true;
  }

  notify();
}

export function stopSleepSound(): void {
  if (!activeSoundId) return;
  internalStop();
}

export async function fadeOutSleepSound(durationMs = 3000): Promise<void> {
  if (!activeSoundId || !masterGain || !audioCtx) {
    internalStop();
    return;
  }

  const ctx = audioCtx;
  const gain = masterGain;
  const now = ctx.currentTime;
  const end = now + durationMs / 1000;

  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0.0001, end);

  return new Promise((resolve) => {
    timeoutHandles.push(
      setTimeout(() => {
        internalStop();
        resolve();
      }, durationMs + 50),
    );
  });
}

/** Stop sleep sounds when the linked sleep timer expires. */
let timerSubscribed = false;

function ensureTimerSubscription(): void {
  if (timerSubscribed) return;
  timerSubscribed = true;
  subscribeSleepTimer(() => {
    if (!activeSoundId || !timerLinked) return;
    const snap = getSleepTimerSnapshot();
    if (!snap.active) {
      void fadeOutSleepSound(2500);
    }
  });
}

ensureTimerSubscription();

export function cancelSleepSoundSession(): void {
  if (timerLinked) {
    cancelSleepTimer();
  }
  stopSleepSound();
}
