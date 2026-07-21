/**
 * Free audiobook discovery — provider registry via Tier34 with client fallbacks.
 * Tier34 searches all sources (LibriVox, Archive, Gutenberg, Loyal Books, RSS,
 * Meta-search, LearnOutLoud, Lit2Go, Golden Audiobooks, Audiobooks4Soul).
 * Client fallbacks cover librivox / rss / gutenberg / loyalbooks / archive / ravebooksearch(IA).
 * Scrape-index sources require Tier34 for search + chapters.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { isAirGapEnabled } from './airGapMode';
import { safePodcastPlaybackUrl } from './podcastRss';
import { getTier34BaseUrl } from './tier34/client';
import { dedupeAudiobookBooks } from '../tier34-server/lib/audiobookRssCore';
import { extractArchiveIdentifierFromUrl } from '../tier34-server/lib/audiobookRaveBookSearchCore';
import { fetchGutenbergChaptersClient, searchGutenbergAudiobooksClient } from './audiobookGutenbergProvider';
import { fetchLoyalbooksChaptersClient, searchLoyalbooksAudiobooksClient } from './audiobookLoyalbooksProvider';
import { fetchRssAudiobookChapters, searchRssAudiobooks } from './audiobookRssProvider';
import { AUDIOBOOK_CURATED_RSS_FEEDS } from './audiobookRssFeeds';

export type AudiobookCatalogSource =
  | 'librivox'
  | 'archive'
  | 'rss'
  | 'gutenberg'
  | 'loyalbooks'
  | 'ravebooksearch'
  | 'learnoutloud'
  | 'lit2go'
  | 'goldenaudiobooks'
  | 'audiobooks4soul';

/** Scrape-index + other sources that need Tier34 for chapter resolution. */
export const AUDIOBOOK_TIER34_CHAPTER_SOURCES: ReadonlySet<AudiobookCatalogSource> = new Set([
  'learnoutloud',
  'lit2go',
  'goldenaudiobooks',
  'audiobooks4soul',
]);

export interface AudiobookCatalogBook {
  id: string;
  title: string;
  author: string;
  description?: string;
  artworkUrl?: string;
  chapterCount?: number;
  durationSeconds?: number;
  source: AudiobookCatalogSource;
  sourceId: string;
  detailUrl?: string;
  feedUrl?: string;
}

export interface AudiobookCatalogChapter {
  id: string;
  bookId: string;
  title: string;
  audioUrl: string;
  durationSeconds?: number;
  chapterNumber?: number;
  source: AudiobookCatalogSource;
}

export interface AudiobookCatalogChapterHit {
  chapter: AudiobookCatalogChapter;
  envelope: MediaEnvelope;
}

export interface AudiobookCatalogProvider {
  id: AudiobookCatalogSource;
  label: string;
  search(query: string, opts?: { limit?: number }): Promise<AudiobookCatalogBook[]>;
}

export const AUDIOBOOK_CATALOG_ENVELOPE_PREFIX = 'audiobook-catalog:';

export function isAudiobookCatalogEnvelopeId(envelopeId: string | null | undefined): boolean {
  return (envelopeId?.trim() ?? '').startsWith(AUDIOBOOK_CATALOG_ENVELOPE_PREFIX);
}

export const AUDIOBOOK_CATALOG_SOURCES = [
  { id: 'librivox', label: 'LibriVox', url: 'https://librivox.org/search' },
  { id: 'archive', label: 'Internet Archive', url: 'https://archive.org/details/librivoxaudio' },
  { id: 'gutenberg', label: 'Project Gutenberg', url: 'https://www.gutenberg.org/ebooks/' },
  { id: 'loyalbooks', label: 'Loyal Books', url: 'https://www.loyalbooks.com/' },
  { id: 'rss', label: 'RSS Feeds', url: AUDIOBOOK_CURATED_RSS_FEEDS[0]?.url ?? '' },
  { id: 'ravebooksearch', label: 'Meta-search', url: 'https://ravebooksearch.com/' },
  { id: 'learnoutloud', label: 'LearnOutLoud', url: 'https://www.learnoutloud.com/Free-Audiobooks' },
  { id: 'lit2go', label: 'Lit2Go', url: 'https://etc.usf.edu/lit2go/' },
  { id: 'goldenaudiobooks', label: 'Golden Audiobooks', url: 'https://goldenaudiobooks.com/' },
  { id: 'audiobooks4soul', label: 'Audiobooks4Soul', url: 'https://audiobooks4soul.com/' },
] as const;

