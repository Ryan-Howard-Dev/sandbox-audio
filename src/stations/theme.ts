/** tactical-midnight tokens shared by Layer 4 stations */
export const C = {
  bg: '#07080c',
  surface: '#0d0f16',
  card: '#111420',
  border: '#1e2130',
  borderHi: '#2a2f45',
  /** Dynamic — always use `var(--orange)` in styles for live theming */
  accent: 'var(--orange)',
  text: '#f0f0f0',
  textMid: '#8a8fa8',
  textLabel: '#a8b0c8',
  textDim: '#6e758c',
} as const;

/** Uniform outline badge — transport/source labels (LOCAL, STREAM, etc.) follow Settings accent. */
export const themeBadgeOutlineClass = 'theme-badge';

export const DEVICE_CAPACITY_OPTIONS = [
  '10 GB',
  '50 GB',
  '100 GB',
  '250 GB',
  '500 GB',
  'UNLIMITED',
] as const;

export type DeviceCapacity = (typeof DEVICE_CAPACITY_OPTIONS)[number];

export const DEFAULT_DEVICE_CAPACITY: DeviceCapacity = '100 GB';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Total album/runtime length — uses H:MM:SS when over one hour. */
export function formatAlbumDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
