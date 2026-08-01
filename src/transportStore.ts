/**
 * What is playing, held outside React.
 *
 * The player is one component that grew a boolean per medium, and the four kinds of thing it plays
 * want genuinely different screens: a record for music, a portrait cover and a chapter list for a
 * book, a page count and no scrubber at all for a document being read aloud. Splitting the views
 * only works once the state they share stops living inside any one of them.
 *
 * Position updates several times a second. Putting that through React context re-renders every
 * consumer on every tick, so the artwork and the title repaint at the same rate as the clock. The
 * fix is not memoisation scattered through the tree; it is subscribing per slice, which is what
 * this store is for: a component that reads the position re-renders on the position, and a
 * component that reads the title does not.
 *
 * Deliberately not a new dependency. narrationPlayback.ts already proved this shape in this
 * codebase, and useSyncExternalStore is the React API built for exactly it.
 */
import { controlsForPillar, type MediaPillar, type PillarControls } from './mediaPillar';

export interface TransportSnapshot {
  pillar: MediaPillar;
  title: string;
  artist: string;
  artworkUrl?: string;
  isPlaying: boolean;
  /** Milliseconds, for anything with a decoder behind it. */
  positionMs: number;
  /**
   * Milliseconds, or -1 where the length is genuinely unknown.
   *
   * -1 rather than 0 because they mean different things: 0 is a track that has not loaded, -1 is
   * generated speech that has no length until it has been spoken. Android draws its lock screen
   * scrubber from this, and the two produce different screens.
   */
  durationMs: number;
  /** Position where there is no timeline: "Page 12 of 300". */
  structural: { label: string; percent: number } | null;
  controls: PillarControls;
}

const IDLE: TransportSnapshot = {
  pillar: 'music',
  title: '',
  artist: '',
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  structural: null,
  controls: controlsForPillar('music'),
};

let state: TransportSnapshot = IDLE;
const listeners = new Set<() => void>();

export function getTransportSnapshot(): TransportSnapshot {
  return state;
}

export function subscribeTransport(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Merge a partial update.
 *
 * Controls are derived rather than passed: the pillar decides them, and letting a caller set both
 * is how they drift apart. Notifies only when something actually changed, so a poll that reports
 * the same position twice does not wake the tree.
 */
export function updateTransport(patch: Partial<Omit<TransportSnapshot, 'controls'>>): void {
  const next: TransportSnapshot = {
    ...state,
    ...patch,
    controls: patch.pillar ? controlsForPillar(patch.pillar) : state.controls,
  };
  if (shallowEqual(state, next)) return;
  state = next;
  for (const listener of listeners) listener();
}

export function resetTransport(): void {
  if (state === IDLE) return;
  state = IDLE;
  for (const listener of listeners) listener();
}

function shallowEqual(a: TransportSnapshot, b: TransportSnapshot): boolean {
  return (
    a.pillar === b.pillar &&
    a.title === b.title &&
    a.artist === b.artist &&
    a.artworkUrl === b.artworkUrl &&
    a.isPlaying === b.isPlaying &&
    a.positionMs === b.positionMs &&
    a.durationMs === b.durationMs &&
    a.controls === b.controls &&
    structuralEqual(a.structural, b.structural)
  );
}

function structuralEqual(
  a: TransportSnapshot['structural'],
  b: TransportSnapshot['structural'],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.label === b.label && a.percent === b.percent;
}

/** Test seam — module state would otherwise leak between tests. */
export function resetTransportForTests(): void {
  state = IDLE;
  listeners.clear();
}
