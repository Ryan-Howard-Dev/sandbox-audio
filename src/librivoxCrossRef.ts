/**
 * Find the real LibriVox recording for a book whose own catalog gave a fragment.
 *
 * Project Gutenberg stores audiobooks as loose directories and Gutendex maps the whole thing to
 * one file, so a five-hour novel arrives as a single sixteen-minute URL. `audiobookFidelity`
 * detects that; this repairs it. LibriVox models the *recording* as the primary entity, so its
 * API returns the actual section list with per-section durations — and most Gutenberg audio came
 * from LibriVox volunteers in the first place, so the recording usually exists there.
 *
 * JSON, not the RSS feed: LibriVox offers both, and client-side XML parsing of CDATA-wrapped
 * `itunes:duration` namespaces is brittle in a way `format=json` simply is not.
 *
 * Matching is deliberately strict. Replacing a book's chapters with a *different* book is far
 * worse than leaving the sample warning in place, so an uncertain match is no match.
 */

import { isAirGapEnabled } from './airGapMode';

export interface LibrivoxSection {
  id?: string | number;
  section_number?: string;
  title?: string;
  listen_url?: string;
  playtime?: string;
}

export interface LibrivoxBook {
  id?: string | number;
  title?: string;
  description?: string;
  totaltimesecs?: number;
  authors?: Array<{ first_name?: string; last_name?: string }>;
  sections?: LibrivoxSection[];
}

export interface CrossRefChapter {
  title: string;
  audioUrl: string;
  durationSeconds?: number;
  chapterNumber: number;
}

/** Leading articles and punctuation differ between catalogs and mean nothing for identity. */
export function normaliseBookKey(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** LibriVox splits names into parts; Gutenberg writes "Austen, Jane". Compare on the set of words. */
export function librivoxAuthorName(book: LibrivoxBook): string {
  const author = book.authors?.[0];
  if (!author) return '';
  return `${author.first_name ?? ''} ${author.last_name ?? ''}`.trim();
}

function sharesAuthorWord(a: string, b: string): boolean {
  const left = new Set(normaliseBookKey(a).split(' ').filter((w) => w.length > 2));
  const right = normaliseBookKey(b).split(' ').filter((w) => w.length > 2);
  return right.some((word) => left.has(word));
}

/**
 * Best candidate, or null when nothing is confidently the same book.
 *
 * Requires the normalised title to match exactly. Substring matching was tempting and is wrong:
 * "The Adventures of Sherlock Holmes" contains "Sherlock Holmes", and quietly swapping one for
 * the other is exactly the failure this guards against. The author is a tiebreaker between
 * recordings of the same work rather than a requirement, because plenty of catalog entries
 * attribute a work to a translator, an editor, or the source archive.
 */
export function pickLibrivoxMatch(
  candidates: LibrivoxBook[],
  title: string,
  author: string,
): LibrivoxBook | null {
  const wantedTitle = normaliseBookKey(title);
  if (!wantedTitle) return null;

  const sameTitle = candidates.filter(
    (book) => normaliseBookKey(book.title) === wantedTitle && (book.sections?.length ?? 0) > 0,
  );
  if (sameTitle.length === 0) return null;
  if (sameTitle.length === 1) return sameTitle[0]!;

  const byAuthor = sameTitle.find((book) => sharesAuthorWord(librivoxAuthorName(book), author));
  // Several recordings of one work: prefer the matching author, else the most complete reading.
  return (
    byAuthor ??
    [...sameTitle].sort((a, b) => (b.sections?.length ?? 0) - (a.sections?.length ?? 0))[0]!
  );
}

export function librivoxSectionsToChapters(book: LibrivoxBook): CrossRefChapter[] {
  return (book.sections ?? [])
    .filter((section) => section.listen_url?.trim())
    .map((section, index) => {
      const number = section.section_number ? parseInt(section.section_number, 10) : index + 1;
      const playtime = section.playtime ? parseInt(section.playtime, 10) : Number.NaN;
      return {
        title: section.title?.trim() || `Chapter ${Number.isFinite(number) ? number : index + 1}`,
        audioUrl: section.listen_url!.trim(),
        durationSeconds: Number.isFinite(playtime) && playtime > 0 ? playtime : undefined,
        chapterNumber: Number.isFinite(number) ? number : index + 1,
      };
    });
}

/** Search by title, filtered by author client-side — the API's author filter is exact-match only. */
export function buildLibrivoxSearchUrl(title: string): string {
  const clean = (title ?? '').split(':')[0]!.trim();
  return `https://librivox.org/api/feed/audiobooks/?title=${encodeURIComponent(
    clean,
  )}&format=json&extended=1`;
}

export function parseLibrivoxBooks(payload: unknown): LibrivoxBook[] {
  if (!payload || typeof payload !== 'object') return [];
  const books = (payload as { books?: unknown }).books;
  return Array.isArray(books) ? (books as LibrivoxBook[]) : [];
}

/**
 * Fetch the real chapter list for a book whose own catalog gave a fragment.
 *
 * Returns null on anything short of a confident match: air-gapped, offline, no result, or a
 * candidate that is not clearly the same work. The caller keeps whatever it had, so the failure
 * mode is the existing sample warning rather than a book quietly replaced by a different one.
 */
export async function fetchLibrivoxChapters(
  title: string,
  author: string,
): Promise<CrossRefChapter[] | null> {
  if (!title?.trim()) return null;
  // Gated, unlike the older by-id path beside it: a cross-reference is a WAN call and air-gap
  // means air-gap.
  if (isAirGapEnabled()) return null;
  try {
    const res = await fetch(buildLibrivoxSearchUrl(title), {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const match = pickLibrivoxMatch(parseLibrivoxBooks(await res.json()), title, author);
    if (!match) return null;
    const chapters = librivoxSectionsToChapters(match);
    // One section is the very fragment being repaired; replacing like with like is not a repair.
    return chapters.length > 1 ? chapters : null;
  } catch {
    return null;
  }
}
