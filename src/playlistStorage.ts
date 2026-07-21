import type { MediaEnvelope } from './sandboxLayer1';
import type { LockerEntry } from './lockerStorage';
import type { StoredPlayHit } from './playHistory';
import { getSmartPlaylistPlayHistory } from './playHistory';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import {
  applyBuiltInParam,
  coreBuiltInPlaylistId,
  CORE_BUILTIN_SMART_PLAYLIST_IDS,
  evaluateSmartPlaylistTracks,
  getBuiltInPreset,
  type BuiltInSmartPlaylistId,
  type SmartPlaylistRules,
} from './smartPlaylistEngine';
import {
  buildImportPlaylistDescription,
  clearPlaylistPendingImport,
  displayPlaylistName,
  inferImportPlatformFromDescription,
  isBareImportDescription,
  isImportedShellWithoutTracks,
  isLegacyShellDescription,
  type ImportPlatformId,
  type ImportedTrackStub,
} from './importPlatforms';

export type PlaylistType = 'manual' | 'smart';

export interface StoredPlaylist {
  id: string;
  name: string;
  description: string;
  tracks: MediaEnvelope[];
  /** manual = user-curated; smart = dynamically generated from rules. */
  type?: PlaylistType;
  /** Smart playlist rule set (source of truth for smart playlists). */
  rules?: SmartPlaylistRules;
  /** Built-in smart preset id when created from a template. */
  builtInId?: BuiltInSmartPlaylistId;
  /** Param for by-genre / by-artist / by-year built-ins. */
  builtInParam?: string;
  /** Epoch ms — used for cross-device metadata conflict resolution. */
  updatedAt?: number;
  /** Canonical share URL for external-import shells. */
  sourceUrl?: string;
  importPlatformId?: ImportPlatformId;
  pendingImport?: boolean;
  /** Track titles from external import (no audio). */
  importTrackStubs?: ImportedTrackStub[];
  /** Cover art from external import metadata. */
  importCoverUrl?: string;
  /** Playlist creator/owner from external import. */
  importCreator?: string;
  /** Tidal/platform refused public track metadata. */
  importMetadataBlocked?: boolean;
  /** Optional folder for library organization. */
  folderId?: string;
  /** User-set cover (data URL or remote URL). */
  coverUrl?: string;
  /** Pin timestamp — up to MAX_PINNED_PLAYLISTS at top of library. */
  pinnedAt?: number;
  /** Live LAN share link for collaborative editing. */
  collaborativeShare?: PlaylistCollaborativeLink;
}

export type PlaylistCollaborativeLink = {
  shareId: string;
  editToken: string;
  collaborative: boolean;
  viewUrl: string;
  editUrl: string;
  lanUrl: string;
  publishedAt: number;
  lastPushedAt?: number;
  lastPulledAt?: number;
  remoteUpdatedAt?: number;
};

export const MAX_PINNED_PLAYLISTS = 3;

/** Remote manifest row — extensible for artwork, descriptions, smart playlist defs. */
export type RemotePlaylistManifestEntry = {
  id: string;
  name: string;
  description?: string;
  trackEnvelopeIds: string[];
  updatedAt: number;
};

export type PlaylistTombstone = {
  id: string;
  deletedAt: number;
};

export type PlaylistSyncMergeStats = {
  playlistsImported: number;
  playlistsMerged: number;
  playlistsDeleted: number;
  conflictsResolved: number;
};

export const PLAYLISTS_CHANGE_EVENT = 'sandbox-playlists-change';
export const PLAYLISTS_SYNC_DIRTY_EVENT = 'sandbox-playlists-sync-dirty';

const STORAGE_KEY = 'sandbox_layer4_playlists';
const TOMBSTONE_KEY = 'sandbox_layer4_playlist_tombstones';

const playlistListeners = new Set<() => void>();

function notifyPlaylistsChange(): void {
  playlistListeners.forEach((fn) => fn());
  window.dispatchEvent(new Event(PLAYLISTS_CHANGE_EVENT));
}

export function subscribePlaylists(listener: () => void): () => void {
  playlistListeners.add(listener);
  return () => playlistListeners.delete(listener);
}

