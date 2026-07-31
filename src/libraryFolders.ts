/**
 * The five library folders, and which file belongs in which.
 *
 * One folder per kind, created inside a directory the user grants once, so a phone ends up with a
 * legible library instead of everything in Downloads. The names match Android's own public
 * directory names where they exist (Music, Podcasts, Audiobooks, Documents), so a file manager
 * shows the same structure the app does and nothing looks foreign.
 *
 * Books has no Android equivalent — there is no DIRECTORY_BOOKS — so it is ours.
 *
 * Pure on purpose: classification is decided here and tested here, with no Android APIs in sight.
 * The SAF grant and the actual writes live behind a plugin; this module only answers "what is this
 * file, and where does it go".
 */

export type LibraryFolder = 'music' | 'podcasts' | 'audiobooks' | 'books' | 'documents';

export const LIBRARY_FOLDERS: readonly LibraryFolder[] = [
  'music',
  'podcasts',
  'audiobooks',
  'books',
  'documents',
] as const;

/** Directory name on disk. Capitalised to match Android's own public directories. */
export const FOLDER_DIR_NAME: Record<LibraryFolder, string> = {
  music: 'Music',
  podcasts: 'Podcasts',
  audiobooks: 'Audiobooks',
  books: 'Books',
  documents: 'Documents',
};

/*
 * Extensions per folder.
 *
 * Audiobook containers are listed apart from music even though several are audio: m4b, aa and aax
 * are audiobooks by construction, and the existing native scan already separates them, so a
 * chaptered book never lands among the singles.
 *
 * AZW3 and MOBI sit under books despite no reader existing yet. A file the app cannot open still
 * belongs in the right folder — filing it under Documents because the parser is missing would be
 * lying about what it is.
 */
const EXTENSIONS: Record<LibraryFolder, readonly string[]> = {
  music: ['mp3', 'flac', 'ogg', 'wav', 'm4a', 'opus', 'aac', 'webm', 'alac', 'aiff'],
  podcasts: [],
  audiobooks: ['m4b', 'aa', 'aax'],
  books: ['epub', 'azw3', 'azw', 'mobi', 'kfx', 'fb2'],
  documents: ['pdf', 'docx', 'doc', 'txt', 'md', 'html', 'htm', 'rtf', 'odt'],
};

/** Lowercase extension without the dot, or '' when there isn't one. */
export function fileExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Which folder a file belongs in, or null when the app has no place for it.
 *
 * Null rather than a default: dropping an unknown file into Documents makes the shelf lie about
 * its contents, and the shelves are the whole point of doing this.
 *
 * Podcasts is never inferred from an extension — a podcast is an episode of a subscribed feed, and
 * that is a fact about provenance the filename cannot carry. Episodes are filed by the subscription
 * that fetched them.
 */
export function folderForFile(fileName: string): LibraryFolder | null {
  const ext = fileExtension(fileName);
  if (!ext) return null;
  for (const folder of LIBRARY_FOLDERS) {
    if (EXTENSIONS[folder].includes(ext)) return folder;
  }
  return null;
}

/** Every extension the library will collect, for a picker filter or a scan query. */
export function collectableExtensions(): string[] {
  return LIBRARY_FOLDERS.flatMap((f) => [...EXTENSIONS[f]]).sort();
}

/**
 * True when the app can read the file's contents today, as opposed to merely filing it.
 *
 * The distinction is deliberate and user-facing: a MOBI belongs on the Books shelf and should be
 * visible there, but the app cannot narrate it yet. Showing it greyed is honest; hiding it makes a
 * library look emptier than it is, and silently filing it elsewhere is worse than both.
 */
export function isReadableToday(fileName: string): boolean {
  const ext = fileExtension(fileName);
  const unreadable = ['azw3', 'azw', 'mobi', 'kfx', 'fb2', 'doc', 'odt', 'rtf'];
  return folderForFile(fileName) !== null && !unreadable.includes(ext);
}

/** Relative path a collected file should be written to, inside the granted directory. */
export function targetPathFor(fileName: string, rootName = 'Sandbox'): string | null {
  const folder = folderForFile(fileName);
  if (!folder) return null;
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return `${rootName}/${FOLDER_DIR_NAME[folder]}/${base}`;
}
