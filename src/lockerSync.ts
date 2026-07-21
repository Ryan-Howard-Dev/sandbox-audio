/**
 * Cross-device locker sync — Phase 1: metadata manifest export/import + optional WebDAV.
 * See LOCKER_SYNC.md for architecture and phased rollout.
 */

import {
  getLockerEntries,
  getLockerStorageUsage,
  capacityLimitBytes,
  lockerAlbumGroupKey,
  lockerEntryIsPlayable,
  persistAlbumCoverBlobForGroup,
  refreshLockerCache,
  resolveLockerReacquireTargetId,
  saveLockerBlob,
  updateLockerEntryMetadata,
  type LockerEntry,
} from './lockerStorage';
import {
  isSmartPlaylist,
  loadPlaylists,
  loadPlaylistTombstones,
  mergePlaylistsFromManifest,
  PLAYLISTS_SYNC_DIRTY_EVENT,
  type PlaylistSyncMergeStats,
  type PlaylistTombstone,
  type StoredPlaylist,
} from './playlistStorage';
import {
  loadTrackTombstones,
  TRACKS_SYNC_DIRTY_EVENT,
  type TrackTombstone,
} from './lockerTrackTombstones';
import {
  clearLockerSyncConflict,
  loadLockerSyncConflicts,
  maybeQueueMetadataConflict,
} from './lockerSyncConflicts';

export type { PlaylistSyncMergeStats, PlaylistTombstone } from './playlistStorage';
import type { MediaEnvelope } from './sandboxLayer1';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import { getTier34BaseUrl } from './tier34/client';
import { fetchWithTimeout } from './fetchWithTimeout';
import {
  dispatchLockerSyncIdle,
  dispatchLockerSyncProgress,
  dispatchLockerSyncStarted,
} from './lockerSyncProgress';

export type LockerSyncMode = 'off' | 'metadata-only' | 'full';

/** Where uploaded locker blobs and manifests are stored. */
export type LockerSyncProvider = 'none' | 'webdav' | 's3' | 'tier34';

export type LockerSyncSettings = {
  enabled: boolean;
  mode: LockerSyncMode;
  provider: LockerSyncProvider;
  /** Base URL for self-hosted Tier 3/4 locker endpoints or WebDAV root. */
  remoteBaseUrl: string;
  /** Last successful manifest pull/push (epoch ms). */
  lastSyncedAt: number | null;
  /** Outcome of the most recent sync attempt (null = never recorded). */
  lastSyncOk: boolean | null;
  /** Failure detail when lastSyncOk is false. */
  lastSyncError: string | null;
  /** When true, blob pulls only run on Wi-Fi (or when network type is unknown). */
  wifiOnly: boolean;
  /** When true, only albums flagged in syncAlbums are pulled from remote. */
  selectiveSync: boolean;
  /** Periodic pull on focus/interval (default on when sync enabled). */
  backgroundSync: boolean;
};

export const LOCKER_SYNC_SETTINGS_KEY = 'sandbox_locker_sync_settings';
export const LOCKER_SYNC_ALBUMS_KEY = 'sandbox_locker_sync_albums';

const DEFAULT_SETTINGS: LockerSyncSettings = {
  enabled: false,
  mode: 'off',
  provider: 'none',
  remoteBaseUrl: '',
  lastSyncedAt: null,
  lastSyncOk: null,
  lastSyncError: null,
  wifiOnly: true,
  selectiveSync: false,
  backgroundSync: true,
};

/** Serializable manifest row — metadata sync (Phase 1). */
export type LockerSyncManifestEntry = {
  id: string;
  contentHash: string;
  title: string;
  artist: string;
  albumName?: string;
  durationSeconds: number;
  addedAt: number;
  remoteBlobUrl?: string;
  coverHash?: string;
  releaseYear?: string;
  creditsJson?: string;
  acoustidId?: string;
  musicbrainzRecordingId?: string;
  musicbrainzReleaseId?: string;
  /** When true, auto-repair must not overwrite title/artist/album on pull. */
  userMetadataLocked?: boolean;
  version: number;
};

export type LockerSyncManifestPlaylist = {
  id: string;
  name: string;
  description?: string;
  trackEnvelopeIds: string[];
  updatedAt: number;
};

export type LockerSyncManifest = {
  deviceId: string;
  updatedAt: number;
  entries: LockerSyncManifestEntry[];
  /** Album group keys opted in for selective sync (lockerAlbumGroupKey). */
  syncAlbums?: string[];
  /** Playlist sync — exported on push for cross-device restore. */
  playlists?: LockerSyncManifestPlaylist[];
  /** Deleted playlist ids propagate across devices (deletedAt epoch ms). */
  playlistTombstones?: PlaylistTombstone[];
  /** Deleted locker track ids propagate across devices (deletedAt epoch ms). */
  trackTombstones?: TrackTombstone[];
};

