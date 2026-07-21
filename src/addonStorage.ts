/**
 * Installed addons — built-in personal pack + user manifests.
 *
 * Built-in dev-test pack (2025-06):
 * | Addon       | Status   | Notes |
 * |-------------|----------|-------|
 * | SoundCloud    | DEV-TEST | tier34 POST /api/addon/soundcloud/resolve — API + yt-dlp scsearch |
 * | WebTorrent    | DEV-TEST | tier34 POST /api/addon/webtorrent/resolve — RD magnet or archive P2P |
 * | IPFS          | DEV-TEST | tier34 POST /api/addon/ipfs/resolve — archive mesh sources |
 * | Radio Browser | DEV-TEST | tier34 POST /api/addon/radio-browser/search — live stations (play-only) |
 * | Audius        | DEV-TEST | tier34 POST /api/addon/audius/resolve — decentralized CDN streams |
 * | Soulseek      | DEV-TEST | tier34 POST /api/addon/soulseek/resolve — slskd headless Soulseek network |
 *
 * Hidden from UI/search unless Settings → Addons → Show Experimental Integrations is ON.
 * Turning that toggle ON auto-enables all three built-ins for dev playback testing.
 */

import { loadShowExperimentalIntegrations } from './sandboxSettings';

export type AddonTier = 1 | 2 | 3 | 4;

export type AddonStatus = 'ACTIVE' | 'STUBBED' | 'DISABLED';

export interface SandboxAddon {
  id: string;
  name: string;
  version: string;
  tier: AddonTier;
  /** Empty for built-in pack entries. */
  manifestUrl: string;
  builtIn: boolean;
  enabled: boolean;
  /** Dev-test hint shown in Settings. */
  note?: string;
  /** Optional config fields (e.g. SoundCloud client_id). */
  config?: Record<string, string>;
}

const ADDONS_KEY = 'sandbox_installed_addons';

export const BUILTIN_ADDON_IDS = {
  soundcloud: 'builtin-soundcloud',
  webtorrent: 'builtin-webtorrent',
  ipfs: 'builtin-ipfs-hypercore',
  radioBrowser: 'builtin-radio-browser',
  audius: 'builtin-audius',
  soulseek: 'builtin-soulseek',
} as const;

/** Dev-test — tier34 SoundCloud resolve; optional client_id in Settings. */
function builtinSoundCloud(): SandboxAddon {
  return {
    id: BUILTIN_ADDON_IDS.soundcloud,
    name: 'SoundCloud',
    version: '0.2.0',
    tier: 2,
    manifestUrl: '',
    builtIn: true,
    enabled: false,
    note: 'Dev-test: tier34 SoundCloud resolve (client_id optional — yt-dlp fallback).',
    config: { client_id: '' },
  };
}

/** Dev-test — tier34 WebTorrent/magnet resolve. */
function builtinWebTorrent(): SandboxAddon {
  return {
    id: BUILTIN_ADDON_IDS.webtorrent,
    name: 'WebTorrent P2P',
    version: '0.2.0',
    tier: 4,
    manifestUrl: '',
    builtIn: true,
    enabled: false,
    note: 'Dev-test: tier34 magnet/RD or archive P2P streams.',
  };
}

/** Dev-test — tier34 IPFS/mesh archive resolve. */
function builtinIpfs(): SandboxAddon {
  return {
    id: BUILTIN_ADDON_IDS.ipfs,
    name: 'IPFS / Hypercore',
    version: '0.2.0',
    tier: 4,
    manifestUrl: '',
    builtIn: true,
    enabled: false,
    note: 'Dev-test: tier34 archive content-addressable mesh sources.',
  };
}

/** Dev-test — Radio Browser live stations (play-only; not per-track download). */
function builtinRadioBrowser(): SandboxAddon {
  return {
    id: BUILTIN_ADDON_IDS.radioBrowser,
    name: 'Radio Browser',
    version: '0.2.0',
    tier: 2,
    manifestUrl: '',
    builtIn: true,
    enabled: false,
    note: 'Dev-test: tier34 Radio Browser live stations — search "jazz radio" etc.',
  };
}

/** Dev-test — Audius decentralized streams. */
function builtinAudius(): SandboxAddon {
  return {
    id: BUILTIN_ADDON_IDS.audius,
    name: 'Audius',
    version: '0.2.0',
    tier: 2,
    manifestUrl: '',
    builtIn: true,
    enabled: false,
    note: 'Dev-test: tier34 Audius resolve — optional API key / app name in Settings.',
    config: { api_key: '', app_name: 'SandboxMusic' },
  };
}

