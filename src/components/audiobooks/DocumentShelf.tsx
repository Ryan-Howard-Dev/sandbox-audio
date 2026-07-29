import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Pause, Play, Plus, Square, Trash2 } from 'lucide-react';
import { documentToNarration, estimateNarrationSeconds } from '../../documentNarration';
import { extractDocumentText, SUPPORTED_DOCUMENT_ACCEPT } from '../../documentExtract';
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
  listNativeVoices,
} from '../../nativeTextToSpeech';
import {
  loadPreferredVoiceId,
  preferLanguage,
  resolvePreferredVoice,
  savePreferredVoiceId,
  sortNarrationVoices,
  webSpeechVoiceToNarrationVoice,
  type NarrationVoice,
} from '../../narrationVoices';
import {
  deleteDocument,
  documentDisplayName,
  getDocument,
  listDocuments,
  newDocumentId,
  saveDocument,
  type DocumentSummary,
} from '../../documentLibrary';
import { formatTime } from '../../stations/theme';
import { useTranslation } from '../../i18n';

/**
 * Formats the extractor can actually read, kept in one place so the picker and the extractor
 * cannot drift — a picker offering more than the extractor handles is just a broken import.
 */
const ACCEPTED = SUPPORTED_DOCUMENT_ACCEPT;

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
 * about what they contain. Import lives in this section's head, at the weight of a section
 * control rather than a page-level call to action.
 */
export default function DocumentShelf({ onError }: DocumentShelfProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<NarrationReader | null>(null);
  const nativePortRef = useRef<ReturnType<typeof createNativeTextToSpeechPort> | null>(null);

  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [openDoc, setOpenDoc] = useState<DocumentSummary | null>(null);
  const [chunks, setChunks] = useState<NarrationChunk[]>([]);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [state, setState] = useState<NarrationReaderState>('idle');
  const [busy, setBusy] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState<boolean | undefined>(undefined);
  const [voices, setVoices] = useState<NarrationVoice[]>([]);
  const [voiceId, setVoiceId] = useState('');

  const refresh = useCallback(() => {
    void listDocuments().then(setDocs);
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void isNativeTextToSpeechAvailable().then(async (native) => {
      if (cancelled) return;
      setSpeechAvailable(native || isNarrationSpeechAvailable());

      /*
       * Web Speech populates its voice list asynchronously and returns an empty array on the first
       * call in most engines, so the `voiceschanged` event is the only reliable read. The native
       * engine answers directly once it has initialised.
       */
      const load = async () => {
        const found = native
          ? await listNativeVoices()
          : isNarrationSpeechAvailable()
            ? window.speechSynthesis.getVoices().map(webSpeechVoiceToNarrationVoice)
            : [];
        if (cancelled || found.length === 0) return;
        const ordered = sortNarrationVoices(preferLanguage(found, navigator.language ?? 'en'));
        setVoices(ordered);
        setVoiceId(resolvePreferredVoice(ordered, loadPreferredVoiceId())?.id ?? '');
      };
      await load();
      if (!native && isNarrationSpeechAvailable()) {
        window.speechSynthesis.addEventListener('voiceschanged', () => void load(), { once: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Audio outliving the screen that started it is its own bug.
  useEffect(() => {
    return () => {
      readerRef.current?.stop();
      nativePortRef.current?.dispose();
      nativePortRef.current = null;
    };
  }, []);

  const buildReader = useCallback(async (next: NarrationChunk[], startIndex: number) => {
    readerRef.current?.stop();
    let port: NarrationSpeechPort;
    if (await isNativeTextToSpeechAvailable()) {
      nativePortRef.current?.dispose();
      nativePortRef.current = createNativeTextToSpeechPort();
      port = nativePortRef.current;
    } else {
      port = createWebSpeechPort(
        window.speechSynthesis,
        (text) => new SpeechSynthesisUtterance(text),
      );
    }
    readerRef.current = createNarrationReader(next, port, {
      startIndex,
      voiceId: voiceId || undefined,
      onChunkChange: (index) => setChunkIndex(index),
      onStateChange: (s) => setState(s),
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
        const extracted = extractDocumentText(new Uint8Array(await file.arrayBuffer()), file.name);
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
      setChunks(parsed);
      setChunkIndex(0);
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

  const remaining = estimateNarrationSeconds(chunks.slice(chunkIndex));

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
        </div>
      </div>

      {/*
        Offline voices are listed first and win the default. The better-sounding ones are usually
        network voices, and those stop working exactly where a long document gets listened to.
      */}
      {voices.length > 1 ? (
        <label className="audiobook-doc-voice">
          <span className="audiobook-doc-voice-label">{t('audiobooks.voiceLabel')}</span>
          <select
            className="audiobook-doc-voice-select"
            value={voiceId}
            onChange={(e) => {
              setVoiceId(e.target.value);
              savePreferredVoiceId(e.target.value);
            }}
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.networkRequired ? `${v.label} · ${t('audiobooks.voiceOnline')}` : v.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {docs.length === 0 ? (
        <p className="font-mono text-[10px] text-[var(--text-dim)] px-1 pb-2">
          {t('audiobooks.documentsEmpty')}
        </p>
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

      {openDoc && chunks.length > 0 ? (
        <div className="audiobook-doc-now mt-3">
          <p className="audiobook-doc-name">{documentDisplayName(openDoc.name)}</p>
          {chunks[chunkIndex]?.section ? (
            <p className="audiobook-doc-section">{chunks[chunkIndex]!.section}</p>
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
                  if (state === 'paused') readerRef.current?.resume();
                  else void buildReader(chunks, chunkIndex).then((r) => r.play());
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
        </div>
      ) : null}
    </section>
  );
}
