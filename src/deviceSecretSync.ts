/**
 * Cross-device API key sync via tier34 Sandbox Server.
 * Keys live on the user's self-hosted host — LAN/WAN trust model.
 */

import { isAirGapEnabled } from './airGapMode';
import { getPlatformDiagnostics } from './platformEnv';
import { detectTVPlatform } from './tvDetection';
import { DEFAULT_PROWLARR_URL } from './playbackEngineSettings';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import {
  LASTFM_API_KEY,
  LASTFM_SESSION_KEY,
  LASTFM_USERNAME_KEY,
  LISTENBRAINZ_TOKEN_KEY,
  SCROBBLE_LASTFM_ENABLED_KEY,
  SCROBBLE_LISTENBRAINZ_ENABLED_KEY,
} from './scrobbleSettings';
import {
  PROWLARR_API_KEY_KEY,
  PROWLARR_URL_KEY,
  REALDEBRID_API_KEY_KEY,
  DISCOGS_API_TOKEN_KEY,
  loadSecret,
  saveSecret,
  secretStorage,
} from './securitySettings';
import { loadSandboxServerMode } from './sandboxSettings';
import {
  getOAuthToken,
  getSandboxClientHeader,
  getTier34BaseUrl,
  OAUTH_TOKEN_KEY,
} from './tier34/client';

export const DEVICE_SYNC_ENABLED_KEY = 'sandbox_device_secret_sync_enabled';
export const DEVICE_SECRET_META_KEY = 'sandbox_device_secret_meta_v1';
export const ADDON_SECRETS_KEY = 'sandbox_addon_secrets_v1';

export type DeviceSecretEntry = {
  value: string;
  updatedAt: number;
};

export type SecretMeta = {
  updatedAt: number;
  localOnly?: boolean;
};

export type SecretMetaStore = Record<string, SecretMeta>;

/** Keys synced across devices (not fingerprints, locker blobs, or connect device ids). */
export const SYNCABLE_SECRET_KEYS = [
  PROWLARR_URL_KEY,
  PROWLARR_API_KEY_KEY,
  REALDEBRID_API_KEY_KEY,
  DISCOGS_API_TOKEN_KEY,
  LASTFM_API_KEY,
  LASTFM_SESSION_KEY,
  LASTFM_USERNAME_KEY,
  LISTENBRAINZ_TOKEN_KEY,
  SCROBBLE_LASTFM_ENABLED_KEY,
  SCROBBLE_LISTENBRAINZ_ENABLED_KEY,
  OAUTH_TOKEN_KEY,
  ADDON_SECRETS_KEY,
] as const;

export type SyncableSecretKey = (typeof SYNCABLE_SECRET_KEYS)[number];

let applyingRemote = false;
let pushTimer: number | null = null;
let pullTimer: number | null = null;

/** Android TV, Shield, Fire TV, and other leanback / 10-foot shells. */
export function isLeanbackTvShell(): boolean {
  if (typeof window === 'undefined') return false;
  return getPlatformDiagnostics().isAndroidTv || detectTVPlatform();
}

function defaultDeviceSyncEnabled(): boolean {
  const mode = loadSandboxServerMode();
  if (mode === 'remote' || mode === 'anchor') return true;
  const url = getTier34BaseUrl().trim();
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
  } catch {
    return false;
  }
}

export function loadDeviceSyncEnabled(): boolean {
  const raw = prefsGetItem(DEVICE_SYNC_ENABLED_KEY);
  if (raw === null) return defaultDeviceSyncEnabled();
  return raw === 'true';
}

export function saveDeviceSyncEnabled(enabled: boolean): void {
  prefsSetItem(DEVICE_SYNC_ENABLED_KEY, enabled ? 'true' : 'false');
  window.dispatchEvent(new Event('sandbox-settings-change'));
  if (enabled) void pullDeviceSecretsFromServer();
}

