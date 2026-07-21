/**
 * Live playback diagnostics — Settings → Playback Engine / Signal Bench.
 */

import type { SonicOutputRoute } from './sandboxSonic';

export interface PlaybackDiagnostics {
  replayGainDb: number;
  calculatedMultiplier: number;
  finalUserVolume: number;
  envelopeId: string | null;
  sonicRoute: SonicOutputRoute | null;
  earSafetyGain: number;
  updatedAt: number;
}

const DEFAULT: PlaybackDiagnostics = {
  replayGainDb: 0,
  calculatedMultiplier: 1,
  finalUserVolume: 0.8,
  envelopeId: null,
  sonicRoute: null,
  earSafetyGain: 1,
  updatedAt: 0,
};

let current: PlaybackDiagnostics = { ...DEFAULT };
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function updatePlaybackDiagnostics(
  partial: Partial<Omit<PlaybackDiagnostics, 'updatedAt'>>,
): void {
  current = { ...current, ...partial, updatedAt: Date.now() };
  notify();
}

export function getPlaybackDiagnostics(): PlaybackDiagnostics {
  return { ...current };
}

export function subscribePlaybackDiagnostics(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
