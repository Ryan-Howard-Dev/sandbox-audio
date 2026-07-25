import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getCachedDiscovery } from '../../discoveryRefresh';

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
  // Backfill a real cover from Open Library when the catalog gave none, so LibriVox / Golden
  // Audiobooks titles don't show a blank gradient.
  const [resolvedArt, setResolvedArt] = useState<string | undefined>(book.artworkUrl);
  useEffect(() => {
    setResolvedArt(book.artworkUrl);
    if (book.artworkUrl) return;
    let cancelled = false;
    void resolveAudiobookCover(book.title, book.author).then((url) => {
      if (!cancelled && url) setResolvedArt(url);
    });
    return () => {
      cancelled = true;
    };
  }, [book.artworkUrl, book.title, book.author]);

  const art = proxiedArtworkUrl(resolvedArt);
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

/** Genre chips under the search bar — mirrors the podcasts station's category row. */
const AUDIOBOOK_DISCOVER_CATEGORIES: { id: string; label: string; query: string }[] = [
  { id: 'fiction', label: 'Fiction', query: 'fiction' },
  { id: 'mystery', label: 'Mystery', query: 'mystery detective' },
  { id: 'scifi', label: 'Sci-Fi', query: 'science fiction' },
  { id: 'classics', label: 'Classics', query: 'classic literature' },
  { id: 'adventure', label: 'Adventure', query: 'adventure' },
  { id: 'horror', label: 'Horror', query: 'horror ghost' },
  { id: 'history', label: 'History', query: 'history' },
  { id: 'philosophy', label: 'Philosophy', query: 'philosophy' },
  { id: 'poetry', label: 'Poetry', query: 'poetry' },
  { id: 'kids', label: 'Kids', query: 'children fairy tales' },
];

const GENERIC_AUTHOR_RE =
  /^(various|unknown|librivox|golden audiobooks|audiobooks?4soul|loyal ?books|lit ?2 ?go|learn ?out ?loud)$/i;
const AUDIOBOOK_SUFFIX_RE =
  /\b(full\s+)?audio[\s-]?books?(\s+online)?\b|\bonline\b|\bfree\b|\bunabridged\b|\bfull\b/gi;

/**
 * Catalog titles often look like "Author – Book Title Audiobook" (Golden Audiobooks etc.).
 * Open Library needs just the book title (+ real author), so strip the author prefix and the
 * "audiobook/online/free" suffixes before searching.
 */
function cleanBookQuery(title: string, author: string): { title: string; author: string } {
  let t = title.trim();
  let a = author.trim();
  const dash = t.match(/^(.+?)\s*[–—-]\s*(.+)$/);
  if (dash) {
    const before = dash[1]!.trim();
    const after = dash[2]!.trim();
    // If the catalog "author" is really a source name, the part before the dash is the author.
    if ((GENERIC_AUTHOR_RE.test(a) || !a) && before && before.length < 40) {
      a = before;
    }
    t = after;
  }
  t = t.replace(AUDIOBOOK_SUFFIX_RE, '').replace(/\s+/g, ' ').trim();
  if (GENERIC_AUTHOR_RE.test(a)) a = '';
  return { title: t, author: a };
}

