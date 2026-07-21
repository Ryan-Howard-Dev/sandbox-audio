/**
 * Runtime defense protocol toggle — restricts CORS, proxy stream targets, and Interminable Tide.
 * Default from TIER34_DEFENSE_PROTOCOL env; overridable via PATCH /api/security/defense-protocol.
 */

import fs from 'node:fs';
import path from 'node:path';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';

const CONFIG_PATH = path.join(LOCKER_STORAGE_ROOT, 'defense-protocol.json');

export type InterminableTideMode = 'off' | 'chaff' | 'jitter' | 'both';

type DefenseConfig = {
  enabled: boolean;
  updatedAt: number;
  interminableTide?: InterminableTideMode;
  defenseStrict?: boolean;
};

const envDefault = process.env.TIER34_DEFENSE_PROTOCOL !== 'false';

function parseTideMode(raw: string | undefined): InterminableTideMode {
  const v = (raw ?? 'chaff').trim().toLowerCase();
  if (v === 'off' || v === 'chaff' || v === 'jitter' || v === 'both') return v;
  return 'chaff';
}

const envTideMode = parseTideMode(process.env.TIER34_INTERMINABLE_TIDE);
const envDefenseStrict = process.env.TIER34_DEFENSE_STRICT === 'true';

let runtimeEnabled = envDefault;
let runtimeTideMode = envTideMode;
let runtimeDefenseStrict = envDefenseStrict;

function readConfig(): DefenseConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as DefenseConfig;
    if (typeof raw.enabled !== 'boolean') return null;
    return raw;
  } catch {
    return null;
  }
}

function writeConfig(patch: Partial<DefenseConfig> & { enabled: boolean }): DefenseConfig {
  const row: DefenseConfig = {
    enabled: patch.enabled,
    updatedAt: Date.now(),
    interminableTide: patch.interminableTide ?? runtimeTideMode,
    defenseStrict: patch.defenseStrict ?? runtimeDefenseStrict,
  };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(row, null, 2));
  return row;
}

/** Boot — env default, overridden by persisted config when present. */
export function bootDefenseProtocol(): void {
  const saved = readConfig();
  runtimeEnabled = saved?.enabled ?? envDefault;
  runtimeTideMode = saved?.interminableTide ?? envTideMode;
  runtimeDefenseStrict = saved?.defenseStrict ?? envDefenseStrict;
}

export function isDefenseProtocolEnabled(): boolean {
  return runtimeEnabled;
}

export function isDefenseStrictMode(): boolean {
  return runtimeDefenseStrict;
}

export function getInterminableTideMode(): InterminableTideMode {
  return runtimeTideMode;
}

export function getDefenseProtocolStatus(): {
  enabled: boolean;
  envDefault: boolean;
  configurableViaEnv: 'TIER34_DEFENSE_PROTOCOL';
  interminableTide: InterminableTideMode;
  interminableTideEnv: 'TIER34_INTERMINABLE_TIDE';
  defenseStrict: boolean;
  defenseStrictEnv: 'TIER34_DEFENSE_STRICT';
  updatedAt: number | null;
} {
  const saved = readConfig();
  return {
    enabled: runtimeEnabled,
    envDefault,
    configurableViaEnv: 'TIER34_DEFENSE_PROTOCOL',
    interminableTide: runtimeTideMode,
    interminableTideEnv: 'TIER34_INTERMINABLE_TIDE',
    defenseStrict: runtimeDefenseStrict,
    defenseStrictEnv: 'TIER34_DEFENSE_STRICT',
    updatedAt: saved?.updatedAt ?? null,
  };
}

export function setDefenseProtocolEnabled(enabled: boolean): DefenseConfig {
  runtimeEnabled = enabled;
  return writeConfig({ enabled });
}

export function setDefenseProtocolOptions(patch: {
  enabled?: boolean;
  interminableTide?: InterminableTideMode;
  defenseStrict?: boolean;
}): DefenseConfig {
  if (patch.enabled !== undefined) runtimeEnabled = patch.enabled;
  if (patch.interminableTide !== undefined) runtimeTideMode = patch.interminableTide;
  if (patch.defenseStrict !== undefined) runtimeDefenseStrict = patch.defenseStrict;
  return writeConfig({
    enabled: runtimeEnabled,
    interminableTide: runtimeTideMode,
    defenseStrict: runtimeDefenseStrict,
  });
}