export function isSmartPlaylist(pl: StoredPlaylist): boolean {
  return pl.type === 'smart' || Boolean(pl.rules || pl.builtInId);
}

function migrateStoredPlaylist(pl: StoredPlaylist): StoredPlaylist {
  let next = pl;
  if (!next.type && (next.rules || next.builtInId)) {
    next = { ...next, type: 'smart' };
  }
  if (!next.type) {
    next = { ...next, type: 'manual' };
  }
  const name = displayPlaylistName(pl);
  if (name !== pl.name) {
    next = { ...next, name };
  }
  const inferredPlatform =
    pl.importPlatformId ??
    (pl.description ? inferImportPlatformFromDescription(pl.description) : undefined);
  if (inferredPlatform && !pl.importPlatformId) {
    next = { ...next, importPlatformId: inferredPlatform };
  }
  const platformId = next.importPlatformId ?? inferredPlatform;
  if (
    platformId &&
    (isLegacyShellDescription(pl.description) || isBareImportDescription(pl.description))
  ) {
    next = {
      ...next,
      description: buildImportPlaylistDescription(platformId, {
        validated: true,
        creator: pl.importCreator,
        trackStubs: pl.importTrackStubs,
        trackCount: pl.importTrackStubs?.length,
      }),
    };
  }
  if (next === pl) return pl;
  return next;
}

export function loadPlaylists(): StoredPlaylist[] {
  try {
    // Same prefs store as taste profile / liked envelopes so thumbs-up → Liked survives.
    const raw = prefsGetItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredPlaylist[];
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed.map(migrateStoredPlaylist);
    const changed = migrated.some(
      (pl, i) =>
        pl.name !== parsed[i]?.name ||
        pl.description !== parsed[i]?.description ||
        pl.importPlatformId !== parsed[i]?.importPlatformId,
    );
    if (changed) {
      prefsSetItem(STORAGE_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    return [];
  }
}

export function loadPlaylistTombstones(): PlaylistTombstone[] {
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PlaylistTombstone[];
    return Array.isArray(parsed) ? parsed.filter((t) => t?.id) : [];
  } catch {
    return [];
  }
}

function savePlaylistTombstones(tombstones: PlaylistTombstone[]): void {
  localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstones));
}

/** Record a deleted playlist id for cross-device tombstone replication. */
export function recordPlaylistTombstone(playlistId: string): void {
  const id = playlistId.trim();
  if (!id) return;
  const now = Date.now();
  const existing = loadPlaylistTombstones();
  const byId = new Map(existing.map((t) => [t.id, t]));
  const prev = byId.get(id);
  byId.set(id, { id, deletedAt: Math.max(prev?.deletedAt ?? 0, now) });
  savePlaylistTombstones([...byId.values()]);
}

export function deletePlaylistById(playlistId: string): StoredPlaylist[] {
  const next = loadPlaylists().filter((pl) => pl.id !== playlistId);
  recordPlaylistTombstone(playlistId);
  savePlaylists(next);
  return next;
}

export function removeTracksFromPlaylist(
  playlistId: string,
  envelopeIds: string[],
): StoredPlaylist[] {
  const remove = new Set(envelopeIds.filter(Boolean));
  if (remove.size === 0) return loadPlaylists();
  const playlists = loadPlaylists();
  const next = playlists.map((pl) => {
    if (pl.id !== playlistId || isSmartPlaylist(pl)) return pl;
    const filtered = pl.tracks.filter((t) => !remove.has(t.envelopeId));
    if (filtered.length === pl.tracks.length) return pl;
    return { ...pl, tracks: filtered, updatedAt: Date.now() };
  });
  savePlaylists(next);
  return next;
}

