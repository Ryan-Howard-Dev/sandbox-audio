/**
 * The real byte sources for audiobookChapterSource, kept apart from its logic.
 *
 * Everything here is a dynamic import. A chapter table is worth a few kilobytes read lazily; it is
 * not worth pulling lockerStorage, the native bridge and the MP4 walker into the player's start-up
 * graph, which is what a static import of any of them would do.
 */
import {
  readAudiobookChaptersCached,
  type ChapterSourceDeps,
  type ChapterSourceTarget,
} from './audiobookChapterSource';
import type { ChapterMark } from './chapterScrubber';

const DEPS: ChapterSourceDeps = {
  fromContentUri: async (uri) => {
    const { nativeMediaUriByteReader } = await import('./nativeExoLockerBridge');
    return nativeMediaUriByteReader(uri);
  },
  fromLockerEntry: async (entryId) => {
    const { lockerAudioByteReader } = await import('./lockerStorage');
    return lockerAudioByteReader(entryId);
  },
  parse: async (read, fileSize) => {
    const { readM4bChapters } = await import('./m4bChapters');
    return readM4bChapters(read, fileSize);
  },
  parseFlac: async (read, fileSize) => {
    const { readFlacChapters } = await import('./flacCuesheet');
    return readFlacChapters(read, fileSize);
  },
  parseId3: async (read, fileSize) => {
    const { readId3Chapters } = await import('./id3Chapters');
    const { normaliseMarks } = await import('./chapterScrubber');
    // ID3 frames arrive in file order, which is usually but not always start order.
    return normaliseMarks(await readId3Chapters(read, fileSize)).map((mark) => ({
      startSeconds: mark.startSeconds,
      title: mark.title ?? '',
    }));
  },
};

/** Chapters inside one audiobook file, or an empty list. Cached for the session. */
export function audiobookChaptersFor(target: ChapterSourceTarget): Promise<ChapterMark[]> {
  return readAudiobookChaptersCached(target, DEPS);
}
