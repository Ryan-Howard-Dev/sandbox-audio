/**
 * E2E / automation helpers — wait for the chosen track to play stably (native Exo + UI).
 */

import {
  getNativeExoPlaybackStatus,
  nativeExoResume,
  nativeExoStop,
} from './androidNativePlayback';
import { effectiveNativeExoState, isNativeExoAudible } from './lastPlayIntent';
import { bumpPlayGeneration } from './playIntent';

export function titlesMatchLoose(a: string | undefined, b: string): boolean {
  if (!a?.trim() || !b.trim()) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function prepareCleanPlaybackStop(audioStop?: () => void): Promise<void> {
  bumpPlayGeneration();
  try {
    await nativeExoStop();
  } catch {
    /* optional */
  }
  audioStop?.();
  await new Promise((r) => window.setTimeout(r, 2000));
}

export async function waitForPlaybackStarted(opts: {
  getProbeTitle?: () => string | undefined;
  getProbePosition?: () => number;
  getProbeDuration?: () => number;
  getProbeState?: () => string | undefined;
  expectedTitle?: string;
  timeoutMs?: number;
  onStuck?: () => void | Promise<void>;
}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  let resumeNudges = 0;
  let lastPos = 0;

  while (Date.now() < deadline) {
    const status = await getNativeExoPlaybackStatus();
    const uiPos = opts.getProbePosition?.() ?? 0;
    const uiDur = opts.getProbeDuration?.() ?? 0;
    const pos = Math.max(status.positionSecs ?? 0, uiPos);
    const dur = Math.max(status.durationSecs ?? 0, uiDur);
    const effective = effectiveNativeExoState(status, lastPos);
    const audible = isNativeExoAudible(status, lastPos) || effective === 'playing';
    const uiState = opts.getProbeState?.();
    const uiPlaying =
      uiState === 'Playing' || uiState === 'Ready' || uiState === 'Resolving';
    const titleOk =
      !opts.expectedTitle?.trim() ||
      titlesMatchLoose(opts.getProbeTitle?.(), opts.expectedTitle) ||
      titlesMatchLoose(status.title, opts.expectedTitle);

    if (titleOk && (audible || uiPlaying) && (dur > 0 || pos > 0.15 || (status.queueLength ?? 0) >= 1)) {
      if (
        resumeNudges < 8 &&
        (status.state === 'paused' || status.state === 'idle' || status.state === 'loading') &&
        dur > 0 &&
        pos < 0.5
      ) {
        resumeNudges += 1;
        try {
          await nativeExoResume();
        } catch {
          /* optional */
        }
        try {
          await opts.onStuck?.();
        } catch {
          /* optional */
        }
        lastPos = pos;
        await new Promise((r) => window.setTimeout(r, 500));
        continue;
      }
      if (status.state === 'playing' || effective === 'playing' || (audible && pos > lastPos + 0.1)) {
        return true;
      }
      if (dur >= 45 && pos > 0.35 && pos > lastPos + 0.04) return true;
    }

    if (titleOk && resumeNudges < 32) {
      const stuck =
        (status.state === 'paused' || status.state === 'idle' || status.state === 'loading') &&
        dur > 5;
      const noAdvance = pos < lastPos + 0.12 && pos < 2;
      if (stuck || noAdvance) {
        resumeNudges += 1;
        try {
          await nativeExoResume();
        } catch {
          /* optional */
        }
        try {
          await opts.onStuck?.();
        } catch {
          /* optional */
        }
      }
    }

    lastPos = pos;
    await new Promise((r) => window.setTimeout(r, 500));
  }

  return false;
}

export async function waitForStablePlayback(opts: {
  expectedTitle: string;
  getProbeTitle: () => string | undefined;
  getUiPosition: () => number;
  getUiState?: () => string | undefined;
  minAdvanceSecs?: number;
  timeoutMs?: number;
  onStuck?: () => void | Promise<void>;
}): Promise<boolean> {
  const minAdvanceSecs = opts.minAdvanceSecs ?? 4;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const deadline = Date.now() + timeoutMs;
  let lastPos = 0;
  let matchedTitle = false;
  let startPos = -1;
  let resumeNudges = 0;
  let titleMismatchStreak = 0;

  while (Date.now() < deadline) {
    const status = await getNativeExoPlaybackStatus();
    const uiPos = opts.getUiPosition();
    const pos = Math.max(status.positionSecs ?? 0, uiPos);
    const probeTitle = opts.getProbeTitle();
    const nativeTitle = status.title?.trim();
    const titleOk =
      titlesMatchLoose(probeTitle, opts.expectedTitle) ||
      titlesMatchLoose(nativeTitle, opts.expectedTitle);
    const effective = effectiveNativeExoState(status, lastPos);
    const dur = status.durationSecs ?? 0;

    if (matchedTitle && !titleOk) {
      titleMismatchStreak += 1;
      if (titleMismatchStreak >= 4) return false;
    } else {
      titleMismatchStreak = 0;
    }

    if (titleOk) {
      matchedTitle = true;
      if (startPos < 0) startPos = pos;
      const uiState = opts.getUiState?.();
      const uiPlaying = uiState === 'Playing' || uiState === 'Ready';
      const effectivePlaying = effective === 'playing' || status.state === 'playing';
      const advancingWhilePaused =
        status.state === 'paused' && pos > lastPos + 0.08 && pos > startPos + 0.2;
      const minAdvance =
        dur >= 45 ? Math.min(minAdvanceSecs, 1.25) : minAdvanceSecs;

      if (pos >= startPos + minAdvance) return true;
      if ((uiPlaying || effectivePlaying || advancingWhilePaused) && pos > startPos + 0.2) {
        return true;
      }
      if (
        (isNativeExoAudible(status, lastPos) || effectivePlaying || advancingWhilePaused) &&
        dur >= 45 &&
        pos >= startPos + Math.min(minAdvance, 0.85)
      ) {
        return true;
      }
    }

    if (matchedTitle && resumeNudges < 40) {
      const stuck =
        (status.state === 'paused' || status.state === 'idle' || status.state === 'loading') &&
        dur > 5;
      const noAdvance = startPos >= 0 && pos < startPos + 0.12;
      if (stuck || noAdvance) {
        resumeNudges += 1;
        try {
          await nativeExoResume();
        } catch {
          /* optional */
        }
        try {
          await opts.onStuck?.();
        } catch {
          /* optional */
        }
      }
    }

    lastPos = pos;
    await new Promise((r) => window.setTimeout(r, 600));
  }

  return false;
}

/** Wait until playback title advances to the next expected track (native Exo queue / gapless). */
export async function waitForTrackTransition(opts: {
  expectedTitle: string;
  previousTitle?: string;
  getProbeTitle?: () => string | undefined;
  timeoutMs?: number;
}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const deadline = Date.now() + timeoutMs;
  let resumeNudges = 0;

  while (Date.now() < deadline) {
    const status = await getNativeExoPlaybackStatus();
    const probeTitle = opts.getProbeTitle?.()?.trim();
    const nativeTitle = status.title?.trim();
    const titleOk =
      titlesMatchLoose(probeTitle, opts.expectedTitle) ||
      titlesMatchLoose(nativeTitle, opts.expectedTitle);
    const leftPrevious =
      !opts.previousTitle?.trim() ||
      (!titlesMatchLoose(probeTitle, opts.previousTitle) &&
        !titlesMatchLoose(nativeTitle, opts.previousTitle));

    if (titleOk && leftPrevious) {
      const pos = status.positionSecs ?? 0;
      const playing =
        status.state === 'playing' ||
        effectiveNativeExoState(status, pos) === 'playing' ||
        isNativeExoAudible(status, pos);
      if (playing || pos > 0.1 || (status.queueIndex ?? 0) > 0) return true;
    }

    if (resumeNudges < 24 && (status.state === 'paused' || status.state === 'idle')) {
      resumeNudges += 1;
      try {
        await nativeExoResume();
      } catch {
        /* optional */
      }
    }

    await new Promise((r) => window.setTimeout(r, 800));
  }

  return false;
}
