/**
 * Recording the moments the app stopped answering, so a freeze leaves something behind.
 *
 * A freeze has been reported repeatedly -- tracks playing, the Music tab dead to the touch -- and
 * has never once been reproduced on demand. Every attempt to catch it has been a script pasted
 * into the running WebView, which is lost the moment the app restarts, which is exactly what
 * somebody does when it freezes. So the one event worth measuring is the one event that erases
 * the instrument.
 *
 * This is the instrument built in, always on. A timer that should fire four times a second cannot
 * fire late unless the main thread was busy, and "the main thread was busy" is what frozen means
 * from the chair. The gap is the measurement; nothing else here is.
 *
 * Deliberately cheap: one timer, no observers, no allocation on the common path. It has to be
 * affordable enough to leave running forever, because a freeze that happens once a day cannot be
 * caught by something switched on for a minute.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';

/** How often the heartbeat should fire. Fast enough to resolve a stall, slow enough to be free. */
const BEAT_MS = 250;

/**
 * The gap that counts as the app having stopped.
 *
 * Well above a slow frame or a garbage collection pause, which are ordinary and not what anybody
 * would call a freeze. A second and a half is around where a tap starts feeling ignored.
 */
export const STALL_THRESHOLD_MS = 1500;

/** Small on purpose: this is a record somebody reads, not a log. */
const MAX_RECORDED = 40;
const STORAGE_KEY = 'sandbox_main_thread_stalls_v1';

export type MainThreadStall = {
  /** When it started, so a report can be lined up against what the listener was doing. */
  at: number;
  stallMs: number;
  /**
   * Whether the window was in the background.
   *
   * A hidden WebView is throttled by Android on purpose, so its long gaps are the system doing
   * its job. Recorded rather than dropped, because a stall that begins hidden and continues into
   * the foreground is the shape of "I came back to it and it was stuck".
   */
  hidden: boolean;
  /** Roughly where the app was, so a stall can be tied to a screen rather than a timestamp. */
  where: string;
};

function readStalls(): MainThreadStall[] {
  try {
    const parsed = JSON.parse(prefsGetItem(STORAGE_KEY) || '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as MainThreadStall[]) : [];
  } catch {
    return [];
  }
}

function writeStalls(rows: MainThreadStall[]): void {
  try {
    prefsSetItem(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_RECORDED)));
  } catch {
    /* A lost record is not worth failing over; the next stall records again. */
  }
}

/** Every stall recorded so far, most recent first. */
export function listMainThreadStalls(): MainThreadStall[] {
  return readStalls();
}

export function clearMainThreadStalls(): void {
  writeStalls([]);
}

/** Note a stall. Exported for the tests, which must not depend on real elapsed time. */
export function recordMainThreadStall(stall: MainThreadStall): void {
  writeStalls([stall, ...readStalls()]);
}

/**
 * Describe where the app was, in a few words.
 *
 * The station name rather than the whole screen: enough to say "it was the Music tab" without
 * copying somebody's library into a diagnostic record.
 */
function describeLocation(): string {
  if (typeof document === 'undefined') return '';
  const active = document.querySelector('[aria-current="page"], .locker-tab-active, [data-station-active="true"]');
  const label = active?.getAttribute('aria-label') || active?.textContent || '';
  const trimmed = label.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (trimmed) return trimmed;
  return (location.hash || '').slice(0, 40);
}

let started = false;

/**
 * Start watching. Safe to call more than once; only the first call does anything.
 *
 * Returns a stop function for the tests. Nothing in the app stops it: the whole point is that it
 * is running before the fault, since a freeze gives no warning that it is about to happen.
 */
export function startMainThreadStallWatch(): () => void {
  if (started || typeof window === 'undefined') return () => {};
  started = true;

  let last = performance.now();
  const timer = window.setInterval(() => {
    const now = performance.now();
    const gap = Math.round(now - last);
    last = now;
    if (gap < STALL_THRESHOLD_MS) return;
    const stall: MainThreadStall = {
      at: Date.now() - gap,
      stallMs: gap,
      hidden: document.hidden,
      where: describeLocation(),
    };
    recordMainThreadStall(stall);
    // console.warn, not log: the release WebView drops console.log under load, which is precisely
    // the condition being recorded.
    console.warn(
      `[StallWatch] main thread busy ${gap}ms at ${stall.where || 'unknown screen'}` +
        (stall.hidden ? ' (backgrounded)' : ''),
    );
  }, BEAT_MS);

  return () => {
    window.clearInterval(timer);
    started = false;
  };
}
