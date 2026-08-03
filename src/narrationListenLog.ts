/**
 * Reading aloud, recorded as listening.
 *
 * Insights is built on an append-only play-event log, and every event is keyed by an envelope id.
 * Narration has no envelope — that is the whole reason the player needed a separate seam for it —
 * so nothing in the narration path ever wrote an event. Read a book aloud for six hours and the
 * stats say the day was empty. Four pillars in mediaPillar.ts, three in the analytics.
 *
 * The fix is a synthetic id rather than a second log. `narration:<documentId>` identifies the
 * document exactly, sorts alongside everything else, and lets one classifier answer for all four
 * pillars. A parallel store would need its own migrations, its own retention, and its own bugs.
 *
 * Time is measured on the wall clock, not estimated from the text.
 *
 * This matters more than it looks. Everywhere else in this feature an estimate is the enemy: the
 * engine decides how long a passage takes as it speaks it, so any figure derived from word counts
 * is a guess dressed as a measurement. But listening time is not a property of the text at all. It
 * is how long the voice was actually speaking, and a clock knows that exactly. So narration, alone
 * among the things this app tracks, has a listening figure that needs no estimating.
 *
 * Paused time is not listening. The clock accumulates only while the engine is speaking, so a book
 * left paused overnight adds nothing.
 */
import { recordPlayEvent } from './playHistory';
import type { MediaEnvelope } from './sandboxLayer1';

/** Ids in the play log look like this, so one prefix test classifies them everywhere. */
export const NARRATION_ENVELOPE_PREFIX = 'narration:';

export function narrationEnvelopeId(documentId: string): string {
  return `${NARRATION_ENVELOPE_PREFIX}${documentId}`;
}

export function isNarrationEnvelopeId(envelopeId: string | null | undefined): boolean {
  return (envelopeId?.trim() ?? '').startsWith(NARRATION_ENVELOPE_PREFIX);
}

export interface NarrationListenSubject {
  documentId: string;
  title: string;
  author?: string;
  /** Book or document, so the log can tell an EPUB from a pasted paper. */
  kind: 'book' | 'document';
}

interface OpenSpan {
  subject: NarrationListenSubject;
  /** When the voice started, or null while paused or stopped. */
  startedAt: number | null;
  /** Milliseconds accumulated across every span for this document since the last flush. */
  accumulatedMs: number;
}

let open: OpenSpan | null = null;

/**
 * Below this it was not a listen.
 *
 * Matches the play log's own floor. Tapping play and immediately stopping should not appear in a
 * year's listening as a book you read.
 */
export const MIN_NARRATION_LISTEN_MS = 5_000;

/**
 * The voice started.
 *
 * Switching document flushes the previous one first: two books cannot be read at once, and losing
 * the first one's time because the second started is exactly the kind of quiet loss that makes
 * people stop trusting a stats screen.
 */
export function narrationListenStarted(
  subject: NarrationListenSubject,
  now: number = Date.now(),
): void {
  if (open && open.subject.documentId !== subject.documentId) flushNarrationListen(now);
  if (!open || open.subject.documentId !== subject.documentId) {
    open = { subject, startedAt: now, accumulatedMs: 0 };
    return;
  }
  // Already open: resume the clock, but never restart a span that is already running, or a
  // repeated 'speaking' state change would discard everything counted so far.
  if (open.startedAt === null) open.startedAt = now;
}

/** The voice stopped speaking — paused, ended, or interrupted. Time keeps, the clock stops. */
export function narrationListenPaused(now: number = Date.now()): void {
  if (!open || open.startedAt === null) return;
  open.accumulatedMs += Math.max(0, now - open.startedAt);
  open.startedAt = null;
}

/** Milliseconds counted so far, including any span still running. Exposed for tests and probes. */
export function pendingNarrationListenMs(now: number = Date.now()): number {
  if (!open) return 0;
  const running = open.startedAt === null ? 0 : Math.max(0, now - open.startedAt);
  return open.accumulatedMs + running;
}

/**
 * Write what has been counted to the play log, and forget it.
 *
 * Returns true when an event was written. Called when narration ends, when the shelf goes away,
 * and when a different document starts — anywhere the current span can no longer grow.
 */
export function flushNarrationListen(now: number = Date.now()): boolean {
  if (!open) return false;
  const listenedMs = pendingNarrationListenMs(now);
  const subject = open.subject;
  open = null;
  if (listenedMs < MIN_NARRATION_LISTEN_MS) return false;

  const envelope: MediaEnvelope = {
    envelopeId: narrationEnvelopeId(subject.documentId),
    title: subject.title,
    // The author where the file names one. A pasted document has none, and saying so is better
    // than inventing an artist for something nobody performed.
    artist: subject.author?.trim() || 'Read aloud',
    /*
     * Duration is deliberately the time actually spent, not an estimate of the whole document.
     * completedPct is derived from these two, and an estimated total would make it a percentage
     * of a guess — a book would appear finished or barely started depending on how the estimator
     * happened to be tuned that week.
     */
    durationSeconds: Math.round(listenedMs / 1000),
    url: '',
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: `narration-${subject.kind}-${subject.documentId}`,
  };

  return (
    recordPlayEvent({
      envelope,
      listenedSeconds: listenedMs / 1000,
      listenedMs,
      // Never a skip: there is no next item to skip to, and a book put down is not a rejection.
      skipped: false,
      source: 'locker',
      context: 'single',
    }) !== null
  );
}

/** Test seam — the span is module state and would otherwise cross test boundaries. */
export function resetNarrationListenLogForTests(): void {
  open = null;
}
