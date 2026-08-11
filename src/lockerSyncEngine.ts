/**
 * The sync that runs itself.
 *
 * pushFullManifestIfEnabled existed and was called from nowhere, so "background sync" was a switch
 * with nothing behind it and syncing meant pressing Export on one machine and Import on the other.
 * This is the thing that actually asks.
 *
 * A push returns the merged manifest, so one round trip is a sync in both directions: local state
 * goes up, the server merges it with everything else it has been told, and the result comes back to
 * be merged in locally. There is no separate pull to sequence against it, and no window where the
 * two disagree about which is authoritative.
 *
 * Deciding when lives in lockerSyncSchedule, which is pure. This holds the in-flight flag, does the
 * asking, and tells anyone listening what happened.
 */

import {
  buildLockerSyncManifest,
  importLockerManifest,
  isNetworkAllowedForSync,
  loadLockerSyncSettings,
  pushManifestToTier34,
  pullManifestFromTier34,
  recordLockerSyncResult,
} from './lockerSync';
import {
  decideSync,
  describeSkip,
  skipWorthReporting,
  type SyncSchedulerState,
  type SyncTrigger,
} from './lockerSyncSchedule';

export interface SyncRunResult {
  trigger: SyncTrigger;
  ran: boolean;
  /** Present when it ran and finished. */
  imported?: number;
  updated?: number;
  /** Present when it ran and threw. */
  error?: string;
  /** Present when it did not run and that is worth telling somebody about. */
  message?: string;
}

type Listener = (result: SyncRunResult) => void;

const listeners = new Set<Listener>();
let inFlight = false;
let lastAttemptAt: number | null = null;

export function subscribeLockerSyncRuns(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(result: SyncRunResult): void {
  for (const listener of listeners) {
    try {
      listener(result);
    } catch {
      // A listener that throws must not stop the others hearing, or the next sync running.
    }
  }
}

export function isLockerSyncInFlight(): boolean {
  return inFlight;
}

/** Only for tests, which need the module's own timing state reset between cases. */
export function resetLockerSyncEngineState(): void {
  inFlight = false;
  lastAttemptAt = null;
}

function currentState(): SyncSchedulerState {
  const settings = loadLockerSyncSettings();
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    backgroundSync: settings.backgroundSync,
    wifiOnly: settings.wifiOnly,
    lastSyncedAt: settings.lastSyncedAt,
    lastAttemptAt,
    inFlight,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    /*
     * isNetworkAllowedForSync already answers this, and answers it as "allowed" rather than
     * "metered", so it is inverted here rather than reimplemented. It returns true when wifiOnly is
     * off, which the scheduler handles itself, so it is only consulted when the setting is on.
     */
    metered: settings.wifiOnly ? !isNetworkAllowedForSync(settings) : false,
  };
}

/**
 * Sync if this trigger says to.
 *
 * Never throws. A background sync failing is an ordinary event — a laptop asleep, a server not
 * started yet — and it is reported through the listeners rather than raised at whichever timer
 * happened to fire.
 */
export async function runLockerSync(trigger: SyncTrigger): Promise<SyncRunResult> {
  const decision = decideSync(trigger, currentState(), Date.now());

  if (decision.action === 'skip') {
    const result: SyncRunResult = {
      trigger,
      ran: false,
      message: skipWorthReporting(trigger, decision.reason)
        ? describeSkip(decision.reason)
        : undefined,
    };
    if (result.message) announce(result);
    return result;
  }

  inFlight = true;
  lastAttemptAt = Date.now();
  try {
    const settings = loadLockerSyncSettings();
    const manifest = await buildLockerSyncManifest({ hashContents: false });

    /*
     * Hashes are skipped here for the same reason the file export skips them: reading every track's
     * bytes to fingerprint it takes minutes, and this runs unattended every few minutes. Blob
     * transfer, which is the only thing those fingerprints feed, is its own path.
     */
    const merged =
      settings.provider === 'tier34'
        ? await pushManifestToTier34(manifest)
        : await pullManifestFromTier34();

    const stats = await importLockerManifest(merged);
    recordLockerSyncResult(true);
    const result: SyncRunResult = {
      trigger,
      ran: true,
      imported: stats.imported,
      updated: stats.updated,
    };
    announce(result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordLockerSyncResult(false, message);
    const result: SyncRunResult = { trigger, ran: true, error: message };
    announce(result);
    return result;
  } finally {
    inFlight = false;
  }
}
