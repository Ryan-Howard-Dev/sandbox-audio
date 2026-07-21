import React, { useCallback, useState } from 'react';
import { Download, Loader2, Magnet, Search, Settings2 } from 'lucide-react';
import {
  audiobookAcquireResolver,
  downloadAudiobookAcquire,
  type AcquireSearchHit,
} from '../../audiobookAcquireResolver';
import {
  getEnabledAudiobookSearchPlugins,
  loadAudiobookSearchPlugins,
} from '../../audiobookSearchPlugins';
import { useTranslation } from '../../i18n';
import { isDeviceMusicScanAvailable, scanDeviceAudiobooks } from '../../deviceMusicScan';

export interface AudiobookAcquirePanelProps {
  onOpenSettings?: () => void;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

export default function AudiobookAcquirePanel({
  onOpenSettings,
  onError,
  onSuccess,
}: AudiobookAcquirePanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [magnetPaste, setMagnetPaste] = useState('');
  const [searching, setSearching] = useState(false);
  const [acquiring, setAcquiring] = useState<string | null>(null);
  const [hits, setHits] = useState<AcquireSearchHit[]>([]);

  const pluginCount = loadAudiobookSearchPlugins().length;
  const enabledCount = getEnabledAudiobookSearchPlugins().length;

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    const plugins = getEnabledAudiobookSearchPlugins();
    if (plugins.length === 0) {
      onError?.(t('audiobooks.acquireNoPlugins'));
      return;
    }
    setSearching(true);
    try {
      const results = await audiobookAcquireResolver.searchPlugins(q, plugins);
      setHits(results);
      if (results.length === 0) onError?.(t('audiobooks.acquireSearchEmpty'));
    } catch (e) {
      onError?.(e instanceof Error ? e.message : t('audiobooks.acquireSearchFailed'));
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, [onError, query, t]);

  const acquireHit = useCallback(
    async (hit: AcquireSearchHit) => {
      setAcquiring(hit.id);
      try {
        const resolved = hit.magnetUrl
          ? await audiobookAcquireResolver.resolveMagnet(hit.magnetUrl)
          : hit.torrentUrl
            ? await audiobookAcquireResolver.resolveTorrent(hit.torrentUrl)
            : null;
        if (!resolved) throw new Error(t('audiobooks.acquireNoLink'));
        const downloaded = await downloadAudiobookAcquire({ ...resolved, title: hit.title });
        if (isDeviceMusicScanAvailable()) {
          await scanDeviceAudiobooks();
        }
        const fileCount = downloaded.files.length;
        onSuccess?.(
          t('audiobooks.acquireDone', {
            title: hit.title,
            count: fileCount,
            path: downloaded.importPath ?? '',
          }),
        );
      } catch (e) {
        onError?.(e instanceof Error ? e.message : t('audiobooks.acquireFailed'));
      } finally {
        setAcquiring(null);
      }
    },
    [onError, onSuccess, t],
  );

  const acquirePasted = useCallback(async () => {
    const link = magnetPaste.trim();
    if (!link) return;
    setAcquiring('paste');
    try {
      const resolved = link.startsWith('magnet:')
        ? await audiobookAcquireResolver.resolveMagnet(link)
        : await audiobookAcquireResolver.resolveTorrent(link);
      const downloaded = await downloadAudiobookAcquire(resolved);
      if (isDeviceMusicScanAvailable()) {
        await scanDeviceAudiobooks();
      }
      onSuccess?.(
        t('audiobooks.acquireDone', {
          title: resolved.title,
          count: downloaded.files.length,
          path: downloaded.importPath ?? '',
        }),
      );
      setMagnetPaste('');
    } catch (e) {
      onError?.(e instanceof Error ? e.message : t('audiobooks.acquireFailed'));
    } finally {
      setAcquiring(null);
    }
  }, [magnetPaste, onError, onSuccess, t]);

  return (
    <div className="podcasts-discover audiobooks-acquire">
      <div className="podcasts-discover-hero">
        <Magnet className="w-5 h-5 text-accent shrink-0" aria-hidden />
        <div>
          <p className="podcasts-discover-hero-title">{t('audiobooks.acquireTitle')}</p>
          <p className="podcasts-discover-hero-lead">{t('audiobooks.acquireLead')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="font-mono text-[10px] text-[var(--text-dim)]">
          {t('audiobooks.acquirePluginStatus', { enabled: enabledCount, total: pluginCount })}
        </p>
        {onOpenSettings ? (
          <button
            type="button"
            className="font-mono text-[10px] uppercase tracking-wider text-accent inline-flex items-center gap-1 touch-manipulation"
            onClick={onOpenSettings}
          >
            <Settings2 className="w-3.5 h-3.5" />
            {t('audiobooks.acquireOpenSettings')}
          </button>
        ) : null}
      </div>

      <form
        className="podcasts-discover-search mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <Search className="w-4 h-4 text-[var(--text-dim)] shrink-0" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('audiobooks.acquireSearchPlaceholder')}
          className="podcasts-discover-search-input"
        />
        <button
          type="submit"
          className="podcasts-discover-search-btn touch-manipulation"
          disabled={searching || query.trim().length < 2 || enabledCount === 0}
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : t('audiobooks.search')}
        </button>
      </form>

      {hits.length > 0 ? (
        <ul className="podcasts-episode-list divide-y divide-[var(--border)] mb-4">
          {hits.map((hit) => (
            <li key={hit.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-mono text-sm text-[var(--text)] truncate">{hit.title}</p>
                <p className="font-mono text-[9px] text-[var(--text-dim)]">{hit.pluginName}</p>
              </div>
              <button
                type="button"
                className="btn-accent touch-manipulation h-9 px-3 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-1.5 shrink-0"
                disabled={acquiring === hit.id}
                onClick={() => void acquireHit(hit)}
              >
                {acquiring === hit.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                {t('audiobooks.acquireDownload')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="border-t border-[var(--border)] pt-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-dim)] mb-2">
          {t('audiobooks.acquirePasteLabel')}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={magnetPaste}
            onChange={(e) => setMagnetPaste(e.target.value)}
            placeholder={t('audiobooks.acquirePastePlaceholder')}
            className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] font-mono text-sm"
          />
          <button
            type="button"
            className="btn-accent touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center justify-center gap-2"
            disabled={!magnetPaste.trim() || acquiring === 'paste'}
            onClick={() => void acquirePasted()}
          >
            {acquiring === 'paste' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {t('audiobooks.acquireResolve')}
          </button>
        </div>
      </div>
    </div>
  );
}
