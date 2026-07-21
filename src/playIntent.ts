/**
 * Serializes in-flight play taps — each new tap invalidates prior resolves/loads.
 */

import { cancelYtDlpMobileResolve } from './ytDlpMobile';

let playGeneration = 0;
let activeEnvelopeId: string | null = null;

/** Cancel yt-dlp queue and start a new play intent for this envelope. */
export function beginPlayIntent(envelopeId: string): number {
  void cancelYtDlpMobileResolve();
  playGeneration += 1;
  activeEnvelopeId = envelopeId;
  return playGeneration;
}

export function isPlayIntentCurrent(generation: number, envelopeId?: string): boolean {
  if (generation !== playGeneration) return false;
  if (envelopeId != null && activeEnvelopeId !== envelopeId) return false;
  return true;
}

export function currentPlayGeneration(): number {
  return playGeneration;
}

/** Invalidate in-flight resolves without starting a new envelope (dismiss / stuck). */
export function bumpPlayGeneration(): void {
  void cancelYtDlpMobileResolve();
  playGeneration += 1;
}

export function formatMobilePlaybackError(raw: string | null | undefined): string {
  if (!raw?.trim()) return 'Playback unavailable';
  const lower = raw.trim().toLowerCase();
  if (lower.includes('no stream found')) return 'No stream found';
  if (lower.includes('timed out') || lower.includes('timeout')) return 'Resolve timed out';
  const trimmed = raw.trim();
  return trimmed.length > 52 ? `${trimmed.slice(0, 49)}…` : trimmed;
}
