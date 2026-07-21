/**
 * Collaborative playlist share — LAN live links via tier34 + app deep links.
 */

import { displayPlaylistName } from './importPlatforms';
import type { StoredPlaylist, PlaylistCollaborativeLink } from './playlistStorage';
import {
  loadPlaylists,
  savePlaylists,
  isSmartPlaylist,
} from './playlistStorage';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  getTier34BaseUrl,
  getTier34LanBaseUrl,
  tier34FetchSharedPlaylist,
  tier34PublishPlaylistShare,
  tier34UpdateSharedPlaylist,
  type PlaylistSharePublicRow,
} from './tier34/client';

export const PLAYLIST_SHARE_SCHEMA_VERSION = 1;

export type SharedPlaylistTrack = {
  title: string;
  artist: string;
  album?: string;
  envelopeId?: string;
  url?: string;
  durationSeconds?: number;
};

export type SharedPlaylistManifest = {
  schemaVersion: typeof PLAYLIST_SHARE_SCHEMA_VERSION;
  name: string;
  description?: string;
  updatedAt: number;
  collaborative: boolean;
  tracks: SharedPlaylistTrack[];
};

export type PublishPlaylistShareResult = {
  shareId: string;
  editToken: string;
  viewUrl: string;
  editUrl: string;
  lanUrl: string;
  row: PlaylistSharePublicRow;
  link: PlaylistCollaborativeLink;
};

