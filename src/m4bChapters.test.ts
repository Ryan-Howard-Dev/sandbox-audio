import { describe, expect, it } from 'vitest';
import {
  normaliseChapters,
  parseChplPayload,
  readM4bChapters,
  type ByteRangeReader,
} from './m4bChapters';

/*
 * The whole point of this parser is that a nine-hour audiobook costs a few kilobytes of reading
 * rather than gigabytes of memory, so the fixtures put a deliberately enormous mdat in front of
 * the metadata and the reader asserts it is never read.
 */

const encoder = new TextEncoder();

function atom(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  const size = out.length;
  out[0] = (size >>> 24) & 0xff;
  out[1] = (size >>> 16) & 0xff;
  out[2] = (size >>> 8) & 0xff;
  out[3] = size & 0xff;
  out.set(encoder.encode(type), 4);
  out.set(body, 8);
  return out;
}

function chplBody(
  chapters: Array<{ seconds: number; title: string }>,
  countIsByte = false,
): Uint8Array {
  const parts: number[] = [0, 0, 0, 0]; // version + flags
  if (countIsByte) parts.push(chapters.length);
  else {
    parts.push(
      (chapters.length >>> 24) & 0xff,
      (chapters.length >>> 16) & 0xff,
      (chapters.length >>> 8) & 0xff,
      chapters.length & 0xff,
    );
  }
  for (const chapter of chapters) {
    const ticks = Math.round(chapter.seconds * 10_000_000);
    const high = Math.floor(ticks / 4_294_967_296);
    const low = ticks % 4_294_967_296;
    parts.push(
      (high >>> 24) & 0xff,
      (high >>> 16) & 0xff,
      (high >>> 8) & 0xff,
      high & 0xff,
      (low >>> 24) & 0xff,
      (low >>> 16) & 0xff,
      (low >>> 8) & 0xff,
      low & 0xff,
    );
    const title = encoder.encode(chapter.title);
    parts.push(title.length, ...title);
  }
  return new Uint8Array(parts);
}

const CHAPTERS = [
  { seconds: 0, title: 'Chapter One' },
  { seconds: 1_800.5, title: 'Chapter Two' },
  { seconds: 7_200, title: 'Chapter Three' },
];

/** A book with a huge mdat before moov, as older encoders write. */
function buildBook(options: { faststart?: boolean; countIsByte?: boolean; mdatSize?: number } = {}) {
  const chpl = atom('chpl', chplBody(CHAPTERS, options.countIsByte));
  const udta = atom('udta', chpl);
  const moov = atom('moov', udta);
  const mdatSize = options.mdatSize ?? 2_000_000_000;

  // mdat is declared but never materialised — reading it is exactly what must not happen.
  const mdatHeader = new Uint8Array(8);
  mdatHeader[0] = (mdatSize >>> 24) & 0xff;
  mdatHeader[1] = (mdatSize >>> 16) & 0xff;
  mdatHeader[2] = (mdatSize >>> 8) & 0xff;
  mdatHeader[3] = mdatSize & 0xff;
  mdatHeader.set(encoder.encode('mdat'), 4);

  const reads: Array<{ offset: number; length: number }> = [];
  const moovOffset = options.faststart ? 0 : mdatSize;
  const fileSize = mdatSize + moov.length;

  const read: ByteRangeReader = async (offset, length) => {
    reads.push({ offset, length });
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      const at = offset + i;
      if (options.faststart) {
        if (at < moov.length) out[i] = moov[at]!;
        else if (at - moov.length < 8) out[i] = mdatHeader[at - moov.length]!;
      } else {
        if (at < 8) out[i] = mdatHeader[at]!;
        else if (at >= moovOffset && at - moovOffset < moov.length) out[i] = moov[at - moovOffset]!;
      }
    }
    return out;
  };

  return { read, fileSize, reads };
}

