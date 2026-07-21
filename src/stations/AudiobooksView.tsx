import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Play, RefreshCw, Search, ShieldAlert, Smartphone } from 'lucide-react';
import type { MediaEnvelope } from '../sandboxLayer1';
import AudiobookDiscoverPanel from '../components/audiobooks/AudiobookDiscoverPanel';
import {
  checkDeviceMusicScanPermission,
  isDeviceMusicScanAvailable,
  requestDeviceMusicScanPermission,
  scanDeviceAudiobooks,
  type DeviceMusicScanProgress,
} from '../deviceMusicScan';
import { filterAudiobookScanHits } from '../lockerUploadFilter';
import { audiobookHitToEnvelope } from '../audiobookPlayback';
import {
  applyAudiobookEnrichment,
  groupAudiobookHits,
  type AudiobookBook,
} from '../audiobookLibrary';
import {
  enrichAudiobookList,
  type AudiobookMetaEnrichment,
} from '../audiobookMetadata';
import { formatTime } from './theme';
import { useTranslation } from '../i18n';
import { proxiedArtworkUrl } from '../displaySanitize';
import { seedGradient } from '../seedGradient';

export interface AudiobooksViewProps {
  onPlay: (envelope: MediaEnvelope) => void;
  onPlayAlbum?: (envelopes: MediaEnvelope[], shuffle?: boolean) => void;
  onPrimePlay?: (envelope: MediaEnvelope) => void;
  activeEnvelopeId?: string | null;
  onError?: (message: string) => void;
  /** Android hardware back — pop book detail drill-down. */
  drillBackRef?: React.MutableRefObject<(() => boolean) | null>;
}

type Phase = 'idle' | 'permission' | 'scanning' | 'enriching' | 'ready' | 'error';

function isPermissionError(message: string): boolean {
  return /permission|denied|audio read/i.test(message);
}