/** Dev-test — Soulseek via slskd on tier34 (mixtapes, rare albums). */
function builtinSoulseek(): SandboxAddon {
  return {
    id: BUILTIN_ADDON_IDS.soulseek,
    name: 'Soulseek',
    version: '0.1.0',
    tier: 2,
    manifestUrl: '',
    builtIn: true,
    enabled: false,
    note: 'Dev-test: tier34 slskd Soulseek search — requires slskd on the server.',
  };
}

function builtinPack(): SandboxAddon[] {
  return [
    builtinSoundCloud(),
    builtinWebTorrent(),
    builtinIpfs(),
    builtinRadioBrowser(),
    builtinAudius(),
    builtinSoulseek(),
  ];
}

function readRaw(): SandboxAddon[] {
  try {
    const raw = localStorage.getItem(ADDONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SandboxAddon[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(addons: SandboxAddon[]): void {
  localStorage.setItem(ADDONS_KEY, JSON.stringify(addons));
}

/** When experimental integrations are on, enable all built-in dev-test addons. */
export function syncExperimentalAddons(showExperimental: boolean): void {
  if (!showExperimental) return;
  ensureBuiltinAddons();
  const fresh = readRaw();
  let changed = false;
  const next = fresh.map((a) => {
    if (!a.builtIn || !isStubAddon(a)) return a;
    if (a.enabled) return a;
    changed = true;
    return { ...a, enabled: true };
  });
  if (changed) writeRaw(next);
}

/** Merge built-in pack into storage on every app start. */
export function ensureBuiltinAddons(): void {
  const existing = readRaw();
  const builtins = builtinPack();
  const byId = new Map(existing.map((a) => [a.id, a]));
  let changed = false;

  for (const builtin of builtins) {
    const prev = byId.get(builtin.id);
    if (!prev) {
      byId.set(builtin.id, builtin);
      changed = true;
      continue;
    }
    const merged: SandboxAddon = {
      ...builtin,
      enabled: prev.enabled ?? builtin.enabled,
      config: { ...builtin.config, ...prev.config },
    };
    if (JSON.stringify(merged) !== JSON.stringify(prev)) {
      byId.set(builtin.id, merged);
      changed = true;
    }
  }

  if (changed || existing.length !== byId.size) {
    writeRaw([...byId.values()]);
  }
}

export function loadAddons(): SandboxAddon[] {
  ensureBuiltinAddons();
  return readRaw();
}

export function saveAddons(addons: SandboxAddon[]): void {
  writeRaw(addons);
}

export function isStubAddon(addon: SandboxAddon): boolean {
  return (
    addon.id === BUILTIN_ADDON_IDS.soundcloud ||
    addon.id === BUILTIN_ADDON_IDS.webtorrent ||
    addon.id === BUILTIN_ADDON_IDS.ipfs ||
    addon.id === BUILTIN_ADDON_IDS.radioBrowser ||
    addon.id === BUILTIN_ADDON_IDS.audius ||
    addon.id === BUILTIN_ADDON_IDS.soulseek
  );
}

/** Built-in dev-test addon participates when experimental mode + enabled. */
export function isExperimentalAddonActive(id: string): boolean {
  if (!loadShowExperimentalIntegrations()) return false;
  const addon = loadAddons().find((a) => a.id === id);
  return Boolean(addon?.enabled);
}

export function getAddonStatus(addon: SandboxAddon): AddonStatus {
  if (!addon.enabled) return 'DISABLED';
  if (isStubAddon(addon)) return 'STUBBED';
  return 'ACTIVE';
}

export function setAddonEnabled(id: string, enabled: boolean): void {
  const list = loadAddons();
  const next = list.map((a) => (a.id === id ? { ...a, enabled } : a));
  saveAddons(next);
}

export function setAddonConfig(id: string, config: Record<string, string>): void {
  const list = loadAddons();
  const next = list.map((a) =>
    a.id === id ? { ...a, config: { ...a.config, ...config } } : a,
  );
  saveAddons(next);
  if (
    id === BUILTIN_ADDON_IDS.soundcloud ||
    id === BUILTIN_ADDON_IDS.audius
  ) {
    void import('./deviceSecretSync').then(({ notifyDeviceSecretChanged, ADDON_SECRETS_KEY }) =>
      notifyDeviceSecretChanged(ADDON_SECRETS_KEY),
    );
  }
}

export function installUserAddon(entry: Omit<SandboxAddon, 'builtIn' | 'enabled'>): SandboxAddon {
  const list = loadAddons();
  const addon: SandboxAddon = { ...entry, builtIn: false, enabled: true };
  const next = [...list.filter((a) => a.manifestUrl !== addon.manifestUrl), addon];
  saveAddons(next);
  return addon;
}

export function removeUserAddon(id: string): void {
  const list = loadAddons();
  saveAddons(list.filter((a) => a.id !== id || a.builtIn));
}

export function getEnabledAddons(): SandboxAddon[] {
  return loadAddons().filter((a) => a.enabled);
}
