import React, { useCallback, useEffect, useRef } from 'react';
import { Play, ListMusic, Disc3 } from 'lucide-react';
import { proxiedArtworkUrl } from '../displaySanitize';
import { seedGradient } from '../seedGradient';

export interface TVCardItem {
  id: string;
  title: string;
  subtitle: string;
  artworkUrl?: string;
  badge?: string;
}

export interface TVHomeViewProps {
  continueListening: TVCardItem[];
  recentlyAdded: TVCardItem[];
  playlists: TVCardItem[];
  collections: TVCardItem[];
  onSelect: (id: string, row: TVRowId) => void;
  onOpenPlayback?: () => void;
  nowPlaying?: TVCardItem | null;
  isPlaying?: boolean;
}

export type TVRowId = 'continue' | 'recent' | 'playlists' | 'collections';

const ROW_META: Array<{ id: TVRowId; label: string; icon: React.ElementType }> = [
  { id: 'continue', label: 'Continue Listening', icon: Play },
  { id: 'recent', label: 'Recently Added', icon: Disc3 },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'collections', label: 'Collections', icon: Disc3 },
];

function TVCard({
  item,
  row,
  onSelect,
  onFocusNeighbor,
}: {
  item: TVCardItem;
  row: TVRowId;
  onSelect: (id: string, row: TVRowId) => void;
  onFocusNeighbor: (direction: 'left' | 'right') => void;
}) {
  const art =
    proxiedArtworkUrl(item.artworkUrl) ?? item.artworkUrl ?? '';
  const gradient = seedGradient(item.title || item.subtitle);

  return (
    <button
      type="button"
      data-tv-card
      data-row={row}
      data-id={item.id}
      onClick={() => onSelect(item.id, row)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onFocusNeighbor('left');
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onFocusNeighbor('right');
        }
      }}
      className="tv-card shrink-0 w-52 h-64 rounded-2xl border-2 border-transparent bg-[#0d0f16] overflow-hidden text-left transition-all duration-200 outline-none focus:border-[#C2410C] focus:ring-4 focus:ring-[#C2410C]/30 focus:scale-[1.04] hover:border-[#C2410C]/50"
    >
      <div
        className="tv-card-art h-36 w-full"
        style={{
          background: art
            ? `url(${art}) center/cover no-repeat, ${gradient}`
            : gradient,
        }}
        aria-hidden
      />
      <div className="p-4 flex flex-col gap-1 min-w-0">
        <p className="font-display text-lg font-bold text-text-heading truncate">{item.title}</p>
        <p className="text-sm text-[#9aa3bc] truncate">{item.subtitle}</p>
        {item.badge ? (
          <span className="mt-1 inline-flex self-start px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border border-[#C2410C]/40 text-[#C2410C]">
            {item.badge}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function TVRow({
  rowId,
  label,
  icon: Icon,
  items,
  onSelect,
  rowRef,
}: {
  rowId: TVRowId;
  label: string;
  icon: React.ElementType;
  items: TVCardItem[];
  onSelect: (id: string, row: TVRowId) => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const focusCardAt = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const cards = scroller.querySelectorAll<HTMLButtonElement>('[data-tv-card]');
    const card = cards[Math.max(0, Math.min(index, cards.length - 1))];
    card?.focus();
    card?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="tv-row mb-10" data-tv-row={rowId} ref={rowRef}>
      <div className="flex items-center gap-3 mb-4 px-10">
        <Icon className="w-6 h-6 text-[#C2410C]" strokeWidth={2} />
        <h2 className="font-display text-2xl font-black uppercase tracking-wider text-text-heading">
          {label}
        </h2>
      </div>
      <div
        ref={scrollerRef}
        className="tv-row-scroller flex gap-5 overflow-x-auto px-10 pb-2 music-scrollbar"
        role="list"
      >
        {items.map((item, index) => (
          <React.Fragment key={`${rowId}-${item.id}`}>
            <TVCard
              item={item}
              row={rowId}
              onSelect={onSelect}
              onFocusNeighbor={(dir) => {
                focusCardAt(dir === 'left' ? index - 1 : index + 1);
              }}
            />
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

export default function TVHomeView({
  continueListening,
  recentlyAdded,
  playlists,
  collections,
  onSelect,
  onOpenPlayback,
  nowPlaying,
  isPlaying,
}: TVHomeViewProps) {
  const rowRefs = useRef<Partial<Record<TVRowId, HTMLDivElement | null>>>({});
  const rowOrder = ROW_META.map((r) => r.id).filter((id) => {
    const map: Record<TVRowId, TVCardItem[]> = {
      continue: continueListening,
      recent: recentlyAdded,
      playlists,
      collections,
    };
    return map[id].length > 0;
  });

  useEffect(() => {
    const firstCard = document.querySelector<HTMLButtonElement>('[data-tv-card]');
    firstCard?.focus();
  }, [rowOrder]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const card = active?.closest?.('[data-tv-card]') as HTMLElement | null;
      if (!card) return;

      const row = card.dataset.row as TVRowId | undefined;
      if (!row) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const idx = rowOrder.indexOf(row);
        if (idx < 0) return;
        const nextIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
        const nextRow = rowOrder[nextIdx];
        if (!nextRow) return;
        const rowEl = rowRefs.current[nextRow];
        const firstCard = rowEl?.querySelector<HTMLButtonElement>('[data-tv-card]');
        firstCard?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rowOrder]);

  const rowsData: Record<TVRowId, TVCardItem[]> = {
    continue: continueListening,
    recent: recentlyAdded,
    playlists,
    collections,
  };

  return (
    <div className="tv-home flex flex-col min-h-0 flex-1 overflow-y-auto music-scrollbar py-8">
      <header className="px-10 mb-8 flex items-end justify-between gap-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-[#6e758c] mb-2">
            Sovereign Music Console
          </p>
          <h1 className="font-display text-4xl font-black uppercase tracking-wider text-text-heading">
            Home
          </h1>
        </div>
        {nowPlaying ? (
          <button
            type="button"
            onClick={onOpenPlayback}
            className="tv-now-playing-pill flex items-center gap-4 px-5 py-3 rounded-2xl border-2 border-transparent bg-[#111420] outline-none focus:border-[#C2410C] focus:ring-4 focus:ring-[#C2410C]/30 transition-all"
          >
            <div
              className="w-12 h-12 rounded-lg shrink-0"
              style={{
                background: nowPlaying.artworkUrl
                  ? `url(${proxiedArtworkUrl(nowPlaying.artworkUrl) ?? nowPlaying.artworkUrl}) center/cover`
                  : seedGradient(nowPlaying.title),
              }}
              aria-hidden
            />
            <div className="text-left min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-widest text-[#C2410C]">
                {isPlaying ? 'Now Playing' : 'Paused'}
              </p>
              <p className="font-semibold text-text-primary truncate max-w-[14rem]">{nowPlaying.title}</p>
            </div>
          </button>
        ) : null}
      </header>

      {ROW_META.map(({ id, label, icon }) => (
        <React.Fragment key={id}>
          <TVRow
            rowId={id}
            label={label}
            icon={icon}
            items={rowsData[id]}
            onSelect={onSelect}
            rowRef={(el) => {
              rowRefs.current[id] = el;
            }}
          />
        </React.Fragment>
      ))}

      {rowOrder.length === 0 ? (
        <div className="px-10 py-16 text-center">
          <p className="font-display text-2xl font-bold text-text-heading mb-2">Your library is empty</p>
          <p className="text-[#9aa3bc] text-lg">
            Open Local Library from the left menu to upload tracks.
          </p>
        </div>
      ) : null}
    </div>
  );
}
