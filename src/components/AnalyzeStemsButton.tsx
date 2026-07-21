import React from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n';

type AnalyzeStemsButtonProps = {
  trackId: string;
  title: string;
  busy?: boolean;
  onAnalyze: (trackId: string) => void;
  alwaysVisible?: boolean;
};

export default function AnalyzeStemsButton({
  trackId,
  title,
  busy = false,
  onAnalyze,
  alwaysVisible = false,
}: AnalyzeStemsButtonProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onAnalyze(trackId);
      }}
      className={`search-results-action touch-manipulation transition-opacity ${
        alwaysVisible
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
      }`}
      aria-label={t('stems.analyzeAria', { title })}
      title={t('stems.analyze')}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
    </button>
  );
}
