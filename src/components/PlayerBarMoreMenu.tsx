import React, { useEffect, useMemo, useState } from 'react';
import LockerMoreMenu, { type LockerMenuAction } from './LockerMoreMenu';
import {
  saveHeroDisplayMode,
  type HeroDisplayMode,
} from '../heroDisplaySettings';
import { formatEpisodeVolumeBoostLabel } from '../podcastEpisodeBoost';
import { formatPodcastPlaybackSpeed } from '../podcastSettings';
import { useTranslation } from '../i18n';
import { isTauriDesktop } from '../castPlatform';
import { requestTauriCastGuidance } from '../sandboxSettings';
import { isAndroidNative } from '../carMode';
import {
  loadAndroidMiniPlayerMode,
  saveAndroidMiniPlayerMode,
  type AndroidMiniPlayerMode,
} from '../androidMiniPlayerSettings';
import { enterAndroidPictureInPicture, syncAndroidMiniPlayerMode } from '../backgroundMedia';
import { nativePlaybackStatus } from '../nativeAudiophile';
import { loadFidelityPolicy, type FidelityPolicy } from '../sandboxSettings';
import { useMobileShell } from '../hooks/useMobileShell';
import type { MixRadioSession } from '../playerMixRadio';

export interface PlayerBarMoreMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayMode: HeroDisplayMode;
  sleepTimerOpen: boolean;
  sleepTimerLabel: string | null;
  onToggleSleepTimer: () => void;
  castActive: boolean;
  onOpenCastPicker: () => void;
  onEnterCarMode?: () => void;
  mixRadioEnabled?: boolean;
  onArtistMix?: () => void;
  onTrackRadio?: () => void;
  mixRadioSession?: MixRadioSession | null;
  saveMixRadioEnabled?: boolean;
  onSaveMixRadioToPlaylist?: () => void;
  resumeQueueCount?: number;
  onResumeQueue?: () => void;
  downloadEnabled?: boolean;
  onDownloadTrack?: () => void;
  /** Podcast episode — speed, boost, and auto-skip options in ⋮ menu */
  isPodcast?: boolean;
  podcastPlaybackSpeed?: number;
  onCyclePodcastSpeed?: () => void;
  podcastSmartSpeedEnabled?: boolean;
  onTogglePodcastSmartSpeed?: () => void;
  podcastVoiceBoostEnabled?: boolean;
  onTogglePodcastVoiceBoost?: () => void;
  episodeVolumeBoostDb?: number;
  onCycleEpisodeVolumeBoost?: () => void;
  podcastSkipAdChaptersEnabled?: boolean;
  onTogglePodcastSkipAdChapters?: () => void;
}

function fidelityBitDepthLabel(
  policy: FidelityPolicy,
  t: (key: string) => string,
): string {
  switch (policy) {
    case 'HIGH':
      return t('player.menu.bitDepthHigh');
    case 'LOSSLESS':
      return t('player.menu.bitDepthLossless');
    default:
      return t('player.menu.bitDepthStandard');
  }
}

