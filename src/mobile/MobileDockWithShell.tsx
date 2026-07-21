import React from 'react';
import type { MobileTabItem } from '../components/MobileBottomNav';
import MobileCombinedDock from './MobileCombinedDock';
import MobilePlayerShell, {
  type MobilePlayerShellProps,
} from './MobilePlayerShell';

export interface MobileDockWithShellProps<T extends string> {
  showMiniPlayer: boolean;
  navItems: MobileTabItem<T>[];
  navActiveId: T;
  onNavigate: (id: T) => void;
  navBadges?: Partial<Record<T, number>>;
  shell: MobilePlayerShellProps;
}

/**
 * Combined Tidal-style dock (mini bar + tabs) with full-screen now playing overlay.
 */
export default function MobileDockWithShell<T extends string>({
  showMiniPlayer,
  navItems,
  navActiveId,
  onNavigate,
  navBadges,
  shell,
}: MobileDockWithShellProps<T>) {
  return (
    <>
      {shell.active ? (
        <MobilePlayerShell
          {...shell}
          combinedDock
          combinedDockPart="overlay"
        />
      ) : null}
      <MobileCombinedDock
        showMiniPlayer={showMiniPlayer}
        miniPlayer={
          shell.active && showMiniPlayer ? (
            <MobilePlayerShell
              {...shell}
              combinedDock
              combinedDockPart="bar"
            />
          ) : null
        }
        navItems={navItems}
        navActiveId={navActiveId}
        onNavigate={onNavigate}
        navBadges={navBadges}
      />
    </>
  );
}
