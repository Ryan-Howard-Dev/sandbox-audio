/**
 * Chapters embedded inside a single audiobook file.
 *
 * Multi-file audiobooks already list their chapters, because each chapter is its own track. An M4B
 * is one file with the chapter table inside it, so without this a five-hour book is a single
 * unnavigable block — no way to see where you are, and no way to jump.
 *
 * The parser for this has existed and been tested since before the player did; nothing ever called
 * it. This is that call.
 */

import { useEffect, useState } from 'react';
import { audiobookChaptersFor } from '../../audiobookChapters';

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
  /** Current playhead, so the active chapter can be highlighted. */
  positionSeconds?: number;
  /** Seek within the already-playing file — chapters are offsets, not separate tracks. */
  onSeek: (startSeconds: number) => void;
  label?: string;
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
  positionSeconds,
  onSeek,
  label = 'Chapters',
}: EmbeddedChapterListProps) {
  const [chapters, setChapters] = useState<Chapter[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setChapters(null);
    if (!entryId && !contentUri) return;
    void audiobookChaptersFor({ id: entryId, uri: contentUri }).then((rows) => {
      // Guarded because a listener can move between books faster than a header read returns, and
      // the late one would otherwise overwrite the book actually open.
      if (!cancelled) setChapters(rows.map((row) => ({ ...row, title: row.title ?? '' })));
    });
    return () => {
      cancelled = true;
    };
  }, [entryId, contentUri]);

  // Nothing at all while loading, and nothing when the file carries no chapter table. A heading
  // over an empty list reads as breakage; most audiobooks legitimately have no embedded chapters.
  if (!chapters || chapters.length === 0) return null;

  const active = activeIndex(chapters, positionSeconds);

  return (
    <section className="audiobook-embedded-chapters">
      <h4 className="podcasts-show-section-title">
        {label} · {chapters.length}
      </h4>
      <ol className="podcasts-show-episode-list">
        {chapters.map((chapter, index) => (
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
              <p className="podcasts-show-episode-title">{chapter.title}</p>
              <p className="podcasts-show-episode-meta font-mono tabular-nums">
                {formatOffset(chapter.startSeconds)}
              </p>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
