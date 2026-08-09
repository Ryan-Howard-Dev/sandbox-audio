import React from 'react';
import { useTranslation } from '../i18n';

export type MusicSegmentId = 'library' | 'genres' | 'playlists' | 'shelf' | 'discover';

/*
 * Shelf sits between what you have and where you find more, because that is what it is: the
 * records you own that the library cannot see. Every question it answers — what should I rip, what
 * am I missing — is a question about this library, which is why it is a segment of Music rather
 * than a station of its own.
 */
export const MUSIC_SEGMENTS: MusicSegmentId[] = [
  'library',
  'genres',
  'playlists',
  'shelf',
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