export function loadSecretMeta(): SecretMetaStore {
  try {
    const raw = localStorage.getItem(DEVICE_SECRET_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SecretMetaStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSecretMeta(meta: SecretMetaStore): void {
  localStorage.setItem(DEVICE_SECRET_META_KEY, JSON.stringify(meta));
}

export function touchSecretMeta(key: string): void {
  const meta = loadSecretMeta();
  meta[key] = { ...meta[key], updatedAt: Date.now(), localOnly: meta[key]?.localOnly };
  saveSecretMeta(meta);
}

/** Pure merge: apply remote when local empty, remote newer, and not localOnly. */
export function shouldApplyRemoteSecret(
  localMeta: SecretMeta | undefined,
  localValue: string,
  remote: DeviceSecretEntry,
): boolean {
  if (localMeta?.localOnly) return false;
  if (!localValue.trim()) return true;
  const localAt = localMeta?.updatedAt ?? 0;
  return remote.updatedAt > localAt;
}

export function mergeRemoteSecretDecisions(
  remote: Record<string, DeviceSecretEntry>,
  localValues: Record<string, string>,
  localMeta: SecretMetaStore,
): Record<string, string> {
  const toApply: Record<string, string> = {};
  for (const [key, entry] of Object.entries(remote)) {
    if (
      (SYNCABLE_SECRET_KEYS as readonly string[]).includes(key) &&
      shouldApplyRemoteSecret(localMeta[key], localValues[key] ?? '', entry)
    ) {
      toApply[key] = entry.value;
    }
  }
  return toApply;
}

function readLocalValue(key: string): string {
  if (key === PROWLARR_URL_KEY) {
    return localStorage.getItem(PROWLARR_URL_KEY)?.trim() ?? DEFAULT_PROWLARR_URL;
  }
  if (key === OAUTH_TOKEN_KEY) return getOAuthToken();
  if (key === ADDON_SECRETS_KEY) return serializeAddonSecrets();
  if (key === SCROBBLE_LASTFM_ENABLED_KEY || key === SCROBBLE_LISTENBRAINZ_ENABLED_KEY) {
    return secretStorage().getItem(key) ?? 'false';
  }
  return loadSecret(key, '');
}

function serializeAddonSecrets(): string {
  try {
    const raw = localStorage.getItem('sandbox_installed_addons');
    if (!raw) return '{}';
    const parsed = JSON.parse(raw) as Array<{ id?: string; config?: Record<string, string> }>;
    if (!Array.isArray(parsed)) return '{}';
    const payload: Record<string, Record<string, string>> = {};
    for (const addon of parsed) {
      if (!addon.config || !addon.id) continue;
      if (addon.id === 'builtin-soundcloud' || addon.id === 'builtin-audius') {
        payload[addon.id] = { ...addon.config };
      }
    }
    return JSON.stringify(payload);
  } catch {
    return '{}';
  }
}

function applyAddonSecrets(raw: string): void {
  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
    if (!parsed || typeof parsed !== 'object') return;
    const listRaw = localStorage.getItem('sandbox_installed_addons');
    if (!listRaw) return;
    const list = JSON.parse(listRaw) as Array<{ id?: string; config?: Record<string, string> }>;
    if (!Array.isArray(list)) return;
    const next = list.map((addon) => {
      const patch = addon.id ? parsed[addon.id] : undefined;
      if (!patch) return addon;
      return { ...addon, config: { ...addon.config, ...patch } };
    });
    localStorage.setItem('sandbox_installed_addons', JSON.stringify(next));
  } catch {
    /* ignore malformed */
  }
}

function applyLocalSecrets(patch: Record<string, string>, remoteMeta: Record<string, DeviceSecretEntry>): void {
  applyingRemote = true;
  try {
    const meta = loadSecretMeta();
    const store = secretStorage();
    for (const [key, value] of Object.entries(patch)) {
      if (key === PROWLARR_URL_KEY) {
        localStorage.setItem(PROWLARR_URL_KEY, value);
      } else if (key === OAUTH_TOKEN_KEY) {
        localStorage.setItem(OAUTH_TOKEN_KEY, value);
      } else if (key === ADDON_SECRETS_KEY) {
        applyAddonSecrets(value);
      } else if (key === SCROBBLE_LASTFM_ENABLED_KEY || key === SCROBBLE_LISTENBRAINZ_ENABLED_KEY) {
        store.setItem(key, value);
      } else {
        saveSecret(key, value);
      }
      meta[key] = {
        updatedAt: remoteMeta[key]?.updatedAt ?? Date.now(),
        localOnly: meta[key]?.localOnly,
      };
    }
    saveSecretMeta(meta);
    window.dispatchEvent(new Event('sandbox-settings-change'));
  } finally {
    applyingRemote = false;
  }
}

export function collectLocalSecretsForPush(): Record<string, DeviceSecretEntry> {
  const meta = loadSecretMeta();
  const now = Date.now();
  const out: Record<string, DeviceSecretEntry> = {};
  for (const key of SYNCABLE_SECRET_KEYS) {
    const value = readLocalValue(key);
    if (!value.trim() && key !== PROWLARR_URL_KEY) continue;
    out[key] = {
      value,
      updatedAt: meta[key]?.updatedAt ?? now,
    };
  }
  return out;
}

function deviceSyncHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getSandboxClientHeader(),
  };
  const token = getOAuthToken();
  if (token) headers['X-Sandbox-Token'] = token;
  return headers;
}

