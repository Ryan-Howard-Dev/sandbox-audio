import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Pause, Play, Square } from 'lucide-react';
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
import { formatTime } from '../../stations/theme';
import { useTranslation } from '../../i18n';

/** Text formats a file read alone can handle. PDF and EPUB need parsers and are not offered yet. */
const ACCEPTED = '.txt,.md,.markdown,.text,text/plain,text/markdown';
const MAX_BYTES = 5 * 1024 * 1024;

export interface DocumentNarrationPanelProps {
  onError?: (message: string) => void;
}

/**
 * Read an uploaded document aloud.
 *
 * The document never leaves the device: it is read with FileReader, chunked locally, and spoken
 * by the platform's own voices. No upload, no service, no account — the same guarantee as the
 * rest of the locker.
 */
export default function DocumentNarrationPanel({ onError }: DocumentNarrationPanelProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<NarrationReader | null>(null);

  const [docName, setDocName] = useState('');
  const [chunks, setChunks] = useState<NarrationChunk[]>([]);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [state, setState] = useState<NarrationReaderState>('idle');
  const [busy, setBusy] = useState(false);
  /*
   * Undefined until probed. Web Speech can be answered synchronously, but the native engine has
   * to initialise before it can say whether it has voices, so availability is resolved once on
   * mount rather than guessed.
   */
  const [speechAvailable, setSpeechAvailable] = useState<boolean | undefined>(undefined);
  const nativePortRef = useRef<ReturnType<typeof createNativeTextToSpeechPort> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isNativeTextToSpeechAvailable().then((native) => {
      if (cancelled) return;
      setSpeechAvailable(native || isNarrationSpeechAvailable());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Stop speaking if the panel goes away — audio outliving its screen is its own bug.
  useEffect(() => {
    return () => {
      readerRef.current?.stop();
      nativePortRef.current?.dispose();
      nativePortRef.current = null;
    };
  }, []);

  const buildReader = useCallback(
    async (next: NarrationChunk[], startIndex: number) => {
      readerRef.current?.stop();
      /*
       * Native engine first on Android, where Web Speech does not exist in the WebView; Web Speech
       * everywhere else. Both satisfy the same port, so the sequencing above does not care which.
       */
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
    },
    [],
  );

  const onPick = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (file.size > MAX_BYTES) {
        onError?.(t('audiobooks.docTooLarge'));
        return;
      }
      setBusy(true);
      try {
        const text = await file.text();
        const next = documentToNarration(text);
        if (next.length === 0) {
          onError?.(t('audiobooks.docEmpty'));
          return;
        }
        setDocName(file.name);
        setChunks(next);
        setChunkIndex(0);
        (await buildReader(next, 0)).play();
      } catch {
        onError?.(t('audiobooks.docReadFailed'));
      } finally {
        setBusy(false);
      }
    },
    [buildReader, onError, t],
  );

  const currentSection = chunks[chunkIndex]?.section ?? '';
  const remaining = estimateNarrationSeconds(chunks.slice(chunkIndex));

  return (
    <section className="audiobook-doc-panel">
      <div className="podcasts-discover-section-head">
        <FileText className="w-4 h-4 text-accent" aria-hidden />
        <h2 className="podcasts-discover-section-title">{t('audiobooks.readDocumentTitle')}</h2>
      </div>

      <p className="font-mono text-[10px] text-[var(--text-dim)] mb-3">
        {t('audiobooks.readDocumentHint')}
      </p>

      {!speechAvailable ? (
        <p className="font-mono text-xs text-[var(--text-dim)] py-2">
          {t('audiobooks.docSpeechUnavailable')}
        </p>
      ) : (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => {
              void onPick(e.target.files?.[0]);
              // Reset so picking the same file twice still fires a change event.
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn-accent touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-2 whitespace-nowrap"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5 shrink-0" />
            )}
            {t('audiobooks.chooseDocument')}
          </button>

          {chunks.length > 0 ? (
            <div className="audiobook-doc-now mt-4">
              <p className="audiobook-doc-name">{docName}</p>
              {currentSection ? (
                <p className="audiobook-doc-section">{currentSection}</p>
              ) : null}
              <p className="audiobook-doc-meta">
                {t('audiobooks.docPosition', {
                  index: chunkIndex + 1,
                  total: chunks.length,
                })}
                {remaining > 0 ? ` · ${formatTime(remaining)} ${t('audiobooks.docLeft')}` : ''}
              </p>
              <div className="flex items-center gap-2 mt-3">
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
        </>
      )}
    </section>
  );
}
