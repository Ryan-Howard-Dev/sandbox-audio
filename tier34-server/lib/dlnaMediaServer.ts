/**
 * DLNA/UPnP MediaServer — locker library browse + stream URLs for LAN clients.
 */

import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import { statSync } from 'node:fs';
import nodeSsdp from 'node-ssdp';
import {
  blobExists,
  loadMasterManifest,
  type LockerSyncManifestEntry,
  type LockerSyncManifestPlaylist,
} from './lockerStorage.js';
import { blobPathForHash } from './lockerPaths.js';
import { isLosslessBlob } from './mediaGraph.js';

const { Server } = nodeSsdp;

export const DLNA_ROOT_ID = '0';
export const DLNA_CONTAINER_ARTISTS = 'artists';
export const DLNA_CONTAINER_ALBUMS = 'albums';
export const DLNA_CONTAINER_TRACKS = 'tracks';
export const DLNA_CONTAINER_PLAYLISTS = 'playlists';

export type BrowseResult = {
  didl: string;
  numberReturned: number;
  totalMatches: number;
  updateId: number;
};

type LibraryEntry = LockerSyncManifestEntry & { hasBlob: boolean };

type LibraryIndex = {
  updatedAt: number;
  entries: LibraryEntry[];
  byId: Map<string, LibraryEntry>;
  artists: string[];
  albums: Array<{ key: string; artist: string; album: string; coverHash?: string; year?: string }>;
  playlists: LockerSyncManifestPlaylist[];
};

let cachedIndex: LibraryIndex | null = null;
let cachedManifestUpdatedAt = -1;
let ssdpServer: InstanceType<typeof Server> | null = null;
let deviceUdn: string | null = null;
let runtimeDlnaEnabled: boolean | undefined;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function artistObjectId(artist: string): string {
  return `artist:${encodeURIComponent(artist)}`;
}

export function albumObjectId(artist: string, album: string): string {
  return `album:${encodeURIComponent(artist)}::${encodeURIComponent(album)}`;
}

export function trackObjectId(entryId: string): string {
  return `track:${entryId}`;
}

export function playlistObjectId(playlistId: string): string {
  return `playlist:${playlistId}`;
}

export function parseArtistObjectId(objectId: string): string | null {
  if (!objectId.startsWith('artist:')) return null;
  try {
    return decodeURIComponent(objectId.slice('artist:'.length));
  } catch {
    return null;
  }
}

export function parseAlbumObjectId(objectId: string): { artist: string; album: string } | null {
  if (!objectId.startsWith('album:')) return null;
  const raw = objectId.slice('album:'.length);
  const sep = raw.indexOf('::');
  if (sep < 0) return null;
  try {
    return {
      artist: decodeURIComponent(raw.slice(0, sep)),
      album: decodeURIComponent(raw.slice(sep + 2)),
    };
  } catch {
    return null;
  }
}

export function parseTrackObjectId(objectId: string): string | null {
  if (!objectId.startsWith('track:')) return null;
  return objectId.slice('track:'.length);
}

export function parsePlaylistObjectId(objectId: string): string | null {
  if (!objectId.startsWith('playlist:')) return null;
  return objectId.slice('playlist:'.length);
}

