import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chapterContainerFor,
  clearAudiobookChapterCache,
  mayCarryChapters,
  readAudiobookChapters,
  readAudiobookChaptersCached,
  type ChapterSourceDeps,
} from './audiobookChapterSource';

const CHAPTERS = [
  { startSeconds: 0, title: 'One' },
  { startSeconds: 600, title: 'Two' },
];

function deps(overrides: Partial<ChapterSourceDeps> = {}): ChapterSourceDeps {
  return {
    fromContentUri: vi.fn(async () => ({ read: async () => null, size: 5_000 })),
    fromLockerEntry: vi.fn(async () => ({ read: async () => null, size: 5_000 })),
    parse: vi.fn(async () => CHAPTERS),
    parseId3: vi.fn(async () => CHAPTERS),
    ...overrides,
  };
}

/** Stated on every target, because nothing is opened until the container is known. */
const M4B = { mimeType: 'audio/mp4' };
const MP3 = { mimeType: 'audio/mpeg' };

beforeEach(() => {
  clearAudiobookChapterCache();
});

describe('chapterContainerFor', () => {
  it('recognises the MP4 family, by name or by type', () => {
    expect(chapterContainerFor({ name: 'book.m4b' })).toBe('mp4');
    expect(chapterContainerFor({ name: 'Dune.m4a' })).toBe('mp4');
    expect(chapterContainerFor({ mimeType: 'audio/mp4' })).toBe('mp4');
  });

  it('recognises MP3, which is how a great many audiobooks actually ship', () => {
    // The only book on the test device: one file, 845mb, past thirty hours.
    expect(chapterContainerFor({ name: 'The Way of the Psychonaut.mp3' })).toBe('mp3');
    expect(chapterContainerFor({ mimeType: 'audio/mpeg' })).toBe('mp3');
  });

  it('recognises a content URI only by its type, having no extension to read', () => {
    expect(chapterContainerFor({ uri: 'content://media/external/audio/media/42' })).toBeNull();
    expect(
      chapterContainerFor({ uri: 'content://media/external/audio/media/42', mimeType: 'audio/mpeg' }),
    ).toBe('mp3');
  });

  it('declines a container that carries no chapter table at all', () => {
    expect(chapterContainerFor({ name: 'book.flac' })).toBeNull();
    expect(chapterContainerFor({ name: 'book.ogg', mimeType: 'audio/ogg' })).toBeNull();
    expect(chapterContainerFor({})).toBeNull();
  });
});

describe('mayCarryChapters', () => {
  it('agrees with the container test', () => {
    expect(mayCarryChapters({ name: 'book.m4b' })).toBe(true);
    expect(mayCarryChapters({ name: 'chapter-01.mp3' })).toBe(true);
    expect(mayCarryChapters({ name: 'book.flac' })).toBe(false);
    expect(mayCarryChapters({})).toBe(false);
  });
});

