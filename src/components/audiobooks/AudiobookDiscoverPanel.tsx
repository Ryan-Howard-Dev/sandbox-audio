import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Globe,
  Loader2,
  Play,
  Plus,
  Rss,
  Search,
} from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import {
  AUDIOBOOK_CATALOG_SOURCES,
  audiobookSourceLabel,
  catalogChapterEnvelope,
  fetchAudiobookCatalogChapters,
  searchAudiobookCatalog,
  type AudiobookCatalogBook,
  type AudiobookCatalogChapter,
  type AudiobookCatalogSource,
} from '../../audiobookCatalog';
import {
  addUserAudiobookRssFeed,
  loadUserAudiobookRssFeeds,
  subscribeAudiobookRssFeeds,
} from '../../audiobookRssFeeds';
import { probeAudiobookRssFeed } from '../../audiobookRssProvider';
import { proxiedArtworkUrl } from '../../displaySanitize';
import { seedGradient } from '../../seedGradient';
import { formatTime } from '../../stations/theme';
import { useTranslation } from '../../i18n';
import AudiobookChapterRow from './AudiobookChapterRow';

export interface AudiobookDiscoverPanelProps {
  onPlay: (env: MediaEnvelope) => void;
  onPlayAlbum?: (envelopes: MediaEnvelope[], shuffle?: boolean) => void;
  onPrimePlay?: (env: MediaEnvelope) => void;
  onError?: (message: string) => void;
  activeEnvelopeId?: string | null;
  /** Android hardware back — pop book detail drill-down. */
  drillBackRef?: React.MutableRefObject<(() => boolean) | null>;
}

type SourceFilter = 'all' | AudiobookCatalogSource;

function BookCard({
  book,
  onOpen,
}: {
  book: AudiobookCatalogBook;
  onOpen: () => void;
}) {
  const art = proxiedArtworkUrl(book.artworkUrl);
  return (
    <article
      className="podcasts-discover-card podcasts-discover-card--clickable touch-manipulation"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`View chapters for ${book.title}`}
    >
      <div className="podcasts-discover-card-art">
        {art ? (
          <img src={art} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full" style={{ background: seedGradient(book.title) }} />
        )}
      </div>
      <div className="podcasts-discover-card-body">
        <h3 className="podcasts-discover-card-title">{book.title}</h3>
        <p className="podcasts-discover-card-author">{book.author}</p>
        {book.description ? (
          <p className="podcasts-discover-card-desc line-clamp-3">{book.description}</p>
        ) : null}
        <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-dim)] mt-1">
          {audiobookSourceLabel(book.source)}
          {book.chapterCount ? ` · ${book.chapterCount} chapters` : ''}
        </p>
      </div>
    </article>
  );
}

