/**
 * Home "active wash" / vinyl visual style bundle — whether the wash should show, the genre bucket
 * driving it, vinyl CSS vars/class, the art-driven music-universe backdrop style/class, whether
 * the mini player should navigate home, and the "Playing from â€¦" label shown on mobile. Extracted
 * from sandboxLayer3 with no JSX.
 *
 * Call this hook at the original position, right after useShowMusicUniverse — it only reads
 * values (showMusicUniverse, homeHasLoadedTrack, homeArt, homeGradientSeed, mixRadioSession) that
 * already exist by then.
 */

import { useMemo } from 'react';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { StationId } from './shellNav';
import type { MixRadioSession } from '../playerMixRadio';
import { getGenreBucketForTrack } from '../vinylGenreThemes';
import { useVinylVisualStyle } from '../vinylVisualSettings';
import { useTrackUniverseStyle } from '../hooks/useTrackUniverseStyle';

export type UseShellHomeArtStyleArgs = {
  station: StationId;
  homeHasLoadedTrack: boolean;
  showMusicUniverse: boolean;
  isCarMode: boolean;
  showMobileShell: boolean;
  isTV: boolean;
  audioEnvelope: MediaEnvelope | null | undefined;
  homeArt: string | undefined;
  homeGradientSeed: string;
  mixRadioSession: MixRadioSession | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
};

export function useShellHomeArtStyle({
  station,
  homeHasLoadedTrack,
  showMusicUniverse,
  isCarMode,
  showMobileShell,
  isTV,
  audioEnvelope,
  homeArt,
  homeGradientSeed,
  mixRadioSession,
  t,
}: UseShellHomeArtStyleArgs) {
  const showHomeActiveWash =
    station === 'home' && homeHasLoadedTrack && !showMusicUniverse && !isCarMode;
  const homeGenreBucket = useMemo(
    () => (showHomeActiveWash ? getGenreBucketForTrack(audioEnvelope) : null),
    [showHomeActiveWash, audioEnvelope?.envelopeId, audioEnvelope?.title, audioEnvelope?.artist],
  );
  const { cssVars: vinylCssVars, vinylClass: vinylPsycheClass } = useVinylVisualStyle(
    audioEnvelope,
  );
  const { universeStyle: trackUniverseStyle, isArtDriven: homeArtDriven, isMonochrome: homeArtMono } =
    useTrackUniverseStyle(homeArt?.trim() ? homeArt : undefined, homeGradientSeed);
  const musicUniverseStyle = useMemo(
    () => ({ ...trackUniverseStyle, ...vinylCssVars }),
    [trackUniverseStyle, vinylCssVars],
  );
  const homeArtUniverseClass =
    homeHasLoadedTrack && homeArtDriven
      ? ` music-universe-backdrop--art-driven${homeArtMono ? ' music-universe-backdrop--art-monochrome' : ''}`
      : '';
  const miniPlayerNavigatesHome = showMobileShell || (!isTV && !isCarMode && !showMobileShell);

  const mobilePlayingFromLabel = useMemo(() => {
    if (mixRadioSession) {
      if (mixRadioSession.kind === 'discovery-station') {
        return t('nowPlaying.discoveryStation', { defaultValue: 'Discovery Station' });
      }
      if (mixRadioSession.kind === 'discovery-mfy') {
        return t('nowPlaying.fromDiscoveryMix', { title: mixRadioSession.seedTitle });
      }
      return mixRadioSession.kind === 'mix'
        ? t('nowPlaying.fromArtistMix', { artist: mixRadioSession.seedArtist })
        : t('nowPlaying.fromTrackRadio', { title: mixRadioSession.seedTitle });
    }
    switch (station) {
      case 'podcasts':
        return t('nav.podcasts');
      case 'audiobooks':
        return t('nav.audiobooks');
      case 'search':
        return t('nowPlaying.fromSearch');
      case 'locker':
        return t('nowPlaying.fromLocker');
      case 'discover':
        return t('nowPlaying.fromDiscover');
      case 'library':
        return t('library.title');
      case 'home':
        return t('nowPlaying.fromHome');
      default:
        return t('nowPlaying.fromQueue');
    }
  }, [mixRadioSession, station, t]);

  return {
    showHomeActiveWash,
    homeGenreBucket,
    vinylCssVars,
    vinylPsycheClass,
    musicUniverseStyle,
    homeArtUniverseClass,
    miniPlayerNavigatesHome,
    mobilePlayingFromLabel,
  };
}
