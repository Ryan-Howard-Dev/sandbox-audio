/**
 * Playback engine credentials — Settings → Playback Engine.
 *
 * Sandbox Sonic DSP preferences live in sandboxSettings.ts (loadSandboxSonicEnabled,
 * loadEarSafeListeningEnabled, loadSonicOutputOverride) — applied via playbackCrossfade.ts / sandboxSonic.ts.
 */

import {
  loadSecret,
  saveSecret,
  PROWLARR_API_KEY_KEY,
  PROWLARR_URL_KEY,
  REALDEBRID_API_KEY_KEY,
  DISCOGS_API_TOKEN_KEY,
} from './securitySettings';

export { PROWLARR_API_KEY_KEY, PROWLARR_URL_KEY, REALDEBRID_API_KEY_KEY, DISCOGS_API_TOKEN_KEY };

export const PROWLARR_URL_PLACEHOLDER = 'http://localhost:9696';
/** Empty default — built-in Sandbox Indexer is used when Prowlarr is not configured. */
export const DEFAULT_PROWLARR_URL = '';

export interface PlaybackEngineSettings {
  prowlarrUrl: string;
  prowlarrApiKey: string;
  realDebridApiKey: string;
  discogsApiToken: string;
}

function loadStr(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key)?.trim() ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadPlaybackEngineSettings(): PlaybackEngineSettings {
  return {
    prowlarrUrl: loadStr(PROWLARR_URL_KEY, DEFAULT_PROWLARR_URL),
    prowlarrApiKey: loadSecret(PROWLARR_API_KEY_KEY, ''),
    realDebridApiKey: loadSecret(REALDEBRID_API_KEY_KEY, ''),
    discogsApiToken: loadSecret(DISCOGS_API_TOKEN_KEY, ''),
  };
}

function notifySync(
  key:
    | 'sandbox_prowlarr_url'
    | 'sandbox_prowlarr_api_key'
    | 'sandbox_realdebrid_api_key'
    | 'sandbox_discogs_api_token',
): void {
  void import('./deviceSecretSync').then(({ notifyDeviceSecretChanged }) =>
    notifyDeviceSecretChanged(key),
  );
}

export function savePlaybackEngineSettings(patch: Partial<PlaybackEngineSettings>): void {
  if (patch.prowlarrUrl !== undefined) {
    localStorage.setItem(PROWLARR_URL_KEY, patch.prowlarrUrl);
    notifySync(PROWLARR_URL_KEY);
  }
  if (patch.prowlarrApiKey !== undefined) {
    saveSecret(PROWLARR_API_KEY_KEY, patch.prowlarrApiKey);
    notifySync(PROWLARR_API_KEY_KEY);
  }
  if (patch.realDebridApiKey !== undefined) {
    saveSecret(REALDEBRID_API_KEY_KEY, patch.realDebridApiKey);
    notifySync(REALDEBRID_API_KEY_KEY);
  }
  if (patch.discogsApiToken !== undefined) {
    saveSecret(DISCOGS_API_TOKEN_KEY, patch.discogsApiToken);
    notifySync(DISCOGS_API_TOKEN_KEY);
  }
}
