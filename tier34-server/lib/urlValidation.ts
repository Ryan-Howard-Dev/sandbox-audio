/**
 * SSRF guard for /api/proxy/stream — allow only public HTTP(S) media hosts.
 */

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '::1',
]);

const ALLOWED_HOST_SUFFIXES = [
  'youtube.com',
  'youtu.be',
  'googlevideo.com',
  'archive.org',
  'mzstatic.com',
  'invidious.fdn.fr',
  'vid.puffyan.us',
  'inv.nadeko.net',
  'soundcloud.com',
  'sndcdn.com',
  'pipedapi.kavin.rocks',
  'pipedapi.adminforge.de',
  'api-piped.mha.fi',
  'piped.video',
  'audius.co',
  'audiuscdn.com',
  'audius-content.com',
];

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [, a, b] = m.map(Number) as [unknown, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function isAllowedProxyStreamUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return false;
  if (isPrivateIpv4(host)) return false;
  if (host.endsWith('.local') || host.endsWith('.internal')) return false;

  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/** Permissive guard for internet-radio streams (many unique upstream hosts). */
export function isAllowedRadioStreamUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return false;
  if (isPrivateIpv4(host)) return false;
  if (host.endsWith('.local') || host.endsWith('.internal')) return false;

  return true;
}
