/**
 * The chapter list for a book that is one file.
 *
 * Multi-file audiobooks already list their chapters, because each chapter is its own track. An M4B
 * is one file with the chapter table inside it, so without this a five-hour book is a single
 * unnavigable block — no way to see where you are, and no way to jump.
 *
 * Two things can put chapters here and they are not the same kind of fact:
 *
 *   The file's own table, read out of MP4 atoms or ID3 frames. Authoritative. The book is stating
 *   what its chapters are and where they start.
 *
 *   What a scan heard, for a book that states nothing. Inference — silences propose boundaries and
 *   a keyword spotter confirms which of them a narrator announced. Offered, never automatic, and
 *   labelled differently on screen so a guess is never presented as the book's own word.
 *
 * The scan half is the hop this file was missing. Everything under it — the loudness scan, the
 * pause threshold, the keyword pass, the store that remembers the answer — existed, was tested, and
 * had no button anywhere in the app that reached it.
 */

import { useEffect, useState } from 'react';
import { audiobookChaptersFor } from '../../audiobookChapters';
import { useBookChapterScan } from '../../hooks/useBookChapterScan';
import { chapterSectionState, type ChapterScanNote } from '../../bookChapterScanView';
import { useTranslation } from '../../i18n';

export interface EmbeddedChapterListProps {
  /**
   * The book's id — a MediaStore id for a scanned book, a locker entry id for an imported one.
   */
  entryId: string;
  /**
   * Where the file is, when it is not in the locker.
   *
   * Without this the id alone was resolved through the locker blob store, which never held a book
   * that was scanned off the device rather than imported. That is most audiobooks, and it is why
   * this list has been rendering nothing on real phones: the parse worked, the lookup never found
   * a file to parse. See audiobookChapterSource.ts.
   */
  contentUri?: string;
  /**
   * What kind of file it is, so the right chapter table is looked for.
   *
   * An M4B keeps chapters in MP4 atoms and an MP3 keeps them in ID3 frames, and the two share no
   * structure at all. Passed rather than sniffed: the scan already knows.
   */
  mimeType?: string;
  displayName?: string;
  /** Current playhead, so the active chapter can be highlighted. */
  positionSeconds?: number;
  /** Seek within the already-playing file — chapters are offsets, not separate tracks. */
  onSeek: (startSeconds: number) => void;
  label?: string;
  /**
   * Offer to find chapters by listening, for a book whose file states none.
   *
   * Off by default. Decoding a recording end to end is minutes of work and real battery, so it is
   * only offered where a listener has actually opened a book and can see what they are agreeing to.
   */
  allowScan?: boolean;
}

type Chapter = { startSeconds: number; title: string };

function formatOffset(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Last chapter whose start is at or before the playhead. */
function activeIndex(chapters: Chapter[], positionSeconds: number | undefined): number {
  if (positionSeconds == null || chapters.length === 0) return -1;
  let index = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.startSeconds <= positionSeconds) index = i;
    else break;
  }
  return index;
}

