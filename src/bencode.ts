/**
 * Bencode decoder — the format `.torrent` files are written in.
 *
 * Written here rather than pulled in: bencode is four types and about a hundred lines, and this
 * app ships on F-Droid where a dependency is review time somebody pays for. Decode only; nothing
 * in this app writes torrents.
 *
 * Byte strings stay as bytes rather than becoming JavaScript strings. A torrent's `pieces` field
 * is raw concatenated SHA-1 digests, and decoding that as UTF-8 corrupts it silently — the length
 * still looks plausible, so the damage only shows up as a hash mismatch much later.
 */

export type BencodeValue = Uint8Array | number | BencodeValue[] | { [key: string]: BencodeValue };

const CHAR_COLON = 0x3a; // :
const CHAR_i = 0x69;
const CHAR_l = 0x6c;
const CHAR_d = 0x64;
const CHAR_e = 0x65;

interface Cursor {
  data: Uint8Array;
  pos: number;
}

function fail(message: string): never {
  throw new Error(`bencode: ${message}`);
}

function decodeValue(cursor: Cursor): BencodeValue {
  if (cursor.pos >= cursor.data.length) fail('unexpected end of input');
  const marker = cursor.data[cursor.pos]!;

  if (marker === CHAR_i) return decodeInteger(cursor);
  if (marker === CHAR_l) return decodeList(cursor);
  if (marker === CHAR_d) return decodeDict(cursor);
  return decodeBytes(cursor);
}

function decodeInteger(cursor: Cursor): number {
  cursor.pos += 1; // skip 'i'
  const end = cursor.data.indexOf(CHAR_e, cursor.pos);
  if (end < 0) fail('unterminated integer');
  const text = new TextDecoder().decode(cursor.data.subarray(cursor.pos, end));
  cursor.pos = end + 1;
  const value = Number(text);
  if (!Number.isFinite(value)) fail(`invalid integer "${text}"`);
  return value;
}

function decodeBytes(cursor: Cursor): Uint8Array {
  const colon = cursor.data.indexOf(CHAR_COLON, cursor.pos);
  if (colon < 0) fail('unterminated string length');
  const length = Number(new TextDecoder().decode(cursor.data.subarray(cursor.pos, colon)));
  if (!Number.isInteger(length) || length < 0) fail('invalid string length');
  const start = colon + 1;
  const end = start + length;
  if (end > cursor.data.length) fail('string runs past end of input');
  cursor.pos = end;
  return cursor.data.subarray(start, end);
}

function decodeList(cursor: Cursor): BencodeValue[] {
  cursor.pos += 1; // skip 'l'
  const out: BencodeValue[] = [];
  while (cursor.pos < cursor.data.length && cursor.data[cursor.pos] !== CHAR_e) {
    out.push(decodeValue(cursor));
  }
  if (cursor.pos >= cursor.data.length) fail('unterminated list');
  cursor.pos += 1; // skip 'e'
  return out;
}

function decodeDict(cursor: Cursor): { [key: string]: BencodeValue } {
  cursor.pos += 1; // skip 'd'
  const out: { [key: string]: BencodeValue } = {};
  while (cursor.pos < cursor.data.length && cursor.data[cursor.pos] !== CHAR_e) {
    // Keys are always byte strings, and are safe to read as text — unlike values.
    const key = new TextDecoder().decode(decodeBytes(cursor));
    out[key] = decodeValue(cursor);
  }
  if (cursor.pos >= cursor.data.length) fail('unterminated dictionary');
  cursor.pos += 1; // skip 'e'
  return out;
}

export function bencodeDecode(data: Uint8Array): BencodeValue {
  const cursor: Cursor = { data, pos: 0 };
  const value = decodeValue(cursor);
  return value;
}

/** Read a dictionary entry as text. Returns '' when absent or not a byte string. */
export function bencodeText(value: BencodeValue | undefined): string {
  if (!(value instanceof Uint8Array)) return '';
  return new TextDecoder().decode(value);
}

export function bencodeNumber(value: BencodeValue | undefined): number {
  return typeof value === 'number' ? value : 0;
}

export function bencodeList(value: BencodeValue | undefined): BencodeValue[] {
  return Array.isArray(value) ? value : [];
}

export function bencodeDict(
  value: BencodeValue | undefined,
): { [key: string]: BencodeValue } | null {
  if (!value || value instanceof Uint8Array || Array.isArray(value) || typeof value === 'number') {
    return null;
  }
  return value;
}
