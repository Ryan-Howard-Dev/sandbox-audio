import React from 'react';
import { FastForward } from 'lucide-react';
import { useTranslation } from '../../i18n';

export interface PodcastPlayerControlsProps {
  onSkipAd?: () => void;
  skipAdHint?: string;
  className?: string;
}

/** Inline now-playing controls — Skip Ad only; other options live in ⋮ menu. */
export default function PodcastPlayerControls({
  onSkipAd,
  skipAdHint = '+90s',
  className = '',
}: PodcastPlayerControlsProps) {
  const { t } = useTranslation();
  if (!onSkipAd) return null;

  return (
    <div
      className={`podcasts-player-controls podcasts-player-controls--compact ${className}`.trim()}
      role="toolbar"
      aria-label={t('player.podcast.controlsAria')}
    >
      <button
        type="button"
        className="podcasts-skip-ad-btn podcasts-skip-ad-btn--solo touch-manipulation"
        onClick={onSkipAd}
        aria-label={t('player.podcast.skipAd', { hint: skipAdHint })}
        title={t('player.podcast.skipAdTitle')}
      >
        <span className="podcasts-skip-ad-btn-icon" aria-hidden>
          <FastForward className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <span className="podcasts-skip-ad-btn-text">
          <span className="podcasts-skip-ad-btn-title">Skip Ad</span>
          <span className="podcasts-skip-ad-btn-hint">{skipAdHint}</span>
        </span>
      </button>
    </div>
  );
}
