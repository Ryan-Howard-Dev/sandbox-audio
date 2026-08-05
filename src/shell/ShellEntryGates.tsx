/**
 * Early shell entry gates — car mode, onboarding, server setup, and system login.
 * Extracted from sandboxLayer3 so the main ShellChrome return is not preceded by four
 * full-screen branches inline.
 *
 * Call from SandboxShell after playback/chrome state exists (car mode needs homeTitle /
 * togglePlay / skip controls). Return the element when a gate matches; otherwise null and
 * continue into the main chrome.
 */

import React, { type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { UseAudioFSMResult, UseProfileResult } from '../sandboxLayer1';
import OnboardingWizard from '../components/OnboardingWizard';
import ServerSetup from '../components/ServerSetup';
import CarModeView from '../stations/CarModeView';
import SystemLogin from './SystemLogin';
import { LockerVaultProvider } from '../LockerVaultContext';
import { proxiedArtworkUrl } from '../displaySanitize';
import type { ConnectCommand, SyncStatePayload } from '../tier34/connectProtocol';

export type ShellEntryGatesProps = {
  isCarMode: boolean;
  isTV: boolean;
  showOnboarding: boolean;
  showServerSetup: boolean;
  profile: UseProfileResult;
  setOnboardingComplete: Dispatch<SetStateAction<boolean>>;
  setServerSetupDismissed: Dispatch<SetStateAction<boolean>>;
  audio: UseAudioFSMResult;
  artworkUrl: string;
  homeTitle: string;
  homeArtist: string;
  homeDisplayState: UseAudioFSMResult['state'];
  effectiveConnectRole: string | null;
  remoteMirror: SyncStatePayload | null;
  isConnectRemoteRef: MutableRefObject<boolean>;
  togglePlay: () => void;
  skipBack: () => void;
  skipForward: () => void;
  sendConnectCommand: (command: ConnectCommand) => void;
  handleExitCarMode: () => void;
};

export function renderShellEntryGates(p: ShellEntryGatesProps): React.ReactNode {
  if (p.isCarMode && !p.isTV) {
    const carArt =
      proxiedArtworkUrl(p.artworkUrl || p.audio.envelope?.artworkUrl) ??
      (p.artworkUrl || p.audio.envelope?.artworkUrl || '');
    return (
      <LockerVaultProvider>
        <div className="shell-root shell-root--car h-dvh w-full min-w-0 flex flex-col relative z-[1]">
          <CarModeView
            title={p.homeTitle}
            artist={p.homeArtist}
            albumArt={carArt}
            state={p.homeDisplayState}
            isPlaying={p.audio.state === 'Playing' || p.audio.nativeExoEffectivePlaying}
            volume={p.audio.volume}
            isMuted={p.audio.isMuted}
            connectRemote={p.effectiveConnectRole === 'remote'}
            remoteMirror={p.remoteMirror}
            onTogglePlay={p.togglePlay}
            onSkipBack={p.skipBack}
            onSkipForward={p.skipForward}
            onSetVolume={(level) => {
              if (p.isConnectRemoteRef.current) {
                p.sendConnectCommand({ cmd: 'SET_VOLUME', volume: level });
              } else {
                p.audio.setVolume(level);
              }
            }}
            onToggleMute={() => {
              if (p.isConnectRemoteRef.current) {
                const v = p.remoteMirror?.volume ?? 0;
                p.sendConnectCommand({ cmd: 'SET_VOLUME', volume: v > 0 ? 0 : 1 });
              } else {
                p.audio.toggleMute();
              }
            }}
            onExit={p.handleExitCarMode}
          />
        </div>
      </LockerVaultProvider>
    );
  }

  if (p.showOnboarding) {
    return (
      <OnboardingWizard
        onComplete={() => p.setOnboardingComplete(true)}
        enterAs={p.profile.enterAs}
      />
    );
  }

  if (p.showServerSetup) {
    return <ServerSetup onComplete={() => p.setServerSetupDismissed(true)} />;
  }

  if (p.profile.requiresSystemLogin) {
    return (
      <SystemLogin
        profiles={p.profile.profiles}
        onEnter={p.profile.enterAs}
        onSelect={p.profile.selectProfile}
      />
    );
  }

  return null;
}
