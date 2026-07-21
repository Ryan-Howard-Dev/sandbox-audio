/**
 * Mobile resolver addon registry — pluggable on-device stream resolution (e.g. yt-dlp).
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { isCatalogPreviewUrl } from './displaySanitize';
import { Capacitor } from '@capacitor/core';
import { getCachedStream, putCachedStream, removeCachedStream } from './streamCache';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import { isOfflineUnplayableStreamUrl, localDevicePlayUrlReachable, pickMobileExoPlayUrlAsync } from './nativeExoStreamResolver';
import { getTier34BaseUrl, isServerReachableCached } from './tier34/client';
import {
  getLastYtDlpMobileError,
  isYtDlpMobileNativeAvailable,
  resolveViaYtDlpMobile,
} from './ytDlpMobile';

export type MobileResolveHit = {
  uri: string;
  watchUrl?: string;
  bitrate: number;
  format: string;
};

export interface MobileResolverAddon {
  id: string;
  name: string;
  enabled: boolean;
  manifestUrl?: string;
  version?: string;
  resolve(query: string): Promise<MobileResolveHit | null>;
}

export type UserMobileResolverManifest = {
  id: string;
  name: string;
  manifestUrl: string;
  version: string;
};

export const MOBILE_RESOLVER_INTERFACE_SPEC = `interface MobileResolverAddon {
  id: string;
  name: string;
  resolve(query: string): Promise<{
    uri: string;
    bitrate: number;
    format: string;
  } | null>;
}

// Manifest JSON (HTTPS):
{
  "name": "My Resolver",
  "version": "1.0.0",
  "resolve": {
    "endpoint": "https://example.com/resolve",
    "method": "POST"
  }
}

// Endpoint POST body: { "query": "Artist Title" }
// Response: { "uri": "https://...", "bitrate": 128, "format": "m4a" }`;

const ENABLED_KEY = 'sandbox_mobile_resolver_enabled_v1';
const REMOVED_KEY = 'sandbox_mobile_resolver_removed_v1';
const MANIFESTS_KEY = 'sandbox_mobile_resolver_manifests_v1';

const registry = new Map<string, MobileResolverAddon>();

const YTDLP_MOBILE_ID = 'yt-dlp-mobile';

function buildYtDlpMobileResolver(): MobileResolverAddon {
  const present = isYtDlpMobileNativeAvailable();
  return {
    id: YTDLP_MOBILE_ID,
    name: 'yt-dlp (mobile)',
    enabled: present,
    version: present ? 'builtin' : undefined,
    resolve: present
      ? async (query) => resolveViaYtDlpMobile(query)
      : async () => null,
  };
}

function readEnabledIds(): Record<string, boolean> {
  try {
    const raw = prefsGetItem(ENABLED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeEnabledIds(map: Record<string, boolean>): void {
  prefsSetItem(ENABLED_KEY, JSON.stringify(map));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sandbox-settings-change'));
  }
}

function readRemovedIds(): Set<string> {
  try {
    const raw = prefsGetItem(REMOVED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeRemovedIds(ids: Set<string>): void {
  prefsSetItem(REMOVED_KEY, JSON.stringify([...ids]));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sandbox-settings-change'));
  }
}

function applyPersistedState(addon: MobileResolverAddon): MobileResolverAddon {
  const removed = readRemovedIds();
  if (removed.has(addon.id)) return { ...addon, enabled: false };
  const enabledMap = readEnabledIds();
  if (addon.id in enabledMap) {
    return { ...addon, enabled: Boolean(enabledMap[addon.id]) };
  }
  return addon;
}

function seedBuiltinResolvers(): void {
  const addon = buildYtDlpMobileResolver();
  registry.set(addon.id, applyPersistedState(addon));
}

function readManifestRows(): UserMobileResolverManifest[] {
  try {
    const raw = prefsGetItem(MANIFESTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserMobileResolverManifest[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dispatchSettingsChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sandbox-settings-change'));
  }
}

function writeManifestRows(rows: UserMobileResolverManifest[]): void {
  prefsSetItem(MANIFESTS_KEY, JSON.stringify(rows));
  dispatchSettingsChange();
}

type MobileResolverManifestJson = {
  name?: string;
  version?: string;
  resolve?: { endpoint?: string; method?: string };
};

async function fetchResolverManifest(
  manifestUrl: string,
): Promise<{ name: string; version: string; endpoint: string; method: string }> {
  const res = await fetchWithTimeout(manifestUrl, undefined, 12_000);
  if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
  const data = (await res.json()) as MobileResolverManifestJson;
  const endpoint = data.resolve?.endpoint?.trim();
  if (!endpoint) throw new Error('Manifest missing resolve.endpoint');
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
    if (endpointUrl.protocol !== 'https:') {
      throw new Error('resolve.endpoint must be HTTPS');
    }
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'Invalid resolve.endpoint URL');
  }
  const host = new URL(manifestUrl).hostname;
  return {
    name:
      typeof data.name === 'string' && data.name.trim() ? data.name.trim() : host,
    version: typeof data.version === 'string' ? data.version : '0.0.0',
    endpoint: endpointUrl.toString(),
    method: (data.resolve?.method ?? 'POST').toUpperCase(),
  };
}

function manifestResolveFn(
  manifestUrl: string,
  endpoint: string,
  method: string,
): MobileResolverAddon['resolve'] {
  return async (query: string) => {
    const q = query.trim();
    if (!q) return null;
    const init: RequestInit =
      method === 'GET'
        ? { method: 'GET' }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: q }),
          };
    const url =
      method === 'GET'
        ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}query=${encodeURIComponent(q)}`
        : endpoint;
    const res = await fetchWithTimeout(url, init, 20_000);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      uri?: string;
      url?: string;
      bitrate?: number;
      format?: string;
    };
    const uri = (data.uri ?? data.url)?.trim();
    if (!uri) return null;
    return {
      uri,
      bitrate: typeof data.bitrate === 'number' ? data.bitrate : 0,
      format: typeof data.format === 'string' ? data.format : 'unknown',
    };
  };
}

function registerManifestResolver(row: UserMobileResolverManifest): void {
  void (async () => {
    try {
      const meta = await fetchResolverManifest(row.manifestUrl);
      registerMobileResolver({
        id: row.id,
        name: row.name || meta.name,
        enabled: true,
        manifestUrl: row.manifestUrl,
        version: row.version || meta.version,
        resolve: manifestResolveFn(row.manifestUrl, meta.endpoint, meta.method),
      });
    } catch {
      registerMobileResolver({
        id: row.id,
        name: row.name,
        enabled: false,
        manifestUrl: row.manifestUrl,
        version: row.version,
        resolve: async () => null,
      });
    }
  })();
}

function hydrateManifestResolvers(): void {
  for (const row of readManifestRows()) {
    registerManifestResolver(row);
  }
}

seedBuiltinResolvers();
hydrateManifestResolvers();

export function getUserMobileResolverManifests(): UserMobileResolverManifest[] {
  return readManifestRows();
}

export async function installMobileResolverManifest(
  manifestUrl: string,
): Promise<UserMobileResolverManifest> {
  const raw = manifestUrl.trim();
  if (!raw) throw new Error('Paste a manifest URL first.');
  let parsed: URL;
  try {
    parsed = new URL(raw);
    if (parsed.protocol !== 'https:') throw new Error('HTTPS manifest URL required');
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'Invalid manifest URL');
  }

  const rows = readManifestRows();
  if (rows.some((r) => r.manifestUrl === raw)) {
    throw new Error('That manifest is already registered.');
  }

  const meta = await fetchResolverManifest(raw);
  const row: UserMobileResolverManifest = {
    id: `mobile-resolver-${Date.now()}`,
    name: meta.name,
    manifestUrl: raw,
    version: meta.version,
  };
  writeManifestRows([row, ...rows]);
  registerMobileResolver({
    id: row.id,
    name: row.name,
    enabled: true,
    manifestUrl: row.manifestUrl,
    version: row.version,
    resolve: manifestResolveFn(raw, meta.endpoint, meta.method),
  });
  return row;
}

export function removeUserMobileResolver(id: string): void {
  writeManifestRows(readManifestRows().filter((r) => r.id !== id));
  removeMobileResolver(id);
}

export function hasActiveMobileResolvers(): boolean {
  return getEnabledMobileResolvers().length > 0;
}

/** Android/iOS offline: re-resolve via yt-dlp instead of stale cache or unreachable server. */
export function preferFreshMobileResolve(): boolean {
  if (!isMobileNativePlatform() || !hasActiveMobileResolvers()) return false;
  const base = getTier34BaseUrl().trim();
  if (!base) return true;
  return !isServerReachableCached();
}