export default function AudiobooksView({
  onPlay,
  onPlayAlbum,
  onPrimePlay,
  activeEnvelopeId,
  onError,
  drillBackRef,
}: AudiobooksViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'discover' | 'device'>('discover');
  const discoverDrillBackRef = useRef<(() => boolean) | null>(null);
  const [books, setBooks] = useState<AudiobookBook[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DeviceMusicScanProgress | null>(null);
  const [enrichDone, setEnrichDone] = useState(0);
  const [enrichTotal, setEnrichTotal] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const autoStartedRef = useRef(false);

  const selected = useMemo(
    () => books.find((b) => b.key === selectedKey) ?? null,
    [books, selectedKey],
  );

  const playBook = useCallback(
    (book: AudiobookBook) => {
      const opts = {
        title: book.title,
        artist: book.author,
        album: book.title,
        artworkUrl: book.coverUrl,
      };
      const envs = book.tracks.map((hit) => audiobookHitToEnvelope(hit, opts));
      if (onPlayAlbum && envs.length > 1) onPlayAlbum(envs, false);
      else if (envs[0]) onPlay(envs[0]);
    },
    [onPlay, onPlayAlbum],
  );

  const playChapter = useCallback(
    (book: AudiobookBook, index: number) => {
      const hit = book.tracks[index];
      if (!hit) return;
      onPlay(
        audiobookHitToEnvelope(hit, {
          title: hit.chapterLabel,
          artist: book.author,
          album: book.title,
          artworkUrl: book.coverUrl,
        }),
      );
    },
    [onPlay],
  );

  const runEnrichment = useCallback(
    async (grouped: AudiobookBook[]) => {
      if (grouped.length === 0) {
        setBooks([]);
        setPhase('ready');
        return;
      }
      setPhase('enriching');
      setEnrichDone(0);
      setEnrichTotal(grouped.length);
      // Show local labels immediately, then fill covers as lookups return.
      setBooks(grouped);

      const metaByKey = await enrichAudiobookList(
        grouped.map((b) => ({ key: b.key, title: b.title, author: b.author })),
        (done, total) => {
          setEnrichDone(done);
          setEnrichTotal(total);
        },
      );

      setBooks(
        grouped.map((book) =>
          applyAudiobookEnrichment(
            book,
            metaByKey.get(book.key) as AudiobookMetaEnrichment | undefined,
          ),
        ),
      );
      setPhase('ready');
    },
    [],
  );

  const runScan = useCallback(async () => {
    if (!isDeviceMusicScanAvailable()) {
      setPhase('error');
      setError(t('audiobooks.androidOnly'));
      return;
    }

    setError(null);
    setSelectedKey(null);

    const already = await checkDeviceMusicScanPermission();
    if (!already) {
      const granted = await requestDeviceMusicScanPermission();
      if (!granted) {
        setPhase('permission');
        setError(t('audiobooks.permissionDenied'));
        return;
      }
    }

    setPhase('scanning');
    setProgress(null);
    try {
      const raw = await scanDeviceAudiobooks((p) => setProgress(p));
      const filtered = filterAudiobookScanHits(raw);
      const grouped = groupAudiobookHits(filtered);
      await runEnrichment(grouped);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('audiobooks.scanFailed');
      if (isPermissionError(message)) {
        setPhase('permission');
        setError(t('audiobooks.permissionDenied'));
      } else {
        setPhase('error');
        setError(message || t('audiobooks.scanFailed'));
      }
    } finally {
      setProgress(null);
    }
  }, [runEnrichment, t]);

  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!isDeviceMusicScanAvailable()) return;
    autoStartedRef.current = true;
    void (async () => {
      const granted = await checkDeviceMusicScanPermission();
      if (!granted) {
        setPhase('permission');
        setError(t('audiobooks.permissionDenied'));
        return;
      }
      void runScan();
    })();
  }, [runScan, t]);

  useEffect(() => {
    if (!drillBackRef) return;
    drillBackRef.current = () => {
      if (tab === 'discover' && discoverDrillBackRef.current?.()) {
        return true;
      }
      if (selectedKey) {
        setSelectedKey(null);
        return true;
      }
      return false;
    };
    return () => {
      drillBackRef.current = null;
    };
  }, [drillBackRef, selectedKey, tab]);

  if (selected) {
    const art = proxiedArtworkUrl(selected.coverUrl);
    return (
      <div className="locker-page podcasts-view audiobooks-view">
        <button
          type="button"
          className="podcasts-show-detail-back touch-manipulation mb-3"
          onClick={() => setSelectedKey(null)}
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          {t('audiobooks.backToLibrary')}
        </button>

        <section className="podcasts-library-show-detail audiobooks-book-detail">
          <header className="podcasts-show-detail-head">
            <div className="podcasts-show-detail-art">
              {art ? (
                <img src={art} alt="" className="w-full h-full object-cover" />
              ) : (
                <div
                  className="w-full h-full"
                  style={{ background: seedGradient(selected.title) }}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="podcasts-show-detail-title">{selected.title}</h2>
              <p className="podcasts-show-detail-author">{selected.author}</p>
              <p className="font-mono text-[10px] text-[var(--text-dim)] mt-1">
                {t('audiobooks.chaptersCount', { count: selected.tracks.length })}
                {selected.durationSeconds > 0
                  ? ` · ${formatTime(selected.durationSeconds)}`
                  : ''}
              </p>
              <div className="podcasts-show-detail-actions mt-3">
                <button
                  type="button"
                  className="btn-accent touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-2"
                  onClick={() => playBook(selected)}
                >
                  <Play className="w-3.5 h-3.5" />
                  {t('audiobooks.playAlbum', { title: selected.title })}
                </button>
              </div>
            </div>
          </header>

          <p className="podcasts-show-detail-episodes-label mt-4">
            {t('audiobooks.chaptersLabel')}
          </p>
          <ul className="podcasts-episode-list divide-y divide-[var(--border)]">
            {selected.tracks.map((chapter, index) => (
              <li key={chapter.id} className="podcasts-show-episode-row">
                <button
                  type="button"
                  className="podcasts-show-episode-copy touch-manipulation text-left w-full py-3"
                  onClick={() => playChapter(selected, index)}
                  aria-label={t('audiobooks.playChapter', {
                    title: chapter.chapterLabel,
                  })}
                >
                  <p className="podcasts-show-episode-title">{chapter.chapterLabel}</p>
                  <p className="podcasts-show-episode-meta">
                    {chapter.durationMs > 0
                      ? formatTime(Math.round(chapter.durationMs / 1000))
                      : selected.author}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <div className="locker-page podcasts-view audiobooks-view">
      <header className="audiobooks-station-header flex items-start justify-between gap-3 mb-3 px-1">
        <div>
          <h1 className="font-display text-xl font-black uppercase tracking-wider flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-accent" aria-hidden />
            {t('audiobooks.title')}
          </h1>
          <p className="font-mono text-[10px] text-[var(--text-dim)] mt-1 max-w-md">
            {tab === 'discover' ? t('audiobooks.discoverTabNote') : t('audiobooks.isolationNote')}
          </p>
        </div>
        {tab === 'device' ? (
          <button
            type="button"
            className="btn-accent touch-manipulation h-10 px-3 rounded-lg font-mono text-[10px] uppercase tracking-wider flex items-center gap-2 shrink-0"
            onClick={() => void runScan()}
            disabled={phase === 'scanning' || phase === 'enriching'}
          >
            <RefreshCw
              className={`w-3.5 h-3.5${
                phase === 'scanning' || phase === 'enriching' ? ' animate-spin' : ''
              }`}
            />
            {phase === 'scanning'
              ? t('audiobooks.scanning')
              : phase === 'enriching'
                ? t('audiobooks.enriching')
                : t('audiobooks.scan')}
          </button>
        ) : null}
      </header>

      <div className="podcasts-tabs mb-4 px-1" role="tablist" aria-label={t('audiobooks.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'discover'}
          className={`podcasts-tab touch-manipulation${tab === 'discover' ? ' podcasts-tab--active' : ''}`}
          onClick={() => setTab('discover')}
        >
          <Search className="w-3.5 h-3.5" aria-hidden />
          {t('audiobooks.tabDiscover')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'device'}
          className={`podcasts-tab touch-manipulation${tab === 'device' ? ' podcasts-tab--active' : ''}`}
          onClick={() => setTab('device')}
        >
          <Smartphone className="w-3.5 h-3.5" aria-hidden />
          {t('audiobooks.tabDevice')}
        </button>
      </div>

      {tab === 'discover' ? (
        <AudiobookDiscoverPanel
          onPlay={onPlay}
          onPlayAlbum={onPlayAlbum}
          onPrimePlay={onPrimePlay}
          onError={onError}
          activeEnvelopeId={activeEnvelopeId}
          drillBackRef={discoverDrillBackRef}
        />
      ) : (
        <>
      {phase === 'scanning' && (
        <p className="font-mono text-[10px] text-[var(--text-dim)] px-1 mb-3" aria-live="polite">
          {t('audiobooks.scanProgress', {
            scanned: progress?.scanned ?? 0,
            matched: progress?.matched ?? 0,
          })}
        </p>
      )}

      {phase === 'enriching' && (
        <p className="font-mono text-[10px] text-[var(--text-dim)] px-1 mb-3" aria-live="polite">
          {t('audiobooks.enriching')} ({enrichDone}/{enrichTotal})
        </p>
      )}

      {phase === 'permission' && (
        <div className="podcasts-empty-state audiobooks-permission-state">
          <ShieldAlert className="w-8 h-8 text-accent mx-auto mb-3" aria-hidden />
          <p className="font-mono text-xs text-[var(--text-mid)] mb-2">
            {error || t('audiobooks.permissionDenied')}
          </p>
          <p className="font-mono text-[10px] text-[var(--text-dim)] mb-4 max-w-sm mx-auto">
            {t('audiobooks.permissionDeniedHint')}
          </p>
          <button
            type="button"
            className="btn-accent touch-manipulation h-11 px-4 rounded-lg font-mono text-xs uppercase tracking-wider"
            onClick={() => void runScan()}
          >
            {t('audiobooks.requestPermission')}
          </button>
        </div>
      )}

      {phase === 'error' && error && (
        <div className="podcasts-empty-state">
          <p className="font-mono text-xs text-red-400 mb-3" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="btn-accent touch-manipulation h-11 px-4 rounded-lg font-mono text-xs uppercase tracking-wider"
            onClick={() => void runScan()}
          >
            {t('audiobooks.scan')}
          </button>
        </div>
      )}

      {phase === 'idle' && (
        <div className="podcasts-empty-state">
          <p className="font-mono text-xs text-[var(--text-mid)] mb-3">
            {t('audiobooks.idleHint')}
          </p>
          <button
            type="button"
            className="btn-accent touch-manipulation h-11 px-4 rounded-lg font-mono text-xs uppercase tracking-wider"
            onClick={() => void runScan()}
          >
            {t('audiobooks.scan')}
          </button>
        </div>
      )}

      {phase === 'ready' && books.length === 0 && (
        <div className="podcasts-empty-state">
          <p className="font-mono text-xs text-[var(--text-mid)]">{t('audiobooks.empty')}</p>
        </div>
      )}

      {books.length > 0 && (phase === 'ready' || phase === 'enriching') && (
        <section className="podcasts-library-grid-section audiobooks-library-section">
          <div className="flex items-center justify-between gap-3 mb-3 px-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
              {t('audiobooks.yourBooks')}
            </p>
            <span className="podcasts-count-badge podcasts-count-badge--inline">
              {books.length}
            </span>
          </div>

          <ul className="podcasts-library-grid" role="list">
            {books.map((book) => {
              const art = proxiedArtworkUrl(book.coverUrl);
              return (
                <li key={book.key}>
                  <div className="podcasts-library-tile-wrap">
                    <button
                      type="button"
                      className="podcasts-library-tile touch-manipulation"
                      onClick={() => setSelectedKey(book.key)}
                      aria-label={t('audiobooks.openBook', { title: book.title })}
                    >
                      <div className="podcasts-library-tile-art">
                        {art ? (
                          <img
                            src={art}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className="w-full h-full flex items-center justify-center"
                            style={{ background: seedGradient(book.title) }}
                          >
                            <BookOpen
                              className="w-6 h-6 text-white/70"
                              aria-hidden
                            />
                          </div>
                        )}
                        {book.tracks.length > 1 ? (
                          <span className="podcasts-library-tile-badge font-mono tabular-nums">
                            {book.tracks.length > 99 ? '99+' : book.tracks.length}
                          </span>
                        ) : null}
                      </div>
                      <p className="podcasts-library-tile-title">{book.title}</p>
                      <p className="podcasts-library-tile-meta line-clamp-2">
                        {book.author}
                      </p>
                      <p className="podcasts-library-tile-count font-mono text-[9px] uppercase text-[var(--text-dim)]">
                        {t('audiobooks.chaptersCount', {
                          count: book.tracks.length,
                        })}
                        {book.durationSeconds > 0
                          ? ` · ${formatTime(book.durationSeconds)}`
                          : ''}
                      </p>
                    </button>
                    <button
                      type="button"
                      className="audiobooks-tile-play touch-manipulation"
                      aria-label={t('audiobooks.playAlbum', { title: book.title })}
                      onClick={(e) => {
                        e.stopPropagation();
                        playBook(book);
                      }}
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
        </>
      )}
    </div>
  );
}
