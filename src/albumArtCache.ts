/**
 * Session-scoped last-known-good album cover URLs keyed by locker album group key.
 * Survives LocalView navigation and brief vault refresh/blob revocation gaps.
 */

import { canonicalArtworkSrc, sanitizeCoverArtUrl } from './displaySanitize';

const knownGoodByAlbumKey = new Map<string, string>();

export function getKnownGoodAlbumArt(albumKey: string): string | undefined {
  return sanitizeCoverArtUrl(knownGoodByAlbumKey.get(albumKey));
}

export function rememberKnownGoodAlbumArt(albumKey: string, url: string | undefined): void {
  const trimmed = sanitizeCoverArtUrl(url);
  if (!trimmed) {
    knownGoodByAlbumKey.delete(albumKey);
    return;
  }
  knownGoodByAlbumKey.set(albumKey, trimmed);
}

export function forgetKnownGoodAlbumArt(albumKey: string): void {
  knownGoodByAlbumKey.delete(albumKey);
}

export function transferKnownGoodAlbumArt(oldKey: string, newKey: string): void {
  const art = knownGoodByAlbumKey.get(oldKey);
  if (!art) return;
  knownGoodByAlbumKey.set(newKey, art);
  knownGoodByAlbumKey.delete(oldKey);
}

export function resolveLockerAlbumArtSrc(
  albumKey: string,
  vaultArt: string | undefined,
  previewArt: string | undefined,
  failedSrc: string | undefined,
): string | undefined {
  const preview = sanitizeCoverArtUrl(previewArt);
  if (preview) return preview;

  const vault = sanitizeCoverArtUrl(vaultArt);
  const cached = getKnownGoodAlbumArt(albumKey);

  // Vault sibling consensus changed — drop poisoned durable session cache.
  if (cached && vault && cached !== failedSrc && vault !== failedSrc) {
    const cachedCanon = canonicalArtworkSrc(cached);
    const vaultCanon = canonicalArtworkSrc(vault);
    if (cachedCanon && vaultCanon && cachedCanon !== vaultCanon) {
      const cachedDurable = isDurableLockerCoverUrl(cached);
      const vaultDurable = isDurableLockerCoverUrl(vault);
      if ((cachedDurable && !vaultDurable) || (vaultDurable && !cachedDurable)) {
        rememberKnownGoodAlbumArt(albumKey, vault);
        return vault;
      }
    }
  }

  // Stable session cache wins over vault blob URL churn for the same album group.
  if (cached && cached !== failedSrc) {
    if (!vault || vault === failedSrc) return cached;
    const cachedCanon = canonicalArtworkSrc(cached);
    const vaultCanon = canonicalArtworkSrc(vault);
    if (cachedCanon && vaultCanon && cachedCanon === vaultCanon) return cached;
    // Revoked per-track blobs (e.g. Nee Nah) must not beat a known-good sibling cover.
    if (vault.startsWith('blob:')) return cached;
  }

  if (vault && vault !== failedSrc) return vault;

  if (cached && cached !== failedSrc) return cached;

  return undefined;
}

function isDurableLockerCoverUrl(url: string): boolean {
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('/coverart') ||
    url.startsWith('/cover-proxy') ||
    url.startsWith('/musicbrainz')
  );
}

type ArtTally = { url: string; count: number; durable: boolean };

/**
 * Per-row object URLs mean one album can carry many distinct `blob:` strings for the
 * same pixels. Picking "first in array order" made genre mosaics flip whenever sibling
 * iteration order changed (collection tracks vs vault filter vs soft-refresh order).
 * Lexicographic min is deterministic for a given URL set.
 */
function stableBlobCoverUrl(blobUrls: readonly string[]): string | undefined {
  if (blobUrls.length === 0) return undefined;
  let best = blobUrls[0]!;
  for (let i = 1; i < blobUrls.length; i += 1) {
    const url = blobUrls[i]!;
    if (url < best) best = url;
  }
  return best;
}