describe('readM4bChapters', () => {
  it('reads chapters from a faststart file', async () => {
    const { read, fileSize } = buildBook({ faststart: true });
    const chapters = await readM4bChapters(read, fileSize);
    expect(chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two', 'Chapter Three']);
    expect(chapters[1]?.startSeconds).toBeCloseTo(1_800.5, 3);
  });

  /* The case the whole design exists for: metadata behind two gigabytes of audio. */
  it('reaches moov behind a two-gigabyte mdat', async () => {
    const { read, fileSize } = buildBook({ faststart: false });
    const chapters = await readM4bChapters(read, fileSize);
    expect(chapters).toHaveLength(3);
  });

  it('never reads the audio payload', async () => {
    const { read, fileSize, reads } = buildBook({ faststart: false });
    await readM4bChapters(read, fileSize);
    const total = reads.reduce((sum, r) => sum + r.length, 0);
    expect(total).toBeLessThan(64 * 1024);
    // mdat starts at byte 8; nothing may read inside it beyond its own header.
    expect(reads.some((r) => r.offset > 8 && r.offset < 1_000_000_000)).toBe(false);
  });

  /* Both count encodings occur in the wild; guessing wrong yields nonsense, not a clean failure. */
  it('reads the original single-byte chapter count', async () => {
    const { read, fileSize } = buildBook({ faststart: true, countIsByte: true });
    expect(await readM4bChapters(read, fileSize)).toHaveLength(3);
  });

  it('returns nothing for a file with no chapters', async () => {
    const moov = atom('moov', atom('udta', new Uint8Array(0)));
    const read: ByteRangeReader = async (offset, length) => {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) if (offset + i < moov.length) out[i] = moov[offset + i]!;
      return out;
    };
    expect(await readM4bChapters(read, moov.length)).toEqual([]);
  });

  it('returns nothing rather than throwing on rubbish input', async () => {
    const read: ByteRangeReader = async (_o, length) => new Uint8Array(length);
    expect(await readM4bChapters(read, 1_000)).toEqual([]);
    expect(await readM4bChapters(async () => null, 1_000)).toEqual([]);
    expect(await readM4bChapters(read, 0)).toEqual([]);
  });
});

describe('parseChplPayload', () => {
  it('decodes UTF-8 titles', () => {
    const body = chplBody([{ seconds: 12, title: 'Chapitre Un — Début' }]);
    expect(parseChplPayload(body)[0]?.title).toBe('Chapitre Un — Début');
  });

  it('returns nothing for a truncated payload', () => {
    const body = chplBody(CHAPTERS).subarray(0, 12);
    expect(parseChplPayload(body)).toEqual([]);
  });

  it('returns nothing for an empty payload', () => {
    expect(parseChplPayload(new Uint8Array(0))).toEqual([]);
  });
});

describe('normaliseChapters', () => {
  it('orders chapters by start time', () => {
    expect(
      normaliseChapters([
        { startSeconds: 100, title: 'B' },
        { startSeconds: 10, title: 'A' },
      ]).map((c) => c.title),
    ).toEqual(['A', 'B']);
  });

  it('collapses duplicate markers, keeping the titled one', () => {
    const out = normaliseChapters([
      { startSeconds: 50, title: '' },
      { startSeconds: 50, title: 'Real Title' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('Real Title');
  });

  /*
   * An untitled chapter stays untitled. Naming it "Chapter 4" would invent a number the book does
   * not use, which is the same quiet fabrication as a hardcoded bitrate.
   */
  it('leaves an untitled chapter empty rather than numbering it', () => {
    expect(normaliseChapters([{ startSeconds: 5, title: '' }])[0]?.title).toBe('');
  });

  it('drops markers with impossible start times', () => {
    expect(
      normaliseChapters([
        { startSeconds: -1, title: 'Bad' },
        { startSeconds: Number.NaN, title: 'Worse' },
        { startSeconds: 1, title: 'Good' },
      ]).map((c) => c.title),
    ).toEqual(['Good']);
  });
});
