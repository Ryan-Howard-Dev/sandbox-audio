import React from 'react';
import { useTranslation } from '../i18n';

export function StationChunkFallback() {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-1 items-center justify-center min-h-[12rem] text-[var(--text-dim)]"
      aria-busy="true"
      aria-label={t('shell.loadingAria')}
    >
      <span className="font-mono text-xs uppercase tracking-widest animate-pulse">
        Loading…
      </span>
    </div>
  );
}
