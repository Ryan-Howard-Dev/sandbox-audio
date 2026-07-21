import {
  seedGradientGlowStyle,
  seedGradientUniverseHues,
  seedGradientUniverseStyle,
} from './seedGradient';

const SAMPLE_SIZE = 48;
const MONO_SAT_THRESHOLD = 14;
const MONO_RATIO_THRESHOLD = 0.72;
const PALETTE_CACHE_MAX = 64;

/** In-memory cache — avoids re-sampling the same cover on track skip / tab return. */
const paletteCache = new Map<string, CoverArtPalette | null>();

function readPaletteCache(url: string): CoverArtPalette | null | undefined {
  return paletteCache.get(url);
}

function writePaletteCache(url: string, palette: CoverArtPalette | null): void {
  if (paletteCache.size >= PALETTE_CACHE_MAX) {
    const oldest = paletteCache.keys().next().value;
    if (oldest) paletteCache.delete(oldest);
  }
  paletteCache.set(url, palette);
}

export function clearCoverArtPaletteCache(): void {
  paletteCache.clear();
}

const UNIVERSE_BLEND_KEYS = [
  '--universe-a',
  '--universe-b',
  '--universe-c',
  '--universe-d',
  '--universe-throw-a',
  '--universe-throw-b',
  '--universe-throw-c',
  '--universe-throw-d',
  '--track-glow-a',
  '--track-glow-b',
  '--track-glow-c',
  '--universe-brand',
] as const;

export type CoverArtPalette = {
  isMonochrome: boolean;
  primaryHue: number;
  secondaryHue: number;
  tertiaryHue: number;
  accentHue: number;
  avgLightness: number;
  glowPrimary: string;
  glowSecondary: string;
  trackGlowA: string;
  trackGlowB: string;
};

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function loadCoverImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('cover image load failed'));
    img.src = url;
  });
}

function sampleCoverPixels(img: HTMLImageElement): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const scale = Math.max(SAMPLE_SIZE / img.naturalWidth, SAMPLE_SIZE / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const offsetX = (SAMPLE_SIZE - drawW) / 2;
  const offsetY = (SAMPLE_SIZE - drawH) / 2;
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
}

function buildMonochromePalette(avgLightness: number): CoverArtPalette {
  /* Low-opacity neutrals — ambient wash uses blurred art, not center radials */
  const glowL = Math.min(62, Math.max(32, avgLightness + 4));
  const softL = Math.min(52, Math.max(24, avgLightness - 8));

  return {
    isMonochrome: true,
    primaryHue: 0,
    secondaryHue: 0,
    tertiaryHue: 0,
    accentHue: 0,
    avgLightness,
    glowPrimary: `hsl(0 0% ${glowL.toFixed(0)}% / 0.12)`,
    glowSecondary: `hsl(0 0% ${softL.toFixed(0)}% / 0.08)`,
    trackGlowA: 'transparent',
    trackGlowB: 'transparent',
  };
}

function buildColorPalette(
  primaryHue: number,
  secondaryHue: number,
  avgLightness: number,
): CoverArtPalette {
  const tertiaryHue = (primaryHue + 120) % 360;
  const accentHue = (primaryHue + 180) % 360;
  return {
    isMonochrome: false,
    primaryHue,
    secondaryHue,
    tertiaryHue,
    accentHue,
    avgLightness,
    glowPrimary: `hsl(${primaryHue.toFixed(0)} 72% 50% / 0.52)`,
    glowSecondary: `hsl(${secondaryHue.toFixed(0)} 55% 42% / 0.32)`,
    trackGlowA: `hsl(${primaryHue.toFixed(0)} 22% 12% / 0.08)`,
    trackGlowB: `hsl(${secondaryHue.toFixed(0)} 16% 9% / 0.05)`,
  };
}

function analyzeCoverPixels(data: Uint8ClampedArray): CoverArtPalette {
  const hueBuckets = new Array<number>(36).fill(0);
  let monoCount = 0;
  let lightnessSum = 0;
  let sampleCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 40) continue;

    const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    lightnessSum += l;
    sampleCount += 1;

    if (s < MONO_SAT_THRESHOLD) {
      monoCount += 1;
      continue;
    }

    const weight = (s / 100) * (1 - Math.abs(l - 50) / 50);
    if (weight <= 0) continue;
    hueBuckets[Math.floor(h / 10) % 36] += weight;
  }

  if (sampleCount === 0) {
    return buildMonochromePalette(42);
  }

  const monoRatio = monoCount / sampleCount;
  if (monoRatio >= MONO_RATIO_THRESHOLD) {
    return buildMonochromePalette(lightnessSum / sampleCount);
  }

  let primaryBucket = 0;
  let primaryWeight = -1;
  for (let i = 0; i < hueBuckets.length; i += 1) {
    if (hueBuckets[i] > primaryWeight) {
      primaryWeight = hueBuckets[i];
      primaryBucket = i;
    }
  }

  if (primaryWeight <= 0) {
    return buildMonochromePalette(lightnessSum / sampleCount);
  }

  const primaryHue = primaryBucket * 10 + 5;
  let secondaryBucket = (primaryBucket + 6) % 36;
  let secondaryWeight = -1;
  for (let i = 0; i < hueBuckets.length; i += 1) {
    if (i === primaryBucket) continue;
    if (hueBuckets[i] > secondaryWeight) {
      secondaryWeight = hueBuckets[i];
      secondaryBucket = i;
    }
  }

  const secondaryHue =
    secondaryWeight > 0 ? secondaryBucket * 10 + 5 : (primaryHue + 58) % 360;
  const avgLightness = lightnessSum / sampleCount;

  return buildColorPalette(primaryHue, secondaryHue, avgLightness);
}

