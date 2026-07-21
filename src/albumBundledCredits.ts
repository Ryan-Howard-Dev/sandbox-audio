/**
 * Offline featured-artist billing for albums where iTunes/locker tags omit per-track
 * collaborators (e.g. Kanye West — Donda).
 */

import { normalizeLockerKeyPart } from './lockerStorage';

function normalizeBundledTrackTitle(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/^\d+[\s.\-_]+/i, '')
    .replace(/\s*\((?:feat\.?|ft\.?|featuring|with)[^)]*\)/gi, '')
    .replace(/\s*\[(?:feat\.?|ft\.?|featuring|with)[^\]]*\]/gi, '')
    .replace(/\s+pt\s*2\b/gi, ' pt 2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeAlbumArtistKey(artist: string): string {
  return normalizeLockerKeyPart(artist);
}

function isDondaAlbum(albumName: string, albumArtist: string): boolean {
  const titleKey = normalizeLockerKeyPart(albumName);
  if (!titleKey.includes('donda')) return false;
  const artistKey = normalizeAlbumArtistKey(albumArtist);
  return (
    artistKey.includes('kanye') ||
    artistKey === 'donda' ||
    artistKey === '' ||
    artistKey.includes('ye')
  );
}

/** Per-track featured billing for Kanye West — Donda (standard + deluxe pt 2 tracks). */
const DONDA_TRACK_FEATURES: Record<string, string> = {
  'donda chant': 'Syleena Johnson',
  jail: 'Jay-Z',
  'god is': 'Vory',
  'off the grid': 'Playboi Carti, Fivio Foreign, Young Thug',
  hurricane: 'Lil Baby, The Weeknd',
  'praise god': 'Baby Keem, Travis Scott',
  jonah: 'Vory, Lil Durk',
  'ok ok': 'Young Thug, Shirley Murdock, Shenseea',
  junya: 'Playboi Carti',
  'believe what i say': 'Westside Gunn',
  '24': 'KayCyy',
  'remote control': 'Young Thug',
  moon: 'Kid Cudi, Don Toliver',
  'heaven and hell': 'Vory',
  donda: 'KayCyy',
  'keep my spirit alive': 'Conway the Machine, Westside Gunn, KayCyy',
  'jesus lord': 'Jay Electronica, Larry June',
  'new again': 'KayCyy, Chris Brown',
  'tell the vision': 'Pusha T, Baby Keem, Roddy Ricch',
  'lord i need you': 'Vory',
  'pure souls': 'Shenseea',
  'come to life': 'Ty Dolla $ign',
  'no child left behind': 'Vory',
  'jail pt 2': 'Jay-Z, DaBaby, Marilyn Manson',
  'ok ok pt 2': 'Young Thug, Shenseea',
  'junya pt 2': 'Playboi Carti, Tyler, The Creator',
  'donda pt 2': 'KayCyy',
  'jesus lord pt 2': 'Jay Electronica, Larry June, The LOX',
  'life of the party': 'André 3000',
  'remote control pt 2': 'Young Thug, Malik Dona',
  'keep my spirit alive pt 2': 'Conway the Machine, Westside Gunn, KayCyy',
};

/**
 * Featured artist billing for a locker track when online enrichment is unavailable.
 * Returns comma-separated guest names (no primary artist).
 */
export function lookupBundledTrackFeatures(
  albumName: string | undefined,
  albumArtist: string,
  trackTitle: string,
): string | null {
  const album = (albumName ?? '').trim();
  const artist = (albumArtist ?? '').trim();
  if (!album || !artist) return null;
  if (!isDondaAlbum(album, artist)) return null;

  const key = normalizeBundledTrackTitle(trackTitle);
  if (!key) return null;
  return DONDA_TRACK_FEATURES[key] ?? null;
}

/** Full per-track artist line (primary + bundled guests) for sparse locker billing. */
export function lookupBundledTrackArtistLine(
  albumName: string | undefined,
  albumArtist: string,
  trackTitle: string,
): string | null {
  const primary = albumArtist.trim();
  if (!primary) return null;
  const guests = lookupBundledTrackFeatures(albumName, primary, trackTitle);
  if (!guests) return null;
  return `${primary}, ${guests}`;
}
