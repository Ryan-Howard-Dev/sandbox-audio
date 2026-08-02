import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, List, Pause, Play, Square } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { formatTime } from '../../stations/theme';
import type { NarrationChunk } from '../../documentNarration';
import type { NarrationReaderState } from '../../narrationReader';
import ReadAlongText, { type ReadAlongRange } from './ReadAlongText';
import {
  chaptersFromPages,
  pageForChunk,
  paginateDocument,
} from '../../documentPagination';

/**
 * A document opened to be read, the way an album or an audiobook opens.
 *
 * The text was the missing half. Reading aloud showed a position counter and nothing else, so a
 * document was the only thing in the app you could play without being able to see what it was.
 * This puts the whole document on screen, in order, and marks the word the voice is on.
 *
 * Passages are the unit throughout: the reader speaks one at a time, so each is its own paragraph,
 * the one being read is marked, and tapping any of them jumps there. A book detail lists chapters
 * you can start from; this is the same idea at the scale narration actually works in.
 */
export interface DocumentReaderViewProps {
  title: string;
  author?: string;
  coverUrl?: string;
  chunks: NarrationChunk[];
  chunkIndex: number;
  range: ReadAlongRange | null;
  state: NarrationReaderState;
  remainingSeconds: number;
  /** Where back goes, in words. Documents return to Documents; books to the book. */
  backLabelKey?: string;
  /**
   * Real chapters, when the source has them.
   *
   * An EPUB states its chapter order in the spine and each chapter is loaded separately, so
   * choosing one is a request for different text rather than a jump within this text. A
   * document has no such thing and falls back to the chapters inferred from its own headings,
   * which are pages in this same view.
   */
  bookChapters?: string[];
  activeChapterIndex?: number;
  onSelectChapter?: (index: number) => void;
  onBack: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeekToChunk: (index: number) => void;
}

