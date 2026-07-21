/**
 * Audiobook catalog provider registry — Tier34 server.
 */

import {
  dedupeAudiobookBooks,
  type AudiobookCatalogBook,
  type AudiobookCatalogChapter,
  type AudiobookCatalogSource,
} from './audiobookRssCore.js';
import { fetchGutenbergChapters, searchGutenbergAudiobooks } from './audiobookGutenbergProvider.js';
import { fetchLoyalbooksChapters, searchLoyalbooksAudiobooks } from './audiobookLoyalbooksProvider.js';
import { fetchRssAudiobookChapters, searchRssAudiobooks } from './audiobookRssProvider.js';
import { searchRaveBookSearch } from './audiobookRaveBookSearchProvider.js';
import { extractArchiveIdentifierFromUrl, raveBookSearchId } from './audiobookRaveBookSearchCore.js';
import {
  fetchAudiobooks4soulChapters,
  searchAudiobooks4soul,
} from './audiobookAudiobooks4soulProvider.js';
import {
  fetchGoldenAudiobooksChapters,
  searchGoldenAudiobooks,
} from './audiobookGoldenAudiobooksProvider.js';
import {
  fetchLearnoutloudChapters,
  searchLearnoutloudAudiobooks,
} from './audiobookLearnoutloudProvider.js';
import { fetchLit2goChapters, searchLit2goAudiobooks } from './audiobookLit2goProvider.js';

export type { AudiobookCatalogBook, AudiobookCatalogChapter, AudiobookCatalogSource };

export interface AudiobookCatalogProvider {
  id: AudiobookCatalogSource;
  label: string;
  search(query: string, opts?: { limit?: number }): Promise<AudiobookCatalogBook[]>;
}

const LIBRIVOX_API = 'https://librivox.org/api/feed/audiobooks';
const IA_SEARCH = 'https://archive.org/advancedsearch.php';

function stripHtml(raw: string | undefined): string {
  if (!raw?.trim()) return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

type LibrivoxBook = {
  id?: string;
  title?: string;
  description?: string;
  num_sections?: string;
  totaltimesecs?: number;
  url_rss?: string;
  url_librivox?: string;
  url_iarchive?: string;
  authors?: Array<{ first_name?: string; last_name?: string }>;
  sections?: Array<{
    id?: string;
    section_number?: string;
    title?: string;
    listen_url?: string;
    playtime?: string;
  }>;
};

function extractArchiveIdentifier(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const parts = parsed.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === 'details' || p === 'download');
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1]!;
    return parts[parts.length - 1] ?? '';
  } catch {
    const m = url.match(/\/details\/([^/?#]+)/i);
    return m?.[1] ?? '';
  }
}

async function searchLibrivox(query: string, limit: number): Promise<AudiobookCatalogBook[]> {
  const url = `${LIBRIVOX_API}?title=${encodeURIComponent(query)}&format=json&limit=${Math.min(limit, 50)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SandboxTier34/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { books?: LibrivoxBook[] };
  return (data.books ?? [])
    .filter((b) => b.id && b.title?.trim())
    .map((b) => {
      const author =
        b.authors
          ?.map((a) => `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim())
          .filter(Boolean)
          .join(', ') || 'LibriVox';
      const sections = parseInt(b.num_sections ?? '0', 10);
      return {
        id: `librivox:${b.id}`,
        sourceId: String(b.id),
        title: b.title!.trim(),
        author,
        description: stripHtml(b.description),
        chapterCount: Number.isFinite(sections) && sections > 0 ? sections : undefined,
        durationSeconds: b.totaltimesecs && b.totaltimesecs > 0 ? b.totaltimesecs : undefined,
        source: 'librivox' as const,
        detailUrl: b.url_librivox?.trim() || b.url_rss?.trim(),
        artworkUrl: b.url_iarchive
          ? `https://archive.org/services/img/${extractArchiveIdentifier(b.url_iarchive)}`
          : undefined,
      };
    });
}

async function searchInternetArchive(query: string, limit: number): Promise<AudiobookCatalogBook[]> {
  const q = `(title:(${query}) OR creator:(${query})) AND mediatype:audio AND collection:librivox`;
  const url = `${IA_SEARCH}?q=${encodeURIComponent(q)}&fl[]=identifier,title,creator,description&rows=${Math.min(limit, 25)}&output=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SandboxTier34/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    response?: { docs?: Array<{ identifier?: string; title?: string; creator?: string | string[]; description?: string }> };
  };
  return (data.response?.docs ?? [])
    .filter((d) => d.identifier?.trim() && d.title?.trim())
    .map((d) => {
      const creator = Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator ?? 'Internet Archive');
      return {
        id: `archive:${d.identifier}`,
        sourceId: d.identifier!.trim(),
        title: d.title!.trim(),
        author: creator.trim() || 'Internet Archive',
        description: stripHtml(typeof d.description === 'string' ? d.description : undefined),
        source: 'archive' as const,
        detailUrl: `https://archive.org/details/${d.identifier}`,
        artworkUrl: `https://archive.org/services/img/${d.identifier}`,
      };
    });
}

