/**
 * SQLite media graph — envelopes, sources, content-addressed hashes (dedup).
 * Uses Node built-in node:sqlite (no extra dependency).
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { blobPathForHash, LOCKER_STORAGE_ROOT } from './lockerPaths.js';
import type { LockerSyncManifestEntry } from './lockerStorage.js';

const DB_PATH = path.join(LOCKER_STORAGE_ROOT, 'media-graph.db');

export type SourceOrigin = 'youtube' | 'debrid' | 'local' | 'proxy' | 'local-import';

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(LOCKER_STORAGE_ROOT, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS hashes (
      sha256 TEXT PRIMARY KEY,
      blob_path TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      ref_count INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS envelopes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album_name TEXT,
      musicbrainz_release_id TEXT,
      musicbrainz_release_group_id TEXT,
      duration_seconds REAL DEFAULT 0,
      cover_hash TEXT,
      release_year TEXT,
      credits_json TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_id TEXT NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
      origin TEXT NOT NULL CHECK(origin IN ('youtube', 'debrid', 'local', 'proxy')),
      uri TEXT,
      content_hash TEXT NOT NULL REFERENCES hashes(sha256) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      UNIQUE(envelope_id, origin, content_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_sources_hash ON sources(content_hash);
    CREATE INDEX IF NOT EXISTS idx_envelopes_mb ON envelopes(musicbrainz_release_id);
  `);
  migrateEnvelopesSchema(db);
  migrateSourcesOriginCheck(db);
  return db;
}

function migrateSourcesOriginCheck(database: DatabaseSync): void {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sources'")
    .get() as { sql?: string } | undefined;
  if (row?.sql?.includes('local-import')) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS sources_migrated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_id TEXT NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
      origin TEXT NOT NULL CHECK(origin IN ('youtube', 'debrid', 'local', 'proxy', 'local-import')),
      uri TEXT,
      content_hash TEXT NOT NULL REFERENCES hashes(sha256) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      UNIQUE(envelope_id, origin, content_hash)
    );
    INSERT OR IGNORE INTO sources_migrated (id, envelope_id, origin, uri, content_hash, added_at)
      SELECT id, envelope_id, origin, uri, content_hash, added_at FROM sources;
    DROP TABLE sources;
    ALTER TABLE sources_migrated RENAME TO sources;
    CREATE INDEX IF NOT EXISTS idx_sources_hash ON sources(content_hash);
  `);
}

function migrateEnvelopesSchema(database: DatabaseSync): void {
  const cols = database.prepare('PRAGMA table_info(envelopes)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('musicbrainz_release_group_id')) {
    database.exec('ALTER TABLE envelopes ADD COLUMN musicbrainz_release_group_id TEXT');
  }
}

export type EnvelopeSource = {
  id: number;
  envelopeId: string;
  origin: SourceOrigin;
  uri: string | null;
  contentHash: string;
  addedAt: number;
};

export type TrackSearchDocument = {
  id: string;
  envelopeId: string;
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  genre: string;
  year: string;
  label: string;
  hash: string;
  source: string;
  lossless: boolean;
  musicbrainzReleaseId: string;
  musicbrainzReleaseGroupId: string;
};

/** True when SHA-256 already exists in the hashes table (dedup bypass). */
export function hashExists(sha256: string): boolean {
  const safe = sha256.replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (safe.length !== 64) return false;
  const database = getDb();
  const row = database
    .prepare('SELECT sha256 FROM hashes WHERE sha256 = ?')
    .get(safe) as { sha256: string } | undefined;
  return Boolean(row);
}