function isMobileNativePlatform(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  const platform = Capacitor.getPlatform();
  return platform === 'android' || platform === 'ios';
}

/**
 * On-device stream resolution — Android/iOS only. Reads URI cache (6h TTL) before addons.
 */
async function cachedMobileUriIfReachable(cached: {
  query: string;
  uri: string;
}): Promise<string | null> {
  const uri = cached.uri?.trim();
  if (!uri || isCatalogPreviewUrl(uri)) return null;
  if (isOfflineUnplayableStreamUrl(uri)) {
    removeCachedStream(cached.query);
    return null;
  }
  if (/^file:\/\//i.test(uri)) {
    const reachable = await localDevicePlayUrlReachable(uri);
    if (!reachable) {
      removeCachedStream(cached.query);
      return null;
    }
  }
  return uri;
}

export async function tryMobileResolve(query: string): Promise<string | null> {
  const q = query.trim();
  if (!q || !isMobileNativePlatform()) return null;

  if (!preferFreshMobileResolve()) {
    const cached = getCachedStream(q);
    if (cached?.uri && cached.source === 'mobile' && !isCatalogPreviewUrl(cached.uri)) {
      if (isOfflineUnplayableStreamUrl(cached.uri)) {
        removeCachedStream(q);
        /* stale CDN / server proxy — re-resolve via yt-dlp */
      } else {
        const hit = await cachedMobileUriIfReachable({ query: q, uri: cached.uri });
        if (hit) return hit;
      }
    }
  } else {
    const cached = getCachedStream(q);
    if (
      cached?.uri &&
      cached.source === 'mobile' &&
      /^file:\/\//i.test(cached.uri) &&
      !isCatalogPreviewUrl(cached.uri)
    ) {
      const hit = await cachedMobileUriIfReachable({ query: q, uri: cached.uri });
      if (hit) return hit;
    }
  }

  const resolvers = getEnabledMobileResolvers();
  for (const resolver of resolvers) {
    try {
      const hit = await resolver.resolve(q);
      const uri = hit?.uri?.trim();
      if (!uri || isCatalogPreviewUrl(uri)) continue;
      const playUrl = await pickMobileExoPlayUrlAsync({ uri, watchUrl: hit.watchUrl });
      const chosen = playUrl?.trim() || uri;
      if (!chosen || isCatalogPreviewUrl(chosen)) continue;
      putCachedStream({ query: q, uri: chosen, source: 'mobile' });
      return chosen;
    } catch {
      /* try next resolver */
    }
  }
  return null;
}