export default function DocumentReaderView({
  title,
  author,
  coverUrl,
  chunks,
  chunkIndex,
  range,
  state,
  remainingSeconds,
  backLabelKey,
  bookChapters,
  activeChapterIndex,
  onSelectChapter,
  onBack,
  onPlay,
  onPause,
  onStop,
  onSeekToChunk,
}: DocumentReaderViewProps) {
  const { t } = useTranslation();
  const activeRef = useRef<HTMLLIElement | null>(null);
  const bodyRef = useRef<HTMLOListElement | null>(null);
  const speaking = state === 'speaking';

  const pages = useMemo(() => paginateDocument(chunks), [chunks]);
  const spokenPage = pageForChunk(pages, chunkIndex);
  const chapters = useMemo(() => chaptersFromPages(pages), [pages]);
  /*
   * The page on screen is not always the page being read. A reader who turns back to check
   * something should stay there, so the view follows the voice only when the voice moves.
   */
  const [pageIndex, setPageIndex] = useState(spokenPage);
  const [chapterListOpen, setChapterListOpen] = useState(false);
  useEffect(() => {
    setPageIndex(pageForChunk(pages, chunkIndex));
  }, [chunkIndex, pages]);

  const page = pages[pageIndex];
  const visible = page ? chunks.slice(page.startIndex, page.endIndex + 1) : [];

  // A turned page starts at the top. Landing halfway down a fresh page reads as a broken scroll.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [pageIndex]);

  /*
   * Follow the reading within a page, but only when it moves to a new passage. Scrolling on every
   * word would fight the reader whenever they scrolled back to re-read a line.
   */
  useEffect(() => {
    if (pageIndex !== spokenPage) return;
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [chunkIndex, pageIndex, spokenPage]);

  return (
    <section className="podcasts-library-show-detail document-reader">
      <button
        type="button"
        className="podcasts-show-detail-back touch-manipulation mb-3"
        onClick={onBack}
      >
        <ArrowLeft className="w-4 h-4" aria-hidden />
        {t(backLabelKey ?? 'audiobooks.backToDocuments')}
      </button>

      <header className="podcasts-show-detail-head">
        <div className="podcasts-show-detail-art">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            // A pasted note has no cover. A glyph is honest; a stretched placeholder is not.
            <div className="document-reader-art-blank">
              <FileText className="w-8 h-8" aria-hidden />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="podcasts-show-detail-title">{title}</h2>
          {author ? <p className="podcasts-show-detail-author">{author}</p> : null}
          {page?.chapter ? <p className="document-reader-chapter">{page.chapter}</p> : null}
          <p className="font-mono text-[10px] text-[var(--text-dim)] mt-1">
            {t('audiobooks.pageOf', {
              page: pageIndex + 1,
              total: pages.length,
            })}
            {remainingSeconds > 0
              ? ` · ${formatTime(remainingSeconds)} ${t('audiobooks.docLeft')}`
              : ''}
          </p>
          <div className="podcasts-show-detail-actions mt-3 flex items-center gap-2">
            <button
              type="button"
              className="btn-accent touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-2 whitespace-nowrap"
              onClick={() => (speaking ? onPause() : onPlay())}
              aria-label={speaking ? t('player.pause') : t('player.play')}
            >
              {speaking ? (
                <Pause className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Play className="w-3.5 h-3.5 shrink-0" />
              )}
              {speaking ? t('player.pause') : t('player.play')}
            </button>
            <button
              type="button"
              className="mobile-np-icon-btn touch-manipulation"
              onClick={onStop}
              aria-label={t('audiobooks.docStop')}
            >
              <Square className="w-4 h-4" />
            </button>
            {bookChapters?.length || chapters.length > 0 ? (
              <button
                type="button"
                className="mobile-np-icon-btn touch-manipulation"
                onClick={() => setChapterListOpen((open) => !open)}
                aria-expanded={chapterListOpen}
                aria-label={t('audiobooks.chapters')}
              >
                <List className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {chapterListOpen ? (
        <ul className="document-reader-chapters">
          {bookChapters?.length
            ? // Real chapters: choosing one loads that chapter rather than scrolling this one.
              bookChapters.map((chapterTitle, index) => (
                <li key={`${index}-${chapterTitle}`}>
                  <button
                    type="button"
                    className="document-reader-chapter-link touch-manipulation"
                    aria-current={index === activeChapterIndex ? 'true' : undefined}
                    onClick={() => {
                      setChapterListOpen(false);
                      onSelectChapter?.(index);
                    }}
                  >
                    {chapterTitle || t('audiobooks.chapterFallback', { number: index + 1 })}
                  </button>
                </li>
              ))
            : chapters.map((entry) => (
                <li key={`${entry.page}-${entry.title}`}>
                  <button
                    type="button"
                    className="document-reader-chapter-link touch-manipulation"
                    onClick={() => {
                      setPageIndex(entry.page);
                      setChapterListOpen(false);
                    }}
                  >
                    {entry.title}
                  </button>
                </li>
              ))}
        </ul>
      ) : null}

      <ol className="document-reader-body" ref={bodyRef}>
        {visible.map((chunk, offset) => {
          const index = (page?.startIndex ?? 0) + offset;
          const active = index === chunkIndex;
          return (
            <li
              key={index}
              ref={active ? activeRef : null}
              className={`document-reader-passage${active ? ' document-reader-passage--active' : ''}`}
            >
              {/* A heading in the source stays a heading here, so the shape of the document survives. */}
              {chunk.isHeading ? (
                <h3 className="document-reader-heading">{chunk.text}</h3>
              ) : (
                <button
                  type="button"
                  className="document-reader-seek touch-manipulation"
                  onClick={() => onSeekToChunk(index)}
                  aria-label={t('audiobooks.readFromHere')}
                >
                  {active ? (
                    <ReadAlongText text={chunk.text} range={range} />
                  ) : (
                    <p className="audiobook-readalong">{chunk.text}</p>
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {/*
        Page turning, pinned under the text. Reading aloud turns pages on its own, so these are for
        a reader who wants to look ahead or back without losing where the voice is.
      */}
      <nav className="document-reader-pager">
        <button
          type="button"
          className="mobile-np-icon-btn touch-manipulation"
          onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
          disabled={pageIndex === 0}
          aria-label={t('audiobooks.previousPage')}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="document-reader-pager-label">
          {pageIndex + 1} / {pages.length}
          {pageIndex !== spokenPage ? ` · ${t('audiobooks.readingOn', {
            page: spokenPage + 1,
          })}` : ''}
        </span>
        <button
          type="button"
          className="mobile-np-icon-btn touch-manipulation"
          onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
          disabled={pageIndex >= pages.length - 1}
          aria-label={t('audiobooks.nextPage')}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </nav>
    </section>
  );
}
