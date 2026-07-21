/**
 * Android Auto browse/play bridge — MediaBrowserService + voice search.
 *
 * Syncs play queue, locker albums, and playlists to the native browse tree.
 * Play and voice-search requests emit events back to the WebView engine.
 *
 * See docs/android-auto.md.
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  buildAlbumCollections,
  loadPreferredEditionPrefs,
  resolvePreferredEdition,
} from './collectionIntelligence';
import type { LockerEntry } from './lockerStorage';
import type { StoredPlaylist } from './playlistStorage';
import { lockerEntryToEnvelope } from './smartPlaylistEngine';

export type AndroidAutoBrowseItem = {
  mediaId: string;
  title: string;
  artist: string;
  album?: string;
};

export type AndroidAutoBrowseAlbum = {
  id: string;
  title: string;
  artist: string;
  tracks: AndroidAutoBrowseItem[];
};

export type AndroidAutoBrowsePlaylist = {
  id: string;
  title: string;
  tracks: AndroidAutoBrowseItem[];
};

export interface AndroidAutoPlugin {
  setBrowseQueue(options: { items: AndroidAutoBrowseItem[] }): Promise<void>;
  setBrowseLibrary(options: {
    albums: AndroidAutoBrowseAlbum[];
    playlists: AndroidAutoBrowsePlaylist[];
  }): Promise<void>;
  setBrowseSearchResults(options: { items: AndroidAutoBrowseItem[] }): Promise<void>;
  addListener(
    eventName: 'playFromMediaId',
    listenerFunc: (event: { mediaId: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'searchQuery',
    listenerFunc: (event: { query: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const AndroidAuto = registerPlugin<AndroidAutoPlugin>('AndroidAuto', {
  web: () => import('./androidAuto.web').then((m) => new m.AndroidAutoWeb()),
});

let initialized = false;
let playListenerHandle: PluginListenerHandle | null = null;
let searchListenerHandle: PluginListenerHandle | null = null;

export function isAndroidAutoBridgeAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export function browseItemFromEnvelope(env: {
  envelopeId?: string;
  title?: string;
  artist?: string;
  album?: string;
}): AndroidAutoBrowseItem | null {
  const mediaId = env.envelopeId?.trim();
  if (!mediaId) return null;
  return {
    mediaId,
    title: env.title ?? 'Unknown title',
    artist: env.artist ?? 'Unknown artist',
    album: env.album,
  };
}

export async function initAndroidAutoBridge(handlers: {
  onPlayFromMediaId: (mediaId: string) => void;
  onSearchQuery?: (query: string) => void;
}): Promise<void> {
  if (!isAndroidAutoBridgeAvailable() || initialized) return;
  playListenerHandle = await AndroidAuto.addListener('playFromMediaId', (event) => {
    const id = event.mediaId?.trim();
    if (id) handlers.onPlayFromMediaId(id);
  });
  if (handlers.onSearchQuery) {
    searchListenerHandle = await AndroidAuto.addListener('searchQuery', (event) => {
      const q = event.query?.trim();
      if (q) handlers.onSearchQuery!(q);
    });
  }
  initialized = true;
}

export async function teardownAndroidAutoBridge(): Promise<void> {
  if (!initialized) return;
  await playListenerHandle?.remove();
  await searchListenerHandle?.remove();
  playListenerHandle = null;
  searchListenerHandle = null;
  initialized = false;
}

export async function syncAndroidAutoBrowseQueue(
  items: AndroidAutoBrowseItem[],
): Promise<void> {
  if (!isAndroidAutoBridgeAvailable()) return;
  await AndroidAuto.setBrowseQueue({ items }).catch(() => {});
}

export async function syncAndroidAutoBrowseLibrary(options: {
  albums: AndroidAutoBrowseAlbum[];
  playlists: AndroidAutoBrowsePlaylist[];
}): Promise<void> {
  if (!isAndroidAutoBridgeAvailable()) return;
  await AndroidAuto.setBrowseLibrary(options).catch(() => {});
}

export async function syncAndroidAutoSearchResults(
  items: AndroidAutoBrowseItem[],
): Promise<void> {
  if (!isAndroidAutoBridgeAvailable()) return;
  await AndroidAuto.setBrowseSearchResults({ items }).catch(() => {});
}

/** Build locker album + playlist nodes for Android Auto browse tree. */
export function buildAndroidAutoLibraryPayload(
  entries: LockerEntry[],
  playlists: StoredPlaylist[],
): { albums: AndroidAutoBrowseAlbum[]; playlists: AndroidAutoBrowsePlaylist[] } {
  const prefs = loadPreferredEditionPrefs();
  const collections = buildAlbumCollections(entries, undefined, prefs);
  const albums = collections
    .map((col) => {
      const edition = resolvePreferredEdition(col, prefs);
      const tracks = edition.tracks
        .map((entry) => browseItemFromEnvelope(lockerEntryToEnvelope(entry)))
        .filter((item): item is AndroidAutoBrowseItem => item != null);
      return {
        id: col.key,
        title: col.displayName || col.title,
        artist: col.artist,
        tracks,
      };
    })
    .filter((album) => album.tracks.length > 0)
    .slice(0, 100);

  const playlistNodes = playlists
    .filter((pl) => pl.tracks.length > 0)
    .map((pl) => ({
      id: pl.id,
      title: pl.name,
      tracks: pl.tracks
        .map((env) => browseItemFromEnvelope(env))
        .filter((item): item is AndroidAutoBrowseItem => item != null),
    }))
    .filter((pl) => pl.tracks.length > 0)
    .slice(0, 50);

  return { albums, playlists: playlistNodes };
}