function tallyLockerAlbumArt(
  tracks: ReadonlyArray<{ albumArt?: string | null }>,
): { durables: ArtTally[]; blobCount: number; firstBlob?: string } {
  const durableByCanon = new Map<string, ArtTally>();
  const blobUrls: string[] = [];

  for (const track of tracks) {
    const art = sanitizeCoverArtUrl(track.albumArt);
    if (!art) continue;
    if (isDurableLockerCoverUrl(art)) {
      const canon = canonicalArtworkSrc(art) ?? art;
      const row = durableByCanon.get(canon);
      if (row) {
        row.count += 1;
      } else {
        durableByCanon.set(canon, { url: art, count: 1, durable: true });
      }
      continue;
    }
    blobUrls.push(art);
  }

  return {
    durables: [...durableByCanon.values()].sort(
      (a, b) => b.count - a.count || Number(b.durable) - Number(a.durable),
    ),
    blobCount: blobUrls.length,
    firstBlob: stableBlobCoverUrl(blobUrls),
  };
}

/**
 * Hold a live mosaic/grid `blob:` cover across vault re-picks of a different per-row
 * object URL for the same album art. Durable URLs always win; dead prev yields to next.
 */
export function preferStableLockerCoverUrl(
  prev: string | undefined,
  next: string | undefined,
  liveUrls?: ReadonlySet<string> | null,
): string | undefined {
  const trimmedNext = sanitizeCoverArtUrl(next);
  const trimmedPrev = sanitizeCoverArtUrl(prev);
  if (!trimmedNext) return trimmedPrev;
  if (!trimmedPrev || trimmedPrev === trimmedNext) return trimmedNext;
  if (isDurableLockerCoverUrl(trimmedNext) && !isDurableLockerCoverUrl(trimmedPrev)) {
    return trimmedNext;
  }
  if (
    trimmedPrev.startsWith('blob:') &&
    trimmedNext.startsWith('blob:') &&
    (!liveUrls || liveUrls.has(trimmedPrev))
  ) {
    return trimmedPrev;
  }
  return trimmedNext;
}

/** Seed known-good without replacing a still-live blob with a different per-row remint. */
export function rememberKnownGoodAlbumArtStable(
  albumKey: string,
  url: string | undefined,
  siblings: ReadonlyArray<{ albumArt?: string | null }>,
): void {
  const trimmed = sanitizeCoverArtUrl(url);
  if (!trimmed) return;
  const existing = getKnownGoodAlbumArt(albumKey);
  if (
    existing?.startsWith('blob:') &&
    trimmed.startsWith('blob:') &&
    existing !== trimmed &&
    siblings.some((row) => sanitizeCoverArtUrl(row.albumArt) === existing)
  ) {
    return;
  }
  rememberKnownGoodAlbumArt(albumKey, trimmed);
}

/**
 * Album-group cover from sibling rows — majority durable wins; a lone wrong-catalog
 * durable URL cannot beat two or more sibling blob covers (Westside Gunn → 21 Savage fix).
 */
export function pickLockerAlbumCover(
  tracks: ReadonlyArray<{ albumArt?: string | null }>,
): string | undefined {
  const { durables, blobCount, firstBlob } = tallyLockerAlbumArt(tracks);
  const bestDurable = durables[0];

  if (bestDurable) {
    const loneDurableOutlier = bestDurable.count === 1 && blobCount >= 3;
    if (!loneDurableOutlier) {
      if (bestDurable.count >= 2 || blobCount === 0) return bestDurable.url;
      if (blobCount === 1) return bestDurable.url;
    }
  }

  if (firstBlob) return firstBlob;

  return bestDurable?.url;
}

/** Track-row thumb art — same resolver chain as album carousels / album view. */
export function resolveLockerTrackThumbArt(
  entry: { albumArt?: string | null },
  albumKey: string | null,
  siblings: ReadonlyArray<{ albumArt?: string | null }>,
  previewArt: string | undefined,
  failedSrc: string | undefined,
): string | undefined {
  if (!albumKey) return sanitizeCoverArtUrl(entry.albumArt);
  return resolveLockerAlbumArtSrc(
    albumKey,
    pickLockerAlbumCover(siblings),
    previewArt,
    failedSrc,
  );
}
