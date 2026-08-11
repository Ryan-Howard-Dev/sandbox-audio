/**
 * When to sync, decided apart from how.
 *
 * The setting has said "pull on focus and on an interval" since it was written and nothing has ever
 * implemented it, so syncing has been a button somebody has to remember to press on both machines.
 * This is the half that decides; the hook that listens to focus, timers and edits does the asking.
 *
 * Pure so the awkward cases can be tested without a network or a clock: a phone on cellular with
 * wifi-only set, an edit made three seconds after the last one, a focus event fired twice because
 * the app was alt-tabbed. Each of those has a right answer and none of them are observable from a
 * running app without waiting.
 */

export type SyncTrigger =
  /** The app just opened. */
  | 'startup'
  /** Came back to the foreground, or the window regained focus. */
  | 'focus'
  /** The periodic timer fired. */
  | 'interval'
  /** Something local changed — a track edited, a copy scanned, a playlist saved. */
  | 'change'
  /** Somebody pressed Sync now. */
  | 'manual';

export type SkipReason =
  | 'disabled'
  | 'noProvider'
  | 'backgroundOff'
  | 'offline'
  | 'metered'
  | 'inFlight'
  | 'debounced'
  | 'tooSoon';

export type SyncDecision = { action: 'sync' } | { action: 'skip'; reason: SkipReason };

export interface SyncSchedulerState {
  enabled: boolean;
  provider: string;
  backgroundSync: boolean;
  wifiOnly: boolean;
  /** When a sync last completed, either way. Null when none ever has. */
  lastSyncedAt: number | null;
  /** When one was last started, successful or not. Stops a failing server being hammered. */
  lastAttemptAt: number | null;
  /** True while one is running. */
  inFlight: boolean;
  online: boolean;
  /** The connection is cellular or otherwise paid for. */
  metered: boolean;
}

/**
 * How long after a local edit to wait before pushing.
 *
 * Renaming eight tracks in a row is eight changes and should be one push. Long enough to collect a
 * burst of edits, short enough that walking to the other machine and looking is not a race.
 */
export const CHANGE_DEBOUNCE_MS = 4_000;

/** The periodic pull. Frequent enough to feel automatic, rare enough to ignore on a battery. */
export const INTERVAL_MS = 5 * 60_000;

/**
 * The shortest gap between two syncs from returning to the app.
 *
 * Focus fires far more often than anybody changes anything — every alt-tab, every notification
 * dismissed. Without a floor, a phone put down and picked up repeatedly syncs on every glance.
 */
export const FOCUS_MIN_GAP_MS = 30_000;

/** After a failure, how long before trying again on a background trigger. */
export const RETRY_BACKOFF_MS = 60_000;

export function decideSync(
  trigger: SyncTrigger,
  state: SyncSchedulerState,
  now: number,
): SyncDecision {
  if (!state.enabled) return { action: 'skip', reason: 'disabled' };
  if (!state.provider || state.provider === 'none') {
    return { action: 'skip', reason: 'noProvider' };
  }
  /*
   * In-flight beats everything, manual included. Two overlapping syncs push two manifests built
   * from the same local state, and the second undoes whatever the first learned from the server.
   */
  if (state.inFlight) return { action: 'skip', reason: 'inFlight' };

  /*
   * Manual is a person waiting for something to happen. It ignores every timing rule below,
   * because "nothing happened, and it will not tell me why" is the whole complaint about a sync
   * button that quietly decided it was too soon.
   */
  if (trigger === 'manual') return { action: 'sync' };

  if (!state.backgroundSync) return { action: 'skip', reason: 'backgroundOff' };
  if (!state.online) return { action: 'skip', reason: 'offline' };
  if (state.wifiOnly && state.metered) return { action: 'skip', reason: 'metered' };

  const sinceAttempt = state.lastAttemptAt == null ? Infinity : now - state.lastAttemptAt;
  const sinceSynced = state.lastSyncedAt == null ? Infinity : now - state.lastSyncedAt;

  /*
   * A server that is refusing must not be asked on every focus and every timer tick. Measured from
   * the last attempt rather than the last success, so a run of failures backs off instead of
   * retrying as fast as the triggers arrive.
   */
  if (sinceSynced > sinceAttempt && sinceAttempt < RETRY_BACKOFF_MS) {
    return { action: 'skip', reason: 'debounced' };
  }

  switch (trigger) {
    case 'startup':
      return { action: 'sync' };
    case 'change':
      return sinceAttempt < CHANGE_DEBOUNCE_MS
        ? { action: 'skip', reason: 'debounced' }
        : { action: 'sync' };
    case 'focus':
      return sinceSynced < FOCUS_MIN_GAP_MS
        ? { action: 'skip', reason: 'tooSoon' }
        : { action: 'sync' };
    case 'interval':
      return sinceSynced < INTERVAL_MS
        ? { action: 'skip', reason: 'tooSoon' }
        : { action: 'sync' };
  }
}

/**
 * What to tell somebody looking at the sync row.
 *
 * Every skip reason gets its own sentence. "Not syncing" covers all of them and answers none: turn
 * a setting on, join wifi, or wait are three different things to do, and a shared message leaves a
 * person to guess which.
 */
export function describeSkip(reason: SkipReason): string {
  switch (reason) {
    case 'disabled':
      return 'Sync is off';
    case 'noProvider':
      return 'No sync target chosen';
    case 'backgroundOff':
      return 'Background sync is off — use Sync now';
    case 'offline':
      return 'No connection';
    case 'metered':
      return 'Waiting for Wi-Fi';
    case 'inFlight':
      return 'Already syncing';
    case 'debounced':
      return 'Just tried — waiting a moment';
    case 'tooSoon':
      return 'Synced recently';
  }
}

/** True when a decision means a person should be told rather than left looking at a dead button. */
export function skipWorthReporting(trigger: SyncTrigger, reason: SkipReason): boolean {
  // Background triggers skip constantly and by design; saying so every time is noise.
  if (trigger !== 'manual') return false;
  return reason !== 'tooSoon' && reason !== 'debounced';
}