/** Sample cover art on a canvas and derive ambient glow hues. */
export async function extractCoverArtPalette(
  imageUrl: string,
): Promise<CoverArtPalette | null> {
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;

  const cached = readPaletteCache(trimmed);
  if (cached !== undefined) return cached;

  try {
    const img = await loadCoverImage(trimmed);
    if (!img.naturalWidth || !img.naturalHeight) {
      writePaletteCache(trimmed, null);
      return null;
    }
    const data = sampleCoverPixels(img);
    if (!data) {
      writePaletteCache(trimmed, null);
      return null;
    }
    const palette = analyzeCoverPixels(data);
    writePaletteCache(trimmed, palette);
    return palette;
  } catch {
    writePaletteCache(trimmed, null);
    return null;
  }
}

export function coverArtPaletteToStyle(
  palette: CoverArtPalette,
): Record<string, string> {
  return {
    '--locker-cover-glow': palette.glowPrimary,
    '--locker-cover-glow-soft': palette.glowSecondary,
    '--track-glow-a': palette.trackGlowA,
    '--track-glow-b': palette.trackGlowB,
  };
}

/** Neutral placeholder while cover hues are being sampled. */
export function neutralCoverGlowStyle(): Record<string, string> {
  return {
    '--locker-cover-glow': 'hsl(0 0% 48% / 0.1)',
    '--locker-cover-glow-soft': 'hsl(0 0% 38% / 0.06)',
    '--track-glow-a': 'transparent',
    '--track-glow-b': 'transparent',
  };
}

/** Seeded genre/title glow — used only when cover art is missing. */
export function seedFallbackGlowStyle(seed: string): Record<string, string> {
  const { primary, secondary } = seedGradientUniverseHues(seed);
  return {
    ...seedGradientGlowStyle(seed),
    '--locker-cover-glow': `hsl(${primary} 72% 50% / 0.52)`,
    '--locker-cover-glow-soft': `hsl(${secondary} 55% 42% / 0.32)`,
  };
}

function artAmbientStop(hue: number, sat: number, light: number, alpha: number): string {
  return `hsl(${hue.toFixed(0)} ${sat}% ${light}% / ${alpha.toFixed(2)})`;
}

function artThrowStop(hue: number, sat: number, light: number): string {
  return `hsl(${hue.toFixed(0)} ${sat}% ${light}%)`;
}

function brandFromHue(hue: number, lightness: number): string {
  const l = Math.min(48, Math.max(28, lightness * 0.55 + 18));
  return `hsl(${hue.toFixed(0)} 62% ${l.toFixed(0)}%)`;
}

