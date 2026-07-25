import React, { useCallback, useEffect, useState } from 'react';
import { HardDriveDownload, Loader2 } from 'lucide-react';
import {
  previewStorageReclaim,
  runStorageReclaim,
  type StorageReclaimPreview,
} from '../../storageReclaim';
import { useTranslation } from '../../i18n';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

type Phase = 'idle' | 'scanning' | 'ready' | 'confirm' | 'running' | 'done';

export default function StorageReclaimCard({ cardStyle }: { cardStyle?: React.CSSProperties }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<StorageReclaimPreview | null>(null);
  const [freedBytes, setFreedBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setPhase('scanning');
    setError(null);
    try {
      const result = await previewStorageReclaim();
      setPreview(result);
      setPhase('ready');
    } catch {
      setError(t('settings.vault.reclaim.error'));
      setPhase('idle');
    }
  }, [t]);

  useEffect(() => {
    void scan();
  }, [scan]);

  const apply = useCallback(async () => {
    setPhase('running');
    setError(null);
    try {
      const result = await runStorageReclaim({ mode: 'full' });
      setFreedBytes(result.totalFreedBytes);
      setPhase('done');
      // Re-scan so the numbers reflect the post-clean state.
      const next = await previewStorageReclaim();
      setPreview(next);
    } catch {
      setError(t('settings.vault.reclaim.error'));
      setPhase('ready');
    }
  }, [t]);

  const reclaimable = preview?.totalBytes ?? 0;
  const nothingToDo = phase === 'ready' && reclaimable <= 0;

  return (
    <div className="settings-anchor-section p-5 rounded-xl border space-y-4" style={cardStyle}>
      <div className="flex items-start gap-3">
        <HardDriveDownload className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div>
          <p className="font-mono text-xs uppercase">{t('settings.vault.reclaim.title')}</p>
          <p className="ui-hint mt-1">{t('settings.vault.reclaim.hint')}</p>
        </div>
      </div>

      {phase === 'scanning' ? (
        <p className="ui-hint flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> {t('settings.vault.reclaim.scanning')}
        </p>
      ) : null}

      {preview && phase !== 'scanning' ? (
        <div className="space-y-1">
          <p className="font-mono text-sm" style={{ color: 'var(--text-mid)' }}>
            {t('settings.vault.reclaim.reclaimable', { size: formatBytes(reclaimable) })}
          </p>
          <p className="ui-hint">
            {t('settings.vault.reclaim.breakdown', {
              orphans: preview.nativeOrphanCount,
              orphanSize: formatBytes(preview.nativeOrphanBytes),
              copies: preview.idbReclaimCount,
              copySize: formatBytes(preview.idbReclaimBytes),
            })}
          </p>
        </div>
      ) : null}

      {phase === 'done' ? (
        <p className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
          {t('settings.vault.reclaim.done', { size: formatBytes(freedBytes) })}
        </p>
      ) : null}

      {error ? <p className="font-mono text-xs text-red-400">{error}</p> : null}

      <div className="flex items-center gap-2">
        {phase === 'confirm' ? (
          <>
            <button
              type="button"
              onClick={apply}
              className="h-9 px-4 rounded btn-accent text-xs font-semibold touch-manipulation"
            >
              {t('settings.vault.reclaim.confirmButton', { size: formatBytes(reclaimable) })}
            </button>
            <button
              type="button"
              onClick={() => setPhase('ready')}
              className="h-9 px-4 rounded border text-xs font-semibold touch-manipulation"
              style={cardStyle}
            >
              {t('settings.vault.reclaim.cancel')}
            </button>
          </>
        ) : phase === 'running' ? (
          <button
            type="button"
            disabled
            className="h-9 px-4 rounded btn-accent text-xs font-semibold opacity-70 flex items-center gap-2"
          >
            <Loader2 className="w-4 h-4 animate-spin" /> {t('settings.vault.reclaim.running')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (reclaimable > 0 ? setPhase('confirm') : void scan())}
            disabled={phase === 'scanning'}
            className="h-9 px-4 rounded btn-accent text-xs font-semibold touch-manipulation disabled:opacity-50"
          >
            {nothingToDo
              ? t('settings.vault.reclaim.rescan')
              : t('settings.vault.reclaim.button')}
          </button>
        )}
      </div>
    </div>
  );
}
