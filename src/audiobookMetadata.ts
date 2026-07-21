/**
 * Audiobook metadata enrichment — Open Library / Google Books / Internet Archive.
 * Caches lookups in prefs only. Never writes, moves, or deletes audio files.
 */

import { isAirGapEnabled } from './airGapMode';
import { fetchWithTimeout } from './fetchWithTimeout';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const AUDIOBOOK_META_CACHE_KEY = 'sandbox_audiobook_meta_cache_v1';

export type AudiobookMetaSource = 'openlibrary' | 'googlebooks' | 'archive' | 'local';

export type AudiobookMetaEnrichment = {
  title: string;
  author: string;
  coverUrl?: string;
  source: AudiobookMetaSource;
  fetchedAt: number;
};

type MetaCacheMap = Record<string, AudiobookMetaEnrichment>;

const LOOKUP_TIMEOUT_MS = 8_000;
const CACHE_STALE_MS = 30 * 24 * 60 * 60 * 1000;

const BAD_TITLE_RE =
  /^(?:-|—|–|_+|n\/?a|unknown|untitled|track\s*\d*|null|undefined|\.)$/i;
const BAD_AUTHOR_RE =
  /^(?:-|—|–|_+|n\/?a|unknown(?:\s+artist)?|various(?:\s+artists?)?|author\s*name|null|undefined|<unknown>)$/i;