/** Register or bump ref-count for a content hash (dedup by SHA-256). */
export function upsertHash(sha256: string, bytes: number): void {
  const safe = sha256.replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (safe.length !== 64) return;

  const database = getDb();
  const blobPath = blobPathForHash(safe);
  const now = Date.now();

  const existing = database
    .prepare('SELECT sha256, ref_count FROM hashes WHERE sha256 = ?')
    .get(safe) as { sha256: string; ref_count: number } | undefined;

  if (existing) {
    database
      .prepare('UPDATE hashes SET ref_count = ref_count + 1 WHERE sha256 = ?')
      .run(safe);
    return;
  }

  database
    .prepare(
      'INSERT INTO hashes (sha256, blob_path, bytes, ref_count, created_at) VALUES (?, ?, ?, 1, ?)',
    )
    .run(safe, blobPath, bytes, now);
}

export function upsertEnvelope(entry: LockerSyncManifestEntry): void {
  if (!entry?.id || !entry.contentHash) return;

  const database = getDb();
  const now = Date.now();

  database
    .prepare(`
      INSERT INTO envelopes (
        id, title, artist, album_name, musicbrainz_release_id, musicbrainz_release_group_id,
        duration_seconds, cover_hash, release_year, credits_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        artist = excluded.artist,
        album_name = excluded.album_name,
        musicbrainz_release_id = COALESCE(excluded.musicbrainz_release_id, envelopes.musicbrainz_release_id),
        musicbrainz_release_group_id = COALESCE(excluded.musicbrainz_release_group_id, envelopes.musicbrainz_release_group_id),
        duration_seconds = excluded.duration_seconds,
        cover_hash = COALESCE(excluded.cover_hash, envelopes.cover_hash),
        release_year = COALESCE(excluded.release_year, envelopes.release_year),
        credits_json = COALESCE(excluded.credits_json, envelopes.credits_json),
        updated_at = excluded.updated_at
    `)
    .run(
      entry.id,
      entry.title ?? '',
      entry.artist ?? '',
      entry.albumName ?? null,
      entry.musicbrainzReleaseId ?? null,
      entry.musicbrainzReleaseGroupId ?? null,
      entry.durationSeconds ?? 0,
      entry.coverHash ?? null,
      entry.releaseYear ?? null,
      entry.creditsJson ?? null,
      now,
    );
}

export function linkSource(
  envelopeId: string,
  origin: SourceOrigin,
  contentHash: string,
  uri?: string,
): void {
  const hash = contentHash.replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (!envelopeId || hash.length !== 64) return;

  const database = getDb();
  database
    .prepare(`
      INSERT INTO sources (envelope_id, origin, uri, content_hash, added_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(envelope_id, origin, content_hash) DO UPDATE SET
        uri = COALESCE(excluded.uri, sources.uri),
        added_at = excluded.added_at
    `)
    .run(envelopeId, origin, uri ?? null, hash, Date.now());
}

/** Sync manifest row + audio hash into the graph. */
export function syncManifestEntry(
  entry: LockerSyncManifestEntry,
  origin: SourceOrigin = 'local',
): void {
  let bytes = 0;
  try {
    const fp = blobPathForHash(entry.contentHash);
    if (fs.existsSync(fp)) bytes = fs.statSync(fp).size;
  } catch {
    /* optional */
  }
  upsertHash(entry.contentHash, bytes);
  upsertEnvelope(entry);
  linkSource(entry.id, origin, entry.contentHash, entry.remoteBlobUrl);

  if (entry.coverHash) {
    let coverBytes = 0;
    try {
      const fp = blobPathForHash(entry.coverHash);
      if (fs.existsSync(fp)) coverBytes = fs.statSync(fp).size;
    } catch {
      /* optional */
    }
    upsertHash(entry.coverHash, coverBytes);
    linkSource(entry.id, 'local', entry.coverHash, `/api/locker/blob/${entry.coverHash}`);
  }
}

