/**
 * Library metadata repair — known stub reassignment + high-confidence catalog only.
 * Boot auto-repair that invents/guesses artists is DISABLED after one safe cleanup.
 * Manual "Fix song info" uses the same safe path.
 */

import { isAirGapEnabled } from './airGapMode';
import { findArtistImage } from './artistImage';
import { buildCanonicalArtists } from './collectionIntelligence';
import {
  applyKnownStubReassignmentsInVault,
  clearJunkArtistsToUnknownInVault,
  undoUnsafeFamousArtistAssignmentsInVault,
  repairMislabeledStubArtistsInVaultSafe,
} from './deviceImportMetadata';
import {
  getLockerEntriesSnapshot,
  isKnownPlaylistStubArtistName,
  refreshLockerCache,
} from './lockerStorage';

/** Bumped so one safe cleanup runs once after install; then auto-repair stays OFF. */
export const LOCKER_STUB_REPAIR_SESSION_KEY = 'locker-stub-artist-repair-v9';
export const LOCKER_STUB_REPAIR_EVENT = 'sandbox-locker-stub-repair';

export type LibraryMetadataAutoRepairResult = {
  knownStubFixed: number;
  catalogStubFixed: number;
  junkCleared: number;
  unsafeUndone: number;
  enriched: number;
  enrichFailed: number;
  artistImages: number;
};

export type LockerStubRepairEventDetail = {
  phase: 'start' | 'done' | 'error';
  result?: LibraryMetadataAutoRepairResult;
  message?: string;
};

function emitStubRepairEvent(detail: LockerStubRepairEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LOCKER_STUB_REPAIR_EVENT, { detail }));
}

/**
 * Safe repair only:
 * - known stub mappings (Like That → Future, etc.)
 * - high-confidence catalog matches (never title-prefix inventing)
 * - clear remaining junk fragments to Unknown Artist
 * - undo prior unsafe famous-artist assignments (ABBA/Taylor Swift false positives)
 * Never deletes tracks. Never writes first-word-of-title as artist.
 */
export async function runLibraryMetadataAutoRepair(
  trackIds?: string[],
): Promise<LibraryMetadataAutoRepairResult> {
  if (isAirGapEnabled()) {
    return {
      knownStubFixed: 0,
      catalogStubFixed: 0,
      junkCleared: 0,
      unsafeUndone: 0,
      enriched: 0,
      enrichFailed: 0,
      artistImages: 0,
    };
  }

  console.log('[locker] runLibraryMetadataAutoRepair start (safe-only)', {
    trackIds: trackIds?.length ?? 'all',
  });
  emitStubRepairEvent({ phase: 'start' });

  const snap = getLockerEntriesSnapshot() ?? [];
  const ids = trackIds?.length ? trackIds : snap.map((t) => t.id);

  const known = await applyKnownStubReassignmentsInVault(ids);
  console.log('[locker] applyKnownStubReassignmentsInVault', known);

  const unsafe = await undoUnsafeFamousArtistAssignmentsInVault(ids);
  console.log('[locker] undoUnsafeFamousArtistAssignmentsInVault', unsafe);

  const stub = await repairMislabeledStubArtistsInVaultSafe(ids);
  console.log('[locker] repairMislabeledStubArtistsInVaultSafe', stub);

  const junk = await clearJunkArtistsToUnknownInVault(ids);
  console.log('[locker] clearJunkArtistsToUnknownInVault', junk);

  const refreshed = getLockerEntriesSnapshot() ?? snap;
  const artistNames = buildCanonicalArtists(refreshed)
    .map((a) => a.name)
    .filter((name) => name && !/^local upload$/i.test(name) && !isKnownPlaylistStubArtistName(name));

  let artistImages = 0;
  for (const name of artistNames) {
    try {
      const url = await findArtistImage(name);
      if (url) artistImages += 1;
    } catch {
      /* optional */
    }
  }
  console.log('[locker] artist image prefetch', { artistImages, artists: artistNames.length });

  await refreshLockerCache();

  const result: LibraryMetadataAutoRepairResult = {
    knownStubFixed: known.fixed,
    catalogStubFixed: stub.fixed,
    junkCleared: junk.fixed,
    unsafeUndone: unsafe.fixed,
    enriched: 0,
    enrichFailed: 0,
    artistImages,
  };

  console.log('[locker] runLibraryMetadataAutoRepair done (safe-only)', result);
  emitStubRepairEvent({ phase: 'done', result });
  return result;
}

/** Once per install (localStorage) — safe cleanup only; inventing auto-repair stays OFF. */
export function shouldRunSessionStubRepair(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(LOCKER_STUB_REPAIR_SESSION_KEY) !== '1';
}

export function markSessionStubRepairDone(): void {
  try {
    localStorage.setItem(LOCKER_STUB_REPAIR_SESSION_KEY, '1');
  } catch {
    /* private mode */
  }
}

/**
 * One-shot safe cleanup after install. Does NOT invent artists from title words.
 * Subsequent boots skip entirely (key already set).
 */
export async function runSessionStubRepairIfNeeded(): Promise<LibraryMetadataAutoRepairResult | null> {
  if (!shouldRunSessionStubRepair() || isAirGapEnabled()) {
    console.log('[locker] session stub repair skipped (already done or air-gap)');
    return null;
  }
  markSessionStubRepairDone();
  console.log('[locker] session stub repair: one-shot safe cleanup only');
  return runLibraryMetadataAutoRepair();
}
