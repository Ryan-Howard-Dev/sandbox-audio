/**
 * Air-Gap Mode — block outbound internet; allow locker, playlists, and LAN tier34.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const AIR_GAP_MODE_KEY = 'sandbox_air_gap_mode';
export const LAN_PARTY_MODE_KEY = 'sandbox_lan_party_mode';

/** LAN party preset: air-gap + documented Connect/DLNA-only pattern. */
export function isLanPartyMode(): boolean {
  return prefsGetItem(LAN_PARTY_MODE_KEY) === 'true';
}

export function setLanPartyMode(enabled: boolean): void {
  prefsSetItem(LAN_PARTY_MODE_KEY, enabled ? 'true' : 'false');
  if (enabled) {
    setAirGap(true);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sandbox-settings-change'));
  }
  notify(isAirGapEnabled());
}

/** Apply LAN party preset — blocks WAN, keeps locker + LAN tier34. See docs/air-gap-lan-party.md */
export function applyLanPartyPreset(): void {
  setLanPartyMode(true);
}

/** Same-origin dev proxies that reach external providers. */
const BLOCKED_PATH_PREFIXES = [
  '/api/catalog/',
  '/api/lyrics',
  '/api/metadata',
  '/api/artist-image',
  '/api/podcast-feed',
  '/api/podcast-audio-proxy',
  '/api/podcast-youtube',
  '/api/podcast/search',
  '/api/podcast/trending',
  '/api/cover-bytes',
  '/api/playlist-metadata',
  '/api/oembed',
] as const;

/** Tier34 routes that trigger outbound internet from the backend. */
const TIER34_BLOCKED_PATH_PREFIXES = [
  '/api/acquire',
  '/api/proxy/resolve',
  '/api/debrid/resolve',
  '/api/podcast-feed',
  '/api/podcast/youtube',
  '/api/podcast/search',
  '/api/podcast/trending',
] as const;

export class AirGapBlockedError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`Air-Gap Mode blocked request: ${url}`);
    this.name = 'AirGapBlockedError';
    this.url = url;
  }
}

type AirGapListener = (enabled: boolean) => void;
const listeners = new Set<AirGapListener>();

let nativeFetch: typeof fetch | null = null;
let fetchGuardInstalled = false;

function notify(enabled: boolean): void {
  for (const fn of listeners) fn(enabled);
}

export function isAirGapEnabled(): boolean {
  return prefsGetItem(AIR_GAP_MODE_KEY) === 'true';
}

export function setAirGap(enabled: boolean): void {
  prefsSetItem(AIR_GAP_MODE_KEY, enabled ? 'true' : 'false');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sandbox-settings-change'));
  }
  notify(enabled);
}

export function subscribeAirGap(listener: AirGapListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNativeFetch(): typeof fetch {
  if (!nativeFetch) {
    nativeFetch = globalThis.fetch.bind(globalThis);
  }
  return nativeFetch;
}

function normalizeHostname(hostname: string): string {
  const h = hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) return h.slice(1, -1);
  return h;
}

/** localhost, loopback, RFC1918, link-local, and .local mDNS. */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (h.endsWith('.local')) return true;

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const [, a, b] = ipv4.map((x) => parseInt(x, 10)) as [number, number, number, number];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function pathBlocked(pathname: string, prefixes: readonly string[]): boolean {
  const path = pathname.toLowerCase();
  return prefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

function toAbsoluteUrl(raw: string): URL | null {
  try {
    if (raw.startsWith('blob:') || raw.startsWith('data:')) return null;
    const base =
      typeof window !== 'undefined' && window.location?.href
        ? window.location.href
        : 'http://localhost/';
    return new URL(raw, base);
  } catch {
    return null;
  }
}

/**
 * True when a fetch may proceed while Air-Gap Mode is active.
 * Allows same-origin (non-proxy paths), localhost, and LAN tier34 locker/search/graph.
 */
export function isFetchAllowed(input: RequestInfo | URL): boolean {
  if (!isAirGapEnabled()) return true;

  const raw = resolveRequestUrl(input);
  const parsed = toAbsoluteUrl(raw);
  if (!parsed) return true;

  const { pathname, hostname, protocol } = parsed;
  if (protocol !== 'http:' && protocol !== 'https:') return true;

  if (pathBlocked(pathname, BLOCKED_PATH_PREFIXES)) return false;

  const sameOrigin =
    typeof window !== 'undefined' &&
    window.location?.origin &&
    parsed.origin === window.location.origin;

  if (sameOrigin) return true;

  if (!isPrivateOrLocalHost(hostname)) return false;

  if (pathBlocked(pathname, TIER34_BLOCKED_PATH_PREFIXES)) return false;

  return true;
}

export function airGapBlockedResponse(): Response {
  return new Response(
    JSON.stringify({ error: 'Blocked by Air-Gap Mode', airGap: true }),
    {
      status: 451,
      statusText: 'Air-Gap Blocked',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/** Patch global fetch so all network calls respect Air-Gap Mode. */
export function installAirGapFetchGuard(): void {
  if (typeof window === 'undefined' || fetchGuardInstalled) return;
  fetchGuardInstalled = true;

  const native = getNativeFetch();
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isFetchAllowed(input)) {
      return Promise.resolve(airGapBlockedResponse());
    }
    return native(input, init);
  };
}
