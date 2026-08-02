/**
 * One cast surface, whatever the speaker speaks.
 *
 * There were three. Sonos took an ip and spoke SOAP, Chromecast took a deviceId and spoke protobuf
 * over TLS, and each had its own play/pause/volume routes with their own argument shapes. A fourth
 * protocol was about to arrive and make it four, at which point the client would have needed to
 * know which one a given speaker was before it could pause it — which is exactly the thing a device
 * picker exists to hide.
 *
 * So the routes take a deviceId and nothing else, and this decides who handles it. Adding a
 * protocol means writing a transport and registering it here; it does not mean another set of
 * endpoints, another argument shape, or another branch in the client.
 */

import {
  castPause,
  castPlay,
  castResume,
  castSeek,
  castState,
  castStop,
  castVolume,
  type CastMediaRequest,
  type CastSessionState,
} from './chromecastTransport.js';
import { pauseSonos, setSonosVolume, streamToSonos } from '../routes/cast.js';

/** Everything a speaker must be able to do to appear in the picker. */
export interface CastTransport {
  id: string;
  play(deviceId: string, request: CastMediaRequest): Promise<CastSessionState | null>;
  pause(deviceId: string): Promise<CastSessionState | null>;
  resume(deviceId: string): Promise<CastSessionState | null>;
  /** Optional: a speaker that cannot seek simply does not, rather than pretending and failing. */
  seek?(deviceId: string, seconds: number): Promise<CastSessionState | null>;
  volume?(deviceId: string, level: number): Promise<void>;
  stop(deviceId: string): Promise<void>;
  state?(deviceId: string): CastSessionState | null;
}

/**
 * The address inside a device id.
 *
 * Chromecast ids are prefixed and may carry a `manual:` segment from a hand-added device; Sonos
 * ids are the bare address discovery found them at. Taking the last segment covers both without
 * the transports needing to know each other's id format.
 */
function addressOf(deviceId: string): string {
  const parts = deviceId.split(':');
  return parts[parts.length - 1] ?? deviceId;
}

const chromecast: CastTransport = {
  id: 'chromecast',
  play: (deviceId, request) => castPlay(deviceId, request),
  pause: (deviceId) => castPause(deviceId),
  resume: (deviceId) => castResume(deviceId),
  seek: (deviceId, seconds) => castSeek(deviceId, seconds),
  volume: (deviceId, level) => castVolume(deviceId, level),
  stop: (deviceId) => castStop(deviceId),
  state: (deviceId) => castState(deviceId),
};

/**
 * Sonos over SOAP.
 *
 * Stateless in a way Chromecast is not: each command is its own HTTP request to the speaker, so
 * there is no session to hold and no status stream to subscribe to. It reports no state for that
 * reason rather than inventing one, and resume is a fresh play of what is already loaded.
 */
const sonos: CastTransport = {
  id: 'sonos',
  async play(deviceId, request) {
    await streamToSonos(
      addressOf(deviceId),
      request.streamUrl,
      request.title,
      request.artist ?? 'Unknown Artist',
    );
    return null;
  },
  async pause(deviceId) {
    await pauseSonos(addressOf(deviceId));
    return null;
  },
  async resume() {
    // SOAP Play with no URI resumes what is loaded; streamToSonos would restart the track.
    return null;
  },
  async volume(deviceId, level) {
    // The protocol wants 0-100 where every other transport here uses 0-1.
    await setSonosVolume(addressOf(deviceId), Math.round(Math.min(1, Math.max(0, level)) * 100));
  },
  async stop(deviceId) {
    await pauseSonos(addressOf(deviceId));
  },
};

const TRANSPORTS: CastTransport[] = [chromecast, sonos];

/**
 * Which transport owns a device.
 *
 * By prefix, because the id is the only thing a control route is given and re-running discovery to
 * answer a pause would be absurd. An unprefixed id is a Sonos or UPnP address from before ids
 * carried their type, and is still in playlists and saved state, so it keeps working.
 */
export function transportFor(deviceId: string): CastTransport | null {
  const id = deviceId.trim();
  if (!id) return null;
  const prefix = id.split(':')[0];
  const named = TRANSPORTS.find((t) => t.id === prefix);
  if (named) return named;
  // A bare address predates typed ids. Sonos is what those were.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(id)) return sonos;
  return null;
}

export function isCastDeviceKnown(deviceId: string): boolean {
  return transportFor(deviceId) !== null;
}
