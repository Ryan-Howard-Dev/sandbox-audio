import { useEffect, useRef, useState } from 'react';

type Anchor = {
  timeSeconds: number;
  atMs: number;
  playing: boolean;
};

/**
 * Smooth playback clock for lyrics — interpolates between host sync heartbeats on remotes.
 */
export function useLyricsPlaybackClock(currentTimeSeconds: number, isPlaying: boolean): number {
  const anchorRef = useRef<Anchor>({
    timeSeconds: currentTimeSeconds,
    atMs: performance.now(),
    playing: isPlaying,
  });

  useEffect(() => {
    anchorRef.current = {
      timeSeconds: currentTimeSeconds,
      atMs: performance.now(),
      playing: isPlaying,
    };
  }, [currentTimeSeconds, isPlaying]);

  const [playbackMs, setPlaybackMs] = useState(() => currentTimeSeconds * 1000);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const { timeSeconds, atMs, playing } = anchorRef.current;
      const elapsed = playing ? (performance.now() - atMs) / 1000 : 0;
      setPlaybackMs((timeSeconds + elapsed) * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return playbackMs;
}
