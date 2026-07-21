/**
 * Group MediaStore audiobook hits into books (multi-file chapters → one entry).
 * Display-label cleanup only — never mutates files on disk.
 */

import type { DeviceMusicScanHit } from './lockerUploadFilter';
import {
  isBadAudiobookAuthor,
  isBadAudiobookTitle,
  type AudiobookMetaEnrichment,
} from './audiobookMetadata';

const CHAPTER_SUFFIX_RE =
  /\s*[-–—_]?\s*(?:disc|cd|part|pt\.?|chapter|ch\.?|file|track)\s*[\d._-]+(?:\s*(?:of|\/)\s*[\d._-]+)?$/i;
const NUMBERED_PREFIX_RE = /^(?:\d{1,3}[\s._-]+)+/;

export type AudiobookChapter = DeviceMusicScanHit & {
  chapterLabel: string;
};

export type AudiobookBook = {
  key: string;
  title: string;
  author: string;
  tracks: AudiobookChapter[];
  durationSeconds: number;
  coverUrl?: string;
  metaSource?: AudiobookMetaEnrichment['source'];
};

function stripExt(name: string): string {
  return name.replace(/\.(m4b|mp3|m4a|aac|flac|ogg|wav|aa|aax)$/i, '').trim();
}

function cleanLabel(raw: string): string {
  return raw
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best-effort book title from MediaStore tags / folder / filename. */
export function resolveAudiobookTitle(hit: DeviceMusicScanHit): string {
  const album = hit.album?.trim();
  if (album && !isBadAudiobookTitle(album)) return cleanLabel(album);

  const folder = hit.folder?.trim();
  if (
    folder &&
    !isBadAudiobookTitle(folder) &&
    !/^(audiobooks?|books?|download|downloads|music)$/i.test(folder)
  ) {
    return cleanLabel(folder);
  }

  const title = hit.title?.trim();
  if (title && !isBadAudiobookTitle(title)) {
    const stripped = title
      .replace(CHAPTER_SUFFIX_RE, '')
      .replace(NUMBERED_PREFIX_RE, '')
      .trim();
    if (stripped && !isBadAudiobookTitle(stripped)) return cleanLabel(stripped);
    return cleanLabel(title);
  }

  const display = stripExt(hit.displayName || '');
  if (display) {
    const stripped = display
      .replace(CHAPTER_SUFFIX_RE, '')
      .replace(NUMBERED_PREFIX_RE, '')
      .trim();
    if (stripped) return cleanLabel(stripped);
    return cleanLabel(display);
  }
  return 'Untitled audiobook';
}

export function resolveAudiobookAuthor(hit: DeviceMusicScanHit): string {
  const artist = hit.artist?.trim();
  if (artist && !isBadAudiobookAuthor(artist)) return cleanLabel(artist);
  return 'Unknown author';
}

function chapterLabel(hit: DeviceMusicScanHit, index: number): string {
  const title = hit.title?.trim();
  if (title && !isBadAudiobookTitle(title)) return cleanLabel(title);
  const display = stripExt(hit.displayName || '');
  if (display) return cleanLabel(display);
  return `Chapter ${index + 1}`;
}

function sortChapters(tracks: DeviceMusicScanHit[]): DeviceMusicScanHit[] {
  return [...tracks].sort((a, b) => {
    const an = a.displayName || a.title || '';
    const bn = b.displayName || b.title || '';
    return an.localeCompare(bn, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/** Group raw scan hits into books; chapters share album/folder when possible. */
export function groupAudiobookHits(hits: DeviceMusicScanHit[]): AudiobookBook[] {
  const map = new Map<string, DeviceMusicScanHit[]>();

  for (const hit of hits) {
    const title = resolveAudiobookTitle(hit);
    const author = resolveAudiobookAuthor(hit);
    const key = `${title.toLowerCase()}::${author.toLowerCase()}`;
    const list = map.get(key) ?? [];
    list.push(hit);
    map.set(key, list);
  }

  return [...map.entries()]
    .map(([key, rawTracks]) => {
      const tracks = sortChapters(rawTracks);
      const sample = tracks[0]!;
      const title = resolveAudiobookTitle(sample);
      const author = resolveAudiobookAuthor(sample);
      const chapters: AudiobookChapter[] = tracks.map((t, i) => ({
        ...t,
        chapterLabel: chapterLabel(t, i),
      }));
      const durationSeconds = chapters.reduce(
        (sum, row) => sum + (row.durationMs > 0 ? Math.round(row.durationMs / 1000) : 0),
        0,
      );
      return { key, title, author, tracks: chapters, durationSeconds };
    })
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

/** Apply cached/online enrichment onto a book (display only). */
export function applyAudiobookEnrichment(
  book: AudiobookBook,
  enrichment: AudiobookMetaEnrichment | undefined,
): AudiobookBook {
  if (!enrichment || enrichment.source === 'local') {
    return {
      ...book,
      coverUrl: enrichment?.coverUrl ?? book.coverUrl,
      metaSource: enrichment?.source ?? book.metaSource,
    };
  }
  return {
    ...book,
    title: enrichment.title?.trim() || book.title,
    author:
      enrichment.author && !isBadAudiobookAuthor(enrichment.author)
        ? enrichment.author
        : book.author,
    coverUrl: enrichment.coverUrl ?? book.coverUrl,
    metaSource: enrichment.source,
  };
}
