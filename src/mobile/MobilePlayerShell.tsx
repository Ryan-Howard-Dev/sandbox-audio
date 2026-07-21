import React from 'react';
import { createPortal } from 'react-dom';
import PlayerBar, { type PlayerBarProps } from '../components/PlayerBar';
import MobileNowPlayingView, {
  type MobileNowPlayingViewProps,
} from '../components/MobileNowPlayingView';
import { isAndroid } from '../platformEnv';
import {
  shouldShowMobileInfoStrip,
  shouldShowMobileMiniBar,
  shouldUseAndroidInlinePlayerDock,
} from './mobilePlayerShellLogic';

export interface MobilePlayerShellProps {
  active: boolean;
  station: string;
  mobileSearchOpen?: boolean;
  isLeanbackTv?: boolean;
  nowPlayingOpen: boolean;
  onNowPlayingOpenChange: (open: boolean) => void;
  /** Tap mini bar → home vinyl hero (notification / lock screen parity). */
  onNavigateHome?: () => void;
  playerBar: PlayerBarProps;
  nowPlaying: MobileNowPlayingViewProps;
  /** Render only the mini bar fragment (inside MobileCombinedDock). */
  combinedDock?: boolean;
  /** When combinedDock: render only the bar or only the now-playing overlay. */
  combinedDockPart?: 'bar' | 'overlay' | 'both';
}

/**
 * Unified mobile player chrome: compact mini bar above bottom nav (non-home)
 * and full-screen now playing overlay. Home station uses HomeView vinyl hero inline.
 * Android uses inline flex dock; other platforms portal to document.body.
 */
export default function MobilePlayerShell({
  active,
  station,
  mobileSearchOpen = false,
  isLeanbackTv = false,
  nowPlayingOpen,
  onNowPlayingOpenChange,
  onNavigateHome,
  playerBar,
  nowPlaying,
  combinedDock = false,
  combinedDockPart = 'both',
}: MobilePlayerShellProps) {
  if (!active) return null;

  if (isLeanbackTv) {
    return (
      <div
        className="mobile-player-shell mobile-player-shell--tv"
        data-testid="mobile-player-shell-tv"
        aria-hidden
      />
    );
  }

  const showMiniBar = shouldShowMobileMiniBar(
    station,
    true,
    mobileSearchOpen,
    nowPlayingOpen,
  );
  const showInfoStrip = shouldShowMobileInfoStrip(station, true, nowPlayingOpen);
  const inlineDock = shouldUseAndroidInlinePlayerDock(isAndroid());

  const dockedBar =
    showMiniBar || showInfoStrip ? (
      <PlayerBar
        {...playerBar}
        embedded
        inlineDock={inlineDock || combinedDock}
        tidalMini={showMiniBar && !showInfoStrip && (combinedDock || inlineDock)}
        infoStripOnly={showInfoStrip}
        onOpenHero={
          showInfoStrip
            ? () => onNowPlayingOpenChange(false)
            : () => onNowPlayingOpenChange(true)
        }
      />
    ) : null;

  const nowPlayingOverlay = nowPlayingOpen ? (
    <MobileNowPlayingView
      {...nowPlaying}
      open={nowPlayingOpen}
      onClose={() => onNowPlayingOpenChange(false)}
    />
  ) : null;

  if (combinedDock) {
    const overlayShell = nowPlayingOverlay ? (
      <div
        className="mobile-player-shell mobile-player-shell--combined"
        data-testid="mobile-player-shell"
        aria-hidden={false}
      >
        {nowPlayingOverlay}
      </div>
    ) : null;

    if (combinedDockPart === 'bar') {
      return dockedBar ? (
        <div className="mobile-combined-dock-bar min-w-0 w-full overflow-hidden">{dockedBar}</div>
      ) : null;
    }
    if (combinedDockPart === 'overlay') return overlayShell;

    return (
      <>
        {dockedBar}
        {overlayShell}
      </>
    );
  }

  if (inlineDock) {
    return (
      <>
        {dockedBar ? (
          <div className="mobile-player-dock" data-testid="mobile-player-dock">
            {dockedBar}
          </div>
        ) : null}
        <div
          className="mobile-player-shell"
          data-testid="mobile-player-shell"
          aria-hidden={!showMiniBar && !showInfoStrip && !nowPlayingOverlay}
        >
          {nowPlayingOverlay}
        </div>
      </>
    );
  }

  return (
    <>
      {typeof document !== 'undefined' && dockedBar
        ? createPortal(dockedBar, document.body)
        : null}
      <div
        className="mobile-player-shell"
        data-testid="mobile-player-shell"
        aria-hidden={!showMiniBar && !showInfoStrip && !nowPlayingOverlay}
      >
        {nowPlayingOverlay}
      </div>
    </>
  );
}
