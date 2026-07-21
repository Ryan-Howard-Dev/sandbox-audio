import { useEffect, useMemo, useState } from 'react';
import {
  extractCoverArtPalette,
  resolveTrackUniverseStyle,
  type CoverArtPalette,
} from '../coverColorExtract';
import { seedGradientUniverseStyle } from '../seedGradient';
import { loadVinylDisplayMode } from '../vinylDisplaySettings';
import { loadVinylVisualSettings } from '../vinylVisualSettings';
import { isNativePhoneShell } from '../musicUniverse';

const FOLLOW_ART_DEFAULT_BLEND = 85;

function effectiveArtBlend(displayMode: ReturnType<typeof loadVinylDisplayMode>, artBlend: number): number {
  if (displayMode === 'follow-art') {
    return artBlend > 0 ? artBlend : FOLLOW_ART_DEFAULT_BLEND;
  }
  return artBlend;
}

export function useTrackUniverseStyle(
  coverArt: string | undefined,
  gradientSeed: string,
): {
  universeStyle: Record<string, string>;
  isArtDriven: boolean;
  isMonochrome: boolean;
} {
  const trimmedCover = coverArt?.trim() ?? '';
  const hasCover = Boolean(trimmedCover);

  const [displayMode, setDisplayMode] = useState(loadVinylDisplayMode);
  const [artBlend, setArtBlend] = useState(() => loadVinylVisualSettings().artBlend);
  const [palette, setPalette] = useState<CoverArtPalette | null>(null);

  useEffect(() => {
    const sync = () => {
      setDisplayMode(loadVinylDisplayMode());
      setArtBlend(loadVinylVisualSettings().artBlend);
    };
    window.addEventListener('sandbox-settings-change', sync);
    return () => window.removeEventListener('sandbox-settings-change', sync);
  }, []);

  useEffect(() => {
    const blend = effectiveArtBlend(displayMode, artBlend);
    if (!hasCover || blend <= 0) {
      setPalette(null);
      return;
    }

    let cancelled = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const sample = () => {
      if (cancelled) return;
      void extractCoverArtPalette(trimmedCover).then((next) => {
        if (!cancelled) setPalette(next);
      });
    };

    // Defer canvas work off the play-tap critical path on phones.
    if (isNativePhoneShell() && typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(sample, { timeout: 600 });
    } else {
      timeoutId = setTimeout(sample, 0);
    }

    return () => {
      cancelled = true;
      if (idleId != null && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleId);
      }
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [hasCover, trimmedCover, displayMode, artBlend]);

  const blend = effectiveArtBlend(displayMode, artBlend);
  const canUseArt = hasCover && palette != null && blend > 0;

  const universeStyle = useMemo(() => {
    const seedStyle = seedGradientUniverseStyle(gradientSeed);
    if (!canUseArt || !palette) return seedStyle;
    return resolveTrackUniverseStyle(gradientSeed, palette, blend);
  }, [canUseArt, palette, gradientSeed, blend]);

  return {
    universeStyle,
    isArtDriven: canUseArt,
    isMonochrome: Boolean(canUseArt && palette?.isMonochrome),
  };
}
