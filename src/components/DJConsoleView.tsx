import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Play, Pause, RefreshCw, Layers, Sliders, ArrowLeftRight, ArrowRight, Music2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import {
  disposeDjAudioEngine,
  getDjAudioEngine,
  type DjDeckId,
  type DjEqBands,
} from '../djAudioEngine';
import {
  fetchStemCapabilities,
  fetchStemUrlsForTrack,
  pollStemAnalyzeUntilDone,
  stemUrlsComplete,
  submitStemAnalyze,
  type StemCapabilities,
} from '../stemSeparation';
import {
  findHarmonicMatchTrackId,
  formatSonicDeckLabel,
  readLockerTrackSonic,
} from '../djSonicMatch';
import { enqueueMissingSonicAnalysis } from '../sonicAnalysisQueue';

interface LockerTrack {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bitrate: number;
  durationSeconds: number;
  priority: number;
  url?: string;
  isCustom?: boolean;
  isPending?: boolean;
  artworkHtml?: string;
  artworkUrl?: string;
}

export interface PendingDjDeckLoad {
  deck: 'A' | 'B';
  trackId: string;
  openStemsTab?: boolean;
}

interface DJConsoleViewProps {
  allTracks: LockerTrack[];
  accentColor: string;
  borderRadius: string;
  /** When true, decks route audio through Web Audio crossfade (local locker URLs). */
  audioRoutingEnabled?: boolean;
  /** Cross-station handoff from Locker → DJ (consumed once on mount/update). */
  pendingDeckLoad?: PendingDjDeckLoad | null;
  onPendingDeckLoadConsumed?: () => void;
}

