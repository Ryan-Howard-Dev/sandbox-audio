import React from 'react';
import { ListPlus, Radio, Sparkles } from 'lucide-react';
import { useTranslation } from '../i18n';

export interface MixRadioChipsProps {
  enabled?: boolean;
  onTrackRadio?: () => void;
  onArtistMix?: () => void;
  onAddToPlaylist?: () => void;
  className?: string;
}

/**
 * "More like this" and "keep this" as chips on the player surface.
 *
 * These lived in the ⋮ next to bit depth and car mode, which put the two things a listener does
 * most often behind the same tap as the things they set once a year. Rendered in both the player
 * footer and the queue sheet header — only one of the two is ever on screen, and keeping them in
 * one component is what stops the two copies drifting apart.
 */
export default function MixRadioChips({
  enabled = false,
  onTrackRadio,
  onArtistMix,
  onAddToPlaylist,
  className = '',
}: MixRadioChipsProps) {
  const { t } = useTranslation();
  const showRadio = enabled && (Boolean(onTrackRadio) || Boolean(onArtistMix));
  if (!showRadio && !onAddToPlaylist) return null;

  return (
    <div
      className={`player-chip-row${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={t('player.queueSheet.tuneAria')}
    >
      {showRadio && onTrackRadio ? (
        <button
          type="button"
          className="player-chip touch-manipulation"
          onClick={onTrackRadio}
        >
          <Radio className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">{t('player.menu.trackRadio')}</span>
        </button>
      ) : null}
      {showRadio && onArtistMix ? (
        <button
          type="button"
          className="player-chip touch-manipulation"
          onClick={onArtistMix}
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">{t('player.menu.artistMix')}</span>
        </button>
      ) : null}
      {onAddToPlaylist ? (
        <button
          type="button"
          className="player-chip touch-manipulation"
          onClick={onAddToPlaylist}
        >
          <ListPlus className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">{t('player.menu.addToPlaylist')}</span>
        </button>
      ) : null}
    </div>
  );
}
