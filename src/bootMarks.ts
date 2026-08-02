/**
 * Timestamps for the parts of startup no platform tool can see.
 *
 * `adb shell am start -W` measures how long Android took to put the activity on screen — about
 * 600ms here — and the WebView's own Navigation Timing measures up to first paint, around 650ms
 * after that. Neither covers the interval that actually makes an app feel slow to open: the stretch
 * between painting something and being usable, while the shell chunk evaluates and the locker
 * hydrates out of IndexedDB.
 *
 * That stretch was invisible. scripts/measure-startup.mjs would report "app marks: none", because
 * nothing anywhere called performance.mark, so the only honest thing to say about it was that
 * nobody knew.
 *
 * Cheap enough to leave on in release builds: a mark is a timestamp and a string, and a diagnostic
 * that only exists in debug tells you about a build nobody ships.
 */

/** The points worth knowing about, in the order they happen. */
export type BootMark =
  /** main.tsx started evaluating. Everything before this is the WebView and the bundle. */
  | 'boot:module'
  /** React has been handed the tree. Not the same as painted, and not the same as usable. */
  | 'boot:render'
  /** The shell reports itself interactive — the first moment a tap would do something. */
  | 'boot:interactive'
  /** Deferred warm-up finished: caches, addons, taste profile, server reachability. */
  | 'boot:settled';

export function markBoot(name: BootMark): void {
  try {
    performance.mark(name);
  } catch {
    // Some WebViews restrict the User Timing API. A missing mark is a missing diagnostic, never a
    // reason for the app not to start.
  }
}

/**
 * Every boot mark so far, in milliseconds from navigation start.
 *
 * Returned rather than logged so a caller can put it on a diagnostics screen as easily as in the
 * console.
 */
export function bootTimeline(): Array<{ name: string; atMs: number }> {
  try {
    return performance
      .getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith('boot:'))
      .map((entry) => ({ name: entry.name, atMs: Math.round(entry.startTime) }))
      .sort((a, b) => a.atMs - b.atMs);
  } catch {
    return [];
  }
}