export const AUDIOBOOK_CATALOG_PROVIDERS: AudiobookCatalogProvider[] = [
  { id: 'librivox', label: 'LibriVox', search: (q, opts) => searchLibrivox(q, opts?.limit ?? 25) },
  { id: 'archive', label: 'Internet Archive', search: (q, opts) => searchInternetArchive(q, opts?.limit ?? 25) },
  { id: 'gutenberg', label: 'Project Gutenberg', search: (q, opts) => searchGutenbergAudiobooks(q, opts?.limit ?? 25) },
  { id: 'loyalbooks', label: 'Loyal Books', search: (q, opts) => searchLoyalbooksAudiobooks(q, opts?.limit ?? 25) },
  { id: 'rss', label: 'RSS', search: (q, opts) => searchRssAudiobooks(q, opts?.limit ?? 25) },
  { id: 'ravebooksearch', label: 'Meta-search', search: (q, opts) => searchRaveBookSearch(q, opts?.limit ?? 25) },
  { id: 'learnoutloud', label: 'LearnOutLoud', search: (q, opts) => searchLearnoutloudAudiobooks(q, opts?.limit ?? 25) },
  { id: 'lit2go', label: 'Lit2Go', search: (q, opts) => searchLit2goAudiobooks(q, opts?.limit ?? 25) },
  {
    id: 'goldenaudiobooks',
    label: 'Golden Audiobooks',
    search: (q, opts) => searchGoldenAudiobooks(q, opts?.limit ?? 25),
  },
  {
    id: 'audiobooks4soul',
    label: 'Audiobooks4Soul',
    search: (q, opts) => searchAudiobooks4soul(q, opts?.limit ?? 25),
  },
];

export const AUDIOBOOK_CATALOG_SOURCES = AUDIOBOOK_CATALOG_PROVIDERS.map((p) => ({
  id: p.id,
  label: p.label,
}));

export async function searchAudiobookCatalog(
  query: string,
  limit = 25,
): Promise<AudiobookCatalogBook[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const perSource = Math.max(6, Math.ceil(limit / AUDIOBOOK_CATALOG_PROVIDERS.length));
  const batches = await Promise.all(
    AUDIOBOOK_CATALOG_PROVIDERS.map(async (p) => {
      try {
        return await p.search(q, { limit: perSource });
      } catch (err) {
        console.warn(`[audiobook] provider ${p.id} search failed`, err);
        return [] as AudiobookCatalogBook[];
      }
    }),
  );
  return dedupeAudiobookBooks(batches.flat()).slice(0, limit);
}

async function fetchLibrivoxChapters(bookId: string): Promise<AudiobookCatalogChapter[]> {
  const url = `${LIBRIVOX_API}?id=${encodeURIComponent(bookId)}&format=json&extended=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SandboxTier34/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { books?: LibrivoxBook[] };
  const book = data.books?.[0];
  if (!book?.sections?.length) return [];
  return book.sections
    .filter((s) => s.listen_url?.trim())
    .map((s, index) => ({
      id: String(s.id ?? `${bookId}-${s.section_number ?? index + 1}`),
      bookId: `librivox:${bookId}`,
      title: (s.title ?? `Chapter ${s.section_number ?? index + 1}`).trim(),
      audioUrl: s.listen_url!.trim(),
      durationSeconds: s.playtime ? parseInt(s.playtime, 10) : undefined,
      chapterNumber: s.section_number ? parseInt(s.section_number, 10) : index + 1,
      source: 'librivox' as const,
    }));
}

async function fetchArchiveChapters(identifier: string): Promise<AudiobookCatalogChapter[]> {
  const url = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SandboxTier34/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    files?: Array<{ name?: string; length?: string }>;
  };
  const mp3s = (data.files ?? [])
    .filter((f) => {
      const name = f.name?.toLowerCase() ?? '';
      return name.endsWith('.mp3') && !name.includes('_afpk') && !name.includes('_spectrogram');
    })
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true }));

  return mp3s.map((f, index) => {
    const name = f.name ?? `chapter-${index + 1}.mp3`;
    const title = name.replace(/\.mp3$/i, '').replace(/_/g, ' ');
    return {
      id: `${identifier}:${index}`,
      bookId: `archive:${identifier}`,
      title,
      audioUrl: `https://archive.org/download/${identifier}/${encodeURIComponent(name)}`,
      durationSeconds: f.length ? parseInt(f.length, 10) : undefined,
      chapterNumber: index + 1,
      source: 'archive' as const,
    };
  });
}

async function fetchRaveBookSearchChapters(detailUrl: string): Promise<AudiobookCatalogChapter[]> {
  const url = detailUrl.trim();
  if (!url) return [];
  const archiveId = extractArchiveIdentifierFromUrl(url);
  if (!archiveId) return [];
  const bookId = raveBookSearchId(url);
  const chapters = await fetchArchiveChapters(archiveId);
  return chapters.map((ch) => ({
    ...ch,
    bookId,
    source: 'ravebooksearch' as const,
  }));
}

export async function fetchAudiobookCatalogChapters(
  source: AudiobookCatalogSource,
  sourceId: string,
  feedUrl?: string,
): Promise<AudiobookCatalogChapter[]> {
  const id = sourceId.trim();
  if (!id) return [];
  if (source === 'librivox') return fetchLibrivoxChapters(id);
  if (source === 'archive') return fetchArchiveChapters(id);
  if (source === 'ravebooksearch') return fetchRaveBookSearchChapters(id);
  if (source === 'gutenberg') return fetchGutenbergChapters(id);
  if (source === 'loyalbooks') return fetchLoyalbooksChapters(id);
  if (source === 'learnoutloud') return fetchLearnoutloudChapters(id);
  if (source === 'lit2go') return fetchLit2goChapters(id);
  if (source === 'goldenaudiobooks') return fetchGoldenAudiobooksChapters(id);
  if (source === 'audiobooks4soul') return fetchAudiobooks4soulChapters(id);
  return fetchRssAudiobookChapters(id, feedUrl);
}
