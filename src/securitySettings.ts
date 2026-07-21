/**
 * Security protocol toggles — Settings → Defense.
 */

import { OAUTH_TOKEN_KEY } from './tier34/client';
import {
  LASTFM_API_KEY,
  LASTFM_SESSION_KEY,
  LISTENBRAINZ_TOKEN_KEY,
} from './scrobbleSettings';
import { migratePrefsOnPersistenceChange } from './prefsStorage';

export const PROWLARR_URL_KEY = 'sandbox_prowlarr_url';
export const PROWLARR_API_KEY_KEY = 'sandbox_prowlarr_api_key';
export const REALDEBRID_API_KEY_KEY = 'sandbox_realdebrid_api_key';
export const DISCOGS_API_TOKEN_KEY = 'sandbox_discogs_api_token';

export const EPHEMERAL_CHAMBER_KEY = 'sandbox_ephemeral_chamber';
export const GHOST_PROTOCOL_KEY = 'sandbox_ghost_protocol';
export const DEFENSE_PROTOCOL_KEY = 'sandbox_defense_protocol';
export const DATA_PERSISTENCE_KEY = 'sandbox_data_persistence';

const API_KEY_KEYS = [
  PROWLARR_API_KEY_KEY,
  REALDEBRID_API_KEY_KEY,
  DISCOGS_API_TOKEN_KEY,
  LASTFM_API_KEY,
  LASTFM_SESSION_KEY,
  LISTENBRAINZ_TOKEN_KEY,
] as const;

export interface SecuritySettings {
  /** API keys live in sessionStorage only (cleared on tab close). */
  ephemeralChamber: boolean;
  /** Clear API keys from storage on sign-out. */
  ghostProtocol: boolean;
  /** Synced with tier34 PATCH /api/security/defense-protocol when server reachable. */
  defenseProtocol: boolean;
  /** Persist non-secret preferences to localStorage (when off, use sessionStorage). */
  dataPersistence: boolean;
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === 'true';
  } catch {
    return fallback;
  }
}

export function loadSecuritySettings(): SecuritySettings {
  return {
    ephemeralChamber: loadBool(EPHEMERAL_CHAMBER_KEY, false),
    ghostProtocol: loadBool(GHOST_PROTOCOL_KEY, true),
    defenseProtocol: loadBool(DEFENSE_PROTOCOL_KEY, true),
    dataPersistence: loadBool(DATA_PERSISTENCE_KEY, true),
  };
}

export function saveSecuritySettings(patch: Partial<SecuritySettings>): void {
  if (patch.ephemeralChamber !== undefined) {
    localStorage.setItem(EPHEMERAL_CHAMBER_KEY, String(patch.ephemeralChamber));
    if (patch.ephemeralChamber) migrateApiKeysToSession();
  }
  if (patch.ghostProtocol !== undefined) {
    localStorage.setItem(GHOST_PROTOCOL_KEY, String(patch.ghostProtocol));
  }
  if (patch.defenseProtocol !== undefined) {
    localStorage.setItem(DEFENSE_PROTOCOL_KEY, String(patch.defenseProtocol));
  }
  if (patch.dataPersistence !== undefined) {
    localStorage.setItem(DATA_PERSISTENCE_KEY, String(patch.dataPersistence));
    migratePrefsOnPersistenceChange(patch.dataPersistence);
  }
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** Prefer sessionStorage for secrets when Ephemeral Chamber is on. */
export function secretStorage(): Storage {
  const { ephemeralChamber } = loadSecuritySettings();
  return ephemeralChamber ? sessionStorage : localStorage;
}

export function loadSecret(key: string, fallback = ''): string {
  try {
    const fromSession = sessionStorage.getItem(key)?.trim();
    if (fromSession) return fromSession;
    return localStorage.getItem(key)?.trim() ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveSecret(key: string, value: string): void {
  const store = secretStorage();
  store.setItem(key, value);
  if (store === sessionStorage) {
    localStorage.removeItem(key);
  }
}

function migrateApiKeysToSession(): void {
  for (const key of API_KEY_KEYS) {
    const v = localStorage.getItem(key);
    if (v) {
      sessionStorage.setItem(key, v);
      localStorage.removeItem(key);
    }
  }
}

/** Ghost Protocol — purge API keys and OAuth token from all storage on sign-out. */
export function runGhostProtocol(): void {
  const { ghostProtocol } = loadSecuritySettings();
  if (!ghostProtocol) return;
  for (const key of [...API_KEY_KEYS, OAUTH_TOKEN_KEY]) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}
