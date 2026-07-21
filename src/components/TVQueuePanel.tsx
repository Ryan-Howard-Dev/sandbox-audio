import React, { useEffect, useMemo, useRef } from 'react';
import { Trash2, X } from 'lucide-react';
import type { MediaEnvelope } from '../sandboxLayer1';
import { proxiedArtworkUrl } from '../displaySanitize';
import { seedGradient } from '../seedGradient';
import PlayerArtistLink from './PlayerArtistLink';
import { resolveQueueNowPlaying, resolveQueueUpNext } from '../playbackSession';

export interface TVQueuePanelProps {
  open: boolean;
  onClose: () => void;
  playQueue: MediaEnvelope[];
  queueIndex: number;
  activeEnvelope?: MediaEnvelope | null;
  hasActivePlayback?: boolean;
  onRemove: (index: number) => void;
  onClear: () => void;
  onGoToArtist?: (artist: string) => void;
  onGoToAlbum?: (artist: string, album: string) => void;
}

export default function TVQueuePanel({
  open,
  onClose,
  playQueue,
  queueIndex,
  activeEnvelope = null,
  hasActivePlayback = false,
  onRemove,
  onClear,
  onGoToArtist,
  onGoToAlbum,
}: TVQueuePanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

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

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[55]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="tv-queue-panel fixed top-0 right-0 bottom-0 w-[28rem] max-w-[90vw] z-[60] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Play queue"
      >
        <header className="flex items-center justify-between px-6 py-5 border-b border-[#1e2130]">
          <h2 className="font-display text-xl font-black uppercase tracking-wider text-text-heading">
            Queue
          </h2>
          <div className="flex items-center gap-2">
            {playQueue.length > 0 ? (
              <button
                type="button"
                onClick={onClear}
                className="tv-queue-action px-3 py-2 rounded-lg text-xs font-mono uppercase tracking-wider text-[#9aa3bc] border border-transparent outline-none focus:border-[#C2410C] focus:text-text-primary"
              >
                Clear
              </button>
            ) : null}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="tv-queue-action p-2 rounded-lg outline-none focus:border-[#C2410C] border border-transparent text-[#9aa3bc] focus:text-text-primary"
              aria-label="Close queue"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto music-scrollbar px-4 py-4 space-y-2">
          {!nowPlaying && playQueue.length === 0 ? (
            <p className="text-[#6e758c] text-center py-12">Queue is empty</p>
          ) : (
            <>
              <p className="text-[10px] font-mono uppercase tracking-widest text-[#C2410C] px-2 mb-2">
                Now Playing
              </p>
              {nowPlaying ? (
                <QueueRow
                  env={nowPlaying}
                  active
                  onRemove={() => {
                    const idx = playQueue.findIndex(
                      (e) => e.envelopeId === nowPlaying.envelopeId,
                    );
                    onRemove(idx >= 0 ? idx : queueIndex);
                  }}
                  onGoToArtist={onGoToArtist}
                  onGoToAlbum={onGoToAlbum}
                />
              ) : null}
              {upNext.length > 0 ? (
                <>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[#6e758c] px-2 mt-6 mb-2">
                    Up Next · {upNext.length}
                  </p>
                  {upNext.map((env, i) => {
                    const absIdx = playQueue.findIndex(
                      (e) => e.envelopeId === env.envelopeId,
                    );
                    return (
                    <React.Fragment key={`${env.envelopeId}-${absIdx >= 0 ? absIdx : i}`}>
                      <QueueRow
                        env={env}
                        onRemove={() => onRemove(absIdx >= 0 ? absIdx : queueIndex + 1 + i)}
                      />
                    </React.Fragment>
                    );
                  })}
                </>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function QueueRow({
  env,
  active,
  onRemove,
  onGoToArtist,
  onGoToAlbum,
}: {
  env: MediaEnvelope;
  active?: boolean;
  onRemove: () => void;
  onGoToArtist?: (artist: string) => void;
  onGoToAlbum?: (artist: string, album: string) => void;
}) {
  const art = proxiedArtworkUrl(env.artworkUrl) ?? env.artworkUrl ?? '';
  return (
    <div
      className={`flex items-center gap-3 px-3 py-3 rounded-xl border-2 ${
        active
          ? 'border-[#C2410C] bg-orange-950/20'
          : 'border-transparent bg-[#111420]'
      }`}
    >
      <div
        className="w-12 h-12 rounded-lg shrink-0"
        style={{
          background: art
            ? `url(${art}) center/cover no-repeat, ${seedGradient(env.title)}`
            : seedGradient(env.title),
        }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-text-primary truncate">{env.title}</p>
        {active && onGoToArtist ? (
          <PlayerArtistLink
            artist={env.artist}
            album={env.album}
            onGoToArtist={onGoToArtist}
            onGoToAlbum={onGoToAlbum}
            className="text-sm text-[#9aa3bc] truncate"
          />
        ) : (
          <p className="text-sm text-[#9aa3bc] truncate">{env.artist}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="p-2 rounded-lg text-[#6e758c] outline-none focus:border-[#C2410C] border border-transparent focus:text-text-primary shrink-0"
        aria-label={`Remove ${env.title}`}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
