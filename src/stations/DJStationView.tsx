import React, { useEffect, useState } from 'react';
import DJConsoleView, { type PendingDjDeckLoad } from '../components/DJConsoleView';
import { useAccentColor } from '../hooks/useAccentColor';
import { isDjAudioRoutingEnabled } from '../djAudioEngine';

export interface DJStationViewProps {
  lockerTracks: Array<{
    id: string;
    title: string;
    artist: string;
    genre: string;
    bitrate: number;
    durationSeconds: number;
    priority: number;
    url?: string;
  }>;
  pendingDeckLoad?: PendingDjDeckLoad | null;
  onPendingDeckLoadConsumed?: () => void;
}

export default function DJStationView({
  lockerTracks,
  pendingDeckLoad = null,
  onPendingDeckLoadConsumed,
}: DJStationViewProps) {
  const accentColor = useAccentColor();
  const [audioRouting, setAudioRouting] = useState(isDjAudioRoutingEnabled);
  const borderRadius =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('sandbox_border_radius') ?? '12px'
      : '12px';

  useEffect(() => {
    const sync = () => setAudioRouting(isDjAudioRoutingEnabled());
    window.addEventListener('sandbox-settings-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('sandbox-settings-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto w-full min-h-0 flex flex-col">
      <DJConsoleView
        allTracks={lockerTracks}
        accentColor={accentColor}
        borderRadius={borderRadius}
        audioRoutingEnabled={audioRouting}
        pendingDeckLoad={pendingDeckLoad}
        onPendingDeckLoadConsumed={onPendingDeckLoadConsumed}
      />
    </div>
  );
}
