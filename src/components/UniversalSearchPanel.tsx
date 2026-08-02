import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Disc3, Loader2, Podcast } from 'lucide-react';
import { seedGradient } from '../seedGradient';
import {
  browseFormatIdle,
  buildFormatTasteRows,
  searchEverything,
  totalUniversalHits,
  type UniversalFormat,
  type UniversalHit,
  type UniversalSearchResults,
} from '../universalSearch';
import { loadSubscriptions } from '../podcastStorage';
import { useTranslation } from '../i18n';

export interface UniversalSearchPanelProps {
  query: string;
  /** Music catalog search, injected so this panel does not pull in searchCatalog itself. */
  musicSearch?: (q: string) => Promise<UniversalHit[]>;
  onSelect: (hit: UniversalHit) => void;
  /** "See all in <format>" — opens that pillar's own surface. */
  onOpenFormat?: (format: UniversalFormat) => void;
  /** Controlled format selection (lifted so the host can scope the rest of the sheet). */
  format?: UniversalFormat;
  onFormatChange?: (format: UniversalFormat) => void;
  /** Render only the tab bar (the host places results separately). */
  tabsOnly?: boolean;
  /** Render only the results (tabs rendered elsewhere). */
  resultsOnly?: boolean;
  /** Authors the user already owns — seeds the Books taste row. */
  bookAuthorSeeds?: string[];
  /** Book titles already on the device — excluded from Books recommendations. */
  bookOwnedTitles?: string[];
}

const TABS: Array<{ id: UniversalFormat; label: string; icon: React.ElementType }> = [
  { id: 'music', label: 'Music', icon: Disc3 },
  { id: 'podcast', label: 'Pods', icon: Podcast },
  { id: 'audiobook', label: 'Books', icon: BookOpen },
];

const EMPTY: UniversalSearchResults = {
  query: '',
  music: [],
  podcast: [],
  audiobook: [],
  failed: [],
};

export default function UniversalSearchPanel({
  query,
  musicSearch,
  onSelect,
  onOpenFormat,
  format,
  onFormatChange,
  tabsOnly = false,
  resultsOnly = false,
  bookAuthorSeeds,
  bookOwnedTitles,
}: UniversalSearchPanelProps) {
  const { t } = useTranslation();
  const [results, setResults] = useState<UniversalSearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [localTab, setLocalTab] = useState<UniversalFormat>('music');
  const tab = format ?? localTab;
  const setTab = (next: UniversalFormat) => {
    setLocalTab(next);
    onFormatChange?.(next);
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Debounced so typing does not fire a fan-out per keystroke.
    const timer = setTimeout(() => {
      void searchEverything(q, musicSearch)
        .then((res) => {
          if (!cancelled) setResults(res);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, musicSearch]);

  const counts = useMemo(
    () => ({
      music: results.music.length,
      podcast: results.podcast.length,
      audiobook: results.audiobook.length,
    }),
    [results],
  );

  const total = totalUniversalHits(results);
  const hasQuery = query.trim().length >= 2;

  // Idle browse for Pods/Books so those tabs are never a blank screen before typing.
  const [idleRows, setIdleRows] = useState<UniversalHit[]>([]);
  const [idleLoading, setIdleLoading] = useState(false);
  const [personalised, setPersonalised] = useState(false);
  useEffect(() => {
    if (hasQuery || tab === 'music' || tabsOnly) {
      setIdleRows([]);
      return;
    }
    let cancelled = false;
    setIdleLoading(true);
    // Seed from what the user already has, so the idle row is a recommendation rather
    // than a generic chart: subscribed shows for podcasts, owned authors for books.
    const subs = tab === 'podcast' ? loadSubscriptions() : [];
    const seeds =
      tab === 'podcast'
        ? subs.map((s) => s.title).filter(Boolean).slice(0, 6)
        : (bookAuthorSeeds ?? []);
    const ownedKeys = new Set(
      (tab === 'podcast' ? subs.map((s) => s.title) : bookOwnedTitles ?? []).map((t) =>
        (t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      ),
    );
    setPersonalised(seeds.length > 0);
    void buildFormatTasteRows(tab, seeds, ownedKeys)
      .then((rows) => {
        if (!cancelled) setIdleRows(rows);
      })
      .catch(() => {
        if (!cancelled) setIdleRows([]);
      })
      .finally(() => {
        if (!cancelled) setIdleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, hasQuery, tabsOnly, bookAuthorSeeds, bookOwnedTitles]);

  const rows = hasQuery ? results[tab] : idleRows;

  // Tabs are always visible: search opens on a format decision, so the chooser must be
  // present before anything is typed. Results appear once there is a query.
  const tabBar = (
    <nav className="universal-search-tabs" role="tablist">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`universal-tab-${t.id}`}
              className={`universal-search-tab touch-manipulation${
                active ? ' universal-search-tab--active' : ''
              }`}
              onClick={() => setTab(t.id)}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden />
              {t.label}
              {counts[t.id] > 0 ? (
                <span className="universal-search-tab-count">{counts[t.id]}</span>
              ) : null}
            </button>
          );
        })}
      </nav>
  );

  const resultsBody = (
    <>
      {((hasQuery && loading && total === 0) || (!hasQuery && idleLoading)) ? (
        <div className="universal-search-loading">
          <Loader2 className="w-4 h-4 animate-spin text-accent" aria-hidden />
        </div>
      ) : null}

      {hasQuery && !loading && total === 0 ? (
        <p className="universal-search-empty">No results across music, pods or books.</p>
      ) : null}

      {!hasQuery && !idleLoading && rows.length > 0 ? (
        <p className="universal-search-note">
          {personalised
            ? tab === 'podcast'
              ? 'Shows like the ones you follow'
              : 'Books from authors you have'
            : tab === 'podcast'
              ? 'Trending shows'
              : 'Featured books'}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="universal-search-list">
          {rows.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                className="universal-search-row touch-manipulation"
                onClick={() => onSelect(hit)}
              >
                <span className="universal-search-art" aria-hidden>
                  {hit.artworkUrl ? (
                    <img src={hit.artworkUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span
                      className="universal-search-art-fallback"
                      style={{ background: seedGradient(`${hit.title}-${hit.subtitle}`) }}
                    />
                  )}
                </span>
                <span className="universal-search-meta">
                  <span className="universal-search-title">{hit.title}</span>
                  <span className="universal-search-sub">{hit.subtitle}</span>
                </span>
                {hit.owned ? (
                  <span className="universal-search-owned">In library</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {rows.length > 0 && onOpenFormat ? (
        <button
          type="button"
          className="universal-search-seeall touch-manipulation"
          onClick={() => onOpenFormat(tab)}
        >
          See all in {TABS.find((t) => t.id === tab)?.label}
        </button>
      ) : null}

      {results.failed.length > 0 ? (
        <p className="universal-search-note">
          {results.failed
            .map((f) => TABS.find((t) => t.id === f)?.label ?? f)
            .join(', ')}{' '}
          search unavailable right now.
        </p>
      ) : null}
    </>
  );

  if (tabsOnly) return tabBar;
  if (resultsOnly) return <section className="universal-search">{resultsBody}</section>;
  return (
    <section className="universal-search" aria-label={t('shell.searchResultsAria')}>
      {tabBar}
      {resultsBody}
    </section>
  );
}