export default function PlayerBarMoreMenu({
  open,
  onOpenChange,
  displayMode,
  sleepTimerOpen,
  sleepTimerLabel,
  onToggleSleepTimer,
  castActive,
  onOpenCastPicker,
  onEnterCarMode,
  mixRadioEnabled = false,
  onArtistMix,
  onTrackRadio,
  mixRadioSession = null,
  saveMixRadioEnabled = false,
  onSaveMixRadioToPlaylist,
  resumeQueueCount = 0,
  onResumeQueue,
  downloadEnabled = false,
  onDownloadTrack,
  isPodcast = false,
  podcastPlaybackSpeed = 1,
  onCyclePodcastSpeed,
  podcastSmartSpeedEnabled = false,
  onTogglePodcastSmartSpeed,
  podcastVoiceBoostEnabled = false,
  onTogglePodcastVoiceBoost,
  episodeVolumeBoostDb = 0,
  onCycleEpisodeVolumeBoost,
  podcastSkipAdChaptersEnabled = false,
  onTogglePodcastSkipAdChapters,
}: PlayerBarMoreMenuProps) {
  const { t } = useTranslation();
  const [bitDepthDetail, setBitDepthDetail] = useState(() =>
    fidelityBitDepthLabel(loadFidelityPolicy(), t),
  );
  const [miniPlayerMode, setMiniPlayerMode] = useState(loadAndroidMiniPlayerMode);

  useEffect(() => {
    if (!open) return;
    setMiniPlayerMode(loadAndroidMiniPlayerMode());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const refresh = async () => {
      if (isTauriDesktop()) {
        try {
          const status = await nativePlaybackStatus();
          if (cancelled) return;
          if (status.bitsPerSample > 0) {
            const rate =
              status.sampleRateHz > 0
                ? t('player.menu.bitDepthNative', {
                    bits: status.bitsPerSample,
                    rate: status.sampleRateHz,
                  })
                : `${status.bitsPerSample}-bit`;
            setBitDepthDetail(rate);
            return;
          }
        } catch {
          /* fall through to fidelity policy */
        }
      }
      if (!cancelled) {
        setBitDepthDetail(fidelityBitDepthLabel(loadFidelityPolicy(), t));
      }
    };

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  const handleCast = () => {
    onOpenChange(false);
    if (isTauriDesktop()) requestTauriCastGuidance();
    onOpenCastPicker();
  };

  const applyMiniPlayerMode = (mode: AndroidMiniPlayerMode) => {
    setMiniPlayerMode(mode);
    saveAndroidMiniPlayerMode(mode);
    void syncAndroidMiniPlayerMode(mode);
    if (mode === 'pip') {
      void enterAndroidPictureInPicture();
    }
  };

  const podcastActions = useMemo((): LockerMenuAction[] => {
    if (!isPodcast) return [];
    const speedLabel = formatPodcastPlaybackSpeed(podcastPlaybackSpeed);
    const volumeLabel =
      episodeVolumeBoostDb > 0
        ? formatEpisodeVolumeBoostLabel(episodeVolumeBoostDb)
        : 'Normal';
    const items: LockerMenuAction[] = [];
    if (onTogglePodcastSmartSpeed) {
      items.push({
        id: 'podcast-smart-speed',
        section: 'Playback',
        label: 'Smart Speed',
        active: podcastSmartSpeedEnabled,
        subtitle: podcastSmartSpeedEnabled
          ? 'On — shortens silences'
          : 'Off — tap to enable',
        onClick: onTogglePodcastSmartSpeed,
      });
    }
    if (onTogglePodcastVoiceBoost) {
      items.push({
        id: 'podcast-voice-boost',
        label: 'Voice Boost',
        active: podcastVoiceBoostEnabled,
        subtitle: podcastVoiceBoostEnabled
          ? 'On — clearer speech'
          : 'Off — tap to enable',
        onClick: onTogglePodcastVoiceBoost,
      });
    }
    if (onCycleEpisodeVolumeBoost) {
      items.push({
        id: 'podcast-volume-boost',
        label: 'Volume Boost',
        active: episodeVolumeBoostDb > 0,
        subtitle: volumeLabel,
        onClick: onCycleEpisodeVolumeBoost,
      });
    }
    if (onCyclePodcastSpeed) {
      items.push({
        id: 'podcast-speed',
        label: 'Speed',
        subtitle: speedLabel,
        onClick: onCyclePodcastSpeed,
      });
    }
    if (onTogglePodcastSkipAdChapters) {
      items.push({
        id: 'podcast-auto-skip-ads',
        label: 'Auto-skip ads',
        active: podcastSkipAdChaptersEnabled,
        subtitle: podcastSkipAdChaptersEnabled
          ? 'On — skips labeled ad chapters'
          : 'Off — tap to enable',
        onClick: onTogglePodcastSkipAdChapters,
      });
    }
    return items;
  }, [
    isPodcast,
    podcastPlaybackSpeed,
    onCyclePodcastSpeed,
    podcastSmartSpeedEnabled,
    onTogglePodcastSmartSpeed,
    podcastVoiceBoostEnabled,
    onTogglePodcastVoiceBoost,
    episodeVolumeBoostDb,
    onCycleEpisodeVolumeBoost,
    podcastSkipAdChaptersEnabled,
    onTogglePodcastSkipAdChapters,
  ]);

  const actions: LockerMenuAction[] = [
    ...podcastActions,
    ...(!isPodcast && resumeQueueCount > 0 && onResumeQueue
      ? [
          {
            id: 'resume-queue',
            label: t('home.resumeQueue'),
            subtitle:
              resumeQueueCount === 1
                ? t('home.tracksInQueue', { count: resumeQueueCount })
                : t('home.tracksInQueuePlural', { count: resumeQueueCount }),
            onClick: () => {
              onOpenChange(false);
              onResumeQueue();
            },
          } satisfies LockerMenuAction,
        ]
      : []),
    {
      id: 'sleep-timer',
      label: t('player.menu.sleepTimer'),
      active: sleepTimerOpen || Boolean(sleepTimerLabel),
      subtitle: sleepTimerLabel ?? undefined,
      onClick: onToggleSleepTimer,
    },
    ...(downloadEnabled && onDownloadTrack
      ? [
          {
            id: 'download-track',
            label: isPodcast ? 'Download episode' : t('player.trackSheet.download'),
            onClick: () => {
              onOpenChange(false);
              onDownloadTrack();
            },
          } satisfies LockerMenuAction,
        ]
      : []),
    ...(!isPodcast && mixRadioEnabled && onArtistMix
      ? [
          {
            id: 'artist-mix',
            label: t('player.menu.artistMix'),
            onClick: () => {
              onOpenChange(false);
              onArtistMix();
            },
          } satisfies LockerMenuAction,
        ]
      : []),
    ...(!isPodcast && mixRadioEnabled && onTrackRadio
      ? [
          {
            id: 'track-radio',
            label: t('player.menu.trackRadio'),
            onClick: () => {
              onOpenChange(false);
              onTrackRadio();
            },
          } satisfies LockerMenuAction,
        ]
      : []),
    ...(!isPodcast && mixRadioSession && onSaveMixRadioToPlaylist
      ? [
          {
            id: 'save-mix-radio',
            label:
              mixRadioSession.kind === 'mix'
                ? t('player.menu.saveMixToPlaylist')
                : t('player.menu.saveRadioToPlaylist'),
            disabled: !saveMixRadioEnabled,
            divider: true,
            onClick: () => {
              onOpenChange(false);
              onSaveMixRadioToPlaylist();
            },
          } satisfies LockerMenuAction,
        ]
      : []),
    {
      id: 'cast',
      label: t('player.menu.cast'),
      active: castActive,
      onClick: handleCast,
    },
    ...(onEnterCarMode
      ? [
          {
            id: 'car-mode',
            label: t('player.menu.carMode'),
            onClick: onEnterCarMode,
          } satisfies LockerMenuAction,
        ]
      : []),
    ...(isAndroidNative()
      ? [
          {
            id: 'mini-player-off',
            label: t('player.menu.miniPlayerOff'),
            active: miniPlayerMode === 'off',
            divider: true,
            onClick: () => applyMiniPlayerMode('off'),
          } satisfies LockerMenuAction,
          {
            id: 'mini-player-pip',
            label: t('player.menu.miniPlayerPip'),
            active: miniPlayerMode === 'pip',
            onClick: () => applyMiniPlayerMode('pip'),
          } satisfies LockerMenuAction,
          {
            id: 'mini-player-top-bar',
            label: t('player.menu.miniPlayerTopBar'),
            active: miniPlayerMode === 'topBar',
            subtitle: t('player.menu.miniPlayerTopBarNote'),
            onClick: () => applyMiniPlayerMode('topBar'),
          } satisfies LockerMenuAction,
        ]
      : []),
    {
      id: 'bit-depth',
      label: t('player.menu.bitDepth'),
      subtitle: bitDepthDetail,
      info: true,
      divider: true,
      onClick: () => {},
    },
    ...(!isPodcast
      ? [
          {
            id: 'album-cover',
            label: t('settings.architect.heroDisplayAlbumCover'),
            active: displayMode === 'album-cover',
            divider: true,
            onClick: () => saveHeroDisplayMode('album-cover'),
          } satisfies LockerMenuAction,
          {
            id: 'vinyl-shades',
            label: t('settings.architect.heroDisplayVinylShades'),
            active: displayMode === 'vinyl-shades',
            onClick: () => saveHeroDisplayMode('vinyl-shades'),
          } satisfies LockerMenuAction,
        ]
      : []),
  ];

  const mobileShell = useMobileShell();
  const menuMaxHeight = mobileShell ? (isPodcast ? 400 : 320) : 448;

  return (
    <LockerMoreMenu
      open={open}
      onOpenChange={onOpenChange}
      actions={actions}
      ariaLabel={t('player.moreMenu')}
      alwaysVisible
      align={mobileShell ? 'left' : 'right'}
      viewportAnchor={mobileShell ? 'left-edge' : 'trigger'}
      portaled
      maxHeightCapPx={menuMaxHeight}
      panelClassName={`player-more-menu-panel sandbox-menu-panel-sections${
        mobileShell ? ' player-more-menu-panel--mobile' : ''
      }`}
    />
  );
}
