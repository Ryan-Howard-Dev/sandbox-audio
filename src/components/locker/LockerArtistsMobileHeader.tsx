import React, { useEffect, useRef } from 'react';
import { MoreVertical, Search, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from '../../i18n';
import LockerHeaderSearch from './LockerHeaderSearch';

export type ArtistListSort = 'name' | 'tracks';

export interface LockerArtistsMobileMenuItem {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  divider?: boolean;
}

export interface LockerArtistsMobileHeaderProps {
  searchOpen: boolean;
  onSearchToggle: () => void;
  libraryQuery: string;
  onLibraryQueryChange: (value: string) => void;
  sortMenuOpen: boolean;
  onSortMenuToggle: () => void;
  artistSort: ArtistListSort;
  onArtistSortChange: (sort: ArtistListSort) => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
  /** Overflow ⋮ actions — upload, fix song info, update artwork, etc. */
  menuItems: LockerArtistsMobileMenuItem[];
}

/** Tidal-style artists list chrome — title row with search, sort, and overflow menu. */
export default function LockerArtistsMobileHeader({
  searchOpen,
  onSearchToggle,
  libraryQuery,
  onLibraryQueryChange,
  sortMenuOpen,
  onSortMenuToggle,
  artistSort,
  onArtistSortChange,
  menuOpen,
  onMenuToggle,
  menuItems,
}: LockerArtistsMobileHeaderProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen && !sortMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuOpen && menuRef.current && !menuRef.current.contains(target)) {
        onMenuToggle();
      }
      if (sortMenuOpen && sortRef.current && !sortRef.current.contains(target)) {
        onSortMenuToggle();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen, sortMenuOpen, onMenuToggle, onSortMenuToggle]);

  return (
    <div className="locker-artists-mobile-header">
      <div className="locker-artists-mobile-toolbar">
        <h2 className="locker-artists-mobile-title">{t('locker.tabs.artists')}</h2>
        <div className="locker-artists-mobile-actions">
          <button
            type="button"
            className={`locker-artists-mobile-icon-btn touch-manipulation${searchOpen ? ' locker-artists-mobile-icon-btn--active' : ''}`}
            onClick={onSearchToggle}
            aria-label={t('locker.searchArtistsPlaceholder')}
            aria-pressed={searchOpen}
          >
            <Search className="w-5 h-5" strokeWidth={2} />
          </button>
          <div className="locker-artists-mobile-menu-anchor" ref={sortRef}>
            <button
              type="button"
              className={`locker-artists-mobile-icon-btn touch-manipulation${sortMenuOpen ? ' locker-artists-mobile-icon-btn--active' : ''}`}
              onClick={onSortMenuToggle}
              aria-label={t('locker.artistSortAria')}
              aria-expanded={sortMenuOpen}
            >
              <SlidersHorizontal className="w-5 h-5" strokeWidth={2} />
            </button>
            {sortMenuOpen ? (
              <div className="locker-artists-mobile-popover" role="menu">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={artistSort === 'name'}
                  className={`locker-artists-mobile-popover-item${artistSort === 'name' ? ' locker-artists-mobile-popover-item--active' : ''}`}
                  onClick={() => {
                    onArtistSortChange('name');
                    onSortMenuToggle();
                  }}
                >
                  {t('locker.artistSortName')}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={artistSort === 'tracks'}
                  className={`locker-artists-mobile-popover-item${artistSort === 'tracks' ? ' locker-artists-mobile-popover-item--active' : ''}`}
                  onClick={() => {
                    onArtistSortChange('tracks');
                    onSortMenuToggle();
                  }}
                >
                  {t('locker.artistSortTracks')}
                </button>
              </div>
            ) : null}
          </div>
          <div className="locker-artists-mobile-menu-anchor" ref={menuRef}>
            <button
              type="button"
              className={`locker-artists-mobile-icon-btn touch-manipulation${menuOpen ? ' locker-artists-mobile-icon-btn--active' : ''}`}
              onClick={onMenuToggle}
              aria-label={t('locker.artistMoreAria')}
              aria-expanded={menuOpen}
            >
              <MoreVertical className="w-5 h-5" strokeWidth={2} />
            </button>
            {menuOpen ? (
              <div className="locker-artists-mobile-popover locker-artists-mobile-popover--align-end" role="menu">
                {menuItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    className={`locker-artists-mobile-popover-item${
                      item.divider ? ' locker-artists-mobile-popover-item--divider' : ''
                    }`}
                    onClick={() => {
                      if (item.disabled) return;
                      onMenuToggle();
                      item.onClick();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {searchOpen ? (
        <LockerHeaderSearch
          value={libraryQuery}
          onChange={onLibraryQueryChange}
          placeholder={t('locker.searchArtistsPlaceholder')}
          ariaLabel={t('locker.searchArtistsPlaceholder')}
        />
      ) : null}
    </div>
  );
}
