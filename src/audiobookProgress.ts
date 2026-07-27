/**
 * Per-book listening position — the state that makes a ten-hour book usable.
 *
 * Audiobooks were classified as music, and music state is one global queue with one resume slot:
 * play a song, or reopen the app, and your place in a book was gone. Every dedicated audiobook
 * player — Voice, Aradia, Audiobookshelf, BookOrbit — keeps a position per title, indefinitely.
 *
 * Local-first by design. It works with no server, offline and air-gapped; mirroring through
 * tier34 is an optional layer on top, the same way podcast subscriptions already work. Nothing
 * here reaches the network.
 */

/** Position within one book. `chapterIndex` is the queue position, not the chapter's own id. */
export type AudiobookProgress = {
  bookKey: string;
  chapterIndex: number;
  offsetSeconds: number;
  /** Duration of the chapter the offset belongs to; 0 when unknown. */
  durationSeconds: number;
  /** Total chapters, when the book listing was known at save time. 0 when unknown. */
  chapterCount: number;
  updatedAt: number;
};

export type AudiobookProgressMap = Record<string, AudiobookProgress>;

export const AUDIOBOOK_PROGRESS_STORAGE_KEY = 'sandbox_audiobook_progress_v1';

/** Below this the listener has barely started; treat as not-yet-begun so it stays off shelves. */
export const AUDIOBOOK_PROGRESS_MIN_SECONDS = 15;

/** Past this fraction of the final chapter the book counts as finished. */
export const AUDIOBOOK_PROGRESS_COMPLETE_RATIO = 0.97;

/**
 * Book key for an audiobook envelope, or null when the envelope is not an audiobook.
 *
 * Catalog ids are `audiobook-catalog:<source>:<book...>:<chapter>`, so the book is everything but
 * the final segment. The book portion can itself contain colons (a hashed scrape id does), which
 * is why this drops one segment from the end rather than taking a fixed count from the front.
 *
 * Device-library ids are `audiobook:<id>` with no chapter component — the file is the book — so
 * they key on themselves.
 */
export function audiobookBookKeyFromEnvelopeId(
  envelopeId: string | null | undefined,
): string | null {
  const id = envelopeId?.trim() ?? '';
  if (!id) return null;
  if (id.startsWith('audiobook-catalog:')) {
    const parts = id.split(':');
    // prefix + source + at least one book segment + chapter
    if (parts.length < 4) return null;
    return parts.slice(0, -1).join(':');
  }
  if (id.startsWith('audiobook:')) return id;
  return null;
}

/** Fraction of the whole book listened, 0–1. Falls back to chapter position when durations are unknown. */
export function audiobookProgressFraction(progress: AudiobookProgress): number {
  const chapters = progress.chapterCount > 0 ? progress.chapterCount : 0;
  const withinChapter =
    progress.durationSeconds > 0
      ? Math.min(1, Math.max(0, progress.offsetSeconds / progress.durationSeconds))
      : 0;
  if (chapters <= 0) return withinChapter;
  const done = Math.min(chapters, Math.max(0, progress.chapterIndex));
  return Math.min(1, (done + withinChapter) / chapters);
}

export function audiobookProgressPercent(progress: AudiobookProgress): number {
  return Math.round(audiobookProgressFraction(progress) * 100);
}

/** True once the listener is effectively at the end of the last chapter. */
export function isAudiobookFinished(progress: AudiobookProgress): boolean {
  if (progress.chapterCount > 0 && progress.chapterIndex < progress.chapterCount - 1) return false;
  if (progress.durationSeconds <= 0) return false;
  return progress.offsetSeconds / progress.durationSeconds >= AUDIOBOOK_PROGRESS_COMPLETE_RATIO;
}

/**
 * Whether a position update is worth writing to storage.
 *
 * Playback fires position updates several times a second. Persisting each one would hammer
 * storage for the entire length of a book, so a write needs either a real interval to have passed
 * or a jump that a tick cannot explain — a seek, or a chapter change, both of which the listener
 * would notice losing.
 */
export function shouldPersistAudiobookProgress(
  previous: AudiobookProgress | undefined,
  next: AudiobookProgress,
  options?: { minIntervalMs?: number; minDeltaSeconds?: number },
): boolean {
  if (next.offsetSeconds < 0) return false;
  if (!previous) return next.offsetSeconds >= AUDIOBOOK_PROGRESS_MIN_SECONDS;
  if (previous.chapterIndex !== next.chapterIndex) return true;

  const minIntervalMs = options?.minIntervalMs ?? 10_000;
  const minDeltaSeconds = options?.minDeltaSeconds ?? 30;
  if (next.updatedAt - previous.updatedAt >= minIntervalMs) return true;
  return Math.abs(next.offsetSeconds - previous.offsetSeconds) >= minDeltaSeconds;
}

/** Last write wins by `updatedAt`; ties keep the local entry so a clock skew cannot rewind you. */
export function mergeAudiobookProgress(
  local: AudiobookProgressMap,
  remote: AudiobookProgressMap,
): AudiobookProgressMap {
  const merged: AudiobookProgressMap = { ...local };
  for (const [key, entry] of Object.entries(remote)) {
    const mine = merged[key];
    if (!mine || entry.updatedAt > mine.updatedAt) merged[key] = entry;
  }
  return merged;
}

function readMap(): AudiobookProgressMap {
  try {
    const raw = localStorage.getItem(AUDIOBOOK_PROGRESS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as AudiobookProgressMap;
  } catch {
    return {};
  }
}

function writeMap(map: AudiobookProgressMap): void {
  try {
    localStorage.setItem(AUDIOBOOK_PROGRESS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage full or unavailable — losing a position must never break playback */
  }
}

export function loadAudiobookProgressMap(): AudiobookProgressMap {
  return readMap();
}

export function getAudiobookProgress(bookKey: string | null | undefined): AudiobookProgress | null {
  const key = bookKey?.trim();
  if (!key) return null;
  return readMap()[key] ?? null;
}

/** Persist unconditionally; callers gate on shouldPersistAudiobookProgress. */
export function saveAudiobookProgress(progress: AudiobookProgress): void {
  const key = progress.bookKey?.trim();
  if (!key) return;
  const map = readMap();
  map[key] = { ...progress, bookKey: key };
  writeMap(map);
}

export function clearAudiobookProgress(bookKey: string): void {
  const map = readMap();
  if (!(bookKey in map)) return;
  delete map[bookKey];
  writeMap(map);
}

/** In-progress books, most recent first — the source for a continue-listening shelf. */
export function listAudiobooksInProgress(limit = 20): AudiobookProgress[] {
  return Object.values(readMap())
    .filter((entry) => entry.offsetSeconds >= AUDIOBOOK_PROGRESS_MIN_SECONDS)
    .filter((entry) => !isAudiobookFinished(entry))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}
