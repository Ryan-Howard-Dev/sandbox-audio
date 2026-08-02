import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Link2, Loader2, Pause, Play, Plus, Square, Trash2 } from 'lucide-react';
import { documentToNarration, estimateNarrationSeconds } from '../../documentNarration';
import {
  extractDocumentText,
  supportedDocumentFormatLabels,
  SUPPORTED_DOCUMENT_ACCEPT,
} from '../../documentExtract';
import type { NarrationChunk } from '../../documentNarration';
import { type ReadAlongRange } from './ReadAlongText';
import DocumentReaderView from './DocumentReaderView';
import { createNarrationEngine, type NarrationEngine } from '../../narrationEngine';
import { importWebPage, isImportableUrl, type WebPageFailure } from '../../webPageImport';
import { loadReaderServiceUrl, saveReaderServiceUrl } from '../../readerService';
import {
  clearNarrationPlayback,
  publishNarrationPlayback,
  requestNarrationPlayerOpen,
} from '../../narrationPlayback';
import {
  createNarrationReader,
  createWebSpeechPort,
  type NarrationReader,
  type NarrationReaderState,
  type NarrationSpeechPort,
} from '../../narrationReader';
import {
  createNativeTextToSpeechPort,
  isNativeTextToSpeechAvailable,
} from '../../nativeTextToSpeech';
import NarrationVoicePicker from './NarrationVoicePicker';
import { useNarrationVoices } from './useNarrationVoices';
import {
  deleteDocument,
  documentDisplayName,
  getDocument,
  listDocuments,
  newDocumentId,
  pastedDocumentName,
  saveDocument,
  type DocumentSummary,
} from '../../documentLibrary';
import { formatTime } from '../../stations/theme';
import ImportEmptyState from './ImportEmptyState';
import { useTranslation } from '../../i18n';
import {
  beginNarrationSession,
  endNarrationSession,
  syncNarrationSession,
} from '../../narrationMediaSession';

/**
 * Formats the extractor can actually read, kept in one place so the picker and the extractor
 * cannot drift — a picker offering more than the extractor handles is just a broken import.
 */
const ACCEPTED = SUPPORTED_DOCUMENT_ACCEPT;

/** Same source as the picker, so the formats shown and the formats taken cannot disagree. */
const FORMAT_LABELS = supportedDocumentFormatLabels(ACCEPTED).join(' · ');

/*
 * 5 MB was right when this only took .txt and .md, where it is a lot of prose. It rejects most
 * real books: an EPUB carries its cover and any illustrations inside the same archive, so a
 * novel routinely runs past 10 MB while its text is well under one. The cap is on the container,
 * and only the text survives extraction.
 */
const MAX_BYTES = 25 * 1024 * 1024;

export interface DocumentShelfProps {
  onError?: (message: string) => void;
}

/**
 * Imported documents, as their own shelf.
 *
 * Deliberately a shelf and not a button bolted to the audiobook library: a research paper is not
 * an audiobook, has no author catalog or cover, and filing it among books makes both lists lie
 * about what they contain.
 *
 * Import is weighted by whether there is anything here yet. With documents on the shelf it is a
 * section control beside the heading, out of the way of the list. With none, the shelf hands the
 * whole tab to the call to action — a section-head button was too quiet to be found by someone
 * who did not already know this tab imports files.
 */
