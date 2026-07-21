/**
 * Pure RaveBookSearch worker JSON → audiobook catalog mapping (no network).
 */

import type { AudiobookCatalogBook } from './audiobookRssCore.js';

export type RaveBookSearchResult = {
  title?: string;
  author?: string;
  year?: string;
  format?: string;
  filesize?: number;
  language?: string;
  source?: string;
  downloadUrl?: string;
  directUrl?: string;
  coverUrl?: string;
  md5?: string;
  _score?: number;
};

export function cleanRaveBookTitle(raw: string | undefined): string {
  return (raw ?? '')
    .replace(/;[^;]{0,4}\d{10,13}[^;]*/g, '')
    .replace(/\b\d{13}\b/g, '')
    .replace(/\b\d{10}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function raveBookSearchId(detailUrl: string): string {
  let hash = 0;
  for (let i = 0; i < detailUrl.length; i++) {
    hash = ((hash << 5) - hash + detailUrl.charCodeAt(i)) | 0;
  }
  return `ravebooksearch:${(hash >>> 0).toString(36)}`;
}

/** Prefer playable audiobook hits; skip obvious ebook-only shadow-library rows. */
export function isAudiobookRelevantRaveResult(result: RaveBookSearchResult): boolean {
  const url = (result.directUrl || result.downloadUrl || '').toLowerCase();
  const fmt = (result.format || '').toLowerCase();
  if (url.includes('archive.org') || url.includes('librivox')) return true;
  if (/\b(mp3|m4b|m3u|flac|audio|audiobook)\b/.test(fmt)) return true;
  if (result.source === 'Internet Archive') return true;
  if (result.source === "Anna's Archive" || result.source === 'Library Genesis') {
    return /\b(mp3|m4b|m3u|audiobook)\b/.test(fmt) || /\b(mp3|m4b|m3u|audio)\b/.test(url);
  }
  return false;
}

export function extractArchiveIdentifierFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (!parsed.hostname.includes('archive.org')) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === 'details' || p === 'download');
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1]!;
    return parts[parts.length - 1] ?? null;
  } catch {
    const m = url.match(/archive\.org\/(?:details|download)\/([^/?#]+)/i);
    return m?.[1] ?? null;
  }
}

export function parseRaveBookSearchResults(
  results: RaveBookSearchResult[],
  limit: number,
): AudiobookCatalogBook[] {
  const books: AudiobookCatalogBook[] = [];
  const seen = new Set<string>();

  for (const row of results) {
    if (!isAudiobookRelevantRaveResult(row)) continue;
    const detailUrl = (row.directUrl || row.downloadUrl || '').trim();
    if (!detailUrl) continue;

    const title = cleanRaveBookTitle(row.title);
    if (!title) continue;

    const author = (row.author || 'Unknown').trim();
    const dedupeKey = `${title.toLowerCase()}|${author.toLowerCase()}|${detailUrl}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const metaSource = row.source?.trim() || 'Meta-search';
    books.push({
      id: raveBookSearchId(detailUrl),
      sourceId: detailUrl,
      title,
      author,
      description: `via ${metaSource}`,
      artworkUrl: row.coverUrl?.trim() || undefined,
      source: 'ravebooksearch',
      detailUrl,
    });

    if (books.length >= limit) break;
  }

  return books;
}
