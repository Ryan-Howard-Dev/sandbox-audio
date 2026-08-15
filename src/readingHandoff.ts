/**
 * Which book the reader should open, handed from the shelf that was tapped.
 *
 * Reading used to be its own entry in More, which meant a book lived in the Audiobooks station
 * while the way to read it lived somewhere else entirely. It is one shelf now: a book is opened
 * from Audiobooks, and reading is something you do to the book you picked rather than a separate
 * place you visit and then pick again.
 *
 * A module rather than shell state because it carries one id across one navigation and nothing
 * renders from it. Threading it through the router, the station and two components would put a
 * prop in four files to say something only two of them care about.
 *
 * Taken rather than read: the reader consumes it once on the way in, so returning to the reader
 * later opens its own shelf instead of silently reopening whatever was last tapped.
 */

let pending: string | null = null;

/** Say which document the reader should open when it next mounts. */
export function setDocumentToRead(documentId: string): void {
  pending = documentId;
}

/** Consume the pending document, if there is one. Returns null on an ordinary visit. */
export function takeDocumentToRead(): string | null {
  const id = pending;
  pending = null;
  return id;
}

/** Forget any pending handoff, for a navigation that was abandoned. */
export function clearDocumentToRead(): void {
  pending = null;
}
