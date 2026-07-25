/**
 * Taste-driven discovery: Daily / Weekly Discover built from what the user actually
 * plays, not from generic catalog queries.
 *
 * The catalog shelves (exploreCatalog) answer "what is popular in this genre"; these
 * answer "who sounds like the artists YOU listen to, that you do not already own".
 * Seeds come from the local taste profile, expanded through keyless similar-artist
 * lookups, then filtered against the locker so nothing you already have comes back.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { getTasteProfile } from './tasteProfile';
import { getSimilarArtistsBest } from './lastfmSimilar';
import { fetchCatalogApiResults } from './catalogFetch';
import { catalogSearchUrl } from './catalogApi';
import { catalogArtworkUrl, catalogPlayUrlFromPreview } from './catalogDirect';
import { getLockerEntriesSnapshot, normalizeLockerKeyPart } from './lockerStorage';
import { diversifyEnvelopesByArtist } from './exploreCatalog';

export type TasteShelfKind = 'daily' | 'weekly';

/** Top artists by affinity, strongest first. */
export function topTasteArtists(limit = 8): string[] {
  const profile = getTasteProfile();
  return Object.entries(profile.artistAffinity)
    .filter(([name, score]) => name.trim() && score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

/**
 * Rotate which seeds are used so Daily changes each day and Weekly each week,
 * without needing any server-side state.
 */
export function seedWindowForKind(
  seeds: string[],
  kind: TasteShelfKind,
  now = Date.now(),
): string[] {
  if (seeds.length === 0) return [];
  const period = kind === 'daily' ? 86_400_000 : 7 * 86_400_000;
  const bucket = Math.floor(now / period);
  const take = Math.min(kind === 'daily' ? 3 : 5, seeds.length);
  const start = (bucket * take) % seeds.length;
  const out: string[] = [];
  for (let i = 0; i < take; i += 1) {
    out.push(seeds[(start + i) % seeds.length]!);
  }
  return out;
}

function lockerArtistKeys(): Set<string> {
  const keys = new Set<string>();
  for (const entry of getLockerEntriesSnapshot() ?? []) {
    const name = (entry.albumArtist || entry.artist || '').trim();
    if (name) keys.add(normalizeLockerKeyPart(name));
  }
  return keys;
}

function lockerTrackKeys(): Set<string> {
  const keys = new Set<string>();
  for (const entry of getLockerEntriesSnapshot() ?? []) {
    const t = (entry.title || '').trim();
    const a = (entry.artist || entry.albumArtist || '').trim();
    if (t) keys.add(`${normalizeLockerKeyPart(a)}::${normalizeLockerKeyPart(t)}`);
  }
  return keys;
}

async function topTrackForArtist(artist: string): Promise<MediaEnvelope | null> {
  try {
    const items = await fetchCatalogApiResults(
      catalogSearchUrl({ term: artist, media: 'music', entity: 'song', limit: 4 }),
    );
    const item = items.find((i) => i.trackName && i.artistName);
    if (!item) return null;
    const trackId = item.trackId ?? Math.floor(Math.random() * 1_000_000);
    // Same envelope shape the catalog shelves use, so playback/resolution behave
    // identically for a taste pick and a browse pick.
    return {
      envelopeId: `catalog-${trackId}`,
      title: item.trackName!,
      artist: item.artistName!,
      album: item.collectionName,
      url: catalogPlayUrlFromPreview(item.previewUrl),
      provider: 'https',
      transport: 'element-src',
      sourceId: String(trackId),
      mimeType: 'audio/mpeg',
      artworkUrl: catalogArtworkUrl(item.artworkUrl100, item.artworkUrl60),
      releaseYear: item.releaseDate?.slice(0, 4),
      durationSeconds: item.trackTimeMillis
        ? Math.floor(item.trackTimeMillis / 1000)
        : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Build a taste shelf: expand the user's top artists into similar artists they do NOT
 * already have, then pull one representative track each.
 */
export async function buildTasteDiscoverShelf(
  kind: TasteShelfKind,
  limit = 12,
): Promise<MediaEnvelope[]> {
  const seeds = seedWindowForKind(topTasteArtists(), kind);
  if (seeds.length === 0) return [];

  const owned = lockerArtistKeys();
  const ownedTracks = lockerTrackKeys();
  const candidates: string[] = [];
  const seenArtist = new Set<string>();

  // Expand every seed concurrently — done serially this took long enough that the
  // shelf was still empty by the time the user had scrolled past it.
  const similarLists = await Promise.all(
    seeds.map((seed) =>
      getSimilarArtistsBest(seed, 12).catch(() => [] as { name: string }[]),
    ),
  );
  for (const similar of similarLists) {
    for (const s of similar) {
      const name = s.name?.trim();
      if (!name) continue;
      const key = normalizeLockerKeyPart(name);
      // Recommendation, not inventory: skip anything already in the locker.
      if (owned.has(key) || seenArtist.has(key)) continue;
      seenArtist.add(key);
      candidates.push(name);
    }
  }
  if (candidates.length === 0) return [];

  const picked = await Promise.all(
    candidates.slice(0, Math.ceil(limit * 1.5)).map((artist) => topTrackForArtist(artist)),
  );
  const rows: MediaEnvelope[] = [];
  for (const env of picked) {
    if (!env) continue;
    const trackKey = `${normalizeLockerKeyPart(env.artist)}::${normalizeLockerKeyPart(env.title)}`;
    if (ownedTracks.has(trackKey)) continue;
    rows.push(env);
  }
  return diversifyEnvelopesByArtist(rows, limit);
}