function detectMimeType(hash: string): string {
  try {
    const fp = blobPathForHash(hash);
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(fp, 'r');
    try {
      fs.readSync(fd, buf, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (buf.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
    if (buf.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
    if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg';
    if (buf.slice(0, 3).toString() === 'ID3') return 'audio/mpeg';
  } catch {
    /* fall through */
  }
  return isLosslessBlob(hash) ? 'audio/flac' : 'audio/mpeg';
}

function protocolInfoForMime(mime: string): string {
  if (mime === 'audio/flac') return 'http-get:*:audio/flac:DLNA.ORG_PN=FLAC;DLNA.ORG_OP=01';
  if (mime === 'audio/ogg') return 'http-get:*:audio/ogg:*';
  return 'http-get:*:audio/mpeg:DLNA.ORG_PN=MP3;DLNA.ORG_OP=01';
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function blobByteSize(hash: string): number {
  try {
    return statSync(blobPathForHash(hash)).size;
  } catch {
    return 0;
  }
}

function loadPlaylistsFromManifest(): LockerSyncManifestPlaylist[] {
  const manifest = loadMasterManifest() as {
    playlists?: LockerSyncManifestPlaylist[];
  };
  if (!Array.isArray(manifest.playlists)) return [];
  return manifest.playlists.filter((pl) => pl?.id && pl?.name);
}

export function buildLibraryIndex(): LibraryIndex {
  const manifest = loadMasterManifest();
  if (cachedIndex && cachedManifestUpdatedAt === manifest.updatedAt) {
    return cachedIndex;
  }

  const entries: LibraryEntry[] = [];
  const byId = new Map<string, LibraryEntry>();
  const artistSet = new Set<string>();
  const albumMap = new Map<
    string,
    { key: string; artist: string; album: string; coverHash?: string; year?: string }
  >();

  for (const entry of manifest.entries ?? []) {
    if (!entry?.id || !entry.contentHash) continue;
    const hasBlob = blobExists(entry.contentHash);
    const row: LibraryEntry = { ...entry, hasBlob };
    entries.push(row);
    byId.set(entry.id, row);

    const artist = (entry.artist ?? 'Unknown Artist').trim() || 'Unknown Artist';
    artistSet.add(artist);

    const album = (entry.albumName ?? 'Unknown Album').trim() || 'Unknown Album';
    const albumKey = `${artist}\x00${album}`;
    if (!albumMap.has(albumKey)) {
      albumMap.set(albumKey, {
        key: albumKey,
        artist,
        album,
        coverHash: entry.coverHash,
        year: entry.releaseYear,
      });
    }
  }

  const index: LibraryIndex = {
    updatedAt: manifest.updatedAt,
    entries: entries.filter((e) => e.hasBlob),
    byId,
    artists: [...artistSet].sort((a, b) => a.localeCompare(b)),
    albums: [...albumMap.values()].sort((a, b) => {
      const artistCmp = a.artist.localeCompare(b.artist);
      return artistCmp !== 0 ? artistCmp : a.album.localeCompare(b.album);
    }),
    playlists: loadPlaylistsFromManifest(),
  };

  cachedIndex = index;
  cachedManifestUpdatedAt = manifest.updatedAt;
  return index;
}

export function getSystemUpdateId(): number {
  const manifest = loadMasterManifest();
  return Math.max(1, Math.floor(manifest.updatedAt / 1000));
}

export function invalidateLibraryCache(): void {
  cachedIndex = null;
  cachedManifestUpdatedAt = -1;
}

export function resolveDlnaBaseUrl(port: number): string {
  const explicit = process.env.DLNA_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const host = process.env.DLNA_HOST?.trim() || detectLanIPv4();
  return `http://${host}:${port}`;
}

function detectLanIPv4(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

export function getDeviceUdn(): string {
  if (deviceUdn) return deviceUdn;
  const fromEnv = process.env.DLNA_UDN?.trim();
  if (fromEnv) {
    deviceUdn = fromEnv.startsWith('uuid:') ? fromEnv : `uuid:${fromEnv}`;
    return deviceUdn;
  }
  const manifest = loadMasterManifest();
  const seed = manifest.deviceId || 'sovereign-tier34';
  const hash = crypto.createHash('sha1').update(seed).digest('hex');
  deviceUdn = `uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  return deviceUdn;
}

export function getFriendlyName(): string {
  return process.env.DLNA_FRIENDLY_NAME?.trim() || 'Sovereign Music Locker';
}

function containerDidl(
  id: string,
  parentId: string,
  title: string,
  childCount: number,
  upnpClass: string,
): string {
  return `<container id="${escapeXml(id)}" parentID="${escapeXml(parentId)}" restricted="false" searchable="true" childCount="${childCount}">
  <dc:title>${escapeXml(title)}</dc:title>
  <upnp:class>${escapeXml(upnpClass)}</upnp:class>
</container>`;
}

function trackDidl(entry: LibraryEntry, parentId: string, baseUrl: string): string {
  const mime = detectMimeType(entry.contentHash);
  const protocolInfo = protocolInfoForMime(mime);
  const streamUrl = `${baseUrl}/api/cast/stream/${encodeURIComponent(entry.id)}`;
  const size = blobByteSize(entry.contentHash);
  const duration = formatDuration(entry.durationSeconds ?? 0);
  const artUri = entry.coverHash
    ? `${baseUrl}/api/locker/blob/${entry.coverHash}`
    : '';

  const artTag = artUri
    ? `<upnp:albumArtURI dlna:profileID="JPEG_TN">${escapeXml(artUri)}</upnp:albumArtURI>`
    : '';

  return `<item id="${escapeXml(trackObjectId(entry.id))}" parentID="${escapeXml(parentId)}" restricted="1">
  <dc:title>${escapeXml(entry.title ?? 'Unknown Track')}</dc:title>
  <dc:creator>${escapeXml(entry.artist ?? 'Unknown Artist')}</dc:creator>
  <upnp:artist>${escapeXml(entry.artist ?? 'Unknown Artist')}</upnp:artist>
  <upnp:album>${escapeXml(entry.albumName ?? 'Unknown Album')}</upnp:album>
  <upnp:originalTrackNumber>1</upnp:originalTrackNumber>
  <upnp:class>object.item.audioItem.musicTrack</upnp:class>
  <res protocolInfo="${protocolInfo}" duration="${duration}" size="${size}">${escapeXml(streamUrl)}</res>
  ${artTag}
</item>`;
}

function wrapDidl(inner: string): string {
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">${inner}</DIDL-Lite>`;
}

function rootContainers(index: LibraryIndex): string[] {
  return [
    containerDidl(DLNA_CONTAINER_ARTISTS, DLNA_ROOT_ID, 'Artists', index.artists.length, 'object.container.person.musicArtist'),
    containerDidl(DLNA_CONTAINER_ALBUMS, DLNA_ROOT_ID, 'Albums', index.albums.length, 'object.container.album.musicAlbum'),
    containerDidl(DLNA_CONTAINER_TRACKS, DLNA_ROOT_ID, 'All Tracks', index.entries.length, 'object.container'),
    containerDidl(
      DLNA_CONTAINER_PLAYLISTS,
      DLNA_ROOT_ID,
      'Playlists',
      index.playlists.length,
      'object.container.playlistContainer',
    ),
  ];
}

function browseObject(
  objectId: string,
  startingIndex: number,
  requestedCount: number,
  baseUrl: string,
): BrowseResult {
  const index = buildLibraryIndex();
  const updateId = getSystemUpdateId();
  const count = requestedCount > 0 ? requestedCount : 9999;
  let items: string[] = [];

  if (objectId === DLNA_ROOT_ID || objectId === '') {
    items = rootContainers(index);
  } else if (objectId === DLNA_CONTAINER_ARTISTS) {
    items = index.artists.map((artist) => {
      const albumsForArtist = index.albums.filter((a) => a.artist === artist).length;
      return containerDidl(
        artistObjectId(artist),
        DLNA_CONTAINER_ARTISTS,
        artist,
        albumsForArtist,
        'object.container.person.musicArtist',
      );
    });
  } else if (objectId === DLNA_CONTAINER_ALBUMS) {
    items = index.albums.map((row) =>
      containerDidl(
        albumObjectId(row.artist, row.album),
        DLNA_CONTAINER_ALBUMS,
        row.album,
        index.entries.filter((e) => (e.artist ?? '') === row.artist && (e.albumName ?? '') === row.album).length,
        'object.container.album.musicAlbum',
      ),
    );
  } else if (objectId === DLNA_CONTAINER_TRACKS) {
    items = index.entries.map((entry) => trackDidl(entry, DLNA_CONTAINER_TRACKS, baseUrl));
  } else if (objectId === DLNA_CONTAINER_PLAYLISTS) {
    items = index.playlists.map((pl) => {
      const trackCount = pl.trackEnvelopeIds.filter((id) => index.byId.has(id)).length;
      return containerDidl(
        playlistObjectId(pl.id),
        DLNA_CONTAINER_PLAYLISTS,
        pl.name,
        trackCount,
        'object.container.playlistContainer',
      );
    });
  } else if (objectId.startsWith('artist:')) {
    const artist = parseArtistObjectId(objectId);
    if (artist) {
      items = index.albums
        .filter((a) => a.artist === artist)
        .map((row) =>
          containerDidl(
            albumObjectId(row.artist, row.album),
            objectId,
            row.album,
            index.entries.filter((e) => (e.artist ?? '') === row.artist && (e.albumName ?? '') === row.album).length,
            'object.container.album.musicAlbum',
          ),
        );
    }
  } else if (objectId.startsWith('album:')) {
    const parsed = parseAlbumObjectId(objectId);
    if (parsed) {
      items = index.entries
        .filter((e) => (e.artist ?? '') === parsed.artist && (e.albumName ?? '') === parsed.album)
        .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
        .map((entry) => trackDidl(entry, objectId, baseUrl));
    }
  } else if (objectId.startsWith('playlist:')) {
    const playlistId = parsePlaylistObjectId(objectId);
    const playlist = index.playlists.find((p) => p.id === playlistId);
    if (playlist) {
      items = playlist.trackEnvelopeIds
        .map((id) => index.byId.get(id))
        .filter((e): e is LibraryEntry => Boolean(e?.hasBlob))
        .map((entry) => trackDidl(entry, objectId, baseUrl));
    }
  } else if (objectId.startsWith('track:')) {
    const entryId = parseTrackObjectId(objectId);
    const entry = entryId ? index.byId.get(entryId) : undefined;
    if (entry?.hasBlob) {
      items = [trackDidl(entry, DLNA_CONTAINER_TRACKS, baseUrl)];
    }
  }

  const totalMatches = items.length;
  const slice = items.slice(startingIndex, startingIndex + count);
  return {
    didl: wrapDidl(slice.join('')),
    numberReturned: slice.length,
    totalMatches,
    updateId,
  };
}

export function browseContentDirectory(
  objectId: string,
  startingIndex: number,
  requestedCount: number,
  baseUrl: string,
): BrowseResult {
  return browseObject(objectId || DLNA_ROOT_ID, startingIndex, requestedCount, baseUrl);
}

export function isDlnaEnvEnabled(): boolean {
  const raw = process.env.DLNA_MEDIASERVER?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function getDlnaRuntimeOverride(): boolean | undefined {
  return runtimeDlnaEnabled;
}

export function isDlnaEnabled(): boolean {
  if (runtimeDlnaEnabled !== undefined) return runtimeDlnaEnabled;
  return isDlnaEnvEnabled();
}

export function applyDlnaEnabled(port: number, enabled: boolean): void {
  runtimeDlnaEnabled = enabled;
  const baseUrl = resolveDlnaBaseUrl(port);
  if (enabled) {
    startDlnaSsdp(port, baseUrl);
  } else {
    stopDlnaSsdp();
  }
}

export function startDlnaSsdp(port: number, baseUrl: string): void {
  if (ssdpServer) return;

  const location = `${baseUrl}/dlna/device.xml`;
  const udn = getDeviceUdn();

  const server = new Server({
    udn,
    location,
    adInterval: 30_000,
    ttl: 1800,
    ssdpSig: 'OS/version UPnP/1.0 Sovereign-Tier34/1.0',
    explicitSocketBind: process.platform === 'win32',
  });

  server.addUSN('upnp:rootdevice');
  server.addUSN(udn);
  server.addUSN('urn:schemas-upnp-org:device:MediaServer:1');
  server.addUSN('urn:schemas-upnp-org:service:ContentDirectory:1');
  server.addUSN('urn:schemas-upnp-org:service:ConnectionManager:1');

  server.start().catch((err: unknown) => {
    console.error('[tier34] DLNA SSDP start failed', err);
  });

  ssdpServer = server;
  console.log(`[tier34] DLNA MediaServer SSDP advertising ${location}`);
}

export function stopDlnaSsdp(): void {
  if (!ssdpServer) return;
  try {
    ssdpServer.stop();
  } catch {
    /* ignore */
  }
  ssdpServer = null;
}
