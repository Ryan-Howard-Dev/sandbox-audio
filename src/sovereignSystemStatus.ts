/**
 * Unified live status for Sovereign self-hosted services (Settings → Sovereign System Status).
 */

import { loadLockerSyncSettings, type LockerSyncSettings } from './lockerSync';
import { loadNetworkSyncEnabled } from './sandboxSettings';
import {
  getTier34BaseUrl,
  tier34GetDlnaSettings,
  type Tier34DlnaSettings,
} from './tier34/client';

export const SOVEREIGN_STATUS_POLL_INTERVAL_MS = 20_000;

export type SovereignServiceState = 'online' | 'offline' | 'disabled' | 'error';

export type SovereignServiceId =
  | 'tier34'
  | 'meilisearch'
  | 'ytdlp'
  | 'dlna'
  | 'connect'
  | 'lockerSync';

export type SovereignServiceStatus = {
  id: SovereignServiceId;
  label: string;
  state: SovereignServiceState;
  checkedAt: number;
  failureReason?: string;
};

export type SovereignSystemSnapshot = {
  checkedAt: number;
  services: Record<SovereignServiceId, SovereignServiceStatus>;
};

export type SovereignStatusContext = {
  backendUrl?: string;
  networkSyncEnabled?: boolean;
  dlnaSettings?: Tier34DlnaSettings | null;
  lockerSyncSettings?: LockerSyncSettings;
};

type Tier34HealthPayload = {
  ok?: boolean;
  meilisearch?: boolean;
  ytdlp?: boolean;
};

const SERVICE_LABELS: Record<SovereignServiceId, string> = {
  tier34: 'SANDBOX SERVER',
  meilisearch: 'LOCKER SEARCH',
  ytdlp: 'DOWNLOAD HELPER',
  dlna: 'NETWORK SPEAKERS',
  connect: 'MULTI-DEVICE PLAYBACK',
  lockerSync: 'LOCKER SYNC',
};

function makeStatus(
  id: SovereignServiceId,
  state: SovereignServiceState,
  checkedAt: number,
  failureReason?: string,
): SovereignServiceStatus {
  return {
    id,
    label: SERVICE_LABELS[id],
    state,
    checkedAt,
    failureReason: failureReason?.trim() || undefined,
  };
}

async function fetchTier34Health(
  baseUrl: string,
): Promise<
  | { kind: 'ok'; data: Tier34HealthPayload }
  | { kind: 'unreachable'; error: string }
  | { kind: 'http_error'; error: string }
  | { kind: 'unhealthy'; error: string }