function BookDetailView({
  book,
  chapters,
  loading,
  activeEnvelopeId,
  onBack,
  onPlayChapter,
  onPrimePlayChapter,
  onPlayAll,
  onError,
}: {
  book: AudiobookCatalogBook;
  chapters: AudiobookCatalogChapter[];
  loading: boolean;
  activeEnvelopeId?: string | null;
  onBack: () => void;
  onPlayChapter: (chapter: AudiobookCatalogChapter) => void;
  onPrimePlayChapter?: (chapter: AudiobookCatalogChapter) => void;
  onPlayAll: () => void;
  onError?: (message: string) => void;
}) {
  const { t } = useTranslation();
  const art = proxiedArtworkUrl(book.artworkUrl);

  return (
    <section className="podcasts-library-show-detail audiobooks-book-detail">
      <button
        type="button"
        className="podcasts-show-detail-back touch-manipulation mb-3"
        onClick={onBack}
      >
        <ArrowLeft className="w-4 h-4" aria-hidden />
        {t('audiobooks.discoverBack')}
      </button>

      <header className="podcasts-show-detail-head">
        <div className="podcasts-show-detail-art">
          {art ? (
            <img src={art} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full" style={{ background: seedGradient(book.title) }} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="podcasts-show-detail-title">{book.title}</h2>
          <p className="podcasts-show-detail-author">{book.author}</p>
          {book.description ? (
            <p className="font-mono text-[10px] text-[var(--text-dim)] mt-2 line-clamp-4">
              {book.description}
            </p>
          ) : null}
          <p className="font-mono text-[10px] text-[var(--text-dim)] mt-1">
            {audiobookSourceLabel(book.source)}
            {chapters.length > 0
              ? ` · ${t('audiobooks.chaptersCount', { count: chapters.length })}`
              : ''}
            {book.durationSeconds && book.durationSeconds > 0
              ? ` · ${formatTime(book.durationSeconds)}`
              : ''}
          </p>
          <div className="podcasts-show-detail-actions mt-3">
            <button
              type="button"
              className="btn-accent touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-2"
              onClick={onPlayAll}
              disabled={loading || chapters.length === 0}
            >
              <Play className="w-3.5 h-3.5" />
              {t('audiobooks.playAlbum', { title: book.title })}
            </button>
          </div>
        </div>
      </header>

      <p className="podcasts-show-detail-episodes-label mt-4">
        {t('audiobooks.chaptersLabel')}
      </p>

      {loading ? (
        <p className="font-mono text-xs text-[var(--text-dim)] flex items-center gap-2 py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('audiobooks.loadingChapters')}
        </p>
      ) : chapters.length === 0 ? (
        <p className="font-mono text-xs text-[var(--text-dim)] py-4">
          {t('audiobooks.noChapters')}
        </p>
      ) : (
        <ul className="podcasts-episode-list divide-y divide-[var(--border)]">
          {chapters.map((chapter) => (
            <AudiobookChapterRow
              key={chapter.id}
              chapter={chapter}
              bookTitle={book.title}
              bookAuthor={book.author}
              bookArtworkUrl={book.artworkUrl}
              envelope={catalogChapterEnvelope(chapter, book)}
              activeEnvelopeId={activeEnvelopeId}
              onPlay={() => onPlayChapter(chapter)}
              onPrimePlay={
                onPrimePlayChapter ? () => onPrimePlayChapter(chapter) : undefined
              }
              onError={onError}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AudiobookDiscoverPanel({
  onPlay,
  onPlayAlbum,
  onPrimePlay,
  onError,
  activeEnvelopeId,
  drillBackRef,
}: AudiobookDiscoverPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AudiobookCatalogBook[]>([]);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedBook, setSelectedBook] = useState<AudiobookCatalogBook | null>(null);
  const [chapters, setChapters] = useState<AudiobookCatalogChapter[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [rssExpanded, setRssExpanded] = useState(false);
  const [rssUrl, setRssUrl] = useState('');
  const [rssAdding, setRssAdding] = useState(false);
  const [userFeedCount, setUserFeedCount] = useState(() => loadUserAudiobookRssFeeds().length);

  useEffect(() => {
    return subscribeAudiobookRssFeeds(() => {
      setUserFeedCount(loadUserAudiobookRssFeeds().length);
    });
  }, []);

  useEffect(() => {
    if (!drillBackRef) return;
    drillBackRef.current = () => {
      if (selectedBook) {
        setSelectedBook(null);
        setChapters([]);
        return true;
      }
      return false;
    };
    return () => {
      drillBackRef.current = null;
    };
  }, [drillBackRef, selectedBook]);

  const filteredResults = useMemo(() => {
    if (sourceFilter === 'all') return results;
    return results.filter((b) => b.source === sourceFilter);
  }, [results, sourceFilter]);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const books = await searchAudiobookCatalog(trimmed, 24);
        setResults(books);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : t('audiobooks.searchFailed'));
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [onError, t],
  );

  const handleAddRssFeed = useCallback(async () => {
    const url = rssUrl.trim();
    if (!url) return;
    setRssAdding(true);
    onError?.('');
    try {
      const probe = await probeAudiobookRssFeed(url);
      if (!probe) {
        onError?.(t('audiobooks.rssAddFailed'));
        return;
      }
      addUserAudiobookRssFeed({ url, label: probe.title, kind: probe.episodeCount > 1 ? 'book' : 'anthology' });
      setRssUrl('');
      if (query.trim().length >= 2) {
        await runSearch(query);
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : t('audiobooks.rssAddFailed'));
    } finally {
      setRssAdding(false);
    }
  }, [onError, query, rssUrl, runSearch, t]);

  const openBook = useCallback(
    async (book: AudiobookCatalogBook) => {
      setSelectedBook(book);
      setChapters([]);
      setLoadingChapters(true);
      try {
        const loaded = await fetchAudiobookCatalogChapters(book);
        setChapters(loaded);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : t('audiobooks.chaptersFailed'));
        setChapters([]);
      } finally {
        setLoadingChapters(false);
      }
    },
    [onError, t],
  );

  const playChapter = useCallback(
    (chapter: AudiobookCatalogChapter) => {
      if (!selectedBook) return;
      onPlay(catalogChapterEnvelope(chapter, selectedBook));
    },
    [onPlay, selectedBook],
  );

  const primePlayChapter = useCallback(
    (chapter: AudiobookCatalogChapter) => {
      if (!selectedBook || !onPrimePlay) return;
      onPrimePlay(catalogChapterEnvelope(chapter, selectedBook));
    },
    [onPrimePlay, selectedBook],
  );

  const playAll = useCallback(() => {
    if (!selectedBook || chapters.length === 0) return;
    const envs = chapters.map((ch) => catalogChapterEnvelope(ch, selectedBook));
    if (onPlayAlbum && envs.length > 1) onPlayAlbum(envs, false);
    else if (envs[0]) onPlay(envs[0]);
  }, [chapters, onPlay, onPlayAlbum, selectedBook]);

  if (selectedBook) {
    return (
      <BookDetailView
        book={selectedBook}
        chapters={chapters}
        loading={loadingChapters}
        activeEnvelopeId={activeEnvelopeId}
        onBack={() => {
          setSelectedBook(null);
          setChapters([]);
        }}
        onPlayChapter={playChapter}
        onPrimePlayChapter={onPrimePlay ? primePlayChapter : undefined}
        onPlayAll={playAll}
        onError={onError}
      />
    );
  }

  return (
    <div className="podcasts-discover audiobooks-discover">
      <div className="podcasts-discover-hero">
        <Globe className="w-5 h-5 text-accent shrink-0" aria-hidden />
        <div>
          <p className="podcasts-discover-hero-title">{t('audiobooks.discoverTitle')}</p>
          <p className="podcasts-discover-hero-lead">{t('audiobooks.discoverLead')}</p>
        </div>
      </div>

      <form
        className="podcasts-discover-search"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(query);
        }}
      >
        <Search className="w-4 h-4 text-[var(--text-dim)] shrink-0" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('audiobooks.searchPlaceholder')}
          className="podcasts-discover-search-input"
          aria-label={t('audiobooks.searchPlaceholder')}
        />
        <button
          type="submit"
          className="podcasts-discover-search-btn touch-manipulation"
          disabled={searching || query.trim().length < 2}
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : t('audiobooks.search')}
        </button>
      </form>

      {results.length > 0 ? (
        <div className="audiobooks-source-filter flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            className={`font-mono text-[9px] uppercase tracking-wider px-2 py-1 rounded border touch-manipulation ${
              sourceFilter === 'all'
                ? 'border-accent text-accent'
                : 'border-[var(--border)] text-[var(--text-dim)]'
            }`}
            onClick={() => setSourceFilter('all')}
          >
            {t('audiobooks.filterAll')}
          </button>
          {AUDIOBOOK_CATALOG_SOURCES.map((src) => (
            <button
              key={src.id}
              type="button"
              className={`font-mono text-[9px] uppercase tracking-wider px-2 py-1 rounded border touch-manipulation ${
                sourceFilter === src.id
                  ? 'border-accent text-accent'
                  : 'border-[var(--border)] text-[var(--text-dim)]'
              }`}
              onClick={() => setSourceFilter(src.id)}
            >
              {src.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="podcasts-discover-section-head">
        <BookOpen className="w-4 h-4 text-accent" aria-hidden />
        <h2 className="podcasts-discover-section-title">
          {results.length > 0
            ? t('audiobooks.resultsFor', { query: query.trim() })
            : t('audiobooks.discoverSources')}
        </h2>
        {searching ? <Loader2 className="w-4 h-4 animate-spin text-accent ml-auto" /> : null}
      </div>

      {results.length === 0 && !searching ? (
        <div className="audiobooks-source-list mb-4">
          {AUDIOBOOK_CATALOG_SOURCES.map((src) => (
            <p key={src.id} className="font-mono text-[10px] text-[var(--text-dim)]">
              {src.label}
            </p>
          ))}
          {userFeedCount > 0 ? (
            <p className="font-mono text-[10px] text-[var(--text-dim)]">
              {t('audiobooks.userRssFeeds', { count: userFeedCount })}
            </p>
          ) : null}
          <p className="font-mono text-xs text-[var(--text-dim)] mt-3">
            {t('audiobooks.discoverHint')}
          </p>
        </div>
      ) : null}

      <section className="podcasts-manual-subscribe mb-4">
        <button
          type="button"
          className="podcasts-manual-subscribe-toggle touch-manipulation"
          aria-expanded={rssExpanded}
          onClick={() => setRssExpanded((v) => !v)}
        >
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-dim)]">
            {t('audiobooks.addRssFeed')}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-[var(--text-dim)] transition-transform${rssExpanded ? ' rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {rssExpanded ? (
          <div className="podcasts-manual-subscribe-body space-y-2 mt-2">
            <p className="font-mono text-[9px] text-[var(--text-dim)]">
              {t('audiobooks.addRssFeedHint')}
            </p>
            <div className="podcasts-subscribe-card">
              <Rss className="w-5 h-5 shrink-0 mt-2.5 text-accent" />
              <input
                type="url"
                value={rssUrl}
                onChange={(e) => setRssUrl(e.target.value)}
                placeholder="https://example.com/audiobook-feed.xml"
                className="input-elevated flex-1 min-w-0 px-3 py-2.5 font-mono text-xs focus-accent"
              />
              <button
                type="button"
                onClick={() => void handleAddRssFeed()}
                disabled={rssAdding || !rssUrl.trim()}
                className="btn-accent touch-manipulation h-10 px-3 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-1.5"
              >
                {rssAdding ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                {t('audiobooks.addRssFeedBtn')}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {results.length === 0 && !searching && query.trim().length >= 2 ? (
        <p className="podcasts-discover-empty font-mono text-xs text-[var(--text-dim)]">
          {t('audiobooks.searchEmpty')}
        </p>
      ) : null}

      {filteredResults.length > 0 ? (
        <div className="podcasts-discover-grid">
          {filteredResults.map((book) => (
            <div key={book.id}>
              <BookCard book={book} onOpen={() => void openBook(book)} />
            </div>
          ))}
        </div>
      ) : results.length > 0 && filteredResults.length === 0 ? (
        <p className="podcasts-discover-empty font-mono text-xs text-[var(--text-dim)]">
          {t('audiobooks.filterEmpty')}
        </p>
      ) : null}
    </div>
  );
}
