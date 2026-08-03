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
  /** The parser. Injected so a test does not have to build a valid MP4. */
  parse: (
    read: (offset: number, length: number) => Promise<Uint8Array | null>,
    fileSize: number,
  ) => Promise<Array<{ startSeconds: number; title: string }>>;
}

/** A book, described by only the parts that decide where its bytes are. */
export interface ChapterSourceTarget {
  /** MediaStore id or locker entry id, depending on where it came from. */
  id: string;
  /** content:// for a device scan, https:// for a catalogue book, file:// for a download. */
  uri?: string;
}

/**
 * Whether this is worth opening at all.
 *
 * Only containers that can carry a chapter atom. Reading the first kilobytes of an MP3 to discover
 * it is an MP3 is a wasted round trip per book, and the shelf asks about every book it draws.
 */
export function mayCarryChapters(input: { uri?: string; mimeType?: string; name?: string }): boolean {
  const blob = `${input.mimeType ?? ''} ${input.uri ?? ''} ${input.name ?? ''}`.toLowerCase();
  if (/\.(m4b|m4a|mp4|aac)(\?|#|$)/.test(blob)) return true;
  return /mp4|m4b|m4a|aac/.test(input.mimeType?.toLowerCase() ?? '');
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

  const source = uri.startsWith('content://')
    ? await deps.fromContentUri(uri)
    : id
      ? await deps.fromLockerEntry(id)
      : null;
  if (!source || source.size <= 0) return [];

  try {
    const rows = await deps.parse(source.read, source.size);
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
