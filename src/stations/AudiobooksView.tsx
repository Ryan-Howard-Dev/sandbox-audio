import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Magnet, Play, Search, ShieldAlert, Smartphone } from 'lucide-react';
import LockerMoreMenu from '../components/LockerMoreMenu';
import type { MediaEnvelope } from '../sandboxLayer1';
import AudiobookDiscoverPanel from '../components/audiobooks/AudiobookDiscoverPanel';
import AudiobookAcquirePanel from '../components/audiobooks/AudiobookAcquirePanel';
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
  audiobookOrigin,
  groupAudiobookHits,
  saveAudiobookSeeds,
  type AudiobookBook,
  type AudiobookOrigin,
} from '../audiobookLibrary';
import {
  enrichAudiobookList,
  type AudiobookMetaEnrichment,
} from '../audiobookMetadata';
import { formatTime } from './theme';
import { useTranslation } from '../i18n';
import { proxiedArtworkUrl } from '../displaySanitize';
import { seedGradient } from '../seedGradient';
import { fetchAudiobookDescription } from '../audiobookDescription';

export interface AudiobooksViewProps {
  onPlay: (envelope: MediaEnvelope) => void;
  onPlayAlbum?: (envelopes: MediaEnvelope[], shuffle?: boolean) => void;
  onPrimePlay?: (envelope: MediaEnvelope) => void;
  activeEnvelopeId?: string | null;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
  onOpenAcquireSettings?: () => void;
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
  onSuccess,
  onOpenAcquireSettings,
  drillBackRef,
}: AudiobooksViewProps) {
  const { t } = useTranslation();
  // Pillar spine, matching Music (Library/Discover) and Podcasts (Library/Discover):
  // 'device' is the Library tab, split by origin into Downloaded vs On device.
  const [tab, setTab] = useState<'discover' | 'acquire' | 'device'>('device');
  const [libraryOrigin, setLibraryOrigin] = useState<AudiobookOrigin | 'all'>('all');
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  // Format-native grouping: books group by AUTHOR, not "artist" — the audiobook
  // equivalent of the music locker's artist view.
  const [libraryGroup, setLibraryGroup] = useState<'books' | 'authors'>('books');
  const [openAuthor, setOpenAuthor] = useState<string | null>(null);
  const discoverDrillBackRef = useRef<(() => boolean) | null>(null);
  const [books, setBooks] = useState<AudiobookBook[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DeviceMusicScanProgress | null>(null);
  const [enrichDone, setEnrichDone] = useState(0);
  const [enrichTotal, setEnrichTotal] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [bookDescription, setBookDescription] = useState<string | null>(null);
  const autoStartedRef = useRef(false);

  const selected = useMemo(
    () => books.find((b) => b.key === selectedKey) ?? null,
    [books, selectedKey],
  );

  /*
   * Land on Discover only when there is genuinely no library to land on. Unlike podcasts the
   * book list comes from an async device scan, so this cannot be decided at mount — it waits
   * for the scan to settle, fires once, and bails if the user already navigated, so it can
   * never yank a tab out from under them.
   */
  const landingResolvedRef = useRef(false);
  useEffect(() => {
    if (landingResolvedRef.current) return;
    if (phase === 'scanning' || phase === 'enriching') return;
    landingResolvedRef.current = true;
    if (books.length === 0 && tab === 'device') setTab('discover');
  }, [phase, books.length, tab]);

  /*
   * File tags carry no synopsis, so the detail page had nothing to say about a book. Look one
   * up on open (cached, so once per book) and drop it if the user navigates away first.
   */
  useEffect(() => {
    setBookDescription(null);
    if (!selected) return;
    let cancelled = false;
    void fetchAudiobookDescription(selected.title, selected.author).then((text) => {
      if (!cancelled) setBookDescription(text);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Persist author/title seeds so the search sheet can build a personalised Books row
  // without running its own device scan.
  useEffect(() => {
    if (books.length > 0) saveAudiobookSeeds(books);
  }, [books]);

  const originCounts = useMemo(() => {
    let downloaded = 0;
    for (const b of books) if (audiobookOrigin(b) === 'downloaded') downloaded += 1;
    return { downloaded, uploaded: books.length - downloaded };
  }, [books]);

  const originFiltered = useMemo(
    () =>
      libraryOrigin === 'all'
        ? books
        : books.filter((b) => audiobookOrigin(b) === libraryOrigin),
    [books, libraryOrigin],
  );

  /** Books grouped by author — the audiobook analogue of the music locker's artists. */
  const authors = useMemo(() => {
    const map = new Map<string, AudiobookBook[]>();
    for (const b of originFiltered) {
      const key = (b.author || 'Unknown author').trim();
      const bucket = map.get(key);
      if (bucket) bucket.push(b);
      else map.set(key, [b]);
    }
    return [...map.entries()]
      .map(([name, list]) => ({ name, books: list }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [originFiltered]);

  const visibleBooks = useMemo(() => {
    const scoped =
      libraryGroup === 'authors' && openAuthor
        ? originFiltered.filter((b) => (b.author || 'Unknown author').trim() === openAuthor)
        : originFiltered;
    // Local filter over books already on the device — instant, no submit, matching Music.
    const q = libraryQuery.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (b) => b.title.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q),
    );
  }, [originFiltered, libraryGroup, openAuthor, libraryQuery]);

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
                  aria-label={t('audiobooks.playAlbum', { title: selected.title })}
                >
                  {/* Short visible label. Interpolating the full title made long book names
                      overflow the button and overlap the text around it. */}
                  <Play className="w-3.5 h-3.5 shrink-0" />
                  {t('audiobooks.playBook')}
                </button>
              </div>
            </div>
          </header>

          {bookDescription ? (
            <section className="audiobooks-book-about" aria-label={t('audiobooks.aboutLabel')}>
              <p className="podcasts-show-detail-episodes-label">
                {t('audiobooks.aboutLabel')}
              </p>
              <p className="audiobooks-book-about-text">{bookDescription}</p>
            </section>
          ) : null}

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
          {/* Title only. The per-tab notes here listed every provider by name — capability
              documentation that reads as noise on every visit, and that Music never needed. */}
          <h1 className="font-display text-xl font-black uppercase tracking-wider flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-accent" aria-hidden />
            {t('audiobooks.title')}
          </h1>
        </div>
        {/* Scan/library actions live behind ⋮ rather than a permanent button pinned to the
            header — it dominated the page and left no room for other actions. */}
        {/* Magnifier beside the ⋮, matching Music's Library. Filters books already scanned off
            the device, so it is instant and needs no submit — Discover keeps its own box
            because that one fires a remote query. */}
        {tab === 'device' ? (
          <button
            type="button"
            className={`audiobooks-library-search-btn touch-manipulation${librarySearchOpen ? ' is-active' : ''}`}
            onClick={() => {
              setLibrarySearchOpen((open) => !open);
              if (librarySearchOpen) setLibraryQuery('');
            }}
            aria-label={t('audiobooks.searchPlaceholder')}
            aria-expanded={librarySearchOpen}
          >
            <Search className="w-5 h-5" />
          </button>
        ) : null}
        {tab === 'device' ? (
          <LockerMoreMenu
            open={libraryMenuOpen}
            onOpenChange={setLibraryMenuOpen}
            alwaysVisible
            align="right"
            portaled
            ariaLabel={t('audiobooks.title')}
            actions={[
              {
                id: 'scan',
                section: 'Library',
                label:
                  phase === 'scanning'
                    ? t('audiobooks.scanning')
                    : phase === 'enriching'
                      ? t('audiobooks.enriching')
                      : t('audiobooks.scan'),
                disabled: phase === 'scanning' || phase === 'enriching',
                onClick: () => void runScan(),
              },
              {
                id: 'origin-all',
                section: 'Show',
                label: `All (${books.length})`,
                active: libraryOrigin === 'all',
                onClick: () => setLibraryOrigin('all'),
              },
              {
                id: 'origin-downloaded',
                label: `Downloaded (${originCounts.downloaded})`,
                active: libraryOrigin === 'downloaded',
                onClick: () => setLibraryOrigin('downloaded'),
              },
              {
                id: 'origin-uploaded',
                label: `On device (${originCounts.uploaded})`,
                active: libraryOrigin === 'uploaded',
                onClick: () => setLibraryOrigin('uploaded'),
              },
              {
                // Acquire is an action, not a way of browsing, so it does not belong beside
                // Library and Discover as a peer tab. Music and Podcasts both get by with two.
                id: 'acquire',
                section: 'Get books',
                label: t('audiobooks.tabAcquire'),
                divider: true,
                onClick: () => setTab('acquire'),
              },
            ]}
          />
        ) : null}
      </header>

      {tab === 'device' && librarySearchOpen ? (
        <input
          type="search"
          className="audiobooks-library-search-input"
          value={libraryQuery}
          onChange={(e) => setLibraryQuery(e.target.value)}
          placeholder={t('audiobooks.searchPlaceholder')}
          aria-label={t('audiobooks.searchPlaceholder')}
          autoFocus
        />
      ) : null}

      {/* Library first, then Discover, then Acquire — same order as the other pillars. */}
      <div className="podcasts-tabs mb-4 px-1" role="tablist" aria-label={t('audiobooks.title')}>
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
        {/* Acquire lives in the ⋮ now — see the menu above. Kept as a tab only while it is the
            active view, so the tab strip still reflects where you are. */}
        {tab === 'acquire' ? (
          <button
            type="button"
            role="tab"
            aria-selected
            className="podcasts-tab podcasts-tab--active touch-manipulation"
            onClick={() => setTab('device')}
          >
            <Magnet className="w-3.5 h-3.5" aria-hidden />
            {t('audiobooks.tabAcquire')}
          </button>
        ) : null}
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
      ) : tab === 'acquire' ? (
        <AudiobookAcquirePanel
          onOpenSettings={onOpenAcquireSettings}
          onError={onError}
          onSuccess={onSuccess}
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
              {visibleBooks.length}
            </span>
          </div>

          {/* Books / Authors — format-native groupings (audiobooks have authors, not artists). */}
          <div className="music-segment-bar" role="tablist" aria-label="Group books by">
            {(
              [
                ['books', `Books ${originFiltered.length}`],
                ['authors', `Authors ${authors.length}`],
              ] as Array<['books' | 'authors', string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={libraryGroup === id}
                data-testid={`audiobook-group-${id}`}
                className={`music-segment-tab touch-manipulation${
                  libraryGroup === id ? ' music-segment-tab--active' : ''
                }`}
                onClick={() => {
                  setLibraryGroup(id);
                  setOpenAuthor(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {libraryGroup === 'authors' && !openAuthor ? (
            <ul className="space-y-1" role="list">
              {authors.map((a) => (
                <li key={a.name}>
                  <button
                    type="button"
                    className="universal-search-row touch-manipulation w-full"
                    onClick={() => setOpenAuthor(a.name)}
                  >
                    <span className="universal-search-meta">
                      <span className="universal-search-title">{a.name}</span>
                      <span className="universal-search-sub">
                        {a.books.length} {a.books.length === 1 ? 'book' : 'books'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {libraryGroup === 'authors' && openAuthor ? (
            <button
              type="button"
              className="universal-search-seeall touch-manipulation mb-2"
              onClick={() => setOpenAuthor(null)}
            >
              ← All authors · {openAuthor}
            </button>
          ) : null}

          <ul
            className={`podcasts-library-grid${
              libraryGroup === 'authors' && !openAuthor ? ' hidden' : ''
            }`}
            role="list"
          >
            {visibleBooks.map((book) => {
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
