/**
 * Controlling a Chromecast from the server.
 *
 * This exists so the F-Droid build can cast. Google's Cast SDK is proprietary and cannot ship in a
 * build F-Droid will accept, so the phone does not speak the Cast protocol at all: it asks the
 * server to, and the server already sits on the same network with the music on it.
 *
 * That turns out to be the easier arrangement anyway. A Chromecast does not receive a stream, it
 * receives a URL and fetches it — so whatever tells it to play has to be able to serve the file.
 * The phone frequently cannot: the track may only exist in the locker. The server always can, and
 * /api/cast/stream/:trackId was already there doing exactly that for Sonos.
 *
 * Sessions are held per device rather than per request. A cast is a conversation — connect, launch
 * the receiver, load, then play and pause against that same connection — and reconnecting for each
 * button press would relaunch the receiver app and restart the track.
 */

import { Client, DefaultMediaReceiver, type MediaStatus, type Player } from 'castv2-client';
import { chromecastAddress } from './chromecastDiscovery.js';

export interface CastMediaRequest {
  /** Absolute URL the device will fetch. It must be reachable from the device, not from us. */
  streamUrl: string;
  contentType: string;
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  durationSeconds?: number;
  startSeconds?: number;
}

export interface CastSessionState {
  deviceId: string;
  connected: boolean;
  playerState: 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING';
  currentTime: number;
  duration: number;
  title?: string;
}

interface Session {
  client: Client;
  player: Player | null;
  state: CastSessionState;
}

const sessions = new Map<string, Session>();

/** Listeners for state changes, so the client can be told rather than having to poll. */
type StateListener = (state: CastSessionState) => void;
const listeners = new Set<StateListener>();

export function onCastState(listener: StateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(state: CastSessionState): void {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // A listener that throws is a broken subscriber, not a broken cast.
    }
  }
}

/**
 * The metadata a music receiver shows.
 *
 * metadataType 3 is MusicTrackMediaMetadata. The default receiver falls back to a generic layout
 * without it, which shows a filename where the artist should be — the commonest way a cast looks
 * broken while working perfectly.
 */
function buildMedia(request: CastMediaRequest) {
  return {
    contentId: request.streamUrl,
    contentType: request.contentType,
    streamType: 'BUFFERED' as const,
    duration: request.durationSeconds,
    metadata: {
      type: 0,
      metadataType: 3,
      title: request.title,
      artist: request.artist,
      albumName: request.album,
      images: request.artworkUrl ? [{ url: request.artworkUrl }] : undefined,
    },
  };
}

function applyStatus(session: Session, status: MediaStatus | undefined): void {
  if (!status) return;
  session.state = {
    ...session.state,
    playerState: status.playerState ?? session.state.playerState,
    currentTime: typeof status.currentTime === 'number' ? status.currentTime : session.state.currentTime,
    duration: status.media?.duration ?? session.state.duration,
  };
  publish(session.state);
}

/**
 * Open a session, or reuse the one already open for this device.
 *
 * Rejects rather than resolving to null so callers get the reason. "Device not found" and "device
 * refused the connection" need different answers from the UI: the first means rediscover, the
 * second means it is busy or asleep.
 */
async function connect(deviceId: string): Promise<Session> {
  const existing = sessions.get(deviceId);
  if (existing?.state.connected) return existing;

  const address = chromecastAddress(deviceId);
  if (!address) throw new Error(`unknown device ${deviceId}`);

  const client = new Client();
  const session: Session = {
    client,
    player: null,
    state: {
      deviceId,
      connected: false,
      playerState: 'IDLE',
      currentTime: 0,
      duration: 0,
    },
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timed out')), 10_000);
    client.on('error', (err) => {
      clearTimeout(timer);
      // The device went away mid-session. Drop it so the next call reconnects instead of writing
      // into a dead socket.
      session.state = { ...session.state, connected: false };
      publish(session.state);
      sessions.delete(deviceId);
      try {
        client.close();
      } catch {
        // Already closed.
      }
      reject(err ?? new Error('cast connection failed'));
    });
    client.connect({ host: address.host, port: address.port }, () => {
      clearTimeout(timer);
      session.state = { ...session.state, connected: true };
      resolve();
    });
  });

  sessions.set(deviceId, session);
  return session;
}

