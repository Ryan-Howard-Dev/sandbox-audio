/**
 * Client-side Last.fm + ListenBrainz scrobbling on play events.
 * Now-playing on track start; scrobble when eligible (>50% or track end).
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { isAirGapEnabled } from './airGapMode';
import { loadScrobbleSettings } from './scrobbleSettings';
import { getTier34BaseUrl, tier34ScrobbleRelay } from './tier34/client';

const LASTFM_API = 'https://ws.audioscrobbler.com/2.0/';
const LISTENBRAINZ_API = 'https://api.listenbrainz.org/1/submit-listens';
const LASTFM_AUTH_URL = 'https://www.last.fm/api/auth';

/** Minimum listen time before scrobble (Last.fm rule). */
const MIN_SCROBBLE_MS = 30_000;

let lastNowPlayingKey = '';

export function getLastfmAuthUrl(apiKey: string): string {
  return `${LASTFM_AUTH_URL}?api_key=${encodeURIComponent(apiKey.trim())}`;
}

export function isScrobbleBlockedByAirGap(): boolean {
  return isAirGapEnabled();
}

export function isScrobbleEligible(listenedMs: number, durationMs: number): boolean {
  if (listenedMs < MIN_SCROBBLE_MS) return false;
  if (durationMs <= 0) return listenedMs >= MIN_SCROBBLE_MS;
  const halfDuration = durationMs * 0.5;
  const fourMinutes = 4 * 60 * 1000;
  const threshold = Math.min(halfDuration, fourMinutes);
  return listenedMs >= threshold;
}

function trackKey(envelope: MediaEnvelope): string {
  return `${envelope.artist}::${envelope.title}::${envelope.album ?? ''}`;
}

function durationMsFromEnvelope(envelope: MediaEnvelope): number {
  const secs = envelope.durationSeconds;
  return secs != null && secs > 0 ? Math.round(secs * 1000) : 0;
}

function unixTimestampSeconds(ms = Date.now()): number {
  return Math.floor(ms / 1000);
}

async function lastfmPost(
  method: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const { lastfmApiKey, lastfmSessionKey } = loadScrobbleSettings();
  if (!lastfmApiKey || !lastfmSessionKey) {
    return { ok: false, error: 'Last.fm credentials incomplete' };
  }

  if (isAirGapEnabled() && getTier34BaseUrl()) {
    const relay = await tier34ScrobbleRelay({
      method,
      params,
      apiKey: lastfmApiKey,
      sessionKey: lastfmSessionKey,
    });
    if (relay.ok === false) return { ok: false, error: relay.error };
    const data = relay.data as { error?: number; message?: string };
    if (data?.error) return { ok: false, error: data.message ?? `error ${data.error}` };
    return { ok: true };
  }

  if (isAirGapEnabled()) {
    return { ok: false, error: 'Air-Gap Mode blocks outbound scrobbling' };
  }

  const body = new URLSearchParams({
    method,
    api_key: lastfmApiKey,
    sk: lastfmSessionKey,
    format: 'json',
    ...params,
  });

  try {
    const res = await fetch(LASTFM_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { error?: number; message?: string };
    if (data.error) return { ok: false, error: data.message ?? `error ${data.error}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function listenBrainzSubmit(
  listenType: 'single' | 'playing_now',
  envelope: MediaEnvelope,
  listenedMs?: number,
): Promise<{ ok: boolean; error?: string }> {
  const { listenbrainzToken } = loadScrobbleSettings();
  if (!listenbrainzToken) return { ok: false, error: 'ListenBrainz token missing' };

  if (isAirGapEnabled()) {
    return { ok: false, error: 'Air-Gap Mode blocks outbound scrobbling' };
  }

  const listened = listenedMs != null ? Math.max(0, Math.floor(listenedMs / 1000)) : undefined;
  const payload = {
    listen_type: listenType,
    payload: [
      {
        listened_at: unixTimestampSeconds(),
        track_metadata: {
          artist_name: envelope.artist,
          track_name: envelope.title,
          release_name: envelope.album,
          additional_info: {
            duration_ms: durationMsFromEnvelope(envelope) || undefined,
          },
        },
        ...(listened != null ? { listening_from: listened } : {}),
      },
    ],
  };

  try {
    const res = await fetch(LISTENBRAINZ_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${listenbrainzToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: text || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Send now-playing to enabled services when a track starts. */
export async function scrobbleNowPlaying(envelope: MediaEnvelope): Promise<void> {
  const settings = loadScrobbleSettings();
  if (!settings.lastfmEnabled && !settings.listenbrainzEnabled) return;
  if (isAirGapEnabled() && !getTier34BaseUrl()) return;

  const key = trackKey(envelope);
  if (key === lastNowPlayingKey) return;
  lastNowPlayingKey = key;

  const artist = envelope.artist?.trim();
  const title = envelope.title?.trim();
  if (!artist || !title) return;

  const tasks: Promise<unknown>[] = [];

  if (settings.lastfmEnabled && settings.lastfmApiKey && settings.lastfmSessionKey) {
    tasks.push(
      lastfmPost('track.updateNowPlaying', {
        artist,
        track: title,
        ...(envelope.album?.trim() ? { album: envelope.album.trim() } : {}),
        ...(envelope.durationSeconds
          ? { duration: String(Math.round(envelope.durationSeconds)) }
          : {}),
      }),
    );
  }

  if (settings.listenbrainzEnabled && settings.listenbrainzToken) {
    tasks.push(listenBrainzSubmit('playing_now', envelope));
  }

  await Promise.allSettled(tasks);
}

/** Scrobble a completed/eligible listen. */
export async function scrobbleTrack(
  envelope: MediaEnvelope,
  listenedMs: number,
  playedAtMs = Date.now(),
): Promise<void> {
  const settings = loadScrobbleSettings();
  if (!settings.lastfmEnabled && !settings.listenbrainzEnabled) return;
  if (isAirGapEnabled() && !getTier34BaseUrl()) return;

  const durationMs = durationMsFromEnvelope(envelope);
  if (!isScrobbleEligible(listenedMs, durationMs)) return;

  const artist = envelope.artist?.trim();
  const title = envelope.title?.trim();
  if (!artist || !title) return;

  const timestamp = unixTimestampSeconds(playedAtMs);
  const tasks: Promise<unknown>[] = [];

  if (settings.lastfmEnabled && settings.lastfmApiKey && settings.lastfmSessionKey) {
    tasks.push(
      lastfmPost('track.scrobble', {
        artist,
        track: title,
        timestamp: String(timestamp),
        ...(envelope.album?.trim() ? { album: envelope.album.trim() } : {}),
        ...(envelope.durationSeconds
          ? { duration: String(Math.round(envelope.durationSeconds)) }
          : {}),
      }),
    );
  }

  if (settings.listenbrainzEnabled && settings.listenbrainzToken) {
    if (isAirGapEnabled()) {
      /* ListenBrainz has no LAN relay yet */
    } else {
      tasks.push(
        fetch(LISTENBRAINZ_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Token ${settings.listenbrainzToken}`,
          },
          body: JSON.stringify({
            listen_type: 'single',
            payload: [
              {
                listened_at: timestamp,
                track_metadata: {
                  artist_name: artist,
                  track_name: title,
                  release_name: envelope.album,
                  additional_info: {
                    duration_ms: durationMs || undefined,
                  },
                },
              },
            ],
          }),
        }),
      );
    }
  }

  await Promise.allSettled(tasks);
  lastNowPlayingKey = '';
}

/** Reset now-playing dedupe when playback stops. */
export function resetScrobbleNowPlaying(): void {
  lastNowPlayingKey = '';
}
