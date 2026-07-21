/** Light haptic on supported mobile browsers — UI only, no audio impact. */
export function tapHaptic(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(10);
    }
  } catch {
    /* unsupported */
  }
}

/** Yield one frame so tap feedback paints before heavy async work. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
