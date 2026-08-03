/**
 * Where a document being read aloud actually is — at two levels, both addressable.
 *
 * Reading has two granularities and they are not interchangeable. The **utterance** is the passage
 * the engine was handed and is working through; the **token** is the word inside it being voiced
 * right now. Both were already known here, but only one of them was ever written down properly:
 * the utterance became a character offset into the document (narrationPosition.ts) and could be
 * saved, restored and reasoned about, while the token was a pair of offsets into the current
 * chunk's own string, used to draw a highlight and then thrown away.
 *
 * Readium's TextAwareMediaNavigator.Location makes the second one a first-class location too, with
 * its own locator in the same coordinate space as the first. Adopting that shape is not tidiness.
 * Three things follow from it that do not follow from a highlight:
 *
 *   Resume lands on the word rather than the paragraph. A saved position is the start of the
 *   chunk, so returning to a six-hundred character paragraph you were nearly through restarts the
 *   whole paragraph. With the token located in document coordinates, the position saved is where
 *   the voice actually was.
 *
 *   Progress stops lying. The player draws its bar from chunk index over chunk count, which
 *   silently assumes every passage is the same size — a four-word heading counts as much as a
 *   long paragraph. Measured in characters the bar means what it appears to mean, which matters
 *   most for exactly the documents where a time estimate cannot be offered honestly.
 *
 *   Context travels with the position. textBefore and textAfter let a lock screen or a car display
 *   show the sentence around the one being read without being handed the document.
 *
 * Pure, and separate from the reader, so all of it is testable without a speech engine.
 */
import type { NarrationChunk } from './documentNarration';
import { chunkStartOffsets } from './narrationPosition';

/** One addressable point in the document, at whichever granularity produced it. */
export interface NarrationLocator {
  /** Which passage. Still useful directly: the chapter list seeks by it. */
  utteranceIndex: number;
  /**
   * Characters from the start of the document.
   *
   * The unit that survives re-chunking, which documents undergo every time they are opened so
   * that improved chunking rules reach old imports. See narrationPosition.
   */
  characterOffset: number;
  /** How far through the document, 0 to 1, by characters rather than by passage count. */
  progression: number;
}

export interface NarrationLocation {
  /** The passage being read, exactly as the engine received it. */
  utterance: string;
  /** The text just before it, capped, or null at the start of the document. */
  textBefore: string | null;
  /** The text just after it, capped, or null at the end. */
  textAfter: string | null;
  /**
   * The token within the utterance, as offsets into it.
   *
   * Null where the engine reports no ranges, which is normal — the web fallback has no equivalent
   * and no reader may wait on one.
   */
  range: { start: number; end: number } | null;
  utteranceLocator: NarrationLocator;
  /** Null whenever there is no trustworthy token; the utterance is then the whole location. */
  tokenLocator: NarrationLocator | null;
}

/**
 * Chunk start offsets and total length, computed once.
 *
 * Every locator needs both, and this is called on every range event — several times a second while
 * speaking. Recomputing a running total over a few thousand chunks that often is the kind of cost
 * that turns a highlight into jank.
 */
export interface NarrationMetrics {
  starts: number[];
  /** Total characters, including the separator the chunker leaves between passages. */
  length: number;
}

export function narrationMetrics(chunks: NarrationChunk[]): NarrationMetrics {
  const starts = chunkStartOffsets(chunks);
  const last = chunks.length - 1;
  const length = last >= 0 ? starts[last]! + chunks[last]!.text.length : 0;
  return { starts, length };
}

function progressionAt(offset: number, length: number): number {
  if (!(length > 0)) return 0;
  return Math.max(0, Math.min(1, offset / length));
}

/**
 * Is a reported range usable against this text?
 *
 * Offsets from a speech engine are untrusted. An engine that normalises before speaking
 * ("Dr." becomes "Doctor") can report an offset past the end of the string it was given, and a
 * range that cannot be trusted is dropped rather than allowed to locate the wrong word. This is
 * the same guard ReadAlongText applies before drawing, hoisted so both agree by construction
 * rather than by both happening to be right.
 */
