import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  GripVertical,
  ListPlus,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { MixRadioSession } from '../playerMixRadio';
import { proxiedArtworkUrl } from '../displaySanitize';
import { seedGradient } from '../seedGradient';
import { buildPlayerQueueRows } from '../playerQueueRows';
import { resolveQueueSourceName } from '../queueSourceName';
import { formatTime } from '../stations/theme';
import { useTranslation } from '../i18n';
import MixRadioChips from './MixRadioChips';

export interface PlayerQueueSheetProps {
  open: boolean;
  onClose: () => void;
  playQueue: MediaEnvelope[];
  queueIndex: number;
  activeEnvelope?: MediaEnvelope | null;
  mixRadioSession?: MixRadioSession | null;
  /** Whole-sentence fallback ("Playing from locker") for queues no mix session can name. */
  playingFromLabel?: string;
  title: string;
  artist: string;
  albumArt: string;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onPlayQueueIndex?: (index: number) => void;
  onRemove?: (index: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /** Primary button, not a menu item — saving the queue you are hearing is the point of this sheet. */
  onSaveQueue?: () => void;
  saveDisabled?: boolean;
  mixRadioEnabled?: boolean;
  onTrackRadio?: () => void;
  onArtistMix?: () => void;
  onAddToPlaylist?: () => void;
}

function QueueArt({
  title,
  artworkUrl,
  current,
  playing,
  eqLabel,
}: {
  title: string;
  artworkUrl?: string;
  current: boolean;
  playing: boolean;
  eqLabel: string;
}) {
  const art = proxiedArtworkUrl(artworkUrl) ?? artworkUrl ?? '';
  return (
    <span
      className="player-queue-art shrink-0"
      style={{
        background: art
          ? `url(${art}) center/cover no-repeat, ${seedGradient(title)}`
          : seedGradient(title),
      }}
      aria-hidden={!current}
    >
      {current ? (
        <span
          className={`player-queue-eq${playing ? '' : ' player-queue-eq--paused'}`}
          role="img"
          aria-label={eqLabel}
        >
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </span>
  );
}

export default function PlayerQueueSheet({
  open,
  onClose,
  playQueue,
  queueIndex,
  activeEnvelope = null,
  mixRadioSession = null,
  playingFromLabel,
  title,
  artist,
  albumArt,
  isPlaying,
  onTogglePlay,
  onSkipBack,
  onSkipForward,
  onPlayQueueIndex,
  onRemove,
  onReorder,
  onSaveQueue,
  saveDisabled = false,
  mixRadioEnabled = false,
  onTrackRadio,
  onArtistMix,
  onAddToPlaylist,
}: PlayerQueueSheetProps) {
  const { t } = useTranslation();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const rows = useMemo(
    () => buildPlayerQueueRows(playQueue, queueIndex, activeEnvelope),
    [playQueue, queueIndex, activeEnvelope],
  );

  const sourceName = useMemo(
    () => resolveQueueSourceName(mixRadioSession),
    [mixRadioSession],
  );
  const sourceText = sourceName
    ? t(`player.queueSheet.${sourceName.key}`, sourceName.params)
    : (playingFromLabel ?? '').trim();

  const barArt = proxiedArtworkUrl(albumArt) ?? albumArt ?? '';

  return (
    <section
      className={`player-queue-sheet${open ? ' player-queue-sheet--open' : ''}`}
      aria-hidden={!open}
      aria-label={t('player.queueSheet.title')}
    >
      {/*
        Transport stays on screen while the queue is open. Collapsing the player into a bar rather
        than replacing it is the whole reason this is a sheet and not the separate queue drawer —
        the drawer took play/pause away with it.
      */}
      <div className="player-queue-bar">
        <span
          className="player-queue-bar-art shrink-0"
          style={{
            background: barArt
              ? `url(${barArt}) center/cover no-repeat, ${seedGradient(title || 'Sandbox')}`
              : seedGradient(title || 'Sandbox'),
          }}
          aria-hidden
        />
        <span className="player-queue-bar-text min-w-0 flex-1">
          <span className="player-queue-bar-title truncate">{title}</span>
          <span className="player-queue-bar-artist truncate">{artist}</span>
        </span>
        <button
          type="button"
          className="player-queue-bar-btn touch-manipulation"
          onClick={onSkipBack}
          aria-label={t('player.skipBack')}
        >
          <SkipBack className="w-4 h-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="player-queue-bar-btn player-queue-bar-btn--play touch-manipulation"
          onClick={onTogglePlay}
          aria-label={isPlaying ? t('player.pause') : t('player.play')}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" strokeWidth={2} />
          ) : (
            <Play className="w-4 h-4 fill-current" strokeWidth={2} />
          )}
        </button>
        <button
          type="button"
          className="player-queue-bar-btn touch-manipulation"
          onClick={onSkipForward}
          aria-label={t('player.skipForward')}
        >
          <SkipForward className="w-4 h-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="player-queue-bar-btn touch-manipulation"
          onClick={onClose}
          aria-label={t('player.queueSheet.close')}
        >
          <ChevronDown className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>

      <div className="player-queue-source">
        <span className="player-queue-source-text min-w-0">
          {sourceName ? (
            <>
              <span className="player-queue-source-eyebrow">
                {t('player.queueSheet.playingFrom')}
              </span>
              <span className="player-queue-source-name truncate">{sourceText}</span>
            </>
          ) : (
            <span className="player-queue-source-name truncate">{sourceText}</span>
          )}
        </span>
        {onSaveQueue ? (
          <button
            type="button"
            className="player-queue-save touch-manipulation"
            onClick={onSaveQueue}
            disabled={saveDisabled}
          >
            <ListPlus className="w-4 h-4" strokeWidth={2} />
            <span>{t('player.queueSheet.save')}</span>
          </button>
        ) : null}
      </div>

      <MixRadioChips
        enabled={mixRadioEnabled}
        onTrackRadio={onTrackRadio}
        onArtistMix={onArtistMix}
        onAddToPlaylist={onAddToPlaylist}
        className="player-chip-row--queue"
      />

      {rows.length === 0 ? (
        <p className="player-queue-empty">{t('player.queueSheet.empty')}</p>
      ) : (
        <ul ref={listRef} className="player-queue-list music-scrollbar">
          {rows.map((row) => {
            const env = row.envelope;
            const duration = env.durationSeconds ?? 0;
            const meta = duration > 0
              ? `${env.artist || '—'} • ${formatTime(duration)}`
              : env.artist || '—';
            return (
              <li
                key={`${env.envelopeId}-${row.index}`}
                className={`player-queue-row${row.current ? ' player-queue-row--current' : ''}${
                  dragFrom === row.index ? ' player-queue-row--dragging' : ''
                }`}
                draggable={Boolean(onReorder)}
                onDragStart={(e) => {
                  if (!onReorder) return;
                  setDragFrom(row.index);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(row.index));
                }}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={(e) => {
                  if (onReorder) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (!onReorder) return;
                  e.preventDefault();
                  const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                  setDragFrom(null);
                  if (Number.isNaN(from) || from === row.index) return;
                  onReorder(from, row.index);
                }}
              >
                <button
                  type="button"
                  className="player-queue-row-main touch-manipulation"
                  onClick={() => onPlayQueueIndex?.(row.index)}
                  disabled={!onPlayQueueIndex}
                >
                  <QueueArt
                    title={env.title}
                    artworkUrl={env.artworkUrl}
                    current={row.current}
                    playing={isPlaying}
                    eqLabel={t('player.queueSheet.nowPlayingRow')}
                  />
                  <span className="player-queue-row-text min-w-0 flex-1">
                    <span className="player-queue-row-title truncate">{env.title}</span>
                    <span className="player-queue-row-meta truncate">{meta}</span>
                  </span>
                </button>
                {onRemove ? (
                  <button
                    type="button"
                    className="player-queue-row-remove touch-manipulation"
                    onClick={() => onRemove(row.index)}
                    aria-label={t('player.queueSheet.remove', { title: env.title })}
                  >
                    ×
                  </button>
                ) : null}
                {onReorder ? (
                  <span className="player-queue-row-grip shrink-0" aria-hidden>
                    <GripVertical className="w-4 h-4" strokeWidth={2} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