async function launch(session: Session): Promise<Player> {
  if (session.player) return session.player;
  const player = await new Promise<Player>((resolve, reject) => {
    session.client.launch(DefaultMediaReceiver, (err, p) => {
      if (err || !p) reject(err ?? new Error('could not start the receiver'));
      else resolve(p);
    });
  });
  player.on('status', (status) => applyStatus(session, status));
  session.player = player;
  return player;
}

export async function castPlay(deviceId: string, request: CastMediaRequest): Promise<CastSessionState> {
  const session = await connect(deviceId);
  const player = await launch(session);
  const status = await new Promise<MediaStatus | undefined>((resolve, reject) => {
    player.load(
      buildMedia(request),
      { autoplay: true, currentTime: request.startSeconds },
      (err, s) => (err ? reject(err) : resolve(s)),
    );
  });
  session.state = { ...session.state, title: request.title };
  applyStatus(session, status);
  return session.state;
}

/** Run a command against an existing session. Never opens one: pausing nothing is not an error. */
async function command(
  deviceId: string,
  run: (player: Player, done: (err: Error | null) => void) => void,
): Promise<CastSessionState | null> {
  const session = sessions.get(deviceId);
  if (!session?.player) return null;
  const player = session.player;
  await new Promise<void>((resolve, reject) => {
    run(player, (err) => (err ? reject(err) : resolve()));
  });
  return session.state;
}

export function castPause(deviceId: string): Promise<CastSessionState | null> {
  return command(deviceId, (player, done) => player.pause(done));
}

export function castResume(deviceId: string): Promise<CastSessionState | null> {
  return command(deviceId, (player, done) => player.play(done));
}

export function castSeek(deviceId: string, seconds: number): Promise<CastSessionState | null> {
  return command(deviceId, (player, done) => player.seek(Math.max(0, seconds), done));
}

/**
 * Volume is the device's, not the player's.
 *
 * A Chromecast's volume belongs to the receiver rather than to whatever is playing, so this goes
 * to the client and works even with nothing loaded. Levels are 0..1 over the protocol; anything
 * outside that is clamped rather than rejected, because a UI slider rounding to 1.0000001 should
 * not be an error.
 */
export async function castVolume(deviceId: string, level: number): Promise<void> {
  const session = await connect(deviceId);
  const clamped = Math.min(1, Math.max(0, level));
  await new Promise<void>((resolve, reject) => {
    session.client.setVolume({ level: clamped }, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * End the session and hand the device back.
 *
 * Stopping the player leaves the receiver running and the device showing our idle screen, which
 * looks like the cast is still going. Closing the client is what actually releases it.
 */
export async function castStop(deviceId: string): Promise<void> {
  const session = sessions.get(deviceId);
  if (!session) return;
  try {
    if (session.player) {
      await new Promise<void>((resolve) => session.player!.stop(() => resolve()));
      session.player.removeAllListeners();
    }
  } catch {
    // Stopping a player that already stopped is fine.
  }
  try {
    session.client.removeAllListeners();
    session.client.close();
  } catch {
    // Already closed.
  }
  sessions.delete(deviceId);
  publish({ ...session.state, connected: false, playerState: 'IDLE' });
}

export function castState(deviceId: string): CastSessionState | null {
  return sessions.get(deviceId)?.state ?? null;
}

/** Close every session. Called on shutdown so devices are not left showing our receiver. */
export async function stopAllCastSessions(): Promise<void> {
  await Promise.all(Array.from(sessions.keys()).map((id) => castStop(id)));
}
