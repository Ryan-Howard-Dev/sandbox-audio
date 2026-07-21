/**
 * Free audiobook catalog — LibriVox API + Internet Archive (LibriVox collection).
 */

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

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function dedupeBooks(books: AudiobookCatalogBook[]): AudiobookCatalogBook[] {
  const seen = new Set<string>();
  const out: AudiobookCatalogBook[] = [];
  for (const book of books) {
    const key = `${book.source}:${normalizeTitleKey(book.title)}:${normalizeTitleKey(book.author)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(book);
  }
  return out;
}

type LibrivoxAuthor = {
  first_name?: string;
  last_name?: string;
};

type LibrivoxBook = {
  id?: string;
  title?: string;
  description?: string;
  num_sections?: string;
  totaltimesecs?: number;
  url_rss?: string;
  url_librivox?: string;
  url_iarchive?: string;
  authors?: LibrivoxAuthor[];
};

type LibrivoxSection = {
  id?: string;
  section_number?: string;
  title?: string;
  listen_url?: string;
  playtime?: string;
};

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

export async function searchAudiobookCatalog(
  query: string,
  limit = 25,
): Promise<AudiobookCatalogBook[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const perSource = Math.max(8, Math.ceil(limit / 2));
  const [librivox, archive] = await Promise.all([
    searchLibrivox(q, perSource),
    searchInternetArchive(q, perSource),
  ]);
  return dedupeBooks([...librivox, ...archive]).slice(0, limit);
}

async function fetchLibrivoxChapters(bookId: string): Promise<AudiobookCatalogChapter[]> {
  const url = `${LIBRIVOX_API}?id=${encodeURIComponent(bookId)}&format=json&extended=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SandboxTier34/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { books?: Array<LibrivoxBook & { sections?: LibrivoxSection[] }> };
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
    files?: Array<{ name?: string; format?: string; length?: string }>;
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

export async function fetchAudiobookCatalogChapters(
  source: AudiobookCatalogSource,
  sourceId: string,
): Promise<AudiobookCatalogChapter[]> {
  const id = sourceId.trim();
  if (!id) return [];
  if (source === 'librivox') return fetchLibrivoxChapters(id);
  return fetchArchiveChapters(id);
}
