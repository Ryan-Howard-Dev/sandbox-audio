// @vitest-environment jsdom
/**
 * How often a playing queue actually reaches storage.
 *
 * The save is debounced, which reads as "this is throttled" until the numbers are put side by
 * side: the debounce is 400ms and the Android native position poll is 450ms. A debounce only
 * coalesces calls that arrive faster than it, so at 450ms every single tick produced its own
 * write. The queue was being serialised to JSON and written to storage about twice a second for
 * the whole session, on the main thread, on a phone.
 *
 * This measures it rather than reasoning about it, and pins the relationship so a future change to
 * either number cannot quietly restore the behaviour.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUE_STATE_KEY, flushQueueState, saveQueueState } from './queuePersistence';
import type { MediaEnvelope } from './sandboxLayer1';

/** The Android native playback poll when something is playing (NATIVE_EXO_POLL_MS_ACTIVE). */
const NATIVE_POLL_MS = 450;
/** What the position writer now uses instead. */
const POSITION_SAVE_INTERVAL_MS = 5000;

const track = (n: number): MediaEnvelope =>
  ({
    envelopeId: `local-${n}`,
    title: `Track ${n}`,
    artist: 'Future',
    url: `https://example.invalid/${n}.mp3`,
    durationSeconds: 210,
    provider: 'local-vault',
    transport: 'element-src',
  }) as MediaEnvelope;

const queue = Array.from({ length: 40 }, (_, i) => track(i));

function saveAt(seconds: number) {
  saveQueueState({
    playQueue: queue,
    queueIndex: 3,
    shuffleOn: false,
    repeatMode: 'none',
    currentTrackId: 'local-3',
    currentTimeSeconds: seconds,
    wasPlaying: true,
  });
}

/**
 * What actually reached storage, read back rather than intercepted.
 *
 * Spying on Storage.prototype.setItem does not work here: jsdom's localStorage is proxied, so the
 * prototype method is not the one being called, and the counter sat at zero while the writes were
 * happening perfectly well. Reading the stored value back measures the thing the test is about.
 */
function storedPosition(): number | null {
  const raw =
    localStorage.getItem(QUEUE_STATE_KEY) ?? sessionStorage.getItem(QUEUE_STATE_KEY);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { currentTimeSeconds?: number }).currentTimeSeconds ?? null;
  } catch {
    return null;
  }
}

/** Distinct values that landed, which is one per write since every tick carries a new position. */
function countWrites(run: (observe: () => void) => void): number {
  const seen: (number | null)[] = [];
  run(() => {
    const value = storedPosition();
    if (seen.length === 0 || seen[seen.length - 1] !== value) seen.push(value);
  });
  return seen.filter((v) => v !== null).length;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  flushQueueState();
  localStorage.clear();
  sessionStorage.clear();
});

/** Nine seconds of ordinary listening, saved at whatever cadence is being tried. */
const LISTEN_MS = 20 * NATIVE_POLL_MS;

describe('queue save cadence', () => {
  it('writes on every tick when the position is what drives the save', () => {
    const writes = countWrites((observe) => {
      for (let i = 0; i < 20; i += 1) {
        saveAt(i * (NATIVE_POLL_MS / 1000));
        vi.advanceTimersByTime(NATIVE_POLL_MS);
        observe();
      }
    });
    // The debounce coalesces nothing at this cadence: 450ms apart is slower than a 400ms
    // debounce, so every tick got its own serialise-and-write.
    expect(writes).toBe(20);
  });

  it('coalesces only calls that arrive faster than the debounce', () => {
    // The case the debounce was written for, and the one that made it look safe.
    for (let i = 0; i < 20; i += 1) {
      saveAt(i);
      vi.advanceTimersByTime(50);
    }
    expect(storedPosition()).toBeNull();
    vi.advanceTimersByTime(400);
    expect(storedPosition()).toBe(19);
  });

  it('writes a fraction as often on the position interval', () => {
    const writes = countWrites((observe) => {
      let elapsed = 0;
      while (elapsed < LISTEN_MS) {
        saveAt(elapsed / 1000);
        vi.advanceTimersByTime(POSITION_SAVE_INTERVAL_MS);
        elapsed += POSITION_SAVE_INTERVAL_MS;
        observe();
      }
    });
    // Same stretch of listening, an order of magnitude fewer writes.
    expect(writes).toBe(2);
  });
});
