/**
 * Last.fm + ListenBrainz scrobble settings — API keys use ephemeral chamber when enabled.
 */

import type { SyncableSecretKey } from './deviceSecretSync';
import { loadSecret, saveSecret, secretStorage } from './securitySettings';

export const LASTFM_API_KEY = 'sandbox_lastfm_api_key';
export const LASTFM_SESSION_KEY = 'sandbox_lastfm_session_key';
export const LASTFM_USERNAME_KEY = 'sandbox_lastfm_username';
export const LISTENBRAINZ_TOKEN_KEY = 'sandbox_listenbrainz_token';
export const SCROBBLE_LASTFM_ENABLED_KEY = 'sandbox_scrobble_lastfm_enabled';
export const SCROBBLE_LISTENBRAINZ_ENABLED_KEY = 'sandbox_scrobble_listenbrainz_enabled';

export interface ScrobbleSettings {
  lastfmEnabled: boolean;
  listenbrainzEnabled: boolean;
  lastfmApiKey: string;
  lastfmSessionKey: string;
  lastfmUsername: string;
  listenbrainzToken: string;
}

function loadBool(key: string): boolean {
  try {
    return secretStorage().getItem(key) === 'true';
  } catch {
    return false;
  }
}

function saveBool(key: string, value: boolean): void {
  secretStorage().setItem(key, String(value));
}

export function loadScrobbleSettings(): ScrobbleSettings {
  return {
    lastfmEnabled: loadBool(SCROBBLE_LASTFM_ENABLED_KEY),
    listenbrainzEnabled: loadBool(SCROBBLE_LISTENBRAINZ_ENABLED_KEY),
    lastfmApiKey: loadSecret(LASTFM_API_KEY),
    lastfmSessionKey: loadSecret(LASTFM_SESSION_KEY),
    lastfmUsername: loadSecret(LASTFM_USERNAME_KEY),
    listenbrainzToken: loadSecret(LISTENBRAINZ_TOKEN_KEY),
  };
}

function notifyScrobbleSync(key: SyncableSecretKey): void {
  void import('./deviceSecretSync').then(({ notifyDeviceSecretChanged }) =>
    notifyDeviceSecretChanged(key),
  );
}

export function saveScrobbleSettings(patch: Partial<ScrobbleSettings>): void {
  if (patch.lastfmEnabled !== undefined) {
    saveBool(SCROBBLE_LASTFM_ENABLED_KEY, patch.lastfmEnabled);
    notifyScrobbleSync(SCROBBLE_LASTFM_ENABLED_KEY);
  }
  if (patch.listenbrainzEnabled !== undefined) {
    saveBool(SCROBBLE_LISTENBRAINZ_ENABLED_KEY, patch.listenbrainzEnabled);
    notifyScrobbleSync(SCROBBLE_LISTENBRAINZ_ENABLED_KEY);
  }
  if (patch.lastfmApiKey !== undefined) {
    saveSecret(LASTFM_API_KEY, patch.lastfmApiKey);
    notifyScrobbleSync(LASTFM_API_KEY);
  }
  if (patch.lastfmSessionKey !== undefined) {
    saveSecret(LASTFM_SESSION_KEY, patch.lastfmSessionKey);
    notifyScrobbleSync(LASTFM_SESSION_KEY);
  }
  if (patch.lastfmUsername !== undefined) {
    saveSecret(LASTFM_USERNAME_KEY, patch.lastfmUsername);
    notifyScrobbleSync(LASTFM_USERNAME_KEY);
  }
  if (patch.listenbrainzToken !== undefined) {
    saveSecret(LISTENBRAINZ_TOKEN_KEY, patch.listenbrainzToken);
    notifyScrobbleSync(LISTENBRAINZ_TOKEN_KEY);
  }
  window.dispatchEvent(new Event('sandbox-settings-change'));
}
