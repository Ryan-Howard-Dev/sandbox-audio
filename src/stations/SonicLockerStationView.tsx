import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play, Radio, RefreshCw } from 'lucide-react';
import TasteRecipePanel from '../components/TasteRecipePanel';
import type { MediaEnvelope } from '../sandboxLayer1';
import {
  buildSonicLockerQueue,
  getSonicLockerScoringKey,
  type SonicLockerPick,
} from '../sonicLockerRadio';
import TasteFactorBar from '../components/discovery/TasteFactorBar';
import RecommendTrackControls from '../components/discovery/RecommendTrackControls';
import { LocalOfflineBadge } from '../components/discovery/LocalOfflineBadge';

import { formatTime } from './theme';

export interface SonicLockerStationViewProps {
  lockerTracks: MediaEnvelope[];
  activeEnvelopeId: string | null;
  playing: boolean;
  onPlayQueue: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  onPlayTrack: (env: MediaEnvelope) => void;
  onSaveMix?: (tracks: MediaEnvelope[]) => void;
  onStartDiscoveryStation?: (tracks: MediaEnvelope[]) => void;
}

export default function SonicLockerStationView({
  lockerTracks,
  activeEnvelopeId,
  playing,
  onPlayQueue,
  onPlayTrack,
  onSaveMix,
  onStartDiscoveryStation,
}: SonicLockerStationViewProps) {
  const [picks, setPicks] = useState<SonicLockerPick[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recipeApplied, setRecipeApplied] = useState(false);

  const scoringKey = getSonicLockerScoringKey(lockerTracks);

  const refreshQueue = useCallback(() => {
    setLoading(true);
    const seed = activeEnvelopeId
      ? lockerTracks.find((t) => t.envelopeId === activeEnvelopeId)
      : undefined;
    const next = buildSonicLockerQueue(24, seed);
    setPicks(next);
    setLoading(false);
    if (next.length > 0 && !selectedId) {
      setSelectedId(next[0].envelope.envelopeId);
    }
  }, [activeEnvelopeId, lockerTracks, selectedId]);

  useEffect(() => {
    refreshQueue();
  }, [scoringKey, refreshQueue]);

  const selectedPick = useMemo(
    () => picks.find((p) => p.envelope.envelopeId === selectedId) ?? picks[0] ?? null,
    [picks, selectedId],
  );

  const handleStartRadio = () => {
    if (picks.length === 0) return;
    onPlayQueue(
      picks.map((p) => p.envelope),
      false,
    );
  };

  return (
    <div className="sonic-locker-station p-4 sm:p-6 max-w-5xl mx-auto w-full min-h-0 flex flex-col gap-6">
      <header className="space-y-2 shrink-0">
        <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-accent">
          Smart station
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-black uppercase tracking-tight flex items-center gap-2">
          <Radio className="w-7 h-7 text-accent shrink-0" />
          Sonic Locker
        </h1>
        <p className="text-sm text-[var(--text-mid)] max-w-2xl">
          Taste-scored mix radio from your locker — session context, profile affinity, genre,
          sonic features, and artist variety. Tap a track to see why it was picked.
          {recipeApplied ? ' · Shared recipe applied to scoring.' : ''}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={handleStartRadio}
            disabled={picks.length === 0 || loading}
            className="btn-accent px-4 py-2 rounded-lg font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2 touch-manipulation disabled:opacity-40"
          >
            <Play className="w-4 h-4" />
            Play queue
          </button>
          <button
            type="button"
            onClick={refreshQueue}
            disabled={loading || lockerTracks.length === 0}
            className="px-4 py-2 rounded-lg font-mono text-xs font-bold uppercase tracking-wider border border-[var(--border)] flex items-center gap-2 touch-manipulation disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Refresh picks
          </button>
          {onSaveMix ? (
            <button
              type="button"
              onClick={() => onSaveMix(picks.map((p) => p.envelope))}
              disabled={picks.length === 0}
              className="px-4 py-2 rounded-lg font-mono text-xs font-bold uppercase tracking-wider border border-[var(--border)] touch-manipulation disabled:opacity-40"
            >
              Save mix
            </button>
          ) : null}
          {onStartDiscoveryStation ? (
            <button
              type="button"
              onClick={() => onStartDiscoveryStation(picks.map((p) => p.envelope))}
              disabled={picks.length === 0}
              className="px-4 py-2 rounded-lg font-mono text-xs font-bold uppercase tracking-wider border border-accent text-accent touch-manipulation disabled:opacity-40"
            >
              Discovery station
            </button>
          ) : null}
        </div>
        <TasteRecipePanel
          compact
          stationName="Sonic Locker shared recipe"
          onApplied={() => {
            setRecipeApplied(true);
            refreshQueue();
          }}
        />
      </header>

      {lockerTracks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center border border-dashed border-[var(--border)] rounded-xl p-10 space-y-2">
          <p className="font-mono text-xs uppercase text-[var(--text-mid)]">
            Add tracks to your locker first
          </p>
          <p className="text-sm text-[var(--text-dim)] max-w-sm">
            Sonic Locker scores your vault locally — no catalog required once music is saved.
          </p>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
          <section className="sonic-locker-queue border border-[var(--border)] rounded-xl bg-[var(--bg-surface)]/60 overflow-hidden flex flex-col min-h-[16rem]">
            <p className="font-mono text-[9px] uppercase tracking-widest text-accent px-4 py-3 border-b border-[var(--border)]">
              Up next · {picks.length} tracks
            </p>
            <ul className="flex-1 overflow-y-auto music-scrollbar divide-y divide-[var(--border)]/60">
              {picks.map((pick, index) => {
                const id = pick.envelope.envelopeId;
                const isActive = id === activeEnvelopeId;
                const isSelected = id === selectedPick?.envelope.envelopeId;
                return (
                  <li key={id} className={isSelected ? 'bg-accent/5' : ''}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(id)}
                      onDoubleClick={() => onPlayTrack(pick.envelope)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 touch-manipulation transition-colors ${
                        isSelected ? 'bg-accent/10' : 'hover:bg-[var(--bg-void)]/40'
                      }`}
                    >
                      <span className="font-mono text-[10px] text-[var(--text-dim)] w-5 shrink-0">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`font-mono text-xs font-bold uppercase truncate flex items-center gap-2 ${
                            isActive && playing ? 'text-accent' : 'text-[var(--text)]'
                          }`}
                        >
                          {pick.envelope.title}
                          <LocalOfflineBadge envelope={pick.envelope} />
                        </p>
                        <p className="text-[10px] text-[var(--text-mid)] truncate">
                          {pick.envelope.artist}
                        </p>
                      </div>
                      <span className="font-mono text-[9px] text-[var(--text-dim)] shrink-0">
                        {(pick.breakdown.total * 100).toFixed(0)}
                      </span>
                      {pick.envelope.durationSeconds ? (
                        <span className="font-mono text-[9px] text-[var(--text-dim)] shrink-0">
                          {formatTime(pick.envelope.durationSeconds)}
                        </span>
                      ) : null}
                    </button>
                    {isSelected ? (
                      <div className="px-4 pb-3">
                        <RecommendTrackControls
                          envelope={pick.envelope}
                          variant="inline"
                          onAction={refreshQueue}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="sonic-locker-why border border-[var(--border)] rounded-xl bg-[var(--bg-surface)]/60 p-4 flex flex-col min-h-[16rem]">
            <p className="font-mono text-[9px] uppercase tracking-widest text-accent mb-3">
              Why this track
            </p>
            {selectedPick ? (
              <>
                <div className="mb-4">
                  <p className="font-display text-lg font-black uppercase truncate">
                    {selectedPick.envelope.title}
                  </p>
                  <p className="text-sm text-[var(--text-mid)] truncate">
                    {selectedPick.envelope.artist}
                  </p>
                  <p className="font-mono text-[10px] text-accent mt-1">
                    Score {(selectedPick.breakdown.total * 100).toFixed(1)} / 100
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto music-scrollbar space-y-3">
                  {selectedPick.breakdown.factors.map((factor) => (
                    <div key={factor.id}>
                      <TasteFactorBar factor={factor} />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onPlayTrack(selectedPick.envelope)}
                  className="mt-4 w-full py-2 rounded-lg font-mono text-xs font-bold uppercase border border-[var(--border)] touch-manipulation hover:border-accent/50"
                >
                  Play this track
                </button>
              </>
            ) : (
              <p className="text-sm text-[var(--text-dim)]">Select a track to see score factors.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
