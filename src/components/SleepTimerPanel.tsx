import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlarmClock, Clock, Search, X } from 'lucide-react';
import ModalOverlay from '../stations/ModalOverlay';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';
import { isAirGapEnabled, subscribeAirGap } from '../airGapMode';
import { getLockerEntriesSnapshot } from '../lockerStorage';
import { getRecentlyPlayed } from '../playHistory';
import {
  cancelSleepSoundSession,
  getSleepSoundSnapshot,
  SLEEP_SOUND_CATEGORIES,
  SLEEP_SOUND_TIMER_PRESETS,
  SLEEP_SOUNDS,
  startSleepSound,
  subscribeSleepSounds,
  type SleepSoundCategory,
  type SleepSoundId,
} from '../sleepSounds';
import {
  cancelSleepTimer,
  cancelWakeAlarm,
  formatSleepRemaining,
  getSleepTimerSnapshot,
  getWakeAlarmSnapshot,
  presetLabel,
  setWakeAlarm,
  SLEEP_TIMER_PRESETS,
  startSleepTimer,
  subscribeSleepTimer,
  type SleepTimerPresetId,
  type WakeAlarmTrack,
} from '../sleepTimer';
import { seedGradient } from '../seedGradient';
import { proxiedArtworkUrl } from '../displaySanitize';
import {
  hitToWakeTrack,
  isWakeTrackCatalogPreview,
  loadWakeAlarmSuggestions,
  searchWakeTracksOnline,
  WAKE_SUGGESTION_CHIPS,
} from '../wakeAlarmSuggestions';
import { useTranslation } from '../i18n';

export interface SleepTimerPanelProps {
  open: boolean;
  onClose: () => void;
}

function lockerToWakeTrack(entry: {
  id: string;
  title: string;
  artist: string;
  url: string;
  albumArt?: string;
  durationSeconds: number;
  albumName?: string;
}): WakeAlarmTrack {
  return {
    envelopeId: `local-${entry.id}`,
    title: entry.title,
    artist: entry.artist,
    url: entry.url,
    artworkUrl: entry.albumArt,
    provider: 'local-vault',
    sourceId: entry.id,
    durationSeconds: entry.durationSeconds,
    transport: 'element-src',
    album: entry.albumName,
  };
}

const TrackPickRow: React.FC<{
  track: WakeAlarmTrack;
  selected: boolean;
  onSelect: () => void;
  badge?: string;
}> = ({ track, selected, onSelect, badge }) => {
  const art = proxiedArtworkUrl(track.artworkUrl) ?? track.artworkUrl ?? '';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`sleep-timer-track-row touch-manipulation ${selected ? 'sleep-timer-track-row--selected' : ''}`}
    >
      <div
        className="sleep-timer-track-badge shrink-0"
        style={{
          background: art
            ? `url(${art}) center/cover no-repeat, ${seedGradient(track.title)}`
            : seedGradient(track.title),
        }}
        aria-hidden
      />
      <div className="min-w-0 flex-1 text-left">
        <p className="font-mono text-xs truncate text-[var(--text)]">{track.title}</p>
        <p className="font-mono text-[10px] truncate text-[var(--text-mid)]">{track.artist || '—'}</p>
      </div>
      {badge ? (
        <span className="sleep-timer-track-source font-mono text-[9px] uppercase tracking-wider text-[var(--text-dim)] shrink-0">
          {badge}
        </span>
      ) : null}
    </button>
  );
};

