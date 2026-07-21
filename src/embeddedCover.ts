/**
 * Best-effort extraction of embedded album art from audio files, entirely in
 * the browser with no external dependencies. Supports FLAC PICTURE metadata
 * blocks and MP3 ID3v2 APIC frames — the two most common cases for downloaded
 * albums that ship artwork inside the files instead of a separate cover image.
 *
 * Everything here is defensive: any malformed input simply yields `undefined`
 * so the caller can fall back to no cover. It never throws.
 */

interface ExtractedImage {
  data: ArrayBuffer;
  mime: string;
}

const FLAC_MAGIC = [0x66, 0x4c, 0x61, 0x43]; // "fLaC"
const ID3_MAGIC = [0x49, 0x44, 0x33]; // "ID3"

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function parseFlacPictureBlock(buf: ArrayBuffer): ExtractedImage | null {
  try {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    let p = 4; // skip 4-byte picture type
    const mimeLen = view.getUint32(p);
    p += 4;
    const mime = new TextDecoder().decode(bytes.subarray(p, p + mimeLen));
    p += mimeLen;
    const descLen = view.getUint32(p);
    p += 4 + descLen;
    p += 16; // width, height, color depth, colors used (4 bytes each)
    const dataLen = view.getUint32(p);
    p += 4;
    if (dataLen <= 0 || p + dataLen > buf.byteLength) return null;
    return { data: buf.slice(p, p + dataLen), mime: mime || 'image/jpeg' };
  } catch {
    return null;
  }
}

async function extractFlacCover(file: File): Promise<ExtractedImage | null> {
  // Metadata block headers live near the start; 1MB comfortably covers them.
  const headBuf = await file.slice(0, 1_048_576).arrayBuffer();
  const view = new DataView(headBuf);
  const bytes = new Uint8Array(headBuf);
  if (!startsWith(bytes, FLAC_MAGIC)) return null;

  let offset = 4;
  while (offset + 4 <= view.byteLength) {
    const header = view.getUint8(offset);
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const length =
      (view.getUint8(offset + 1) << 16) |
      (view.getUint8(offset + 2) << 8) |
      view.getUint8(offset + 3);
    const contentStart = offset + 4;

    if (blockType === 6) {
      // Picture block content may exceed the head buffer — slice it precisely.
      const blockBuf = await file
        .slice(contentStart, contentStart + length)
        .arrayBuffer();
      return parseFlacPictureBlock(blockBuf);
    }

    offset = contentStart + length;
    if (isLast) break;
  }
  return null;
}

function readSynchsafe(b: Uint8Array, i: number): number {
  return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
}

async function extractId3Cover(file: File): Promise<ExtractedImage | null> {
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (!startsWith(header, ID3_MAGIC)) return null;
  const major = header[3];
  const tagSize = readSynchsafe(header, 6);
  if (tagSize <= 0) return null;

  const tagBuf = await file.slice(10, 10 + tagSize).arrayBuffer();
  const view = new DataView(tagBuf);
  const tb = new Uint8Array(tagBuf);
  const latin1 = new TextDecoder('latin1');

  let offset = 0;
  while (offset + 10 <= view.byteLength) {
    const id = latin1.decode(tb.subarray(offset, offset + 4));
    const frameSize =
      major >= 4 ? readSynchsafe(tb, offset + 4) : view.getUint32(offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(id) || frameSize <= 0) break;

    if (id === 'APIC') {
      const frameEnd = offset + 10 + frameSize;
      let p = offset + 10;
      const encoding = tb[p];
      p += 1;
      // MIME type: null-terminated latin1
      let mimeEnd = p;
      while (mimeEnd < frameEnd && tb[mimeEnd] !== 0) mimeEnd++;
      const mime = latin1.decode(tb.subarray(p, mimeEnd));
      p = mimeEnd + 1;
      p += 1; // picture type byte
      // Description: null-terminated (double-null for UTF-16 encodings)
      if (encoding === 1 || encoding === 2) {
        while (p + 1 < frameEnd && !(tb[p] === 0 && tb[p + 1] === 0)) p += 2;
        p += 2;
      } else {
        while (p < frameEnd && tb[p] !== 0) p++;
        p += 1;
      }
      if (p >= frameEnd) return null;
      return {
        data: tagBuf.slice(p, frameEnd),
        mime: mime || 'image/jpeg',
      };
    }

    offset += 10 + frameSize;
  }
  return null;
}

/**
 * Returns an image File extracted from the audio file's embedded artwork, or
 * `undefined` if none is present / the format is unsupported. Never throws.
 */
export async function extractEmbeddedCover(file: File): Promise<File | undefined> {
  try {
    const name = file.name.toLowerCase();
    let found: ExtractedImage | null = null;

    if (name.endsWith('.flac') || file.type === 'audio/flac') {
      found = await extractFlacCover(file);
    } else if (name.endsWith('.mp3') || file.type === 'audio/mpeg') {
      found = await extractId3Cover(file);
    } else {
      // Unknown extension — try both, cheap reads first.
      found = (await extractId3Cover(file)) ?? (await extractFlacCover(file));
    }

    if (!found || found.data.byteLength === 0) return undefined;
    const ext = found.mime.includes('png') ? 'png' : 'jpg';
    return new File([found.data], `cover.${ext}`, { type: found.mime });
  } catch {
    return undefined;
  }
}

/** Try several files until one yields embedded artwork. Never throws. */
export async function extractEmbeddedCoverFromAny(
  files: File[],
  maxAttempts = 4,
): Promise<File | undefined> {
  const limit = Math.min(files.length, maxAttempts);
  for (let i = 0; i < limit; i++) {
    const cover = await extractEmbeddedCover(files[i]);
    if (cover) return cover;
  }
  return undefined;
}
