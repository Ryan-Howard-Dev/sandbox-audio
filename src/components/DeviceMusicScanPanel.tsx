import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, FolderOpen, Globe, Loader2, Music, Search, Smartphone } from 'lucide-react';
import {
  isDeviceMusicScanAvailable,
  scanDeviceMusic,
  type DeviceMusicScanProgress,
} from '../deviceMusicScan';
import {
  audiobookRejectToastKey,
  isDefaultMusicSelection,
  isLikelyAudiobookOrNonMusic,
  partitionMusicScanHits,
  type DeviceMusicScanHit,
} from '../lockerUploadFilter';
import { saveLockerBlobFromNativeFile, LockerCapacityExceededError } from '../lockerStorage';
import { scheduleLockerSearchReindex } from '../lockerSearchSync';
import { enrichImportedLockerTracks, resolveDeviceScanMetadata } from '../deviceImportMetadata';
import { isAirGapEnabled } from '../airGapMode';
import { useTranslation } from '../i18n';
import { formatTime } from '../stations/theme';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** idx;
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

type GroupMode = 'flat' | 'folder' | 'album';

export type DeviceMusicScanPanelProps = {
  disabled?: boolean;
  /** Refresh locker list after import or metadata fix — do not close the modal. */
  onLockerRefresh: () => void;
  /** Close the upload modal when the user taps Done on the import success screen. */
  onDismiss?: () => void;
  onManualPick: () => void;
  setToast: (message: string) => void;
  manualOpen?: boolean;
};

function TrackRow({
  hit,
  checked,
  onToggle,
  selectable,
}: {
  hit: DeviceMusicScanHit;
  checked: boolean;
  onToggle?: () => void;
  selectable: boolean;
}) {
  const title = hit.title.trim() || hit.displayName;
  const artist = hit.artist.trim() || 'Unknown artist';
  const subtitle = [artist, hit.album.trim(), hit.folder.trim()].filter(Boolean).join(' · ');

  return (
    <label
      className={`flex items-start gap-3 px-3 py-2.5 touch-manipulation ${
        selectable ? 'hover:bg-[var(--bg-hover)] cursor-pointer' : 'opacity-70 cursor-default'
      }`}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1 accent-[var(--orange)]"
        />
      ) : (
        <span className="mt-1 w-4 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-xs text-[var(--text-mid)] truncate">{subtitle}</p>
        <p className="text-[10px] text-[var(--text-dim)] truncate mt-0.5">
          {hit.path || hit.displayName}
        </p>
      </div>
      <div className="text-[10px] text-[var(--text-dim)] text-right shrink-0">
        <div>{formatBytes(hit.size)}</div>
        {hit.durationMs > 0 && <div>{formatTime(hit.durationMs / 1000)}</div>}
      </div>
    </label>
  );
}