export default function DJConsoleView({
  allTracks,
  accentColor,
  borderRadius,
  audioRoutingEnabled = false,
  pendingDeckLoad = null,
  onPendingDeckLoadConsumed,
}: DJConsoleViewProps) {
  const { t } = useTranslation();
  // Deck A settings
  const [deckATrack, setDeckATrack] = useState<LockerTrack | null>(allTracks[0] || null);
  const [deckAPlays, setDeckAPlays] = useState<boolean>(false);
  const [deckAWash, setDeckAWash] = useState<number>(0); // -100 to +100
  const [deckAEq, setDeckAEq] = useState<DjEqBands>({ low: 0, mid: 0, high: 0 });
  const [deckABPM, setDeckABPM] = useState<number>(120);
  const [deckASynced, setDeckASynced] = useState<boolean>(false);
  const [deckAElapsed, setDeckAElapsed] = useState<number>(0);

  // Deck B settings
  const [deckBTrack, setDeckBTrack] = useState<LockerTrack | null>(allTracks[1] || allTracks[0] || null);
  const [deckBPlays, setDeckBPlays] = useState<boolean>(false);
  const [deckBWash, setDeckBWash] = useState<number>(0); // -100 to +100
  const [deckBEq, setDeckBEq] = useState<DjEqBands>({ low: 0, mid: 0, high: 0 });
  const [deckBBPM, setDeckBBPM] = useState<number>(128);
  const [deckBSynced, setDeckBSynced] = useState<boolean>(false);
  const [deckBElapsed, setDeckBElapsed] = useState<number>(0);

  // Global Crossfader (0 = center, -100 = Deck A only, 100 = Deck B only)
  const [crossfader, setCrossfader] = useState<number>(0);
  const [sendDelayMix, setSendDelayMix] = useState<number>(0);
  const [sendReverbMix, setSendReverbMix] = useState<number>(0);

  // Canvas visualizer refs
  const canvasRefA = useRef<HTMLCanvasElement | null>(null);
  const canvasRefB = useRef<HTMLCanvasElement | null>(null);

  // Selector Tab state for Compaction (Decks | Stems | Library | Visuals)
  const [activeConsoleTab, setActiveConsoleTab] = useState<'decks' | 'stems' | 'library' | 'visuals'>('decks');

  // Stems volumes state
  const [vocalsdB, setVocalsdB] = useState<number>(0);
  const [drumsdB, setDrumsdB] = useState<number>(0);
  const [bassdB, setBassdB] = useState<number>(0);
  const [instrumentsdB, setInstrumentsdB] = useState<number>(0);

  const [vocalsMuted, setVocalsMuted] = useState<boolean>(false);
  const [drumsMuted, setDrumsMuted] = useState<boolean>(false);
  const [bassMuted, setBassMuted] = useState<boolean>(false);
  const [instrumentsMuted, setInstrumentsMuted] = useState<boolean>(false);

  const [stemCapabilities, setStemCapabilities] = useState<StemCapabilities | null>(null);
  const [stemAnalyzeBusy, setStemAnalyzeBusy] = useState(false);
  const [stemAnalyzeProgress, setStemAnalyzeProgress] = useState(0);
  const [stemAnalyzeError, setStemAnalyzeError] = useState<string | null>(null);
  const [stemAnalyzeStatus, setStemAnalyzeStatus] = useState<string | null>(null);
  const [activeStemDeck, setActiveStemDeck] = useState<DjDeckId>('A');
  const [deckAHasStems, setDeckAHasStems] = useState(false);
  const [deckBHasStems, setDeckBHasStems] = useState(false);
  const [stemLibraryStatus, setStemLibraryStatus] = useState<
    Record<string, 'checking' | 'analyzed' | 'none'>
  >({});

  const engineRef = useRef(getDjAudioEngine());

  useEffect(() => {
    void fetchStemCapabilities().then(setStemCapabilities);
    enqueueMissingSonicAnalysis(8);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ids = allTracks.map((tr) => tr.id);
    if (ids.length === 0) {
      setStemLibraryStatus({});
      return;
    }
    setStemLibraryStatus((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (!next[id]) next[id] = 'checking';
      }
      return next;
    });
    void (async () => {
      const results: Record<string, 'analyzed' | 'none'> = {};
      await Promise.all(
        ids.map(async (id) => {
          const urls = await fetchStemUrlsForTrack(id);
          results[id] = stemUrlsComplete(urls) ? 'analyzed' : 'none';
        }),
      );
      if (!cancelled) {
        setStemLibraryStatus((prev) => ({ ...prev, ...results }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allTracks]);

  const loadTrackToDeck = useCallback((deck: DjDeckId, track: LockerTrack) => {
    if (audioRoutingEnabled) {
      engineRef.current.pause(deck);
      if (deck === 'A') setDeckAPlays(false);
      else setDeckBPlays(false);
    }
    if (deck === 'A') {
      setDeckATrack(track);
      setDeckAElapsed(0);
    } else {
      setDeckBTrack(track);
      setDeckBElapsed(0);
    }
  }, [audioRoutingEnabled]);

  const sendDeckToOther = useCallback(
    (from: DjDeckId) => {
      const track = from === 'A' ? deckATrack : deckBTrack;
      if (!track) return;
      if (audioRoutingEnabled) {
        engineRef.current.pause(from);
        if (from === 'A') setDeckAPlays(false);
        else setDeckBPlays(false);
      }
      if (from === 'A') {
        setDeckBTrack(track);
        setDeckBElapsed(0);
      } else {
        setDeckATrack(track);
        setDeckAElapsed(0);
      }
    },
    [audioRoutingEnabled, deckATrack, deckBTrack],
  );

  const swapDecks = useCallback(() => {
    if (audioRoutingEnabled) {
      engineRef.current.pause('A');
      engineRef.current.pause('B');
      setDeckAPlays(false);
      setDeckBPlays(false);
    }
    setDeckATrack(deckBTrack);
    setDeckBTrack(deckATrack);
    setDeckAElapsed(0);
    setDeckBElapsed(0);
  }, [audioRoutingEnabled, deckATrack, deckBTrack]);

  const refreshStemLibraryStatus = useCallback(async (trackId: string) => {
    setStemLibraryStatus((prev) => ({ ...prev, [trackId]: 'checking' }));
    const urls = await fetchStemUrlsForTrack(trackId);
    setStemLibraryStatus((prev) => ({
      ...prev,
      [trackId]: stemUrlsComplete(urls) ? 'analyzed' : 'none',
    }));
  }, []);

  const applyStemGainsToEngine = useCallback(
    (deck: DjDeckId) => {
      if (!audioRoutingEnabled) return;
      const engine = engineRef.current;
      engine.setStemGain(deck, 'vocals', vocalsdB, vocalsMuted);
      engine.setStemGain(deck, 'drums', drumsdB, drumsMuted);
      engine.setStemGain(deck, 'bass', bassdB, bassMuted);
      engine.setStemGain(deck, 'other', instrumentsdB, instrumentsMuted);
    },
    [audioRoutingEnabled, vocalsdB, drumsdB, bassdB, instrumentsdB, vocalsMuted, drumsMuted, bassMuted, instrumentsMuted],
  );

  const loadStemsForDeck = useCallback(
    async (deck: DjDeckId, track: LockerTrack | null) => {
      if (!audioRoutingEnabled || !track?.id) {
        if (deck === 'A') setDeckAHasStems(false);
        else setDeckBHasStems(false);
        return;
      }
      const urls = await fetchStemUrlsForTrack(track.id);
      if (!stemUrlsComplete(urls)) {
        if (deck === 'A') setDeckAHasStems(false);
        else setDeckBHasStems(false);
        if (track.url?.trim() && !engineRef.current.hasStemMix(deck)) {
          engineRef.current.loadTrack(deck, track.url);
        }
        return;
      }
      const ok = engineRef.current.loadStems(deck, urls);
      if (deck === 'A') setDeckAHasStems(ok);
      else setDeckBHasStems(ok);
      if (ok) applyStemGainsToEngine(deck);
    },
    [audioRoutingEnabled, applyStemGainsToEngine],
  );

  useEffect(() => {
    void loadStemsForDeck('A', deckATrack);
  }, [deckATrack, audioRoutingEnabled, loadStemsForDeck]);

  useEffect(() => {
    void loadStemsForDeck('B', deckBTrack);
  }, [deckBTrack, audioRoutingEnabled, loadStemsForDeck]);

  useEffect(() => {
    if (!pendingDeckLoad) return;
    const track = allTracks.find((t) => t.id === pendingDeckLoad.trackId);
    if (!track) {
      onPendingDeckLoadConsumed?.();
      return;
    }
    if (pendingDeckLoad.deck === 'A') {
      setDeckATrack(track);
      setDeckAElapsed(0);
      if (pendingDeckLoad.openStemsTab) setActiveStemDeck('A');
    } else {
      setDeckBTrack(track);
      setDeckBElapsed(0);
      if (pendingDeckLoad.openStemsTab) setActiveStemDeck('B');
    }
    if (pendingDeckLoad.openStemsTab) setActiveConsoleTab('stems');
    onPendingDeckLoadConsumed?.();
  }, [pendingDeckLoad, allTracks, onPendingDeckLoadConsumed]);

  useEffect(() => {
    if (!audioRoutingEnabled) return;
    applyStemGainsToEngine('A');
    applyStemGainsToEngine('B');
  }, [audioRoutingEnabled, applyStemGainsToEngine]);

  const runStemAnalyze = useCallback(async () => {
    const track = activeStemDeck === 'A' ? deckATrack : deckBTrack;
    if (!track?.id) return;
    setStemAnalyzeBusy(true);
    setStemAnalyzeError(null);
    setStemAnalyzeProgress(0);
    setStemAnalyzeStatus('Queued…');
    try {
      const jobId = await submitStemAnalyze({
        trackId: track.id,
        title: track.title,
        artist: track.artist,
      });
      const result = await pollStemAnalyzeUntilDone(jobId, (job) => {
        setStemAnalyzeProgress(job.progress);
        setStemAnalyzeStatus(job.status);
      });
      if (result.status === 'error') {
        throw new Error(result.error ?? 'Stem separation failed');
      }
      await loadStemsForDeck(activeStemDeck, track);
      setStemAnalyzeStatus('Done');
      void refreshStemLibraryStatus(track.id);
    } catch (err) {
      setStemAnalyzeError(err instanceof Error ? err.message : String(err));
    } finally {
      setStemAnalyzeBusy(false);
    }
  }, [activeStemDeck, deckATrack, deckBTrack, loadStemsForDeck, refreshStemLibraryStatus]);

  useEffect(() => {
    if (!audioRoutingEnabled) return;
    const engine = engineRef.current;
    engine.setOnTick((deck, elapsed) => {
      const secs = Math.floor(elapsed);
      if (deck === 'A') setDeckAElapsed(secs);
      else setDeckBElapsed(secs);
    });
    return () => {
      engine.setOnTick(null);
      disposeDjAudioEngine();
    };
  }, [audioRoutingEnabled]);

  useEffect(() => {
    if (!audioRoutingEnabled) return;
    const engine = engineRef.current;
    engine.setCrossfader(crossfader);
  }, [audioRoutingEnabled, crossfader]);

  const loadDeckAudio = useCallback(
    (deck: 'A' | 'B', track: LockerTrack | null, wash: number) => {
      if (!audioRoutingEnabled || !track?.url?.trim()) return;
      const engine = engineRef.current;
      if (!engine.hasStemMix(deck)) {
        engine.loadTrack(deck, track.url);
      }
      engine.setFilterWash(deck, wash);
    },
    [audioRoutingEnabled],
  );

  useEffect(() => {
    loadDeckAudio('A', deckATrack, deckAWash);
  }, [audioRoutingEnabled, deckATrack, deckAWash, loadDeckAudio]);

  useEffect(() => {
    loadDeckAudio('B', deckBTrack, deckBWash);
  }, [audioRoutingEnabled, deckBTrack, deckBWash, loadDeckAudio]);

  const toggleDeckPlay = useCallback(
    async (deck: 'A' | 'B') => {
      if (audioRoutingEnabled) {
        const track = deck === 'A' ? deckATrack : deckBTrack;
        const engine = engineRef.current;
        if (!track?.url?.trim() && !engine.hasStemMix(deck)) return;
        if (!engine.hasStemMix(deck) && track?.url?.trim()) {
          engine.loadTrack(deck, track.url);
        }
        engine.setFilterWash(deck, deck === 'A' ? deckAWash : deckBWash);
        engine.toggle(deck);
        const playing = engine.isPlaying(deck);
        if (deck === 'A') setDeckAPlays(playing);
        else setDeckBPlays(playing);
        return;
      }
      if (deck === 'A') setDeckAPlays((p) => !p);
      else setDeckBPlays((p) => !p);
    },
    [audioRoutingEnabled, deckATrack, deckBTrack, deckAWash, deckBWash],
  );

  useEffect(() => {
    if (!audioRoutingEnabled) return;
    engineRef.current.setFilterWash('A', deckAWash);
  }, [audioRoutingEnabled, deckAWash]);

  useEffect(() => {
    if (!audioRoutingEnabled) return;
    engineRef.current.setFilterWash('B', deckBWash);
  }, [audioRoutingEnabled, deckBWash]);

  useEffect(() => {
    if (!audioRoutingEnabled) return;
    const engine = engineRef.current;
    (['low', 'mid', 'high'] as const).forEach((band) => {
      engine.setEqBand('A', band, deckAEq[band]);
      engine.setEqBand('B', band, deckBEq[band]);
    });
  }, [audioRoutingEnabled, deckAEq, deckBEq]);

  useEffect(() => {
    if (!audioRoutingEnabled) return;
    engineRef.current.setSendFx({ delayMix: sendDelayMix, reverbMix: sendReverbMix });
  }, [audioRoutingEnabled, sendDelayMix, sendReverbMix]);

  const handleSyncDecks = (target: 'A' | 'B') => {
    if (target === 'A') {
      setDeckABPM(deckBBPM);
      setDeckASynced(true);
      setDeckBSynced(true);
    } else {
      setDeckBBPM(deckABPM);
      setDeckASynced(true);
      setDeckBSynced(true);
    }
  };

  const applySonicBpmToDeck = useCallback((deck: 'A' | 'B', trackId: string) => {
    const sonic = readLockerTrackSonic(trackId);
    if (!sonic?.bpm) return;
    const rounded = Math.round(sonic.bpm);
    if (deck === 'A') setDeckABPM(rounded);
    else setDeckBBPM(rounded);
  }, []);

  useEffect(() => {
    if (!deckATrack) return;
    applySonicBpmToDeck('A', deckATrack.id);
    setDeckASynced(false);
  }, [deckATrack, applySonicBpmToDeck]);

  useEffect(() => {
    if (!deckBTrack) return;
    applySonicBpmToDeck('B', deckBTrack.id);
    setDeckBSynced(false);
  }, [deckBTrack, applySonicBpmToDeck]);

  const deckASonicLabel = useMemo(
    () => formatSonicDeckLabel(deckATrack ? readLockerTrackSonic(deckATrack.id) : null),
    [deckATrack],
  );
  const deckBSonicLabel = useMemo(
    () => formatSonicDeckLabel(deckBTrack ? readLockerTrackSonic(deckBTrack.id) : null),
    [deckBTrack],
  );

  const deckAHasKey = Boolean(deckATrack && readLockerTrackSonic(deckATrack.id)?.camelot);
  const deckBHasKey = Boolean(deckBTrack && readLockerTrackSonic(deckBTrack.id)?.camelot);

  const handleMatchKey = useCallback(
    (source: 'A' | 'B') => {
      const sourceTrack = source === 'A' ? deckATrack : deckBTrack;
      if (!sourceTrack) return;
      const matchId = findHarmonicMatchTrackId(sourceTrack.id, allTracks, new Set([sourceTrack.id]));
      if (!matchId) return;
      const found = allTracks.find((t) => t.id === matchId);
      if (!found) return;
      if (source === 'A') {
        setDeckBTrack(found);
        setDeckBElapsed(0);
      } else {
        setDeckATrack(found);
        setDeckAElapsed(0);
      }
    },
    [allTracks, deckATrack, deckBTrack],
  );

  // Run independent visualizer animations
  useEffect(() => {
    let animRefA: number;
    let animRefB: number;

    const drawVisualizer = (
      canvas: HTMLCanvasElement,
      isPlaying: boolean,
      wash: number,
      deck: 'A' | 'B'
    ) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const numBars = 18;
      const spacing = 4;
      const barWidth = (width - (numBars - 1) * spacing) / numBars;

      for (let i = 0; i < numBars; i++) {
        let barHeight = 4; // Flatline offset when idle

        if (isPlaying) {
          const time = Date.now() * 0.003;
          let wave = Math.sin(time + i * 0.5) * Math.cos(time * 0.3 + i * 0.2);
          
          // Modify heights based on HPF/LPF wash filter parameters
          if (wash < 0) {
            // LPF dampens higher frequencies (later bars)
            const cutoff = numBars * (1 + wash / 120);
            if (i > cutoff) wave *= Math.max(0.05, 1 + (cutoff - i) / 5);
          } else if (wash > 0) {
            // HPF dampens lower frequencies (earlier bars)
            const cutoff = numBars * (wash / 120);
            if (i < cutoff) wave *= Math.max(0.05, 1 - (cutoff - i) / 5);
          }

          barHeight = Math.abs(wave) * (height - 12) + 6;
        }

        const x = i * (barWidth + spacing);
        const y = height - barHeight;

        // Custom Gradient with #C2410C (Sandbox Audio orange)
        const grad = ctx.createLinearGradient(0, y, 0, height);
        grad.addColorStop(0, accentColor || 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))');
        grad.addColorStop(0.5, accentColor || 'var(--orange)');
        grad.addColorStop(1, 'rgba(0,0,0,0.45)');

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, barHeight);
      }
    };

    const loopA = () => {
      if (canvasRefA.current) {
        drawVisualizer(canvasRefA.current, deckAPlays, deckAWash, 'A');
      }
      animRefA = requestAnimationFrame(loopA);
    };

    const loopB = () => {
      if (canvasRefB.current) {
        drawVisualizer(canvasRefB.current, deckBPlays, deckBWash, 'B');
      }
      animRefB = requestAnimationFrame(loopB);
    };

    loopA();
    loopB();

    return () => {
      cancelAnimationFrame(animRefA);
      cancelAnimationFrame(animRefB);
    };
  }, [deckAPlays, deckAWash, deckBPlays, deckBWash, activeConsoleTab, accentColor]);

  // Elapsed timing loops
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (deckAPlays) {
      interval = setInterval(() => {
        setDeckAElapsed(prev => {
          const max = deckATrack?.durationSeconds || 200;
          if (prev >= max) return 0;
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [deckAPlays, deckATrack]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (deckBPlays) {
      interval = setInterval(() => {
        setDeckBElapsed(prev => {
          const max = deckBTrack?.durationSeconds || 200;
          if (prev >= max) return 0;
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [deckBPlays, deckBTrack]);

  const formatSecs = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remaining = secs % 60;
    return `${mins}:${remaining < 10 ? '0' : ''}${remaining}`;
  };

  return (
    <div
      className="dj-console h-full flex flex-col justify-between min-h-[28rem] max-w-6xl mx-auto bg-[var(--bg-void)] text-[var(--text)] p-3 sm:p-5 rounded-2xl border border-[var(--border)]"
      id="view-dj"
    >
      <p
        className="dj-console-tier-banner shrink-0"
        role="status"
      >
        {audioRoutingEnabled
          ? 'AUDIO ROUTING ON — 2-DECK CROSSFADE VIA WEB AUDIO (LOCKER URLS)'
          : 'VISUAL PREVIEW MODE — STEM SEPARATION REQUIRES TIER34 BACKEND'}
      </p>
      <div className="border-b border-[var(--border)] pb-4 space-y-3 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-accent">
              Visual mixer
            </span>
            <h2 className="text-2xl sm:text-3xl font-display font-black uppercase tracking-tight flex items-center gap-2 mt-1 text-[var(--text)]">
              <Sliders className="w-7 h-7 text-accent shrink-0" />
              <span>DJ Console</span>
            </h2>
            <p className="text-sm dj-muted mt-1 max-w-xl">
              {audioRoutingEnabled
                ? 'Two-deck crossfade and filter routing through Web Audio. Stems tab mixes isolated vocals/drums/bass/other when Demucs has analyzed the track.'
                : 'Preview layout and deck animations only. Controls do not play audio or route to the main player.'}
            </p>
          </div>

          <div
            style={{ borderRadius }}
            className="flex bg-[var(--bg-surface)] border border-[var(--border)] p-1 overflow-hidden"
          >
            {[
              { id: 'decks', label: 'Decks' },
              { id: 'stems', label: 'Stems' },
              { id: 'library', label: t('dj.stemLibrary') },
              { id: 'visuals', label: 'Visuals' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveConsoleTab(tab.id as 'decks' | 'stems' | 'library' | 'visuals')}
                style={{ borderRadius }}
                className={`px-5 py-2.5 text-sm font-bold uppercase tracking-wide transition-all cursor-pointer touch-manipulation ${
                  activeConsoleTab === tab.id
                    ? 'btn-accent text-text-on-accent'
                    : 'text-[var(--text-mid)] hover:text-[var(--text)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{ borderRadius }}
          className="border border-[var(--orange)]/30 bg-[var(--orange)]/5 px-4 py-3"
        >
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--orange)] block">
            {audioRoutingEnabled ? 'Audio routing' : 'Preview only'}
          </span>
          <p className="text-sm dj-muted mt-1">
            {audioRoutingEnabled
              ? 'Deck play buttons output locker audio through the crossfader. Disable in Settings → Playback → DJ audio routing for visual-only mode.'
              : 'Waveforms, filters, crossfader, and channel sliders update visuals only. Use Home or Locker for audible playback.'}
          </p>
        </div>
      </div>

      {/* Main Container Viewport */}
      <div className="flex-1 w-full min-h-[20rem] overflow-y-auto overflow-x-hidden my-4 pr-1 select-none flex flex-col music-scrollbar">

        {allTracks.length === 0 && (
          <div
            style={{ borderRadius }}
            className="flex-1 flex flex-col items-center justify-center text-center border border-dashed border-[var(--border)] bg-[var(--bg-surface)]/40 p-8 space-y-2"
          >
            <Layers className="w-8 h-8 text-[var(--text-dim)]" />
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--text-mid)]">
              No tracks in locker
            </p>
            <p className="text-sm dj-muted max-w-sm">
              Add music to your locker to preview deck layouts here. Playback stays in the main player.
            </p>
          </div>
        )}

        {allTracks.length > 0 && activeConsoleTab === 'decks' && (
          /* DUAL DECKS PANEL */
          <div className="flex-1 flex flex-col gap-3 pb-2 animate-none">
            <div className="flex justify-center">
              <button
                type="button"
                onClick={swapDecks}
                style={{ borderRadius }}
                className="px-4 py-2 font-mono text-[10px] uppercase font-bold flex items-center justify-center gap-1.5 border border-slate-800 bg-slate-950 text-slate-400 hover:text-[var(--orange)] hover:border-[var(--orange)] cursor-pointer transition-all touch-manipulation"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>{t('dj.swapDecks')}</span>
              </button>
            </div>
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* DECK A (LEFT PART) */}
            <div 
              style={{ borderRadius: borderRadius }} 
              className={`flex-1 flex flex-col justify-between bg-[var(--bg-surface)]/90 border p-5 space-y-4 transition-all relative overflow-hidden ${
                deckAPlays ? 'border-[var(--orange)]' : 'border-[var(--border)]'
              }`}
            >
              <div className="flex items-center justify-between border-b border-[var(--border)]/60 pb-2.5">
                <span className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">
                  Deck A
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--orange)] font-bold">{deckABPM} BPM</span>
                  {deckASynced && (
                    <span className="text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 bg-[var(--orange)]/10 border border-[var(--orange)]/30 text-[var(--orange)] rounded">
                      SYNCED
                    </span>
                  )}
                </div>
              </div>

              {/* Track selector drop-down */}
              <div className="space-y-1">
                <label className="text-sm font-bold uppercase dj-muted block">Choose track</label>
                <select
                  value={deckATrack?.id || ''}
                  onChange={(e) => {
                    const found = allTracks.find(t => t.id === e.target.value);
                    if (found) {
                      setDeckATrack(found);
                      setDeckAElapsed(0);
                    }
                  }}
                  style={{ borderRadius: borderRadius }}
                  className="w-full bg-[var(--bg-void)] border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--text)] focus:outline-none focus-accent rounded-lg"
                >
                  {allTracks.map(track => (
                    <option key={track.id} value={track.id}>
                      {track.title} — {track.artist}
                    </option>
                  ))}
                </select>
                {deckASonicLabel ? (
                  <p className="text-[10px] font-mono text-[var(--orange)]/80 pt-0.5">{deckASonicLabel}</p>
                ) : null}
              </div>

              {/* Demo visualizer — not live audio analysis */}
              <div className="space-y-1">
                <span className="text-sm font-bold uppercase dj-muted block">{t('dj.demoVisual')}</span>
                <p className="text-[10px] font-mono dj-dim">{t('dj.demoVisualHint')}</p>
                <div className="bg-[var(--bg-void)] border border-[var(--border)] p-3 rounded-lg flex flex-col justify-end h-20 relative">
                  {!deckAPlays && (
                    <div className="absolute inset-0 flex items-center justify-center font-mono text-[9px] text-[var(--text-dim)] uppercase">
                      {t('dj.visualPaused')}
                    </div>
                  )}
                  <canvas 
                    ref={canvasRefA} 
                    width="400" 
                    height="60" 
                    className="w-full h-full block"
                  />
                </div>
              </div>

              {/* Rotary Knob/Slider for Wash HPF/LPF */}
              <div className="space-y-1.5 bg-[var(--bg-void)]/60 p-3 border border-[var(--border)]/40 rounded-lg">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="dj-muted font-bold uppercase text-sm">Filter visual</span>
                  <span className="text-[var(--orange)] font-bold">
                    {deckAWash === 0 ? 'FLAT' : deckAWash < 0 ? `LPF: ${deckAWash}%` : `HPF: +${deckAWash}%`}
                  </span>
                </div>
                <p className="text-[10px] font-mono dj-dim">
                  {audioRoutingEnabled ? 'Low/high-pass filter on deck audio.' : 'Shapes the bar animation only'}
                </p>
                <input 
                  type="range"
                  min="-100"
                  max="100"
                  step="2"
                  value={deckAWash}
                  onChange={(e) => setDeckAWash(parseInt(e.target.value))}
                  style={{ accentColor: 'var(--orange)' }}
                  className="w-full h-1.5 rounded bg-slate-900 cursor-ew-resize"
                />
                <div className="flex justify-between font-mono text-[8px] text-[var(--text-dim)]">
                  <span>Bass</span>
                  <span>Flat</span>
                  <span>Treble</span>
                </div>
              </div>

              {audioRoutingEnabled ? (
                <div className="space-y-1.5 bg-[var(--bg-void)]/60 p-3 border border-[var(--border)]/40 rounded-lg">
                  <span className="dj-muted font-bold uppercase text-sm block">3-band EQ (Deck A)</span>
                  {(['low', 'mid', 'high'] as const).map((band) => (
                    <label key={band} className="flex items-center gap-2 font-mono text-[10px] uppercase">
                      <span className="w-10">{band}</span>
                      <input
                        type="range"
                        min="-12"
                        max="12"
                        step="1"
                        value={deckAEq[band]}
                        onChange={(e) =>
                          setDeckAEq((prev) => ({ ...prev, [band]: parseInt(e.target.value, 10) }))
                        }
                        style={{ accentColor: 'var(--orange)' }}
                        className="flex-1 h-1.5"
                      />
                      <span className="w-12 text-right text-[var(--orange)]">{deckAEq[band]} dB</span>
                    </label>
                  ))}
                </div>
              ) : null}

              {/* Deck A control triggers */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => void toggleDeckPlay('A')}
                  title="Starts or stops the deck animation. No audio is played."
                  style={{ borderRadius: borderRadius }}
                  className={`py-2 font-mono text-xs uppercase font-bold flex items-center justify-center gap-1.5 border cursor-pointer transition-all ${
                    deckAPlays 
                      ? 'bg-[var(--orange)]/20 border-[var(--orange)] text-[var(--orange)]' 
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-[var(--text)]'
                  }`}
                >
                  {deckAPlays ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{deckAPlays ? 'Pause' : audioRoutingEnabled ? 'Play audio' : 'Animate'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSyncDecks('A')}
                  disabled={!deckATrack || !deckBTrack}
                  title={t('dj.bpmMatch')}
                  style={{ borderRadius: borderRadius }}
                  className="py-2 font-mono text-xs uppercase font-bold flex items-center justify-center gap-1.5 border border-slate-800 bg-slate-950 text-slate-400 hover:text-[var(--orange)] hover:border-[var(--orange)] disabled:opacity-40 cursor-pointer transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Match BPM</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleMatchKey('A')}
                disabled={!deckAHasKey}
                title={deckAHasKey ? t('dj.keyMatchHint') : t('dj.keyMatchNone')}
                style={{ borderRadius: borderRadius }}
                className="w-full py-2 font-mono text-[10px] uppercase font-bold flex items-center justify-center gap-1.5 border border-slate-800 bg-slate-950 text-slate-400 hover:text-[var(--orange)] hover:border-[var(--orange)] disabled:opacity-40 cursor-pointer transition-all touch-manipulation"
              >
                <Music2 className="w-3.5 h-3.5" />
                <span>{t('dj.keyMatch')}</span>
              </button>

              <button
                type="button"
                onClick={() => sendDeckToOther('A')}
                disabled={!deckATrack}
                style={{ borderRadius: borderRadius }}
                className="w-full py-2 font-mono text-[10px] uppercase font-bold flex items-center justify-center gap-1.5 border border-slate-800 bg-slate-950 text-slate-400 hover:text-[var(--orange)] hover:border-[var(--orange)] disabled:opacity-40 cursor-pointer transition-all touch-manipulation"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>{t('dj.sendToDeckB')}</span>
              </button>

              {/* Simulated elapsed timer footer */}
              <div className="flex items-center justify-between font-mono text-[9px] text-[#5c617b] pt-0.5">
                <span>ELAPSED: {formatSecs(deckAElapsed)}</span>
                <span>TOTAL: {formatSecs(deckATrack?.durationSeconds || 210)}</span>
              </div>
            </div>

            {/* DECK B (RIGHT PART) */}
            <div 
              style={{ borderRadius: borderRadius }} 
              className={`flex-1 flex flex-col justify-between bg-[var(--bg-surface)]/90 border p-5 space-y-4 transition-all relative overflow-hidden ${
                deckBPlays ? 'border-[var(--orange)]' : 'border-[var(--border)]'
              }`}
            >
              <div className="flex items-center justify-between border-b border-[var(--border)]/60 pb-2.5">
                <span className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">
                  Deck B
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--orange)] font-bold">{deckBBPM} BPM</span>
                  {deckBSynced && (
                    <span className="text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 bg-[var(--orange)]/10 border border-[var(--orange)]/30 text-[var(--orange)] rounded">
                      SYNCED
                    </span>
                  )}
                </div>
              </div>

              {/* Track selector drop-down */}
              <div className="space-y-1">
                <label className="text-sm font-bold uppercase dj-muted block">Choose track</label>
                <select
                  value={deckBTrack?.id || ''}
                  onChange={(e) => {
                    const found = allTracks.find(t => t.id === e.target.value);
                    if (found) {
                      setDeckBTrack(found);
                      setDeckBElapsed(0);
                    }
                  }}
                  style={{ borderRadius: borderRadius }}
                  className="w-full bg-[var(--bg-void)] border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--text)] focus:outline-none focus-accent rounded-lg"
                >
                  {allTracks.map(track => (
                    <option key={track.id} value={track.id}>
                      {track.title} — {track.artist}
                    </option>
                  ))}
                </select>
                {deckBSonicLabel ? (
                  <p className="text-[10px] font-mono text-[var(--orange)]/80 pt-0.5">{deckBSonicLabel}</p>
                ) : null}
              </div>

              {/* Demo visualizer — not live audio analysis */}
              <div className="space-y-1">
                <span className="text-sm font-bold uppercase dj-muted block">{t('dj.demoVisual')}</span>
                <p className="text-[10px] font-mono dj-dim">{t('dj.demoVisualHint')}</p>
                <div className="bg-[var(--bg-void)] border border-[var(--border)] p-3 rounded-lg flex flex-col justify-end h-20 relative">
                  {!deckBPlays && (
                    <div className="absolute inset-0 flex items-center justify-center font-mono text-[9px] text-[var(--text-dim)] uppercase">
                      {t('dj.visualPaused')}
                    </div>
                  )}
                  <canvas 
                    ref={canvasRefB} 
                    width="400" 
                    height="60" 
                    className="w-full h-full block"
                  />
                </div>
              </div>

              {/* Rotary Knob/Slider for Wash HPF/LPF */}
              <div className="space-y-1.5 bg-[var(--bg-void)]/60 p-3 border border-[var(--border)]/40 rounded-lg">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="dj-muted font-bold uppercase text-sm">Filter visual</span>
                  <span className="text-[var(--orange)] font-bold">
                    {deckBWash === 0 ? 'FLAT' : deckBWash < 0 ? `LPF: ${deckBWash}%` : `HPF: +${deckBWash}%`}
                  </span>
                </div>
                <p className="text-[10px] font-mono dj-dim">
                  {audioRoutingEnabled ? 'Low/high-pass filter on deck audio.' : 'Shapes the bar animation only'}
                </p>
                <input 
                  type="range"
                  min="-100"
                  max="100"
                  step="2"
                  value={deckBWash}
                  onChange={(e) => setDeckBWash(parseInt(e.target.value))}
                  style={{ accentColor: 'var(--orange)' }}
                  className="w-full h-1.5 rounded bg-slate-900 cursor-ew-resize"
                />
                <div className="flex justify-between font-mono text-[8px] text-[var(--text-dim)]">
                  <span>Bass</span>
                  <span>Flat</span>
                  <span>Treble</span>
                </div>
              </div>

              {audioRoutingEnabled ? (
                <div className="space-y-1.5 bg-[var(--bg-void)]/60 p-3 border border-[var(--border)]/40 rounded-lg">
                  <span className="dj-muted font-bold uppercase text-sm block">3-band EQ (Deck B)</span>
                  {(['low', 'mid', 'high'] as const).map((band) => (
                    <label key={band} className="flex items-center gap-2 font-mono text-[10px] uppercase">
                      <span className="w-10">{band}</span>
                      <input
                        type="range"
                        min="-12"
                        max="12"
                        step="1"
                        value={deckBEq[band]}
                        onChange={(e) =>
                          setDeckBEq((prev) => ({ ...prev, [band]: parseInt(e.target.value, 10) }))
                        }
                        style={{ accentColor: 'var(--orange)' }}
                        className="flex-1 h-1.5"
                      />
                      <span className="w-12 text-right text-[var(--orange)]">{deckBEq[band]} dB</span>
                    </label>
                  ))}
                </div>
              ) : null}

              {/* Deck B control triggers */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => void toggleDeckPlay('B')}
                  title="Starts or stops the deck animation. No audio is played."
                  style={{ borderRadius: borderRadius }}
                  className={`py-2 font-mono text-xs uppercase font-bold flex items-center justify-center gap-1.5 border cursor-pointer transition-all ${
                    deckBPlays 
                      ? 'bg-[var(--orange)]/20 border-[var(--orange)] text-[var(--orange)]' 
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-[var(--text)]'
                  }`}
                >
                  {deckBPlays ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{deckBPlays ? 'Pause' : audioRoutingEnabled ? 'Play audio' : 'Animate'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSyncDecks('B')}
                  disabled={!deckATrack || !deckBTrack}
                  title={t('dj.bpmMatch')}
                  style={{ borderRadius: borderRadius }}
                  className="py-2 font-mono text-xs uppercase font-bold flex items-center justify-center gap-1.5 border border-slate-800 bg-slate-950 text-slate-400 hover:text-[var(--orange)] hover:border-[var(--orange)] disabled:opacity-40 cursor-pointer transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Match BPM</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleMatchKey('B')}
                disabled={!deckBHasKey}
                title={deckBHasKey ? t('dj.keyMatchHint') : t('dj.keyMatchNone')}
                style={{ borderRadius: borderRadius }}
                className="w-full py-2 font-mono text-[10px] uppercase font-bold flex items-center justify-center gap-1.5 border border-slate-800 bg-slate-950 text-slate-400 hover:text-[var(--orange)] hover:border-[var(--orange)] disabled:opacity-40 cursor-pointer transition-all touch-manipulation"
              >
                <Music2 className="w-3.5 h-3.5" />
                <span>{t('dj.keyMatch')}</span>
              </button>

              <button
                type="button"
                onClick={() => sendDeckToOther('B')}
                disabled={!deckBTrack}
                style={{ borderRadius: borderRadius }}
                className="w-full py-2 font-mono text-[10px] uppercase font-bold flex items-center justify-center gap-1.5 border border-slate-800 bg-slate-950 text-slate-400 hover:text-[var(--orange)] hover:border-[var(--orange)] disabled:opacity-40 cursor-pointer transition-all touch-manipulation"
              >
                <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                <span>{t('dj.sendToDeckA')}</span>
              </button>

              {/* Simulated elapsed timer footer */}
              <div className="flex items-center justify-between font-mono text-[9px] text-[#5c617b] pt-0.5">
                <span>ELAPSED: {formatSecs(deckBElapsed)}</span>
                <span>TOTAL: {formatSecs(deckBTrack?.durationSeconds || 210)}</span>
              </div>
            </div>
          </div>
          </div>
        )}

        {allTracks.length > 0 && activeConsoleTab === 'library' && (
          <div className="flex-1 flex flex-col gap-3 pb-2 animate-none min-h-0">
            <div
              style={{ borderRadius }}
              className="border border-[var(--border)] bg-[var(--bg-surface)]/90 px-4 py-3 shrink-0"
            >
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--orange)]">
                {t('dj.stemLibrary')}
              </h3>
              <p className="text-sm dj-muted mt-1">{t('dj.stemLibraryHint')}</p>
            </div>
            <ul className="flex-1 overflow-y-auto music-scrollbar divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]/40">
              {allTracks.map((track) => {
                const status = stemLibraryStatus[track.id] ?? 'checking';
                const onDeckA = deckATrack?.id === track.id;
                const onDeckB = deckBTrack?.id === track.id;
                return (
                  <li
                    key={track.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-2.5 hover:bg-[var(--bg-surface)]/60"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--text)]">
                        {track.title}
                      </span>
                      <span className="block truncate text-xs text-[var(--text-dim)]">
                        {track.artist}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-mono uppercase shrink-0 ${
                        status === 'analyzed'
                          ? 'text-[var(--orange)]'
                          : status === 'checking'
                            ? 'text-slate-500'
                            : 'text-slate-600'
                      }`}
                    >
                      {status === 'analyzed'
                        ? t('dj.stemAnalyzed')
                        : status === 'checking'
                          ? t('dj.stemChecking')
                          : t('dj.stemNotAnalyzed')}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => loadTrackToDeck('A', track)}
                        style={{ borderRadius }}
                        className={`px-2.5 py-1 text-[10px] font-mono uppercase font-bold border touch-manipulation ${
                          onDeckA
                            ? 'border-[var(--orange)] text-[var(--orange)] bg-[var(--orange)]/10'
                            : 'border-slate-800 text-slate-400 hover:border-[var(--orange)] hover:text-[var(--orange)]'
                        }`}
                      >
                        {t('dj.loadDeckA')}
                      </button>
                      <button
                        type="button"
                        onClick={() => loadTrackToDeck('B', track)}
                        style={{ borderRadius }}
                        className={`px-2.5 py-1 text-[10px] font-mono uppercase font-bold border touch-manipulation ${
                          onDeckB
                            ? 'border-[var(--orange)] text-[var(--orange)] bg-[var(--orange)]/10'
                            : 'border-slate-800 text-slate-400 hover:border-[var(--orange)] hover:text-[var(--orange)]'
                        }`}
                      >
                        {t('dj.loadDeckB')}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {allTracks.length > 0 && activeConsoleTab === 'stems' && (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 pb-2 animate-none">
            
            <div 
              style={{ borderRadius: borderRadius }} 
              className="md:col-span-2 bg-[var(--bg-surface)]/90 border border-[var(--border)] p-5 space-y-4"
            >
              <div className="space-y-2">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--orange)]">
                  Stem mixer
                </h3>
                <p className="text-sm dj-muted leading-relaxed">
                  {audioRoutingEnabled
                    ? (activeStemDeck === 'A' ? deckAHasStems : deckBHasStems)
                      ? 'Isolated Demucs stems — mix vocals, drums, bass, and other per deck.'
                      : 'Analyze a deck track on the Sandbox Server (Demucs) to load real stems here.'
                    : 'Enable DJ audio routing in Settings → Add-ons to hear stem mixes.'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveStemDeck('A')}
                    style={{ borderRadius }}
                    className={`px-2 py-1 text-[10px] font-mono uppercase border ${
                      activeStemDeck === 'A' ? 'border-[var(--orange)] text-[var(--orange)]' : 'border-slate-800 text-slate-500'
                    }`}
                  >
                    Deck A
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveStemDeck('B')}
                    style={{ borderRadius }}
                    className={`px-2 py-1 text-[10px] font-mono uppercase border ${
                      activeStemDeck === 'B' ? 'border-[var(--orange)] text-[var(--orange)]' : 'border-slate-800 text-slate-500'
                    }`}
                  >
                    Deck B
                  </button>
                  <button
                    type="button"
                    disabled={!audioRoutingEnabled || stemAnalyzeBusy || !stemCapabilities?.demucsAvailable}
                    onClick={() => void runStemAnalyze()}
                    style={{ borderRadius }}
                    className="px-3 py-1 text-[10px] font-mono uppercase font-bold border border-[var(--orange)] text-[var(--orange)] disabled:opacity-40"
                  >
                    {stemAnalyzeBusy ? `Analyzing ${stemAnalyzeProgress}%` : 'Analyze stems'}
                  </button>
                </div>
                {stemAnalyzeStatus ? (
                  <p className="text-[10px] font-mono text-slate-500 uppercase">{stemAnalyzeStatus}</p>
                ) : null}
                {stemAnalyzeError ? (
                  <p className="text-[10px] font-mono text-red-400">{stemAnalyzeError}</p>
                ) : null}
                {stemCapabilities && !stemCapabilities.demucsAvailable ? (
                  <p className="text-[10px] font-mono text-slate-500">{stemCapabilities.hint}</p>
                ) : null}
              </div>

              <div style={{ borderRadius: borderRadius }} className="grid grid-cols-4 gap-3 py-3 bg-[var(--bg-void)]/60 p-3 border border-[var(--border)]/40">
                
                {/* VOCALS Slider */}
                <div className="flex flex-col items-center gap-2">
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] uppercase text-slate-500 font-mono font-bold">VOCALS</span>
                    <span className="font-mono text-[11px] font-bold text-[var(--orange)]">
                      {vocalsMuted ? 'MUTE' : `${vocalsdB > 0 ? '+' : ''}${vocalsdB} dB`}
                    </span>
                  </div>
                  <div className="h-32 relative flex justify-center bg-[var(--bg-surface)] w-2.5 rounded-full border border-slate-900 overflow-hidden">
                    <input 
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={vocalsdB}
                      onChange={(e) => {
                        setVocalsdB(parseInt(e.target.value));
                        if (audioRoutingEnabled) engineRef.current.setStemGain(activeStemDeck, 'vocals', parseInt(e.target.value), vocalsMuted);
                      }}
                      style={{ writingMode: 'vertical-lr', direction: 'rtl', accentColor: 'var(--orange)' }}
                      className="absolute inset-0 h-full w-full opacity-100 cursor-ns-resize"
                    />
                  </div>
                  <button 
                    onClick={() => {
                      const next = !vocalsMuted;
                      setVocalsMuted(next);
                      if (audioRoutingEnabled) engineRef.current.setStemGain(activeStemDeck, 'vocals', vocalsdB, next);
                    }}
                    style={{ borderRadius: borderRadius }}
                    className={`w-full py-0.5 text-[8px] uppercase font-mono font-bold rounded border cursor-pointer transition-colors ${
                      vocalsMuted ? 'bg-red-800/10 text-red-500 border-red-500/20' : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    Mute
                  </button>
                </div>

                {/* DRUMS Slider */}
                <div className="flex flex-col items-center gap-2">
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] uppercase text-slate-500 font-mono font-bold">DRUMS</span>
                    <span className="font-mono text-[11px] font-bold text-[var(--orange)]">
                      {drumsMuted ? 'MUTE' : `${drumsdB > 0 ? '+' : ''}${drumsdB} dB`}
                    </span>
                  </div>
                  <div className="h-32 relative flex justify-center bg-[var(--bg-surface)] w-2.5 rounded-full border border-slate-900 overflow-hidden">
                    <input 
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={drumsdB}
                      onChange={(e) => {
                        setDrumsdB(parseInt(e.target.value));
                        if (audioRoutingEnabled) engineRef.current.setStemGain(activeStemDeck, 'drums', parseInt(e.target.value), drumsMuted);
                      }}
                      style={{ writingMode: 'vertical-lr', direction: 'rtl', accentColor: 'var(--orange)' }}
                      className="absolute inset-0 h-full w-full opacity-100 cursor-ns-resize"
                    />
                  </div>
                  <button 
                    onClick={() => {
                      const next = !drumsMuted;
                      setDrumsMuted(next);
                      if (audioRoutingEnabled) engineRef.current.setStemGain(activeStemDeck, 'drums', drumsdB, next);
                    }}
                    style={{ borderRadius: borderRadius }}
                    className={`w-full py-0.5 text-[8px] uppercase font-mono font-bold rounded border cursor-pointer transition-colors ${
                      drumsMuted ? 'bg-red-800/10 text-red-500 border-red-500/20' : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    Mute
                  </button>
                </div>

                {/* BASS Slider */}
                <div className="flex flex-col items-center gap-2">
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] uppercase text-slate-500 font-mono font-bold">BASS</span>
                    <span className="font-mono text-[11px] font-bold text-[var(--orange)]">
                      {bassMuted ? 'MUTE' : `${bassdB > 0 ? '+' : ''}${bassdB} dB`}
                    </span>
                  </div>
                  <div className="h-32 relative flex justify-center bg-[var(--bg-surface)] w-2.5 rounded-full border border-slate-900 overflow-hidden">
                    <input 
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={bassdB}
                      onChange={(e) => {
                        setBassdB(parseInt(e.target.value));
                        if (audioRoutingEnabled) engineRef.current.setStemGain(activeStemDeck, 'bass', parseInt(e.target.value), bassMuted);
                      }}
                      style={{ writingMode: 'vertical-lr', direction: 'rtl', accentColor: 'var(--orange)' }}
                      className="absolute inset-0 h-full w-full opacity-100 cursor-ns-resize"
                    />
                  </div>
                  <button 
                    onClick={() => {
                      const next = !bassMuted;
                      setBassMuted(next);
                      if (audioRoutingEnabled) engineRef.current.setStemGain(activeStemDeck, 'bass', bassdB, next);
                    }}
                    style={{ borderRadius: borderRadius }}
                    className={`w-full py-0.5 text-[8px] uppercase font-mono font-bold rounded border cursor-pointer transition-colors ${
                      bassMuted ? 'bg-red-800/10 text-red-500 border-red-500/20' : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    Mute
                  </button>
                </div>

                {/* INSTRUMENTS Slider */}
                <div className="flex flex-col items-center gap-2">
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] uppercase text-slate-500 font-mono font-bold">INSTR.</span>
                    <span className="font-mono text-[11px] font-bold text-[var(--orange)]">
                      {instrumentsMuted ? 'MUTE' : `${instrumentsdB > 0 ? '+' : ''}${instrumentsdB} dB`}
                    </span>
                  </div>
                  <div className="h-32 relative flex justify-center bg-[var(--bg-surface)] w-2.5 rounded-full border border-slate-900 overflow-hidden">
                    <input 
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={instrumentsdB}
                      onChange={(e) => {
                        setInstrumentsdB(parseInt(e.target.value));
                        if (audioRoutingEnabled) engineRef.current.setStemGain(activeStemDeck, 'other', parseInt(e.target.value), instrumentsMuted);
                      }}
                      style={{ writingMode: 'vertical-lr', direction: 'rtl', accentColor: 'var(--orange)' }}
                      className="absolute inset-0 h-full w-full opacity-100 cursor-ns-resize"
                    />
                  </div>
                  <button 
                    onClick={() => {
                      const next = !instrumentsMuted;
                      setInstrumentsMuted(next);
                      if (audioRoutingEnabled) engineRef.current.setStemGain(activeStemDeck, 'other', instrumentsdB, next);
                    }}
                    style={{ borderRadius: borderRadius }}
                    className={`w-full py-0.5 text-[8px] uppercase font-mono font-bold rounded border cursor-pointer transition-colors ${
                      instrumentsMuted ? 'bg-red-800/10 text-red-500 border-red-500/20' : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    Mute
                  </button>
                </div>

              </div>
            </div>

            {/* Deck activity summary (display only) */}
            <div 
              style={{ borderRadius: borderRadius }} 
              className="bg-[var(--bg-surface)]/90 border border-[var(--border)] p-5 space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-1.5">
                <span className="text-xs font-mono font-bold uppercase tracking-wider block text-[var(--orange)]">
                  Deck status
                </span>
                <p className="text-sm dj-muted leading-relaxed">
                  Deck A stems: {deckAHasStems ? 'loaded' : 'none'} · Deck B stems: {deckBHasStems ? 'loaded' : 'none'}
                </p>
              </div>

              <div style={{ borderRadius: borderRadius }} className="bg-[var(--bg-void)] border border-[var(--border)]/60 p-3 space-y-2.5 font-mono text-[11px] text-slate-400">
                <div className="flex justify-between border-b border-[var(--border)]/30 pb-1.5">
                  <span>DECK A STATUS:</span>
                  <span className={deckAPlays ? 'text-[var(--orange)] font-bold' : 'text-slate-600'}>{deckAPlays ? 'ANIMATING' : 'STANDBY'}</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border)]/30 pb-1.5">
                  <span>DECK B STATUS:</span>
                  <span className={deckBPlays ? 'text-[var(--orange)] font-bold' : 'text-slate-600'}>{deckBPlays ? 'ANIMATING' : 'STANDBY'}</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border)]/30 pb-1.5">
                  <span>Audio output:</span>
                  <span className={audioRoutingEnabled ? 'text-[var(--orange)] font-bold' : 'text-slate-600'}>
                    {audioRoutingEnabled ? 'Web Audio' : 'None'}
                  </span>
                </div>
                <div className="flex justify-between font-bold text-[var(--text)]">
                  <span>BPM display:</span>
                  <span className="text-accent">{deckASynced || deckBSynced ? 'Matched' : 'Independent'}</span>
                </div>
              </div>
            </div>

          </div>
        )}

        {allTracks.length > 0 && activeConsoleTab === 'visuals' && (
          /* Large deck amplitude visuals (canvas animation only) */
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 pb-2 animate-none">
            
            <div style={{ borderRadius: borderRadius }} className="bg-[var(--bg-surface)]/90 border border-[var(--border)] p-5 space-y-3">
              <span className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest block border-b border-[var(--border)]/40 pb-2">
                Deck A — Visual
              </span>
              <div className="bg-slate-950/80 border border-slate-900 rounded-lg p-4 flex flex-col justify-end h-48 relative">
                {!deckAPlays && (
                  <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-[var(--text-dim)] uppercase bg-[var(--bg-void)]/60 rounded-lg">
                    {t('dj.visualPaused')}
                  </div>
                )}
                <canvas 
                  ref={canvasRefA} 
                  width="500" 
                  height="160" 
                  className="w-full h-full block"
                />
              </div>
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>DECK A PANEL</span>
                <span>{t('dj.previewOnly')}</span>
              </div>
            </div>

            <div style={{ borderRadius: borderRadius }} className="bg-[var(--bg-surface)]/90 border border-[var(--border)] p-5 space-y-3">
              <span className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest block border-b border-[var(--border)]/40 pb-2">
                Deck B — Visual
              </span>
              <div className="bg-slate-950/80 border border-slate-900 rounded-lg p-4 flex flex-col justify-end h-48 relative">
                {!deckBPlays && (
                  <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-[var(--text-dim)] uppercase bg-[var(--bg-void)]/60 rounded-lg">
                    {t('dj.visualPaused')}
                  </div>
                )}
                <canvas 
                  ref={canvasRefB} 
                  width="500" 
                  height="160" 
                  className="w-full h-full block"
                />
              </div>
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>DECK B PANEL</span>
                <span>{t('dj.previewOnly')}</span>
              </div>
            </div>

          </div>
        )}

      </div>

      {allTracks.length > 0 && (
      <div 
        style={{ borderRadius: borderRadius }} 
        className="bg-[var(--bg-surface)] border border-[var(--border)] p-4 space-y-2 shrink-0 select-none"
      >
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="dj-muted font-bold uppercase text-sm">Crossfader visual</span>
          <div className="flex gap-4 font-bold text-[10px]">
            <span className={crossfader < 0 ? 'text-[var(--orange)]' : 'text-slate-600'}>DECK A: {Math.max(0, 50 - Math.floor(crossfader / 2))}%</span>
            <span className={crossfader === 0 ? 'text-[var(--orange)]' : 'text-slate-600'}>CENTERED</span>
            <span className={crossfader > 0 ? 'text-[var(--orange)]' : 'text-slate-600'}>DECK B: {Math.max(0, 50 + Math.floor(crossfader / 2))}%</span>
          </div>
        </div>

        <p className="text-[10px] font-mono dj-dim">
          {audioRoutingEnabled
            ? 'Constant-power crossfade between deck gains.'
            : 'Visual blend indicator only. Does not mix audio.'}
        </p>

        <div className="relative flex items-center">
          <input 
            type="range"
            min="-100"
            max="100"
            step="1"
            value={crossfader}
            onChange={(e) => setCrossfader(parseInt(e.target.value))}
            title="Adjusts displayed deck balance. No audio is mixed."
            style={{ accentColor: 'var(--orange)' }}
            className="w-full h-2 rounded bg-slate-950 border border-[var(--border)] cursor-ew-resize appearance-none"
          />
        </div>

        <div className="flex justify-between font-mono text-[8px] text-[var(--text-dim)] uppercase">
          <span>Deck A</span>
          <span>Center</span>
          <span>Deck B</span>
        </div>

        {audioRoutingEnabled ? (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border)]/40">
            <label className="font-mono text-[10px] uppercase space-y-1">
              <span>Delay send</span>
              <input
                type="range"
                min="0"
                max="100"
                value={sendDelayMix}
                onChange={(e) => setSendDelayMix(parseInt(e.target.value, 10))}
                style={{ accentColor: 'var(--orange)' }}
                className="w-full"
              />
            </label>
            <label className="font-mono text-[10px] uppercase space-y-1">
              <span>Reverb send</span>
              <input
                type="range"
                min="0"
                max="100"
                value={sendReverbMix}
                onChange={(e) => setSendReverbMix(parseInt(e.target.value, 10))}
                style={{ accentColor: 'var(--orange)' }}
                className="w-full"
              />
            </label>
          </div>
        ) : null}
      </div>
      )}

    </div>
  );
}