/** Open Library cover lookup (keyless) for books whose catalog gave no artwork. */
const audiobookCoverCache = new Map<string, string | null>();
async function resolveAudiobookCover(
  rawTitle: string,
  rawAuthor: string,
): Promise<string | undefined> {
  const { title, author } = cleanBookQuery(rawTitle, rawAuthor);
  if (!title) return undefined;
  const key = `${title}|${author}`.toLowerCase();
  if (audiobookCoverCache.has(key)) return audiobookCoverCache.get(key) ?? undefined;
  try {
    const params = new URLSearchParams({ title, limit: '1' });
    if (author) params.set('author', author);
    const res = await fetch(`https://openlibrary.org/search.json?${params.toString()}`, {
      signal: AbortSignal.timeout(7000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      audiobookCoverCache.set(key, null);
      return undefined;
    }
    const data = (await res.json()) as { docs?: Array<{ cover_i?: number }> };
    let coverId = data.docs?.[0]?.cover_i;
    // Retry title-only if the author-qualified search found no cover.
    if (!coverId && author) {
      const res2 = await fetch(
        `https://openlibrary.org/search.json?${new URLSearchParams({ title, limit: '1' }).toString()}`,
        { signal: AbortSignal.timeout(7000), headers: { Accept: 'application/json' } },
      );
      if (res2.ok) {
        const data2 = (await res2.json()) as { docs?: Array<{ cover_i?: number }> };
        coverId = data2.docs?.[0]?.cover_i;
      }
    }
    const url = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null;
    audiobookCoverCache.set(key, url);
    return url ?? undefined;
  } catch {
    audiobookCoverCache.set(key, null);
    return undefined;
  }
}

/** Rotating pool of popular audiobook topics so the featured shelf varies + stays fresh. */
const FEATURED_AUDIOBOOK_TOPICS = [
  'sherlock holmes',
  'dracula',
  'pride and prejudice',
  'adventure',
  'mystery',
  'science fiction',
  'frankenstein',
  'war of the worlds',
  'greek mythology',
  'philosophy',
  'short stories',
  'ghost stories',
  'fairy tales',
  'history',
  'jane austen',
  'edgar allan poe',
];

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Fetch a fresh, shuffled set of featured audiobooks from the free catalogs. */
async function loadFeaturedAudiobooks(): Promise<AudiobookCatalogBook[]> {
  // Cached per the user's Discovery-refresh setting (default 3 days) so it stays stable between
  // visits instead of refetching/reshuffling every time the station opens.
  return getCachedDiscovery(
    'audiobooks-featured',
    async () => {
      const topics = shuffleInPlace([...FEATURED_AUDIOBOOK_TOPICS]).slice(0, 3);
      const batches = await Promise.all(
        topics.map((topic) => searchAudiobookCatalog(topic, 10).catch(() => [])),
      );
      const byId = new Map<string, AudiobookCatalogBook>();
      for (const book of batches.flat()) {
        if (!byId.has(book.id)) byId.set(book.id, book);
      }
      return shuffleInPlace([...byId.values()]).slice(0, 18);
    },
    (books) => books.length === 0,
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
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
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
  const [featured, setFeatured] = useState<AudiobookCatalogBook[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  useEffect(() => {
    return subscribeAudiobookRssFeeds(() => {
      setUserFeedCount(loadUserAudiobookRssFeeds().length);
    });
  }, []);

  // Featured audiobooks shelf — fetch actual browsable books (rotating popular topics, shuffled)
  // so the station opens with something to listen to, like the podcasts trending shelf, instead
  // of a wall of catalog-source names.
  useEffect(() => {
    let cancelled = false;
    setLoadingFeatured(true);
    void loadFeaturedAudiobooks()
      .then((books) => {
        if (!cancelled) setFeatured(books);
      })
      .finally(() => {
        if (!cancelled) setLoadingFeatured(false);
      });
    return () => {
      cancelled = true;
    };
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

  // Guards against a slower older query's response overwriting a newer one's results.
  const searchGenerationRef = useRef(0);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      const generation = ++searchGenerationRef.current;
      if (trimmed.length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const books = await searchAudiobookCatalog(trimmed, 24);
        if (searchGenerationRef.current !== generation) return;
        setResults(books);
      } catch (e) {
        if (searchGenerationRef.current !== generation) return;
        onError?.(e instanceof Error ? e.message : t('audiobooks.searchFailed'));
        setResults([]);
      } finally {
        if (searchGenerationRef.current === generation) setSearching(false);
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

  // Guards against a slower older book's chapter fetch overwriting a newer selection's chapters.
  const chapterGenerationRef = useRef(0);

  const openBook = useCallback(
    async (book: AudiobookCatalogBook) => {
      const generation = ++chapterGenerationRef.current;
      setSelectedBook(book);
      setChapters([]);
      setLoadingChapters(true);
      try {
        const loaded = await fetchAudiobookCatalogChapters(book);
        if (chapterGenerationRef.current !== generation) return;
        setChapters(loaded);
      } catch (e) {
        if (chapterGenerationRef.current !== generation) return;
        onError?.(e instanceof Error ? e.message : t('audiobooks.chaptersFailed'));
        setChapters([]);
      } finally {
        if (chapterGenerationRef.current === generation) setLoadingChapters(false);
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

      {/* Genre chips — mirrors the podcasts station's category row under the search bar. */}
      <div className="podcasts-discover-categories hide-scrollbar">
        {AUDIOBOOK_DISCOVER_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`podcasts-discover-chip touch-manipulation${activeCategory === cat.id ? ' podcasts-discover-chip--active' : ''}`}
            onClick={() => {
              setActiveCategory(cat.id);
              setQuery(cat.query);
              void runSearch(cat.query);
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

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
            : t('audiobooks.featuredHeading')}
        </h2>
        {searching ? <Loader2 className="w-4 h-4 animate-spin text-accent ml-auto" /> : null}
      </div>

      {/* Featured audiobooks — actual browsable books to play, shown when not searching. */}
      {results.length === 0 && !searching ? (
        <>
          {loadingFeatured && featured.length === 0 ? (
            <div className="podcasts-discover-empty font-mono text-xs text-[var(--text-dim)] flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              {t('audiobooks.featuredLoading')}
            </div>
          ) : featured.length > 0 ? (
            <div className="podcasts-discover-grid mb-4">
              {featured.map((book) => (
                <div key={book.id}>
                  <BookCard book={book} onOpen={() => void openBook(book)} />
                </div>
              ))}
            </div>
          ) : null}

          {/* Catalog sources moved out of the main view into a collapsed "where these come from"
              section, so the station leads with books, not a wall of source names. */}
          <section className="podcasts-manual-subscribe mb-4">
            <button
              type="button"
              className="podcasts-manual-subscribe-toggle touch-manipulation"
              aria-expanded={sourcesExpanded}
              onClick={() => setSourcesExpanded((v) => !v)}
            >
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-dim)]">
                {t('audiobooks.discoverSources')}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-[var(--text-dim)] transition-transform${sourcesExpanded ? ' rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            {sourcesExpanded ? (
              <div className="audiobooks-source-list mt-2">
                <div className="flex flex-wrap gap-2">
                  {AUDIOBOOK_CATALOG_SOURCES.map((src) => (
                    <span
                      key={src.id}
                      className="font-mono text-[9px] uppercase tracking-wider px-2 py-1 rounded-full border border-[var(--border)] text-[var(--text-dim)]"
                    >
                      {src.label}
                    </span>
                  ))}
                  {userFeedCount > 0 ? (
                    <span className="font-mono text-[9px] uppercase tracking-wider px-2 py-1 rounded-full border border-accent/40 text-accent">
                      {t('audiobooks.userRssFeeds', { count: userFeedCount })}
                    </span>
                  ) : null}
                </div>
                <p className="font-mono text-xs text-[var(--text-dim)] mt-3">
                  {t('audiobooks.discoverHint')}
                </p>
              </div>
            ) : null}
          </section>
        </>
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
