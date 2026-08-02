import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  Plus,
  Server,
  Square,
  Trash2,
} from 'lucide-react';
import { documentToNarration, estimateNarrationSeconds } from '../../documentNarration';
import type { NarrationChunk } from '../../documentNarration';
import ReadAlongText, { type ReadAlongRange } from './ReadAlongText';
import { chunkForOffset, offsetForChunk, resumeOffset } from '../../narrationPosition';
import { readKindleFileInfo } from '../../mobiFormat';
import { importKindleFile, readKindleCover } from '../../kindleImport';
import { createNarrationEngine, type NarrationEngine } from '../../narrationEngine';
import type { ParsedEpub } from '../../epubParse';
import {
  clearNarrationPlayback,
  publishNarrationPlayback,
  requestNarrationPlayerOpen,
} from '../../narrationPlayback';
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
import { epubCoverDataUrl, importEpubBytes, unzipEpub, type EpubImportFailure } from '../../epubImport';
import {
  deleteDocument,
  getDocument,
  itemKind,
  listDocuments,
  newDocumentId,
  saveDocument,
  saveReadingPosition,
  shouldPersistReadingPosition,
  type DocumentSummary,
  type ReadingPosition,
} from '../../documentLibrary';
import {
  describeSkippedFormats,
  directoryPickerSupport,
  planCalibreLibraryFiles,
  type CalibreImportPlan,
  type DirectoryPickerSupport,
} from '../../calibreImportPlan';
import type { CalibreBookCandidate } from '../../calibreLibrary';
import { getPlatform } from '../../platformEnv';
import { fetchAudiobookDescription } from '../../audiobookDescription';
import { supportedDocumentFormatLabels } from '../../documentExtract';
import { formatTime } from '../../stations/theme';
import ImportEmptyState from './ImportEmptyState';
import CalibreWebPanel from './CalibreWebPanel';
import NarrationVoicePicker from './NarrationVoicePicker';
import { useNarrationVoices } from './useNarrationVoices';
import { seedGradient } from '../../seedGradient';
import { useTranslation } from '../../i18n';

const ACCEPTED = '.epub,application/epub+zip';

/** Read off the picker's own accept list, so this shelf states exactly what it will take. */
const FORMAT_LABELS = supportedDocumentFormatLabels(ACCEPTED).join(' · ');
/** Books are bigger than papers; still bounded so a bad file cannot exhaust device memory. */
const MAX_BYTES = 60 * 1024 * 1024;

/*
 * `webkitdirectory` is not in React's attribute types, and setting it on the element afterwards is
 * too late — Chromium reads it when the input is created. Spread as attributes rather than casting
 * the whole element, so every other prop on that input stays type-checked.
 */
const DIRECTORY_ATTRS = {
  webkitdirectory: '',
} as unknown as React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Give up on a library import after this many books fail in a row.
 *
 * One unreadable book in four thousand is normal and must not stop the rest. A run of them is a
 * different failure: a full storage quota rejects every remaining book identically, and grinding
 * through 3,900 more to discover that wastes minutes and then reports the wrong problem.
 */
const CALIBRE_FAILURE_RUN_LIMIT = 5;

/** Everything that can stop one book being imported. */
type BookImportFailure =
  | 'too-large'
  | 'kindle-drm'
  | 'kindle-unreadable'
  | 'kfx-unsupported'
  | EpubImportFailure;

/**
 * Each failure gets its own message: DRM will never work, a corrupt archive might on re-download,
 * a mislabelled zip is simply the wrong file, and an oversized one is none of those.
 */
function bookFailureKey(reason: BookImportFailure): string {
  if (reason === 'too-large') return 'audiobooks.bookTooLarge';
  // Kindle files fail for reasons of their own, and lumping them under "unreadable" tells a reader
  // to re-download a file that will never open however many times they fetch it.
  if (reason === 'kindle-drm') return 'audiobooks.bookKindleDrm';
  if (reason === 'kfx-unsupported') return 'audiobooks.bookKfxUnsupported';
  if (reason === 'kindle-unreadable') return 'audiobooks.bookKindleUnreadable';
  if (reason === 'encrypted') return 'audiobooks.bookEncrypted';
  if (reason === 'not-an-epub') return 'audiobooks.bookNotEpub';
  return 'audiobooks.bookUnreadable';
}

