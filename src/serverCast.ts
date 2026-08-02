/**
 * Casting through Sandbox Server, for builds with no Cast SDK in them.
 *
 * The F-Droid build cannot contain play-services-cast-framework, so it registers no NativeCast
 * plugin and casting would simply be absent. It does not have to be: the server is already on the
 * same network, already holds the music, and already casts to Sonos and UPnP renderers. Teaching
 * it Chromecast puts the feature back without putting Google's code in the APK.
 *
 * It talks to one cast surface rather than a per-protocol one: the server works out from the
 * device id whether that speaker is a Chromecast, a Sonos or something later, so nothing here
 * needs to know. See tier34-server/lib/castTransports.ts.
 *
 * This deliberately mirrors the native plugin's shape rather than inventing a second one, so
 * castTransport can pick between them and everything above stays unaware of which is in use.
 *
 * One difference is real and worth stating: the server has to be running and reachable. Casting to
 * a speaker on your network already required being on that network, so the loss is narrower than
 * it sounds, but a phone on mobile data cannot cast this way.
 */

import type { NativeCastQueueItem, NativeCastResult, NativeCastSessionState } from './nativeCast';

/** Devices as /api/cast/discover returns them. */
export interface ServerCastDevice {
  id: string;
  name: string;
  ip: string;
  type: 'upnp' | 'sonos' | 'remote_cast' | 'chromecast';
}

interface CastSessionPayload {
  deviceId: string;
  connected: boolean;
  playerState: 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING';
  currentTime: number;
  duration: number;
  title?: string;
}

let baseUrl = '';
let selectedDevice: ServerCastDevice | null = null;
let events: EventSource | null = null;

const listeners = new Set<(state: NativeCastSessionState) => void>();
let sessionState: NativeCastSessionState = {
  connected: false,
  deviceName: null,
  sessionState: 'NO_SESSION',
};

function publish(): void {
  for (const listener of listeners) listener({ ...sessionState });
}

/** Point this at the server. Called by castTransport once tier34 has been located. */
export function configureServerCast(url: string): void {
  baseUrl = (url ?? '').trim().replace(/\/+$/, '');
}

export function isServerCastConfigured(): boolean {
  return baseUrl !== '';
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  if (!baseUrl) return null;
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Every device the server can reach, of every transport it speaks. */
export async function discoverServerCastDevices(): Promise<ServerCastDevice[]> {
  if (!baseUrl) return [];
  try {
    const response = await fetch(`${baseUrl}/api/cast/discover`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { devices?: ServerCastDevice[] };
    return payload.devices ?? [];
  } catch {
    return [];
  }
}

/**
 * Follow the device's own reports of where it is.
 *
 * Position comes from the Chromecast rather than from a timer here, which is the point of doing it
 * this way: a progress bar driven by a local clock drifts against a device that buffered, and ends
 * up showing a position the speaker left thirty seconds ago.
 */
function openEventStream(): void {
  if (!baseUrl || events || typeof EventSource === 'undefined') return;
  try {
    events = new EventSource(`${baseUrl}/api/cast/chromecast/events`);
    events.onmessage = (message) => {
      try {
        const state = JSON.parse(message.data) as CastSessionPayload;
        if (selectedDevice && state.deviceId !== selectedDevice.id) return;
        sessionState = {
          connected: state.connected,
          deviceName: selectedDevice?.name ?? null,
          sessionState: state.connected ? 'STARTED' : 'ENDED',
        };
        publish();
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };
    events.onerror = () => {
      // EventSource reconnects on its own. Closing here would turn a blip into a dead stream.
    };
  } catch {
    events = null;
  }
}

function closeEventStream(): void {
  try {
    events?.close();
  } catch {
    // Already closed.
  }
  events = null;
}

export function subscribeServerCastSession(
  handler: (state: NativeCastSessionState) => void,
): () => void {
  listeners.add(handler);
  handler({ ...sessionState });
  return () => listeners.delete(handler);
}

export function getServerCastSessionState(): NativeCastSessionState {
  return { ...sessionState };
}

/** Choose the device to cast to. The picker lives in the UI; this records the answer. */
export function selectServerCastDevice(device: ServerCastDevice | null): void {
  selectedDevice = device;
  if (device) {
    openEventStream();
    sessionState = { connected: true, deviceName: device.name, sessionState: 'STARTED' };
  } else {
    closeEventStream();
    sessionState = { connected: false, deviceName: null, sessionState: 'ENDED' };
  }
  publish();
}

export function getSelectedServerCastDevice(): ServerCastDevice | null {
  return selectedDevice;
}

export async function endServerCastSession(): Promise<void> {
  if (selectedDevice) await post('/api/cast/stop', { deviceId: selectedDevice.id });
  selectServerCastDevice(null);
}

export interface ServerCastPlayback {
  trackId?: string;
  streamUrl?: string;
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  isPlaying: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
  queue?: NativeCastQueueItem[];
  queueIndex?: number;
}

/** What is currently loaded, so play/pause does not reload a track that is already on the device. */
let loadedKey = '';

/**
 * Mirror local playback onto the device.
 *
 * Loading and transport control are separated on purpose. Sending the media again for a pause
 * would restart the track, and the commonest way a cast implementation feels broken is a play
 * button that jumps back to zero.
 */
export async function syncServerCastPlayback(payload: ServerCastPlayback): Promise<void> {
  const device = selectedDevice;
  if (!device) return;

  const key = payload.trackId ?? payload.streamUrl ?? payload.title;
  if (key !== loadedKey) {
    const result = await post<{ ok: boolean }>('/api/cast/play', {
      deviceId: device.id,
      trackId: payload.trackId,
      streamUrl: payload.streamUrl,
      title: payload.title,
      artist: payload.artist,
      album: payload.album,
      artworkUrl: payload.artworkUrl,
      durationSeconds: payload.durationSeconds,
      startSeconds: payload.currentTimeSeconds,
    });
    if (result?.ok) loadedKey = key;
    return;
  }

  await post(payload.isPlaying ? '/api/cast/resume' : '/api/cast/pause', {
    deviceId: device.id,
  });
}

export async function seekServerCast(seconds: number): Promise<void> {
  if (!selectedDevice) return;
  await post('/api/cast/seek', { deviceId: selectedDevice.id, seconds });
}

export async function setServerCastVolume(level: number): Promise<void> {
  if (!selectedDevice) return;
  await post('/api/cast/volume', { deviceId: selectedDevice.id, level });
}

/** Probe for a usable server. Cheap enough to call when the cast button is first shown. */
export async function probeServerCast(): Promise<NativeCastResult> {
  if (!baseUrl) return { ok: false, error: 'No Sandbox Server configured', code: 'unconfigured' };
  try {
    const response = await fetch(`${baseUrl}/api/cast/discover`, {
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? { ok: true } : { ok: false, error: 'Server did not answer', code: 'unreachable' };
  } catch {
    return { ok: false, error: 'Sandbox Server could not be reached', code: 'unreachable' };
  }
}
