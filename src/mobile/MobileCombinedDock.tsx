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
          showLabels
        />
      </div>
    </div>
  );
}
