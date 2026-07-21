import React, { useEffect, useState } from 'react';
import VinylHero from '../components/VinylHero';
import {
  getVinylWidgetOptions,
  subscribeVinylWidgetState,
  type VinylWidgetPayload,
} from '../vinylWidget';
import { loadHeroDisplayMode, resolveHeroShowShades } from '../heroDisplaySettings';
import { useTrackUniverseStyle } from '../hooks/useTrackUniverseStyle';
import { useVinylVisualStyle } from '../vinylVisualSettings';

const IDLE: VinylWidgetPayload = {
  title: 'Sandbox Music',
  artist: 'Nothing playing',
  playing: false,
  currentTimeSeconds: 0,
  durationSeconds: 0,
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function VinylWidgetView() {
  const options = getVinylWidgetOptions();
  const [payload, setPayload] = useState<VinylWidgetPayload>(IDLE);
  const heroMode = loadHeroDisplayMode();
  const showShades = resolveHeroShowShades(heroMode, payload.title);
  const gradientSeed = payload.title?.trim() || 'Sandbox';
  const { cssVars: vinylCssVars, vinylClass } = useVinylVisualStyle(null);
  const { universeStyle } = useTrackUniverseStyle(payload.artworkUrl, gradientSeed);
  const discStyle = payload.title?.trim()
    ? { ...universeStyle, ...vinylCssVars }
    : undefined;

  useEffect(() => {
    document.documentElement.classList.add(`vinyl-widget-theme-${options.theme}`);
    if (options.chromeless) {
      document.documentElement.classList.add('vinyl-widget-chromeless');
    }
    return () => {
      document.documentElement.classList.remove(
        `vinyl-widget-theme-${options.theme}`,
        'vinyl-widget-chromeless',
      );
    };
  }, [options.theme, options.chromeless]);

  useEffect(() => subscribeVinylWidgetState(setPayload), []);

  const progress =
    payload.durationSeconds > 0
      ? Math.min(100, (payload.currentTimeSeconds / payload.durationSeconds) * 100)
      : 0;

  return (
    <div
      className={`vinyl-widget-root vinyl-widget-root--${options.size}`}
      data-theme={options.theme}
    >
      <VinylHero
        title={payload.title}
        artworkUrl={payload.artworkUrl}
        playing={payload.playing}
        pausedSpin={!payload.playing && Boolean(payload.title)}
        showShades={showShades}
        size={options.size === 'tv' || options.size === 'full' ? 'tv' : options.size === 'compact' ? 'compact' : 'home'}
        discClassName={vinylClass}
        discStyle={discStyle}
      />
      <div className="vinyl-widget-meta">
        <p className="vinyl-widget-title">{payload.title}</p>
        <p className="vinyl-widget-artist">{payload.artist}</p>
        {payload.durationSeconds > 0 ? (
          <div className="vinyl-widget-progress">
            <div className="vinyl-widget-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        ) : null}
        {payload.durationSeconds > 0 ? (
          <p className="vinyl-widget-time">
            {formatTime(payload.currentTimeSeconds)} / {formatTime(payload.durationSeconds)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
