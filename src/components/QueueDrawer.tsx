import React, { useMemo, useState } from 'react';
import { GripVertical, ListMusic, ListPlus, Play, Trash2, X } from 'lucide-react';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { StoredPlayHit } from '../playHistory';
import { proxiedArtworkUrl } from '../displaySanitize';
import { seedGradient } from '../seedGradient';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';
import PlayerArtistLink from './PlayerArtistLink';
import WhyPickedPanel from './discovery/WhyPickedPanel';
import SovereignUpNextPanel from './SovereignUpNextPanel';
import { useTranslation } from '../i18n';
import { resolveQueueNowPlaying, resolveQueueUpNext } from '../playbackSession';

export type QueueDrawerTab = 'queue' | 'suggested';

export interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
  playQueue: MediaEnvelope[];
  queueIndex: number;
  activeEnvelope?: MediaEnvelope | null;
  hasActivePlayback?: boolean;
  recentHistory: StoredPlayHit[];
  suggestedTracks?: MediaEnvelope[];
  mobile?: boolean;
  showPlayerBarOffset?: boolean;
  onRemove: (index: number) => void;
  onReorderUpNext: (fromRelative: number, toRelative: number) => void;
  onClear: () => void;
  onSaveAsPlaylist: (name: string) => void;
  onAddSuggested?: (env: MediaEnvelope) => void;
  onPlaySuggested?: (env: MediaEnvelope) => void;
  onGoToArtist?: (artist: string) => void;
  onGoToAlbum?: (artist: string, album: string) => void;
}

