import { useCallback, useRef, useSyncExternalStore } from 'react';
import {
  getTransportSnapshot,
  subscribeTransport,
  type TransportSnapshot,
} from '../transportStore';

/**
 * Read one slice of what is playing, and re-render only when that slice changes.
 *
 * The whole point of the store living outside React. A clock reading the position repaints several
 * times a second; the artwork beside it reads the artwork and repaints when the track changes,
 * which is a different thing entirely. Subscribing to the whole snapshot would tie them together
 * and repaint the artwork on every tick.
 *
 * The selected value is cached because useSyncExternalStore compares by identity: a selector
 * returning a fresh object each call would report a change on every read and defeat the mechanism.
 * Pass a comparator for those cases; the default handles the primitives most selectors return.
 */
export function useTransport<T>(
  selector: (snapshot: TransportSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const cache = useRef<{ source: TransportSnapshot; value: T } | null>(null);

  const getSelection = useCallback(() => {
    const snapshot = getTransportSnapshot();
    const previous = cache.current;
    if (previous && previous.source === snapshot) return previous.value;
    const value = selector(snapshot);
    // Hold the old reference when the value is equal, so identity comparison sees no change.
    if (previous && isEqual(previous.value, value)) {
      cache.current = { source: snapshot, value: previous.value };
      return previous.value;
    }
    cache.current = { source: snapshot, value };
    return value;
  }, [selector, isEqual]);

  return useSyncExternalStore(subscribeTransport, getSelection, getSelection);
}
