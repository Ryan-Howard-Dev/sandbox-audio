import { useEffect, useState } from 'react';
import type { AudioFsmState } from '../sandboxLayer1';

const BUSY_STATES: ReadonlySet<AudioFsmState> = new Set(['Resolving', 'Connecting']);

/** Elapsed whole seconds while playback is resolving or connecting. */
export function usePlaybackResolveElapsed(
  state: AudioFsmState,
  resetKey?: string,
): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!BUSY_STATES.has(state)) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state, resetKey]);

  return BUSY_STATES.has(state) ? elapsed : 0;
}
