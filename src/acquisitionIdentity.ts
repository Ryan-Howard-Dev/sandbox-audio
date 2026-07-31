/**
 * Pre-store acquisition identity verification.
 *
 * Play-time gates in playbackPipeline run too late for locker tracks — the wrong file is already
 * vaulted. Every path that writes audio into the locker must call `verifyAcquisitionCandidate`
 * against independent candidate metadata before bytes are stored.
 *
 * Decision: rejection surfaces an actionable reason on the download job. A silent skip is as bad
 * as storing the wrong recording (device reports: Donda live cut, Vultures cover).
 *
 * Reuses catalogIdentityMatch — do not fork a second matcher.
 */

import {
  durationDivergesFromCatalog,
  mobileResolveCatalogMismatchReason,
  mobileResolveHasNoIndependentMetadata,
  type IdentityMeta,
} from './catalogIdentityMatch';

export type AcquisitionIdentityOk = { ok: true };
export type AcquisitionIdentityReject = { ok: false; reason: string };
export type AcquisitionIdentityVerdict = AcquisitionIdentityOk | AcquisitionIdentityReject;

/**
 * Verify a resolve/search candidate against catalog identity before downloading or storing.
 *
 * Requires independent candidate metadata. Catalog-echoed fields (the play-time UNVERIFIED case)
 * are rejected here — acquisition cannot afford to store an unverified blob under a catalog title.
 */
export function verifyAcquisitionCandidate(
  catalog: IdentityMeta,
  candidate: IdentityMeta,
): AcquisitionIdentityVerdict {
  const catalogTitle = catalog.title?.trim() ?? '';
  if (!catalogTitle) {
    return { ok: false, reason: 'catalog title missing — cannot verify identity before store' };
  }

  if (mobileResolveHasNoIndependentMetadata(catalog, candidate)) {
    return {
      ok: false,
      reason:
        'candidate reported no independent metadata — refusing to store unverified audio under catalog title',
    };
  }

  const mismatch = mobileResolveCatalogMismatchReason(catalog, candidate);
  if (mismatch) {
    return { ok: false, reason: mismatch };
  }

  return { ok: true };
}

export type LockerDurationIdentitySuspect = {
  entryId: string;
  title: string;
  artist: string;
  albumName?: string;
  catalogDurationSeconds: number;
  storedDurationSeconds: number;
  reason: string;
};

export type CatalogDurationHint = {
  title: string;
  artist: string;
  albumName?: string;
  durationSeconds: number;
};

function normalizeKeyPart(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function catalogLookupKey(title: string, artist: string, albumName?: string): string {
  return `${normalizeKeyPart(artist)}␟${normalizeKeyPart(title)}␟${normalizeKeyPart(albumName)}`;
}

/**
 * Detect already-stored locker rows whose duration diverges from catalog beyond
 * MOBILE_DURATION_MIN_RATIO / MAX_RATIO.
 *
 * Strongest available signal when source titles were overwritten with catalog metadata at store
 * time (mobile acquisition stamps catalog duration). Does not delete — ADR 001. Callers offer
 * user-confirmed re-acquisition via `queueLockerIdentityRepairReacquire`.
 */
export function findLockerDurationIdentitySuspects(
  entries: ReadonlyArray<{
    id: string;
    title: string;
    artist: string;
    albumName?: string;
    durationSeconds: number;
  }>,
  catalogHints: ReadonlyArray<CatalogDurationHint>,
): LockerDurationIdentitySuspect[] {
  const byExact = new Map<string, CatalogDurationHint>();
  const byTitleArtist = new Map<string, CatalogDurationHint>();
  for (const hint of catalogHints) {
    if (!(hint.durationSeconds > 45)) continue;
    byExact.set(catalogLookupKey(hint.title, hint.artist, hint.albumName), hint);
    const ta = catalogLookupKey(hint.title, hint.artist);
    if (!byTitleArtist.has(ta)) byTitleArtist.set(ta, hint);
  }

  const out: LockerDurationIdentitySuspect[] = [];
  for (const entry of entries) {
    const hint =
      byExact.get(catalogLookupKey(entry.title, entry.artist, entry.albumName)) ??
      byTitleArtist.get(catalogLookupKey(entry.title, entry.artist));
    if (!hint) continue;
    if (!durationDivergesFromCatalog(hint.durationSeconds, entry.durationSeconds)) continue;
    out.push({
      entryId: entry.id,
      title: entry.title,
      artist: entry.artist,
      albumName: entry.albumName,
      catalogDurationSeconds: hint.durationSeconds,
      storedDurationSeconds: entry.durationSeconds,
      reason: `stored duration ${entry.durationSeconds}s diverges from catalog ${hint.durationSeconds}s`,
    });
  }
  return out;
}

export { durationDivergesFromCatalog };