export default function DocumentShelf({ onError }: DocumentShelfProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<NarrationReader | null>(null);
  /** The chosen engine, held so its plugin listeners can be detached when it is replaced. */
  const enginePortRef = useRef<NarrationEngine | null>(null);

  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [openDoc, setOpenDoc] = useState<DocumentSummary | null>(null);
  const [chunks, setChunks] = useState<NarrationChunk[]>([]);
  const [chunkIndex, setChunkIndex] = useState(0);
  // Where the voice is inside the current chunk, when the engine reports it.
  const [range, setRange] = useState<ReadAlongRange | null>(null);
  const chunkIndexRef = useRef(0);
  const [state, setState] = useState<NarrationReaderState>('idle');
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlText, setUrlText] = useState('');
  /** Address of a self-hosted reader service, empty when there is none. See readerService.ts. */
  const [readerUrl, setReaderUrl] = useState(() => loadReaderServiceUrl());
  const { voices, voiceId, chooseVoice, speechAvailable } = useNarrationVoices();

  const refresh = useCallback(() => {
    void listDocuments().then(setDocs);
  }, []);

  useEffect(refresh, [refresh]);

  // Audio outliving the screen that started it is its own bug.
  useEffect(() => {
    return () => {
      readerRef.current?.stop();
      void endNarrationSession();
      clearNarrationPlayback();
      enginePortRef.current?.dispose?.();
      enginePortRef.current = null;
    };
  }, []);

  const buildReader = useCallback(async (next: NarrationChunk[], startIndex: number) => {
    readerRef.current?.stop();
    /*
     * Whichever voice is actually available, best first. Piper is the neural one and the
     * reason any of this exists; the platform engine and web speech are what a device without
     * it falls back to.
     */
    enginePortRef.current?.dispose?.();
    const engine = await createNarrationEngine();
    enginePortRef.current = engine;
    const port: NarrationSpeechPort | null = engine?.port ?? null;
    if (!port) throw new Error(t('audiobooks.docSpeechUnavailable'));
    readerRef.current = createNarrationReader(next, port, {
      startIndex,
      voiceId: voiceId || undefined,
      onChunkChange: (index) => {
        chunkIndexRef.current = index;
        setChunkIndex(index);
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
        // Mirror onto the app's existing media session so a document behaves like playback:
        // lock screen, headphone pause, and survival with the screen off.
        void syncNarrationSession(s);
      },
    });
    return readerRef.current;
  }, [voiceId]);

  const onImport = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (file.size > MAX_BYTES) {
        onError?.(t('audiobooks.docTooLarge'));
        return;
      }
      setBusy(true);
      try {
        // file.text() only ever worked because the picker was limited to .txt and .md — on a
        // .docx or .epub it decodes zip bytes as UTF-8 and narrates the mojibake. Extraction
        // dispatches on the file's actual contents instead.
        const extracted = await extractDocumentText(
          new Uint8Array(await file.arrayBuffer()),
          file.name,
        );
        const text = extracted.text;
        const parsed = text ? documentToNarration(text) : [];
        if (parsed.length === 0) {
          // A format we recognise but cannot read says so in its own words. "This EPUB is
          // DRM-protected" is worth far more than a generic empty-document message.
          onError?.(extracted.reason ?? t('audiobooks.docEmpty'));
          return;
        }
        await saveDocument({
          id: newDocumentId(file.name),
          name: file.name,
          addedAt: Date.now(),
          text,
          chunkCount: parsed.length,
          estimatedSeconds: estimateNarrationSeconds(parsed),
        });
        refresh();
      } catch {
        onError?.(t('audiobooks.docReadFailed'));
      } finally {
        setBusy(false);
      }
    },
    [onError, refresh, t],
  );

  /**
   * Save pasted text as a document.
   *
   * No extraction step: the text is already text, so it goes straight to the narration parser
   * that a decoded file would have reached anyway. This is the only route in for anything that
   * was never a file — research output, an article, a long mail — and for the documents a
   * browser cannot fetch on your behalf because they sit behind a sign-in.
   *
   * The title is the first non-empty line, which is what a pasted document almost always leads
   * with. Where there isn't one, it falls back rather than refusing the paste.
   */
  /**
   * Add a page from the web.
   *
   * Each failure needs its own words. A page that renders in the browser rather than sending its
   * text — most Google properties, including Gemini share links — is not a broken page and telling
   * someone to try again would waste their time; the honest answer is to paste it instead.
   */
  const webFailureMessage = useCallback(
    (reason: WebPageFailure): string => {
      if (reason === 'not-http') return t('audiobooks.webBadUrl');
      if (reason === 'needs-javascript') return t('audiobooks.webNeedsJs');
      if (reason === 'reader-service-failed') return t('audiobooks.webReaderFailed');
      if (reason === 'not-html') return t('audiobooks.webNotHtml');
      if (reason === 'too-little-text') return t('audiobooks.webTooLittle');
      return t('audiobooks.webFetchFailed');
    },
    [t],
  );

  const onAddUrl = useCallback(
    async (raw: string) => {
      const url = raw.trim();
      if (!url) return;
      setBusy(true);
      try {
        const result = await importWebPage(url);
        if (!result.text) {
          onError?.(webFailureMessage(result.reason ?? 'fetch-failed'));
          return;
        }
        const parsed = documentToNarration(result.text);
        if (parsed.length === 0) {
          onError?.(t('audiobooks.docEmpty'));
          return;
        }
        const name = result.title?.trim() || url;
        await saveDocument({
          id: newDocumentId(name),
          name,
          addedAt: Date.now(),
          text: result.text,
          chunkCount: parsed.length,
          estimatedSeconds: estimateNarrationSeconds(parsed),
        });
        setUrlOpen(false);
        setUrlText('');
        refresh();
      } finally {
        setBusy(false);
      }
    },
    [onError, refresh, t, webFailureMessage],
  );

  const onPaste = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      if (text.length > MAX_BYTES) {
        onError?.(t('audiobooks.docTooLarge'));
        return;
      }
      setBusy(true);
      try {
        const parsed = documentToNarration(text);
        if (parsed.length === 0) {
          onError?.(t('audiobooks.docEmpty'));
          return;
        }
        const name = pastedDocumentName(
          text,
          t('audiobooks.pastedDocumentFallbackName'),
        );
        await saveDocument({
          id: newDocumentId(name),
          name,
          addedAt: Date.now(),
          text,
          chunkCount: parsed.length,
          estimatedSeconds: estimateNarrationSeconds(parsed),
        });
        setPasteOpen(false);
        setPasteText('');
        refresh();
      } catch {
        onError?.(t('audiobooks.docReadFailed'));
      } finally {
        setBusy(false);
      }
    },
    [onError, refresh, t],
  );

  const onOpen = useCallback(
    async (summary: DocumentSummary) => {
      const full = await getDocument(summary.id);
      if (!full) {
        onError?.(t('audiobooks.docReadFailed'));
        return;
      }
      // Re-chunked on open rather than stored: narration rules improve, and a document imported
      // last month should benefit without being imported again.
      const parsed = documentToNarration(full.text);
      setOpenDoc(summary);
      void beginNarrationSession({
        title: documentDisplayName(summary.name),
        documentId: summary.id,
      });
      setChunks(parsed);
      setChunkIndex(0);
      /*
       * Reading starts, but the player is not raised over it. Opening a document is a request to
       * see the document: raising the full player here covered the text with a transport screen,
       * so the reader that exists to show the words was never visible on the ordinary path. The
       * mini player still appears at the bottom, and the player is one tap from the reader.
       */
      (await buildReader(parsed, 0)).play();
    },
    [buildReader, onError, t],
  );

  const onRemove = useCallback(
    async (summary: DocumentSummary) => {
      if (openDoc?.id === summary.id) {
        readerRef.current?.stop();
        setOpenDoc(null);
        setChunks([]);
      }
      await deleteDocument(summary.id);
      refresh();
    },
    [openDoc, refresh],
  );

  // Its own tab now, so it always renders: an empty tab that hides itself is a dead end.

  /**
   * Hand the player everything it needs to paint this document.
   *
   * One effect rather than a publish call at each site, so the player can never be shown a session
   * that has drifted from the shelf's own state — every field it reads changes here together.
   */
  useEffect(() => {
    if (!openDoc || chunks.length === 0) {
      clearNarrationPlayback(openDoc?.id);
      return;
    }
    publishNarrationPlayback({
      title: documentDisplayName(openDoc.name),
      sourceId: openDoc.id,
      kind: 'document',
      passage: chunks[chunkIndex]?.text ?? '',
      section: chunks[chunkIndex]?.section,
      range,
      state,
      chunkIndex,
      chunkCount: chunks.length,
      elapsedSeconds: estimateNarrationSeconds(chunks.slice(0, chunkIndex)),
      totalSeconds: estimateNarrationSeconds(chunks),
      controls: {
        // Resuming re-issues play from the current chunk, because the platform engine has no
        // pause — the same compromise the shelf's own transport makes.
        play: () => {
          if (state === 'paused') readerRef.current?.resume();
          else void buildReader(chunks, chunkIndexRef.current).then((r) => r.play());
        },
        pause: () => readerRef.current?.pause(),
        stop: () => readerRef.current?.stop(),
        seekToChunk: (index) => readerRef.current?.seekToChunk(index),
      },
    });
  }, [openDoc, chunks, chunkIndex, range, state, buildReader]);

  const remaining = estimateNarrationSeconds(chunks.slice(chunkIndex));

  /*
   * An open document replaces the list, the same as selecting an album or an audiobook does. The
   * text is the point of opening it, and it cannot be read in a strip at the bottom of a shelf.
   */
  if (openDoc && chunks.length > 0) {
    return (
      <DocumentReaderView
        title={documentDisplayName(openDoc.name)}
        chunks={chunks}
        chunkIndex={chunkIndex}
        range={range}
        state={state}
        remainingSeconds={remaining}
        onBack={() => {
          readerRef.current?.stop();
          void endNarrationSession();
          clearNarrationPlayback(openDoc.id);
          setOpenDoc(null);
          setChunks([]);
        }}
        onPlay={() => {
          // Play resumes reading. It does not leave the page — someone who wanted the transport
          // screen instead would tap the mini player.
          if (state === 'paused') readerRef.current?.resume();
          else void buildReader(chunks, chunkIndexRef.current).then((r) => r.play());
        }}
        onPause={() => readerRef.current?.pause()}
        onStop={() => readerRef.current?.stop()}
        onSeekToChunk={(index) => readerRef.current?.seekToChunk(index)}
      />
    );
  }

  return (
    <section className="podcasts-library-grid-section audiobooks-library-section">
      <div className="flex items-center justify-between gap-3 mb-3 px-1">
        <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
          {t('audiobooks.yourDocuments')}
        </p>
        <div className="flex items-center gap-2">
          {docs.length > 0 ? (
            <span className="podcasts-count-badge podcasts-count-badge--inline">{docs.length}</span>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => {
              void onImport(e.target.files?.[0]);
              // Reset so re-picking the same file still fires a change event.
              e.target.value = '';
            }}
          />
          {/* Only while the shelf has rows — when it is empty the whole-tab call to action below
              is the import, and two import buttons on one empty screen is just noise. */}
          {docs.length > 0 ? (
            <button
              type="button"
              className="audiobook-doc-import touch-manipulation"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || speechAvailable === false}
              aria-label={t('audiobooks.chooseDocument')}
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              {t('audiobooks.importDocument')}
            </button>
          ) : null}
          {/* Shown whenever the file import is, and on the empty shelf too: pasting is the only
              way in for text that was never a file, so it must not be hidden behind having
              imported one first. */}
          <button
            type="button"
            className="audiobook-doc-import touch-manipulation"
            onClick={() => setPasteOpen((open) => !open)}
            disabled={busy || speechAvailable === false}
            aria-expanded={pasteOpen}
            aria-label={t('audiobooks.pasteDocument')}
          >
            <Plus className="w-3.5 h-3.5" />
            {t('audiobooks.pasteDocument')}
          </button>
          <button
            type="button"
            className="audiobook-doc-import touch-manipulation"
            onClick={() => setUrlOpen((open) => !open)}
            disabled={busy || speechAvailable === false}
            aria-expanded={urlOpen}
            aria-label={t('audiobooks.addFromWeb')}
          >
            <Link2 className="w-3.5 h-3.5" />
            {t('audiobooks.addFromWeb')}
          </button>
        </div>
      </div>

      {urlOpen ? (
        <div className="px-1 mb-3">
          <input
            type="url"
            inputMode="url"
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder={t('audiobooks.webUrlPlaceholder')}
            className="audiobook-doc-url-input"
            aria-label={t('audiobooks.addFromWeb')}
          />
          <p className="audiobook-doc-url-hint">{t('audiobooks.webHint')}</p>
          {/*
            The reader service address lives here rather than in Settings because this is the only
            screen where it changes anything, and the moment anyone wants it is the moment a page
            has just come back empty. Somewhere else, it is a setting nobody finds.
          */}
          <input
            type="url"
            inputMode="url"
            value={readerUrl}
            onChange={(e) => {
              setReaderUrl(e.target.value);
              saveReaderServiceUrl(e.target.value);
            }}
            placeholder={t('audiobooks.readerServicePlaceholder')}
            className="audiobook-doc-url-input mt-2"
            aria-label={t('audiobooks.readerServiceLabel')}
          />
          <p className="audiobook-doc-url-hint">{t('audiobooks.readerServiceHint')}</p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              className="audiobook-doc-import touch-manipulation"
              onClick={() => {
                setUrlOpen(false);
                setUrlText('');
              }}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="audiobook-doc-import touch-manipulation"
              onClick={() => void onAddUrl(urlText)}
              disabled={busy || !isImportableUrl(urlText)}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {t('audiobooks.webFetch')}
            </button>
          </div>
        </div>
      ) : null}

      {pasteOpen ? (
        <div className="px-1 mb-3">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            autoFocus
            className="w-full rounded-lg bg-black/40 border border-white/10 p-3 text-sm text-white/90 font-sans resize-y"
            placeholder={t('audiobooks.pastePlaceholder')}
            aria-label={t('audiobooks.pasteDocument')}
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              className="audiobook-doc-import touch-manipulation"
              onClick={() => {
                setPasteOpen(false);
                setPasteText('');
              }}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="audiobook-doc-import touch-manipulation"
              onClick={() => void onPaste(pasteText)}
              disabled={busy || pasteText.trim().length === 0}
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileText className="w-3.5 h-3.5" />
              )}
              {t('audiobooks.pasteSave')}
            </button>
          </div>
        </div>
      ) : null}

      {/* Beside the import control, not buried in a help screen: the question "will it take my
          file?" is asked at the moment of importing and nowhere else. */}
      {docs.length > 0 ? (
        <p className="font-mono text-[10px] text-[var(--text-dim)] px-1 mb-2">
          {t('audiobooks.formatsSupported', { formats: FORMAT_LABELS })}
        </p>
      ) : null}

      <NarrationVoicePicker voices={voices} voiceId={voiceId} onChange={chooseVoice} />

      {docs.length === 0 ? (
        <ImportEmptyState
          icon={<FileText className="w-8 h-8 text-accent" />}
          title={t('audiobooks.documentsEmptyTitle')}
          lead={t('audiobooks.documentsEmptyLead')}
          formatsLine={t('audiobooks.formatsSupported', { formats: FORMAT_LABELS })}
          hints={[
            /*
             * The complaint that started this named Google Docs and deep-research output, and
             * both live behind a sign-in a browser cannot follow. That rules out fetching them
             * by URL; it does not rule out pasting them, which is what the Paste text control
             * above is for. An earlier version of this comment concluded the opposite and
             * called a paste box impossible — it isn't, and it now exists.
             */
            t('audiobooks.documentsEmptyWebHint'),
            /*
             * PDF is listed as supported, so the one PDF that cannot work has to be named here.
             * A scanned book opens, looks like pages, and extracts nothing — silence the reader
             * would otherwise read as the import being broken.
             */
            t('audiobooks.documentsEmptyPdfNote'),
            speechAvailable === false ? t('audiobooks.docSpeechUnavailable') : null,
          ]}
          actionLabel={t('audiobooks.importDocumentAction')}
          onAction={() => fileInputRef.current?.click()}
          busy={busy}
          disabled={speechAvailable === false}
        />
      ) : (
        <ul className="audiobook-doc-list">
          {docs.map((doc) => (
            <li key={doc.id} className="audiobook-doc-row">
              <button
                type="button"
                className="audiobook-doc-open touch-manipulation"
                onClick={() => void onOpen(doc)}
              >
                <FileText className="w-4 h-4 shrink-0 text-accent" aria-hidden />
                <span className="min-w-0">
                  <span className="audiobook-doc-name">{documentDisplayName(doc.name)}</span>
                  <span className="audiobook-doc-meta">
                    {t('audiobooks.docParts', { count: doc.chunkCount })}
                    {doc.estimatedSeconds > 0 ? ` · ${formatTime(doc.estimatedSeconds)}` : ''}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="audiobook-doc-remove touch-manipulation"
                onClick={() => void onRemove(doc)}
                aria-label={t('audiobooks.docRemove')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

    </section>
  );
}
