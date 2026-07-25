import React from 'react';
import MobileBottomNav, {
  type MobileTabItem,
} from '../components/MobileBottomNav';

export interface MobileCombinedDockProps<T extends string> {
  miniPlayer: React.ReactNode | null;
  /** When false, nav-only pill (home / no active mini bar). */
  showMiniPlayer?: boolean;
  navItems: MobileTabItem<T>[];
  navActiveId: T;
  onNavigate: (id: T) => void;
  navBadges?: Partial<Record<T, number>>;
}

/**
 * Tidal-style floating dock: mini player stacked above tab icons in one rounded pill.
 */
export default function MobileCombinedDock<T extends string>({
  miniPlayer,
  showMiniPlayer = Boolean(miniPlayer),
  navItems,
  navActiveId,
  onNavigate,
  navBadges,
}: MobileCombinedDockProps<T>) {
  return (
    <div className="mobile-combined-dock" data-testid="mobile-combined-dock">
      <div className="mobile-combined-dock-pill">
        {showMiniPlayer && miniPlayer ? (
          <>
            <div className="mobile-combined-dock-player min-w-0 w-full overflow-hidden">{miniPlayer}</div>
            <div className="mobile-combined-dock-divider" aria-hidden />
          </>
        ) : null}
        <MobileBottomNav
          items={navItems}
          activeId={navActiveId}
          onNavigate={onNavigate}
          badgeById={navBadges}
          compact
          /*
           * Icon-only, always.
           *
           * Labels that come and go are worse than no labels: you cannot rely on them, so you
           * learn the icons regardless — and their appearing/disappearing shifts the dock's height
           * every time playback starts or stops. Five labels on a ~314px row also forces text down
           * to a size that is barely readable ("Audiobooks" gets ~52px). The active burnt-orange
           * pill is the "you are here" signal; aria-label still carries the full name for
           * screen readers, so nothing is lost for accessibility.
           */
          showLabels={false}
        />
      </div>
    </div>
  );
}
