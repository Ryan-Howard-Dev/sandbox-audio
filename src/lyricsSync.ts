import type { SyncedLyricLine } from './resolveTrackLyrics';

/** Index of the LRC line active at `timeMs`, or -1 before the first timestamp. */
export function findActiveLineIndex(lines: SyncedLyricLine[], timeMs: number): number {
  if (!lines.length) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = lines[mid].timeMs ?? 0;
    if (timeMs >= t) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