export function EmbeddedChapterList({
  entryId,
  contentUri,
  mimeType,
  displayName,
  positionSeconds,
  onSeek,
  label = 'Chapters',
  allowScan = false,
}: EmbeddedChapterListProps) {
  const { t } = useTranslation();
  const [chapters, setChapters] = useState<Chapter[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setChapters(null);
    if (!entryId && !contentUri) return;
    void audiobookChaptersFor({
      id: entryId,
      uri: contentUri,
      mimeType,
      name: displayName,
    }).then((rows) => {
      // Guarded because a listener can move between books faster than a header read returns, and
      // the late one would otherwise overwrite the book actually open.
      if (!cancelled) setChapters(rows.map((row) => ({ ...row, title: row.title ?? '' })));
    });
    return () => {
      cancelled = true;
    };
  }, [entryId, contentUri, mimeType, displayName]);

  /*
   * Only ever for a book whose file says nothing, and only once that is actually known. Enabling it
   * while the header read is still in flight would offer a scan of a book that turns out to carry a
   * perfectly good chapter table, and inferring over the top of a stated fact is the one thing this
   * must not do.
   */
  const scan = useBookChapterScan({
    bookId: entryId,
    uri: contentUri,
    enabled: allowScan && chapters !== null && chapters.length === 0,
  });

  /*
   * Declared before it is used rather than hoisted below the early returns, because a function
   * declaration sitting after a `return` is legal, works, and reads to everyone who meets it as
   * dead code.
   */
  const renderList = (rows: Chapter[], heading: string, inferred: boolean) => {
    const active = activeIndex(rows, positionSeconds);
    return (
      <section className="audiobook-embedded-chapters">
        <h4 className="podcasts-show-section-title">{heading}</h4>
        <ol className="podcasts-show-episode-list">
          {rows.map((chapter, index) => (
            <li
              key={`${chapter.startSeconds}-${index}`}
              className={`podcasts-show-episode-row${index === active ? ' is-active' : ''}`}
            >
              <button
                type="button"
                className="podcasts-show-episode-button"
                onClick={() => onSeek(chapter.startSeconds)}
                aria-current={index === active ? 'true' : undefined}
              >
                <p className="podcasts-show-episode-title">
                  {/*
                    A spotted word is not a title. The scan heard "chapter" and knows where, which
                    is evidence a chapter starts here, so the number comes from the position in the
                    list rather than from anything the file or the narrator actually named.
                  */}
                  {chapter.title || t('audiobooks.chapterFallback', { number: index + 1 })}
                </p>
                <p className="podcasts-show-episode-meta font-mono tabular-nums">
                  {formatOffset(chapter.startSeconds)}
                </p>
              </button>
            </li>
          ))}
        </ol>
        {inferred ? (
          <p className="font-mono text-[10px] text-[var(--text-dim)] mt-2 leading-relaxed">
            {t('audiobooks.chapterScanFoundHint')}
          </p>
        ) : null}
      </section>
    );
  };

  /*
   * Which of the seven answers this is, decided in bookChapterScanView where it can be tested. The
   * suite here is node, so anything decided inside the JSX is only ever checked by eye on a phone.
   */
  const state = chapterSectionState({
    stated: chapters,
    allowScan,
    scannedMarks: scan.marks,
    scanning: scan.scanning,
    offered: scan.offered,
    outcome: scan.outcome,
    scanned: scan.scanned,
  });

  if (state.kind === 'loading' || state.kind === 'hidden') return null;

  if (state.kind === 'stated') {
    return renderList(chapters!, `${label} · ${chapters!.length}`, false);
  }

  if (state.kind === 'found') {
    return renderList(
      scan.marks.map((mark) => ({ startSeconds: mark.startSeconds, title: mark.title ?? '' })),
      `${t('audiobooks.chapterScanFoundLabel')} · ${scan.marks.length}`,
      true,
    );
  }

  if (state.kind === 'scanning') {
    return (
      <section className="audiobook-embedded-chapters">
        <h4 className="podcasts-show-section-title">{t('audiobooks.chapterScanRunning')}</h4>
        <div
          className="h-1 rounded-full overflow-hidden bg-[var(--bg-elevated)] mt-1"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={scan.percent}
        >
          {/*
            Never quite empty. The first percent of a thirty hour book is eighteen minutes, and a
            bar that sits at zero for that long is one nobody believes is working.
          */}
          <div
            className="h-full bg-[var(--accent-brand)] transition-[width] duration-500"
            style={{ width: `${Math.max(2, scan.percent)}%` }}
          />
        </div>
        <p className="font-mono text-[10px] text-[var(--text-dim)] mt-1 tabular-nums">
          {scan.percent}%
        </p>
      </section>
    );
  }

  if (state.kind === 'offer') {
    return (
      <section className="audiobook-embedded-chapters">
        <button
          type="button"
          className="btn-accent touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider"
          onClick={() => void scan.scan()}
        >
          {t('audiobooks.chapterScanOffer')}
        </button>
        <p className="font-mono text-[10px] text-[var(--text-dim)] mt-2 leading-relaxed">
          {t('audiobooks.chapterScanOfferHint')}
        </p>
      </section>
    );
  }

  /*
   * Said out loud rather than left blank. A book that was listened to and announces nothing looks
   * identical to one nobody has scanned, and without this line the offer would simply vanish after
   * a scan and read as a button that did nothing.
   */
  return (
    <section className="audiobook-embedded-chapters">
      <p className="font-mono text-[10px] text-[var(--text-dim)] leading-relaxed">
        {t(NOTE_KEYS[state.note])}
      </p>
    </section>
  );
}

/**
 * A line for each way of having no chapters.
 *
 * A record rather than a switch, and typed by the union, so adding a reason to
 * ChapterScanUnavailable fails to compile here until it has something to say. The version of this
 * that was a hand-written list is how the fourth listening format got a row in the data and none
 * on screen.
 */
const NOTE_KEYS: Record<ChapterScanNote, string> = {
  none: 'audiobooks.chapterScanNone',
  'no-model': 'audiobooks.chapterScanNoModel',
  'not-worth-it': 'audiobooks.chapterScanTooMany',
  'decode-failed': 'audiobooks.chapterScanFailed',
  // Never reached: chapterSectionState hides this one, since there was never a button to explain.
  'no-scanner': 'audiobooks.chapterScanNone',
};
