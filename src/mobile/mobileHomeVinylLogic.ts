/** Full now playing only from explicit expand — never auto-open on track tap. */
export function shouldOpenMobileNowPlayingOnTrackTap(
  _station: string,
  _playSucceeded: boolean,
): boolean {
  return false;
}

/** Quick vinyl/visual settings on home controls row (mobile shell, active track). */
export function shouldShowMobileHomeVinylSettings(
  showMobileShell: boolean,
  hasLoadedTrack: boolean,
  trueIdle: boolean,
): boolean {
  return showMobileShell && hasLoadedTrack && !trueIdle;
}