/** Last yt-dlp mobile failure — for user-facing playback errors. */
export function getLastMobileResolveError(): string | null {
  return getLastYtDlpMobileError();
}

export function registerMobileResolver(addon: MobileResolverAddon): void {
  const removed = readRemovedIds();
  removed.delete(addon.id);
  writeRemovedIds(removed);
  registry.set(addon.id, applyPersistedState(addon));
}

export function getMobileResolvers(): MobileResolverAddon[] {
  seedBuiltinResolvers();
  return [...registry.values()].map(applyPersistedState);
}

export function getEnabledMobileResolvers(): MobileResolverAddon[] {
  return getMobileResolvers().filter((r) => r.enabled);
}

export function setMobileResolverEnabled(id: string, enabled: boolean): void {
  const addon = registry.get(id);
  if (!addon) return;
  const map = readEnabledIds();
  map[id] = enabled;
  writeEnabledIds(map);
  registry.set(id, { ...addon, enabled });
}

export function removeMobileResolver(id: string): void {
  const removed = readRemovedIds();
  removed.add(id);
  writeRemovedIds(removed);
  const map = readEnabledIds();
  delete map[id];
  writeEnabledIds(map);
  registry.delete(id);
}

/** True when the built-in Android yt-dlp bridge is available. */
export function isYtDlpMobileAddonPresent(): boolean {
  return isYtDlpMobileNativeAvailable();
}

/** Re-register the built-in yt-dlp mobile resolver and ensure it is enabled on Android when not explicitly removed. */
export function refreshYtDlpMobileStub(): void {
  const addon = buildYtDlpMobileResolver();
  registerMobileResolver(addon);
  if (addon.enabled && !readRemovedIds().has(YTDLP_MOBILE_ID)) {
    const map = readEnabledIds();
    if (!(YTDLP_MOBILE_ID in map)) {
      setMobileResolverEnabled(YTDLP_MOBILE_ID, true);
    }
  }
}

/** Ensure on-device yt-dlp is registered and enabled before offline playback. */
export function ensureYtDlpMobileReady(): boolean {
  refreshYtDlpMobileStub();
  if (isYtDlpMobileNativeAvailable() && !readRemovedIds().has(YTDLP_MOBILE_ID)) {
    setMobileResolverEnabled(YTDLP_MOBILE_ID, true);
  }
  return hasActiveMobileResolvers();
}