const SHARE_HASH_RE = /(?:^#|[?&])playlist=([a-f0-9]{8,64})(?:&token=([a-f0-9]{16,64}))?/i;
const SHARE_ID_RE = /\/api\/playlists\/share\/([a-f0-9]{8,64})/i;

export function buildSharedPlaylistManifest(
  playlist: StoredPlaylist,
  collaborative = true,
): SharedPlaylistManifest {
  return {
    schemaVersion: PLAYLIST_SHARE_SCHEMA_VERSION,
    name: displayPlaylistName(playlist),
    description: playlist.description?.trim() || undefined,
    updatedAt: playlist.updatedAt ?? Date.now(),
    collaborative,
    tracks: playlist.tracks.map((t) => ({
      title: t.title,
      artist: t.artist,
      album: t.album,
      envelopeId: t.envelopeId,
      url: t.url,
      durationSeconds: t.durationSeconds,
    })),
  };
}

export function sharedTracksToEnvelopes(tracks: SharedPlaylistTrack[]): MediaEnvelope[] {
  const out: MediaEnvelope[] = [];
  const seen = new Set<string>();
  for (const row of tracks) {
    const envelopeId =
      row.envelopeId?.trim() ||
      `share-${row.title}-${row.artist}`.replace(/\s+/g, '-').slice(0, 80);
    if (seen.has(envelopeId)) continue;
    seen.add(envelopeId);
    out.push({
      envelopeId,
      title: row.title,
      artist: row.artist,
      album: row.album ?? '',
      url: row.url ?? '',
      durationSeconds: row.durationSeconds ?? 0,
      provider: row.url?.startsWith('file:') || row.envelopeId?.startsWith('local-')
        ? 'local-vault'
        : 'https',
      transport: 'element-src',
      sourceId: row.envelopeId,
    });
  }
  return out.filter((t) => t.title?.trim());
}

function unionTrackLists(
  localTracks: MediaEnvelope[],
  incoming: MediaEnvelope[],
): { tracks: MediaEnvelope[] } {
  const existing = new Set(localTracks.map((t) => t.envelopeId));
  const merged = [...localTracks];
  for (const t of incoming) {
    if (!t.envelopeId || existing.has(t.envelopeId)) continue;
    merged.push(t);
    existing.add(t.envelopeId);
  }
  return { tracks: merged };
}

export function buildPlaylistAppShareUrl(shareId: string, editToken?: string): string {
  const origin =
    typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';
  const tokenPart = editToken?.trim() ? `&token=${encodeURIComponent(editToken.trim())}` : '';
  return `${origin}#playlist=${shareId.trim().toLowerCase()}${tokenPart}`;
}

export function buildPlaylistLanShareUrl(shareId: string, tier34Base?: string): string {
  const base = (tier34Base ?? getTier34LanBaseUrl()).replace(/\/$/, '');
  return `${base}/api/playlists/share/${shareId.trim().toLowerCase()}`;
}

export function parsePlaylistShareLink(input: string): { shareId: string; editToken?: string } | null {
  const raw = input.trim();
  if (!raw) return null;

  const hashMatch = raw.match(SHARE_HASH_RE);
  if (hashMatch?.[1]) {
    return {
      shareId: hashMatch[1].toLowerCase(),
      editToken: hashMatch[2]?.toLowerCase(),
    };
  }

  const apiMatch = raw.match(SHARE_ID_RE);
  if (apiMatch?.[1]) {
    return { shareId: apiMatch[1].toLowerCase() };
  }

  if (/^[a-f0-9]{8,64}$/i.test(raw)) {
    return { shareId: raw.toLowerCase() };
  }

  return null;
}

export function parsePlaylistShareFromHash(hash: string): { shareId: string; editToken?: string } | null {
  return parsePlaylistShareLink(hash);
}

function buildCollaborativeLink(
  shareId: string,
  editToken: string,
  collaborative: boolean,
  remoteUpdatedAt: number,
): PlaylistCollaborativeLink {
  return {
    shareId,
    editToken,
    collaborative,
    viewUrl: buildPlaylistAppShareUrl(shareId),
    editUrl: buildPlaylistAppShareUrl(shareId, editToken),
    lanUrl: buildPlaylistLanShareUrl(shareId),
    publishedAt: Date.now(),
    remoteUpdatedAt,
  };
}

export async function publishPlaylistShare(
  playlist: StoredPlaylist,
  collaborative = true,
): Promise<PublishPlaylistShareResult> {
  if (isSmartPlaylist(playlist)) {
    throw new Error('Smart playlists cannot be shared as live links.');
  }
  if (!getTier34BaseUrl().trim()) {
    throw new Error('Configure Sandbox Server URL in Settings to publish live share links.');
  }
  const manifest = buildSharedPlaylistManifest(playlist, collaborative);
  const row = await tier34PublishPlaylistShare(manifest);
  if (!row.editToken) throw new Error('Share publish did not return an edit token.');
  const shareId = row.id;
  const link = buildCollaborativeLink(shareId, row.editToken, collaborative, row.updatedAt);
  return {
    shareId,
    editToken: row.editToken,
    viewUrl: buildPlaylistAppShareUrl(shareId),
    editUrl: buildPlaylistAppShareUrl(shareId, row.editToken),
    lanUrl: buildPlaylistLanShareUrl(shareId),
    row,
    link,
  };
}

export function attachCollaborativeLink(
  playlistId: string,
  link: PlaylistCollaborativeLink,
): StoredPlaylist | null {
  const playlists = loadPlaylists();
  let updated: StoredPlaylist | null = null;
  const next = playlists.map((pl) => {
    if (pl.id !== playlistId) return pl;
    updated = { ...pl, collaborativeShare: link, updatedAt: pl.updatedAt ?? Date.now() };
    return updated;
  });
  if (!updated) return null;
  savePlaylists(next);
  return updated;
}

export async function fetchSharedPlaylistManifest(
  shareId: string,
): Promise<PlaylistSharePublicRow | null> {
  if (!getTier34BaseUrl().trim()) {
    throw new Error('Configure Sandbox Server URL to fetch shared playlists.');
  }
  return tier34FetchSharedPlaylist(shareId);
}

export async function pushCollaborativePlaylistUpdate(
  playlist: StoredPlaylist,
): Promise<PlaylistSharePublicRow | null> {
  const link = playlist.collaborativeShare;
  if (!link?.editToken || !link.shareId) return null;
  if (isSmartPlaylist(playlist)) return null;
  const manifest = buildSharedPlaylistManifest(playlist, link.collaborative);
  const row = await tier34UpdateSharedPlaylist(link.shareId, link.editToken, manifest);
  attachCollaborativeLink(playlist.id, {
    ...link,
    lastPushedAt: Date.now(),
    remoteUpdatedAt: row.updatedAt,
  });
  return row;
}

export function mergeSharedIntoLocalPlaylist(
  local: StoredPlaylist,
  remote: PlaylistSharePublicRow,
  editToken?: string,
): StoredPlaylist {
  const incoming = sharedTracksToEnvelopes(remote.manifest.tracks);
  const { tracks } = unionTrackLists(local.tracks, incoming);
  const remoteTs = remote.updatedAt ?? remote.manifest.updatedAt ?? Date.now();
  const localTs = local.updatedAt ?? 0;
  const patch: StoredPlaylist = {
    ...local,
    tracks,
    updatedAt: Math.max(localTs, remoteTs),
  };
  if (remoteTs >= localTs && remote.manifest.name?.trim()) {
    patch.name = remote.manifest.name.trim();
  }
  if (remoteTs >= localTs && remote.manifest.description?.trim()) {
    patch.description = remote.manifest.description.trim();
  }
  if (local.collaborativeShare || editToken) {
    patch.collaborativeShare = {
      shareId: remote.id,
      editToken: editToken ?? local.collaborativeShare?.editToken ?? '',
      collaborative: remote.manifest.collaborative,
      viewUrl: buildPlaylistAppShareUrl(remote.id),
      editUrl: editToken ? buildPlaylistAppShareUrl(remote.id, editToken) : local.collaborativeShare?.editUrl ?? buildPlaylistAppShareUrl(remote.id),
      lanUrl: buildPlaylistLanShareUrl(remote.id),
      publishedAt: local.collaborativeShare?.publishedAt ?? Date.now(),
      lastPulledAt: Date.now(),
      remoteUpdatedAt: remoteTs,
    };
  }
  return patch;
}

export async function pullCollaborativePlaylistUpdate(
  playlist: StoredPlaylist,
): Promise<StoredPlaylist | null> {
  const link = playlist.collaborativeShare;
  if (!link?.shareId) return null;
  const remote = await fetchSharedPlaylistManifest(link.shareId);
  if (!remote) return null;
  const remoteTs = remote.updatedAt ?? remote.manifest.updatedAt ?? 0;
  const localTs = playlist.updatedAt ?? 0;
  if (remoteTs <= localTs && link.lastPulledAt) return playlist;
  const merged = mergeSharedIntoLocalPlaylist(playlist, remote, link.editToken);
  const playlists = loadPlaylists().map((pl) => (pl.id === merged.id ? merged : pl));
  savePlaylists(playlists);
  return merged;
}

export async function syncCollaborativePlaylist(
  playlist: StoredPlaylist,
): Promise<'pushed' | 'pulled' | 'noop'> {
  const link = playlist.collaborativeShare;
  if (!link?.shareId || !link.collaborative) return 'noop';
  const remote = await fetchSharedPlaylistManifest(link.shareId);
  if (!remote) return 'noop';
  const remoteTs = remote.updatedAt ?? remote.manifest.updatedAt ?? 0;
  const localTs = playlist.updatedAt ?? 0;
  if (localTs > remoteTs && link.editToken) {
    await pushCollaborativePlaylistUpdate(playlist);
    return 'pushed';
  }
  if (remoteTs > localTs) {
    await pullCollaborativePlaylistUpdate(playlist);
    return 'pulled';
  }
  return 'noop';
}

export function importSharedPlaylistLocally(
  remote: PlaylistSharePublicRow,
  options?: { editToken?: string; linkToOriginal?: boolean },
): StoredPlaylist {
  const tracks = sharedTracksToEnvelopes(remote.manifest.tracks);
  const pl: StoredPlaylist = {
    id: `playlist-${Date.now()}`,
    name: remote.manifest.name?.trim() || 'Shared playlist',
    description: remote.manifest.description?.trim() || 'Imported from share link',
    tracks,
    type: 'manual',
    updatedAt: remote.updatedAt ?? Date.now(),
  };
  if (options?.linkToOriginal && options.editToken) {
    pl.collaborativeShare = buildCollaborativeLink(
      remote.id,
      options.editToken,
      remote.manifest.collaborative,
      remote.updatedAt,
    );
  } else if (options?.linkToOriginal) {
    pl.collaborativeShare = {
      shareId: remote.id,
      editToken: '',
      collaborative: false,
      viewUrl: buildPlaylistAppShareUrl(remote.id),
      editUrl: buildPlaylistAppShareUrl(remote.id),
      lanUrl: buildPlaylistLanShareUrl(remote.id),
      publishedAt: Date.now(),
      remoteUpdatedAt: remote.updatedAt,
    };
  }
  savePlaylists([...loadPlaylists(), pl]);
  return pl;
}

let syncListenerRegistered = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced push/pull for playlists with collaborativeShare links. */
export function initCollaborativePlaylistSync(): void {
  if (syncListenerRegistered || typeof window === 'undefined') return;
  syncListenerRegistered = true;
  window.addEventListener('sandbox-playlists-change', () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      void runCollaborativeSyncPass();
    }, 2500);
  });
}

async function runCollaborativeSyncPass(): Promise<void> {
  if (!getTier34BaseUrl().trim()) return;
  for (const pl of loadPlaylists()) {
    if (!pl.collaborativeShare?.collaborative || !pl.collaborativeShare.editToken) continue;
    if (isSmartPlaylist(pl)) continue;
    try {
      await syncCollaborativePlaylist(pl);
    } catch {
      /* offline / LAN unreachable */
    }
  }
}

export { shareOrDownloadPlaylist, exportPlaylistAsJson, exportPlaylistAsM3U } from './playlistShareExport';
export type { PlaylistExportFormat } from './playlistShareExport';
