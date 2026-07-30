import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2, Pause, Play, Plus, Square, Trash2 } from 'lucide-react';
import { documentToNarration, estimateNarrationSeconds } from '../../documentNarration';
import type { NarrationChunk } from '../../documentNarration';
import {
  createNarrationReader,
  createWebSpeechPort,
  isNarrationSpeechAvailable,
  type NarrationReader,
  type NarrationReaderState,
  type NarrationSpeechPort,
} from '../../narrationReader';
import {
  createNativeTextToSpeechPort,
  isNativeTextToSpeechAvailable,
} from '../../nativeTextToSpeech';
import { loadPreferredVoiceId } from '../../narrationVoices';
import { epubCoverDataUrl, importEpubBytes, unzipEpub } from '../../epubImport';
import {
  deleteDocument,
  getDocument,
  itemKind,
  listDocuments,
  newDocumentId,
  saveDocument,
  type DocumentSummary,
} from '../../documentLibrary';
import { fetchAudiobookDescription } from '../../audiobookDescription';
import { supportedDocumentFormatLabels } from '../../documentExtract';
import { formatTime } from '../../stations/theme';
import ImportEmptyState from './ImportEmptyState';
import { seedGradient } from '../../seedGradient';
import { useTranslation } from '../../i18n';

const ACCEPTED = '.epub,application/epub+zip';

/** Read off the picker's own accept list, so this shelf states exactly what it will take. */
const FORMAT_LABELS = supportedDocumentFormatLabels(ACCEPTED).join(' · ');
/** Books are bigger than papers; still bounded so a bad file cannot exhaust device memory. */
const MAX_BYTES = 60 * 1024 * 1024;

export interface BookShelfProps {
  onError?: (message: string) => void;
}

/**
 * Uploaded books, read aloud by real chapters.
 *
 * Separate from Documents because the two are not the same thing: a book has an author, a cover,
 * a description and a spine that states its chapter order, while a paper has none of that and its
 * sections have to be inferred from headings. One shelf holding both would have to describe each
 * in the other's terms.
 */