export default function DeviceMusicScanPanel({
  disabled = false,
  onLockerRefresh,
  onDismiss,
  onManualPick,
  setToast,
  manualOpen = false,
}: DeviceMusicScanPanelProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'results' | 'importing' | 'imported'>('idle');
  const [scanProgress, setScanProgress] = useState<DeviceMusicScanProgress | null>(null);
  const [musicTracks, setMusicTracks] = useState<DeviceMusicScanHit[]>([]);
  const [otherTracks, setOtherTracks] = useState<DeviceMusicScanHit[]>([]);
  const [showOther, setShowOther] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('folder');
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [lastImportedIds, setLastImportedIds] = useState<string[]>([]);
  const [metadataProgress, setMetadataProgress] = useState<{ current: number; total: number; label?: string } | null>(
    null,
  );
  const [metadataBusy, setMetadataBusy] = useState(false);

  const filteredMusic = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return musicTracks;
    return musicTracks.filter((hit) => {
      const hay = `${hit.title} ${hit.artist} ${hit.album} ${hit.folder} ${hit.path}`.toLowerCase();
      return hay.includes(q);
    });
  }, [musicTracks, query]);

  const groupedMusic = useMemo(() => {
    const map = new Map<string, DeviceMusicScanHit[]>();
    for (const hit of filteredMusic) {
      const key =
        groupMode === 'album'
          ? hit.album.trim() || 'Unknown album'
          : groupMode === 'folder'
            ? hit.folder.trim() || 'Unknown folder'
            : '';
      if (!key) {
        const list = map.get('') ?? [];
        list.push(hit);
        map.set('', list);
        continue;
      }
      const list = map.get(key) ?? [];
      list.push(hit);
      map.set(key, list);
    }
    if (groupMode === 'flat') return [['', filteredMusic] as const];
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [filteredMusic, groupMode]);

  const selectedCount = selected.size;

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((hits: DeviceMusicScanHit[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const hit of hits) {
        if (on) next.add(hit.id);
        else next.delete(hit.id);
      }
      return next;
    });
  }, []);

  const runScan = useCallback(async () => {
    if (!isDeviceMusicScanAvailable() || disabled) return;
    setPhase('scanning');
    setScanProgress(null);
    setMusicTracks([]);
    setOtherTracks([]);
    setSelected(new Set());
    setShowOther(false);
    try {
      const raw = await scanDeviceMusic((progress) => setScanProgress(progress));
      const { music, other } = partitionMusicScanHits(raw);
      setMusicTracks(music);
      setOtherTracks(other);
      const defaults = music.filter(isDefaultMusicSelection).map((hit) => hit.id);
      setSelected(new Set(defaults));
      setPhase('results');
      if (music.length === 0 && other.length === 0) {
        setToast(t('locker.deviceScanEmpty'));
      } else if (music.length === 0) {
        setToast(t('locker.deviceScanOnlyOther', { count: other.length }));
      } else if (other.length > 0) {
        setToast(t('locker.deviceScanFilteredCount', { count: other.length }));
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message.toLowerCase().includes('permission')
          ? t('locker.deviceScanPermissionDenied')
          : err instanceof Error
            ? err.message
            : t('locker.deviceScanFailed');
      setPhase('idle');
      setToast(message);
    }
  }, [disabled, setToast, t]);

  const runImport = useCallback(async () => {
    if (selectedCount === 0 || phase === 'importing') return;
    const picks = musicTracks.filter((hit) => selected.has(hit.id));
    if (picks.length === 0) return;

    setPhase('importing');
    setImportProgress({ current: 0, total: picks.length });
    let saved = 0;
    const importedIds: string[] = [];

    try {
      for (let i = 0; i < picks.length; i++) {
        const hit = picks[i]!;
        const block = isLikelyAudiobookOrNonMusic(hit, { audioFileCount: picks.length });
        if (block.blocked) {
          setToast(t(audiobookRejectToastKey(block.reason)));
          continue;
        }

        const resolved = resolveDeviceScanMetadata(hit);
        const durationSeconds =
          hit.durationMs > 0 ? Math.round(hit.durationMs / 1000) : undefined;

        const { entry } = await saveLockerBlobFromNativeFile(hit.contentUri, {
          title: resolved.title,
          artist: resolved.artist,
          albumName: resolved.albumName,
          durationSeconds,
          mimeType: hit.mimeType || undefined,
          skipHeavyAnalysis: true,
        });
        importedIds.push(entry.id);
        saved += 1;
        setImportProgress({ current: i + 1, total: picks.length });
      }

      scheduleLockerSearchReindex();
      setLastImportedIds(importedIds);
      setToast(t('locker.deviceScanImported', { count: saved }));
      setPhase('imported');
      onLockerRefresh();
    } catch (err) {
      if (err instanceof LockerCapacityExceededError) {
        setToast(err.message);
      } else {
        setToast(err instanceof Error ? err.message : t('locker.deviceScanImportFailed'));
      }
      setPhase('results');
    } finally {
      setImportProgress(null);
    }
  }, [musicTracks, onLockerRefresh, phase, selected, selectedCount, setToast, t]);

  const runFetchMetadata = useCallback(async () => {
    if (metadataBusy || lastImportedIds.length === 0 || isAirGapEnabled()) return;
    setMetadataBusy(true);
    setMetadataProgress({ current: 0, total: lastImportedIds.length });
    try {
      const result = await enrichImportedLockerTracks(lastImportedIds, (progress) => {
        setMetadataProgress({
          current: progress.current,
          total: progress.total,
          label: progress.label,
        });
      });
      scheduleLockerSearchReindex();
      onLockerRefresh();
      setToast(
        result.repaired > 0
          ? t('locker.deviceScanMetadataDone', { count: result.repaired })
          : t('locker.deviceScanMetadataNone'),
      );
    } catch (err) {
      setToast(err instanceof Error ? err.message : t('locker.deviceScanMetadataFailed'));
    } finally {
      setMetadataBusy(false);
      setMetadataProgress(null);
    }
  }, [lastImportedIds, metadataBusy, onLockerRefresh, setToast, t]);

  useEffect(() => {
    if (phase !== 'results') return;
    if (musicTracks.length > 0 && selected.size === 0) {
      const defaults = musicTracks.filter(isDefaultMusicSelection).map((hit) => hit.id);
      if (defaults.length > 0) {
        setSelected(new Set(defaults));
      }
    }
  }, [phase, musicTracks, selected.size]);

  if (!isDeviceMusicScanAvailable()) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border-hi)] bg-[var(--bg-card)] p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Smartphone className="w-6 h-6 text-accent shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t('locker.deviceScanTitle')}</p>
            <p className="text-xs text-[var(--text-mid)] mt-1">{t('locker.deviceScanHint')}</p>
          </div>
        </div>

        {phase === 'idle' && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void runScan()}
            className="w-full h-11 rounded btn-accent text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 touch-manipulation disabled:opacity-40"
          >
            <Music className="w-4 h-4" />
            {t('locker.deviceScanButton')}
          </button>
        )}

        {phase === 'scanning' && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-mid)]">
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
            <span>
              {scanProgress?.scanned
                ? t('locker.deviceScanProgress', { count: scanProgress.scanned })
                : t('locker.deviceScanStarting')}
            </span>
          </div>
        )}

        {phase === 'imported' && (
          <div className="space-y-3">
            <p className="text-xs text-accent font-semibold">
              {t('locker.deviceScanImported', { count: lastImportedIds.length })}
            </p>
            <p className="text-xs text-[var(--text-mid)]">{t('locker.deviceScanMetadataHint')}</p>
            {metadataProgress && (
              <p className="text-xs text-[var(--text-mid)]">
                {t('locker.deviceScanMetadataProgress', {
                  current: metadataProgress.current,
                  total: metadataProgress.total,
                  label: metadataProgress.label ?? '',
                })}
              </p>
            )}
            {!isAirGapEnabled() ? (
              <button
                type="button"
                disabled={disabled || metadataBusy || lastImportedIds.length === 0}
                onClick={() => void runFetchMetadata()}
                className="w-full h-11 rounded btn-accent text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 touch-manipulation disabled:opacity-40"
              >
                {metadataBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('locker.deviceScanMetadataFetching')}
                  </>
                ) : (
                  <>
                    <Globe className="w-4 h-4" />
                    {t('locker.deviceScanFetchMetadata')}
                  </>
                )}
              </button>
            ) : (
              <p className="text-xs text-amber-400/90">{t('locker.deviceScanMetadataAirGap')}</p>
            )}
            <button
              type="button"
              disabled={disabled || metadataBusy}
              onClick={() => {
                setPhase('idle');
                setLastImportedIds([]);
                onDismiss?.();
              }}
              className="w-full h-9 rounded border border-[var(--border)] text-xs font-semibold touch-manipulation text-[var(--text-mid)] hover:text-[var(--text)]"
            >
              {t('locker.deviceScanDone')}
            </button>
          </div>
        )}

        {phase === 'results' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-accent font-semibold">
                {t('locker.deviceScanFound', { count: musicTracks.length })}
              </span>
              {otherTracks.length > 0 && (
                <span className="text-[var(--text-mid)]">
                  {t('locker.deviceScanOtherHidden', { count: otherTracks.length })}
                </span>
              )}
              <button
                type="button"
                disabled={disabled || phase === 'importing'}
                onClick={() => void runScan()}
                className="ml-auto text-[var(--text-mid)] hover:text-[var(--text)] underline touch-manipulation"
              >
                {t('locker.deviceScanRescan')}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[140px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('locker.deviceScanFilter')}
                  className="w-full h-10 pl-9 pr-3 border border-[var(--border)] rounded-lg input-elevated text-sm focus-accent"
                />
              </div>
              <select
                value={groupMode}
                onChange={(e) => setGroupMode(e.target.value as GroupMode)}
                className="h-10 px-3 border border-[var(--border)] rounded-lg input-elevated text-xs focus-accent"
                aria-label={t('locker.deviceScanGroupBy')}
              >
                <option value="folder">{t('locker.deviceScanGroupFolder')}</option>
                <option value="album">{t('locker.deviceScanGroupAlbum')}</option>
                <option value="flat">{t('locker.deviceScanGroupFlat')}</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className="px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--orange)] touch-manipulation"
                onClick={() => setSelected(new Set(filteredMusic.map((hit) => hit.id)))}
              >
                {t('locker.deviceScanSelectAllMusic')}
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--orange)] touch-manipulation"
                onClick={() => setSelected(new Set())}
              >
                {t('locker.deviceScanClear')}
              </button>
              <span className="ml-auto text-[var(--text-mid)] self-center">
                {t('locker.deviceScanSelected', { count: selectedCount })}
              </span>
            </div>

            <div className="rounded border border-[var(--border)] overflow-hidden">
              <div className="px-3 py-2 bg-[var(--bg-void)] border-b border-[var(--border)] text-xs font-semibold flex items-center gap-2">
                <Music className="w-3.5 h-3.5 text-accent" />
                {t('locker.deviceScanMusicSection', { count: musicTracks.length })}
              </div>

              {musicTracks.length === 0 ? (
                <p className="px-3 py-6 text-xs text-center text-[var(--text-mid)]">
                  {t('locker.deviceScanEmpty')}
                </p>
              ) : (
                <div className="max-h-[min(38vh,280px)] overflow-y-auto divide-y divide-[var(--border)]">
                  {groupedMusic.map(([groupLabel, hits]) => (
                    <div key={groupLabel || 'all'}>
                      {groupLabel && (
                        <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-[var(--bg-void)] border-b border-[var(--border)] text-xs font-semibold">
                          <FolderOpen className="w-3.5 h-3.5 text-[var(--text-dim)]" />
                          <span className="truncate flex-1">{groupLabel}</span>
                          <button
                            type="button"
                            className="text-[var(--text-mid)] hover:text-[var(--text)] touch-manipulation"
                            onClick={() => {
                              const allOn = hits.every((hit) => selected.has(hit.id));
                              toggleGroup(hits, !allOn);
                            }}
                          >
                            {hits.every((hit) => selected.has(hit.id))
                              ? t('locker.deviceScanClear')
                              : t('locker.deviceScanSelectAll')}
                          </button>
                        </div>
                      )}
                      {hits.map((hit) => (
                        <div key={hit.id}>
                          <TrackRow
                            hit={hit}
                            checked={selected.has(hit.id)}
                            onToggle={() => toggleOne(hit.id)}
                            selectable
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                  {filteredMusic.length === 0 && (
                    <p className="px-3 py-6 text-xs text-center text-[var(--text-mid)]">
                      {t('locker.deviceScanNoMatches')}
                    </p>
                  )}
                </div>
              )}
            </div>

            {otherTracks.length > 0 && (
              <div className="rounded border border-[var(--border)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowOther((v) => !v)}
                  className="w-full px-3 py-2.5 bg-[var(--bg-void)] border-b border-[var(--border)] text-xs font-semibold flex items-center gap-2 touch-manipulation hover:bg-[var(--bg-hover)]"
                >
                  {showOther ? (
                    <ChevronUp className="w-3.5 h-3.5 text-[var(--text-dim)]" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-[var(--text-dim)]" />
                  )}
                  <span className="flex-1 text-left">
                    {showOther
                      ? t('locker.deviceScanOtherCollapse')
                      : t('locker.deviceScanOtherExpand', { count: otherTracks.length })}
                  </span>
                </button>
                {showOther && (
                  <>
                    <p className="px-3 py-2 text-[10px] text-[var(--text-mid)] border-b border-[var(--border)]">
                      {t('locker.deviceScanOtherHint')}
                    </p>
                    <div className="max-h-[min(28vh,200px)] overflow-y-auto divide-y divide-[var(--border)]">
                      {otherTracks.map((hit) => (
                        <div key={hit.id}>
                          <TrackRow hit={hit} checked={false} selectable={false} />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {importProgress && (
              <p className="text-xs text-[var(--text-mid)]">
                {t('locker.deviceScanImporting', {
                  current: importProgress.current,
                  total: importProgress.total,
                })}
              </p>
            )}

            <button
              type="button"
              disabled={disabled || selectedCount === 0 || phase === 'importing'}
              onClick={() => void runImport()}
              className="w-full h-11 rounded btn-accent text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 touch-manipulation disabled:opacity-40"
            >
              {phase === 'importing' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('locker.deviceScanImporting', {
                    current: importProgress?.current ?? 0,
                    total: importProgress?.total ?? selectedCount,
                  })}
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  {t('locker.deviceScanImport', { count: selectedCount })}
                </>
              )}
            </button>
          </div>
        )}
      </div>

      <div className="text-center">
        <button
          type="button"
          disabled={disabled}
          onClick={onManualPick}
          className="text-xs text-[var(--text-mid)] hover:text-[var(--text)] underline touch-manipulation disabled:opacity-40"
        >
          {manualOpen ? t('locker.deviceScanHideManual') : t('locker.deviceScanManual')}
        </button>
      </div>
    </div>
  );
}
