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
  /*
   * Snapshot of what was playing, so a continue-listening shelf renders from this store alone --
   * offline, air-gapped, and without re-querying a catalog that may since have changed or gone.
   */
  title?: string;
  author?: string;
  artworkUrl?: string;
  /*
   * Enough to re-fetch the chapter list without a search. Written when playback starts, where the
   * catalog book is in hand; the position updates that follow come from a playback envelope,
   * which does not carry these, which is why saving merges rather than replaces.
   */
  locator?: {
    source: string;
    sourceId: string;
    feedUrl?: string;
    detailUrl?: string;
  };
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
 * Catalog ids are `audiobook-catalog:<source>:<book>:<chapter...>`, and the book is always exactly
 * one segment — every provider builds its book id as `<source>:<sourceId>` with a numeric id or a
 * base36 hash. The *chapter* is what can contain colons: Gutenberg's chapter ids are
 * `gutenberg:<book>:<index>`, so a full envelope id reads
 * `audiobook-catalog:gutenberg:1234:gutenberg:1234:0`.
 *
 * This originally dropped the last segment instead, on the assumption that the chapter was the
 * only single segment. That produced `…:1234:gutenberg:1234` for every Gutenberg book while the
 * card produced `…:1234`, so progress was written under one key and read under another: no badge,
 * no shelf entry, no resume, and nothing failing loudly. Found by playing a book on a device.
 *
 * Taking a fixed three segments from the front makes this agree with
 * `audiobookBookKeyFromCatalogBook` by construction rather than by coincidence.
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
    // prefix + source + book + at least one chapter segment
    if (parts.length < 4) return null;
    if (!parts[1] || !parts[2]) return null;
    return `${parts[0]}:${parts[1]}:${parts[2]}`;
  }
  if (id.startsWith('audiobook:')) return id;
  return null;
}

/**
 * Book key for a catalog book, from its own fields rather than from a playing envelope.
 *
 * A shelf and a progress badge need the key before anything is playing. This must agree exactly
 * with `audiobookBookKeyFromEnvelopeId`, or a book would record progress under one key and read
 * it back under another — resume would silently never fire. The parity is asserted in tests.
 *
 * Catalog book ids are `<source>:<sourceId>`, and `catalogChapterEnvelope` drops that leading
 * source segment before re-prefixing. Takes only the first segment after the source, so this and
 * the envelope-derived key stay identical even if a provider ever emits a compound id.
 */
export function audiobookBookKeyFromCatalogBook(
  source: string | null | undefined,
  bookId: string | null | undefined,
): string | null {
  const src = source?.trim() ?? '';
  const id = bookId?.trim() ?? '';
  if (!src || !id) return null;
  const rest = id.split(':')[1]?.trim();
  if (!rest) return null;
  return `audiobook-catalog:${src}:${rest}`;
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

/**
 * Trim a stored key back to the canonical `audiobook-catalog:<source>:<book>` form.
 *
 * Keys written before the book-key fix kept a chapter segment: dropping only the *last* segment of
 * `audiobook-catalog:gutenberg:26470:26470:0` left `…:26470:26470`. Correcting the derivation did
 * nothing for entries already in storage, so a book read under both builds ends up stored twice
 * and the continue-listening shelf shows it twice, at two different percentages. Observed on
 * device: `…:gutenberg:26470` at 21% beside `…:gutenberg:26470:26470` at 10%.
 *
 * Device ids (`audiobook:<id>`) have no chapter component and are returned untouched.
 */
export function canonicalAudiobookBookKey(bookKey: string | null | undefined): string | null {
  const key = bookKey?.trim() ?? '';
  if (!key) return null;
  if (!key.startsWith('audiobook-catalog:')) return key;
  const parts = key.split(':');
  if (parts.length <= 3) return key;
  if (!parts[1] || !parts[2]) return key;
  return `${parts[0]}:${parts[1]}:${parts[2]}`;
}

/**
 * Fold legacy keys into their canonical entry.
 *
 * The newest position wins, but the fields are merged rather than replaced: the entry carrying the
 * locator and display snapshot is often the *older* one, because those are written once when
 * playback starts while positions tick over continuously. Taking the newer entry wholesale would
 * drop the book off the shelf it was meant to fix.
 */
export function migrateAudiobookProgressKeys(map: AudiobookProgressMap): AudiobookProgressMap {
  const migrated: AudiobookProgressMap = {};
  for (const entry of Object.values(map)) {
    const key = canonicalAudiobookBookKey(entry?.bookKey);
    if (!key) continue;
    const existing = migrated[key];
    if (!existing) {
      migrated[key] = { ...entry, bookKey: key };
      continue;
    }
    const newer = entry.updatedAt > existing.updatedAt ? entry : existing;
    const older = entry.updatedAt > existing.updatedAt ? existing : entry;
    migrated[key] = {
      ...older,
      ...newer,
      bookKey: key,
      chapterCount: Math.max(newer.chapterCount ?? 0, older.chapterCount ?? 0),
      title: newer.title ?? older.title,
      author: newer.author ?? older.author,
      artworkUrl: newer.artworkUrl ?? older.artworkUrl,
      locator: newer.locator ?? older.locator,
    };
  }
  return migrated;
}

function readMap(): AudiobookProgressMap {
  try {
    const raw = localStorage.getItem(AUDIOBOOK_PROGRESS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const stored = parsed as AudiobookProgressMap;
    const migrated = migrateAudiobookProgressKeys(stored);
    // Write back once, so the duplicate is gone for good rather than re-folded on every read.
    if (Object.keys(migrated).length !== Object.keys(stored).length) {
      writeMap(migrated);
    }
    return migrated;
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
  const key = canonicalAudiobookBookKey(bookKey);
  if (!key) return null;
  return readMap()[key] ?? null;
}

/**
 * Persist unconditionally; callers gate on shouldPersistAudiobookProgress.
 *
 * Merges rather than replaces. Position updates come from a playback envelope, which knows
 * nothing about the catalog the book came from — a blind write would erase the locator and the
 * display snapshot on the first tick, and the shelf would lose the book it is meant to show.
 */
export function saveAudiobookProgress(progress: AudiobookProgress): void {
  const key = canonicalAudiobookBookKey(progress.bookKey);
  if (!key) return;
  const map = readMap();
  const existing = map[key];
  map[key] = {
    ...existing,
    ...progress,
    bookKey: key,
    title: progress.title ?? existing?.title,
    author: progress.author ?? existing?.author,
    artworkUrl: progress.artworkUrl ?? existing?.artworkUrl,
    locator: progress.locator ?? existing?.locator,
  };
  writeMap(map);
}

export function clearAudiobookProgress(bookKey: string): void {
  const key = canonicalAudiobookBookKey(bookKey);
  if (!key) return;
  const map = readMap();
  if (!(key in map)) return;
  delete map[key];
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