describe('readAudiobookChapters', () => {
  it('reads a device book through the content resolver, not the locker', async () => {
    // The bug this file exists for: a MediaStore id looked up in the locker blob store, which
    // never held it, so every device book reported no chapters.
    const d = deps();
    const rows = await readAudiobookChapters(
      { id: '42', uri: 'content://media/external/audio/media/42', ...M4B },
      d,
    );
    expect(rows).toHaveLength(2);
    expect(d.fromContentUri).toHaveBeenCalledWith('content://media/external/audio/media/42');
    expect(d.fromLockerEntry).not.toHaveBeenCalled();
  });

  it('reads an imported book from the locker', async () => {
    const d = deps();
    await readAudiobookChapters({ id: 'local-9', ...M4B }, d);
    expect(d.fromLockerEntry).toHaveBeenCalledWith('local-9');
    expect(d.fromContentUri).not.toHaveBeenCalled();
  });

  it('sends an MP4 to the atom parser', async () => {
    const d = deps();
    await readAudiobookChapters({ id: 'x', ...M4B }, d);
    expect(d.parse).toHaveBeenCalled();
    expect(d.parseId3).not.toHaveBeenCalled();
  });

  it('sends an MP3 to the ID3 parser', async () => {
    // The two formats share no structure, so reading one as the other finds nothing at all.
    const d = deps();
    await readAudiobookChapters({ id: 'x', ...MP3 }, d);
    expect(d.parseId3).toHaveBeenCalled();
    expect(d.parse).not.toHaveBeenCalled();
  });

  it('does not open a file whose container carries no chapters', async () => {
    const d = deps();
    expect(await readAudiobookChapters({ id: 'x', name: 'book.flac' }, d)).toEqual([]);
    expect(d.fromLockerEntry).not.toHaveBeenCalled();
  });

  it('does not walk a remote file over the network', async () => {
    const d = deps();
    expect(
      await readAudiobookChapters({ id: 'x', uri: 'https://example.org/book.m4b', ...M4B }, d),
    ).toEqual([]);
    expect(d.parse).not.toHaveBeenCalled();
  });

  it('reports nothing when the file cannot be opened', async () => {
    const d = deps({ fromLockerEntry: vi.fn(async () => null) });
    expect(await readAudiobookChapters({ id: 'gone', ...M4B }, d)).toEqual([]);
  });

  it('reports nothing for a zero-length file rather than parsing it', async () => {
    const d = deps({ fromLockerEntry: vi.fn(async () => ({ read: async () => null, size: 0 })) });
    expect(await readAudiobookChapters({ id: 'empty', ...M4B }, d)).toEqual([]);
    expect(d.parse).not.toHaveBeenCalled();
  });

  it('treats a single marker as no chapter list, because it is not navigation', async () => {
    const d = deps({ parse: vi.fn(async () => [{ startSeconds: 0, title: 'Whole book' }]) });
    expect(await readAudiobookChapters({ id: 'one', ...M4B }, d)).toEqual([]);
  });

  it('survives a parser that throws on a malformed container', async () => {
    const d = deps({
      parse: vi.fn(async () => {
        throw new Error('bad atom');
      }),
    });
    expect(await readAudiobookChapters({ id: 'broken', ...M4B }, d)).toEqual([]);
  });

  it('keeps only what a chapter mark needs', async () => {
    const d = deps({
      parse: vi.fn(async () => [
        { startSeconds: 0, title: 'One', extra: 'ignored' } as never,
        { startSeconds: 60, title: 'Two' },
      ]),
    });
    expect(await readAudiobookChapters({ id: 'x', ...M4B }, d)).toEqual([
      { startSeconds: 0, title: 'One' },
      { startSeconds: 60, title: 'Two' },
    ]);
  });
});

describe('readAudiobookChaptersCached', () => {
  it('walks the file once however often it is asked', async () => {
    const d = deps();
    await Promise.all([
      readAudiobookChaptersCached({ id: '42', ...M4B }, d),
      readAudiobookChaptersCached({ id: '42', ...M4B }, d),
      readAudiobookChaptersCached({ id: '42', ...M4B }, d),
    ]);
    expect(d.parse).toHaveBeenCalledTimes(1);
  });

  it('shares the walk already in flight rather than starting another', () => {
    // The player asks on every position tick, so the first three ticks after a book loads would
    // otherwise each start their own walk of the same gigabyte.
    const d = deps();
    const a = readAudiobookChaptersCached({ id: '42', ...M4B }, d);
    const b = readAudiobookChaptersCached({ id: '42', ...M4B }, d);
    expect(a).toBe(b);
  });

  it('keeps different books apart', async () => {
    const d = deps();
    await readAudiobookChaptersCached({ id: '42', ...M4B }, d);
    await readAudiobookChaptersCached({ id: '43', ...M4B }, d);
    expect(d.parse).toHaveBeenCalledTimes(2);
  });

  it('does not cache a rejection as a permanent answer of none', async () => {
    const d = deps({
      fromLockerEntry: vi.fn(async () => {
        throw new Error('bridge down');
      }),
    });
    expect(await readAudiobookChaptersCached({ id: '42', ...M4B }, d)).toEqual([]);
  });
});