const DEVICE_ID_KEY = 'sandbox_locker_sync_device_id';
const IMPORTED_MANIFEST_KEY = 'sandbox_locker_imported_manifest';

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashBlob(blob: Blob): Promise<string> {
  return sha256Hex(await blob.arrayBuffer());
}

export function loadLockerSyncSettings(): LockerSyncSettings {
  try {
    const raw = prefsGetItem(LOCKER_SYNC_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<LockerSyncSettings>;
    return {
      enabled: Boolean(parsed.enabled),
      mode: parsed.mode === 'metadata-only' || parsed.mode === 'full' ? parsed.mode : 'off',
      provider:
        parsed.provider === 'webdav' ||
        parsed.provider === 's3' ||
        parsed.provider === 'tier34'
          ? parsed.provider
          : 'none',
      remoteBaseUrl: typeof parsed.remoteBaseUrl === 'string' ? parsed.remoteBaseUrl : '',
      lastSyncedAt:
        typeof parsed.lastSyncedAt === 'number' && Number.isFinite(parsed.lastSyncedAt)
          ? parsed.lastSyncedAt
          : null,
      lastSyncOk:
        typeof parsed.lastSyncOk === 'boolean'
          ? parsed.lastSyncOk
          : null,
      lastSyncError:
        typeof parsed.lastSyncError === 'string' && parsed.lastSyncError.trim()
          ? parsed.lastSyncError.trim()
          : null,
      wifiOnly: parsed.wifiOnly !== false,
      selectiveSync: Boolean(parsed.selectiveSync),
      backgroundSync: parsed.backgroundSync !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function recordLockerSyncResult(ok: boolean, error?: string): LockerSyncSettings {
  const current = loadLockerSyncSettings();
  return saveLockerSyncSettings({
    lastSyncOk: ok,
    lastSyncError: ok ? null : (error?.trim() || 'Sync failed'),
    lastSyncedAt: ok ? Date.now() : current.lastSyncedAt,
  });
}

export function saveLockerSyncSettings(patch: Partial<LockerSyncSettings>): LockerSyncSettings {
  const next = { ...loadLockerSyncSettings(), ...patch };
  if (!next.enabled) {
    next.mode = 'off';
  } else if (next.mode === 'off') {
    next.mode = 'metadata-only';
  }
  if (!next.enabled && next.provider === 'none') {
    next.remoteBaseUrl = '';
  }
  prefsSetItem(LOCKER_SYNC_SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event('sandbox-settings-change'));
  return next;
}

export function loadSyncAlbumFlags(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LOCKER_SYNC_ALBUMS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSyncAlbumFlag(albumKey: string, enabled: boolean): Record<string, boolean> {
  const flags = loadSyncAlbumFlags();
  if (enabled) flags[albumKey] = true;
  else delete flags[albumKey];
  localStorage.setItem(LOCKER_SYNC_ALBUMS_KEY, JSON.stringify(flags));
  window.dispatchEvent(new Event('sandbox-settings-change'));
  return flags;
}

export function isAlbumSyncEnabled(albumKey: string): boolean {
  return Boolean(loadSyncAlbumFlags()[albumKey]);
}

/** Best-effort Wi-Fi / unmetered check (honors setting when API unavailable). */
export function isNetworkAllowedForSync(settings?: LockerSyncSettings): boolean {
  const s = settings ?? loadLockerSyncSettings();
  if (!s.wifiOnly) return true;

  const nav = navigator as Navigator & {
    connection?: { type?: string; effectiveType?: string; saveData?: boolean };
    mozConnection?: { type?: string; effectiveType?: string; saveData?: boolean };
    webkitConnection?: { type?: string; effectiveType?: string; saveData?: boolean };
  };
  const conn = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  if (!conn) return true;

  if (conn.saveData) return false;
  const type = (conn.type ?? '').toLowerCase();
  if (type === 'wifi' || type === 'ethernet' || type === 'none') return true;
  if (type === 'cellular' || type === 'wimax') return false;
  return true;
}

export function playlistsForManifest(): LockerSyncManifestPlaylist[] {
  const tombIds = new Set(loadPlaylistTombstones().map((t) => t.id));
  return loadPlaylists()
    .filter((pl) => !tombIds.has(pl.id))
    // Smart playlists are local-only (computed from locker + play history per device).
    .filter((pl) => !isSmartPlaylist(pl))
    .map((pl: StoredPlaylist) => ({
      id: pl.id,
      name: pl.name,
      description: pl.description,
      trackEnvelopeIds: dedupeEnvelopeIds(pl.tracks.map((t) => t.envelopeId)),
      updatedAt: pl.updatedAt ?? Date.now(),
    }));
}

function dedupeEnvelopeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export type LockerSyncResult = {
  pulled: number;
  skipped: number;
  deleted: number;
} & PlaylistSyncMergeStats;

const EMPTY_PLAYLIST_STATS: PlaylistSyncMergeStats = {
  playlistsImported: 0,
  playlistsMerged: 0,
  playlistsDeleted: 0,
  conflictsResolved: 0,
};

const EMPTY_SYNC_RESULT: LockerSyncResult = {
  pulled: 0,
  skipped: 0,
  deleted: 0,
  ...EMPTY_PLAYLIST_STATS,
};

export const LOCKER_SYNC_COMPLETE_EVENT = 'sandbox-locker-sync-complete';

let playlistPushTimer: ReturnType<typeof setTimeout> | null = null;
let trackPushTimer: ReturnType<typeof setTimeout> | null = null;
let playlistPushListenerRegistered = false;
let trackPushListenerRegistered = false;

/** Debounced manifest push after local playlist mutations (offline-safe). */
export function initPlaylistSyncPushListener(): void {
  if (playlistPushListenerRegistered || typeof window === 'undefined') return;
  playlistPushListenerRegistered = true;
  window.addEventListener(PLAYLISTS_SYNC_DIRTY_EVENT, () => {
    scheduleManifestPushDebounced();
  });
}

/** Debounced manifest push after locker track deletes. */
export function initTrackTombstonePushListener(): void {
  if (trackPushListenerRegistered || typeof window === 'undefined') return;
  trackPushListenerRegistered = true;
  window.addEventListener(TRACKS_SYNC_DIRTY_EVENT, () => {
    scheduleManifestPushDebounced();
  });
}

function scheduleManifestPushDebounced(): void {
  if (playlistPushTimer) clearTimeout(playlistPushTimer);
  playlistPushTimer = setTimeout(() => {
    void pushFullManifestIfEnabled().catch((err) => {
      console.warn('[lockerSync] manifest push skipped:', err);
    });
  }, 1500);
}

function dispatchSyncComplete(
  stats: PlaylistSyncMergeStats & { pulled?: number; skipped?: number; deleted?: number },
): void {
  window.dispatchEvent(
    new CustomEvent(LOCKER_SYNC_COMPLETE_EVENT, { detail: stats }),
  );
}

export function formatPlaylistSyncStats(stats: PlaylistSyncMergeStats): string {
  const parts: string[] = [];
  if (stats.playlistsImported > 0) parts.push(`${stats.playlistsImported} imported`);
  if (stats.playlistsMerged > 0) parts.push(`${stats.playlistsMerged} merged`);
  if (stats.playlistsDeleted > 0) parts.push(`${stats.playlistsDeleted} deleted`);
  if (stats.conflictsResolved > 0) parts.push(`${stats.conflictsResolved} conflicts resolved`);
  return parts.length ? `Playlists: ${parts.join(', ')}.` : '';
}

function mergeLocalPlaylistsIntoManifest(base: LockerSyncManifest): LockerSyncManifest {
  const localRows = playlistsForManifest();
  const localTombstones = loadPlaylistTombstones();
  const byId = new Map((base.playlists ?? []).map((pl) => [pl.id, pl]));

  for (const local of localRows) {
    const existing = byId.get(local.id);
    if (!existing) {
      byId.set(local.id, local);
      continue;
    }
    const seen = new Set<string>();
    const trackEnvelopeIds: string[] = [];
    for (const id of [...existing.trackEnvelopeIds, ...local.trackEnvelopeIds]) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      trackEnvelopeIds.push(id);
    }
    const existingTs = existing.updatedAt ?? 0;
    const localTs = local.updatedAt ?? 0;
    const useLocalMeta = localTs >= existingTs;
    byId.set(local.id, {
      id: local.id,
      name: useLocalMeta ? local.name : existing.name,
      description: useLocalMeta
        ? local.description ?? existing.description
        : existing.description ?? local.description,
      trackEnvelopeIds,
      updatedAt: Math.max(existingTs, localTs),
    });
  }

  const tombById = new Map<string, number>();
  for (const t of [...(base.playlistTombstones ?? []), ...localTombstones]) {
    if (!t?.id) continue;
    tombById.set(t.id, Math.max(tombById.get(t.id) ?? 0, t.deletedAt ?? 0));
  }
  for (const [id, deletedAt] of tombById) {
    const pl = byId.get(id);
    if (pl && deletedAt >= (pl.updatedAt ?? 0)) byId.delete(id);
  }

  return {
    ...base,
    deviceId: getDeviceId(),
    updatedAt: Date.now(),
    syncAlbums: syncAlbumKeysFromFlags(),
    playlists: [...byId.values()],
    playlistTombstones: [...tombById.entries()].map(([id, deletedAt]) => ({ id, deletedAt })),
    trackTombstones: loadTrackTombstones(),
  };
}

async function pushFullManifestIfEnabled(): Promise<void> {
  const settings = loadLockerSyncSettings();
  if (!settings.enabled) return;
  if (!isNetworkAllowedForSync(settings)) return;

  const manifest = await buildLockerSyncManifest();

  if (settings.provider === 'tier34') {
    await pushManifestToTier34(manifest);
    return;
  }

  if (settings.provider === 'webdav' && settings.remoteBaseUrl.trim()) {
    await pushManifestToWebdav(manifest, settings.remoteBaseUrl);
  }
}

export async function pushPlaylistsManifestIfEnabled(): Promise<void> {
  await pushFullManifestIfEnabled();
}

/**
 * Remote tombstones are recorded for manifest export only.
 * HARD RULE: never auto-delete local locker audio from sync — user must delete explicitly.
 */
export async function applyTrackTombstonesFromManifest(
  tombstones: TrackTombstone[] | undefined,
): Promise<number> {
  if (!tombstones?.length) return 0;
  console.info(
    '[locker] applyTrackTombstonesFromManifest skipped — never auto-delete locker rows',
    { tombstoneCount: tombstones.length },
  );
  return 0;
}

export async function resolveLockerMetadataConflict(
  trackId: string,
  choice: 'local' | 'remote',
): Promise<void> {
  const conflicts = loadLockerSyncConflicts();
  const conflict = conflicts.find((c) => c.trackId === trackId);
  if (!conflict) return;

  if (choice === 'remote') {
    await updateLockerEntryMetadata(trackId, {
      title: conflict.remoteRow.title,
      artist: conflict.remoteRow.artist,
      albumName: conflict.remoteRow.albumName,
      durationSeconds: conflict.remoteRow.durationSeconds,
      releaseYear: conflict.remoteRow.releaseYear,
    });
  } else {
    const local = (await getLockerEntries()).find((e) => e.id === trackId);
    if (local) {
      await pushFullManifestIfEnabled();
    }
  }

  clearLockerSyncConflict(trackId);
}

function lockerEntryToEnvelope(entry: LockerEntry): MediaEnvelope {
  return {
    envelopeId: `local-${entry.id}`,
    title: entry.title,
    artist: entry.artist,
    album: entry.albumName,
    url: entry.url,
    durationSeconds: entry.durationSeconds || 210,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: entry.id,
    artworkUrl: entry.albumArt,
    releaseYear: entry.releaseYear,
  };
}

function buildEnvelopeResolver(entries: LockerEntry[]): (envelopeId: string) => MediaEnvelope | null {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return (envelopeId: string) => {
    const lockerId = envelopeId.startsWith('local-') ? envelopeId.slice(6) : envelopeId;
    const entry = byId.get(lockerId);
    if (!entry?.url) return null;
    return lockerEntryToEnvelope(entry);
  };
}

export type LockerBlobPullResult = LockerSyncResult;

async function canPullBlobBytes(bytes: number): Promise<boolean> {
  const limit = capacityLimitBytes();
  if (limit === null) return true;
  const { bytes: used } = await getLockerStorageUsage();
  return used + bytes <= limit;
}

/** Phase 1 MVP is functional — export/import manifest JSON. */
export function isLockerSyncAvailable(): boolean {
  return true;
}

function syncAlbumKeysFromFlags(): string[] {
  return Object.entries(loadSyncAlbumFlags())
    .filter(([, on]) => on)
    .map(([key]) => key);
}

export async function buildLockerSyncManifest(): Promise<LockerSyncManifest> {
  const entries = await getLockerEntries();
  const tombIds = new Set(loadTrackTombstones().map((t) => t.id));
  const manifestEntries: LockerSyncManifestEntry[] = [];

  for (const e of entries) {
    if (tombIds.has(e.id)) continue;
    let contentHash = '';
    try {
      const res = await fetchWithTimeout(e.url, undefined, 120_000);
      if (res.ok) {
        contentHash = await sha256Hex(await res.arrayBuffer());
      }
    } catch {
      contentHash = `meta-${e.id}`;
    }
    manifestEntries.push({
      id: e.id,
      contentHash,
      title: e.title,
      artist: e.artist,
      albumName: e.albumName,
      durationSeconds: e.durationSeconds,
      addedAt: e.addedAt,
      releaseYear: e.releaseYear,
      userMetadataLocked: e.userMetadataLocked === true ? true : undefined,
      version: 1,
    });
  }

  return {
    deviceId: getDeviceId(),
    updatedAt: Date.now(),
    entries: manifestEntries,
    syncAlbums: syncAlbumKeysFromFlags(),
    playlists: playlistsForManifest(),
    playlistTombstones: loadPlaylistTombstones(),
    trackTombstones: loadTrackTombstones(),
  };
}

export function downloadManifestJson(manifest: LockerSyncManifest, filename?: string): void {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `sovereign-locker-manifest-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportLockerManifest(): Promise<LockerSyncManifest> {
  const manifest = await buildLockerSyncManifest();
  downloadManifestJson(manifest);
  recordLockerSyncResult(true);
  return manifest;
}

export function loadImportedManifest(): LockerSyncManifest | null {
  try {
    const raw = localStorage.getItem(IMPORTED_MANIFEST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LockerSyncManifest;
  } catch {
    return null;
  }
}

/** Import metadata rows — merges by id (last-write-wins on addedAt). Does not copy audio blobs. */
export async function importLockerManifest(
  manifest: LockerSyncManifest,
): Promise<{ imported: number; skipped: number; updated: number; deleted: number } & PlaylistSyncMergeStats> {
  let imported = 0;
  let skipped = 0;
  let updated = 0;
  let conflictsQueued = 0;

  const deleted = await applyTrackTombstonesFromManifest(manifest.trackTombstones);
  const localAfterDeletes = await getLockerEntries();
  const localById = new Map(localAfterDeletes.map((e) => [e.id, e]));

  for (const row of manifest.entries) {
    const tomb = manifest.trackTombstones?.find((t) => t.id === row.id);
    if (tomb && tomb.deletedAt >= (row.addedAt ?? 0)) {
      skipped += 1;
      continue;
    }
    const existing = localById.get(row.id);
    if (existing) {
      if (existing.addedAt >= row.addedAt) {
        skipped += 1;
        continue;
      }
      if (maybeQueueMetadataConflict(existing, row)) {
        conflictsQueued += 1;
        skipped += 1;
        continue;
      }
      await updateLockerEntryMetadata(row.id, {
        title: row.title,
        artist: row.artist,
        albumName: row.albumName,
        durationSeconds: row.durationSeconds,
        releaseYear: row.releaseYear,
        userMetadataLocked: row.userMetadataLocked,
      });
      updated += 1;
      continue;
    }
    imported += 1;
  }

  localStorage.setItem(IMPORTED_MANIFEST_KEY, JSON.stringify(manifest));

  const freshEntries = await getLockerEntries();
  const playlistStats =
    manifest.playlists?.length || manifest.playlistTombstones?.length
      ? mergePlaylistsFromManifest(
          manifest.playlists ?? [],
          buildEnvelopeResolver(freshEntries),
          manifest.playlistTombstones ?? [],
        )
      : { ...EMPTY_PLAYLIST_STATS };

  if (conflictsQueued > 0) {
    playlistStats.conflictsResolved = conflictsQueued;
  }

  recordLockerSyncResult(true);
  dispatchSyncComplete({ pulled: 0, skipped, deleted, ...playlistStats });
  return { imported, skipped, updated, deleted, ...playlistStats };
}

export function parseManifestFile(file: File): Promise<LockerSyncManifest> {
  return file.text().then((text) => {
    let parsed: LockerSyncManifest;
    try {
      parsed = JSON.parse(text) as LockerSyncManifest;
    } catch {
      throw new Error('Invalid manifest JSON — could not parse file.');
    }
    if (!parsed || !Array.isArray(parsed.entries)) {
      throw new Error('Invalid manifest — expected { entries: [...] }');
    }
    return parsed;
  });
}

function webdavAuthHeaders(baseUrl: string): Record<string, string> {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.username || parsed.password) {
      const token = btoa(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`);
      return { Authorization: `Basic ${token}` };
    }
  } catch {
    /* ignore */
  }
  return {};
}

function webdavFetchUrl(baseUrl: string, path: string): string {
  try {
    const parsed = new URL(baseUrl);
    parsed.username = '';
    parsed.password = '';
    parsed.pathname = parsed.pathname.replace(/\/$/, '') + path;
    return parsed.toString();
  } catch {
    return `${baseUrl.replace(/\/$/, '')}${path}`;
  }
}

/** Best-effort WebDAV push (basic auth via URL credentials). */
export async function pushManifestToWebdav(
  manifest: LockerSyncManifest,
  baseUrl: string,
): Promise<void> {
  const url = webdavFetchUrl(baseUrl, '/sovereign-locker/manifest.json');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...webdavAuthHeaders(baseUrl) },
    body: JSON.stringify(manifest, null, 2),
  });
  if (!res.ok) throw new Error(`WebDAV push failed: HTTP ${res.status}`);
  saveLockerSyncSettings({ lastSyncedAt: Date.now() });
}