function SuggestedTrackRow({
  env,
  onGoToArtist,
  onGoToAlbum,
  onPlaySuggested,
  onAddSuggested,
  playLabel,
  addLabel,
}: {
  env: MediaEnvelope;
  onGoToArtist?: (artist: string) => void;
  onGoToAlbum?: (artist: string, album: string) => void;
  onPlaySuggested?: (env: MediaEnvelope) => void;
  onAddSuggested?: (env: MediaEnvelope) => void;
  playLabel: string;
  addLabel: string;
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  return (
    <>
      <div className="queue-drawer-row queue-drawer-row--suggested group">
        <TrackBadge title={env.title} artworkUrl={env.artworkUrl} />
        <div className="queue-drawer-row-text min-w-0 flex-1">
          <p className="queue-drawer-row-title truncate">{env.title}</p>
          {onGoToArtist ? (
            <PlayerArtistLink
              artist={env.artist || ''}
              album={env.album}
              onGoToArtist={onGoToArtist}
              onGoToAlbum={onGoToAlbum}
              className="queue-drawer-row-artist truncate"
            />
          ) : (
            <p className="queue-drawer-row-artist truncate">{env.artist || '—'}</p>
          )}
        </div>
        <div className="queue-drawer-suggested-actions">
          <button
            type="button"
            className="queue-drawer-suggested-btn touch-manipulation"
            aria-label="Why this song"
            onClick={() => setWhyOpen((v) => !v)}
          >
            Why?
          </button>
          {onPlaySuggested ? (
            <button
              type="button"
              className="queue-drawer-suggested-btn touch-manipulation"
              aria-label={playLabel}
              onClick={() => onPlaySuggested(env)}
            >
              <Play className="w-4 h-4 ml-0.5" />
            </button>
          ) : null}
          {onAddSuggested ? (
            <button
              type="button"
              className="queue-drawer-suggested-btn touch-manipulation"
              aria-label={addLabel}
              onClick={() => onAddSuggested(env)}
            >
              <ListPlus className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
      {whyOpen ? (
        <div className="queue-drawer-why-panel">
          <WhyPickedPanel envelope={env} />
        </div>
      ) : null}
    </>
  );
}

function TrackBadge({
  title,
  artworkUrl,
  muted,
}: {
  title: string;
  artworkUrl?: string;
  muted?: boolean;
}) {
  const art = proxiedArtworkUrl(artworkUrl) ?? artworkUrl ?? '';
  return (
    <div
      className={`queue-drawer-badge shrink-0 ${muted ? 'queue-drawer-badge--muted' : ''}`}
      style={{
        background: art
          ? `url(${art}) center/cover no-repeat, ${seedGradient(title)}`
          : seedGradient(title),
      }}
      aria-hidden
    />
  );
}

function QueueRow({
  env,
  index,
  label,
  muted,
  draggable,
  dragRelativeIndex,
  onRemove,
  onReorderUpNext,
  onGoToArtist,
  onGoToAlbum,
}: {
  env: MediaEnvelope | StoredPlayHit;
  index?: number;
  label?: string;
  muted?: boolean;
  draggable?: boolean;
  dragRelativeIndex?: number;
  onRemove?: (index: number) => void;
  onReorderUpNext?: (from: number, to: number) => void;
  onGoToArtist?: (artist: string) => void;
  onGoToAlbum?: (artist: string, album: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const title = env.title;
  const artist = env.artist;
  const album = 'album' in env ? env.album : undefined;
  const artworkUrl = 'artworkUrl' in env ? env.artworkUrl : undefined;

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        if (dragRelativeIndex === undefined) return;
        setDragging(true);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragRelativeIndex));
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (!draggable || dragRelativeIndex === undefined || !onReorderUpNext) return;
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (Number.isNaN(from) || from === dragRelativeIndex) return;
        onReorderUpNext(from, dragRelativeIndex);
        setDragging(false);
      }}
      className={`queue-drawer-row group ${muted ? 'queue-drawer-row--muted' : ''} ${
        dragging ? 'queue-drawer-row--dragging' : ''
      } ${label ? 'queue-drawer-row--active' : ''}`}
    >
      {draggable ? (
        <span
          className="queue-drawer-grip shrink-0"
          aria-hidden
          title="Drag to reorder"
        >
          <GripVertical className="w-3.5 h-3.5" strokeWidth={2} />
        </span>
      ) : null}
      <TrackBadge title={title} artworkUrl={artworkUrl} muted={muted} />
      <div className="queue-drawer-row-text min-w-0 flex-1">
        {label ? (
          <span className="queue-drawer-row-label">{label}</span>
        ) : null}
        <p className="queue-drawer-row-title truncate">{title}</p>
        {onGoToArtist ? (
          <PlayerArtistLink
            artist={artist || ''}
            album={album}
            onGoToArtist={onGoToArtist}
            onGoToAlbum={onGoToAlbum}
            className="queue-drawer-row-artist truncate"
          />
        ) : (
          <p className="queue-drawer-row-artist truncate">{artist || '—'}</p>
        )}
      </div>
      {onRemove !== undefined && index !== undefined ? (
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="queue-drawer-remove touch-manipulation"
          aria-label={`Remove ${title} from queue`}
        >
          <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

export default function QueueDrawer({
  open,
  onClose,
  playQueue,
  queueIndex,
  activeEnvelope = null,
  hasActivePlayback = false,
  recentHistory,
  suggestedTracks = [],
  mobile = false,
  showPlayerBarOffset = true,
  onRemove,
  onReorderUpNext,
  onClear,
  onSaveAsPlaylist,
  onAddSuggested,
  onPlaySuggested,
  onGoToArtist,
  onGoToAlbum,
}: QueueDrawerProps) {
  useDismissableOverlay(open, onClose);
  const { t } = useTranslation();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [activeTab, setActiveTab] = useState<QueueDrawerTab>('queue');

  const nowPlaying = useMemo(
    () =>
      resolveQueueNowPlaying(
        playQueue,
        queueIndex,
        activeEnvelope,
        hasActivePlayback,
      ),
    [playQueue, queueIndex, activeEnvelope, hasActivePlayback],
  );
  const upNext = useMemo(
    () => resolveQueueUpNext(playQueue, queueIndex, nowPlaying),
    [playQueue, queueIndex, nowPlaying],
  );
  const currentId = nowPlaying?.envelopeId;
  const previouslyPlayed = useMemo(
    () =>
      recentHistory
        .filter((h) => h.envelopeId !== currentId)
        .slice(0, 5),
    [recentHistory, currentId],
  );

  const offsetClass = showPlayerBarOffset ? 'queue-drawer--above-player' : '';
  const mobileClass = mobile ? ' queue-drawer-panel--mobile' : '';

  if (!open) return null;

  const defaultSaveName = `Queue ${new Date().toLocaleDateString()}`;
  const showSuggestedTab = suggestedTracks.length > 0 || mobile;

  return (
    <>
      <button
        type="button"
        className={`queue-drawer-backdrop ${offsetClass}${mobile ? ' queue-drawer-backdrop--mobile' : ''}`}
        aria-label="Close queue"
        onClick={onClose}
      />
      <aside
        className={`queue-drawer-panel ${offsetClass}${mobileClass} queue-drawer-panel--open`}
        role="dialog"
        aria-modal="true"
        aria-label={t('player.queueDrawer.title')}
      >
        <header className="queue-drawer-header">
          <div className="flex items-center gap-2 min-w-0">
            <ListMusic className="w-4 h-4 shrink-0 text-accent" strokeWidth={2} />
            <span className="queue-drawer-heading">{t('player.queueDrawer.title')}</span>
            {activeTab === 'queue' ? (
              <span className="queue-drawer-count">{playQueue.length}</span>
            ) : (
              <span className="queue-drawer-count">{suggestedTracks.length}</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {activeTab === 'queue' && playQueue.length > 0 ? (
              <button
                type="button"
                onClick={onClear}
                className="queue-drawer-clear touch-manipulation"
              >
                {t('player.queueDrawer.clear')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="queue-drawer-close touch-manipulation"
              aria-label="Close queue drawer"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </header>

        {showSuggestedTab ? (
          <nav className="queue-drawer-tabs" aria-label={t('player.queueDrawer.tabsAria')}>
            <button
              type="button"
              className={`queue-drawer-tab touch-manipulation${
                activeTab === 'queue' ? ' queue-drawer-tab--active' : ''
              }`}
              onClick={() => setActiveTab('queue')}
            >
              {t('player.queueDrawer.tabQueue')}
            </button>
            <button
              type="button"
              className={`queue-drawer-tab touch-manipulation${
                activeTab === 'suggested' ? ' queue-drawer-tab--active' : ''
              }`}
              onClick={() => setActiveTab('suggested')}
            >
              {t('player.queueDrawer.tabSuggested')}
            </button>
          </nav>
        ) : null}

        {activeTab === 'queue' ? <SovereignUpNextPanel /> : null}

        <div className="queue-drawer-body music-scrollbar">
          {activeTab === 'suggested' ? (
            suggestedTracks.length === 0 ? (
              <p className="queue-drawer-empty">{t('player.queueDrawer.suggestedEmpty')}</p>
            ) : (
              <section className="queue-drawer-section">
                <ul className="queue-drawer-list">
                  {suggestedTracks.map((env) => (
                    <li key={env.envelopeId}>
                      <SuggestedTrackRow
                        env={env}
                        onGoToArtist={onGoToArtist}
                        onGoToAlbum={onGoToAlbum}
                        onPlaySuggested={onPlaySuggested}
                        onAddSuggested={onAddSuggested}
                        playLabel={t('player.play')}
                        addLabel={t('player.queueDrawer.addSuggested')}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )
          ) : !nowPlaying && playQueue.length === 0 ? (
            <p className="queue-drawer-empty">{t('player.queueDrawer.empty')}</p>
          ) : (
            <>
              {nowPlaying ? (
                <section className="queue-drawer-section queue-drawer-section--now">
                  <h3 className="queue-drawer-section-title">Now Playing</h3>
                  <QueueRow
                    env={nowPlaying}
                    label="Now"
                    onGoToArtist={onGoToArtist}
                    onGoToAlbum={onGoToAlbum}
                  />
                </section>
              ) : null}

              {previouslyPlayed.length > 0 ? (
                <section className="queue-drawer-section">
                  <h3 className="queue-drawer-section-title">Recently Played</h3>
                  <ul className="queue-drawer-list">
                    {previouslyPlayed.map((hit) => (
                      <li key={hit.envelopeId}>
                        <QueueRow env={hit} muted />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {upNext.length > 0 ? (
                <section className="queue-drawer-section">
                  <h3 className="queue-drawer-section-title">Up Next</h3>
                  <ul className="queue-drawer-list">
                    {upNext.map((env, relIdx) => {
                      const absIdx = playQueue.findIndex(
                        (e) => e.envelopeId === env.envelopeId,
                      );
                      return (
                        <li key={`${env.envelopeId}-${absIdx >= 0 ? absIdx : relIdx}`}>
                          <QueueRow
                            env={env}
                            index={absIdx}
                            draggable
                            dragRelativeIndex={relIdx}
                            onRemove={onRemove}
                            onReorderUpNext={onReorderUpNext}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>

        <footer className="queue-drawer-footer">
          {activeTab === 'queue' && (saveOpen ? (
            <div className="queue-drawer-save-form">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={defaultSaveName}
                className="queue-drawer-save-input focus-accent"
                aria-label="Playlist name"
              />
              <button
                type="button"
                disabled={playQueue.length === 0}
                className="queue-drawer-save-confirm touch-manipulation"
                onClick={() => {
                  onSaveAsPlaylist(saveName.trim() || defaultSaveName);
                  setSaveName('');
                  setSaveOpen(false);
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="queue-drawer-save-cancel touch-manipulation"
                onClick={() => {
                  setSaveOpen(false);
                  setSaveName('');
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={playQueue.length === 0}
              className="queue-drawer-save-btn touch-manipulation"
              onClick={() => setSaveOpen(true)}
            >
              {t('player.queueDrawer.saveAsPlaylist')}
            </button>
          ))}
        </footer>
      </aside>
    </>
  );
}
