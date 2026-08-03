import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
    ...overrides,
  };
}

beforeEach(() => {
  clearAudiobookChapterCache();
});

describe('mayCarryChapters', () => {
  it('opens the containers that can hold a chapter atom', () => {
    expect(mayCarryChapters({ uri: 'content://media/external/audio/media/42' , name: 'book.m4b' })).toBe(true);
    expect(mayCarryChapters({ mimeType: 'audio/mp4' })).toBe(true);
    expect(mayCarryChapters({ name: 'Dune.m4a' })).toBe(true);
  });

  it('does not open a file that cannot carry one', () => {
    expect(mayCarryChapters({ name: 'chapter-01.mp3', mimeType: 'audio/mpeg' })).toBe(false);
    expect(mayCarryChapters({ name: 'book.flac' })).toBe(false);
    expect(mayCarryChapters({})).toBe(false);
  });
});

describe('readAudiobookChapters', () => {
  it('reads a device book through the content resolver, not the locker', () => {
    // The bug this file exists for: a MediaStore id looked up in the locker blob store, which
    // never held it, so every device M4B reported no chapters.
    const d = deps();
    return readAudiobookChapters({ id: '42', uri: 'content://media/external/audio/media/42' }, d).then(
      (rows) => {
        expect(rows).toHaveLength(2);
        expect(d.fromContentUri).toHaveBeenCalledWith('content://media/external/audio/media/42');
        expect(d.fromLockerEntry).not.toHaveBeenCalled();
      },
    );
  });

  it('reads an imported book from the locker', async () => {
    const d = deps();
    await readAudiobookChapters({ id: 'local-9' }, d);
    expect(d.fromLockerEntry).toHaveBeenCalledWith('local-9');
    expect(d.fromContentUri).not.toHaveBeenCalled();
  });

  it('does not walk a remote file over the network', async () => {
    const d = deps();
    expect(await readAudiobookChapters({ id: 'x', uri: 'https://example.org/book.m4b' }, d)).toEqual(
      [],
    );
    expect(d.parse).not.toHaveBeenCalled();
  });

  it('reports nothing when the file cannot be opened', async () => {
    const d = deps({ fromLockerEntry: vi.fn(async () => null) });
    expect(await readAudiobookChapters({ id: 'gone' }, d)).toEqual([]);
  });

  it('reports nothing for a zero-length file rather than parsing it', async () => {
    const d = deps({ fromLockerEntry: vi.fn(async () => ({ read: async () => null, size: 0 })) });
    expect(await readAudiobookChapters({ id: 'empty' }, d)).toEqual([]);
    expect(d.parse).not.toHaveBeenCalled();
  });

  it('treats a single marker as no chapter list, because it is not navigation', async () => {
    const d = deps({ parse: vi.fn(async () => [{ startSeconds: 0, title: 'Whole book' }]) });
    expect(await readAudiobookChapters({ id: 'one' }, d)).toEqual([]);
  });

  it('survives a parser that throws on a malformed container', async () => {
    const d = deps({
      parse: vi.fn(async () => {
        throw new Error('bad atom');
      }),
    });
    expect(await readAudiobookChapters({ id: 'broken' }, d)).toEqual([]);
  });

  it('keeps only what a chapter mark needs', async () => {
    const d = deps({
      parse: vi.fn(async () => [
        { startSeconds: 0, title: 'One', extra: 'ignored' } as never,
        { startSeconds: 60, title: 'Two' },
      ]),
    });
    expect(await readAudiobookChapters({ id: 'x' }, d)).toEqual([
      { startSeconds: 0, title: 'One' },
      { startSeconds: 60, title: 'Two' },
    ]);
  });
});

describe('readAudiobookChaptersCached', () => {
  it('walks the file once however often it is asked', async () => {
    const d = deps();
    await Promise.all([
      readAudiobookChaptersCached({ id: '42' }, d),
      readAudiobookChaptersCached({ id: '42' }, d),
      readAudiobookChaptersCached({ id: '42' }, d),
    ]);
    expect(d.parse).toHaveBeenCalledTimes(1);
  });

  it('shares the walk already in flight rather than starting another', () => {
    // The player asks on every position tick, so the first three ticks after a book loads would
    // otherwise each start their own walk of the same gigabyte.
    const d = deps();
    const a = readAudiobookChaptersCached({ id: '42' }, d);
    const b = readAudiobookChaptersCached({ id: '42' }, d);
    expect(a).toBe(b);
  });

  it('keeps different books apart', async () => {
    const d = deps();
    await readAudiobookChaptersCached({ id: '42' }, d);
    await readAudiobookChaptersCached({ id: '43' }, d);
    expect(d.parse).toHaveBeenCalledTimes(2);
  });

  it('does not cache a rejection as a permanent answer of none', async () => {
    const d = deps({
      fromLockerEntry: vi.fn(async () => {
        throw new Error('bridge down');
      }),
    });
    expect(await readAudiobookChaptersCached({ id: '42' }, d)).toEqual([]);
  });
});
