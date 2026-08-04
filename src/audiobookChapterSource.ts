/**
 * Where an audiobook's chapter table actually comes from.
 *
 * m4bChapters has parsed M4B chapter atoms, correctly and under test, since before the player
 * existed. EmbeddedChapterList calls it. And on a real phone it has never once returned a chapter,
 * because of a mismatch nobody could see from either end: the list passes a MediaStore id, and the
 * function it calls resolves ids through the *locker* blob store. A book scanned off the device
 * was never copied into the locker, so the lookup finds nothing, returns an empty list, and the
 * chapter list renders as though the book simply had no chapters. Two correct halves, wired to
 * different stores.
 *
 * So the source has to be chosen from what the book actually is:
 *
 *   A device-scanned book plays from a content:// URI and is read through the resolver.
 *   An imported book has a locker entry and is read from the blob or the native cache.
 *   A remote book is not read at all: walking an MP4's atoms over the network can mean several
 *   round trips into the middle of a large file, and a chapter list is not worth that on mobile
 *   data. It keeps the plain bar, which is honest.
 *
 * The readers are injected rather than imported so this can be tested without Capacitor, and so
 * the locker path stays lazily loaded — pulling lockerStorage into the player's import graph to
 * read a chapter table would be a poor trade.
 */
import type { ChapterMark } from './chapterScrubber';

/** What both byte sources look like once they are open. */
export interface ByteSource {
  read: (offset: number, length: number) => Promise<Uint8Array | null>;
  size: number;
}

export interface ChapterSourceDeps {
  /** Bytes of a content:// URI, on Android. */
  fromContentUri: (uri: string) => Promise<ByteSource | null>;
  /** Bytes of an imported locker track. */
  fromLockerEntry: (entryId: string) => Promise<ByteSource | null>;
  /** MP4 atoms. Injected so a test does not have to build a valid MP4. */
  parse: (
    read: (offset: number, length: number) => Promise<Uint8Array | null>,
    fileSize: number,
  ) => Promise<Array<{ startSeconds: number; title: string }>>;
  /** ID3 frames, for a book that ships as one MP3. */
  parseId3: (
    read: (offset: number, length: number) => Promise<Uint8Array | null>,
    fileSize: number,
  ) => Promise<Array<{ startSeconds: number; title: string }>>;
  /** A FLAC cue sheet, for a lossless rip kept as one file. */
  parseFlac: (
    read: (offset: number, length: number) => Promise<Uint8Array | null>,
    fileSize: number,
  ) => Promise<Array<{ startSeconds: number; title: string }>>;
}

/** A book, described by only the parts that decide where its bytes are and how to read them. */
export interface ChapterSourceTarget {
  /** MediaStore id or locker entry id, depending on where it came from. */
  id: string;
  /** content:// for a device scan, https:// for a catalogue book, file:// for a download. */
  uri?: string;
  /** Used to choose the parser. Falls back to the uri when a scan reported no type. */
  mimeType?: string;
  name?: string;
}

/** Which parser a file wants, or null when it is not a container that carries chapters. */
export type ChapterContainer = 'mp4' | 'mp3' | 'flac';

/**
 * Which container this is, from its name and type alone.
 *
 * Deliberately decided without opening the file. The shelf asks about every book it draws, and a
 * round trip per book to learn a fact the filename already states is a cost paid for nothing.
 *
 * Both formats are here because both are how audiobooks actually ship. The M4B is the one people
 * mean when they say audiobook, and it was the only one supported — but a great many books are
 * distributed as a single enormous MP3 with ID3 chapter frames, and that is the shape of the only
 * book on the device this was tested against: 845 megabytes, past thirty hours, one file.
 */
export function chapterContainerFor(input: {
  uri?: string;
  mimeType?: string;
  name?: string;
}): ChapterContainer | null {
  const mime = input.mimeType?.toLowerCase() ?? '';
  const blob = `${mime} ${input.uri ?? ''} ${input.name ?? ''}`.toLowerCase();
  if (/\.(m4b|m4a|mp4|aac)(\?|#|$)/.test(blob) || /mp4|m4b|m4a|aac/.test(mime)) return 'mp4';
  if (/\.flac(\?|#|$)/.test(blob) || /flac/.test(mime)) return 'flac';
  if (/\.mp3(\?|#|$)/.test(blob) || /mpeg|mp3/.test(mime)) return 'mp3';
  return null;
}

/** Whether this is worth opening at all. */
export function mayCarryChapters(input: {
  uri?: string;
  mimeType?: string;
  name?: string;
}): boolean {
  return chapterContainerFor(input) !== null;
}

/**
 * Chapters for one book, or an empty list.
 *
 * Empty means "none found", which covers both a book with no chapter table and a file that could
 * not be opened. The caller draws the plain bar either way, so distinguishing them would give it
 * nothing to do differently.
 */
export async function readAudiobookChapters(
  target: ChapterSourceTarget,
  deps: ChapterSourceDeps,
): Promise<ChapterMark[]> {
  const uri = target.uri?.trim() ?? '';
  const id = target.id?.trim() ?? '';

  // Remote books are deliberately not walked. See the note at the top of the file.
  if (/^https?:/i.test(uri)) return [];

  // Decided before anything is opened: a file that cannot carry chapters is not worth a read.
  const container = chapterContainerFor({ uri, mimeType: target.mimeType, name: target.name });
  if (!container) return [];

  const source = uri.startsWith('content://')
    ? await deps.fromContentUri(uri)
    : id
      ? await deps.fromLockerEntry(id)
      : null;
  if (!source || source.size <= 0) return [];

  try {
    const parse =
      container === 'mp3' ? deps.parseId3 : container === 'flac' ? deps.parseFlac : deps.parse;
    const rows = await parse(source.read, source.size);
    /*
     * One chapter is not a chapter list. An encoder that writes a single marker at zero has told
     * us the file starts at its start, which is not navigation, and showing it as a chapter list
     * of one invites a tap that goes nowhere.
     */
    return rows.length > 1 ? rows.map((row) => ({ startSeconds: row.startSeconds, title: row.title })) : [];
  } catch {
    return [];
  }
}

/**
 * The same, memoised per book for the life of the session.
 *
 * The player asks on every position tick and the shelf asks on every draw. Parsing walks atoms
 * across a file that may be a gigabyte, so asking twice for the same book is the difference
 * between a cheap feature and a stuttering one. In-flight promises are cached too, or the first
 * three ticks after a book loads all start their own walk of the same file.
 */
const cache = new Map<string, Promise<ChapterMark[]>>();

export function readAudiobookChaptersCached(
  target: ChapterSourceTarget,
  deps: ChapterSourceDeps,
): Promise<ChapterMark[]> {
  const key = `${target.id}::${target.uri ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = readAudiobookChapters(target, deps).catch(() => [] as ChapterMark[]);
  cache.set(key, pending);
  return pending;
}

/** Test seam, and the hook for a rescan after a file is replaced in place. */
export function clearAudiobookChapterCache(): void {
  cache.clear();
}