export default function BookShelf({ onError }: BookShelfProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<NarrationReader | null>(null);
  const nativePortRef = useRef<ReturnType<typeof createNativeTextToSpeechPort> | null>(null);

  const [books, setBooks] = useState<DocumentSummary[]>([]);
  const [openBook, setOpenBook] = useState<DocumentSummary | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [chunks, setChunks] = useState<NarrationChunk[]>([]);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [state, setState] = useState<NarrationReaderState>('idle');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void listDocuments().then((all) => setBooks(all.filter((d) => itemKind(d) === 'book')));
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    return () => {
      readerRef.current?.stop();
      nativePortRef.current?.dispose();
      nativePortRef.current = null;
    };
  }, []);

  const buildReader = useCallback(async (next: NarrationChunk[]) => {
    readerRef.current?.stop();
    let port: NarrationSpeechPort;
    if (await isNativeTextToSpeechAvailable()) {
      nativePortRef.current?.dispose();
      nativePortRef.current = createNativeTextToSpeechPort();
      port = nativePortRef.current;
    } else if (isNarrationSpeechAvailable()) {
      port = createWebSpeechPort(
        window.speechSynthesis,
        (text) => new SpeechSynthesisUtterance(text),
      );
    } else {
      return null;
    }
    readerRef.current = createNarrationReader(next, port, {
      voiceId: loadPreferredVoiceId() ?? undefined,
      onChunkChange: (index) => setChunkIndex(index),
      onStateChange: (s) => setState(s),
    });
    return readerRef.current;
  }, []);

  const onImport = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (file.size > MAX_BYTES) {
        onError?.(t('audiobooks.bookTooLarge'));
        return;
      }
      setBusy(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { book, reason } = importEpubBytes(bytes);
        if (!book) {
          // Each failure gets its own message: DRM will never work, a corrupt archive might on
          // re-download, and a mislabelled zip is simply the wrong file.
          onError?.(
            t(
              reason === 'encrypted'
                ? 'audiobooks.bookEncrypted'
                : reason === 'not-an-epub'
                  ? 'audiobooks.bookNotEpub'
                  : 'audiobooks.bookUnreadable',
            ),
          );
          return;
        }
        const files = unzipEpub(bytes);
        const cover = files ? epubCoverDataUrl(files, book.coverHref) : undefined;
        const text = book.chapters.map((c) => c.text).join('\n\n');

        /*
         * The book's own description if it has one, else look it up. An EPUB usually carries
         * title and author but rarely a blurb, and a shelf card with nothing to say is the
         * complaint that started this.
         */
        let description = book.description;
        if (!description && book.title) {
          description = (await fetchAudiobookDescription(book.title, book.author)) ?? '';
        }

        await saveDocument({
          kind: 'book',
          id: newDocumentId(book.title || file.name),
          name: book.title || file.name,
          author: book.author,
          description,
          language: book.language,
          coverUrl: cover,
          addedAt: Date.now(),
          text,
          chapters: book.chapters.map((c) => ({ title: c.title, text: c.text })),
          chunkCount: book.chapters.length,
          estimatedSeconds: estimateNarrationSeconds(documentToNarration(text)),
        });
        refresh();
      } catch {
        onError?.(t('audiobooks.bookUnreadable'));
      } finally {
        setBusy(false);
      }
    },
    [onError, refresh, t],
  );

  const playChapter = useCallback(
    async (summary: DocumentSummary, index: number) => {
      const full = await getDocument(summary.id);
      const chapter = full?.chapters?.[index];
      if (!chapter) {
        onError?.(t('audiobooks.bookUnreadable'));
        return;
      }
      const parsed = documentToNarration(chapter.text);
      setOpenBook(summary);
      setChapterIndex(index);
      setChunks(parsed);
      setChunkIndex(0);
      const reader = await buildReader(parsed);
      if (!reader) {
        onError?.(t('audiobooks.docSpeechUnavailable'));
        return;
      }
      reader.play();
    },
    [buildReader, onError, t],
  );

  const onRemove = useCallback(
    async (summary: DocumentSummary) => {
      if (openBook?.id === summary.id) {
        readerRef.current?.stop();
        setOpenBook(null);
        setChunks([]);
      }
      await deleteDocument(summary.id);
      refresh();
    },
    [openBook, refresh],
  );

  const remaining = estimateNarrationSeconds(chunks.slice(chunkIndex));
  const openChapters = openBook?.chapterTitles ?? [];

  return (
    <section className="podcasts-library-grid-section audiobooks-library-section">
      <div className="flex items-center justify-between gap-3 mb-3 px-1">
        <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
          {t('audiobooks.yourBooksUploaded')}
        </p>
        <div className="flex items-center gap-2">
          {books.length > 0 ? (
            <span className="podcasts-count-badge podcasts-count-badge--inline">{books.length}</span>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => {
              void onImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {/* Head control only once the shelf has rows — see the empty state below. */}
          {books.length > 0 ? (
            <button
              type="button"
              className="audiobook-doc-import touch-manipulation"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              {t('audiobooks.importBook')}
            </button>
          ) : null}
        </div>
      </div>

      {books.length > 0 ? (
        <p className="font-mono text-[10px] text-[var(--text-dim)] px-1 mb-2">
          {t('audiobooks.formatsSupported', { formats: FORMAT_LABELS })}
        </p>
      ) : null}

      {books.length === 0 ? (
        <ImportEmptyState
          icon={<BookOpen className="w-8 h-8 text-accent" />}
          title={t('audiobooks.booksEmptyTitle')}
          lead={t('audiobooks.booksEmptyLead')}
          formatsLine={t('audiobooks.formatsSupported', { formats: FORMAT_LABELS })}
          hints={[
            // Both failures are ones the importer already reports after the fact; saying them
            // first saves a download that was never going to open.
            t('audiobooks.booksEmptyDrmHint'),
            t('audiobooks.booksEmptyOtherFormatsHint'),
          ]}
          actionLabel={t('audiobooks.importBookAction')}
          onAction={() => fileInputRef.current?.click()}
          busy={busy}
        />
      ) : (
        <ul className="audiobook-doc-list">
          {books.map((book) => (
            <li key={book.id} className="audiobook-doc-row">
              <button
                type="button"
                className="audiobook-doc-open touch-manipulation"
                onClick={() => void playChapter(book, 0)}
              >
                <span className="audiobook-book-cover">
                  {book.coverUrl ? (
                    <img src={book.coverUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span
                      className="block w-full h-full"
                      style={{ background: seedGradient(book.name) }}
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="audiobook-doc-name">{book.name}</span>
                  {book.author ? (
                    <span className="audiobook-doc-meta">{book.author}</span>
                  ) : null}
                  <span className="audiobook-doc-meta">
                    {t('audiobooks.chaptersCount', { count: book.chapterTitles?.length ?? 0 })}
                    {book.estimatedSeconds > 0 ? ` · ${formatTime(book.estimatedSeconds)}` : ''}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="audiobook-doc-remove touch-manipulation"
                onClick={() => void onRemove(book)}
                aria-label={t('audiobooks.docRemove')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {openBook ? (
        <div className="audiobook-doc-now mt-3">
          <p className="audiobook-doc-name">{openBook.name}</p>
          <p className="audiobook-doc-section">
            {openChapters[chapterIndex] ?? `${chapterIndex + 1}`}
          </p>
          <p className="audiobook-doc-meta">
            {t('audiobooks.docPosition', { index: chunkIndex + 1, total: chunks.length })}
            {remaining > 0 ? ` · ${formatTime(remaining)} ${t('audiobooks.docLeft')}` : ''}
          </p>
          <div className="flex items-center gap-2 mt-2">
            {state === 'speaking' ? (
              <button
                type="button"
                className="mobile-np-icon-btn touch-manipulation"
                onClick={() => readerRef.current?.pause()}
                aria-label={t('player.pause')}
              >
                <Pause className="w-5 h-5" />
              </button>
            ) : (
              <button
                type="button"
                className="mobile-np-icon-btn touch-manipulation"
                onClick={() => {
                  if (state === 'paused') readerRef.current?.resume();
                  else void buildReader(chunks).then((r) => r?.play());
                }}
                aria-label={t('player.play')}
              >
                <Play className="w-5 h-5" />
              </button>
            )}
            <button
              type="button"
              className="mobile-np-icon-btn touch-manipulation"
              onClick={() => readerRef.current?.stop()}
              aria-label={t('audiobooks.docStop')}
            >
              <Square className="w-5 h-5" />
            </button>
          </div>

          {/* The spine gives real chapters, so this is a chapter list rather than a guess. */}
          {openChapters.length > 1 ? (
            <ul className="audiobook-book-chapters mt-3">
              {openChapters.map((title, i) => (
                <li key={`${title}-${i}`}>
                  <button
                    type="button"
                    className={`audiobook-book-chapter touch-manipulation${
                      i === chapterIndex ? ' is-active' : ''
                    }`}
                    onClick={() => void playChapter(openBook, i)}
                  >
                    <BookOpen className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
