/**
 * Fetch HTML from allowed hosts via the bundled Sandbox page-proxy (CORS bypass).
 */

import { hasSameOriginCatalogProxy, resolveAppProxyUrl } from './catalogDirect';
import { fetchWithTimeout } from './fetchWithTimeout';

const PAGE_FETCH_TIMEOUT_MS = 12_000;

const SCRAPE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export function hasPageProxy(): boolean {
  if (typeof window === 'undefined') return false;
  return hasSameOriginCatalogProxy() || Boolean(resolveAppProxyUrl('/page-proxy').startsWith('http'));
}

function pageProxyUrl(targetUrl: string): string {
  const relative = `/page-proxy?url=${encodeURIComponent(targetUrl)}`;
  if (hasSameOriginCatalogProxy()) return relative;
  const resolved = resolveAppProxyUrl(relative);
  return resolved.startsWith('http') ? resolved : relative;
}

/** Direct fetch when CORS does not apply (Capacitor/Tauri), else page-proxy. */
export async function fetchCoverScrapeHtml(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return null;
  try {
    const direct = await fetchWithTimeout(trimmed, { headers: SCRAPE_HEADERS }, PAGE_FETCH_TIMEOUT_MS);
    if (direct.ok) return await direct.text();
  } catch {
    /* page-proxy fallback */
  }
  return fetchProxiedPageHtml(trimmed);
}

/** Best-effort HTML fetch for cover scrapers (DatPiff, untitled.stream, …). */
export async function fetchProxiedPageHtml(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return null;
  if (!hasPageProxy()) return null;
  try {
    const res = await fetchWithTimeout(
      pageProxyUrl(trimmed),
      { headers: { Accept: SCRAPE_HEADERS.Accept } },
      PAGE_FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
