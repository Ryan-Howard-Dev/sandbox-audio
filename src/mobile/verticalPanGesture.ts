/** Shared thresholds for Tidal-style vertical sheet gestures. */
export const SHEET_EXPAND_UP_PX = 48;
export const SHEET_EXPAND_VELOCITY_PX_MS = 0.45;
export const SHEET_COLLAPSE_DOWN_PX = 96;
export const SHEET_COLLAPSE_VELOCITY_PX_MS = 0.45;
export const SHEET_COLLAPSE_FAST_DOWN_PX = 40;

export function shouldExpandFromUpwardPan(
  deltaY: number,
  velocityY: number,
  thresholdPx = SHEET_EXPAND_UP_PX,
  velocityThreshold = SHEET_EXPAND_VELOCITY_PX_MS,
): boolean {
  if (deltaY <= -thresholdPx) return true;
  return deltaY < -24 && velocityY <= -velocityThreshold;
}

export function shouldCollapseFromDownwardPan(
  deltaY: number,
  velocityY: number,
  thresholdPx = SHEET_COLLAPSE_DOWN_PX,
  velocityThreshold = SHEET_COLLAPSE_VELOCITY_PX_MS,
): boolean {
  if (deltaY >= thresholdPx) return true;
  return deltaY >= SHEET_COLLAPSE_FAST_DOWN_PX && velocityY >= velocityThreshold;
}

export function verticalPanVelocity(deltaY: number, elapsedMs: number): number {
  return deltaY / Math.max(1, elapsedMs);
}
