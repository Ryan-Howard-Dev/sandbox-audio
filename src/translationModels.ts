/**
 * Language packs: what they cost, what is installed, and getting one onto the device.
 *
 * The engine is useless without a model and a model is tens of megabytes, so this is the half a
 * person actually interacts with. It exists separately from the engine because the decision it
 * supports is a decision about somebody's data allowance, not about translation: which pairs are
 * worth the download, and what is already paid for.
 *
 * Sizes are stated before anything is fetched. A download that starts and then reports how big it
 * was has already spent the thing it should have asked about, and on a metered connection that is
 * somebody's money.
 *
 * Pure apart from an injected fetch, so the awkward paths — a refused download, a half-finished
 * one, a pack that is already there — are testable without a network.
 */

import type { LanguagePair } from './translationProvider';
import {
  APPROX_PAIR_BYTES,
  loadInstalledPairs,
  OPUS_MT_PAIRS,
  saveInstalledPairs,
} from './onnxTranslationEngine';

export interface LanguagePackInfo {
  pair: LanguagePair;
  /** Bytes, as published. Approximate by nature — quantised models vary by a few percent. */
  approxBytes: number;
  installed: boolean;
}

/**
 * Roughly what one pair weighs, measured rather than estimated.
 *
 * One number rather than a table because pairs cluster within a few percent, and a table of guesses
 * that drift from reality is worse than an honest approximation somebody can round.
 */
export const APPROX_PACK_BYTES = APPROX_PAIR_BYTES;

export function listLanguagePacks(installed = loadInstalledPairs()): LanguagePackInfo[] {
  const have = new Set(installed);
  return OPUS_MT_PAIRS.map((pair) => ({
    pair,
    approxBytes: APPROX_PACK_BYTES,
    installed: have.has(pair),
  }));
}

/** Bytes as somebody would say them, so a size can be shown before a download is agreed to. */
export function formatPackSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export type PackInstallResult =
  | { status: 'installed'; pair: LanguagePair }
  /** Already on the device. Not a failure, and not a reason to fetch it again. */
  | { status: 'alreadyHave'; pair: LanguagePair }
  /** No such pair is published. Downloading will not help. */
  | { status: 'unknownPair'; pair: string }
  /** The download failed or was refused. Worth retrying. */
  | { status: 'failed'; pair: LanguagePair; reason: string };

export interface PackInstallDeps {
  /**
   * Fetch and store the pack, resolving when it is on disk.
   *
   * Injected because where a model comes from and where it is written are decisions this module
   * should not make: on the desktop that is the filesystem layer, on the phone it is the app's own
   * storage, and in a test it is nothing at all.
   */
  download: (pair: LanguagePair, onProgress?: (fraction: number) => void) => Promise<void>;
  readInstalled?: () => LanguagePair[];
  writeInstalled?: (pairs: LanguagePair[]) => void;
}

/**
 * Put a pack on the device and record it.
 *
 * Recorded only after the download resolves. A pair marked installed before its bytes have landed
 * is a pair the engine will try to load and fail on, and the failure surfaces as "the engine broke"
 * rather than "the download did not finish" — which sends somebody looking in the wrong place.
 */
export async function installLanguagePack(
  pair: string,
  deps: PackInstallDeps,
  onProgress?: (fraction: number) => void,
): Promise<PackInstallResult> {
  if (!OPUS_MT_PAIRS.includes(pair as LanguagePair)) {
    return { status: 'unknownPair', pair };
  }
  const typed = pair as LanguagePair;
  const read = deps.readInstalled ?? loadInstalledPairs;
  const write = deps.writeInstalled ?? saveInstalledPairs;

  const already = read();
  if (already.includes(typed)) return { status: 'alreadyHave', pair: typed };

  try {
    await deps.download(typed, onProgress);
  } catch (err) {
    return {
      status: 'failed',
      pair: typed,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  write([...already, typed]);
  return { status: 'installed', pair: typed };
}

/**
 * Forget a pack.
 *
 * Only the record is removed here. Deleting the files themselves belongs to whatever wrote them,
 * and a record that says "not installed" while the bytes remain costs disk; a record that says
 * "installed" while the bytes are gone costs a confusing failure every time somebody opens a book.
 */
export function forgetLanguagePack(
  pair: LanguagePair,
  deps: Pick<PackInstallDeps, 'readInstalled' | 'writeInstalled'> = {},
): LanguagePair[] {
  const read = deps.readInstalled ?? loadInstalledPairs;
  const write = deps.writeInstalled ?? saveInstalledPairs;
  const next = read().filter((installed) => installed !== pair);
  write(next);
  return next;
}

/** What installing this many packs would cost, for a confirm step that has to say a number. */
export function totalDownloadSize(pairs: readonly LanguagePair[]): number {
  return pairs.length * APPROX_PACK_BYTES;
}