/** Calibre keeps a cover.jpg beside each book, which is often better than the one inside the EPUB. */
function readFileAsDataUrl(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
    // A cover that will not decode is not worth failing an import over.
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

export interface BookShelfProps {
  onError?: (message: string) => void;
  /** Needed because a library import is the one action here whose success is not self-evident. */
  onSuccess?: (message: string) => void;
}

/**
 * Uploaded books, read aloud by real chapters.
 *
 * Separate from Documents because the two are not the same thing: a book has an author, a cover,
 * a description and a spine that states its chapter order, while a paper has none of that and its
 * sections have to be inferred from headings. One shelf holding both would have to describe each
 * in the other's terms.
 *
 * Two ways in, because importing one book and importing a Calibre library are not the same job. A
 * library is picked as a folder, planned, and shown to the listener before anything is written —
 * a shelf that silently does something to four thousand books is not a shelf anyone can trust.
 */
export default function BookShelf({ onError, onSuccess }: BookShelfProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<NarrationReader | null>(null);
  /** The chosen engine, held so its plugin listeners can be detached when it is replaced. */
  const enginePortRef = useRef<NarrationEngine | null>(null);

  const [books, setBooks] = useState<DocumentSummary[]>([]);
  const [openBook, setOpenBook] = useState<DocumentSummary | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [chunks, setChunks] = useState<NarrationChunk[]>([]);
  // rememberPosition runs from a speech callback, so it needs the chunks without a dependency.
  const chunksRef = useRef<NarrationChunk[]>([]);
  chunksRef.current = chunks;
  const [chunkIndex, setChunkIndex] = useState(0);
  // Where the voice is inside the current chunk, when the engine reports it.
  const [range, setRange] = useState<ReadAlongRange | null>(null);
  const chunkIndexRef = useRef(0);
  const [state, setState] = useState<NarrationReaderState>('idle');
  const [busy, setBusy] = useState(false);
  const { voices, voiceId, chooseVoice, speechAvailable } = useNarrationVoices();

  const [plan, setPlan] = useState<CalibreImportPlan | null>(null);
  const [libraryProgress, setLibraryProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  /*
   * The picked File objects, keyed by the same path the plan carries. The plan is paths only, and a
   * File cannot be re-derived from a path — the browser gives no way back to a file it already
   * handed over — so the handles have to be kept from the pick until the import runs.
   */
  const libraryFilesRef = useRef<Map<string, File>>(new Map());
  const libraryCancelRef = useRef(false);

  /*
   * Read once. A folder picker either exists on this platform or it does not, and the answer cannot
   * change while the shelf is mounted.
   */
  const [directorySupport] = useState<DirectoryPickerSupport>(() =>
    directoryPickerSupport({
      platform: getPlatform(),
      hasWebkitDirectory:
        typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input'),
    }),
  );

  /*
   * The narration callbacks are built once per reader and outlive the render that made them, so what
   * they need is held in refs. Reading state through the closure instead would persist the position
   * of whichever book was open when that reader was created.
   */
  const openBookRef = useRef<DocumentSummary | null>(null);
  const chapterIndexRef = useRef(0);
  const positionRef = useRef<ReadingPosition | null>(null);
  const playChapterRef = useRef<
    ((book: DocumentSummary, index: number, startChunk?: number) => Promise<void>) | null
  >(null);

  const refresh = useCallback(() => {
    void listDocuments().then((all) => setBooks(all.filter((d) => itemKind(d) === 'book')));
  }, []);

  useEffect(refresh, [refresh]);

  // Audio outliving the screen that started it is its own bug.
  useEffect(() => {
    return () => {
      readerRef.current?.stop();
      clearNarrationPlayback();
      enginePortRef.current?.dispose?.();
      enginePortRef.current = null;
    };
  }, []);

  const rememberPosition = useCallback((chunk: number) => {
    const book = openBookRef.current;
    if (!book) return;
    const next: ReadingPosition = {
      chapterIndex: chapterIndexRef.current,
      chunkIndex: chunk,
      // The offset is the position that means something; the index is kept for older readers.
      charOffset: offsetForChunk(chunksRef.current, chunk),
      updatedAt: Date.now(),
    };
    if (!shouldPersistReadingPosition(positionRef.current, next)) return;
    positionRef.current = next;
    void saveReadingPosition(book.id, next);
    // The card is patched in place rather than re-listed: re-reading the store would pull every
    // book's record back out mid-narration to change one number.
    setBooks((all) => all.map((b) => (b.id === book.id ? { ...b, position: next } : b)));
  }, []);

  /**
   * Roll straight into the next chapter.
   *
   * A chapter ending is not the book ending. Without this the listener has to pick the next chapter
   * by hand every twenty minutes, which is the one thing a ten-hour book cannot ask of them.
   */
  const advanceChapter = useCallback(() => {
    const book = openBookRef.current;
    if (!book) return;
    const next = chapterIndexRef.current + 1;
    if (next >= (book.chapterTitles?.length ?? 0)) return;
    void playChapterRef.current?.(book, next);
  }, []);

  const buildReader = useCallback(
    async (next: NarrationChunk[], startIndex: number) => {
      readerRef.current?.stop();
      // Best available voice, neural first. See narrationEngine.ts for the order and why.
      enginePortRef.current?.dispose?.();
      const engine = await createNarrationEngine();
      enginePortRef.current = engine;
      if (!engine) return null;
      const port: NarrationSpeechPort = engine.port;
      readerRef.current = createNarrationReader(next, port, {
        startIndex,
        voiceId: voiceId || undefined,
        onChunkChange: (index) => {
          chunkIndexRef.current = index;
          setChunkIndex(index);
          rememberPosition(index);
          // A stale word left marked on a new passage reads as the wrong word entirely.
          setRange(null);
        },
        onRange: (index, start, end) => {
          // Ranges are asynchronous; one arriving after the reader has moved on belongs to the
          // passage we have left, not the one on screen. Read through a ref rather than a state
          // updater, which must stay pure.
          if (index !== chunkIndexRef.current) return;
          setRange({ start, end });
        },
        onStateChange: (s) => {
          setState(s);
          if (s !== 'speaking') setRange(null);
          if (s === 'finished') advanceChapter();
        },
      });
      return readerRef.current;
    },
    [advanceChapter, rememberPosition, voiceId],
  );

  /**
   * One EPUB onto the shelf.
   *
   * Shared by the single-file picker and the library import, so a book imported either way ends up
   * described identically. Returns the reason rather than reporting it: a library import counts
   * failures and speaks once at the end, where forty toasts would be unusable.
   */
  /**
   * Write a parsed book to the shelf, whatever format it arrived in.
   *
   * By this point an EPUB and a Kindle book are the same thing: a title, an author and chapters.
   * The saving, the blurb lookup and the Calibre fallbacks belong in one place rather than being
   * written twice and drifting apart.
   */
  const saveImportedBook = useCallback(
    async (
      book: ParsedEpub,
      file: File,
      cover: string | undefined,
      options?: { calibre?: CalibreBookCandidate; lookUpDescription?: boolean },
    ): Promise<null> => {
      const text = book.chapters.map((c) => c.text).join('\n\n');
      /*
       * The book's own metadata wins over the folder it came from. Calibre's folder names are
       * accurate but truncated, and its filenames are truncated harder, so the file itself is the
       * only place a full title is guaranteed intact.
       */
      const title = book.title || options?.calibre?.title || file.name;
      const author = book.author || options?.calibre?.author;

      /*
       * Off for a library import: four thousand books would be four thousand network lookups for a
       * folder the listener picked once, and Calibre users have already curated their metadata.
       */
      let description = book.description;
      if (!description && options?.lookUpDescription && title) {
        description = (await fetchAudiobookDescription(title, author)) ?? '';
      }

      await saveDocument({
        kind: 'book',
        id: newDocumentId(title),
        name: title,
        author,
        description,
        language: book.language,
        coverUrl: cover,
        calibreId: options?.calibre?.calibreId,
        addedAt: Date.now(),
        text,
        chapters: book.chapters.map((c) => ({ title: c.title, text: c.text })),
        chunkCount: book.chapters.length,
        estimatedSeconds: estimateNarrationSeconds(documentToNarration(text)),
      });
      return null;
    },
    [],
  );

  const importBookFile = useCallback(
    async (
      file: File,
      options?: {
        calibre?: CalibreBookCandidate;
        coverFile?: File;
        lookUpDescription?: boolean;
      },
    ): Promise<BookImportFailure | null> => {
      if (file.size > MAX_BYTES) return 'too-large';
      /*
       * Kindle files are not EPUBs and must not be handed to the EPUB reader, which would report
       * them as corrupt archives. Only the head is read: identifying the format and spotting DRM
       * needs the headers, and a twenty megabyte book read whole into a WebView costs far more
       * than twenty megabytes once it is a string and an array at the same time.
       */
      const head = await file.slice(0, 8192).arrayBuffer();
      const kindle = readKindleFileInfo(head);
      if (kindle.format === 'kfx') return 'kfx-unsupported';
      if (kindle.format === 'mobi' || kindle.format === 'azw3') {
        const imported = await importKindleFile(file);
        if (!imported.book) return imported.reason ?? 'kindle-unreadable';
        const cover =
          (await readKindleCover(file)) ??
          (options?.coverFile ? await readFileAsDataUrl(options.coverFile) : undefined);
        return await saveImportedBook(imported.book, file, cover, options);
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { book, reason } = importEpubBytes(bytes);
        if (!book) return reason ?? 'unreadable';

        const files = unzipEpub(bytes);
        let cover = files ? epubCoverDataUrl(files, book.coverHref) : undefined;
        // Calibre's own cover only when the archive has none — it is a fallback, not an override.
        if (!cover && options?.coverFile) cover = await readFileAsDataUrl(options.coverFile);

        return await saveImportedBook(book, file, cover, options);
      } catch {
        return 'unreadable';
      }
    },
    [],
  );

  const onImport = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      try {
        const reason = await importBookFile(file, { lookUpDescription: true });
        if (reason) {
          onError?.(t(bookFailureKey(reason)));
          return;
        }
        refresh();
      } finally {
        setBusy(false);
      }
    },
    [importBookFile, onError, refresh, t],
  );

  /**
   * Plan a picked folder, and show it. Nothing is written here.
   *
   * The plan is what the confirmation step renders, so the counts a listener approves are the same
   * numbers the import loop then walks — there is no second traversal that could disagree.
   */
  /** Whether the calibre-web panel is open. Its own settings live in calibreWeb.ts. */
  const [calibreWebOpen, setCalibreWebOpen] = useState(false);

  /**
   * Import a book fetched from calibre-web.
   *
   * Goes through importBookFile, the same path a picked file takes, so a downloaded book is
   * read, covered, paginated and narrated identically. A second route here would be a second
   * set of bugs.
   */
  const onImportCalibreFile = useCallback(
    async (file: File) => {
      const reason = await importBookFile(file, { lookUpDescription: true });
      if (reason) {
        onError?.(t(bookFailureKey(reason)));
        return;
      }
      refresh();
    },
    [importBookFile, onError, refresh, t],
  );
  const onPickLibrary = useCallback(
    (picked: FileList | null) => {
      const files = picked ? [...picked] : [];
      const next = planCalibreLibraryFiles(
        files,
        books.map((b) => ({ calibreId: b.calibreId, name: b.name, author: b.author })),
      );
      if (next.books.length === 0) {
        onError?.(t('audiobooks.calibreNoBooks'));
        return;
      }
      libraryFilesRef.current = new Map(files.map((f) => [f.webkitRelativePath || f.name, f]));
      // Shown even when nothing is importable: "412 books, none readable here (mobi)" is the answer
      // to what happened, and a folder that quietly produces no shelf entries is not.
      setPlan(next);
    },
    [books, onError, t],
  );

  const closePlan = useCallback(() => {
    setPlan(null);
    // Thousands of File handles pin their sources open; dropping them is not just tidiness.
    libraryFilesRef.current = new Map();
  }, []);

  const runLibraryImport = useCallback(async () => {
    if (!plan) return;
    libraryCancelRef.current = false;
    const total = plan.fresh.length;
    setLibraryProgress({ done: 0, total });
    let imported = 0;
    let failed = 0;
    let failureRun = 0;
    for (const candidate of plan.fresh) {
      if (libraryCancelRef.current) break;
      setLibraryProgress({ done: imported + failed, total });
      const file = libraryFilesRef.current.get(candidate.path);
      const coverFile = candidate.coverPath
        ? libraryFilesRef.current.get(candidate.coverPath)
        : undefined;
      const reason = file
        ? await importBookFile(file, { calibre: candidate, coverFile })
        : 'unreadable';
      if (reason) {
        failed += 1;
        failureRun += 1;
      } else {
        imported += 1;
        failureRun = 0;
      }
      if (failureRun >= CALIBRE_FAILURE_RUN_LIMIT) break;
      // Yield between books so the progress line actually paints. Without it a four-thousand-book
      // loop is one enormous task and the app looks frozen for the whole import.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    setLibraryProgress(null);
    closePlan();
    refresh();
    if (imported > 0) onSuccess?.(t('audiobooks.calibreImported', { count: imported }));
    if (failed > 0) onError?.(t('audiobooks.calibreImportFailures', { count: failed }));
  }, [closePlan, importBookFile, onError, onSuccess, plan, refresh, t]);

  const playChapter = useCallback(
    async (
      summary: DocumentSummary,
      index: number,
      startChunk = 0,
      resume?: { charOffset?: number },
    ) => {
      const full = await getDocument(summary.id);
      const chapter = full?.chapters?.[index];
      if (!chapter) {
        onError?.(t('audiobooks.bookUnreadable'));
        return;
      }
      const parsed = documentToNarration(chapter.text);
      // The offset wins where there is one, because it is the position that survived re-chunking.
      const resolved =
        resume?.charOffset !== undefined
          ? chunkForOffset(parsed, resume.charOffset)
          : startChunk;
      const start = Math.min(Math.max(0, resolved), Math.max(0, parsed.length - 1));
      openBookRef.current = summary;
      chapterIndexRef.current = index;
      positionRef.current = full.position ?? null;
      setOpenBook(summary);
      setChapterIndex(index);
      setChunks(parsed);
      setChunkIndex(start);
      const reader = await buildReader(parsed, start);
      if (!reader) {
        onError?.(t('audiobooks.docSpeechUnavailable'));
        return;
      }
      reader.play();
    },
    [buildReader, onError, t],
  );

  // Held in a ref so the reader's own end-of-chapter callback can reach it without the two forming
  // a dependency cycle.
  useEffect(() => {
    playChapterRef.current = playChapter;
  }, [playChapter]);

  /** Tapping a book resumes it. Starting a ten-hour book over is the failure this exists to avoid. */
  const openFromShelf = useCallback(
    (book: DocumentSummary) => {
      const chapters = book.chapterTitles?.length ?? 1;
      const at = book.position;
      // A stored chapter can outlive the book it belonged to if the same title was re-imported.
      const chapter = Math.min(Math.max(0, at?.chapterIndex ?? 0), Math.max(0, chapters - 1));
      /*
       * Hand playChapter the offset rather than a chunk index. It parses the chapter anyway, and
       * the index is only correct if the chunker has not changed since the position was saved --
       * which it is re-run on every open precisely so that it can.
       */
      return playChapter(book, chapter, at?.chunkIndex ?? 0, {
        charOffset:
          at?.charOffset !== undefined
            ? resumeOffset(at.charOffset, at.updatedAt)
            : undefined,
      });
    },
    [playChapter],
  );

  const onRemove = useCallback(
    async (summary: DocumentSummary) => {
      if (openBook?.id === summary.id) {
        readerRef.current?.stop();
        openBookRef.current = null;
        setOpenBook(null);
        setChunks([]);
      }
      await deleteDocument(summary.id);
      refresh();
    },
    [openBook, refresh],
  );

  /**
   * Hand the player everything it needs to paint this book.
   *
   * Chapter title rather than section: a book's passage sits under a chapter, and that is the line
   * a reader recognises when the player is all they can see.
   */
  useEffect(() => {
    if (!openBook || chunks.length === 0) {
      clearNarrationPlayback(openBook?.id);
      return;
    }
    publishNarrationPlayback({
      title: openBook.name,
      author: openBook.author,
      artworkUrl: openBook.coverUrl,
      sourceId: openBook.id,
      kind: 'book',
      passage: chunks[chunkIndex]?.text ?? '',
      section: openBook.chapterTitles?.[chapterIndex],
      range,
      state,
      chunkIndex,
      chunkCount: chunks.length,
      elapsedSeconds: estimateNarrationSeconds(chunks.slice(0, chunkIndex)),
      totalSeconds: estimateNarrationSeconds(chunks),
      controls: {
        play: () => {
          if (state === 'paused') readerRef.current?.resume();
          else void buildReader(chunks, chunkIndexRef.current).then((r) => r?.play());
        },
        pause: () => readerRef.current?.pause(),
        stop: () => readerRef.current?.stop(),
        seekToChunk: (index) => readerRef.current?.seekToChunk(index),
      },
    });
  }, [openBook, chunks, chunkIndex, chapterIndex, range, state, buildReader]);

  const remaining = estimateNarrationSeconds(chunks.slice(chunkIndex));
  const openChapters = openBook?.chapterTitles ?? [];
  const canPickFolder = directorySupport === 'supported';
  const importing = libraryProgress !== null;

  /** Named once so the head control and the empty state cannot describe the same limit differently. */
  const libraryHint =
    directorySupport === 'no-folder-picker-on-mobile'
      ? t('audiobooks.calibreMobileUnavailable')
      : canPickFolder
        ? t('audiobooks.calibreEmptyHint')
        : null;

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
          {/*
            A folder picker rather than a multi-select: a Calibre library's author and title live in
            its directory names, and a multi-select hands back files stripped of the folders that
            carry them. Only rendered where the platform can actually supply a directory.
          */}
          {canPickFolder ? (
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              {...DIRECTORY_ATTRS}
              onChange={(e) => {
                onPickLibrary(e.target.files);
                e.target.value = '';
              }}
            />
          ) : null}
          {/* Head controls only once the shelf has rows — see the empty state below. */}
          {books.length > 0 ? (
            <>
              {canPickFolder ? (
                <button
                  type="button"
                  className="audiobook-doc-import touch-manipulation"
                  onClick={() => folderInputRef.current?.click()}
                  disabled={busy || importing}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  {t('audiobooks.calibreImport')}
                </button>
              ) : null}
              {/* A Calibre library that is not on this device: calibre-web serves it over OPDS. */}
              <button
                type="button"
                className="audiobook-doc-import touch-manipulation"
                onClick={() => setCalibreWebOpen((v) => !v)}
                disabled={busy || importing}
                aria-expanded={calibreWebOpen}
              >
                <Server className="w-3.5 h-3.5" />
                {t('audiobooks.calibreWebOpen')}
              </button>
              <button
                type="button"
                className="audiobook-doc-import touch-manipulation"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || importing}
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                {t('audiobooks.importBook')}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {calibreWebOpen ? (
        <CalibreWebPanel
          onImportFile={onImportCalibreFile}
          onClose={() => setCalibreWebOpen(false)}
          onError={onError}
        />
      ) : null}

      {books.length > 0 ? (
        <p className="font-mono text-[10px] text-[var(--text-dim)] px-1 mb-2">
          {t('audiobooks.formatsSupported', { formats: FORMAT_LABELS })}
        </p>
      ) : null}

      <NarrationVoicePicker voices={voices} voiceId={voiceId} onChange={chooseVoice} />

      {/*
        What the plan found, before anything is written. An import that silently does something to a
        four-thousand-book library gives the listener no way to tell it went wrong.
      */}
      {plan ? (
        <div className="audiobook-doc-now mt-3 mb-3">
          <p className="audiobook-doc-name">
            {plan.libraryName || t('audiobooks.calibrePlanUnnamedLibrary')}
          </p>
          <p className="audiobook-doc-section">
            {t('audiobooks.calibrePlanFound', { count: plan.readable.length })}
          </p>
          {plan.duplicateCount > 0 ? (
            <p className="audiobook-doc-meta">
              {t('audiobooks.calibrePlanAlready', { count: plan.duplicateCount })}
            </p>
          ) : null}
          {plan.skippedCount > 0 ? (
            <p className="audiobook-doc-meta">
              {t('audiobooks.calibrePlanSkipped', {
                count: plan.skippedCount,
                formats: describeSkippedFormats(plan.skipped),
              })}
            </p>
          ) : null}
          <p className="audiobook-doc-meta">{t('audiobooks.calibrePlanStorageNote')}</p>

          {importing ? (
            <div className="flex items-center gap-2 mt-2">
              <p className="audiobook-doc-meta" aria-live="polite">
                {t('audiobooks.calibreImporting', {
                  done: Math.min(libraryProgress.done + 1, libraryProgress.total),
                  total: libraryProgress.total,
                })}
              </p>
              <button
                type="button"
                className="audiobook-doc-import touch-manipulation"
                onClick={() => {
                  // Checked between books, so the one in flight still finishes and lands whole.
                  libraryCancelRef.current = true;
                }}
              >
                {t('audiobooks.calibreStop')}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-2">
              {plan.fresh.length > 0 ? (
                <button
                  type="button"
                  className="audiobook-doc-import touch-manipulation"
                  onClick={() => void runLibraryImport()}
                >
                  {t('audiobooks.calibrePlanConfirm', { count: plan.fresh.length })}
                </button>
              ) : (
                <p className="audiobook-doc-meta">{t('audiobooks.calibreNothingNew')}</p>
              )}
              <button
                type="button"
                className="audiobook-doc-import touch-manipulation"
                onClick={closePlan}
              >
                {t('audiobooks.calibrePlanCancel')}
              </button>
            </div>
          )}
        </div>
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
            // Says what this shelf can do with a whole library, or why it cannot here.
            libraryHint,
            speechAvailable === false ? t('audiobooks.docSpeechUnavailable') : null,
          ]}
          actionLabel={t('audiobooks.importBookAction')}
          onAction={() => fileInputRef.current?.click()}
          secondaryActionLabel={canPickFolder ? t('audiobooks.calibreImportAction') : undefined}
          onSecondaryAction={canPickFolder ? () => folderInputRef.current?.click() : undefined}
          busy={busy}
          disabled={speechAvailable === false}
        />
      ) : (
        <ul className="audiobook-doc-list">
          {books.map((book) => (
            <li key={book.id} className="audiobook-doc-row">
              <button
                type="button"
                className="audiobook-doc-open touch-manipulation"
                onClick={() => void openFromShelf(book)}
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
                  {/* Only once there is a place to go back to; "resume at the start" is noise. */}
                  {book.position && (book.position.chapterIndex > 0 || book.position.chunkIndex > 0) ? (
                    <span className="audiobook-doc-section">
                      {t('audiobooks.bookResume', {
                        chapter:
                          book.chapterTitles?.[book.position.chapterIndex] ??
                          String(book.position.chapterIndex + 1),
                      })}
                    </span>
                  ) : null}
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
          {chunks[chunkIndex] ? (
            <ReadAlongText text={chunks[chunkIndex]!.text} range={range} />
          ) : null}
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
                  // Pressing play raises the player, the same as tapping a track does.
                  requestNarrationPlayerOpen();
                  if (state === 'paused') readerRef.current?.resume();
                  // Resumes at the current chunk, not the top of the chapter — stopping and
                  // starting again should not re-read twenty minutes you already heard.
                  else void buildReader(chunks, chunkIndex).then((r) => r?.play());
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
