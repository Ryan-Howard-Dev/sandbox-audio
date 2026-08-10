/**
 * Turning each station's own storage into the one shape the health analysis reads.
 *
 * Kept apart from libraryHealth on purpose: the analysis is pure and knows nothing about locker
 * rows or RSS feeds, and these adapters know nothing about what counts as a problem. When a station
 * changes its storage shape, only the adapter moves.
 *
 * Coverage is honestly uneven, and the report says so rather than pretending otherwise:
 *
 *   music      locker rows, complete
 *   podcast    episodes cached for offline, which is the only podcast audio held locally
 *   document   the imported documents and books store, complete
 *   audiobook  no persistent store exists — the library is scanned into view state each time — so
 *              on the desktop these come from the files in an audiobook folder, and on the phone
 *              they are absent
 */

import type { LockerEntry } from './lockerStorage';
import type { HealthItem, HealthStation, ScannedFile } from './libraryHealth';
import type { FileEntry, LibraryRoot, RootKind } from './libraryFs';

export function lockerItems(entries: readonly LockerEntry[]): HealthItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    station: 'music' as const,
    title: entry.title,
    artist: entry.artist,
    album: entry.albumName,
    artworkUrl: entry.albumArt,
    path: filePathFromUrl(entry.url),
    durationSeconds: entry.durationSeconds,
  }));
}

/** The shape loadOfflinePodcastEpisodes returns, narrowed to what is read here. */
export interface OfflineEpisodeLike {
  feedId: string;
  feedTitle: string;
  feedArtworkUrl?: string;
  episode: {
    id: string;
    title: string;
    artworkUrl?: string;
    durationSeconds?: number;
    audioUrl: string;
  };
}

export function podcastItems(rows: readonly OfflineEpisodeLike[]): HealthItem[] {
  return rows.map((row) => ({
    id: row.episode.id,
    station: 'podcast' as const,
    title: row.episode.title,
    // The show is the artist here: it is what a listener would name if asked whose this is.
    artist: row.feedTitle,
    album: row.feedTitle,
    // An episode without its own art is not missing art; it inherits the show's.
    artworkUrl: row.episode.artworkUrl ?? row.feedArtworkUrl,
    durationSeconds: row.episode.durationSeconds,
  }));
}

/** The shape listDocuments returns, narrowed to what is read here. */
export interface DocumentLike {
  id: string;
  name: string;
  author?: string;
  coverUrl?: string;
  kind?: string;
}

export function documentItems(docs: readonly DocumentLike[]): HealthItem[] {
  return docs.map((doc) => ({
    id: doc.id,
    station: 'document' as const,
    title: doc.name,
    artist: doc.author,
    artworkUrl: doc.coverUrl,
  }));
}

const KIND_TO_STATION: Record<RootKind, HealthStation> = {
  music: 'music',
  podcast: 'podcast',
  audiobook: 'audiobook',
  document: 'document',
};

/**
 * Tag each scanned file with the station whose folder it came from.
 *
 * Without this every unrecognised file lands under music, so a shelf of audiobooks reads as a music
 * problem. The root a file sits beneath is the only statement anybody has made about what it is.
 */
export function attributeFilesToStations(
  files: readonly FileEntry[],
  roots: readonly LibraryRoot[],
): ScannedFile[] {
  const sorted = [...roots].sort((a, b) => b.path.length - a.path.length);
  return files.map((file) => {
    const owner = sorted.find((root) => isUnder(file.path, root.path));
    return {
      path: file.path,
      name: file.name,
      isDir: file.isDir,
      size: file.size,
      extension: file.extension,
      station: owner ? KIND_TO_STATION[owner.kind] : undefined,
    };
  });
}

function isUnder(path: string, root: string): boolean {
  const p = path.replace(/\\/g, '/').toLowerCase();
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return p === r || p.startsWith(`${r}/`);
}

/**
 * The filesystem path behind a locker row's url, where there is one.
 *
 * Rows point at blob urls, http streams from the server, or real files. Only the last of those can
 * go missing from disk, so anything else returns undefined and is never reported as a missing file.
 */
export function filePathFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('file://')) {
    try {
      const decoded = decodeURIComponent(trimmed.slice('file://'.length));
      // file:///C:/x on Windows arrives with a leading slash before the drive letter.
      return /^\/[a-zA-Z]:/.test(decoded) ? decoded.slice(1) : decoded;
    } catch {
      return undefined;
    }
  }
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  return undefined;
}
