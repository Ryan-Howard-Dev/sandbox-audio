import { useCallback, useEffect, useRef } from 'react';
import type { useAudioFSM } from '../sandboxLayer1';
import { initPlayerDeepLinks, registerOpenHomePlayerHandler } from '../playerDeepLink';

export type PlayerHomeNavigationOptions = {
  showMobileShell: boolean;
  station: string;
  audio: ReturnType<typeof useAudioFSM>;
  setMobileSearchOpen: (open: boolean) => void;
  setMobileNowPlayingOpen: (open: boolean) => void;
  setNavOpen: (open: boolean) => void;
  setQueueDrawerOpen: (open: boolean) => void;
  setLyricsDrawerOpen: (open: boolean) => void;
  setStation: (station: string) => void;
};

/** Mini bar / notification / lock screen -> Home vinyl hero. */
export function usePlayerHomeNavigation({
  showMobileShell,
  station,
  audio,
  setMobileSearchOpen,
  setMobileNowPlayingOpen,
  setNavOpen,
  setQueueDrawerOpen,
  setLyricsDrawerOpen,
  setStation,
}: PlayerHomeNavigationOptions): () => void {
  const stationRef = useRef(station);
  const audioRef = useRef(audio);
  stationRef.current = station;
  audioRef.current = audio;

  const openHomePlayer = useCallback(() => {
    setMobileSearchOpen(false);
    setMobileNowPlayingOpen(false);
    setNavOpen(false);
    setQueueDrawerOpen(false);
    setLyricsDrawerOpen(false);
    if (stationRef.current !== 'home') {
      setStation('home');
    }
    const currentAudio = audioRef.current;
    if (
      currentAudio.envelope?.url?.trim() &&
      currentAudio.state !== 'Playing' &&
      currentAudio.state !== 'Connecting' &&
      currentAudio.state !== 'Resolving'
    ) {
      currentAudio.primePlaybackGesture();
      void currentAudio.play();
    }
  }, [
    setLyricsDrawerOpen,
    setMobileNowPlayingOpen,
    setMobileSearchOpen,
    setNavOpen,
    setQueueDrawerOpen,
    setStation,
  ]);

  useEffect(() => {
    if (!showMobileShell) return;
    registerOpenHomePlayerHandler(openHomePlayer);
    let disposed = false;
    let disposeDeepLinks: (() => void) | undefined;
    void initPlayerDeepLinks().then((dispose) => {
      if (disposed) dispose();
      else disposeDeepLinks = dispose;
    });
    return () => {
      disposed = true;
      registerOpenHomePlayerHandler(null);
      disposeDeepLinks?.();
    };
  }, [showMobileShell, openHomePlayer]);

  return openHomePlayer;
}
