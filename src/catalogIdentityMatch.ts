/**
 * Catalog ↔ resolved-stream identity matching.
 *
 * Shared by play-time gates (`playbackPipeline`) and pre-store acquisition checks.
 * Keep a single implementation — a second drifted matcher is worse than none.
 */

/** Exported for repair scans that compare stored locker duration to catalog duration. */
export const MOBILE_DURATION_MIN_RATIO = 0.7;
export const MOBILE_DURATION_MAX_RATIO = 1.4;
const MOBILE_TITLE_MIN_SIM = 0.6;
const MOBILE_ARTIST_CONFLICT_SIM = 0.35;

/**
 * Minimal identity fields — intentionally not tied to MediaEnvelope so tier34-server
 * can import this module without pulling the client playback stack.
 */
export type IdentityMeta = {
  title?: string;
  artist?: string;
  album?: string;
  durationSeconds?: number;
  url?: string;
};

/*
 * Renditions that carry the original's title verbatim.
 *
 * Duration was supposed to catch these. It does not: a live cut of a three-minute song is usually
 * three minutes, so the ratio gate abstains, and then containment actively waves it through —
 * "Vultures (Live at Rolling Loud)" contains "Vultures", so the title gate reads it as the
 * decorated-but-correct hit it was written to allow. Every check passes and the wrong recording
 * plays.
 *
 * Separate from DERIVATIVE_MARKERS in searchCatalog.ts, which covers karaoke, tribute and
 * instrumental renditions and is applied to search rows rather than to resolved streams.
 */
const RENDITION_MARKERS = [
  'live',
  'acoustic',
  'remix',
  'rework',
  'demo',
  'sped up',
  'slowed',
  'reverb',
  'cover',
  'remastered',
  'unplugged',
  'acapella',
  'a cappella',
  'freestyle',
  'instrumental',
] as const;

/*
 * Whole words only. Both sides reach here already normalised, so punctuation-bearing forms like
 * "(live" can never match, and plain substring matching would find "live" inside "deliver" and
 * "cover" inside "discover" — rejecting correct streams on a spelling coincidence.
 */
const RENDITION_PATTERNS = RENDITION_MARKERS.map(
  (marker) => new RegExp(`(^|\\s)${marker.replace(/ /g, '\\s+')}(\\s|$)`),
);

export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/^\d{1,2}[\s.\-_]+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function diceCoefficient(a: string, b: string): number {
  const aNorm = normalizeMatchText(a);
  const bNorm = normalizeMatchText(b);
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;
  if (aNorm.length < 2 || bNorm.length < 2) {
    return aNorm.includes(bNorm) || bNorm.includes(aNorm) ? 0.75 : 0;
  }
  const bigrams = (s: string) => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const aGrams = bigrams(aNorm);
  const bGrams = bigrams(bNorm);
  let overlap = 0;
  for (const g of aGrams) {
    if (bGrams.has(g)) overlap++;
  }
  return (2 * overlap) / (aGrams.size + bGrams.size);
}

function isGenericStreamArtist(artist: string): boolean {
  const n = normalizeMatchText(artist);
  return (
    n === 'youtube' ||
    n === 'archive org' ||
    n === 'archive' ||
    n === 'unknown artist' ||
    n === 'unknown' ||
    n === 'debrid' ||
    n === 'direct' ||
    n === 'proxy'
  );
}

/**
 * True when the stream announces a rendition the catalog track never claimed to be.
 *
 * One-directional on purpose. Asking for a live album and receiving the live recording is
 * correct, so a marker present on both sides is no evidence of anything. Only a marker that
 * appears on the resolved side and not the catalog side is divergence — which is the standard
 * the rest of this function already works to.
 */
export function resolvedIsUnrequestedRendition(
  catalogTitle: string | undefined,
  resolvedBlob: string,
): boolean {
  const resolved = normalizeMatchText(resolvedBlob);
  if (!resolved.trim()) return false;
  const catalog = normalizeMatchText(catalogTitle ?? '');
  return RENDITION_PATTERNS.some((pattern) => pattern.test(resolved) && !pattern.test(catalog));
}

