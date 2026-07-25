import React from 'react';
import { useTranslation } from '../i18n';

export type MusicSegmentId = 'library' | 'genres' | 'playlists' | 'discover';

export const MUSIC_SEGMENTS: MusicSegmentId[] = [
  'library',
  'genres',
  'playlists',
  'discover',
];

interface MusicSegmentBarProps {
  active: MusicSegmentId;
  onSelect: (segment: MusicSegmentId) => void;
}

/**
 * Shared top-of-Music segment switcher. Rendered over both the Locker and Discover
 * stations so the two read as one Music tab with Library / Genres / Playlists /
 * Discover segments rather than scattered destinations.
 */
export default function MusicSegmentBar({ active, onSelect }: MusicSegmentBarProps) {
  const { t } = useTranslation();
  return (
    <nav className="music-segment-bar" aria-label={t('nav.musicSectionsAria')}>
      {MUSIC_SEGMENTS.map((segment) => (
        <button
          key={segment}
          type="button"
          data-testid={`music-segment-${segment}`}
          className={`music-segment-tab touch-manipulation${
            active === segment ? ' music-segment-tab--active' : ''
          }`}
          aria-current={active === segment ? 'page' : undefined}
          onClick={() => onSelect(segment)}
        >
          {t(`nav.musicSegments.${segment}`)}
        </button>
      ))}
    </nav>
  );
}
