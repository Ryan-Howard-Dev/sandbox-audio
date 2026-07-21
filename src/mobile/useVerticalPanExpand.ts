import { useCallback, useRef, type TouchEvent as ReactTouchEvent } from 'react';
import {
  shouldExpandFromUpwardPan,
  SHEET_EXPAND_UP_PX,
  SHEET_EXPAND_VELOCITY_PX_MS,
  verticalPanVelocity,
} from './verticalPanGesture';

export interface UseVerticalPanExpandOptions {
  enabled: boolean;
  onExpand: () => void;
  expandThresholdPx?: number;
  expandVelocityPxPerMs?: number;
}

/** Swipe up on the bottom mini player to open full now playing (Tidal-style). */
export function useVerticalPanExpand({
  enabled,
  onExpand,
  expandThresholdPx = SHEET_EXPAND_UP_PX,
  expandVelocityPxPerMs = SHEET_EXPAND_VELOCITY_PX_MS,
}: UseVerticalPanExpandOptions) {
  const startY = useRef(0);
  const startT = useRef(0);
  const tracking = useRef(false);
  const swipeFired = useRef(false);

  const reset = useCallback(() => {
    tracking.current = false;
    startY.current = 0;
    startT.current = 0;
  }, []);

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      if (!enabled) return;
      swipeFired.current = false;
      tracking.current = true;
      startY.current = e.touches[0]?.clientY ?? 0;
      startT.current = Date.now();
    },
    [enabled],
  );

  const onTouchMove = useCallback(
    (e: ReactTouchEvent) => {
      if (!enabled || !tracking.current || swipeFired.current) return;
      const y = e.touches[0]?.clientY ?? startY.current;
      const delta = y - startY.current;
      const velocity = verticalPanVelocity(delta, Date.now() - startT.current);
      if (
        shouldExpandFromUpwardPan(delta, velocity, expandThresholdPx, expandVelocityPxPerMs)
      ) {
        swipeFired.current = true;
        tracking.current = false;
        onExpand();
      }
    },
    [enabled, expandThresholdPx, expandVelocityPxPerMs, onExpand],
  );

  const onTouchEnd = useCallback(() => {
    reset();
  }, [reset]);

  const consumeSwipeClick = useCallback(() => {
    if (!swipeFired.current) return false;
    swipeFired.current = false;
    return true;
  }, []);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    consumeSwipeClick,
  };
}
