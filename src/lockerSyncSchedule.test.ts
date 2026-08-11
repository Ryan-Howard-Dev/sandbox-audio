import { describe, expect, it } from 'vitest';
import {
  CHANGE_DEBOUNCE_MS,
  decideSync,
  describeSkip,
  FOCUS_MIN_GAP_MS,
  INTERVAL_MS,
  RETRY_BACKOFF_MS,
  skipWorthReporting,
  type SkipReason,
  type SyncSchedulerState,
} from './lockerSyncSchedule';

const NOW = 1_000_000;

const state = (over: Partial<SyncSchedulerState> = {}): SyncSchedulerState => ({
  enabled: true,
  provider: 'tier34',
  backgroundSync: true,
  wifiOnly: true,
  lastSyncedAt: null,
  lastAttemptAt: null,
  inFlight: false,
  online: true,
  metered: false,
  ...over,
});

function reason(decision: ReturnType<typeof decideSync>): string {
  return decision.action === 'skip' ? decision.reason : 'sync';
}

describe('decideSync gates', () => {
  it('does nothing when sync is off', () => {
    expect(reason(decideSync('manual', state({ enabled: false }), NOW))).toBe('disabled');
  });

  it('does nothing when no target has been chosen', () => {
    expect(reason(decideSync('manual', state({ provider: 'none' }), NOW))).toBe('noProvider');
  });

  it('refuses to overlap two syncs, even a manual one', () => {
    // Two syncs push manifests built from the same local state, and the second undoes whatever the
    // first learned from the server.
    expect(reason(decideSync('manual', state({ inFlight: true }), NOW))).toBe('inFlight');
  });
});

describe('decideSync and manual', () => {
  it('ignores every timing rule, because somebody is standing there waiting', () => {
    const justSynced = state({ lastSyncedAt: NOW - 1, lastAttemptAt: NOW - 1 });
    expect(reason(decideSync('manual', justSynced, NOW))).toBe('sync');
  });

  it('works with background sync switched off', () => {
    expect(reason(decideSync('manual', state({ backgroundSync: false }), NOW))).toBe('sync');
  });

  it('still tries on a metered connection', () => {
    // Wi-Fi only is about unattended background traffic. Asking explicitly is not that.
    const metered = state({ wifiOnly: true, metered: true });
    expect(reason(decideSync('manual', metered, NOW))).toBe('sync');
  });
});

describe('decideSync and background triggers', () => {
  it('holds off entirely when background sync is off', () => {
    for (const trigger of ['startup', 'focus', 'interval', 'change'] as const) {
      expect(reason(decideSync(trigger, state({ backgroundSync: false }), NOW)), trigger).toBe(
        'backgroundOff',
      );
    }
  });

  it('does not try while offline', () => {
    expect(reason(decideSync('interval', state({ online: false }), NOW))).toBe('offline');
  });

  it('waits for Wi-Fi when asked to', () => {
    expect(reason(decideSync('interval', state({ wifiOnly: true, metered: true }), NOW))).toBe(
      'metered',
    );
  });

  it('syncs on a metered connection when Wi-Fi only is off', () => {
    expect(reason(decideSync('interval', state({ wifiOnly: false, metered: true }), NOW))).toBe(
      'sync',
    );
  });

  it('always syncs at startup', () => {
    expect(reason(decideSync('startup', state(), NOW))).toBe('sync');
  });
});

describe('decideSync and edits', () => {
  it('collects a burst of edits into one push', () => {
    // Renaming eight tracks in a row is eight changes and should not be eight pushes.
    const justAttempted = state({ lastAttemptAt: NOW - 1_000, lastSyncedAt: NOW - 1_000 });
    expect(reason(decideSync('change', justAttempted, NOW))).toBe('debounced');
  });

  it('pushes once the burst has settled', () => {
    const settled = state({
      lastAttemptAt: NOW - CHANGE_DEBOUNCE_MS - 1,
      lastSyncedAt: NOW - CHANGE_DEBOUNCE_MS - 1,
    });
    expect(reason(decideSync('change', settled, NOW))).toBe('sync');
  });

  it('pushes the first edit immediately when nothing has synced yet', () => {
    expect(reason(decideSync('change', state(), NOW))).toBe('sync');
  });
});