/** After locker resolve, persist the playable sourceId/url on matching playlist rows. */
export function patchPlaylistTrackLockerRef(
  envelopeId: string,
  resolved: Pick<MediaEnvelope, 'sourceId' | 'url' | 'provider' | 'artworkUrl' | 'durationSeconds'>,
): boolean {
  if (!envelopeId?.trim() || !resolved.sourceId?.trim() || !resolved.url?.trim()) return false;
  const playlists = loadPlaylists();
  let changed = false;
  const next = playlists.map((pl) => {
    if (isSmartPlaylist(pl)) return pl;
    let plChanged = false;
    const tracks = pl.tracks.map((track) => {
      if (track.envelopeId !== envelopeId) return track;
      if (track.sourceId === resolved.sourceId && track.url === resolved.url) return track;
      plChanged = true;
      return {
        ...track,
        provider: resolved.provider ?? 'local-vault',
        sourceId: resolved.sourceId,
        url: resolved.url,
        artworkUrl: resolved.artworkUrl ?? track.artworkUrl,
        durationSeconds: resolved.durationSeconds || track.durationSeconds,
      };
    });
    if (!plChanged) return pl;
    changed = true;
    return { ...pl, tracks, updatedAt: Date.now() };
  });
  if (changed) savePlaylists(next, { skipSync: true });
  return changed;
}

export function reorderPlaylistTracks(
  playlistId: string,
  orderedEnvelopeIds: string[],
): StoredPlaylist[] {
  const playlists = loadPlaylists();
  const next = playlists.map((pl) => {
    if (pl.id !== playlistId || isSmartPlaylist(pl)) return pl;
    const byId = new Map(pl.tracks.map((t) => [t.envelopeId, t]));
    const reordered: MediaEnvelope[] = [];
    const seen = new Set<string>();
    for (const id of orderedEnvelopeIds) {
      const track = byId.get(id);
      if (!track || seen.has(id)) continue;
      seen.add(id);
      reordered.push(track);
    }
    for (const track of pl.tracks) {
      if (!seen.has(track.envelopeId)) reordered.push(track);
    }
    if (reordered.length === pl.tracks.length && reordered.every((t, i) => t.envelopeId === pl.tracks[i]?.envelopeId)) {
      return pl;
    }
    return { ...pl, tracks: reordered, updatedAt: Date.now() };
  });
  savePlaylists(next);
  return next;
}

export function updatePlaylistCover(playlistId: string, coverUrl: string | null): StoredPlaylist[] {
  const playlists = loadPlaylists();
  const next = playlists.map((pl) => {
    if (pl.id !== playlistId) return pl;
    const patch = coverUrl?.trim() ? { coverUrl: coverUrl.trim() } : { coverUrl: undefined };
    return { ...pl, ...patch, updatedAt: Date.now() };
  });
  savePlaylists(next);
  return next;
}

export function movePlaylistToFolder(playlistId: string, folderId: string | null): StoredPlaylist[] {
  const playlists = loadPlaylists();
  const next = playlists.map((pl) => {
    if (pl.id !== playlistId) return pl;
    return {
      ...pl,
      folderId: folderId?.trim() || undefined,
      updatedAt: Date.now(),
    };
  });
  savePlaylists(next);
  return next;
}

export function isPlaylistPinned(pl: StoredPlaylist): boolean {
  return typeof pl.pinnedAt === 'number' && pl.pinnedAt > 0;
}

export function getPinnedPlaylists(playlists: StoredPlaylist[]): StoredPlaylist[] {
  return playlists
    .filter(isPlaylistPinned)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
    .slice(0, MAX_PINNED_PLAYLISTS);
}

export function pinPlaylistById(playlistId: string): boolean {
  const playlists = loadPlaylists();
  const pinned = getPinnedPlaylists(playlists);
  const target = playlists.find((p) => p.id === playlistId);
  if (!target) return false;
  if (isPlaylistPinned(target)) return true;
  if (pinned.length >= MAX_PINNED_PLAYLISTS) return false;
  savePlaylists(
    playlists.map((p) =>
      p.id === playlistId ? { ...p, pinnedAt: Date.now(), updatedAt: Date.now() } : p,
    ),
  );
  return true;
}

export function unpinPlaylistById(playlistId: string): void {
  const playlists = loadPlaylists();
  savePlaylists(
    playlists.map((p) =>
      p.id === playlistId ? { ...p, pinnedAt: undefined, updatedAt: Date.now() } : p,
    ),
  );
}

export function playlistCoverUrl(pl: StoredPlaylist): string | undefined {
  return pl.coverUrl ?? pl.importCoverUrl;
}

