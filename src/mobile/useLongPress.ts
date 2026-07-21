import { useCallback, useRef, type MouseEvent } from 'react';

type LongPressOptions = {
  delayMs?: number;
  onLongPress: () => void;
  onPress?: () => void;
};

/** Touch long-press for context menus (Spotify-style). */
export function useLongPress({
  delayMs = 480,
  onLongPress,
  onPress,
}: LongPressOptions) {
  const timerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(() => {
    longPressFiredRef.current = false;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      onLongPress();
    }, delayMs);
  }, [clearTimer, delayMs, onLongPress]);

  const onTouchEnd = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onTouchMove = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onClick = useCallback(
    (e: MouseEvent) => {
      if (longPressFiredRef.current) {
        e.preventDefault();
        e.stopPropagation();
        longPressFiredRef.current = false;
        return;
      }
      onPress?.();
    },
    [onPress],
  );

  return {
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    onClick,
  };
}
