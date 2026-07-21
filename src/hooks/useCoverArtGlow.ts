import { useEffect, useState } from 'react';
import {
  coverArtPaletteToStyle,
  extractCoverArtPalette,
  neutralCoverGlowStyle,
  seedFallbackGlowStyle,
} from '../coverColorExtract';

export function useCoverArtGlow(
  coverArt: string | undefined,
  fallbackSeed: string,
): { style: Record<string, string>; isMonochrome: boolean } {
  const trimmedCover = coverArt?.trim() ?? '';
  const hasCover = Boolean(trimmedCover);

  const [style, setStyle] = useState<Record<string, string>>(() =>
    hasCover ? neutralCoverGlowStyle() : seedFallbackGlowStyle(fallbackSeed),
  );
  const [isMonochrome, setIsMonochrome] = useState(false);

  useEffect(() => {
    if (!hasCover) {
      setStyle(seedFallbackGlowStyle(fallbackSeed));
      setIsMonochrome(false);
      return;
    }

    let cancelled = false;
    setStyle(neutralCoverGlowStyle());
    setIsMonochrome(false);

    void extractCoverArtPalette(trimmedCover).then((palette) => {
      if (cancelled) return;
      if (palette) {
        setStyle(coverArtPaletteToStyle(palette));
        setIsMonochrome(palette.isMonochrome);
        return;
      }
      setStyle(seedFallbackGlowStyle(fallbackSeed));
      setIsMonochrome(false);
    });

    return () => {
      cancelled = true;
    };
  }, [hasCover, trimmedCover, fallbackSeed]);

  return { style, isMonochrome };
}