> {
  const base = baseUrl.trim().replace(/\/$/, '');
  if (!base) {
    return { kind: 'unreachable', error: 'No Sandbox Server URL configured — set Settings → Vault → Sandbox Server' };
  }
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${base}/health`, { signal: ctrl.signal });
    if (!res.ok) {
      return { kind: 'http_error', error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as Tier34HealthPayload;
    if (!data.ok) {
      return { kind: 'unhealthy', error: 'Health endpoint returned ok: false' };
    }
    return { kind: 'ok', data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: 'unreachable',
      error: msg.includes('abort') ? 'Request timed out' : msg,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchDlnaRuntimeStatus(
  baseUrl: string,
): Promise<{ ok: boolean; enabled: boolean; error?: string }> {
  const base = baseUrl.trim().replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 6_000);
  try {
    const res = await fetch(`${base}/dlna/status`, { signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, enabled: false, error: `Network speaker status HTTP ${res.status}` };
    }
    const data = (await res.json()) as { enabled?: boolean };
    return { ok: true, enabled: Boolean(data.enabled) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      enabled: false,
      error: msg.includes('abort') ? 'Network speaker status timed out' : msg,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

async function probePeerSyncWs(baseUrl: string): Promise<{ ok: boolean; detail?: string }> {
  const base = baseUrl.trim().replace(/\/$/, '');
  if (!base) return { ok: false, detail: 'No Sandbox Server URL configured' };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean, detail?: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve({ ok, detail });
    };

    const timer = window.setTimeout(() => {
      finish(false, 'Multi-device sync did not respond in time');
    }, 5_000);

    try {
      const wsBase = base.replace(/^http/, 'ws');
      const ws = new WebSocket(
        `${wsBase}/peer-sync?room=${encodeURIComponent('sovereign-status-probe')}`,
      );
      ws.onopen = () => {
        ws.close();
        finish(true);
      };
      ws.onerror = () => {
        finish(false, 'Multi-device sync unreachable — check firewall rules');
      };
    } catch {
      finish(false, 'Could not open multi-device sync from this browser');
    }
  });
}

function resolveLockerSyncStatus(
  settings: LockerSyncSettings,
  tier34Reachable: boolean,
  checkedAt: number,
): SovereignServiceStatus {
  if (!settings.enabled || settings.provider === 'none') {
    return makeStatus('lockerSync', 'disabled', checkedAt, 'Locker sync disabled in settings');
  }

  if (settings.provider === 'webdav' && !settings.remoteBaseUrl.trim()) {
    return makeStatus('lockerSync', 'offline', checkedAt, 'No cloud folder URL configured');
  }

  if (settings.provider === 'tier34' && !tier34Reachable) {
    return makeStatus('lockerSync', 'offline', checkedAt, 'Sandbox Server unreachable — required for music file sync');
  }

  if (settings.lastSyncOk === false) {
    return makeStatus(
      'lockerSync',
      'error',
      checkedAt,
      settings.lastSyncError ?? 'Last sync operation failed',
    );
  }

  if (settings.lastSyncOk === true || settings.lastSyncedAt) {
    return makeStatus('lockerSync', 'online', checkedAt);
  }

  return makeStatus('lockerSync', 'offline', checkedAt, 'No successful sync performed yet');
}

function resolveDlnaStatus(
  dlnaSettings: Tier34DlnaSettings | null | undefined,
  tier34Reachable: boolean,
  runtimeEnabled: boolean | null,
  runtimeError: string | undefined,
  checkedAt: number,
): SovereignServiceStatus {
  if (!dlnaSettings?.enabled) {
    return makeStatus('dlna', 'disabled', checkedAt, 'Network speaker sharing disabled');
  }

  if (!tier34Reachable) {
    return makeStatus('dlna', 'offline', checkedAt, 'Sandbox Server unreachable — required for network speakers');
  }

  if (runtimeEnabled === false) {
    return makeStatus(
      'dlna',
      'error',
      checkedAt,
      runtimeError ?? 'Network speakers enabled in settings but server reports disabled',
    );
  }

  if (runtimeError) {
    return makeStatus('dlna', 'error', checkedAt, runtimeError);
  }

  return makeStatus('dlna', 'online', checkedAt);
}

function resolveConnectStatus(
  networkSyncEnabled: boolean,
  tier34Reachable: boolean,
  wsOk: boolean,
  wsDetail: string | undefined,
  checkedAt: number,
): SovereignServiceStatus {
  if (!networkSyncEnabled) {
    return makeStatus('connect', 'disabled', checkedAt, 'Multi-device playback disabled in settings');
  }

  if (!tier34Reachable) {
    return makeStatus('connect', 'offline', checkedAt, 'Sandbox Server unreachable — multi-device playback needs the server relay');
  }

  if (!wsOk) {
    return makeStatus('connect', 'error', checkedAt, wsDetail ?? 'Multi-device sync relay unreachable');
  }

  return makeStatus('connect', 'online', checkedAt);
}

/** Poll all Sovereign services and return a unified snapshot. */
export async function checkSovereignSystemStatus(
  ctx: SovereignStatusContext = {},
): Promise<SovereignSystemSnapshot> {
  const checkedAt = Date.now();
  const backendUrl = (ctx.backendUrl ?? getTier34BaseUrl()).trim();
  const networkSyncEnabled = ctx.networkSyncEnabled ?? loadNetworkSyncEnabled();
  const lockerSettings = ctx.lockerSyncSettings ?? loadLockerSyncSettings();

  const health = await fetchTier34Health(backendUrl);
  const tier34Reachable = health.kind === 'ok';

  let tier34: SovereignServiceStatus;
  if (!backendUrl) {
    tier34 = makeStatus('tier34', 'offline', checkedAt, 'No Sandbox Server URL configured — set Settings → Vault → Sandbox Server');
  } else if (health.kind === 'unreachable') {
    tier34 = makeStatus('tier34', 'offline', checkedAt, health.error);
  } else if (health.kind === 'http_error' || health.kind === 'unhealthy') {
    tier34 = makeStatus('tier34', 'error', checkedAt, health.error);
  } else {
    tier34 = makeStatus('tier34', 'online', checkedAt);
  }

  let meilisearch: SovereignServiceStatus;
  if (!tier34Reachable) {
    meilisearch = makeStatus('meilisearch', 'offline', checkedAt, 'Sandbox Server unreachable');
  } else if (health.data.meilisearch === true) {
    meilisearch = makeStatus('meilisearch', 'online', checkedAt);
  } else if (health.data.meilisearch === false) {
    meilisearch = makeStatus(
      'meilisearch',
      'error',
      checkedAt,
      'Locker search offline on Sandbox Server host',
    );
  } else {
    meilisearch = makeStatus('meilisearch', 'offline', checkedAt, 'Locker search status unknown');
  }

  let ytdlp: SovereignServiceStatus;
  if (!tier34Reachable) {
    ytdlp = makeStatus('ytdlp', 'offline', checkedAt, 'Sandbox Server unreachable');
  } else if (health.data.ytdlp === true) {
    ytdlp = makeStatus('ytdlp', 'online', checkedAt);
  } else if (health.data.ytdlp === false) {
    ytdlp = makeStatus('ytdlp', 'error', checkedAt, 'Download helper not available on Sandbox Server host');
  } else {
    ytdlp = makeStatus('ytdlp', 'offline', checkedAt, 'Download helper status unknown');
  }

  let dlnaSettings = ctx.dlnaSettings;
  if (dlnaSettings === undefined && tier34Reachable) {
    dlnaSettings = await tier34GetDlnaSettings();
  }

  let dlnaRuntimeEnabled: boolean | null = null;
  let dlnaRuntimeError: string | undefined;
  if (tier34Reachable && dlnaSettings?.enabled) {
    const runtime = await fetchDlnaRuntimeStatus(backendUrl);
    dlnaRuntimeEnabled = runtime.enabled;
    if (!runtime.ok) dlnaRuntimeError = runtime.error;
  }

  const dlna = resolveDlnaStatus(
    dlnaSettings,
    tier34Reachable,
    dlnaRuntimeEnabled,
    dlnaRuntimeError,
    checkedAt,
  );

  const wsProbe = networkSyncEnabled && tier34Reachable
    ? await probePeerSyncWs(backendUrl)
    : { ok: false, detail: undefined as string | undefined };

  const connect = resolveConnectStatus(
    networkSyncEnabled,
    tier34Reachable,
    wsProbe.ok,
    wsProbe.detail,
    checkedAt,
  );

  const lockerSync = resolveLockerSyncStatus(lockerSettings, tier34Reachable, checkedAt);

  return {
    checkedAt,
    services: { tier34, meilisearch, ytdlp, dlna, connect, lockerSync },
  };
}

export function sovereignStatusBadgeClass(state: SovereignServiceState): string {
  if (state === 'online') return 'border-accent/50 text-accent bg-accent/10';
  if (state === 'disabled') return 'border-[var(--border)] text-[var(--text-dim)] bg-[var(--bg)]';
  if (state === 'error') return 'border-[var(--danger)]/50 text-[var(--danger)] bg-[var(--danger)]/8';
  return 'border-[var(--danger)]/40 text-[var(--danger)] bg-[var(--danger)]/5';
}

export function formatSovereignStateLabel(state: SovereignServiceState): string {
  return state.toUpperCase();
}

export function formatSovereignCheckedAt(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}

/** Start polling while Settings is mounted; returns cleanup. */
export function startSovereignStatusPolling(
  onUpdate: (snapshot: SovereignSystemSnapshot) => void,
  ctxFactory: () => SovereignStatusContext = () => ({}),
  intervalMs = SOVEREIGN_STATUS_POLL_INTERVAL_MS,
): () => void {
  let cancelled = false;

  const run = () => {
    void checkSovereignSystemStatus(ctxFactory()).then((snapshot) => {
      if (!cancelled) onUpdate(snapshot);
    });
  };

  run();
  const id = window.setInterval(run, intervalMs);
  return () => {
    cancelled = true;
    window.clearInterval(id);
  };
}
