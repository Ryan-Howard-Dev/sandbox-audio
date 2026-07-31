/**
 * Work out which books belong together, so a part 2 can point at its part 1.
 *
 * Opening book two of a series and being offered no way to reach book one is a real dead end —
 * especially with device-scanned books, where nothing carries series metadata and the only clue
 * is in the title. That clue is usually enough: "Something, Book 2" and "Something (Saga #3)" are
 * both saying the same thing in different punctuation.
 *
 * Series membership is derived, never stored. A scan can add a book at any time, and a cached
 * series list would be wrong the moment it did.
 */

export interface BookSeriesRef {
  /** Series name, normalised for comparison — lower case, punctuation collapsed. */
  key: string;
  /** Series name as it should be shown. */
  label: string;
  /** Position in the series. */
  index: number;
}

/** Books this module can order and relate. Deliberately minimal so any book shape satisfies it. */
export interface SeriesCandidate {
  title: string;
  author?: string;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/*
 * Ordered most-specific first. "Title, Book 2" must be tried before the bare trailing-number
 * rule, or the latter would claim it and throw away the word that identified it as a series.
 */
const SERIES_PATTERNS: { re: RegExp; series: number; index: number }[] = [
  // "The Hobbit (Middle Earth #2)" / "(Middle Earth, Book 2)"
  { re: /^(.*?)\s*[([]\s*(.+?)[,\s]+(?:book|part|vol\.?|volume|#)\s*(\d+)\s*[)\]]\s*$/i, series: 2, index: 3 },
  // "The Hobbit (#2)" — series name is the title itself
  { re: /^(.*?)\s*[([]\s*#\s*(\d+)\s*[)\]]\s*$/i, series: 1, index: 2 },
  // "The Hobbit, Book 2" / "The Hobbit - Part 2" / "The Hobbit: Volume 2"
  { re: /^(.*?)\s*[,\-–—:]\s*(?:book|part|vol\.?|volume)\s*(\d+)\s*$/i, series: 1, index: 2 },
  // "The Hobbit Book 2" — no separator
  { re: /^(.*?)\s+(?:book|part|vol\.?|volume)\s*(\d+)\s*$/i, series: 1, index: 2 },
];

/** "Book Two" spelled out, which audiobook filenames do constantly. */
const WORD_NUMBER_RE = new RegExp(
  `^(.*?)\\s*[,\\-–—:]?\\s*(?:book|part|vol\\.?|volume)\\s+(${Object.keys(WORD_NUMBERS).join('|')})\\s*$`,
  'i',
);

export function seriesKey(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/["'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .trim();
}

/**
 * Read a series reference out of a title, or return null.
 *
 * A bare trailing number is deliberately NOT treated as a series marker. "Catch 22" and "1984"
 * are titles, not second instalments, and a rule that claimed them would scatter unrelated books
 * into invented series — a worse failure than missing a real one, because it is visible and wrong
 * rather than merely absent.
 */
export function parseBookSeries(title: string): BookSeriesRef | null {
  const raw = (title ?? '').trim();
  if (!raw) return null;

  for (const { re, series, index } of SERIES_PATTERNS) {
    const m = raw.match(re);
    if (!m) continue;
    const label = (m[series] ?? '').trim();
    const position = Number(m[index]);
    if (!label || !Number.isFinite(position) || position <= 0) continue;
    return { key: seriesKey(label), label, index: position };
  }

  const worded = raw.match(WORD_NUMBER_RE);
  if (worded) {
    const label = (worded[1] ?? '').trim();
    const position = WORD_NUMBERS[(worded[2] ?? '').toLowerCase()];
    if (label && position) return { key: seriesKey(label), label, index: position };
  }

  return null;
}

/** Title with its series suffix removed, for display next to its siblings. */
export function titleWithoutSeries(title: string): string {
  const ref = parseBookSeries(title);
  return ref ? ref.label : (title ?? '').trim();
}

/**
 * Other books in the same series, in reading order.
 *
 * The book itself is excluded, and so is anything at the same position — two files claiming to be
 * book 2 are a duplicate import, not a series.
 */
export function findSeriesSiblings<T extends SeriesCandidate>(book: T, library: T[]): T[] {
  const ref = parseBookSeries(book?.title ?? '');
  if (!ref) return [];

  const siblings: { item: T; index: number }[] = [];
  for (const candidate of library ?? []) {
    if (candidate === book) continue;
    const other = parseBookSeries(candidate?.title ?? '');
    if (!other || other.key !== ref.key) continue;
    if (other.index === ref.index) continue;
    siblings.push({ item: candidate, index: other.index });
  }
  return siblings.sort((a, b) => a.index - b.index).map((row) => row.item);
}

/**
 * What to offer beside a book: its series first, then the same author.
 *
 * Series order beats author order because it is the stronger signal — someone on book two wants
 * book one far more than they want an unrelated title by the same writer.
 */
export function recommendRelatedBooks<T extends SeriesCandidate>(
  book: T,
  library: T[],
  limit = 6,
): T[] {
  if (!book) return [];
  const out: T[] = [];
  const seen = new Set<T>([book]);

  for (const sibling of findSeriesSiblings(book, library)) {
    if (seen.has(sibling)) continue;
    seen.add(sibling);
    out.push(sibling);
  }

  const author = (book.author ?? '').trim().toLowerCase();
  if (author && author !== 'unknown author') {
    for (const candidate of library ?? []) {
      if (out.length >= limit) break;
      if (seen.has(candidate)) continue;
      if ((candidate.author ?? '').trim().toLowerCase() !== author) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }

  return out.slice(0, limit);
}