/** Called when acquire worker stores a blob from a remote source. */
export function syncAcquireBlob(
  envelopeId: string,
  contentHash: string,
  bytes: number,
  origin: SourceOrigin,
  uri?: string,
  envelope?: Partial<LockerSyncManifestEntry>,
): void {
  upsertHash(contentHash, bytes);
  if (envelope) {
    upsertEnvelope({
      id: envelopeId,
      contentHash,
      title: envelope.title ?? '',
      artist: envelope.artist ?? '',
      albumName: envelope.albumName,
      durationSeconds: envelope.durationSeconds ?? 0,
      addedAt: Date.now(),
      version: envelope.version ?? 1,
      musicbrainzReleaseId: envelope.musicbrainzReleaseId,
      musicbrainzReleaseGroupId: envelope.musicbrainzReleaseGroupId,
      coverHash: envelope.coverHash,
      releaseYear: envelope.releaseYear,
      creditsJson: envelope.creditsJson,
    });
  }
  linkSource(envelopeId, origin, contentHash, uri);
}

export function getSourcesForEnvelope(envelopeId: string): EnvelopeSource[] {
  const database = getDb();
  const rows = database
    .prepare(`
      SELECT id, envelope_id, origin, uri, content_hash, added_at
      FROM sources WHERE envelope_id = ?
      ORDER BY added_at ASC
    `)
    .all(envelopeId) as Array<{
      id: number;
      envelope_id: string;
      origin: SourceOrigin;
      uri: string | null;
      content_hash: string;
      added_at: number;
    }>;

  return rows.map((r) => ({
    id: r.id,
    envelopeId: r.envelope_id,
    origin: r.origin,
    uri: r.uri,
    contentHash: r.content_hash,
    addedAt: r.added_at,
  }));
}

export function findEnvelopesByContentHash(hash: string): Array<{ id: string; title: string; artist: string }> {
  const safe = hash.replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (safe.length !== 64) return [];

  const database = getDb();
  const rows = database
    .prepare(`
      SELECT DISTINCT e.id, e.title, e.artist
      FROM envelopes e
      JOIN sources s ON s.envelope_id = e.id
      WHERE s.content_hash = ?
    `)
    .all(safe) as Array<{ id: string; title: string; artist: string }>;

  return rows;
}

