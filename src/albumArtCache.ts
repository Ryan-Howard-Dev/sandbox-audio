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

function tallyLockerAlbumArt(
  tracks: ReadonlyArray<{ albumArt?: string | null }>,
): { durables: ArtTally[]; blobCount: number; firstBlob?: string } {
  const durableByCanon = new Map<string, ArtTally>();
  let blobCount = 0;
  let firstBlob: string | undefined;

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
    blobCount += 1;
    if (!firstBlob) firstBlob = art;
  }

  return {
    durables: [...durableByCanon.values()].sort(
      (a, b) => b.count - a.count || Number(b.durable) - Number(a.durable),
    ),
    blobCount,
    firstBlob,
  };
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
