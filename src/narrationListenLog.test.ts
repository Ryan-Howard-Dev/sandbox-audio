import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted, because vi.mock is lifted above every other statement in the file and a factory
// closing over an ordinary const would read it before it exists.
const { recordPlayEvent } = vi.hoisted(() => ({ recordPlayEvent: vi.fn((_o: unknown) => ({}) as never) }));
vi.mock('./playHistory', () => ({ recordPlayEvent }));

import {
  MIN_NARRATION_LISTEN_MS,
  flushNarrationListen,
  isNarrationEnvelopeId,
  narrationEnvelopeId,
  narrationListenPaused,
  narrationListenStarted,
  pendingNarrationListenMs,
  resetNarrationListenLogForTests,
} from './narrationListenLog';

const BOOK = { documentId: 'doc-1', title: 'Big Magic', author: 'Elizabeth Gilbert', kind: 'book' as const };
const PAPER = { documentId: 'doc-2', title: 'A Paper', kind: 'document' as const };
const T0 = 1_700_000_000_000;
/** What recordPlayEvent was handed on call n. Only the fields these tests assert on. */
function callArg(n: number): {
  envelope: {
    envelopeId: string;
    title: string;
    artist: string;
    durationSeconds: number;
  };
  listenedMs: number;
  skipped: boolean;
} {
  return (recordPlayEvent.mock.calls as unknown as unknown[][])[n]![0] as ReturnType<
    typeof callArg
  >;
}


beforeEach(() => {
  resetNarrationListenLogForTests();
  recordPlayEvent.mockClear();
});

describe('narration envelope ids', () => {
  it('names the document, so a listen points at something real', () => {
    expect(narrationEnvelopeId('doc-1')).toBe('narration:doc-1');
    expect(isNarrationEnvelopeId('narration:doc-1')).toBe(true);
  });

  it('is not mistaken for anything else in the log', () => {
    expect(isNarrationEnvelopeId('audiobook:42')).toBe(false);
    expect(isNarrationEnvelopeId('podcast:feed:ep')).toBe(false);
    expect(isNarrationEnvelopeId(null)).toBe(false);
  });
});

describe('counting listening time', () => {
  it('counts the wall clock while the voice is speaking', () => {
    narrationListenStarted(BOOK, T0);
    expect(pendingNarrationListenMs(T0 + 30_000)).toBe(30_000);
  });

  it('does not count time spent paused', () => {
    // A book left paused overnight is not eight hours of listening.
    narrationListenStarted(BOOK, T0);
    narrationListenPaused(T0 + 10_000);
    expect(pendingNarrationListenMs(T0 + 8 * 3_600_000)).toBe(10_000);
  });

  it('adds up spans across pauses', () => {
    narrationListenStarted(BOOK, T0);
    narrationListenPaused(T0 + 10_000);
    narrationListenStarted(BOOK, T0 + 60_000);
    narrationListenPaused(T0 + 75_000);
    expect(pendingNarrationListenMs(T0 + 90_000)).toBe(25_000);
  });

  it('does not restart a span that is already running', () => {
    /*
     * The reader emits 'speaking' on every passage change, so a naive start would reset the clock
     * every paragraph and record almost nothing for a six hour book.
     */
    narrationListenStarted(BOOK, T0);
    narrationListenStarted(BOOK, T0 + 30_000);
    narrationListenStarted(BOOK, T0 + 45_000);
    expect(pendingNarrationListenMs(T0 + 60_000)).toBe(60_000);
  });

  it('ignores a pause with no span open', () => {
    narrationListenPaused(T0);
    expect(pendingNarrationListenMs(T0 + 1_000)).toBe(0);
  });
});

describe('flushing to the play log', () => {
  it('writes a listen once there is one worth writing', () => {
    narrationListenStarted(BOOK, T0);
    expect(flushNarrationListen(T0 + 600_000)).toBe(true);
    expect(recordPlayEvent).toHaveBeenCalledTimes(1);
    const arg = callArg(0) as {
      envelope: { envelopeId: string; title: string; artist: string; durationSeconds: number };
      listenedMs: number;
      skipped: boolean;
    };
    expect(arg.envelope.envelopeId).toBe('narration:doc-1');
    expect(arg.envelope.title).toBe('Big Magic');
    expect(arg.envelope.artist).toBe('Elizabeth Gilbert');
    expect(arg.listenedMs).toBe(600_000);
    // Putting a book down is not rejecting it.
    expect(arg.skipped).toBe(false);
  });

  it('says so when nobody performed it', () => {
    narrationListenStarted(PAPER, T0);
    flushNarrationListen(T0 + 600_000);
    const arg = callArg(0);
    expect(arg.envelope.artist).toBe('Read aloud');
  });

  it('reports the time spent as the duration, never an estimate of the whole text', () => {
    // completedPct is derived from these two; an estimated total would make it a percentage of a
    // guess, and a book would look finished or barely started depending on the estimator.
    narrationListenStarted(BOOK, T0);
    flushNarrationListen(T0 + 125_000);
    const arg = callArg(0) as {
      envelope: { durationSeconds: number };
    };
    expect(arg.envelope.durationSeconds).toBe(125);
  });

  it('discards a listen too short to have been one', () => {
    narrationListenStarted(BOOK, T0);
    expect(flushNarrationListen(T0 + MIN_NARRATION_LISTEN_MS - 1)).toBe(false);
    expect(recordPlayEvent).not.toHaveBeenCalled();
  });

  it('writes nothing when there was nothing open', () => {
    expect(flushNarrationListen(T0)).toBe(false);
    expect(recordPlayEvent).not.toHaveBeenCalled();
  });

  it('forgets what it wrote, so a second flush does not double-count', () => {
    narrationListenStarted(BOOK, T0);
    flushNarrationListen(T0 + 600_000);
    expect(flushNarrationListen(T0 + 700_000)).toBe(false);
    expect(recordPlayEvent).toHaveBeenCalledTimes(1);
  });

  it('banks the first book when a second one starts', () => {
    // Two books cannot be read at once, and losing the first one's time because the second began
    // is the kind of quiet loss that makes a stats screen worth nothing.
    narrationListenStarted(BOOK, T0);
    narrationListenStarted(PAPER, T0 + 600_000);
    expect(recordPlayEvent).toHaveBeenCalledTimes(1);
    const first = callArg(0) as {
      envelope: { envelopeId: string };
    };
    expect(first.envelope.envelopeId).toBe('narration:doc-1');

    flushNarrationListen(T0 + 900_000);
    expect(recordPlayEvent).toHaveBeenCalledTimes(2);
    const second = callArg(1) as {
      envelope: { envelopeId: string };
      listenedMs: number;
    };
    expect(second.envelope.envelopeId).toBe('narration:doc-2');
    expect(second.listenedMs).toBe(300_000);
  });
});
