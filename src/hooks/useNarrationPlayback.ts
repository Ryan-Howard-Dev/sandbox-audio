import { useSyncExternalStore } from 'react';
import {
  getNarrationPlayback,
  subscribeNarrationPlayback,
  type NarrationPlaybackSnapshot,
} from '../narrationPlayback';

/**
 * The narration session the player should paint, or null when nothing is being read.
 *
 * useSyncExternalStore rather than useState + useEffect: the store is written from speech engine
 * callbacks that fire many times a second, and this is the hook designed for exactly that — it
 * cannot tear, and it reads the current value on mount instead of flashing empty for one frame
 * while an effect catches up.
 */
export function useNarrationPlayback(): NarrationPlaybackSnapshot | null {
  return useSyncExternalStore(subscribeNarrationPlayback, getNarrationPlayback, () => null);
}
