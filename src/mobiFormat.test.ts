import { describe, expect, it } from 'vitest';
import { isReadableKindleFile, readKindleFileInfo } from './mobiFormat';

/**
 * Builds a Palm Database head the way a real MOBI or AZW3 begins.
 *
 * Synthetic rather than a fixture file: the point of these tests is the header arithmetic, and a
 * real book would make it impossible to see which byte a failure came from. Every offset here is
 * the one the parser reads.
 */
function buildKindleHead(options: {
  fileVersion?: number;
  encryption?: number;
  drmOffset?: number;
  title?: string;
  exth?: { updatedTitle?: string; coverOffset?: number };
  magic?: string;
} = {}): ArrayBuffer {
  const {
    fileVersion = 6,
    encryption = 0,
    drmOffset = 0xffffffff,
    title = 'A Synthetic Book',
    exth,
    magic = 'BOOKMOBI',
  } = options;

  const size = 4096;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i);
  };

  write(60, magic);
  view.setUint16(76, 2); // record count
  const record0 = 256;
  view.setUint32(78, record0); // record 0 offset
  view.setUint32(86, 2048); // record 1 offset

  view.setUint16(record0 + 12, encryption);
  write(record0 + 16, 'MOBI');
  const mobiHeaderLength = 232;
  view.setUint32(record0 + 20, mobiHeaderLength);
  view.setUint32(record0 + 36, fileVersion);
  const titleOffset = 700;
  view.setUint32(record0 + 84, titleOffset);
  write(record0 + titleOffset, title);
  view.setUint32(record0 + 108, 11); // first image index
  view.setUint32(record0 + 168, drmOffset);

  if (exth) {
    view.setUint32(record0 + 128, 0x40); // EXTH present
    const exthAt = record0 + 16 + mobiHeaderLength;
    write(exthAt, 'EXTH');
    const records: { tag: number; payload: Uint8Array }[] = [];
    if (exth.updatedTitle) {
      records.push({
        tag: 503,
        payload: Uint8Array.from(exth.updatedTitle, (c) => c.charCodeAt(0)),
      });
    }
    if (exth.coverOffset !== undefined) {
      const payload = new Uint8Array(4);
      new DataView(payload.buffer).setUint32(0, exth.coverOffset);
      records.push({ tag: 201, payload });
    }
    view.setUint32(exthAt + 8, records.length);
    let cursor = exthAt + 12;
    for (const record of records) {
      view.setUint32(cursor, record.tag);
      view.setUint32(cursor + 4, record.payload.byteLength + 8);
      bytes.set(record.payload, cursor + 8);
      cursor += record.payload.byteLength + 8;
    }
  }
  return buffer;
}

describe('readKindleFileInfo', () => {
  it('identifies a plain MOBI', () => {
    const info = readKindleFileInfo(buildKindleHead({ fileVersion: 6 }));
    expect(info.format).toBe('mobi');
    expect(info.drm).toBe(false);
    expect(info.blockedReason).toBeUndefined();
    expect(isReadableKindleFile(info)).toBe(true);
  });

  it('identifies AZW3 by its file version, not its extension', () => {
    const info = readKindleFileInfo(buildKindleHead({ fileVersion: 8 }));
    expect(info.format).toBe('azw3');
    expect(isReadableKindleFile(info)).toBe(true);
  });

  it('reads the full title rather than the truncated database name', () => {
    const info = readKindleFileInfo(buildKindleHead({ title: 'Pride and Prejudice' }));
    expect(info.title).toBe('Pride and Prejudice');
  });

  it('prefers the EXTH title when the file carries a better one', () => {
    const info = readKindleFileInfo(
      buildKindleHead({ title: 'truncated', exth: { updatedTitle: 'The Complete Title' } }),
    );
    expect(info.title).toBe('The Complete Title');
  });

  it('reads the cover offset so the shelf can find the artwork', () => {
    const info = readKindleFileInfo(buildKindleHead({ exth: { coverOffset: 3 } }));
    expect(info.coverOffset).toBe(3);
    expect(info.firstImageIndex).toBe(11);
  });
});

describe('DRM detection', () => {
  /*
   * Both checks matter. Decompressing a protected file yields garbage rather than an error, so a
   * miss here surfaces as a corrupt-looking book rather than an honest message.
   */
  it('catches the encryption flag', () => {
    for (const encryption of [1, 2]) {
      const info = readKindleFileInfo(buildKindleHead({ encryption }));
      expect(info.drm).toBe(true);
      expect(info.blockedReason).toBe('drm');
      expect(isReadableKindleFile(info)).toBe(false);
    }
  });

  it('catches DRM keys even when the flag says otherwise', () => {
    const info = readKindleFileInfo(buildKindleHead({ encryption: 0, drmOffset: 0x1234 }));
    expect(info.drm).toBe(true);
  });

  it('treats the no-keys sentinel as unprotected', () => {
    expect(readKindleFileInfo(buildKindleHead({ drmOffset: 0xffffffff })).drm).toBe(false);
  });

  it('rejects KFX outright, on its own signature', () => {
    const buffer = new ArrayBuffer(64);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < 'DRMION'.length; i += 1) bytes[i] = 'DRMION'.charCodeAt(i);
    const info = readKindleFileInfo(buffer);
    expect(info.format).toBe('kfx');
    expect(info.blockedReason).toBe('kfx-unsupported');
    expect(isReadableKindleFile(info)).toBe(false);
  });
});

describe('files that are not Kindle books', () => {
  it('says so for the wrong magic', () => {
    expect(readKindleFileInfo(buildKindleHead({ magic: 'NOTABOOK' })).format).toBe('not-kindle');
  });

  it('does not throw on a buffer too short to hold a header', () => {
    expect(readKindleFileInfo(new ArrayBuffer(4)).format).toBe('not-kindle');
    expect(readKindleFileInfo(new ArrayBuffer(0)).format).toBe('not-kindle');
  });

  it('does not read past the end of what it was given', () => {
    const full = buildKindleHead();
    const truncated = full.slice(0, 300);
    expect(() => readKindleFileInfo(truncated)).not.toThrow();
  });
});
