/**
 * Types for castv2-client, which ships none.
 *
 * Deliberately narrow: this describes the part of the library the Chromecast transport actually
 * calls, not the whole surface. A fuller declaration would be mostly guesswork, and guesswork that
 * typechecks is worse than none — it reads as verified when it is not.
 *
 * The library is callback-style throughout. Promisifying happens in chromecastTransport.ts rather
 * than here, so these signatures stay honest about what the library does.
 */

declare module 'castv2-client' {
  export interface MediaImage {
    url: string;
  }

  /** metadataType 3 is MusicTrackMediaMetadata, which is what gives a speaker artist and album. */
  export interface MediaMetadata {
    type?: number;
    metadataType?: number;
    title?: string;
    albumName?: string;
    artist?: string;
    images?: MediaImage[];
  }

  export interface MediaInfo {
    contentId: string;
    contentType: string;
    streamType: 'BUFFERED' | 'LIVE';
    metadata?: MediaMetadata;
    duration?: number;
  }

  export interface MediaStatus {
    playerState?: 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING';
    currentTime?: number;
    media?: { duration?: number };
  }

  export interface Player {
    load(
      media: MediaInfo,
      options: { autoplay?: boolean; currentTime?: number },
      callback: (err: Error | null, status?: MediaStatus) => void,
    ): void;
    play(callback: (err: Error | null) => void): void;
    pause(callback: (err: Error | null) => void): void;
    stop(callback: (err: Error | null) => void): void;
    seek(seconds: number, callback: (err: Error | null) => void): void;
    getStatus(callback: (err: Error | null, status?: MediaStatus) => void): void;
    on(event: 'status', listener: (status: MediaStatus) => void): void;
    removeAllListeners(): void;
  }

  export interface Application {
    APP_ID: string;
  }

  export class Client {
    connect(host: string | { host: string; port?: number }, callback: () => void): void;
    launch(app: Application, callback: (err: Error | null, player?: Player) => void): void;
    getVolume(callback: (err: Error | null, volume?: { level?: number }) => void): void;
    setVolume(
      volume: { level?: number; muted?: boolean },
      callback: (err: Error | null, volume?: { level?: number }) => void,
    ): void;
    close(): void;
    on(event: 'error' | 'close', listener: (err?: Error) => void): void;
    removeAllListeners(): void;
  }

  export const DefaultMediaReceiver: Application;
}