export function savePlaylists(
  playlists: StoredPlaylist[],
  options?: { skipSync?: boolean },
): void {
  prefsSetItem(STORAGE_KEY, JSON.stringify(playlists));
  notifyPlaylistsChange();
  if (!options?.skipSync) {
    window.dispatchEvent(new Event(PLAYLISTS_SYNC_DIRTY_EVENT));
  }
}

function unionPlaylistTracks(
  localTracks: MediaEnvelope[],
  incoming: MediaEnvelope[],
): { tracks: MediaEnvelope[]; added: number } {
  const existing = new Set(localTracks.map((t) => t.envelopeId));
  const merged = [...localTracks];
  let added = 0;
  for (const t of incoming) {
    if (!t.envelopeId || existing.has(t.envelopeId)) continue;
    merged.push(t);
    existing.add(t.envelopeId);
    added += 1;
  }
  return { tracks: merged, added };
}

/**
 * Merge remote manifest metadata into local.
 * Conflict rule: newer updatedAt wins for name/description; equal timestamps keep local.
 */
function mergeRemotePlaylistMetadata(
  local: StoredPlaylist,
  remote: RemotePlaylistManifestEntry,
): { patch: Partial<StoredPlaylist>; conflictResolved: boolean } {
  const localTs = local.updatedAt ?? 0;
  const remoteTs = remote.updatedAt ?? 0;
  if (remoteTs > localTs) {
    const patch: Partial<StoredPlaylist> = { updatedAt: remoteTs };
    const remoteName = remote.name.trim();
    if (remoteName && remoteName !== local.name) patch.name = remoteName;
    const remoteDesc = remote.description?.trim();
    if (remoteDesc && remoteDesc !== local.description) patch.description = remoteDesc;
    const conflictResolved =
      patch.name !== undefined || patch.description !== undefined;
    return { patch, conflictResolved };
  }
  return { patch: {}, conflictResolved: false };
}

function mergeTombstoneMaps(
  local: PlaylistTombstone[],
  remote: PlaylistTombstone[],
): PlaylistTombstone[] {
  const byId = new Map<string, PlaylistTombstone>();
  for (const t of [...local, ...remote]) {
    if (!t?.id) continue;
    const prev = byId.get(t.id);
    byId.set(t.id, {
      id: t.id,
      deletedAt: Math.max(prev?.deletedAt ?? 0, t.deletedAt ?? 0),
    });
  }
  return [...byId.values()];
}

function applyPlaylistTombstones(
  playlists: StoredPlaylist[],
  tombstones: PlaylistTombstone[],
): { playlists: StoredPlaylist[]; deleted: number } {
  if (!tombstones.length) return { playlists, deleted: 0 };
  const tombById = new Map(tombstones.map((t) => [t.id, t.deletedAt ?? 0]));
  let deleted = 0;
  const next = playlists.filter((pl) => {
    const deletedAt = tombById.get(pl.id);
    if (deletedAt === undefined) return true;
    if (deletedAt >= (pl.updatedAt ?? 0)) {
      deleted += 1;
      return false;
    }
    return true;
  });
  return { playlists: next, deleted };
}

function resolveRemoteTracks(
  remote: RemotePlaylistManifestEntry,
  resolveEnvelope: (envelopeId: string) => MediaEnvelope | null,
): MediaEnvelope[] {
  const tracks: MediaEnvelope[] = [];
  const seen = new Set<string>();
  for (const id of remote.trackEnvelopeIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const env = resolveEnvelope(id);
    if (env) tracks.push(env);
  }
  return tracks;
}

/**
 * Non-destructive playlist merge from locker sync manifest.
 * Match by playlist id; union track membership; preserve local metadata unless remote is newer.
 * Tombstones remove playlists when remote deletion is newer than local updatedAt.
 */