/*
 * How often this function is asked to verify a stream against nothing.
 *
 * When a resolver reports no metadata of its own, envelopeFromResolved fills the envelope from
 * the catalog, so every check below compares the catalog with itself, finds no disagreement, and
 * accepts. That is not verification, and an entirely unrelated recording passes it — which is what
 * a cover playing in place of the requested track looks like.
 *
 * Counting before changing behaviour is deliberate. Rejecting these outright would also reject the
 * correct streams from resolvers that simply do not report titles, and a silent refusal to play
 * reads as a broken app. The number tells us how much of the traffic this actually is; until it
 * exists, tightening or leaving it alone are both guesses.
 *
 * Acquisition is different: storing without independent metadata is how the wrong file enters the
 * vault permanently. Play-time may still accept unverified streams; acquisition must not.
 */
let unverifiedMobileResolves = 0;
let verifiedMobileResolves = 0;

/** Reset between tests. */
export function resetMobileResolveVerificationCounts(): void {
  unverifiedMobileResolves = 0;
  verifiedMobileResolves = 0;
}

export function getMobileResolveVerificationCounts(): {
  verified: number;
  unverified: number;
} {
  return { verified: verifiedMobileResolves, unverified: unverifiedMobileResolves };
}

/**
 * True when the resolved envelope carries no independent signal — every comparable field either
 * absent or identical to the catalog's, meaning it was inherited rather than reported.
 */
export function mobileResolveHasNoIndependentMetadata(
  catalog: IdentityMeta,
  resolved: IdentityMeta,
): boolean {
  const sameOrEmpty = (a: string | undefined, b: string | undefined): boolean => {
    const left = normalizeMatchText(a ?? '');
    const right = normalizeMatchText(b ?? '');
    return !right || left === right;
  };
  const durationSilent =
    !resolved.durationSeconds || resolved.durationSeconds === catalog.durationSeconds;
  return (
    sameOrEmpty(catalog.title, resolved.title) &&
    sameOrEmpty(catalog.artist, resolved.artist) &&
    durationSilent
  );
}

/**
 * Why a candidate fails the mobile identity gate, or null when it passes.
 *
 * Order matches `mobileResolveMatchesCatalog`: duration → unrequested rendition → title → artist.
 * Reasons are written for download-job error surfaces — silent skip is as bad as a wrong file.
 */
export function mobileResolveCatalogMismatchReason(
  catalog: IdentityMeta,
  resolved: IdentityMeta,
): string | null {
  const catalogDur = catalog.durationSeconds ?? 0;
  const resolvedDur = resolved.durationSeconds ?? 0;
  if (catalogDur > 45 && resolvedDur > 0) {
    const ratio = resolvedDur / catalogDur;
    if (ratio < MOBILE_DURATION_MIN_RATIO || ratio > MOBILE_DURATION_MAX_RATIO) {
      return `duration mismatch (candidate ${resolvedDur}s vs catalog ${catalogDur}s)`;
    }
  }

  const catalogTitle = normalizeMatchText(catalog.title ?? '');
  const resolvedTitle = normalizeMatchText(resolved.title ?? '');
  const resolvedBlob = normalizeMatchText(
    `${resolved.title ?? ''} ${resolved.artist ?? ''} ${resolved.album ?? ''}`,
  );
  /*
   * Before containment, not after. Containment is what admits a rendition: the live cut carries
   * the studio title inside it, so asking "does the catalog title appear here" answers yes for
   * precisely the hits this rejects.
   */
  if (resolvedIsUnrequestedRendition(catalog.title, resolvedBlob)) {
    return `unrequested rendition in candidate "${resolved.title ?? resolvedBlob}"`;
  }

  if (catalogTitle && resolvedTitle) {
    const titled =
      resolvedBlob.includes(catalogTitle) ||
      diceCoefficient(catalogTitle, resolvedTitle) >= MOBILE_TITLE_MIN_SIM;
    if (!titled) {
      return `title unrelated to catalog ("${resolved.title ?? ''}" vs "${catalog.title ?? ''}")`;
    }
  }

  /*
   * Artist is a rejection signal only, and only when both sides are specific. A generic uploader
   * says nothing about identity, and requiring a match would throw away the many correct streams
   * that live on re-upload channels.
   */
  const catalogArtist = catalog.artist?.trim() ?? '';
  const resolvedArtist = resolved.artist?.trim() ?? '';
  if (catalogArtist && resolvedArtist && !isGenericStreamArtist(resolvedArtist)) {
    const normalizedCatalogArtist = normalizeMatchText(catalogArtist);
    const disagrees =
      diceCoefficient(catalogArtist, resolvedArtist) < MOBILE_ARTIST_CONFLICT_SIM &&
      !resolvedBlob.includes(normalizedCatalogArtist);
    if (disagrees) {
      return `artist conflict ("${resolvedArtist}" vs "${catalogArtist}")`;
    }
  }

  return null;
}

