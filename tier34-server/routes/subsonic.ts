/**
 * OpenSubsonic read-only REST API — Symfonium/Feishin compatibility.
 * Maps locker manifest entries to Subsonic song/album/artist objects.
 */

import type { Express, Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import {
  blobExists,
  blobPathForHash,
  loadMasterManifest,
  type LockerSyncManifestEntry,
} from '../lib/lockerStorage.js';
import { isSubsonicEnabled, verifySubsonicAuth } from '../lib/subsonicAuth.js';
import { maybeApplyInterminableTide } from '../lib/interminableTide.js';
import { searchTracks } from '../lib/meilisearchIndexer.js';

const API_VERSION = '1.16.1';
const SERVER_NAME = 'Sandbox Music Locker';

type SubsonicQuery = Record<string, string | undefined>;

function queryParams(req: Request): SubsonicQuery {
  const out: SubsonicQuery = {};
  for (const [k, v] of Object.entries(req.query)) {
    out[k] = Array.isArray(v) ? String(v[0]) : v != null ? String(v) : undefined;
  }
  return out;
}

function wantsJson(req: Request, q: SubsonicQuery): boolean {
  const f = (q.f ?? '').toLowerCase();
  if (f === 'json') return true;
  if (f === 'xml') return false;
  const accept = req.headers.accept ?? '';
  return accept.includes('json');
}

function subsonicError(
  req: Request,
  res: Response,
  code: number,
  message: string,
  q: SubsonicQuery,
): void {
  const payload = {
    'subsonic-response': {
      status: 'failed',
      version: API_VERSION,
      error: { code, message },
    },
  };
  if (wantsJson(req, q)) {
    res.status(200).json(payload);
  } else {
    res
      .status(200)
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><subsonic-response xmlns="http://subsonic.org/restapi" status="failed" version="${API_VERSION}"><error code="${code}" message="${escapeXml(message)}"/></subsonic-response>`,
      );
  }
}

function subsonicOk(req: Request, res: Response, q: SubsonicQuery, body: Record<string, unknown>): void {
  const payload = {
    'subsonic-response': {
      status: 'ok',
      version: API_VERSION,
      ...body,
    },
  };
  if (wantsJson(req, q)) {
    res.json(payload);
  } else {
    res.status(200).type('application/xml').send(jsonToSubsonicXml(payload['subsonic-response']));
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jsonToSubsonicXml(obj: Record<string, unknown>): string {
  const inner = objectToXml(obj, ['subsonic-response']);
  return `<?xml version="1.0" encoding="UTF-8"?><subsonic-response xmlns="http://subsonic.org/restapi" ${attrsFromObject(obj)}>${inner}</subsonic-response>`;
}

function attrsFromObject(obj: Record<string, unknown>): string {
  const attrs: string[] = [];
  if (obj.status != null) attrs.push(`status="${escapeXml(String(obj.status))}"`);
  if (obj.version != null) attrs.push(`version="${escapeXml(String(obj.version))}"`);
  return attrs.join(' ');
}

function objectToXml(obj: Record<string, unknown>, skipKeys: string[] = []): string {
  let xml = '';
  for (const [key, value] of Object.entries(obj)) {
    if (skipKeys.includes(key)) continue;
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          xml += `<${key}${objectAttrs(item as Record<string, unknown>)}>${objectToXml(item as Record<string, unknown>)}</${key}>`;
        } else {
          xml += `<${key}>${escapeXml(String(item))}</${key}>`;
        }
      }
    } else if (typeof value === 'object') {
      xml += `<${key}${objectAttrs(value as Record<string, unknown>)}>${objectToXml(value as Record<string, unknown>)}</${key}>`;
    } else {
      xml += `<${key}>${escapeXml(String(value))}</${key}>`;
    }
  }
  return xml;
}

function objectAttrs(obj: Record<string, unknown>): string {
  const scalarKeys = [
    'id',
    'name',
    'title',
    'album',
    'artist',
    'albumId',
    'artistId',
    'coverArt',
    'duration',
    'bitRate',
    'suffix',
    'contentType',
    'path',
    'isDir',
    'type',
    'created',
    'year',
    'songCount',
    'parent',
    'size',
    'discNumber',
    'track',
  ];
  let attrs = '';
  for (const key of scalarKeys) {
    if (obj[key] != null && typeof obj[key] !== 'object') {
      attrs += ` ${key}="${escapeXml(String(obj[key]))}"`;
    }
  }
  return attrs;
}

function requireAuth(req: Request, res: Response, q: SubsonicQuery): boolean {
  if (!verifySubsonicAuth(q)) {
    subsonicError(req, res, 40, 'Wrong username or password.', q);
    return false;
  }
  return true;
}

function albumKey(entry: LockerSyncManifestEntry): string {
  const album = entry.albumName?.trim() || 'Unknown Album';
  const artist = entry.artist?.trim() || 'Unknown Artist';
  return `album-${hashKey(`${artist}::${album}`)}`;
}

function artistKey(name: string): string {
  return `artist-${hashKey(name)}`;
}

function hashKey(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

function suffixFromHash(hash: string): string {
  const blob = blobPathForHash(hash);
  const ext = path.extname(blob).toLowerCase();
  if (ext === '.flac') return 'flac';
  if (ext === '.mp3') return 'mp3';
  if (ext === '.ogg') return 'ogg';
  if (ext === '.m4a') return 'm4a';
  if (ext === '.opus') return 'opus';
  if (ext === '.wav') return 'wav';
  return 'mp3';
}

function contentTypeForSuffix(suffix: string): string {
  switch (suffix) {
    case 'flac':
      return 'audio/flac';
    case 'ogg':
      return 'audio/ogg';
    case 'm4a':
      return 'audio/mp4';
    case 'opus':
      return 'audio/opus';
    case 'wav':
      return 'audio/wav';
    default:
      return 'audio/mpeg';
  }
}

function entryToSong(entry: LockerSyncManifestEntry, baseUrl: string) {
  const suffix = suffixFromHash(entry.contentHash);
  const album = entry.albumName?.trim() || 'Unknown Album';
  const artist = entry.artist?.trim() || 'Unknown Artist';
  const aKey = artistKey(artist);
  const albKey = albumKey(entry);
  return {
    id: entry.id,
    parent: albKey,
    title: entry.title,
    album,
    artist,
    albumId: albKey,
    artistId: aKey,
    coverArt: entry.coverHash ?? entry.id,
    duration: entry.durationSeconds > 0 ? entry.durationSeconds : 180,
    bitRate: suffix === 'flac' ? 1411 : 320,
    suffix,
    contentType: contentTypeForSuffix(suffix),
    path: `${baseUrl}/rest/stream.view?id=${encodeURIComponent(entry.id)}`,
    created: new Date(entry.addedAt).toISOString(),
    year: entry.releaseYear ? Number.parseInt(entry.releaseYear, 10) || undefined : undefined,
    track: 1,
    discNumber: 1,
    size: 0,
    isDir: false,
  };
}

function buildAlbums(entries: LockerSyncManifestEntry[]) {
  const map = new Map<
    string,
    {
      id: string;
      name: string;
      artist: string;
      artistId: string;
      coverArt: string;
      songCount: number;
      created: string;
      year?: number;
    }
  >();

  for (const entry of entries) {
    const key = albumKey(entry);
    const artist = entry.artist?.trim() || 'Unknown Artist';
    const album = entry.albumName?.trim() || 'Unknown Album';
    const existing = map.get(key);
    if (existing) {
      existing.songCount += 1;
      if (entry.addedAt > Date.parse(existing.created)) {
        existing.created = new Date(entry.addedAt).toISOString();
      }
    } else {
      map.set(key, {
        id: key,
        name: album,
        artist,
        artistId: artistKey(artist),
        coverArt: entry.coverHash ?? entry.id,
        songCount: 1,
        created: new Date(entry.addedAt).toISOString(),
        year: entry.releaseYear ? Number.parseInt(entry.releaseYear, 10) || undefined : undefined,
      });
    }
  }
  return [...map.values()];
}

function buildArtists(entries: LockerSyncManifestEntry[]) {
  const map = new Map<
    string,
    { id: string; name: string; coverArt?: string; albumCount: number; songCount: number }
  >();
  for (const entry of entries) {
    const name = entry.artist?.trim() || 'Unknown Artist';
    const key = artistKey(name);
    const existing = map.get(key);
    if (existing) {
      existing.songCount += 1;
      if (!existing.coverArt && entry.coverHash) existing.coverArt = entry.coverHash;
    } else {
      map.set(key, {
        id: key,
        name,
        coverArt: entry.coverHash ?? entry.id,
        albumCount: 0,
        songCount: 1,
      });
    }
  }
  for (const artist of map.values()) {
    artist.albumCount = new Set(
      entries
        .filter((e) => artistKey(e.artist?.trim() || 'Unknown Artist') === artist.id)
        .map((e) => albumKey(e)),
    ).size;
  }
  return [...map.values()];
}

function loadPlaylistsFromManifest() {
  const manifest = loadMasterManifest();
  if (!Array.isArray(manifest.playlists)) return [];
  return manifest.playlists.filter((pl) => pl?.id && pl?.name);
}

function findEntryById(id: string): LockerSyncManifestEntry | undefined {
  const manifest = loadMasterManifest();
  return manifest.entries.find((e) => e.id === id || e.contentHash === id);
}

function resolveCoverHash(id: string): string | null {
  const manifest = loadMasterManifest();
  const entry = manifest.entries.find(
    (e) => e.id === id || e.coverHash === id || e.contentHash === id,
  );
  if (entry?.coverHash && blobExists(entry.coverHash)) return entry.coverHash;
  if (blobExists(id)) return id;
  return null;
}

export function registerSubsonicRoutes(app: Express, port: number): boolean {
  if (!isSubsonicEnabled()) return false;

  const baseUrl = () => {
    const env = process.env.SUBSONIC_BASE_URL?.trim();
    if (env) return env.replace(/\/$/, '');
    return `http://localhost:${port}`;
  };

  const handleRest = async (req: Request, res: Response): Promise<void> => {
    const q = queryParams(req);
    const endpoint = String(req.params.endpoint ?? '').replace(/\.view$/i, '').toLowerCase();

    if (endpoint === 'stream') {
      const tideHandled = await maybeApplyInterminableTide(req, res, {
        pathKind: 'subsonic_stream',
        subsonicQuery: q,
      });
      if (tideHandled) return;
      if (!requireAuth(req, res, q)) return;

      const id = String(q.id ?? '').trim();
      const entry = findEntryById(id);
      if (!entry || !blobExists(entry.contentHash)) {
        subsonicError(req, res, 70, 'Song not found.', q);
        return;
      }
      const suffix = suffixFromHash(entry.contentHash);
      res.setHeader('Content-Type', contentTypeForSuffix(suffix));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('X-Content-Hash', entry.contentHash);
      createReadStream(blobPathForHash(entry.contentHash)).pipe(res);
      return;
    }

    if (!requireAuth(req, res, q)) return;

    const manifest = loadMasterManifest();
    const entries = manifest.entries;
    const urlBase = baseUrl();

    switch (endpoint) {
      case 'ping':
        subsonicOk(req, res, q, {});
        return;

      case 'getlicense':
        subsonicOk(req, res, q, {
          license: { valid: true, email: 'sandbox@local', expires: '2099-12-31' },
        });
        return;

      case 'getmusicfolders':
        subsonicOk(req, res, q, {
          musicFolders: { musicFolder: [{ id: 0, name: 'Locker' }] },
        });
        return;

      case 'search2': {
        const query = String(q.query ?? '').trim();
        let hits = entries;
        if (query) {
          void searchTracks(query, { limit: 50 })
            .then((result) => {
              if (result.ok && result.hits.length > 0) {
                const ids = new Set(result.hits.map((h) => h.envelopeId));
                hits = entries.filter((e) => ids.has(e.id));
              } else {
                const lower = query.toLowerCase();
                hits = entries.filter(
                  (e) =>
                    e.title.toLowerCase().includes(lower) ||
                    e.artist.toLowerCase().includes(lower) ||
                    (e.albumName ?? '').toLowerCase().includes(lower),
                );
              }
              respondSearch2(req, res, q, hits, urlBase);
            })
            .catch(() => {
              const lower = query.toLowerCase();
              hits = entries.filter(
                (e) =>
                  e.title.toLowerCase().includes(lower) ||
                  e.artist.toLowerCase().includes(lower) ||
                  (e.albumName ?? '').toLowerCase().includes(lower),
              );
              respondSearch2(req, res, q, hits, urlBase);
            });
          return;
        }
        respondSearch2(req, res, q, hits.slice(0, 50), urlBase);
        return;
      }

      case 'getalbumlist2':
      case 'getalbumlist': {
        const type = String(q.type ?? 'newest').toLowerCase();
        const size = Math.min(500, Math.max(1, Number.parseInt(String(q.size ?? '50'), 10) || 50));
        let albums = buildAlbums(entries);
        if (type === 'newest' || type === 'recent') {
          albums = albums.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
        } else if (type === 'alphabeticalbyname' || type === 'byname') {
          albums = albums.sort((a, b) => a.name.localeCompare(b.name));
        } else if (type === 'random') {
          albums = albums.sort(() => Math.random() - 0.5);
        }
        const bodyKey = endpoint === 'getalbumlist' ? 'albumList' : 'albumList2';
        subsonicOk(req, res, q, {
          [bodyKey]: { album: albums.slice(0, size) },
        });
        return;
      }

      case 'getartist':
      case 'getartist2': {
        const id = String(q.id ?? '').trim();
        const artistEntries = entries.filter(
          (e) => artistKey(e.artist?.trim() || 'Unknown Artist') === id,
        );
        if (artistEntries.length === 0) {
          subsonicError(req, res, 70, 'Artist not found.', q);
          return;
        }
        const name = artistEntries[0].artist?.trim() || 'Unknown Artist';
        const albums = buildAlbums(artistEntries);
        subsonicOk(req, res, q, {
          artist: {
            id,
            name,
            coverArt: artistEntries[0].coverHash ?? artistEntries[0].id,
            albumCount: albums.length,
            album: albums.map((a) => ({
              ...a,
              song: artistEntries
                .filter((e) => albumKey(e) === a.id)
                .map((e) => entryToSong(e, urlBase)),
            })),
          },
        });
        return;
      }

      case 'getsong': {
        const id = String(q.id ?? '').trim();
        const entry = findEntryById(id);
        if (!entry || !blobExists(entry.contentHash)) {
          subsonicError(req, res, 70, 'Song not found.', q);
          return;
        }
        subsonicOk(req, res, q, { song: entryToSong(entry, urlBase) });
        return;
      }

      case 'getrandomsongs':
      case 'getrandom': {
        const size = Math.min(500, Math.max(1, Number.parseInt(String(q.size ?? '10'), 10) || 10));
        const shuffled = [...entries].sort(() => Math.random() - 0.5);
        subsonicOk(req, res, q, {
          randomSongs: { song: shuffled.slice(0, size).map((e) => entryToSong(e, urlBase)) },
        });
        return;
      }

      case 'getplaylists': {
        const playlists = loadPlaylistsFromManifest().map((pl) => ({
          id: pl.id,
          name: pl.name,
          comment: pl.description ?? '',
          owner: 'sandbox',
          public: true,
          created: new Date(pl.updatedAt).toISOString(),
          changed: new Date(pl.updatedAt).toISOString(),
          songCount: pl.trackEnvelopeIds.length,
          duration: pl.trackEnvelopeIds.reduce((sum, tid) => {
            const e = findEntryById(tid);
            return sum + (e?.durationSeconds ?? 180);
          }, 0),
        }));
        subsonicOk(req, res, q, { playlists: { playlist: playlists } });
        return;
      }

      case 'getplaylist': {
        const id = String(q.id ?? '').trim();
        const playlist = loadPlaylistsFromManifest().find((pl) => pl.id === id);
        if (!playlist) {
          subsonicError(req, res, 70, 'Playlist not found.', q);
          return;
        }
        const songs = playlist.trackEnvelopeIds
          .map((tid) => findEntryById(tid))
          .filter((e): e is LockerSyncManifestEntry => Boolean(e && blobExists(e.contentHash)))
          .map((e) => entryToSong(e, urlBase));
        subsonicOk(req, res, q, {
          playlist: {
            id: playlist.id,
            name: playlist.name,
            comment: playlist.description ?? '',
            owner: 'sandbox',
            public: true,
            created: new Date(playlist.updatedAt).toISOString(),
            changed: new Date(playlist.updatedAt).toISOString(),
            songCount: songs.length,
            duration: songs.reduce((sum, s) => sum + (s.duration ?? 180), 0),
            entry: songs.map((song, index) => ({ ...song, playlistId: playlist.id, index })),
          },
        });
        return;
      }

      case 'getalbum':
      case 'getalbum2': {
        const id = String(q.id ?? '').trim();
        const albumEntries = entries.filter((e) => albumKey(e) === id);
        if (albumEntries.length === 0) {
          subsonicError(req, res, 70, 'Album not found.', q);
          return;
        }
        const first = albumEntries[0];
        const album = {
          id,
          name: first.albumName?.trim() || 'Unknown Album',
          artist: first.artist?.trim() || 'Unknown Artist',
          artistId: artistKey(first.artist?.trim() || 'Unknown Artist'),
          coverArt: first.coverHash ?? first.id,
          songCount: albumEntries.length,
          created: new Date(
            Math.max(...albumEntries.map((e) => e.addedAt)),
          ).toISOString(),
          year: first.releaseYear ? Number.parseInt(first.releaseYear, 10) || undefined : undefined,
          song: albumEntries.map((e) => entryToSong(e, urlBase)),
        };
        subsonicOk(req, res, q, { album });
        return;
      }

      case 'getcoverart': {
        const id = String(q.id ?? '').trim();
        const coverHash = resolveCoverHash(id);
        if (!coverHash) {
          subsonicError(req, res, 70, 'Cover art not found.', q);
          return;
        }
        res.setHeader('Content-Type', 'image/jpeg');
        createReadStream(blobPathForHash(coverHash)).pipe(res);
        return;
      }

      default:
        subsonicError(req, res, 0, `Endpoint not implemented: ${endpoint}`, q);
    }
  };

  app.get('/rest/:endpoint', handleRest);
  app.get('/rest/:endpoint.view', handleRest);

  console.log(
    `[tier34] OpenSubsonic API enabled at /rest/* (user: ${process.env.SUBSONIC_USER ?? 'sandbox'})`,
  );
  return true;
}

function respondSearch2(
  req: Request,
  res: Response,
  q: SubsonicQuery,
  hits: LockerSyncManifestEntry[],
  urlBase: string,
): void {
  const artistNames = new Set<string>();
  const albums = buildAlbums(hits);
  const songs = hits.map((e) => entryToSong(e, urlBase));
  for (const e of hits) {
    artistNames.add(e.artist?.trim() || 'Unknown Artist');
  }
  const artists = [...artistNames].map((name) => ({
    id: artistKey(name),
    name,
    coverArt: hits.find((h) => h.artist === name)?.coverHash,
    albumCount: albums.filter((a) => a.artist === name).length,
  }));

  subsonicOk(req, res, q, {
    searchResult2: {
      artist: artists.slice(0, 20),
      album: albums.slice(0, 20),
      song: songs.slice(0, 50),
    },
  });
}
