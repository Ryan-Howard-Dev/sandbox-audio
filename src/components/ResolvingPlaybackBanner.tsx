import React from 'react';
import { Loader2, X } from 'lucide-react';
import type { AudioFsmState } from '../sandboxLayer1';
import { useTranslation } from '../i18n';

export interface ResolvingPlaybackBannerProps {
  state: AudioFsmState;
  elapsedSeconds: number;
  onCancel?: () => void;
  compact?: boolean;
  className?: string;
}

export default function ResolvingPlaybackBanner({
  state,
  elapsedSeconds,
  onCancel,
  compact = false,
  className = '',
}: ResolvingPlaybackBannerProps) {
  const { t } = useTranslation();

  if (state !== 'Resolving' && state !== 'Connecting') return null;

  const label =
    state === 'Resolving'
      ? t('player.resolvingElapsed', { seconds: elapsedSeconds })
      : t('player.connectingElapsed', { seconds: elapsedSeconds });

  return (
    <div
      className={`resolving-playback-banner${compact ? ' resolving-playback-banner--compact' : ''} ${className}`.trim()}
      role="status"
      aria-live="polite"
      data-testid="resolving-playback-banner"
    >
      <Loader2 className="resolving-playback-banner__spinner" aria-hidden />
      <span className="resolving-playback-banner__label">{label}</span>
      {onCancel ? (
        <button
          type="button"
          className="resolving-playback-banner__cancel touch-manipulation"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          aria-label={t('player.cancelResolve')}
        >
          <X className="w-3.5 h-3.5" aria-hidden />
          <span>{t('player.cancelResolve')}</span>
        </button>
      ) : null}
    </div>
  );
}