export function mobileResolveMatchesCatalog(
  catalog: IdentityMeta,
  resolved: IdentityMeta,
): boolean {
  if (mobileResolveHasNoIndependentMetadata(catalog, resolved)) {
    unverifiedMobileResolves += 1;
    // Tagged so it can be counted from logcat on a real device without a debugger attached.
    console.warn(
      `[MobileResolve] UNVERIFIED accepted — resolver reported no metadata; catalog="${catalog.title ?? ''}" total=${unverifiedMobileResolves}`,
    );
  } else {
    verifiedMobileResolves += 1;
  }
  return mobileResolveCatalogMismatchReason(catalog, resolved) === null;
}

/** True when stored/probed duration diverges from catalog beyond the mobile ratio gate. */
export function durationDivergesFromCatalog(
  catalogDurationSeconds: number,
  storedOrProbedDurationSeconds: number,
): boolean {
  const catalogDur = catalogDurationSeconds ?? 0;
  const storedDur = storedOrProbedDurationSeconds ?? 0;
  if (catalogDur <= 45 || storedDur <= 0) return false;
  const ratio = storedDur / catalogDur;
  return ratio < MOBILE_DURATION_MIN_RATIO || ratio > MOBILE_DURATION_MAX_RATIO;
}

/*
 * A separate, much tighter band for finding files already in the locker.
 *
 * The gate above and this check answer different questions, and share thresholds only by
 * accident of implementation. The gate decides whether to *refuse a download*, so a false
 * positive is a track that silently will not play — it has to be permissive, and 0.7–1.4 is
 * right there. This check only *surfaces a row for the user to confirm*, so a false positive
 * costs a glance at a list.
 *
 * Sharing the loose band made the repair blind to the case it exists for. Measured on a real
 * locker: a wrong recording stored as VULTURES ran 276s against a catalog 216s — a ratio of
 * 1.28, comfortably inside 0.7–1.4, so nothing flagged it. Songs cluster between three and five
 * minutes, so most wrong files land inside a ±40% window; at ±15% they do not.
 */
export const REPAIR_DURATION_MIN_RATIO = 0.85;
export const REPAIR_DURATION_MAX_RATIO = 1.15;

/**
 * True when a stored row's duration is suspicious enough to show the user.
 *
 * Deliberately more suspicious than the download gate. Never used to reject anything
 * automatically — callers offer re-acquisition and the user decides. ADR 001 keeps deletion
 * user-confirmed.
 */
export function durationSuspectForRepair(
  catalogDurationSeconds: number,
  storedDurationSeconds: number,
): boolean {
  const catalogDur = catalogDurationSeconds ?? 0;
  const storedDur = storedDurationSeconds ?? 0;
  if (catalogDur <= 45 || storedDur <= 0) return false;
  const ratio = storedDur / catalogDur;
  return ratio < REPAIR_DURATION_MIN_RATIO || ratio > REPAIR_DURATION_MAX_RATIO;
}
