import { useCallback, useEffect, useRef, useState } from 'react';
import { scanBookChapters, type ChapterScanOutcome } from '../bookChapterScan';
import { loadScan, rememberScan } from '../bookChapterScanStore';
import { deviceChapterScanDeps, isAudioScanAvailable } from '../nativeAudioScan';
import type { ChapterMark } from '../chapterScrubber';

export interface BookChapterScan {
  /** What a scan found. Empty when none was run, or when the book announces nothing. */
  marks: ChapterMark[];
  scanning: boolean;
  /** How far through the decode, 0 to 100. Only meaningful while scanning. */
  percent: number;
  /** True when a scan could be run and has not been. */
  offered: boolean;
  scan: () => Promise<void>;
  /** The last conclusion, so a caller can say why nothing came back. */
  outcome: ChapterScanOutcome | null;
  /**
   * True once this book has an answer, from this session or a previous one.
   *
   * Separate from `outcome`, which only ever describes a scan run just now. A book scanned last
   * week that announces nothing comes back with no marks and no outcome, and without this the shelf
   * could not tell that from a book nobody has ever looked at — so it would draw nothing where it
   * should say the book was listened to and has no chapters to find.
   */
  scanned: boolean;
}

/**
 * Chapters found by listening, for a book that states none.
 *
 * The last hop. Everything under this — the loudness scan, the pause threshold, the keyword pass,
 * the arithmetic that turns hits into marks — existed and was tested and could not be reached from
 * anywhere in the app. This is what reaches it.
 *
 * Never scans on its own. Decoding a thirty hour recording is minutes of work and real battery,
 * and doing that silently because somebody opened a book would be a cost they never agreed to. It
 * offers; the answer is remembered; the offer does not come back.
 *
 * Deliberately only for books with no chapter table of their own. A file that states its chapters
 * is telling the truth about itself, and guessing over the top of that would be replacing fact
 * with inference.
 */
export function useBookChapterScan(input: {
  /** Stable id for remembering the answer. */
  bookId: string | null | undefined;
  uri: string | null | undefined;
  /** True only when the book carries no chapter table of its own. */
  enabled: boolean;
}): BookChapterScan {
  const { bookId, uri, enabled } = input;
  const [marks, setMarks] = useState<ChapterMark[]>([]);
  const [scanning, setScanning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [outcome, setOutcome] = useState<ChapterScanOutcome | null>(null);
  /** Null until the store has been consulted, so the offer does not flash before it is known. */
  const [known, setKnown] = useState<boolean | null>(null);

  const id = bookId?.trim() ?? '';
  /*
   * Which book the progress ticks belong to. The decode reports from native on its own schedule and
   * a listener can leave a thirty hour scan and open something else, at which point those ticks
   * would drive a bar under the wrong book's title.
   */
  const scanningId = useRef('');

  useEffect(() => {
    // Cleared per book, or one book's findings would sit under another book's title.
    setMarks([]);
    setOutcome(null);
    setScanning(false);
    setPercent(0);
    if (!enabled || !id) {
      setKnown(null);
      return;
    }
    const stored = loadScan(id);
    setKnown(stored !== null);
    if (stored) setMarks(stored.marks);
  }, [id, enabled]);

  const scan = useCallback(async () => {
    const target = uri?.trim() ?? '';
    if (!enabled || !id || !target || scanning) return;
    setScanning(true);
    setPercent(0);
    scanningId.current = id;
    try {
      const result = await scanBookChapters(
        target,
        deviceChapterScanDeps((p) => {
          if (scanningId.current !== id) return;
          setPercent(Math.max(0, Math.min(100, Math.round(p))));
        }),
      );
      setOutcome(result);
      /*
       * Only adopt what came back if this is still the book on screen. A thirty hour decode
       * outlives a listener changing their mind, and writing the result afterwards would label
       * whatever is open now with the chapters of something else.
       */
      if (id === (bookId?.trim() ?? '')) {
        setMarks(result.status === 'chapters' ? result.chapters.map(toMark) : []);
      }
      if (rememberScan(id, result)) setKnown(true);
    } catch {
      setOutcome({ status: 'unavailable', reason: 'decode-failed' });
    } finally {
      scanningId.current = '';
      setScanning(false);
      setPercent(0);
    }
  }, [enabled, id, uri, scanning, bookId]);

  return {
    marks,
    scanning,
    percent,
    /*
     * Offered only where it could actually do something: a device with the scanner, a book with no
     * chapter table, nothing already known about it, and somewhere for the decoder to read from. A
     * button that reports "unavailable" the moment it is pressed is worse than no button.
     *
     * The uri is the one that is easy to forget. `scan` returns immediately without it, so on a
     * book held only as a locker entry the offer appeared and pressing it did nothing at all.
     */
    offered:
      enabled &&
      isAudioScanAvailable() &&
      known === false &&
      !scanning &&
      Boolean(uri?.trim()),
    scan,
    outcome,
    scanned: known === true,
  };
}

function toMark(chapter: { startSeconds: number }): ChapterMark {
  /*
   * Unnamed on purpose. The spotter heard the word "chapter", which is evidence that one starts
   * here, not a title. The view numbers them; writing the evidence in as a name would be stating
   * a guess as fact.
   */
  return { startSeconds: chapter.startSeconds, title: '' };
}
