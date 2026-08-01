/**
 * The narration session the player is allowed to show.
 *
 * Reading aloud never reached the player. The now playing view is built on the audio pipeline —
 * a MediaEnvelope, an ExoPlayer state machine, a seekable duration — and narration has none of
 * those: there is no stream, no envelope, and no position beyond "which chunk". So a book being
 * read was stranded in a panel at the bottom of its shelf while the player showed whatever track
 * happened to be loaded, which is not a player at all, it is two apps in one screen.
 *
 * This is the seam between them. The shelf that owns the reader publishes what it is reading and
 * how to control it; the player subscribes and paints it. Neither imports the other, and the audio
 * pipeline is untouched, because narration must never be forced through a stream abstraction that
 * does not fit it.
 *
 * Deliberately a module-level store rather than React context: the reader outlives the shelf that
 * created it (that is the whole point of background narration), so its state cannot hang off a
 * component that unmounts the moment the user navigates away.
 */
import type { NarrationReaderState } from './narrationReader';

export interface NarrationPlaybackControls {
  play(): void;
  pause(): void;
  stop(): void;
  seekToChunk(index: number): void;
}

export interface NarrationPlaybackSnapshot {
  /** Book or document title — the player's first line. */
  title: string;
  /** Author where one is known; otherwise the player says it is being read aloud. */
  author?: string;
  /** Cover from the EPUB's own manifest, when it carried one. */
  artworkUrl?: string;
  /** Stable id, so republishing the same book is an update rather than a new session. */
  sourceId: string;
  /** Which shelf is reading — books and documents share this store but not their lists. */
  kind: 'book' | 'document';
  /** Text of the passage being spoken, exactly as handed to the engine. */
  passage: string;
  /** Character offsets of the word being spoken, when the engine reports them. */
  range: { start: number; end: number } | null;
  state: NarrationReaderState;
  chunkIndex: number;
  chunkCount: number;
  /**
   * Estimated position and length in seconds, for the player's clock and progress bar.
   *
   * An estimate, and labelled as one, because the engine decides how long a passage takes as it
   * speaks it. Passing the passage count in as seconds was worse than an estimate: it rendered a
   * 349 minute document as "9:46".
   */
  elapsedSeconds: number;
  totalSeconds: number;
  /** Section or chapter heading the passage sits under, where the document has one. */
  section?: string;
  controls: NarrationPlaybackControls;
}

type Listener = (snapshot: NarrationPlaybackSnapshot | null) => void;

let current: NarrationPlaybackSnapshot | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(current);
}

/**
 * Publish or update the session.
 *
 * Called on every range event, so it must stay cheap — no cloning beyond the object the caller
 * already built, and no work when nothing is listening.
 */
export function publishNarrationPlayback(snapshot: NarrationPlaybackSnapshot): void {
  current = snapshot;
  emit();
}

/**
 * Clear the session, but only if the caller still owns it.
 *
 * Without the ownership check, a shelf unmounting after a different one has taken over would wipe
 * a session it no longer owns — which is exactly what happens when the user moves from Documents
 * to Ebooks and starts a book.
 */
export function clearNarrationPlayback(sourceId?: string): void {
  if (current === null) return;
  if (sourceId !== undefined && current.sourceId !== sourceId) return;
  current = null;
  emit();
}

export function getNarrationPlayback(): NarrationPlaybackSnapshot | null {
  return current;
}

export function subscribeNarrationPlayback(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/*
 * Opening the player is a request, not state.
 *
 * Pressing play on a shelf should raise the player the way tapping a track does, but the shelf has
 * no handle on the player's open flag and should not be given one. It asks; whoever owns the
 * overlay decides. Fire-and-forget, so a request with nothing listening is simply dropped rather
 * than queued to surprise the user later.
 */
type OpenRequestListener = () => void;
const openRequestListeners = new Set<OpenRequestListener>();

export function requestNarrationPlayerOpen(): void {
  for (const listener of openRequestListeners) listener();
}

export function subscribeNarrationPlayerOpen(listener: OpenRequestListener): () => void {
  openRequestListeners.add(listener);
  return () => {
    openRequestListeners.delete(listener);
  };
}

/** Test seam — the store is module state, and a leaked session would cross test boundaries. */
export function resetNarrationPlaybackForTests(): void {
  current = null;
  listeners.clear();
  openRequestListeners.clear();
}
