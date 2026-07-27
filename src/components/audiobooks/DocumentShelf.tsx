import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Pause, Play, Plus, Square, Trash2 } from 'lucide-react';
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

/** Text formats a file read alone can handle. EPUB and PDF need parsers and are not offered yet. */
const ACCEPTED = '.txt,.md,.markdown,.text,text/plain,text/markdown';
const MAX_BYTES = 5 * 1024 * 1024;

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

  const refresh = useCallback(() => {
    void listDocuments().then(setDocs);
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void isNativeTextToSpeechAvailable().then((native) => {
      if (!cancelled) setSpeechAvailable(native || isNarrationSpeechAvailable());
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
      onChunkChange: (index) => setChunkIndex(index),
      onStateChange: (s) => setState(s),
    });
    return readerRef.current;
  }, []);

  const onImport = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (file.size > MAX_BYTES) {
        onError?.(t('audiobooks.docTooLarge'));
        return;
      }
      setBusy(true);
      try {
        const text = await file.text();
        const parsed = documentToNarration(text);
        if (parsed.length === 0) {
          onError?.(t('audiobooks.docEmpty'));
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

  // Nothing imported and no engine to read with — say nothing rather than advertise a dead end.
  if (docs.length === 0 && speechAvailable === false) return null;

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
