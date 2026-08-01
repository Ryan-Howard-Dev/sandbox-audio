/**
 * Where in a document the reading had got to, in a form that survives re-chunking.
 *
 * Position was stored as a chunk index, and documents are re-chunked every time they are opened
 * — deliberately, so that improvements to the chunking rules reach documents imported months ago.
 * The two together are a quiet bug: change the rules, and every saved position lands somewhere
 * different in the same text. Nothing warns you, because an index is still a valid index.
 *
 * A character offset into the document's own text has no such problem. The text does not change;
 * only the way it is cut up does. Converting back is a scan for the chunk containing that offset,
 * which is cheap and, more importantly, correct whatever the chunking did.
 */
import type { NarrationChunk } from './documentNarration';

/**
 * Character offset at which each chunk begins.
 *
 * Chunks are contiguous slices of the document with whitespace between them collapsed, so offsets
 * are accumulated from the chunk lengths rather than searched for in the source. Searching would
 * find the wrong copy of any sentence that appears twice.
 */
export function chunkStartOffsets(chunks: NarrationChunk[]): number[] {
  const offsets: number[] = [];
  let running = 0;
  for (const chunk of chunks) {
    offsets.push(running);
    // +1 for the separator the chunker leaves between passages.
    running += chunk.text.length + 1;
  }
  return offsets;
}

/** Offset of a chunk, for saving. Out-of-range indices clamp rather than throw. */
export function offsetForChunk(chunks: NarrationChunk[], chunkIndex: number): number {
  if (chunks.length === 0) return 0;
  const offsets = chunkStartOffsets(chunks);
  const index = Math.min(Math.max(0, Math.floor(chunkIndex)), offsets.length - 1);
  return offsets[index]!;
}

/**
 * The chunk a saved offset falls in, for resuming.
 *
 * Lands on the chunk that contains the offset. An offset past the end resumes at the last chunk
 * rather than at the beginning, because a document that was finished should not restart itself.
 */
export function chunkForOffset(chunks: NarrationChunk[], offset: number): number {
  if (chunks.length === 0) return 0;
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  const offsets = chunkStartOffsets(chunks);
  for (let i = offsets.length - 1; i >= 0; i -= 1) {
    if (offset >= offsets[i]!) return i;
  }
  return 0;
}

/**
 * How far back to resume, in characters, after a gap in listening.
 *
 * Coming back to a book after three days and being dropped mid-sentence is disorienting; every
 * dedicated audiobook player rewinds a little on resume for exactly this reason. Characters rather
 * than seconds because that is the unit this medium has.
 */
export const RESUME_REWIND_CHARS = 400;
export const RESUME_REWIND_AFTER_MS = 60 * 60 * 1000;

export function resumeOffset(
  savedOffset: number,
  savedAt: number,
  now: number = Date.now(),
): number {
  if (!Number.isFinite(savedOffset) || savedOffset <= 0) return 0;
  const away = now - savedAt;
  if (!Number.isFinite(away) || away < RESUME_REWIND_AFTER_MS) return savedOffset;
  return Math.max(0, savedOffset - RESUME_REWIND_CHARS);
}
