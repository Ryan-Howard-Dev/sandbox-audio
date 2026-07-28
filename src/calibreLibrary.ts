/**
 * Calibre libraries, read as folders rather than as a database.
 *
 * A Calibre library is `Author Name/Book Title (id)/Book Title - Author.epub`, with a `cover.jpg`
 * and a `metadata.opf` beside each book. There is also a `metadata.db` at the root, and reading it
 * is the obvious move — but it is the wrong first one. It couples this to Calibre's schema across
 * versions, needs SQLite on every platform the app ships to, and fails hard on a library that is
 * half-copied or missing its database. The folder tree carries the same facts in a form that
 * degrades gracefully: a partial copy imports the books that are actually there.
 *
 * Nothing here reads a disk. It plans an import from a list of paths, so the traversal can be a
 * file picker on Android, a directory handle on desktop, or a test.
 */

export interface CalibreBookCandidate {
  /** Path of the book file itself, as given. */
  path: string;
  /** Folder-derived author. Calibre writes the author as the top-level directory. */
  author?: string;
  /** Folder-derived title, with Calibre's trailing "(id)" removed. */
  title?: string;
  /** Calibre's own id, when the folder carries one. Useful for spotting re-imports. */
  calibreId?: number;
  /** Cover sitting beside the book, when the listing includes one. */
  coverPath?: string;
  /** metadata.opf beside the book — richer than the folder name when present. */
  opfPath?: string;
  format: 'epub' | 'other';
}

const BOOK_EXTENSIONS = /\.(epub|azw3|mobi|pdf|txt)$/i;

/** Calibre appends its row id: "The Book Title (1234)". */
const TITLE_WITH_ID = /^(.*?)\s*\((\d+)\)\s*$/;

function segments(path: string): string[] {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isEpub(path: string): boolean {
  return /\.epub$/i.test(path);
}

/**
 * Author and title from a Calibre book folder path.
 *
 * Read from the *folder*, never the filename. Calibre's filenames are truncated to keep paths
 * short — "A Very Long Title Indeed" can become "A Very Long Title In - Author.epub" — while the
 * folder keeps the full title. Preferring the filename would quietly import books under clipped
 * names.
 */
export function parseCalibreBookPath(path: string): {
  author?: string;
  title?: string;
  calibreId?: number;
} {
  const parts = segments(path);
  if (parts.length < 2) return {};
  // …/Author Name/Title (id)/File.epub — the book folder is the parent of the file.
  const folder = parts[parts.length - 2];
  const author = parts.length >= 3 ? parts[parts.length - 3] : undefined;
  if (!folder) return { author };

  const match = TITLE_WITH_ID.exec(folder);
  if (match) {
    const id = Number(match[2]);
    return {
      author,
      title: match[1]?.trim() || undefined,
      calibreId: Number.isFinite(id) ? id : undefined,
    };
  }
  return { author, title: folder };
}

/**
 * Books worth importing from a flat listing of a Calibre library.
 *
 * One entry per book folder, not per file: Calibre keeps several formats of the same book side by
 * side, and importing all of them would produce duplicates of every title that happens to exist as
 * both EPUB and MOBI. EPUB wins because it is the only one this app can actually read.
 */
export function planCalibreImport(paths: Iterable<string>): CalibreBookCandidate[] {
  const byFolder = new Map<string, CalibreBookCandidate>();
  const coverByFolder = new Map<string, string>();
  const opfByFolder = new Map<string, string>();

  for (const raw of paths) {
    const path = raw?.trim();
    if (!path) continue;
    const parts = segments(path);
    if (parts.length < 2) continue;
    const folderKey = parts.slice(0, -1).join('/');
    const file = parts[parts.length - 1]!;

    if (/^cover\.(jpe?g|png|webp)$/i.test(file)) {
      coverByFolder.set(folderKey, path);
      continue;
    }
    if (/^metadata\.opf$/i.test(file)) {
      opfByFolder.set(folderKey, path);
      continue;
    }
    if (!BOOK_EXTENSIONS.test(file)) continue;

    const existing = byFolder.get(folderKey);
    // Keep the EPUB when a folder holds several formats of the same book.
    if (existing && (!isEpub(path) || isEpub(existing.path))) continue;

    const { author, title, calibreId } = parseCalibreBookPath(path);
    byFolder.set(folderKey, {
      path,
      author,
      title,
      calibreId,
      format: isEpub(path) ? 'epub' : 'other',
    });
  }

  for (const [folderKey, candidate] of byFolder) {
    const cover = coverByFolder.get(folderKey);
    const opf = opfByFolder.get(folderKey);
    if (cover) candidate.coverPath = cover;
    if (opf) candidate.opfPath = opf;
  }

  return [...byFolder.values()].sort((a, b) => {
    const author = (a.author ?? '').localeCompare(b.author ?? '');
    return author !== 0 ? author : (a.title ?? '').localeCompare(b.title ?? '');
  });
}

/** Books this app can actually read today. The rest are reported, not silently dropped. */
export function readableCalibreBooks(
  candidates: CalibreBookCandidate[],
): CalibreBookCandidate[] {
  return candidates.filter((candidate) => candidate.format === 'epub');
}

/**
 * Formats found that cannot be opened, with counts.
 *
 * Surfaced so an import can say "412 books, 37 skipped (mobi, pdf)" instead of quietly importing
 * fewer books than the listener can see in Calibre — an import that loses a third of a library
 * without saying so is worse than one that refuses.
 */
export function unreadableCalibreFormats(
  candidates: CalibreBookCandidate[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const candidate of candidates) {
    if (candidate.format === 'epub') continue;
    const ext = /\.([a-z0-9]+)$/i.exec(candidate.path)?.[1]?.toLowerCase() ?? 'unknown';
    counts[ext] = (counts[ext] ?? 0) + 1;
  }
  return counts;
}

/**
 * Whether a path is inside a Calibre library at all.
 *
 * Calibre's own bookkeeping folders and files are not books, and importing them produces entries
 * nobody asked for.
 */
export function isCalibreArtefact(path: string): boolean {
  const parts = segments(path).map((part) => part.toLowerCase());
  if (parts.some((part) => part === '.caltrash' || part === '.calnotes')) return true;
  const file = parts[parts.length - 1] ?? '';
  return file === 'metadata.db' || file === 'metadata_db_prefs_backup.json';
}
