/**
 * Reading, as its own thing rather than a step on the way to narration.
 *
 * Documents could be imported and spoken aloud, and there was nowhere to simply read one. This is
 * that place, and it is where the translation pane lives: the two are the same activity, and a
 * language you are learning is read far more slowly than it is listened to.
 *
 * Position is the document's own, shared with narration, so putting a book down here and picking it
 * up as speech resumes in the same paragraph. The chunking is documentToNarration for exactly that
 * reason — one idea of where a passage begins, whichever way it is being consumed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Columns2, Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import {
  getDocument,
  listDocuments,
  saveReadingPosition,
  type DocumentSummary,
  type SavedDocument,
} from '../documentLibrary';
import { documentToNarration } from '../documentNarration';
import SideBySideReader from '../components/SideBySideReader';
import { chunkIndexForOffset } from '../translationLazy';
import { normalizeLanguage, type TranslationEngine } from '../translationProvider';
import {
  createBergamotEngine,
  loadInstalledPairs,
  targetsForLanguage,
} from '../bergamotEngine';

/**
 * The engine, built once and never given a runtime here.
 *
 * loadRuntime throws until a real Bergamot build is wired in, which the provider reports as a
 * retryable failure and the pane shows as a sentence. That is the honest state: the pairs are
 * listed, the plumbing works, and no model has been shipped yet.
 */
function buildEngine(): TranslationEngine {
  return createBergamotEngine({
    loadRuntime: async () => {
      throw new Error('No language pack installed yet');
    },
    readInstalled: loadInstalledPairs,
  });
}

export default function ReadingView() {
  const { t } = useTranslation();
  const [books, setBooks] = useState<DocumentSummary[]>([]);
  const [open, setOpen] = useState<SavedDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [target, setTarget] = useState<string>('');
  const engine = useMemo(buildEngine, []);

  useEffect(() => {
    void (async () => setBooks(await listDocuments()))();
  }, []);

  const passages = useMemo(() => {
    if (!open) return [] as string[];
    // The chapters an EPUB declared, or the whole text where it declared none.
    const source = open.chapters?.length
      ? open.chapters.map((chapter) => `${chapter.title}\n\n${chapter.text}`).join('\n\n')
      : open.text;
    return documentToNarration(source).map((chunk) => chunk.text);
  }, [open]);

  const from = normalizeLanguage(open?.language) || 'en';
  const targets = useMemo(() => targetsForLanguage(from), [from]);

  const openBook = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const doc = await getDocument(id);
      setOpen(doc);
      if (doc) {
        /*
         * charOffset decides where to land, not the stored chunk index. Documents are re-chunked on
         * open so improved chunking reaches old imports, which means a stored index can point at
         * different text than it did when it was written.
         */
        const chunks = documentToNarration(
          doc.chapters?.length
            ? doc.chapters.map((c) => `${c.title}\n\n${c.text}`).join('\n\n')
            : doc.text,
        );
        setIndex(
          chunkIndexForOffset(
            chunks.map((c) => c.text.length),
            doc.position?.charOffset,
            doc.position?.chunkIndex ?? 0,
          ),
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Position is written as it moves, so closing the window is not a way to lose your place.
  useEffect(() => {
    if (!open) return;
    const charOffset = passages
      .slice(0, index)
      .reduce((sum, text) => sum + text.length, 0);
    void saveReadingPosition(open.id, {
      chapterIndex: open.position?.chapterIndex ?? 0,
      chunkIndex: index,
      charOffset,
      updatedAt: Date.now(),
    });
  }, [open, index, passages]);

  const step = useCallback(
    (by: number) => setIndex((current) => Math.min(passages.length - 1, Math.max(0, current + by))),
    [passages.length],
  );

  if (!open) {
    return (
      <section className="reading-view" aria-label={t('reading.title')}>
        <header className="reading-head">
          <h1 className="reading-title">{t('reading.title')}</h1>
          <p className="ui-hint">{t('reading.lead')}</p>
        </header>

        {books.length === 0 ? (
          <p className="ui-hint">{t('reading.empty')}</p>
        ) : (
          <ul className="reading-shelf">
            {books.map((book) => (
              <li key={book.id}>
                <button
                  type="button"
                  className="reading-book touch-manipulation"
                  onClick={() => void openBook(book.id)}
                >
                  <BookOpen className="w-4 h-4 shrink-0" aria-hidden />
                  <span className="reading-book-title">{book.name}</span>
                  {book.author ? (
                    <span className="ui-hint reading-book-author">{book.author}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="reading-view" aria-label={t('reading.title')}>
      <header className="reading-bar">
        <button
          type="button"
          className="reading-back touch-manipulation"
          onClick={() => setOpen(null)}
        >
          <ChevronLeft className="w-4 h-4" aria-hidden />
          {t('reading.shelf')}
        </button>
        <span className="reading-open-title">{open.name}</span>

        {/* Offered only where a pack could exist for this book's language — a control that can
            only ever fail is worse than no control. */}
        {targets.length > 0 ? (
          <div className="reading-translate">
            <select
              className="reading-target"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setShowTranslation(Boolean(e.target.value));
              }}
              aria-label={t('reading.translateTo')}
            >
              <option value="">{t('reading.noTranslation')}</option>
              {targets.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <Columns2 className="w-3.5 h-3.5" aria-hidden />
          </div>
        ) : null}
      </header>

      {loading ? (
        <p className="ui-hint">
          <Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1.5" aria-hidden />
          {t('reading.opening')}
        </p>
      ) : showTranslation && target ? (
        <SideBySideReader
          passages={passages}
          from={from}
          to={target}
          engine={engine}
          index={index}
          onIndexChange={setIndex}
        />
      ) : (
        <ol className="reading-passages">
          {passages.map((text, i) => (
            <li
              className={`reading-passage${i === index ? ' reading-passage--here' : ''}`}
              key={i}
              onClick={() => setIndex(i)}
            >
              {text}
            </li>
          ))}
        </ol>
      )}

      <footer className="reading-foot">
        <button
          type="button"
          className="reading-step touch-manipulation"
          onClick={() => step(-1)}
          disabled={index <= 0}
          aria-label={t('reading.previous')}
        >
          <ChevronLeft className="w-4 h-4" aria-hidden />
        </button>
        <span className="ui-hint reading-progress">
          {t('reading.progress', { index: index + 1, total: passages.length })}
        </span>
        <button
          type="button"
          className="reading-step touch-manipulation"
          onClick={() => step(1)}
          disabled={index >= passages.length - 1}
          aria-label={t('reading.next')}
        >
          <ChevronRight className="w-4 h-4" aria-hidden />
        </button>
      </footer>
    </section>
  );
}