function nextFireTimestamp(timeValue: string): number {
  const [h, m] = timeValue.split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Date.now() + 60_000;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

type PanelMode = 'sleep' | 'wake' | 'sounds';
type WakeSearchMode = 'library' | 'online';

export default function SleepTimerPanel({ open, onClose }: SleepTimerPanelProps) {
  const { t } = useTranslation();
  useDismissableOverlay(open, onClose);
  const [tick, setTick] = useState(0);
  const [soundTick, setSoundTick] = useState(0);
  const [mode, setMode] = useState<PanelMode>('sleep');
  const [wakeTime, setWakeTime] = useState('07:00');
  const [trackQuery, setTrackQuery] = useState('');
  const [wakeSearchMode, setWakeSearchMode] = useState<WakeSearchMode>('library');
  const [selectedTrack, setSelectedTrack] = useState<WakeAlarmTrack | null>(null);
  const [suggestions, setSuggestions] = useState<WakeAlarmTrack[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [onlineResults, setOnlineResults] = useState<WakeAlarmTrack[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [airGap, setAirGap] = useState(isAirGapEnabled);
  const [selectedSound, setSelectedSound] = useState<SleepSoundId>('rain');
  const [soundCategory, setSoundCategory] = useState<SleepSoundCategory | 'all'>('all');
  const [soundTimerPreset, setSoundTimerPreset] = useState<SleepTimerPresetId | null>('30');

  useEffect(() => subscribeAirGap(setAirGap), []);

  useEffect(() => {
    return subscribeSleepTimer(() => setTick((t) => t + 1));
  }, []);

  useEffect(() => {
    return subscribeSleepSounds(() => setSoundTick((t) => t + 1));
  }, []);

  useEffect(() => {
    if (!open) return;
    const wake = getWakeAlarmSnapshot();
    if (wake.fireAt) {
      const d = new Date(wake.fireAt);
      setWakeTime(
        `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`,
      );
    }
    if (wake.track) setSelectedTrack(wake.track);
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'wake') return;
    let cancelled = false;
    setSuggestionsLoading(true);
    void loadWakeAlarmSuggestions().then((tracks) => {
      if (!cancelled) {
        setSuggestions(tracks);
        setSuggestionsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, mode, airGap]);

  useEffect(() => {
    if (!open || mode !== 'wake' || wakeSearchMode !== 'online' || airGap) {
      setOnlineResults([]);
      return;
    }
    const q = trackQuery.trim();
    if (q.length < 2) {
      setOnlineResults([]);
      return;
    }

    let cancelled = false;
    setOnlineLoading(true);
    const handle = setTimeout(() => {
      void searchWakeTracksOnline(q).then((tracks) => {
        if (!cancelled) {
          setOnlineResults(tracks);
          setOnlineLoading(false);
        }
      });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, mode, wakeSearchMode, trackQuery, airGap]);

  const sleep = useMemo(() => getSleepTimerSnapshot(), [tick]);
  const wake = useMemo(() => getWakeAlarmSnapshot(), [tick]);
  const soundSnap = useMemo(() => getSleepSoundSnapshot(), [soundTick, tick]);

  const libraryCandidates = useMemo(() => {
    const q = trackQuery.trim().toLowerCase();
    const seen = new Set<string>();
    const out: WakeAlarmTrack[] = [];

    const push = (t: WakeAlarmTrack) => {
      if (!t.envelopeId || seen.has(t.envelopeId)) return;
      if (q) {
        const hay = `${t.title} ${t.artist} ${t.album ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      seen.add(t.envelopeId);
      out.push(t);
    };

    getRecentlyPlayed(24).forEach((h) => push(hitToWakeTrack(h)));
    const locker = getLockerEntriesSnapshot();
    if (locker) {
      for (const e of locker) {
        push(lockerToWakeTrack(e));
        if (out.length >= 40) break;
      }
    }
    return out.slice(0, 40);
  }, [trackQuery, open]);

  const wakeTrackList = wakeSearchMode === 'online' ? onlineResults : libraryCandidates;

  const filteredSleepSounds = useMemo(() => {
    if (soundCategory === 'all') return SLEEP_SOUNDS;
    return SLEEP_SOUNDS.filter((s) => s.category === soundCategory);
  }, [soundCategory]);

  const catalogPreviewSelected =
    selectedTrack !== null && isWakeTrackCatalogPreview(selectedTrack);

  const handleStartPreset = useCallback((id: SleepTimerPresetId) => {
    startSleepTimer(id);
  }, []);

  const handleArmWake = useCallback(() => {
    if (!selectedTrack) return;
    setWakeAlarm(nextFireTimestamp(wakeTime), selectedTrack);
  }, [selectedTrack, wakeTime]);

  const handleSuggestionChip = useCallback((chip: string) => {
    setWakeSearchMode('online');
    setTrackQuery(chip);
  }, []);

  const handleStartSleepSound = useCallback(() => {
    void startSleepSound(selectedSound, soundTimerPreset);
  }, [selectedSound, soundTimerPreset]);

  const handleStopSleepSound = useCallback(() => {
    cancelSleepSoundSession();
  }, []);

  const countdownLabel = formatSleepRemaining(
    sleep.remainingSeconds,
    sleep.isEventBased,
    sleep.preset,
  );

  return (
    <ModalOverlay
      open={open}
      onClose={onClose}
      title={t('sleep.title')}
      maxWidth="max-w-lg"
      borderAccent
      overlayClassName="sleep-timer-overlay"
      panelClassName="sleep-timer-overlay-panel"
      contentClassName="sleep-timer-overlay-content"
      contentPadding={false}
    >
      <div className="sleep-timer-panel flex flex-col min-h-0 flex-1">
        <div className="sleep-timer-header px-4 pt-4 pb-3 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="sleep-timer-clock-icon" aria-hidden>
              <AlarmClock className="w-6 h-6" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-mid)]">
                {t('sleep.subtitle')}
              </p>
              <p className="font-display text-lg font-bold uppercase tracking-wide text-accent">
                {t(`sleep.modes.${mode}`)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="sleep-timer-close touch-manipulation"
              aria-label={t('sleep.close')}
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>

          <div className="sleep-timer-mode-tabs mt-3">
            <button
              type="button"
              className={`sleep-timer-mode-tab ${mode === 'sleep' ? 'sleep-timer-mode-tab--active' : ''}`}
              onClick={() => setMode('sleep')}
            >
              {t('sleep.tabs.sleepStop')}
            </button>
            <button
              type="button"
              className={`sleep-timer-mode-tab ${mode === 'wake' ? 'sleep-timer-mode-tab--active' : ''}`}
              onClick={() => setMode('wake')}
            >
              {t('sleep.tabs.wakeAlarm')}
            </button>
            <button
              type="button"
              className={`sleep-timer-mode-tab ${mode === 'sounds' ? 'sleep-timer-mode-tab--active' : ''}`}
              onClick={() => setMode('sounds')}
            >
              {t('sleep.tabs.sleepSounds')}
            </button>
          </div>
        </div>

        <div
          className={`sleep-timer-body px-4 py-4 ${
            mode === 'wake'
              ? 'sleep-timer-body--wake flex flex-col min-h-0 flex-1 overflow-hidden gap-4'
              : 'flex-1 min-h-0 overflow-y-auto music-scrollbar space-y-4'
          }`}
        >
          {mode === 'sleep' ? (
            <>
              {sleep.active ? (
                <div className="sleep-timer-countdown-card">
                  <div className="flex items-center gap-2 text-accent">
                    <Clock className="w-4 h-4" strokeWidth={2} />
                    <span className="font-mono text-[10px] uppercase tracking-widest">
                      {sleep.preset ? presetLabel(sleep.preset) : t('sleep.active')}
                    </span>
                  </div>
                  <p className="sleep-timer-countdown-display font-mono tabular-nums">
                    {countdownLabel}
                  </p>
                  <button
                    type="button"
                    onClick={cancelSleepTimer}
                    className="sleep-timer-cancel-btn touch-manipulation"
                  >
                    {t('sleep.cancelTimer')}
                  </button>
                </div>
              ) : (
                <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-mid)]">
                  {t('sleep.stopAfter')}
                </p>
              )}

              <div className="sleep-timer-preset-grid">
                {SLEEP_TIMER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleStartPreset(p.id)}
                    className={`sleep-timer-preset-btn touch-manipulation ${
                      sleep.active && sleep.preset === p.id ? 'sleep-timer-preset-btn--active' : ''
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </>
          ) : mode === 'wake' ? (
            <>
              <div className="sleep-timer-wake-top shrink-0 space-y-4">
                {wake.active && wake.fireAt ? (
                  <div className="sleep-timer-countdown-card">
                    <div className="flex items-center gap-2 text-accent">
                      <AlarmClock className="w-4 h-4" strokeWidth={2} />
                      <span className="font-mono text-[10px] uppercase tracking-widest">
                        {t('sleep.wakeAt', {
                          time: new Date(wake.fireAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                        })}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-[var(--text-mid)] truncate">
                      {wake.track?.title} — {wake.track?.artist}
                    </p>
                    <button
                      type="button"
                      onClick={cancelWakeAlarm}
                      className="sleep-timer-cancel-btn touch-manipulation"
                    >
                      {t('sleep.cancelWakeAlarm')}
                    </button>
                  </div>
                ) : null}

                <div>
                  <label className="ui-field-label" htmlFor="wake-time">
                    {t('sleep.wakeTime')}
                  </label>
                  <input
                    id="wake-time"
                    type="time"
                    value={wakeTime}
                    onChange={(e) => setWakeTime(e.target.value)}
                    className="input-elevated w-full px-4 py-3 font-mono text-sm focus-accent mt-1"
                  />
                </div>

                <div>
                  <p className="ui-field-label">{t('sleep.suggestions')}</p>
                  <div className="sleep-timer-suggestion-chips mt-1">
                    {WAKE_SUGGESTION_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        className="sleep-timer-suggestion-chip touch-manipulation"
                        onClick={() => handleSuggestionChip(chip)}
                        disabled={airGap}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                  {suggestionsLoading ? (
                    <p className="font-mono text-[10px] text-[var(--text-dim)] mt-2">{t('sleep.loadingPicks')}</p>
                  ) : suggestions.length > 0 ? (
                    <div className="sleep-timer-suggestions-list space-y-1 mt-2">
                      {suggestions.slice(0, 8).map((t) => (
                        <TrackPickRow
                          key={`sug-${t.envelopeId}`}
                          track={t}
                          selected={selectedTrack?.envelopeId === t.envelopeId}
                          onSelect={() => setSelectedTrack(t)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="font-mono text-[10px] text-[var(--text-dim)] mt-2">
                      {t('sleep.playForSuggestions')}
                    </p>
                  )}
                </div>

                <div>
                  <label className="ui-field-label" htmlFor="wake-track-search">
                    {t('sleep.pickTrack')}
                  </label>
                  <div className="sleep-timer-search-tabs mt-1">
                    <button
                      type="button"
                      className={`sleep-timer-search-tab ${wakeSearchMode === 'library' ? 'sleep-timer-search-tab--active' : ''}`}
                      onClick={() => setWakeSearchMode('library')}
                    >
                      {t('sleep.library')}
                    </button>
                    <button
                      type="button"
                      className={`sleep-timer-search-tab ${wakeSearchMode === 'online' ? 'sleep-timer-search-tab--active' : ''}`}
                      onClick={() => !airGap && setWakeSearchMode('online')}
                      disabled={airGap}
                    >
                      {t('sleep.online')}
                    </button>
                  </div>
                  <div className="relative mt-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-dim)]" />
                    <input
                      id="wake-track-search"
                      type="search"
                      value={trackQuery}
                      onChange={(e) => setTrackQuery(e.target.value)}
                      placeholder={
                        wakeSearchMode === 'online'
                          ? t('sleep.searchCatalog')
                          : t('sleep.searchLocker')
                      }
                      className="input-elevated w-full pl-9 pr-4 py-2.5 font-mono text-xs focus-accent"
                    />
                  </div>
                  {airGap && wakeSearchMode === 'online' ? (
                    <p className="font-mono text-[10px] text-[var(--text-dim)] mt-1.5">
                      {t('sleep.airGapOnline')}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="sleep-timer-track-list flex-1 min-h-0 overflow-y-auto music-scrollbar space-y-1">
                {wakeSearchMode === 'online' && onlineLoading ? (
                  <p className="font-mono text-[10px] text-[var(--text-dim)] py-2">{t('sleep.searchingCatalog')}</p>
                ) : wakeTrackList.length === 0 ? (
                  <p className="font-mono text-[10px] text-[var(--text-dim)] py-2">
                    {wakeSearchMode === 'online'
                      ? trackQuery.trim().length < 2
                        ? t('sleep.typeTwoChars')
                        : t('sleep.noCatalogTracks')
                      : t('sleep.noTracksFound')}
                  </p>
                ) : (
                  wakeTrackList.map((t) => (
                    <TrackPickRow
                      key={t.envelopeId}
                      track={t}
                      selected={selectedTrack?.envelopeId === t.envelopeId}
                      onSelect={() => setSelectedTrack(t)}
                      badge={
                        wakeSearchMode === 'online' && t.provider !== 'local-vault'
                          ? t('sleep.catalog')
                          : undefined
                      }
                    />
                  ))
                )}
              </div>

              <div className="sleep-timer-wake-footer shrink-0 space-y-2">
                {catalogPreviewSelected ? (
                  <p className="font-mono text-[10px] text-[var(--text-dim)] leading-relaxed">
                    {t('sleep.catalogPreview')}
                  </p>
                ) : null}

                <button
                  type="button"
                  disabled={!selectedTrack}
                  onClick={handleArmWake}
                  className="sleep-timer-arm-btn touch-manipulation disabled:opacity-40"
                >
                  {t('sleep.armWakeAlarm')}
                </button>
              </div>
            </>
          ) : (
            <>
              {soundSnap.active ? (
                <div className="sleep-timer-countdown-card">
                  <div className="flex items-center gap-2 text-accent">
                    <Clock className="w-4 h-4" strokeWidth={2} />
                    <span className="font-mono text-[10px] uppercase tracking-widest">
                      {SLEEP_SOUNDS.find((s) => s.id === soundSnap.soundId)?.label ?? t('sleep.playing')}
                    </span>
                  </div>
                  {sleep.active && !sleep.isEventBased ? (
                    <p className="sleep-timer-countdown-display font-mono tabular-nums">
                      {countdownLabel}
                    </p>
                  ) : (
                    <p className="font-mono text-xs text-[var(--text-mid)]">{t('sleep.ambientLoop')}</p>
                  )}
                  <button
                    type="button"
                    onClick={handleStopSleepSound}
                    className="sleep-timer-cancel-btn touch-manipulation"
                  >
                    {t('sleep.stopSound')}
                  </button>
                </div>
              ) : (
                <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-mid)]">
                  {t('sleep.selectAmbient')}
                </p>
              )}

              <div>
                <p className="ui-field-label">{t('sleep.category')}</p>
                <div className="sleep-timer-suggestion-chips mt-1">
                  {SLEEP_SOUND_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`sleep-timer-suggestion-chip touch-manipulation ${
                        soundCategory === cat.id ? 'sleep-timer-suggestion-chip--active' : ''
                      }`}
                      onClick={() => setSoundCategory(cat.id)}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sleep-timer-sound-grid">
                {filteredSleepSounds.map((sound) => (
                  <button
                    key={sound.id}
                    type="button"
                    onClick={() => setSelectedSound(sound.id)}
                    className={`sleep-timer-sound-btn touch-manipulation ${
                      selectedSound === sound.id ? 'sleep-timer-sound-btn--active' : ''
                    } ${soundSnap.active && soundSnap.soundId === sound.id ? 'sleep-timer-sound-btn--playing' : ''}`}
                  >
                    {sound.label}
                  </button>
                ))}
              </div>

              <div>
                <p className="ui-field-label">{t('sleep.fadeOutAfter')}</p>
                <div className="sleep-timer-preset-grid mt-1">
                  <button
                    type="button"
                    onClick={() => setSoundTimerPreset(null)}
                    className={`sleep-timer-preset-btn touch-manipulation ${
                      soundTimerPreset === null ? 'sleep-timer-preset-btn--active' : ''
                    }`}
                  >
                    {t('sleep.noTimer')}
                  </button>
                  {SLEEP_SOUND_TIMER_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSoundTimerPreset(p.id)}
                      className={`sleep-timer-preset-btn touch-manipulation ${
                        soundTimerPreset === p.id ? 'sleep-timer-preset-btn--active' : ''
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleStartSleepSound}
                className="sleep-timer-arm-btn touch-manipulation"
              >
                {soundSnap.active ? t('sleep.restartSound') : t('sleep.startSleepSound')}
              </button>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}
