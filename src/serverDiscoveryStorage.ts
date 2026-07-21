/**
 * Recent Sandbox Server URLs for discovery UI.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';
import { normalizeTier34ServerUrl } from './tier34ServerProbe';

const RECENT_URLS_KEY = 'sandbox_server_recent_urls_v1';
const MAX_RECENT = 6;

export function loadRecentServerUrls(): string[] {
  const raw = prefsGetItem(RECENT_URLS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === 'string')
      .map((v) => normalizeTier34ServerUrl(v))
      .filter(Boolean)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberRecentServerUrl(url: string): void {
  const normalized = normalizeTier34ServerUrl(url);
  if (!normalized) return;
  const existing = loadRecentServerUrls().filter((u) => u !== normalized);
  const next = [normalized, ...existing].slice(0, MAX_RECENT);
  prefsSetItem(RECENT_URLS_KEY, JSON.stringify(next));
}
