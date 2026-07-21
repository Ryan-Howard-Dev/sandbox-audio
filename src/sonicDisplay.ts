import type { SonicFeatures } from './sonicFeatures';

/** Human-readable sonic summary for UI chips. */
export function formatSonicSummary(features: SonicFeatures | null | undefined): string | null {
  if (!features) return null;
  const parts: string[] = [];
  if (features.bpm && features.bpm > 40 && features.bpm < 220) {
    parts.push(`${Math.round(features.bpm)} BPM`);
  }
  if (features.camelot) {
    parts.push(features.musicalKey ? `${features.camelot} (${features.musicalKey})` : features.camelot);
  } else if (features.energy != null) {
    parts.push(`E ${Math.round(features.energy * 100)}%`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
