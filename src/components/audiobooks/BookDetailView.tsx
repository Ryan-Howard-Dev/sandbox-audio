import React from 'react';
import { ArrowLeft, BookOpen, Play } from 'lucide-react';
import type { DocumentSummary } from '../../documentLibrary';
import { documentDisplayName } from '../../documentLibrary';
import { formatTime } from '../../stations/theme';
import { seedGradient } from '../../seedGradient';
import { useTranslation } from '../../i18n';

export interface BookDetailViewProps {
  book: DocumentSummary;
  onBack: () => void;
  /** Start at a chapter. Index 0 is "read from the beginning". */
  onOpenChapter: (index: number) => void;
  /**
   * Open this book in the reader.
   *
   * Absent where reading is not available, in which case the action is not offered rather than
   * offered and inert.
   */
  onRead?: () => void;
}

/**
 * An ebook, opened the way an audiobook opens.
 *
 * Tapping a book used to begin narrating it immediately. There was no moment at which you could
 * see what you had picked up: no cover, no author, no blurb, no chapter list, no way to start at
 * chapter nine. An audiobook in the shelf next door has all of that, and an EPUB carries the same
 * metadata — it was parsed on import and then never shown.
 *
 * Deliberately the same markup as the audiobook detail rather than a second design. These sit two
 * tabs apart in one station, and a book that opens differently depending on whether someone
 * recorded it reads as two apps.
 */
export default function BookDetailView({ book, onBack, onOpenChapter, onRead }: BookDetailViewProps) {
  const { t } = useTranslation();
  const title = documentDisplayName(book.name);
  const chapters = book.chapterTitles ?? [];
  /** Where narration stopped, so "continue" means something. */
  const resumeChapter = book.position?.chapterIndex ?? 0;

  return (
    <div className="locker-page podcasts-view audiobooks-view">
      <button
        type="button"
        className="podcasts-show-detail-back touch-manipulation mb-3"
        onClick={onBack}
      >
        <ArrowLeft className="w-4 h-4" aria-hidden />
        {t('audiobooks.backToLibrary')}
      </button>

      <section className="podcasts-library-show-detail audiobooks-book-detail">
        <header className="podcasts-show-detail-head">
          <div className="podcasts-show-detail-art">
            {book.coverUrl ? (
              // The cover came out of the EPUB itself as a data URL, so it needs no network and
              // works in air-gap mode like the rest of the shelf.
              <img src={book.coverUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full" style={{ background: seedGradient(title) }} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="podcasts-show-detail-title">{title}</h2>
            {book.author ? <p className="podcasts-show-detail-author">{book.author}</p> : null}
            <p className="font-mono text-[10px] text-[var(--text-dim)] mt-1">
              {chapters.length > 0
                ? t('audiobooks.chaptersCount', { count: chapters.length })
                : t('audiobooks.bookNoChapters')}
              {book.estimatedSeconds > 0 ? ` · ${formatTime(book.estimatedSeconds)}` : ''}
              {book.language ? ` · ${book.language.toUpperCase()}` : ''}
            </p>
            <div className="podcasts-show-detail-actions mt-3">
              <button
                type="button"
                className="btn-accent touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-2"
                onClick={() => onOpenChapter(resumeChapter)}
                aria-label={t('audiobooks.playAlbum', { title })}
              >
                <Play className="w-3.5 h-3.5 shrink-0" />
                {/*
                  * This button narrates. It said "Read", which is what somebody wanting to read
                  * the book would tap, and it then read the book aloud to them.
                  */}
                {resumeChapter > 0 ? t('audiobooks.bookContinue') : t('audiobooks.bookListen')}
              </button>
              {onRead ? (
                <button
                  type="button"
                  className="podcasts-show-detail-secondary touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-2"
                  onClick={onRead}
                  aria-label={t('audiobooks.bookRead')}
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  {t('audiobooks.bookRead')}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {book.description ? (
          <div className="mt-4">
            <p className="ui-hint ui-hint--desc whitespace-pre-line">{book.description}</p>
          </div>
        ) : null}

        {chapters.length > 0 ? (
          <div className="mt-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-mid)] mb-2">
              {t('audiobooks.chaptersLabel')}
            </p>
            <div className="space-y-1">
              {chapters.map((chapterTitle, index) => (
                <button
                  key={`${index}-${chapterTitle}`}
                  type="button"
                  onClick={() => onOpenChapter(index)}
                  className="w-full flex items-center gap-3 p-3 border border-[var(--border)] rounded-lg text-left touch-manipulation"
                  aria-label={t('audiobooks.playChapter', {
                    chapter: chapterTitle || String(index + 1),
                  })}
                >
                  <span className="font-mono text-[10px] text-[var(--text-dim)] w-6 shrink-0">
                    {index + 1}
                  </span>
                  <span className="audiobook-doc-name truncate flex-1">
                    {chapterTitle || t('audiobooks.chapterFallback', { number: index + 1 })}
                  </span>
                  {index === resumeChapter && resumeChapter > 0 ? (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-accent shrink-0">
                      {t('audiobooks.bookResumeHere')}
                    </span>
                  ) : null}
                  <Play className="w-3.5 h-3.5 shrink-0 text-[var(--text-mid)]" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
