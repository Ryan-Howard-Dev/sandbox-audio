/**
 * Turning the number on a sleeve into a record.
 *
 * A barcode is the only identifier a physical release reliably carries, and MusicBrainz indexes
 * it — so a scan resolves to a release without an account, an API key, or a third party knowing
 * what is on somebody's shelf. The ownership record stays on the device; only the number goes out,
 * and only when a lookup is asked for.
 *
 * Deliberately no scanning here. This takes a string of digits from wherever — a camera, a keyboard,
 * a paste — and answers what it is. That keeps the part that can be wrong testable without a lens,
 * and means the feature works before any camera dependency exists.
 */

import { isPlausibleBarcode, normaliseBarcode } from './physicalCollection';

const MB_USER_AGENT = 'SandboxMusic/1.0.0 (https://github.com/sandbox-music; barcode-lookup)';
const MB_BASE = 'https://musicbrainz.org';

export interface BarcodeRelease {
  /** MusicBrainz release id. */
  id: string;
  title: string;
  artist: string;
  year?: number;
  trackCount?: number;
  /** 'CD', 'Vinyl', '12" Vinyl' — as the catalogue describes the physical media. */
  media?: string;
  barcode: string;
}

export type BarcodeLookup =
  | { status: 'found'; release: BarcodeRelease }
  /** The number is well formed and the catalogue has never seen it. */
  | { status: 'unknown' }
  /** Not a barcode at all — a mis-scan, or somebody typed four digits. */
  | { status: 'invalid' }
  /** No network, or the catalogue refused. Different from 'unknown': try again later. */
  | { status: 'unavailable' };

export interface BarcodeLookupDeps {
  fetchJson: (url: string, headers: Record<string, string>) => Promise<unknown>;
}

/**
 * What record carries this barcode.
 *
 * The three failure states are kept apart on purpose. "Not a barcode", "no such record" and
 * "could not ask" want three different things from the person holding the sleeve — retype it,
 * enter it by hand, or try again on wifi — and collapsing them into null tells them none of that.
 */
export async function lookupBarcode(
  raw: string,
  deps: BarcodeLookupDeps = defaultDeps(),
): Promise<BarcodeLookup> {
  if (!isPlausibleBarcode(raw)) return { status: 'invalid' };
  const barcode = normaliseBarcode(raw);

  let payload: unknown;
  try {
    payload = await deps.fetchJson(
      `${MB_BASE}/ws/2/release?query=barcode:${encodeURIComponent(barcode)}&fmt=json&limit=5`,
      { Accept: 'application/json', 'User-Agent': MB_USER_AGENT },
    );
  } catch {
    return { status: 'unavailable' };
  }

  const release = firstRelease(payload);
  if (!release) return { status: 'unknown' };
  return { status: 'found', release: { ...release, barcode } };
}

function firstRelease(payload: unknown): Omit<BarcodeRelease, 'barcode'> | null {
  const releases = (payload as { releases?: unknown })?.releases;
  if (!Array.isArray(releases) || releases.length === 0) return null;
  const row = releases[0] as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (!id || !title) return null;

  /*
   * artist-credit is an array of parts because a release can be credited to more than one artist,
   * and joinphrase carries the " & " or " feat. " between them. Reassembling it is how the shelf
   * ends up with the name actually printed on the sleeve.
   */
  const credit = Array.isArray(row['artist-credit']) ? row['artist-credit'] : [];
  const artist = credit
    .map((part) => {
      const p = part as { name?: unknown; joinphrase?: unknown };
      const name = typeof p.name === 'string' ? p.name : '';
      const join = typeof p.joinphrase === 'string' ? p.joinphrase : '';
      return `${name}${join}`;
    })
    .join('')
    .trim();

  const media = Array.isArray(row.media) ? (row.media[0] as Record<string, unknown>) : undefined;
  const trackCount = typeof media?.['track-count'] === 'number' ? media['track-count'] : undefined;
  const format = typeof media?.format === 'string' ? media.format : undefined;

  const date = typeof row.date === 'string' ? row.date : '';
  const year = /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined;

  return { id, title, artist, year, trackCount, media: format };
}

function defaultDeps(): BarcodeLookupDeps {
  return {
    fetchJson: async (url, headers) => {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`musicbrainz ${res.status}`);
      return res.json();
    },
  };
}