export function audiobookSourceLabel(source: AudiobookCatalogSource): string {
  return AUDIOBOOK_CATALOG_SOURCES.find((s) => s.id === source)?.label ?? source;
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

async function fetchViaTier34<T>(path: string, timeoutMs = 45_000): Promise<T | null> {
  if (isAirGapEnabled() || !getTier34BaseUrl().trim()) return null;
  const base = getTier34BaseUrl().replace(/\/$/, '');
  try {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type LibrivoxBook = {
  id?: string;
  title?: string;
  description?: string;
  num_sections?: string;
  totaltimesecs?: number;
  url_librivox?: string;
  url_iarchive?: string;
  authors?: Array<{ first_name?: string; last_name?: string }>;
};

function librivoxBookToCatalog(b: LibrivoxBook): AudiobookCatalogBook | null {
  if (!b.id || !b.title?.trim()) return null;
  const author =
    b.authors
      ?.map((a) => `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim())
      .filter(Boolean)
      .join(', ') || 'LibriVox';
  const sections = parseInt(b.num_sections ?? '0', 10);
  const archiveId = b.url_iarchive?.match(/\/details\/([^/?#]+)/i)?.[1];
  return {
    id: `librivox:${b.id}`,
    sourceId: String(b.id),
    title: b.title.trim(),
    author,
    description: stripHtml(b.description),
    chapterCount: Number.isFinite(sections) && sections > 0 ? sections : undefined,
    durationSeconds: b.totaltimesecs && b.totaltimesecs > 0 ? b.totaltimesecs : undefined,
    source: 'librivox',
    detailUrl: b.url_librivox?.trim(),
    artworkUrl: archiveId ? `https://archive.org/services/img/${archiveId}` : undefined,
  };
}

async function searchLibrivoxClient(query: string, limit: number): Promise<AudiobookCatalogBook[]> {
  const url = `https://librivox.org/api/feed/audiobooks?title=${encodeURIComponent(query)}&format=json&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { books?: LibrivoxBook[] };
  return (data.books ?? [])
    .map(librivoxBookToCatalog)
    .filter((b): b is AudiobookCatalogBook => b != null);
}

const librivoxProvider: AudiobookCatalogProvider = {
  id: 'librivox',
  label: 'LibriVox',
  search: (q, opts) => searchLibrivoxClient(q, opts?.limit ?? 24),
};

const rssProvider: AudiobookCatalogProvider = {
  id: 'rss',
  label: 'RSS',
  search: (q, opts) => searchRssAudiobooks(q, opts?.limit ?? 24),
};

export const AUDIOBOOK_CATALOG_PROVIDERS: AudiobookCatalogProvider[] = [
  librivoxProvider,
  rssProvider,
];

async function searchViaTier34(query: string, limit: number): Promise<AudiobookCatalogBook[]> {
  const remote = await fetchViaTier34<{ books?: AudiobookCatalogBook[] }>(
    `/api/audiobook/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
  return remote?.books ?? [];
}

export async function searchAudiobookCatalog(
  query: string,
  limit = 24,
): Promise<AudiobookCatalogBook[]> {
  const q = query.trim();
  if (q.length < 2 || isAirGapEnabled()) return [];

  const perSource = Math.max(4, Math.ceil(limit / AUDIOBOOK_CATALOG_SOURCES.length));
  const [remote, rssLocal, gutenbergLocal, loyalbooksLocal] = await Promise.all([
    searchViaTier34(q, limit),
    searchRssAudiobooks(q, perSource),
    searchGutenbergAudiobooksClient(q, perSource),
    searchLoyalbooksAudiobooksClient(q, perSource),
  ]);

  if (remote.length > 0) {
    // Prefer Tier34 for all remote sources; merge client RSS/Gutenberg/Loyal Books
    // so user-added feeds and direct fallbacks stay available.
    const remoteRss = remote.filter((b) => b.source === 'rss');
    const remoteOther = remote.filter((b) => b.source !== 'rss');
    const mergedRss = dedupeAudiobookBooks([...remoteRss, ...rssLocal]);
    const merged = dedupeAudiobookBooks([
      ...remoteOther,
      ...mergedRss,
      ...gutenbergLocal,
      ...loyalbooksLocal,
    ]);
    return merged.slice(0, limit);
  }

  // Tier34 offline — client-capable sources only (scrape-index needs Tier34).
  const [librivox, rss, gutenberg, loyalbooks] = await Promise.all([
    searchLibrivoxClient(q, perSource),
    searchRssAudiobooks(q, perSource),
    searchGutenbergAudiobooksClient(q, perSource),
    searchLoyalbooksAudiobooksClient(q, perSource),
  ]);
  return dedupeAudiobookBooks([...librivox, ...rss, ...gutenberg, ...loyalbooks]).slice(0, limit);
}

export function catalogChapterEnvelope(
  chapter: AudiobookCatalogChapter,
  book: Pick<AudiobookCatalogBook, 'title' | 'author' | 'artworkUrl'>,
): MediaEnvelope {
  return {
    envelopeId: `${AUDIOBOOK_CATALOG_ENVELOPE_PREFIX}${chapter.source}:${chapter.bookId.split(':').slice(1).join(':')}:${chapter.id}`,
    title: chapter.title,
    artist: book.author,
    album: book.title,
    url: safePodcastPlaybackUrl(chapter.audioUrl),
    durationSeconds: chapter.durationSeconds ?? 0,
    provider: 'https',
    transport: 'element-src',
    sourceId: `audiobook-cat-${chapter.source}-${chapter.id}`,
    artworkUrl: book.artworkUrl,
    mimeType: 'audio/mpeg',
  };
}

export function catalogChapterToHit(
  chapter: AudiobookCatalogChapter,
  book: Pick<AudiobookCatalogBook, 'title' | 'author' | 'artworkUrl'>,
): AudiobookCatalogChapterHit {
  return { chapter, envelope: catalogChapterEnvelope(chapter, book) };
}

async function fetchArchiveMetadataChapters(
  book: AudiobookCatalogBook,
  archiveId: string,
  source: 'archive' | 'ravebooksearch',
): Promise<AudiobookCatalogChapter[]> {
  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(archiveId)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    files?: Array<{ name?: string; length?: string }>;
  };
  return (data.files ?? [])
    .filter((f) => {
      const name = f.name?.toLowerCase() ?? '';
      return name.endsWith('.mp3') && !name.includes('_afpk');
    })
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true }))
    .map((f, index) => {
      const name = f.name ?? `chapter-${index + 1}.mp3`;
      return {
        id: `${archiveId}:${index}`,
        bookId: book.id,
        title: name.replace(/\.mp3$/i, '').replace(/_/g, ' '),
        audioUrl: `https://archive.org/download/${archiveId}/${encodeURIComponent(name)}`,
        durationSeconds: f.length ? parseInt(f.length, 10) : undefined,
        chapterNumber: index + 1,
        source,
      };
    });
}