function readCache(): MetaCacheMap {
  try {
    const raw = prefsGetItem(AUDIOBOOK_META_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as MetaCacheMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(map: MetaCacheMap): void {
  try {
    prefsSetItem(AUDIOBOOK_META_CACHE_KEY, JSON.stringify(map));
  } catch {
    /* quota — ignore */
  }
}

export function audiobookMetaCacheKey(title: string, author: string): string {
  return `${title.trim().toLowerCase()}::${author.trim().toLowerCase()}`
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

export function isBadAudiobookTitle(value: string | null | undefined): boolean {
  const t = (value ?? '').trim();
  if (!t) return true;
  if (BAD_TITLE_RE.test(t)) return true;
  if (t.length <= 1) return true;
  return false;
}

export function isBadAudiobookAuthor(value: string | null | undefined): boolean {
  const t = (value ?? '').trim();
  if (!t) return true;
  if (BAD_AUTHOR_RE.test(t)) return true;
  return false;
}

export function getCachedAudiobookMeta(
  title: string,
  author: string,
): AudiobookMetaEnrichment | null {
  const key = audiobookMetaCacheKey(title, author);
  const hit = readCache()[key];
  if (!hit) return null;
  if (Date.now() - (hit.fetchedAt || 0) > CACHE_STALE_MS) return null;
  return hit;
}

export function saveCachedAudiobookMeta(
  title: string,
  author: string,
  enrichment: AudiobookMetaEnrichment,
): void {
  const map = readCache();
  map[audiobookMetaCacheKey(title, author)] = enrichment;
  const keys = Object.keys(map);
  if (keys.length > 400) {
    const sorted = keys
      .map((k) => ({ k, at: map[k]?.fetchedAt ?? 0 }))
      .sort((a, b) => a.at - b.at);
    for (const row of sorted.slice(0, keys.length - 350)) {
      delete map[row.k];
    }
  }
  writeCache(map);
}

function normalizeQueryPart(value: string): string {
  return value
    .replace(/\.(m4b|mp3|m4a|aac|flac|ogg|wav)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchQuery(title: string, author: string): string {
  const t = normalizeQueryPart(title);
  const a = isBadAudiobookAuthor(author) ? '' : normalizeQueryPart(author);
  if (t && a) return `${t} ${a}`;
  return t || a;
}

type OpenLibraryDoc = {
  title?: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
};

async function lookupOpenLibrary(
  query: string,
): Promise<AudiobookMetaEnrichment | null> {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5&fields=title,author_name,cover_i,first_publish_year`;
  const res = await fetchWithTimeout(url, undefined, LOOKUP_TIMEOUT_MS);
  if (!res.ok) return null;
  const data = (await res.json()) as { docs?: OpenLibraryDoc[] };
  const docs = data.docs ?? [];
  for (const doc of docs) {
    const title = doc.title?.trim();
    if (!title || isBadAudiobookTitle(title)) continue;
    const author = doc.author_name?.[0]?.trim() || '';
    const coverUrl =
      typeof doc.cover_i === 'number' && doc.cover_i > 0
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
        : undefined;
    return {
      title,
      author: author || 'Unknown author',
      coverUrl,
      source: 'openlibrary',
      fetchedAt: Date.now(),
    };
  }
  return null;
}

type GoogleVolume = {
  volumeInfo?: {
    title?: string;
    authors?: string[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
};

async function lookupGoogleBooks(
  query: string,
): Promise<AudiobookMetaEnrichment | null> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5&printType=books`;
  const res = await fetchWithTimeout(url, undefined, LOOKUP_TIMEOUT_MS);
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: GoogleVolume[] };
  for (const item of data.items ?? []) {
    const info = item.volumeInfo;
    const title = info?.title?.trim();
    if (!title || isBadAudiobookTitle(title)) continue;
    const author = info?.authors?.[0]?.trim() || '';
    let cover =
      info?.imageLinks?.thumbnail?.trim() ||
      info?.imageLinks?.smallThumbnail?.trim() ||
      undefined;
    if (cover?.startsWith('http://')) {
      cover = cover.replace(/^http:\/\//i, 'https://');
    }
    return {
      title,
      author: author || 'Unknown author',
      coverUrl: cover,
      source: 'googlebooks',
      fetchedAt: Date.now(),
    };
  }
  return null;
}

type ArchiveDoc = {
  title?: string;
  creator?: string | string[];
  identifier?: string;
};

async function lookupInternetArchive(
  query: string,
): Promise<AudiobookMetaEnrichment | null> {
  const q = `mediatype:(audio OR texts) AND (${query})`;
  const url =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator&rows=5&page=1&output=json`;
  const res = await fetchWithTimeout(url, undefined, LOOKUP_TIMEOUT_MS);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    response?: { docs?: ArchiveDoc[] };
  };
  for (const doc of data.response?.docs ?? []) {
    const title = doc.title?.trim();
    if (!title || isBadAudiobookTitle(title)) continue;
    const creator = Array.isArray(doc.creator) ? doc.creator[0] : doc.creator;
    const author = (creator ?? '').trim();
    const id = doc.identifier?.trim();
    const coverUrl = id
      ? `https://archive.org/services/img/${encodeURIComponent(id)}`
      : undefined;
    return {
      title,
      author: author || 'Unknown author',
      coverUrl,
      source: 'archive',
      fetchedAt: Date.now(),
    };
  }
  return null;
}

/**
 * Online lookup for cover + corrected title/author.
 * Prefer Open Library, then Google Books, then Internet Archive.
 * Results are cached in prefs — never touches audio files.
 */
export async function enrichAudiobookMetadata(
  title: string,
  author: string,
): Promise<AudiobookMetaEnrichment | null> {
  const cached = getCachedAudiobookMeta(title, author);
  if (cached) return cached;

  if (isAirGapEnabled()) return null;

  const query = buildSearchQuery(title, author);
  if (query.length < 2) return null;

  const providers = [lookupOpenLibrary, lookupGoogleBooks, lookupInternetArchive];
  for (const lookup of providers) {
    try {
      const hit = await lookup(query);
      if (hit) {
        saveCachedAudiobookMeta(title, author, hit);
        return hit;
      }
    } catch {
      /* try next provider */
    }
  }

  const negative: AudiobookMetaEnrichment = {
    title,
    author: isBadAudiobookAuthor(author) ? 'Unknown author' : author,
    source: 'local',
    fetchedAt: Date.now(),
  };
  saveCachedAudiobookMeta(title, author, negative);
  return negative;
}

/** Enrich a list of books with concurrency limit — non-destructive. */
export async function enrichAudiobookList(
  books: Array<{ key: string; title: string; author: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, AudiobookMetaEnrichment>> {
  const out = new Map<string, AudiobookMetaEnrichment>();
  const pending = books.filter((b) => {
    const cached = getCachedAudiobookMeta(b.title, b.author);
    if (cached) {
      out.set(b.key, cached);
      return false;
    }
    return true;
  });

  let done = books.length - pending.length;
  onProgress?.(done, books.length);

  const CONCURRENCY = 2;
  let i = 0;
  async function worker(): Promise<void> {
    while (i < pending.length) {
      const idx = i++;
      const book = pending[idx]!;
      const hit = await enrichAudiobookMetadata(book.title, book.author);
      if (hit) out.set(book.key, hit);
      done += 1;
      onProgress?.(done, books.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()),
  );
  return out;
}
