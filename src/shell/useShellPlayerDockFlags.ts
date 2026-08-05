/**
 * Bottom-player / narration / mobile-dock chrome flags for the shell. Extracted from
 * sandboxLayer3 so the pre-ShellChrome gate logic stays out of the wiring file.
 *
 * Call after SystemLogin/onboarding gates and before the ShellChrome return — several of these
 * flags are also passed into ShellChrome and must stay in registration order relative to the
 * narration-clears-on-audible-envelope effect.
 */

import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import {
  clearNarrationPlayback,
  getNarrationPlayback,
  type NarrationPlaybackSnapshot,
} from '../narrationPlayback';
import { endNarrationSession } from '../narrationMediaSession';
import { prepareCleanPlaybackStop } from '../e2ePlaybackWait';
import {
  hasMobilePlaybackShell,
  mobileShellUsesPlayerPadding,
  shouldShowMobileInfoStrip,
  shouldShowMobileMiniBar,
} from '../mobile/mobilePlayerShellLogic';
import { isAndroid } from '../platformEnv';
import { resolveMediaPillar, controlsForPillar } from '../mediaPillar';
import type { StationId } from './shellNav';

export type ShellPlayerDockFlagsArgs = {
  isTV: boolean;
  showMobileShell: boolean;
  station: StationId;
  hasActivePlayback: boolean;
  narrationPlayback: NarrationPlaybackSnapshot | null;
  mobilePlayerPending: boolean;
  queueDrawerOpen: boolean;
  lyricsDrawerOpen: boolean;
  sleepTimerPanelOpen: boolean;
  audio: UseAudioFSMResult;
  setPlayQueue: Dispatch<SetStateAction<MediaEnvelope[]>>;
  setQueueIndex: Dispatch<SetStateAction<number>>;
  setMobileNowPlayingOpen: Dispatch<SetStateAction<boolean>>;
  setQueueDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setLyricsDrawerOpen: Dispatch<SetStateAction<boolean>>;
  mobileSearchOpen: boolean;
  mobileNowPlayingOpen: boolean;
};

export function useShellPlayerDockFlags({
  isTV,
  showMobileShell,
  station,
  hasActivePlayback,
  narrationPlayback,
  mobilePlayerPending,
  queueDrawerOpen,
  lyricsDrawerOpen,
  sleepTimerPanelOpen,
  audio,
  setPlayQueue,
  setQueueIndex,
  setMobileNowPlayingOpen,
  setQueueDrawerOpen,
  setLyricsDrawerOpen,
  mobileSearchOpen,
  mobileNowPlayingOpen,
}: ShellPlayerDockFlagsArgs) {
  const showBottomPlayer =
    !isTV &&
    !(showMobileShell && station === 'home') &&
    (hasActivePlayback ||
      narrationPlayback !== null ||
      (showMobileShell && mobilePlayerPending) ||
      queueDrawerOpen ||
      (!showMobileShell && (lyricsDrawerOpen || sleepTimerPanelOpen)));

  /*
   * Narration counts as playback for the player chrome only.
   *
   * hasActivePlayback is derived from the audio state machine and is threaded through queueing,
   * scrobbling and resume, none of which a spoken document should touch. This narrower flag says
   * one thing: something is playing, so the player should be on screen.
   */
  const playbackChromeActive = hasActivePlayback || narrationPlayback !== null;
  /*
   * What is playing decides which controls exist, rather than the player offering everything and
   * each medium quietly ignoring what does not apply to it. Shuffling a novel is not an unused
   * button, it is a destroyed book.
   */
  /*
   * Music starting ends the reading.
   *
   * Narration deliberately survives navigating away, so a book keeps being read while you browse.
   * It must not survive something else starting to play: two things cannot make sound at once, and
   * the session was still overriding the player, which left a track showing the book's cover.
   *
   * Keyed on the envelope id rather than a play/pause flag, so pausing a book to look at your
   * library does not silently end it.
   */
  const audibleEnvelopeId = audio.envelope?.envelopeId ?? null;
  useEffect(() => {
    if (!audibleEnvelopeId) return;
    const reading = getNarrationPlayback();
    if (!reading) return;
    reading.controls.stop();
    clearNarrationPlayback(reading.sourceId);
    /*
     * Release the media session too, not just the store.
     *
     * beginNarrationSession wrote the book into the native session, and stopping the reader does
     * not take it back out -- only 'finished' released it. So a track played afterwards kept the
     * book's title and cover on the bar and the lock screen, because the audio layer reads that
     * metadata back.
     */
    void endNarrationSession();
  }, [audibleEnvelopeId]);

  /*
   * Narration may only drive the player while nothing else is loaded.
   *
   * Ownership used to follow the narration store alone, so a session that failed to clear kept the
   * book's title on a music track and, worse, kept play/pause wired to the reader -- the buttons
   * appeared to do nothing because they were controlling something that was no longer playing.
   * A loaded envelope is the audio layer's own statement that it owns the output.
   */
  const narrationForPlayer = audibleEnvelopeId ? null : narrationPlayback;

  /**
   * Stop everything and empty the player.
   *
   * Pause leaves the track loaded, the queue intact and the lock screen occupied, so there was
   * no way to say "I am finished" short of force-closing the app. Everything that can be making
   * sound is stopped here rather than only the one the screen happens to be showing: audio and
   * narration are separate engines, and stopping one while the other keeps talking is the bug
   * this is meant to prevent.
   */
  const handleClearPlayer = useCallback(async () => {
    const reading = getNarrationPlayback();
    if (reading) {
      reading.controls.stop();
      clearNarrationPlayback(reading.sourceId);
    }
    // Releases the foreground notification, which otherwise outlives the thing that raised it.
    await endNarrationSession();
    await prepareCleanPlaybackStop(() => audio.stop());
    setPlayQueue([]);
    setQueueIndex(0);
    setMobileNowPlayingOpen(false);
    setQueueDrawerOpen(false);
    setLyricsDrawerOpen(false);
  }, [
    audio,
    setPlayQueue,
    setQueueIndex,
    setMobileNowPlayingOpen,
    setQueueDrawerOpen,
    setLyricsDrawerOpen,
  ]);

  const nowPlayingPillar = resolveMediaPillar({
    envelopeId: audio.envelope?.envelopeId,
    narrating: narrationForPlayer !== null,
  });
  const nowPlayingControls = controlsForPillar(nowPlayingPillar);
  const mobilePlaybackShellActive = showMobileShell
    ? hasMobilePlaybackShell(playbackChromeActive, mobilePlayerPending)
    : false;
  const mobileUsesPlayerPadding = showMobileShell
    ? mobileShellUsesPlayerPadding(
        station,
        mobilePlaybackShellActive,
        mobileSearchOpen,
        isAndroid(),
        mobileNowPlayingOpen,
      )
    : false;
  const showMobileDockBar =
    mobilePlaybackShellActive &&
    (shouldShowMobileMiniBar(
      station,
      true,
      mobileSearchOpen,
      mobileNowPlayingOpen,
    ) ||
      shouldShowMobileInfoStrip(station, true, mobileNowPlayingOpen));
  const hideHomePlaybackChrome = showMobileShell && mobileSearchOpen;

  return {
    showBottomPlayer,
    playbackChromeActive,
    narrationForPlayer,
    handleClearPlayer,
    nowPlayingPillar,
    nowPlayingControls,
    mobilePlaybackShellActive,
    mobileUsesPlayerPadding,
    showMobileDockBar,
    hideHomePlaybackChrome,
  };
}
