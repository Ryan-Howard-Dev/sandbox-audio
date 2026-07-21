function titleHash(title: string): number {
  return (title || 'unknown').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
}

export function seedGradientHues(title: string): { hue: number; hue2: number } {
  const hash = titleHash(title);
  const hue = hash % 360;
  const hue2 = (hue + 40) % 360;
  return { hue, hue2 };
}

/** Distinct hue stops for universe — primary + 60° / 120° / complementary offsets. */
export function seedGradientUniverseHues(title: string): {
  primary: number;
  secondary: number;
  tertiary: number;
  accent: number;
} {
  const hash = titleHash(title);
  const primary = hash % 360;
  const secondary = (primary + 60 + (hash % 18)) % 360;
  const tertiary = (primary + 120 + (hash % 22)) % 360;
  const accent = (primary + 180 + (hash % 12)) % 360;
  return { primary, secondary, tertiary, accent };
}

/** Subtle dark edge tints — muted saturation, near void lightness. */
export function seedGradientAmbientPalette(title: string): [string, string, string, string] {
  const { primary, secondary, tertiary, accent } = seedGradientUniverseHues(title);
  return [
    `hsl(${primary} 18% 8% / 0.22)`,
    `hsl(${secondary} 14% 7% / 0.16)`,
    `hsl(${tertiary} 12% 6% / 0.12)`,
    `hsl(${accent} 10% 5% / 0.1)`,
  ];
}

/** Muted tints for vinyl halo — not full-screen throw beams. */
export function seedGradientThrowPalette(title: string): [string, string, string, string] {
  const { primary, secondary, tertiary } = seedGradientUniverseHues(title);
  return [
    `hsl(${primary} 24% 16%)`,
    `hsl(${secondary} 18% 13%)`,
    `hsl(${tertiary} 14% 11%)`,
    '#8B3A12',
  ];
}

/** 3–4 deterministic HSL stops for multi-layer ambient universe (burgundy, olive, purple, etc.). */
export function seedGradientPalette(title: string): [string, string, string, string] {
  return seedGradientAmbientPalette(title);
}

/** Seeded radial gradient for missing album art — deterministic from title. */
export function seedGradient(title: string): string {
  const { hue, hue2 } = seedGradientHues(title);
  return `radial-gradient(circle at 40% 40%, hsl(${hue}, 65%, 28%) 0%, hsl(${hue2}, 45%, 12%) 50%, #07080c 100%)`;
}

/** CSS custom properties for track-tinted ambient glow (matches seedGradient hues). */
export function seedGradientGlowStyle(title: string): Record<string, string> {
  const { primary, secondary, tertiary } = seedGradientUniverseHues(title);
  return {
    '--track-glow-a': `hsl(${primary} 22% 12% / 0.08)`,
    '--track-glow-b': `hsl(${secondary} 16% 9% / 0.05)`,
    '--track-glow-c': `hsl(${tertiary} 12% 7% / 0.04)`,
  };
}

/** CSS vars for TV / desktop hypnotic universe — palette + glow (GPU-friendly transform/opacity only). */
export function seedGradientUniverseStyle(title: string): Record<string, string> {
  const [a, b, c, d] = seedGradientAmbientPalette(title);
  const [throwA, throwB, throwC, throwD] = seedGradientThrowPalette(title);
  const glow = seedGradientGlowStyle(title);
  return {
    ...glow,
    '--universe-a': a,
    '--universe-b': b,
    '--universe-c': c,
    '--universe-d': d,
    '--universe-throw-a': throwA,
    '--universe-throw-b': throwB,
    '--universe-throw-c': throwC,
    '--universe-throw-d': throwD,
    '--universe-brand': '#8B3A12',
    '--universe-void': '#07080c',
    '--universe-emitter-x': '50%',
    '--universe-emitter-y': '36%',
  };
}

/** Hide broken <img> and reveal seeded gradient on the art layer. */
export function handleArtImgError(
  e: { currentTarget: HTMLImageElement },
  title: string,
): void {
  e.currentTarget.style.display = 'none';
  const layer = e.currentTarget.closest('.vinyl-disc-art-layer');
  const placeholder = layer?.querySelector('.vinyl-disc-art-placeholder') as HTMLElement | null;
  if (placeholder) {
    placeholder.style.background = seedGradient(title);
  }
}