export function isUsableRange(
  range: { start: number; end: number } | null | undefined,
  text: string,
): boolean {
  if (!range) return false;
  return (
    Number.isFinite(range.start) &&
    Number.isFinite(range.end) &&
    range.start >= 0 &&
    range.end > range.start &&
    range.end <= text.length
  );
}

/** How much surrounding text to carry. Enough for a sentence of context, not a chapter. */
export const CONTEXT_CHARS = 240;

export interface NarrationLocationInput {
  chunks: NarrationChunk[];
  utteranceIndex: number;
  /** As reported by the engine, in offsets into the current utterance. */
  range?: { start: number; end: number } | null;
  metrics?: NarrationMetrics;
  contextChars?: number;
}

/**
 * The full location, or null when there is no document to be located in.
 *
 * An out-of-range utterance index clamps rather than returning null: an index arriving a beat
 * after the document was re-chunked is a race, not a reason to blank the player.
 */
export function resolveNarrationLocation(
  input: NarrationLocationInput,
): NarrationLocation | null {
  const { chunks } = input;
  if (chunks.length === 0) return null;

  const index = Math.min(
    Math.max(0, Math.floor(Number.isFinite(input.utteranceIndex) ? input.utteranceIndex : 0)),
    chunks.length - 1,
  );
  const metrics = input.metrics ?? narrationMetrics(chunks);
  const utterance = chunks[index]!.text;
  const start = metrics.starts[index] ?? 0;

  const utteranceLocator: NarrationLocator = {
    utteranceIndex: index,
    characterOffset: start,
    progression: progressionAt(start, metrics.length),
  };

  const range = isUsableRange(input.range, utterance) ? input.range! : null;
  const tokenLocator: NarrationLocator | null = range
    ? {
        utteranceIndex: index,
        characterOffset: start + range.start,
        progression: progressionAt(start + range.start, metrics.length),
      }
    : null;

  const cap = input.contextChars ?? CONTEXT_CHARS;
  return {
    utterance,
    textBefore: contextBefore(chunks, index, cap),
    textAfter: contextAfter(chunks, index, cap),
    range,
    utteranceLocator,
    tokenLocator,
  };
}

/**
 * The tail of what came before, up to the cap.
 *
 * Taken from the end backwards, because the words immediately before the current passage are the
 * ones that give it context; the start of a paragraph three passages ago does not.
 */
function contextBefore(chunks: NarrationChunk[], index: number, cap: number): string | null {
  if (index <= 0 || cap <= 0) return null;
  const parts: string[] = [];
  let budget = cap;
  for (let i = index - 1; i >= 0 && budget > 0; i -= 1) {
    const text = chunks[i]!.text;
    parts.unshift(text.length > budget ? text.slice(text.length - budget) : text);
    budget -= Math.min(text.length, budget);
  }
  const joined = parts.join(' ').trim();
  return joined.length > 0 ? joined : null;
}

function contextAfter(chunks: NarrationChunk[], index: number, cap: number): string | null {
  if (index >= chunks.length - 1 || cap <= 0) return null;
  const parts: string[] = [];
  let budget = cap;
  for (let i = index + 1; i < chunks.length && budget > 0; i += 1) {
    const text = chunks[i]!.text;
    parts.push(text.length > budget ? text.slice(0, budget) : text);
    budget -= Math.min(text.length, budget);
  }
  const joined = parts.join(' ').trim();
  return joined.length > 0 ? joined : null;
}

/**
 * The position worth saving.
 *
 * The token where one is known, the utterance otherwise. This is the whole practical point of
 * separating them: without it a saved position is always the start of a passage, and coming back
 * to a long paragraph means hearing it again from the beginning.
 */
export function savedOffsetFor(location: NarrationLocation): number {
  return (location.tokenLocator ?? location.utteranceLocator).characterOffset;
}

/**
 * Progress through the document, 0 to 100.
 *
 * By characters, not by passage count. Counting passages treats a four word heading and a six
 * hundred character paragraph as equal steps, so the bar moves in lurches that do not correspond
 * to how much is left to hear.
 */
export function narrationProgressPercent(location: NarrationLocation): number {
  return (location.tokenLocator ?? location.utteranceLocator).progression * 100;
}
