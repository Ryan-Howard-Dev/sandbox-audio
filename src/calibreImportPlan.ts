/**
 * A picked folder turned into a Calibre import the listener can approve before it runs.
 *
 * `calibreLibrary.ts` plans from a list of paths and knows nothing about pickers. This is the layer
 * in between: it takes what a file input hands back, works out the counts a confirmation step has
 * to show, and decides whether a folder picker can work on this platform at all.
 *
 * It lives outside the component on purpose. A Calibre library is routinely thousands of books, so
 * the arithmetic in front of the import is the part that must not be wrong — and component tests do
 * not run in this repo, while a plain module's do.
 */

import {
  isCalibreArtefact,
  planCalibreImport,
  readableCalibreBooks,
  unreadableCalibreFormats,
  type CalibreBookCandidate,
} from './calibreLibrary';

/**
 * The two fields a picked file contributes to a plan.
 *
 * Structural rather than `File` so this module needs no DOM, which is also what lets it be tested.
 * `webkitRelativePath` is the path inside the chosen folder and is the whole point: a Calibre
 * library's author and title live in its directory names, not in its filenames.
 */
export interface PickedLibraryFile {
  name: string;
  webkitRelativePath?: string;
}

/** What a book already on the shelf can be recognised by when the same library is picked twice. */
export interface ShelvedBookIdentity {
  calibreId?: number;
  name: string;
  author?: string;
}

export interface CalibreImportPlan {
  /** Top folder of the picked tree, for a confirmation that names what was chosen. */
  libraryName: string;
  /** One per book folder, including the ones no format here can open. */
  books: CalibreBookCandidate[];
  /** The EPUBs — everything this app can actually read. */
  readable: CalibreBookCandidate[];
  /** Readable books not already on the shelf. This is what an import would write. */
  fresh: CalibreBookCandidate[];
  /** Readable books already imported, so a second pick can say it will leave them alone. */
  duplicateCount: number;
  /** Extension → count for the formats that had to be skipped. */
  skipped: Record<string, number>;
  skippedCount: number;
}

/**
 * Paths inside the picked folder, with Calibre's own bookkeeping removed.
 *
 * `.caltrash` is the reason this filter exists rather than being left to the planner: deleted books
 * stay there as complete, importable EPUBs, so a plain traversal quietly re-imports everything the
 * user threw away.
 */
export function pickedLibraryPaths(files: Iterable<PickedLibraryFile>): string[] {
  const paths: string[] = [];
  for (const file of files) {
    const path = (file?.webkitRelativePath || file?.name || '').trim();
    if (!path) continue;
    if (isCalibreArtefact(path)) continue;
    paths.push(path);
  }
  return paths;
}

/** Name of the folder that was picked — the first segment every path shares. */
export function calibreLibraryName(paths: Iterable<string>): string {
  for (const path of paths) {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    // A single-segment path is a loose file, not something inside the chosen folder.
    if (parts.length >= 2 && parts[0]) return parts[0];
  }
  return '';
}

/**
 * Key a book is recognised by across imports.
 *
 * Calibre's own id when the folder carries one, because it survives the user renaming a title. When
 * it does not, title and author are the only stable pair available; matching on the file path would
 * fail the moment the library is moved or copied, which is exactly when it gets re-picked.
 */
function identityKey(book: {
  calibreId?: number;
  title?: string;
  author?: string;
  name?: string;
}): string {
  if (typeof book.calibreId === 'number' && Number.isFinite(book.calibreId)) {
    return `id:${book.calibreId}`;
  }
  const title = (book.title ?? book.name ?? '').trim().toLowerCase();
  const author = (book.author ?? '').trim().toLowerCase();
  return `t:${title}|${author}`;
}

/**
 * Candidates that are not already on the shelf.
 *
 * Without this, picking the same library a second time — after adding twenty books to it, which is
 * the normal reason to re-pick — imports all four thousand again and doubles the shelf.
 */
export function newCalibreBooks(
  candidates: CalibreBookCandidate[],
  shelved: Iterable<ShelvedBookIdentity>,
): CalibreBookCandidate[] {
  const seen = new Set<string>();
  for (const book of shelved) {
    if (!book) continue;
    seen.add(identityKey(book));
  }
  return candidates.filter((candidate) => !seen.has(identityKey(candidate)));
}

export function planCalibreLibraryFiles(
  files: Iterable<PickedLibraryFile>,
  shelved: Iterable<ShelvedBookIdentity> = [],
): CalibreImportPlan {
  const paths = pickedLibraryPaths(files);
  const books = planCalibreImport(paths);
  const readable = readableCalibreBooks(books);
  const fresh = newCalibreBooks(readable, shelved);
  const skipped = unreadableCalibreFormats(books);
  return {
    libraryName: calibreLibraryName(paths),
    books,
    readable,
    fresh,
    duplicateCount: readable.length - fresh.length,
    skipped,
    skippedCount: Object.values(skipped).reduce((total, count) => total + count, 0),
  };
}

/** "pdf (2), mobi (1)" — commonest first, so the confirmation leads with what matters. */
export function describeSkippedFormats(skipped: Record<string, number>): string {
  return Object.entries(skipped)
    .sort((a, b) => (b[1] - a[1] !== 0 ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .map(([format, count]) => `${format} (${count})`)
    .join(', ');
}

/** Why a folder picker is or is not offered, so the UI can explain itself instead of failing. */
export type DirectoryPickerSupport = 'supported' | 'no-folder-picker-on-mobile' | 'unsupported';

export interface DirectoryPickerEnv {
  /** From `getPlatform()`. */
  platform: string;
  /** Whether `<input type="file">` accepts the `webkitdirectory` attribute at all. */
  hasWebkitDirectory: boolean;
}

/**
 * Whether this platform can hand over a whole folder.
 *
 * Android is the case that forced this to be explicit. Its document picker returns files without
 * the folders they came from — `webkitRelativePath` is empty, so every book looks like a loose file
 * and a Calibre plan comes back empty — and reading a real directory needs
 * `ACTION_OPEN_DOCUMENT_TREE` through a native plugin that this app does not have. An import
 * control that is present and cannot work is worse than one that explains its absence.
 */
export function directoryPickerSupport(env: DirectoryPickerEnv): DirectoryPickerSupport {
  if (env.platform === 'android' || env.platform === 'android-tv' || env.platform === 'ios') {
    return 'no-folder-picker-on-mobile';
  }
  return env.hasWebkitDirectory ? 'supported' : 'unsupported';
}
