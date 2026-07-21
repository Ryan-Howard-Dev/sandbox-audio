import type { LockerEntry } from './lockerStorage';

/** Parse ID3 TRCK/TPOS values like `3` or `3/24`. */
export function parseId3Position(value?: string): { index?: number; total?: number } {
  if (!value?.trim()) return {};
  const [rawIndex, rawTotal] = value.trim().split('/');
  const index = parseInt(rawIndex.trim(), 10);
  const total = rawTotal != null ? parseInt(rawTotal.trim(), 10) : NaN;
  return {
    index: Number.isFinite(index) && index > 0 ? index : undefined,
    total: Number.isFinite(total) && total > 0 ? total : undefined,
  };
}

export function lockerTrackDisc(entry: LockerEntry): number {
  if (entry.discNumber != null && entry.discNumber > 0) return entry.discNumber;
  return 1;
}

export function lockerTrackNumber(entry: LockerEntry): number | undefined {
  if (entry.trackNumber != null && entry.trackNumber > 0) return entry.trackNumber;
  return undefined;
}

/** Stable album track order: disc → track # → download order → title. */
export function compareLockerTrackOrder(a: LockerEntry, b: LockerEntry): number {
  const discA = lockerTrackDisc(a);
  const discB = lockerTrackDisc(b);
  if (discA !== discB) return discA - discB;

  const numA = lockerTrackNumber(a);
  const numB = lockerTrackNumber(b);
  if (numA != null && numB != null && numA !== numB) return numA - numB;
  if (numA != null && numB == null) return -1;
  if (numA == null && numB != null) return 1;

  const addedA = a.addedAt ?? 0;
  const addedB = b.addedAt ?? 0;
  if (addedA !== addedB) return addedA - addedB;

  return a.title.localeCompare(b.title, undefined, { numeric: true });
}

export function sortLockerTracks<T extends LockerEntry>(tracks: T[]): T[] {
  return [...tracks].sort(compareLockerTrackOrder);
}