/** Flat documents for Meilisearch indexing. */
export function getAllTrackDocuments(
  manifestEntries: LockerSyncManifestEntry[],
): TrackSearchDocument[] {
  const database = getDb();
  const docs: TrackSearchDocument[] = [];
  const seen = new Set<string>();

  for (const entry of manifestEntries) {
    if (!entry?.id || !entry.contentHash) continue;
    const key = `${entry.id}::${entry.contentHash}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const sources = getSourcesForEnvelope(entry.id);
    const primarySource = sources.find((s) => s.contentHash === entry.contentHash) ?? sources[0];

    docs.push({
      id: key,
      envelopeId: entry.id,
      title: entry.title ?? '',
      artist: entry.artist ?? '',
      albumArtist: extractAlbumArtist(entry.creditsJson, entry.artist ?? ''),
      album: entry.albumName ?? '',
      genre: extractGenre(entry.creditsJson),
      year: entry.releaseYear ?? '',
      label: extractLabel(entry.creditsJson),
      hash: entry.contentHash,
      source: primarySource?.origin ?? 'local',
      lossless: isLosslessBlob(entry.contentHash),
      musicbrainzReleaseId: entry.musicbrainzReleaseId ?? '',
      musicbrainzReleaseGroupId: entry.musicbrainzReleaseGroupId ?? extractReleaseGroupId(entry.creditsJson),
    });
  }

  const orphanRows = database
    .prepare(`
      SELECT e.id, e.title, e.artist, e.album_name, e.release_year, e.musicbrainz_release_id,
             e.musicbrainz_release_group_id, s.content_hash, s.origin
      FROM envelopes e
      JOIN sources s ON s.envelope_id = e.id
      WHERE s.origin != 'local' OR s.uri NOT LIKE '%cover%'
    `)
    .all() as Array<{
      id: string;
      title: string;
      artist: string;
      album_name: string | null;
      release_year: string | null;
      musicbrainz_release_id: string | null;
      musicbrainz_release_group_id: string | null;
      content_hash: string;
      origin: SourceOrigin;
    }>;

  for (const row of orphanRows) {
    const key = `${row.id}::${row.content_hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    docs.push({
      id: key,
      envelopeId: row.id,
      title: row.title,
      artist: row.artist,
      albumArtist: row.artist,
      album: row.album_name ?? '',
      genre: '',
      year: row.release_year ?? '',
      label: '',
      hash: row.content_hash,
      source: row.origin,
      lossless: isLosslessBlob(row.content_hash),
      musicbrainzReleaseId: row.musicbrainz_release_id ?? '',
      musicbrainzReleaseGroupId: row.musicbrainz_release_group_id ?? '',
    });
  }

  return docs;
}

function extractGenre(creditsJson?: string): string {
  if (!creditsJson) return '';
  try {
    const parsed = JSON.parse(creditsJson) as { genre?: string; genres?: string[] };
    if (parsed.genre) return parsed.genre;
    if (Array.isArray(parsed.genres) && parsed.genres[0]) return parsed.genres[0];
  } catch {
    /* ignore */
  }
  return '';
}

function extractAlbumArtist(creditsJson: string | undefined, fallback: string): string {
  if (!creditsJson) return fallback;
  try {
    const parsed = JSON.parse(creditsJson) as { albumArtist?: string };
    const aa = parsed.albumArtist?.trim();
    if (aa) return aa;
  } catch {
    /* ignore */
  }
  return fallback;
}

function extractLabel(creditsJson?: string): string {
  if (!creditsJson) return '';
  try {
    const parsed = JSON.parse(creditsJson) as { label?: string; labels?: string[] };
    if (parsed.label?.trim()) return parsed.label.trim();
    if (Array.isArray(parsed.labels) && parsed.labels[0]?.trim()) return parsed.labels[0].trim();
  } catch {
    /* ignore */
  }
  return '';
}

/** Detect FLAC/WAV/AIFF from blob magic bytes at index time. */
export function isLosslessBlob(hash: string): boolean {
  try {
    const fp = blobPathForHash(hash);
    if (!fs.existsSync(fp)) return false;
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(fp, 'r');
    try {
      fs.readSync(fd, buf, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }
    const magic = buf.toString('ascii', 0, 4);
    return magic === 'fLaC' || magic === 'RIFF' || magic === 'FORM';
  } catch {
    return false;
  }
}

function extractReleaseGroupId(creditsJson?: string): string {
  if (!creditsJson) return '';
  try {
    const parsed = JSON.parse(creditsJson) as { musicbrainzReleaseGroupId?: string };
    return parsed.musicbrainzReleaseGroupId?.trim() ?? '';
  } catch {
    return '';
  }
}

export function getGraphStats(): {
  envelopes: number;
  sources: number;
  hashes: number;
  dedupedBytes: number;
  duplicateHashes: Array<{ hash: string; refCount: number }>;
} {
  const database = getDb();
  const envelopes =
    (database.prepare('SELECT COUNT(*) AS c FROM envelopes').get() as { c: number }).c ?? 0;
  const sources =
    (database.prepare('SELECT COUNT(*) AS c FROM sources').get() as { c: number }).c ?? 0;
  const hashRow = database
    .prepare('SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM hashes')
    .get() as { c: number; b: number };

  const duplicateHashes = (
    database
      .prepare(
        'SELECT sha256 AS hash, ref_count AS refCount FROM hashes WHERE ref_count > 1 ORDER BY ref_count DESC LIMIT 24',
      )
      .all() as Array<{ hash: string; refCount: number }>
  ).map((row) => ({ hash: row.hash, refCount: row.refCount }));

  return {
    envelopes,
    sources,
    hashes: hashRow.c ?? 0,
    dedupedBytes: hashRow.b ?? 0,
    duplicateHashes,
  };
}

/** Backfill graph from existing manifest (idempotent). */
export function backfillFromManifest(entries: LockerSyncManifestEntry[]): void {
  for (const entry of entries) {
    syncManifestEntry(entry, 'local');
  }
}