export function mergePlaylistsFromManifest(
  remotePlaylists: RemotePlaylistManifestEntry[],
  resolveEnvelope: (envelopeId: string) => MediaEnvelope | null,
  remoteTombstones: PlaylistTombstone[] = [],
): PlaylistSyncMergeStats {
  const stats: PlaylistSyncMergeStats = {
    playlistsImported: 0,
    playlistsMerged: 0,
    playlistsDeleted: 0,
    conflictsResolved: 0,
  };

  const mergedTombstones = mergeTombstoneMaps(loadPlaylistTombstones(), remoteTombstones);
  savePlaylistTombstones(mergedTombstones);

  let local = loadPlaylists();
  const tombApplied = applyPlaylistTombstones(local, mergedTombstones);
  local = tombApplied.playlists;
  stats.playlistsDeleted += tombApplied.deleted;

  if (!remotePlaylists.length && tombApplied.deleted === 0) return stats;

  const localById = new Map(local.map((pl) => [pl.id, pl]));
  let changed = tombApplied.deleted > 0;
  const next = [...local];

  for (const remote of remotePlaylists) {
    if (!remote?.id?.trim()) continue;

    const tombDeletedAt = mergedTombstones.find((t) => t.id === remote.id)?.deletedAt ?? 0;
    if (tombDeletedAt >= (remote.updatedAt ?? 0)) continue;

    const incomingTracks = resolveRemoteTracks(remote, resolveEnvelope);
    const existing = localById.get(remote.id);

    if (!existing) {
      if (incomingTracks.length === 0) continue;
      const imported: StoredPlaylist = {
        id: remote.id,
        name: remote.name.trim() || 'Synced playlist',
        description: remote.description?.trim() || 'Synced from locker',
        tracks: incomingTracks,
        updatedAt: remote.updatedAt ?? Date.now(),
      };
      next.push(imported);
      localById.set(remote.id, imported);
      stats.playlistsImported += 1;
      changed = true;
      continue;
    }

    const { tracks: mergedTracks, added } = unionPlaylistTracks(existing.tracks, incomingTracks);
    const { patch: metadataPatch, conflictResolved } = mergeRemotePlaylistMetadata(
      existing,
      remote,
    );
    if (conflictResolved) stats.conflictsResolved += 1;

    const metadataChanged = Object.keys(metadataPatch).some(
      (k) => k !== 'updatedAt' && metadataPatch[k as keyof StoredPlaylist] !== undefined,
    );

    if (added === 0 && !metadataChanged) continue;

    let updated: StoredPlaylist = {
      ...existing,
      ...metadataPatch,
      tracks: mergedTracks,
    };
    if (added > 0 || metadataChanged) {
      updated.updatedAt = Math.max(existing.updatedAt ?? 0, remote.updatedAt ?? 0, Date.now());
      if (existing.tracks.length === 0 && isImportedShellWithoutTracks(existing)) {
        updated = clearPlaylistPendingImport(updated);
      }
    }

    const idx = next.findIndex((pl) => pl.id === remote.id);
    if (idx >= 0) next[idx] = updated;
    localById.set(remote.id, updated);
    stats.playlistsMerged += 1;
    changed = true;
  }

  if (changed) savePlaylists(next, { skipSync: true });
  return stats;
}

export function addTracksToPlaylist(
  playlistId: string,
  tracks: MediaEnvelope[],
): StoredPlaylist[] {
  const playlists = loadPlaylists();
  const next = playlists.map((pl) => {
    if (pl.id !== playlistId) return pl;
    if (isSmartPlaylist(pl)) return pl;
    const wasEmpty = pl.tracks.length === 0;
    const { tracks: merged, added } = unionPlaylistTracks(pl.tracks, tracks);
    if (added === 0) return pl;
    let updated: StoredPlaylist = {
      ...pl,
      tracks: merged,
      updatedAt: Date.now(),
    };
    if (wasEmpty && merged.length > 0 && isImportedShellWithoutTracks(pl)) {
      updated = clearPlaylistPendingImport(updated);
    }
    return updated;
  });
  savePlaylists(next);
  return next;
}

export function createPlaylistWithTracks(
  name: string,
  tracks: MediaEnvelope[],
  description = 'Added from locker',
): StoredPlaylist {
  const pl: StoredPlaylist = {
    id: `playlist-${Date.now()}`,
    name: name.trim() || 'New playlist',
    description,
    tracks: [...tracks],
    type: 'manual',
    updatedAt: Date.now(),
  };
  const next = [...loadPlaylists(), pl];
  savePlaylists(next);
  return pl;
}

