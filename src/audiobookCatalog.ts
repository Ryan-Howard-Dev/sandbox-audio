/**
 * Free audiobook discovery — LibriVox + Internet Archive via Tier34 with direct LibriVox fallback.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { isAirGapEnabled } from './airGapMode';
import { safePodcastPlaybackUrl } from './podcastRss';
import { getTier34BaseUrl } from './tier34/client';

export type AudiobookCatalogSource = 'librivox' | 'archive';

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

export const AUDIOBOOK_CATALOG_ENVELOPE_PREFIX = 'audiobook-catalog:';

export function isAudiobookCatalogEnvelopeId(envelopeId: string | null | undefined): boolean {
  return (envelopeId?.trim() ?? '').startsWith(AUDIOBOOK_CATALOG_ENVELOPE_PREFIX);
}

export const AUDIOBOOK_CATALOG_SOURCES = [
  { id: 'librivox', label: 'LibriVox', url: 'https://librivox.org/search' },
  { id: 'archive', label: 'Internet Archive', url: 'https://archive.org/details/librivoxaudio' },
] as const;

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

async function fetchViaTier34<T>(path: string): Promise<T | null> {
  if (isAirGapEnabled() || !getTier34BaseUrl().trim()) return null;
  const base = getTier34BaseUrl().replace(/\/$/, '');
  try {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000) });
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

export async function searchAudiobookCatalog(
  query: string,
  limit = 24,
): Promise<AudiobookCatalogBook[]> {
  const q = query.trim();
  if (q.length < 2 || isAirGapEnabled()) return [];

  const remote = await fetchViaTier34<{ books?: AudiobookCatalogBook[] }>(
    `/api/audiobook/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  if (remote?.books?.length) return remote.books;

  return searchLibrivoxClient(q, limit);
}

export function catalogChapterEnvelope(
  chapter: AudiobookCatalogChapter,
  book: Pick<AudiobookCatalogBook, 'title' | 'author' | 'artworkUrl'>,
): MediaEnvelope {
  return {
    envelopeId: `${AUDIOBOOK_CATALOG_ENVELOPE_PREFIX}${chapter.source}:${chapter.bookId.split(':')[1] ?? chapter.bookId}:${chapter.id}`,
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

export async function fetchAudiobookCatalogChapters(
  book: AudiobookCatalogBook,
): Promise<AudiobookCatalogChapter[]> {
  const remote = await fetchViaTier34<{ chapters?: AudiobookCatalogChapter[] }>(
    `/api/audiobook/chapters?source=${encodeURIComponent(book.source)}&id=${encodeURIComponent(book.sourceId)}`,
  );
  if (remote?.chapters?.length) return remote.chapters;

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

  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(book.sourceId)}`, {
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
        id: `${book.sourceId}:${index}`,
        bookId: book.id,
        title: name.replace(/\.mp3$/i, '').replace(/_/g, ' '),
        audioUrl: `https://archive.org/download/${book.sourceId}/${encodeURIComponent(name)}`,
        durationSeconds: f.length ? parseInt(f.length, 10) : undefined,
        chapterNumber: index + 1,
        source: 'archive' as const,
      };
    });
}
