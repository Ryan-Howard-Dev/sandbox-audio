/** Stream vs iTunes/catalog track length — album uploads often report full-album duration. */
export const CATALOG_DURATION_MISMATCH_MAX_RATIO = 1.45;
export const CATALOG_DURATION_MISMATCH_MIN_RATIO = 0.45;

export function catalogStreamDurationMismatch(
  streamSeconds: number,
  catalogSeconds: number,
): boolean {
  if (catalogSeconds <= 45 || streamSeconds <= 0) return false;
  const ratio = streamSeconds / catalogSeconds;
  return (
    ratio > CATALOG_DURATION_MISMATCH_MAX_RATIO ||
    ratio < CATALOG_DURATION_MISMATCH_MIN_RATIO
  );
}

/** Prefer catalog track length when the resolved stream is clearly not a single track. */
export function resolveCatalogAwareDuration(
  streamSeconds: number,
  catalogSeconds: number,
): number {
  if (catalogStreamDurationMismatch(streamSeconds, catalogSeconds)) {
    return catalogSeconds;
  }
  if (Number.isFinite(streamSeconds) && streamSeconds > 0) return streamSeconds;
  return catalogSeconds > 0 ? catalogSeconds : 0;
}

/** End-of-track for album-length streams — advance queue at catalog duration, not file end. */
export function catalogTrackPlaybackEndReached(
  positionSeconds: number,
  streamSeconds: number,
  catalogSeconds: number,
): boolean {
  if (!catalogStreamDurationMismatch(streamSeconds, catalogSeconds)) return false;
  // Only fire near the catalog boundary — ignore stale positions deep in a shared album file.
  return (
    positionSeconds >= catalogSeconds - 0.5 &&
    positionSeconds <= catalogSeconds + 3
  );
}

/** Clamp UI progress when the stream file is longer than the catalog track length. */
export function catalogPlaybackDisplayPosition(
  positionSeconds: number,
  streamSeconds: number,
  catalogSeconds: number,
  displayDurationSeconds: number,
): number {
  const safePos = Math.max(0, positionSeconds);
  if (displayDurationSeconds <= 0) return safePos;
  if (catalogStreamDurationMismatch(streamSeconds, catalogSeconds)) {
    return Math.min(safePos, displayDurationSeconds);
  }
  if (safePos > displayDurationSeconds + 0.5) {
    return displayDurationSeconds;
  }
  return safePos;
}
