/**
 * Embeddable vinyl now-playing widget — OBS / home dashboard second screen.
 */

export type VinylWidgetSize = 'compact' | 'home' | 'tv' | 'full';
export type VinylWidgetTheme = 'dark' | 'light' | 'transparent';

export type VinylWidgetOptions = {
  size: VinylWidgetSize;
  theme: VinylWidgetTheme;
  chromeless: boolean;
};

const DEFAULT_OPTIONS: VinylWidgetOptions = {
  size: 'home',
  theme: 'dark',
  chromeless: true,
};

export function isVinylWidgetView(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname.toLowerCase();
  return (
    params.get('widget') === 'vinyl' ||
    params.get('embed') === 'vinyl' ||
    path.endsWith('/now-playing-widget') ||
    path.endsWith('/embed/vinyl')
  );
}

export function getVinylWidgetOptions(): VinylWidgetOptions {
  if (typeof window === 'undefined') return DEFAULT_OPTIONS;
  const params = new URLSearchParams(window.location.search);
  const sizeParam = params.get('size')?.trim().toLowerCase();
  const themeParam = params.get('theme')?.trim().toLowerCase();
  const chromeParam = params.get('chrome')?.trim().toLowerCase();

  const size: VinylWidgetSize =
    sizeParam === 'compact' || sizeParam === 'tv' || sizeParam === 'full'
      ? sizeParam
      : 'home';

  const theme: VinylWidgetTheme =
    themeParam === 'light' || themeParam === 'transparent' ? themeParam : 'dark';

  const chromeless = chromeParam !== '1' && chromeParam !== 'true';

  return { size, theme, chromeless };
}

export function vinylWidgetEmbedUrl(baseOrigin?: string): string {
  const origin =
    baseOrigin ??
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');
  return `${origin}/?widget=vinyl&chrome=0&size=home&theme=dark`;
}

export const VINYL_WIDGET_CHANNEL = 'sandbox-vinyl-widget';

export type VinylWidgetPayload = {
  title: string;
  artist: string;
  artworkUrl?: string;
  playing: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
};

export function publishVinylWidgetState(payload: VinylWidgetPayload): void {
  if (typeof window === 'undefined') return;
  try {
    const ch = new BroadcastChannel(VINYL_WIDGET_CHANNEL);
    ch.postMessage(payload);
    ch.close();
  } catch {
    /* BroadcastChannel unavailable */
  }
}

export function subscribeVinylWidgetState(
  handler: (payload: VinylWidgetPayload) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  try {
    const ch = new BroadcastChannel(VINYL_WIDGET_CHANNEL);
    const onMsg = (ev: MessageEvent<VinylWidgetPayload>) => {
      if (ev.data && typeof ev.data === 'object') handler(ev.data);
    };
    ch.addEventListener('message', onMsg);
    return () => {
      ch.removeEventListener('message', onMsg);
      ch.close();
    };
  } catch {
    return () => {};
  }
}
