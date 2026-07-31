/**
 * Pure Gutenberg / Gutendex → audiobook catalog mapping (no network).
 */

import type { AudiobookCatalogBook, AudiobookCatalogChapter } from './audiobookRssCore.js';

export type GutendexAuthor = {
  name?: string;
  birth_year?: number | null;
  death_year?: number | null;
};

export type GutendexBook = {
  id?: number;
  title?: string;
  authors?: GutendexAuthor[];
  summaries?: string[];
  subjects?: string[];
  languages?: string[];
  media_type?: string;
  formats?: Record<string, string>;
  download_count?: number;
};

const AUDIO_MIME_PREFIXES = ['audio/mpeg', 'audio/mp4', 'audio/ogg'];

export function hasGutenbergAudio(formats: Record<string, string> | undefined): boolean {
  if (!formats) return false;
  return Object.entries(formats).some(
    ([mime, url]) =>
      AUDIO_MIME_PREFIXES.some((p) => mime.startsWith(p)) && /^https?:\/\//i.test(url),
  );
}

export function pickGutenbergAudioUrl(formats: Record<string, string>): string | undefined {
  for (const prefix of AUDIO_MIME_PREFIXES) {
    const hit = Object.entries(formats).find(([mime, url]) => mime.startsWith(prefix) && url?.trim());
    if (hit) return hit[1].trim();
  }
  return undefined;
}

export function pickGutenbergCoverUrl(formats: Record<string, string>): string | undefined {
  const jpeg = Object.entries(formats).find(([mime, url]) => mime.startsWith('image/jpeg') && url?.trim());
  return jpeg?.[1]?.trim();
}

/**
 * Plain-text edition of the work.
 *
 * Prefers a declared charset, which is the full text; the bare  entry is sometimes a
 * readme. Explicitly skips readme and index files, which would make a novel look like a pamphlet
 * and defeat the length check this feeds.
 */
export function pickGutenbergTextUrl(formats: Record<string, string>): string | undefined {
  const entries = Object.entries(formats).filter(
    ([mime, url]) =>
      mime.startsWith('text/plain') && url?.trim() && !/readme|index/i.test(url),
  );
  const withCharset = entries.find(([mime]) => mime.includes('charset='));
  return (withCharset ?? entries[0])?.[1]?.trim();
}

export function pickGutenbergIndexUrl(formats: Record<string, string>): string | undefined {
  const readme = Object.entries(formats).find(
    ([mime, url]) => mime.startsWith('text/plain') && /readme/i.test(url),
  );
  if (readme?.[1]) return readme[1].trim();
  const html = Object.entries(formats).find(
    ([mime, url]) => mime.startsWith('text/html') && /index/i.test(url),
  );
  return html?.[1]?.trim();
}

function stripHtml(raw: string | undefined): string {
  if (!raw?.trim()) return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function gutendexAuthors(book: GutendexBook): string {
  const names = (book.authors ?? [])
    .map((a) => a.name?.trim())
    .filter(Boolean) as string[];
  return names.join(', ') || 'Project Gutenberg';
}

export function gutendexBookToCatalog(book: GutendexBook): AudiobookCatalogBook | null {
  if (!book.id || !book.title?.trim()) return null;
  const formats = book.formats ?? {};
  if (book.media_type !== 'Sound' && !hasGutenbergAudio(formats)) return null;

  const sourceId = String(book.id);
  const summary = book.summaries?.[0];
  return {
    id: `gutenberg:${sourceId}`,
    sourceId,
    title: book.title.trim(),
    author: gutendexAuthors(book),
    description: stripHtml(summary),
    artworkUrl: pickGutenbergCoverUrl(formats),
    source: 'gutenberg',
    detailUrl: `https://www.gutenberg.org/ebooks/${sourceId}`,
    textUrl: pickGutenbergTextUrl(formats),
  };
}

/** Extract MP3 filenames from Gutenberg readme or index markup. */
export function parseGutenbergMp3Filenames(indexText: string): string[] {
  const found = new Set<string>();
  const linePattern = /^\s*([\w-]+\.mp3)\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(indexText)) !== null) {
    found.add(match[1]!.toLowerCase());
  }
  const hrefPattern = /href=["']([^"']+\.mp3)["']/gi;
  while ((match = hrefPattern.exec(indexText)) !== null) {
    const name = match[1]!.split('/').pop();
    if (name) found.add(name.toLowerCase());
  }
  const inlinePattern = /\b(\d+[-_]\d+\.mp3|\d+\.mp3)\b/gi;
  while ((match = inlinePattern.exec(indexText)) !== null) {
    found.add(match[1]!.toLowerCase());
  }
  return [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function gutenbergMp3BaseUrl(sampleAudioUrl: string): string {
  const trimmed = sampleAudioUrl.trim();
  const lastSlash = trimmed.lastIndexOf('/');
  return lastSlash >= 0 ? trimmed.slice(0, lastSlash + 1) : trimmed;
}

export function gutenbergChaptersFromIndex(
  bookId: string,
  formats: Record<string, string>,
  indexText?: string,
): AudiobookCatalogChapter[] {
  const sampleUrl = pickGutenbergAudioUrl(formats);
  if (!sampleUrl) return [];

  const base = gutenbergMp3BaseUrl(sampleUrl);
  const filenames = indexText?.trim() ? parseGutenbergMp3Filenames(indexText) : [];

  if (filenames.length === 0) {
    const name = sampleUrl.split('/').pop() ?? `${bookId}-000.mp3`;
    return [
      {
        id: `${bookId}:0`,
        bookId: `gutenberg:${bookId}`,
        title: 'Chapter 1',
        audioUrl: sampleUrl,
        chapterNumber: 1,
        source: 'gutenberg',
      },
    ];
  }

  return filenames.map((file, index) => ({
    id: `${bookId}:${index}`,
    bookId: `gutenberg:${bookId}`,
    title: `Chapter ${index + 1}`,
    audioUrl: `${base}${file}`,
    chapterNumber: index + 1,
    source: 'gutenberg' as const,
  }));
}