export async function pullDeviceSecretsFromServer(): Promise<{ ok: boolean; applied: number }> {
  if (!loadDeviceSyncEnabled()) return { ok: false, applied: 0 };
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) return { ok: false, applied: 0 };

  try {
    const res = await fetch(`${base}/api/device/secrets`, {
      headers: deviceSyncHeaders(),
    });
    if (!res.ok) return { ok: false, applied: 0 };
    const data = (await res.json()) as {
      secrets?: Record<string, DeviceSecretEntry>;
    };
    const remote = data.secrets ?? {};
    const localValues: Record<string, string> = {};
    for (const key of SYNCABLE_SECRET_KEYS) {
      localValues[key] = readLocalValue(key);
    }
    const patch = mergeRemoteSecretDecisions(remote, localValues, loadSecretMeta());
    if (Object.keys(patch).length > 0) {
      applyLocalSecrets(patch, remote);
    }
    return { ok: true, applied: Object.keys(patch).length };
  } catch {
    return { ok: false, applied: 0 };
  }
}

export async function pushDeviceSecretsToServer(
  keys?: SyncableSecretKey[],
): Promise<boolean> {
  if (!loadDeviceSyncEnabled() || applyingRemote) return false;
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) return false;

  const all = collectLocalSecretsForPush();
  const payload: Record<string, DeviceSecretEntry> = {};
  if (keys?.length) {
    for (const key of keys) {
      if (all[key]) payload[key] = all[key];
    }
  } else {
    Object.assign(payload, all);
  }
  if (Object.keys(payload).length === 0) return false;

  try {
    const res = await fetch(`${base}/api/device/secrets`, {
      method: 'PUT',
      headers: deviceSyncHeaders(),
      body: JSON.stringify({ secrets: payload }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function notifyDeviceSecretChanged(key?: SyncableSecretKey): void {
  if (applyingRemote || !loadDeviceSyncEnabled()) return;
  if (key) touchSecretMeta(key);
  else {
    const now = Date.now();
    const meta = loadSecretMeta();
    for (const k of SYNCABLE_SECRET_KEYS) {
      meta[k] = { ...meta[k], updatedAt: now, localOnly: meta[k]?.localOnly };
    }
    saveSecretMeta(meta);
  }
  scheduleDeviceSecretPush();
}

export function scheduleDeviceSecretPush(): void {
  if (applyingRemote || !loadDeviceSyncEnabled()) return;
  if (pushTimer) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void pushDeviceSecretsToServer();
  }, 800);
}

export function scheduleDeviceSecretPull(): void {
  if (!loadDeviceSyncEnabled()) return;
  if (pullTimer) window.clearTimeout(pullTimer);
  pullTimer = window.setTimeout(() => {
    pullTimer = null;
    void pullDeviceSecretsFromServer();
  }, 1200);
}

/** Startup — pull when sync enabled and server reachable (all shells incl. TV). */
export async function initDeviceSecretSync(): Promise<void> {
  if (!loadDeviceSyncEnabled()) return;
  if (isAirGapEnabled() && !getTier34BaseUrl().trim()) return;
  await pullDeviceSecretsFromServer();
}

/** TV / leanback mount — re-pull after platform detection when tier34 URL is configured. */
export async function initDeviceSecretSyncForTvShell(): Promise<void> {
  if (!isLeanbackTvShell()) return;
  if (!getTier34BaseUrl().trim()) return;
  await initDeviceSecretSync();
}
