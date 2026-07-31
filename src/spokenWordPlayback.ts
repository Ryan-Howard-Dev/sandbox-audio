/**
 * Spoken-word playback shape — podcasts and audiobooks, as distinct from music.
 *
 * Kept dependency-free so playback and shell paths can import it without pulling in catalog or
 * storage modules.
 */

const PODCAST_PREFIX = 'podcast:';
/** Device library scan. */
const AUDIOBOOK_PREFIX = 'audiobook:';
/** Discover / free catalogs. `audiobook-catalog:` does not start with `audiobook:`. */
const AUDIOBOOK_CATALOG_PREFIX = 'audiobook-catalog:';

export function isAnyAudiobookEnvelopeId(envelopeId: string | null | undefined): boolean {
  const id = envelopeId?.trim() ?? '';
  return id.startsWith(AUDIOBOOK_PREFIX) || id.startsWith(AUDIOBOOK_CATALOG_PREFIX);
}

/**
 * True when prev/next should seek by an interval rather than change track.
 *
 * Audiobooks were classified as music, so a twelve-hour book got music's transport: shuffle and
 * repeat, which mean nothing for a book, and prev/next that jumped whole chapters. Every
 * dedicated audiobook player treats those buttons as back/forward-by-seconds, because mid-chapter
 * is where listeners actually are — chapter jumps belong in the chapter list. Podcasts already
 * behaved this way; audiobooks were simply never included.
 */
export function usesIntervalSeekTransport(envelopeId: string | null | undefined): boolean {
  const id = envelopeId?.trim() ?? '';
  if (!id) return false;
  return id.startsWith(PODCAST_PREFIX) || isAnyAudiobookEnvelopeId(id);
}
