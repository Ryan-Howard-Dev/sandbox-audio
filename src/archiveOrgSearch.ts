/**
 * Internet Archive (archive.org) audio search — keyless, legal, public-domain & freely-hosted
 * audio: live bootlegs, DatPiff-legacy mixtapes, historical/classical recordings, netlabels.
 *
 * archive.org exposes direct file URLs, so results play through the normal element-src path
 * (no yt-dlp needed). We resolve each item's first playable audio file at search time.
 * Android-friendly (CapacitorHttp bypasses CORS); on web dev it may be blocked → returns [].
 */

import type { CatalogTrack } from './searchCatalog';
import type { MediaEnvelope } from './sandboxLayer1';
import { fetchWithTimeout, isJsonLikeContentType } from './fetchWithTimeout';

const SEARCH_TIMEOUT_MS = 9000;
const META_TIMEOUT_MS = 8000;
const PLAYABLE_AUDIO_RE = /\.(mp3|m4a|m4b|ogg|oga|opus|flac|wav)$/i;

type ArchiveSearchDoc = { identifier?: string; title?: string; creator?: string | string[] };
type ArchiveFile = { name?: string; format?: string; length?: string; title?: string };

async function json(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, timeoutMs);
    if (!res.ok) return null;
    if (!isJsonLikeContentType(res.headers.get('content-type') ?? '')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function creatorName(creator?: string | string[]): string {
  if (Array.isArray(creator)) return creator[0]?.trim() || 'Internet Archive';
  return creator?.trim() || 'Internet Archive';
}

/** Resolve one archive.org item to a playable catalog track (first audio file), or undefined. */
async function resolveItemTrack(doc: ArchiveSearchDoc): Promise<CatalogTrack | undefined> {
  const id = doc.identifier?.trim();
  const title = doc.title?.trim();
  if (!id || !title) return undefined;

  const meta = (await json(`https://archive.org/metadata/${encodeURIComponent(id)}`, META_TIMEOUT_MS)) as
    | { files?: ArchiveFile[] }
    | null;
  const files = meta?.files ?? [];
  const audio = files.find((f) => f.name && PLAYABLE_AUDIO_RE.test(f.name));
  if (!audio?.name) return undefined;

  const artist = creatorName(doc.creator);
  const url = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(audio.name)}`;
  const artworkUrl = `https://archive.org/services/img/${encodeURIComponent(id)}`;
  const durationSeconds = audio.length ? Math.round(Number(audio.length)) || undefined : undefined;

  const envelope: MediaEnvelope = {
    envelopeId: `archive-${id}`,
    title,
    artist,
    url,
    durationSeconds,
    provider: 'https',
    transport: 'element-src',
    sourceId: id,
    artworkUrl,
  };
  return {
    kind: 'track',
    id: `archive-${id}`,
    title,
    artist,
    artworkUrl,
    durationSeconds,
    envelope,
  };
}

/** Search Internet Archive audio and return playable catalog tracks (empty on failure). */
export async function searchArchiveOrgTracks(query: string, limit = 8): Promise<CatalogTrack[]> {
  const q = query.trim();
  if (!q) return [];
  const searchUrl =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(${q}) AND mediatype:audio`)}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator&sort[]=downloads desc&rows=${limit}&page=1&output=json`;

  const data = (await json(searchUrl, SEARCH_TIMEOUT_MS)) as
    | { response?: { docs?: ArchiveSearchDoc[] } }
    | null;
  const docs = data?.response?.docs ?? [];
  if (docs.length === 0) return [];

  const resolved = await Promise.all(docs.map((d) => resolveItemTrack(d).catch(() => undefined)));
  return resolved.filter((t): t is CatalogTrack => Boolean(t));
}

export interface ArchiveAudiobookHit {
  identifier: string;
  title: string;
  author: string;
  artworkUrl: string;
}

/**
 * Audiobook search over the Internet Archive's LibriVox collections.
 *
 * Why this exists: librivox.org's own API takes ~11s and gutendex.com times out entirely
 * (measured), so audiobook discovery had no usable source. The same public-domain
 * recordings are mirrored on archive.org, which answers in ~1s. Deliberately does NOT
 * resolve per-item file metadata (one extra request each) — chapters are resolved when a
 * book is opened, so listing stays a single fast call.
 */
export async function searchArchiveOrgAudiobooks(
  query: string,
  limit = 12,
): Promise<ArchiveAudiobookHit[]> {
  const q = query.trim();
  const collections = '(collection:librivoxaudio OR collection:audio_bookspoetry)';
  const clause = q ? `(${q}) AND ${collections}` : collections;
  const sort = q ? 'downloads desc' : 'week desc';
  const searchUrl =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(clause)}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator&sort[]=${encodeURIComponent(sort)}` +
    `&rows=${limit}&page=1&output=json`;

  const data = (await json(searchUrl, SEARCH_TIMEOUT_MS)) as
    | { response?: { docs?: ArchiveSearchDoc[] } }
    | null;
  const docs = data?.response?.docs ?? [];
  const out: ArchiveAudiobookHit[] = [];
  for (const doc of docs) {
    const id = doc.identifier?.trim();
    const title = doc.title?.trim();
    if (!id || !title) continue;
    out.push({
      identifier: id,
      title,
      author: creatorName(doc.creator),
      artworkUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
    });
  }
  return out;
}