export async function fetchAudiobookCatalogChapters(
  book: AudiobookCatalogBook,
): Promise<AudiobookCatalogChapter[]> {
  const feedParam = book.feedUrl ? `&feedUrl=${encodeURIComponent(book.feedUrl)}` : '';
  const remote = await fetchViaTier34<{ chapters?: AudiobookCatalogChapter[] }>(
    `/api/audiobook/chapters?source=${encodeURIComponent(book.source)}&id=${encodeURIComponent(book.sourceId)}${feedParam}`,
    60_000,
  );
  if (remote?.chapters?.length) return remote.chapters;

  // Scrape-index chapters only resolve through Tier34.
  if (AUDIOBOOK_TIER34_CHAPTER_SOURCES.has(book.source)) return [];

  if (book.source === 'rss') {
    return fetchRssAudiobookChapters(book);
  }

  if (book.source === 'gutenberg') {
    return fetchGutenbergChaptersClient(book);
  }

  if (book.source === 'loyalbooks') {
    return fetchLoyalbooksChaptersClient(book);
  }

  if (book.source === 'ravebooksearch') {
    const archiveId = extractArchiveIdentifierFromUrl(book.sourceId);
    if (!archiveId) return [];
    return fetchArchiveMetadataChapters(book, archiveId, 'ravebooksearch');
  }

  if (book.source === 'librivox') {
    const url = `https://librivox.org/api/feed/audiobooks?id=${encodeURIComponent(book.sourceId)}&format=json&extended=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      books?: Array<{
        sections?: Array<{
          id?: string;
          section_number?: string;
          title?: string;
          listen_url?: string;
          playtime?: string;
        }>;
      }>;
    };
    return (data.books?.[0]?.sections ?? [])
      .filter((s) => s.listen_url?.trim())
      .map((s, index) => ({
        id: String(s.id ?? `${book.sourceId}-${s.section_number ?? index + 1}`),
        bookId: book.id,
        title: (s.title ?? `Chapter ${s.section_number ?? index + 1}`).trim(),
        audioUrl: s.listen_url!.trim(),
        durationSeconds: s.playtime ? parseInt(s.playtime, 10) : undefined,
        chapterNumber: s.section_number ? parseInt(s.section_number, 10) : index + 1,
        source: 'librivox' as const,
      }));
  }

  if (book.source === 'archive') {
    return fetchArchiveMetadataChapters(book, book.sourceId, 'archive');
  }

  return [];
}
