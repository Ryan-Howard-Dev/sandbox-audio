/** Mini bar whenever playback shell is active; hidden while full now-playing sheet is open. */
export function shouldShowMobileMiniBar(
  station: string,
  hasPlaybackShell: boolean,
  _mobileSearchOpen = false,
  mobileNowPlayingOpen = false,
): boolean {
  if (!hasPlaybackShell) return false;
  if (mobileNowPlayingOpen) return false;
  return true;
}

/** Replaced by full-screen now-playing sheet (Tidal-style). */
export function shouldShowMobileInfoStrip(
  _station: string,
  _hasPlaybackShell: boolean,
  _mobileNowPlayingOpen: boolean,
): boolean {
  return false;
}

/** Android WebView: flex-column dock (no position:fixed) — fixed/portal breaks on some OEM WebViews. */
export function shouldUseAndroidInlinePlayerDock(isAndroidPlatform: boolean): boolean {
  return isAndroidPlatform;
}

/** Shell chrome (active playback or tap-pending resolve). */
export function hasMobilePlaybackShell(
  hasActivePlayback: boolean,
  mobilePlayerPending: boolean,
): boolean {
  return hasActivePlayback || mobilePlayerPending;
}

/** Content padding when the mobile mini bar is visible (fixed/portal layout only). */
export function mobileShellUsesPlayerPadding(
  station: string,
  hasPlaybackShell: boolean,
  mobileSearchOpen = false,
  isAndroidPlatform = false,
  mobileNowPlayingOpen = false,
): boolean {
  if (shouldUseAndroidInlinePlayerDock(isAndroidPlatform)) return false;
  return (
    shouldShowMobileMiniBar(station, hasPlaybackShell, mobileSearchOpen, mobileNowPlayingOpen) ||
    shouldShowMobileInfoStrip(station, hasPlaybackShell, mobileNowPlayingOpen)
  );
}