/** WebDAV blob PUT — mirrors tier34 /api/locker/blob/{hash}. S3 deferred to future provider. */
export async function pushBlobToWebdav(
  hash: string,
  blob: Blob,
  baseUrl: string,
): Promise<void> {
  const url = webdavFetchUrl(baseUrl, `/sovereign-locker/blobs/${hash}`);
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      ...webdavAuthHeaders(baseUrl),
    },
    body: blob,
  });
  if (!res.ok) throw new Error(`WebDAV blob push failed: HTTP ${res.status}`);
}

/** WebDAV blob GET with hash verification. */
export async function pullBlobFromWebdav(hash: string, baseUrl: string): Promise<Blob> {
  const url = webdavFetchUrl(baseUrl, `/sovereign-locker/blobs/${hash}`);
  const res = await fetch(url, { headers: webdavAuthHeaders(baseUrl) });
  if (!res.ok) throw new Error(`WebDAV blob pull failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const computed = await hashBlob(blob);
  if (computed !== hash.toLowerCase()) {
    throw new Error('WebDAV blob hash mismatch — discarding');
  }
  return blob;
}

/** Best-effort WebDAV pull. */
export async function pullManifestFromWebdav(baseUrl: string): Promise<LockerSyncManifest> {
  const url = webdavFetchUrl(baseUrl, '/sovereign-locker/manifest.json');
  const res = await fetch(url, { headers: webdavAuthHeaders(baseUrl) });
  if (!res.ok) throw new Error(`WebDAV pull failed: HTTP ${res.status}`);
  const manifest = (await res.json()) as LockerSyncManifest;
  if (!manifest?.entries) throw new Error('Invalid manifest from WebDAV');
  return manifest;
}

/** Merge manifest metadata into a display-friendly locker entry list for UI hints. */
export function manifestToLockerHints(manifest: LockerSyncManifest): LockerEntry[] {
  return manifest.entries.map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    genre: 'Synced metadata',
    durationSeconds: row.durationSeconds,
    url: '',
    addedAt: row.addedAt,
    albumName: row.albumName,
    releaseYear: row.releaseYear,
  }));
}

function tier34LockerBaseUrl(settings?: LockerSyncSettings): string {
  const s = settings ?? loadLockerSyncSettings();
  if (s.remoteBaseUrl.trim()) return s.remoteBaseUrl.replace(/\/$/, '');
  return getTier34BaseUrl().replace(/\/$/, '');
}

export function isTier34LockerSyncActive(settings?: LockerSyncSettings): boolean {
  const s = settings ?? loadLockerSyncSettings();
  return s.enabled && s.mode === 'full' && s.provider === 'tier34';
}

export async function pullManifestFromTier34(baseUrl?: string): Promise<LockerSyncManifest> {
  const root = (baseUrl ?? tier34LockerBaseUrl()).replace(/\/$/, '');
  const res = await fetch(`${root}/api/locker/manifest`);
  if (!res.ok) throw new Error(`Tier34 manifest pull failed: HTTP ${res.status}`);
  const manifest = (await res.json()) as LockerSyncManifest;
  if (!manifest?.entries) throw new Error('Invalid manifest from Tier34');
  return manifest;
}

export async function pushManifestToTier34(
  manifest: LockerSyncManifest,
  baseUrl?: string,
): Promise<LockerSyncManifest> {
  const root = (baseUrl ?? tier34LockerBaseUrl()).replace(/\/$/, '');
  const res = await fetch(`${root}/api/locker/manifest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  if (!res.ok) throw new Error(`Tier34 manifest push failed: HTTP ${res.status}`);
  recordLockerSyncResult(true);
  return (await res.json()) as LockerSyncManifest;
}

export async function pushBlobToTier34(
  hash: string,
  blob: Blob,
  baseUrl?: string,
): Promise<void> {
  const root = (baseUrl ?? tier34LockerBaseUrl()).replace(/\/$/, '');
  const res = await fetch(`${root}/api/locker/blob/${hash}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Tier34 blob push failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
  }
}

export async function pullBlobFromTier34(hash: string, baseUrl?: string): Promise<Blob> {
  const root = (baseUrl ?? tier34LockerBaseUrl()).replace(/\/$/, '');
  const res = await fetch(`${root}/api/locker/blob/${hash}`);
  if (!res.ok) throw new Error(`Tier34 blob pull failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const computed = await hashBlob(blob);
  if (computed !== hash.toLowerCase()) {
    throw new Error('Downloaded blob hash mismatch — discarding');
  }
  return blob;
}

async function localHasContentHash(hash: string, entries: LockerEntry[]): Promise<boolean> {
  if (!hash || hash.startsWith('meta-')) return false;
  for (const e of entries) {
    try {
      const res = await fetchWithTimeout(e.url, undefined, 120_000);
      if (!res.ok) continue;
      const got = await sha256Hex(await res.arrayBuffer());
      if (got === hash) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/** Import one manifest row + verified audio blob into IndexedDB. */
export async function importManifestEntryWithBlob(
  row: LockerSyncManifestEntry,
  blob: Blob,
): Promise<LockerEntry | null> {
  const computed = await hashBlob(blob);
  if (row.contentHash && !row.contentHash.startsWith('meta-') && row.contentHash !== computed) {
    throw new Error(`Hash mismatch for "${row.title}"`);
  }

  const local = await getLockerEntries();
  const replaceEntryId = await resolveLockerReacquireTargetId(
    row.title,
    row.artist,
    row.albumName,
  );

  if (local.some((e) => e.id === row.id)) {
    if (replaceEntryId === row.id || !(await lockerEntryIsPlayable(row.id))) {
      const ext = blob.type.includes('flac')
        ? 'flac'
        : blob.type.includes('ogg')
          ? 'ogg'
          : blob.type.includes('wav')
            ? 'wav'
            : 'mp3';
      const file = new File([blob], `${row.title}.${ext}`, {
        type: blob.type || 'audio/mpeg',
      });
      const saved = await saveLockerBlob(file, {
        title: row.title,
        artist: row.artist,
        albumName: row.albumName,
        releaseYear: row.releaseYear,
        durationSeconds: row.durationSeconds,
        genre: 'Synced',
        skipRemoteSync: true,
        replaceEntryId: row.id,
      });
      if (row.creditsJson?.trim()) {
        await updateLockerEntryMetadata(saved.id, { creditsJson: row.creditsJson });
      }
      await refreshLockerCache();
      return saved;
    }
    return null;
  }
  if (await localHasContentHash(computed, local)) return null;

  const ext = blob.type.includes('flac')
    ? 'flac'
    : blob.type.includes('ogg')
      ? 'ogg'
      : blob.type.includes('wav')
        ? 'wav'
        : 'mp3';
  const file = new File([blob], `${row.title}.${ext}`, {
    type: blob.type || 'audio/mpeg',
  });

  const saved = await saveLockerBlob(file, {
    title: row.title,
    artist: row.artist,
    albumName: row.albumName,
    releaseYear: row.releaseYear,
    durationSeconds: row.durationSeconds,
    genre: 'Synced',
    skipRemoteSync: true,
    replaceEntryId,
  });

  if (row.creditsJson?.trim()) {
    await updateLockerEntryMetadata(saved.id, { creditsJson: row.creditsJson });
  }

  if (row.coverHash && row.albumName) {
    try {
      const coverBlob = await pullBlobFromTier34(row.coverHash);
      await persistAlbumCoverBlobForGroup(
        row.albumName,
        row.artist,
        new File([coverBlob], 'cover.jpg', { type: coverBlob.type || 'image/jpeg' }),
      );
    } catch {
      /* cover optional */
    }
  }

  await refreshLockerCache();
  return saved;
}

/** Push one locker entry + blob to Tier34 when full sync is enabled. */
export async function maybePushLockerEntryToRemote(
  entry: LockerEntry,
  blob: Blob,
): Promise<void> {
  if (!isTier34LockerSyncActive()) return;
  try {
    const contentHash = await hashBlob(blob);
    await pushBlobToTier34(contentHash, blob);
    const row: LockerSyncManifestEntry = {
      id: entry.id,
      contentHash,
      title: entry.title,
      artist: entry.artist,
      albumName: entry.albumName,
      durationSeconds: entry.durationSeconds,
      addedAt: entry.addedAt,
      remoteBlobUrl: `/api/locker/blob/${contentHash}`,
      releaseYear: entry.releaseYear,
      version: 1,
    };
    await pushManifestToTier34({
      deviceId: getDeviceId(),
      updatedAt: Date.now(),
      entries: [row],
      syncAlbums: syncAlbumKeysFromFlags(),
      playlists: playlistsForManifest(),
      playlistTombstones: loadPlaylistTombstones(),
      trackTombstones: loadTrackTombstones(),
    });
  } catch (err) {
    console.warn('[lockerSync] tier34 push failed:', err);
  }
}

/** Pull manifest + missing audio blobs from Tier34 or WebDAV into IndexedDB. */
export async function pullMissingLockerBlobsFromRemote(): Promise<LockerBlobPullResult> {
  const settings = loadLockerSyncSettings();
  if (!settings.enabled || settings.mode !== 'full') {
    return { ...EMPTY_SYNC_RESULT };
  }
  if (settings.provider !== 'tier34' && !settings.remoteBaseUrl.trim()) {
    return { ...EMPTY_SYNC_RESULT };
  }
  if (!isNetworkAllowedForSync(settings)) {
    console.warn('[lockerSync] pull skipped — Wi-Fi only and not on Wi-Fi');
    return { ...EMPTY_SYNC_RESULT };
  }

  dispatchLockerSyncStarted('Syncing locker…');
  dispatchLockerSyncProgress({ phase: 'manifest', current: 0, total: 0, label: 'Fetching manifest…' });

  let pulled = 0;
  let skipped = 0;
  let deleted = 0;
  let playlistStats: PlaylistSyncMergeStats = { ...EMPTY_PLAYLIST_STATS };

  const pullBlobFn =
    settings.provider === 'webdav'
      ? (hash: string) => pullBlobFromWebdav(hash, settings.remoteBaseUrl)
      : (hash: string) => pullBlobFromTier34(hash);

  const allowedAlbumKeys = new Set(
    settings.selectiveSync ? syncAlbumKeysFromFlags() : [],
  );

  function rowAllowed(row: LockerSyncManifestEntry): boolean {
    if (!settings.selectiveSync) return true;
    if (allowedAlbumKeys.size === 0) return false;
    const pseudo: LockerEntry = {
      id: row.id,
      title: row.title,
      artist: row.artist,
      genre: '',
      durationSeconds: row.durationSeconds,
      url: '',
      addedAt: row.addedAt,
      albumName: row.albumName,
    };
    return allowedAlbumKeys.has(lockerAlbumGroupKey(pseudo));
  }

  try {
    const manifest =
      settings.provider === 'webdav'
        ? await pullManifestFromWebdav(settings.remoteBaseUrl)
        : await pullManifestFromTier34();
    deleted = await applyTrackTombstonesFromManifest(manifest.trackTombstones);
    const local = await getLockerEntries();
    const localIds = new Set(local.map((e) => e.id));
    const tombIds = new Set((manifest.trackTombstones ?? []).map((t) => t.id));

    const pendingRows: typeof manifest.entries = [];
    for (const row of manifest.entries) {
      if (tombIds.has(row.id)) continue;
      if (!rowAllowed(row)) continue;
      if (!row.contentHash || row.contentHash.startsWith('meta-')) continue;
      if (localIds.has(row.id)) continue;
      if (await localHasContentHash(row.contentHash, local)) continue;
      pendingRows.push(row);
    }

    dispatchLockerSyncProgress({
      phase: 'blobs',
      current: 0,
      total: pendingRows.length,
      label: pendingRows.length > 0 ? 'Downloading tracks…' : 'Up to date',
    });

    let blobDone = 0;

    for (let i = 0; i < manifest.entries.length; i += 1) {
      const row = manifest.entries[i];
      if (tombIds.has(row.id)) {
        skipped += 1;
        continue;
      }
      if (!rowAllowed(row)) {
        skipped += 1;
        continue;
      }
      if (!row.contentHash || row.contentHash.startsWith('meta-')) {
        skipped += 1;
        continue;
      }
      if (localIds.has(row.id)) {
        skipped += 1;
        continue;
      }
      if (await localHasContentHash(row.contentHash, local)) {
        skipped += 1;
        continue;
      }
      try {
        const blob = await pullBlobFn(row.contentHash);
        if (!(await canPullBlobBytes(blob.size))) {
          console.warn('[lockerSync] capacity limit — skipping', row.title);
          skipped += 1;
          continue;
        }
        const saved = await importManifestEntryWithBlob(row, blob);
        if (saved) pulled += 1;
        else skipped += 1;
        if (pendingRows.some((p) => p.id === row.id)) {
          blobDone += 1;
          dispatchLockerSyncProgress({
            phase: 'blobs',
            current: blobDone,
            total: pendingRows.length,
            label: row.title,
          });
        }
      } catch (err) {
        console.warn('[lockerSync] pull blob failed:', row.title, err);
        skipped += 1;
      }
    }

    const freshEntries = await getLockerEntries();
    if (manifest.playlists?.length || manifest.playlistTombstones?.length) {
      playlistStats = mergePlaylistsFromManifest(
        manifest.playlists ?? [],
        buildEnvelopeResolver(freshEntries),
        manifest.playlistTombstones ?? [],
      );
    }

    recordLockerSyncResult(true);
    dispatchSyncComplete({ pulled, skipped, deleted, ...playlistStats });
    dispatchLockerSyncIdle();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordLockerSyncResult(false, msg);
    dispatchLockerSyncIdle();
    console.warn('[lockerSync] tier34 pull failed:', err);
  }

  return { pulled, skipped, deleted, ...playlistStats };
}

/** Pull manifest (metadata + playlists) and merge locally — works in metadata-only or full mode. */
export async function pullAndMergeLockerManifest(): Promise<LockerSyncResult> {
  const settings = loadLockerSyncSettings();
  if (!settings.enabled) {
    return { ...EMPTY_SYNC_RESULT };
  }
  if (settings.mode === 'full') {
    return pullMissingLockerBlobsFromRemote();
  }

  if (settings.provider === 'webdav' && !settings.remoteBaseUrl.trim()) {
    return { ...EMPTY_SYNC_RESULT };
  }
  if (!isNetworkAllowedForSync(settings)) {
    console.warn('[lockerSync] manifest pull skipped — Wi-Fi only and not on Wi-Fi');
    return { ...EMPTY_SYNC_RESULT };
  }

  try {
    const manifest =
      settings.provider === 'webdav'
        ? await pullManifestFromWebdav(settings.remoteBaseUrl)
        : settings.provider === 'tier34'
          ? await pullManifestFromTier34()
          : null;
    if (!manifest) return { ...EMPTY_SYNC_RESULT };

    const trackResult = await importLockerManifest(manifest);
    return {
      pulled: 0,
      skipped: trackResult.skipped,
      deleted: trackResult.deleted,
      playlistsImported: trackResult.playlistsImported,
      playlistsMerged: trackResult.playlistsMerged,
      playlistsDeleted: trackResult.playlistsDeleted,
      conflictsResolved: trackResult.conflictsResolved,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordLockerSyncResult(false, msg);
    console.warn('[lockerSync] manifest pull failed:', err);
    return { ...EMPTY_SYNC_RESULT };
  }
}
