import React from 'react';
import { useTranslation } from '../i18n';

type AlbumArtistCreditsSectionProps = {
  artistCredits: string[];
  /** @deprecated Chips list all credits; featuring line removed. */
  guestArtists?: string[];
  onGoToArtist?: (name: string) => void;
  className?: string;
};

export default function AlbumArtistCreditsSection({
  artistCredits,
  onGoToArtist,
  className = '',
}: AlbumArtistCreditsSectionProps) {
  const { t } = useTranslation();
  if (artistCredits.length === 0) return null;

  return (
    <section
      className={`search-results-album-artists${className ? ` ${className}` : ''}`}
      aria-label={t('searchResults.artistsOnAlbum')}
    >
      <h2 className="search-results-section-label">{t('searchResults.artistsOnAlbum')}</h2>
      <div className="search-results-artist-chips">
        {artistCredits.map((name) => (
          <button
            key={name}
            type="button"
            className="search-results-artist-chip touch-manipulation"
            onClick={() => onGoToArtist?.(name)}
          >
            {name}
          </button>
        ))}
      </div>
    </section>
  );
}
