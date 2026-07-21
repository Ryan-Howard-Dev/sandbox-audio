/**
 * SSRF guard for Jellyfin/Navidrome library proxy — allow LAN/self-hosted hosts only.
 */

const BLOCKED_HOSTS = new Set(['0.0.0.0', '[::1]', '::1']);

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [, a, b] = m.map(Number) as [unknown, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function normalizeLibraryBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Library base URL required');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Library URL must be http or https');
  }
  return parsed.origin;
}

export function isAllowedLibraryBaseUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(normalizeLibraryBaseUrl(raw));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return false;
  if (host === 'localhost') return true;
  if (isPrivateIpv4(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.lan')) return true;

  return /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(host) && host.length <= 253;
}