describe('decideSync and focus', () => {
  it('ignores a glance at a phone that just synced', () => {
    const recent = state({ lastSyncedAt: NOW - 1_000, lastAttemptAt: NOW - 1_000 });
    expect(reason(decideSync('focus', recent, NOW))).toBe('tooSoon');
  });

  it('syncs when returning after a while away', () => {
    const older = state({
      lastSyncedAt: NOW - FOCUS_MIN_GAP_MS - 1,
      lastAttemptAt: NOW - FOCUS_MIN_GAP_MS - 1,
    });
    expect(reason(decideSync('focus', older, NOW))).toBe('sync');
  });
});

describe('decideSync and the interval', () => {
  it('waits out the period', () => {
    const recent = state({ lastSyncedAt: NOW - 1_000, lastAttemptAt: NOW - 1_000 });
    expect(reason(decideSync('interval', recent, NOW))).toBe('tooSoon');
  });

  it('fires once the period has passed', () => {
    const due = state({ lastSyncedAt: NOW - INTERVAL_MS - 1, lastAttemptAt: NOW - INTERVAL_MS - 1 });
    expect(reason(decideSync('interval', due, NOW))).toBe('sync');
  });
});

describe('decideSync and a failing server', () => {
  it('backs off after an attempt that never completed', () => {
    /*
     * lastAttemptAt newer than lastSyncedAt is the signature of a failure. Without this the app
     * asks a refusing server on every focus and every tick.
     */
    const failed = state({ lastSyncedAt: NOW - INTERVAL_MS * 3, lastAttemptAt: NOW - 5_000 });
    expect(reason(decideSync('interval', failed, NOW))).toBe('debounced');
  });

  it('tries again once the backoff has passed', () => {
    const failedLongAgo = state({
      lastSyncedAt: NOW - INTERVAL_MS * 3,
      lastAttemptAt: NOW - RETRY_BACKOFF_MS - 1,
    });
    expect(reason(decideSync('interval', failedLongAgo, NOW))).toBe('sync');
  });

  it('does not back off a successful sync, whose attempt and success are the same moment', () => {
    const succeeded = state({
      lastSyncedAt: NOW - INTERVAL_MS - 1,
      lastAttemptAt: NOW - INTERVAL_MS - 1,
    });
    expect(reason(decideSync('interval', succeeded, NOW))).toBe('sync');
  });

  it('lets a manual retry through immediately after a failure', () => {
    const failed = state({ lastSyncedAt: null, lastAttemptAt: NOW - 100 });
    expect(reason(decideSync('manual', failed, NOW))).toBe('sync');
  });
});

describe('reporting', () => {
  it('gives every reason its own sentence', () => {
    const reasons: SkipReason[] = [
      'disabled',
      'noProvider',
      'backgroundOff',
      'offline',
      'metered',
      'inFlight',
      'debounced',
      'tooSoon',
    ];
    const messages = reasons.map(describeSkip);
    expect(new Set(messages).size).toBe(reasons.length);
    expect(messages.every((m) => m.length > 0)).toBe(true);
  });

  it('stays quiet about background skips, which happen constantly by design', () => {
    expect(skipWorthReporting('focus', 'tooSoon')).toBe(false);
    expect(skipWorthReporting('interval', 'metered')).toBe(false);
  });

  it('speaks up when a person pressed the button and nothing happened', () => {
    expect(skipWorthReporting('manual', 'offline')).toBe(true);
    expect(skipWorthReporting('manual', 'noProvider')).toBe(true);
  });

  it('stays quiet about a manual press that was merely early', () => {
    expect(skipWorthReporting('manual', 'tooSoon')).toBe(false);
  });
});