export function createSmartPlaylist(input: {
  name: string;
  description?: string;
  rules: SmartPlaylistRules;
  builtInId?: BuiltInSmartPlaylistId;
  builtInParam?: string;
  lockerEntries: LockerEntry[];
  playHistory: StoredPlayHit[];
}): StoredPlaylist {
  const rules =
    input.builtInId && input.builtInParam
      ? applyBuiltInParam(input.rules, input.builtInId, input.builtInParam)
      : input.rules;
  const history = input.playHistory ?? getSmartPlaylistPlayHistory();
  const tracks = evaluateSmartPlaylistTracks(rules, input.lockerEntries, history);
  const pl: StoredPlaylist = {
    id: `pl-smart-${Date.now()}`,
    name: input.name.trim() || 'Smart playlist',
    description: input.description?.trim() || 'Dynamically generated from locker rules',
    tracks,
    type: 'smart',
    rules,
    builtInId: input.builtInId,
    builtInParam: input.builtInParam?.trim() || undefined,
    updatedAt: Date.now(),
  };
  const next = [...loadPlaylists(), pl];
  savePlaylists(next);
  return pl;
}

function resolveSmartRules(pl: StoredPlaylist): SmartPlaylistRules | null {
  if (!isSmartPlaylist(pl) || !pl.rules) return null;
  if (pl.builtInId && pl.builtInParam) {
    return applyBuiltInParam(pl.rules, pl.builtInId, pl.builtInParam);
  }
  return pl.rules;
}

/**
 * Ensure auto-managed core built-in smart playlists exist locally.
 * Smart playlists are local-only (rules + play history); not replicated in Phase 3 sync.
 */
export function ensureCoreBuiltInPlaylists(
  lockerEntries: LockerEntry[],
  playHistory: StoredPlayHit[],
): StoredPlaylist[] {
  let playlists = loadPlaylists();
  let changed = false;
  const next = [...playlists];

  for (const builtInId of CORE_BUILTIN_SMART_PLAYLIST_IDS) {
    const preset = getBuiltInPreset(builtInId);
    if (!preset) continue;

    const stableId = coreBuiltInPlaylistId(builtInId);
    const idx = next.findIndex((pl) => pl.id === stableId || pl.builtInId === builtInId);
    const rules = preset.rules;
    const tracks = evaluateSmartPlaylistTracks(rules, lockerEntries, playHistory);
    const prevIds =
      idx >= 0 ? next[idx].tracks.map((t) => t.envelopeId).join('\0') : '';
    const nextIds = tracks.map((t) => t.envelopeId).join('\0');

    if (idx >= 0) {
      if (prevIds !== nextIds) {
        next[idx] = { ...next[idx], tracks, rules, updatedAt: Date.now() };
        changed = true;
      }
      continue;
    }

    next.unshift({
      id: stableId,
      name: preset.name,
      description: preset.description,
      tracks,
      type: 'smart',
      rules,
      builtInId,
      updatedAt: Date.now(),
    });
    changed = true;
  }

  if (changed) savePlaylists(next, { skipSync: true });
  return changed ? next : playlists;
}

/** Rebuild smart playlist track caches from locker + play history. */
export function refreshSmartPlaylists(
  lockerEntries: LockerEntry[],
  playHistory?: StoredPlayHit[],
): StoredPlaylist[] {
  const history = playHistory ?? getSmartPlaylistPlayHistory();
  let playlists = ensureCoreBuiltInPlaylists(lockerEntries, history);
  let changed = false;
  const next = playlists.map((pl) => {
    const rules = resolveSmartRules(pl);
    if (!rules) return pl;
    const tracks = evaluateSmartPlaylistTracks(rules, lockerEntries, history);
    const prevIds = pl.tracks.map((t) => t.envelopeId).join('\0');
    const nextIds = tracks.map((t) => t.envelopeId).join('\0');
    if (prevIds === nextIds) return pl;
    changed = true;
    return { ...pl, tracks, updatedAt: Date.now() };
  });
  if (changed) savePlaylists(next, { skipSync: true });
  return changed ? next : playlists;
}