/** Full universe CSS vars derived from sampled cover art hues. */
export function coverArtPaletteToUniverseStyle(
  palette: CoverArtPalette,
  artSaturationBoost = 1,
): Record<string, string> {
  const satMul = Math.max(0.5, Math.min(1.35, artSaturationBoost));

  if (palette.isMonochrome) {
    const l = palette.avgLightness;
    const edge = Math.min(14, Math.max(6, l * 0.18));
    return {
      '--track-glow-a': `hsl(0 0% ${edge.toFixed(0)}% / 0.06)`,
      '--track-glow-b': `hsl(0 0% ${Math.max(5, edge - 2).toFixed(0)}% / 0.04)`,
      '--track-glow-c': 'transparent',
      '--universe-a': `hsl(0 0% ${edge.toFixed(0)}% / 0.2)`,
      '--universe-b': `hsl(0 0% ${Math.max(5, edge - 1).toFixed(0)}% / 0.14)`,
      '--universe-c': `hsl(0 0% ${Math.max(4, edge - 2).toFixed(0)}% / 0.1)`,
      '--universe-d': `hsl(0 0% ${Math.max(3, edge - 3).toFixed(0)}% / 0.08)`,
      '--universe-throw-a': `hsl(0 0% ${Math.min(22, edge + 6).toFixed(0)}%)`,
      '--universe-throw-b': `hsl(0 0% ${Math.min(18, edge + 4).toFixed(0)}%)`,
      '--universe-throw-c': `hsl(0 0% ${Math.min(14, edge + 2).toFixed(0)}%)`,
      '--universe-throw-d': '#5a5a5a',
      '--universe-brand': `hsl(0 0% ${Math.min(42, edge + 10).toFixed(0)}%)`,
      '--universe-void': '#07080c',
      '--universe-emitter-x': '50%',
      '--universe-emitter-y': '36%',
    };
  }

  const { primaryHue, secondaryHue, tertiaryHue, accentHue, avgLightness } = palette;
  const ambSat = Math.round(18 * satMul);
  const throwSat = Math.round(24 * satMul);

  return {
    '--track-glow-a': artAmbientStop(primaryHue, Math.round(22 * satMul), 12, 0.1),
    '--track-glow-b': artAmbientStop(secondaryHue, Math.round(16 * satMul), 9, 0.06),
    '--track-glow-c': artAmbientStop(tertiaryHue, Math.round(12 * satMul), 7, 0.05),
    '--universe-a': artAmbientStop(primaryHue, ambSat, 8, 0.26),
    '--universe-b': artAmbientStop(secondaryHue, Math.round(14 * satMul), 7, 0.18),
    '--universe-c': artAmbientStop(tertiaryHue, Math.round(12 * satMul), 6, 0.14),
    '--universe-d': artAmbientStop(accentHue, Math.round(10 * satMul), 5, 0.11),
    '--universe-throw-a': artThrowStop(primaryHue, throwSat, 16),
    '--universe-throw-b': artThrowStop(secondaryHue, Math.round(18 * satMul), 13),
    '--universe-throw-c': artThrowStop(tertiaryHue, Math.round(14 * satMul), 11),
    '--universe-throw-d': brandFromHue(accentHue, avgLightness),
    '--universe-brand': brandFromHue(primaryHue, avgLightness),
    '--universe-void': '#07080c',
    '--universe-emitter-x': '50%',
    '--universe-emitter-y': '36%',
  };
}

type ParsedHsl = { h: number; s: number; l: number; a: number };

function parseCssColor(value: string): ParsedHsl | null {
  const trimmed = value.trim();
  if (trimmed === 'transparent') return { h: 0, s: 0, l: 0, a: 0 };
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let raw = hex[1];
    if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('');
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    const { h, s, l } = rgbToHsl(r, g, b);
    return { h, s, l, a: 1 };
  }
  const hsl = trimmed.match(
    /^hsl\(\s*([\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+))?\s*\)$/i,
  );
  if (hsl) {
    return {
      h: parseFloat(hsl[1]),
      s: parseFloat(hsl[2]),
      l: parseFloat(hsl[3]),
      a: hsl[4] != null ? parseFloat(hsl[4]) : 1,
    };
  }
  return null;
}

function formatHsl({ h, s, l, a }: ParsedHsl): string {
  if (a <= 0.001) return 'transparent';
  if (a >= 0.999) return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}% / ${a.toFixed(2)})`;
}

function lerpHue(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

function blendCssColor(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const pa = parseCssColor(a);
  const pb = parseCssColor(b);
  if (!pa || !pb) return t >= 0.5 ? b : a;
  return formatHsl({
    h: lerpHue(pa.h, pb.h, t),
    s: pa.s + (pb.s - pa.s) * t,
    l: pa.l + (pb.l - pa.l) * t,
    a: pa.a + (pb.a - pa.a) * t,
  });
}

/** Blend seeded title colors with cover-art universe vars (0 = seed, 100 = art). */
export function blendUniverseStyles(
  seedStyle: Record<string, string>,
  artStyle: Record<string, string>,
  blend0to100: number,
): Record<string, string> {
  const t = Math.max(0, Math.min(100, blend0to100)) / 100;
  const out: Record<string, string> = { ...seedStyle };
  for (const key of UNIVERSE_BLEND_KEYS) {
    const seedVal = seedStyle[key];
    const artVal = artStyle[key];
    if (seedVal && artVal) {
      out[key] = blendCssColor(seedVal, artVal, t);
    } else if (artVal && t > 0) {
      out[key] = artVal;
    }
  }
  return out;
}

export function resolveTrackUniverseStyle(
  gradientSeed: string,
  palette: CoverArtPalette | null,
  artBlend: number,
): Record<string, string> {
  const seedStyle = seedGradientUniverseStyle(gradientSeed);
  if (!palette || artBlend <= 0) return seedStyle;
  const artStyle = coverArtPaletteToUniverseStyle(palette);
  return blendUniverseStyles(seedStyle, artStyle, artBlend);
}
