/** Minimal Google Cast Web Sender / CAF type declarations. */

declare namespace chrome {
  namespace cast {
    const media: {
      DEFAULT_MEDIA_RECEIVER_APP_ID: string;
      MediaInfo: new (contentId: string, contentType: string) => MediaInfoInstance;
      LoadRequest: new (mediaInfo: MediaInfoInstance) => LoadRequest;
      MusicTrackMediaMetadata: new () => MusicTrackMediaMetadata;
      GenericMediaMetadata: new () => GenericMediaMetadata;
      Image: new (url: string) => MediaImage;
      StreamType: { BUFFERED: string; LIVE: string };
      MetadataType: { MUSIC_TRACK: number; GENERIC: number };
    };

    const AutoJoinPolicy: {
      TAB_AND_ORIGIN_SCOPED: string;
      ORIGIN_SCOPED: string;
      PAGE_SCOPED: string;
    };

    const SessionState: {
      NO_SESSION: string;
      SESSION_STARTING: string;
      SESSION_STARTED: string;
      SESSION_ENDING: string;
      SESSION_ENDED: string;
      SESSION_RESUMED: string;
    };

    interface MediaImage {
      url: string;
      width?: number;
      height?: number;
    }

    interface MediaMetadata {
      metadataType: number;
      title?: string;
      artist?: string;
      albumName?: string;
      images?: MediaImage[];
    }

    interface MusicTrackMediaMetadata extends MediaMetadata {
      songName?: string;
      artistName?: string;
      albumName?: string;
      releaseDate?: string;
    }

    interface GenericMediaMetadata extends MediaMetadata {}

    interface MediaInfoInstance {
      contentId: string;
      contentType: string;
      streamType: string;
      metadata?: MediaMetadata;
      duration?: number;
    }

    interface LoadRequest {
      media: MediaInfoInstance;
      currentTime?: number;
      autoplay?: boolean;
    }

    interface Session {
      sessionId: string;
      receiver: { friendlyName: string; displayName?: string };
      loadMedia(
        loadRequest: LoadRequest,
        successCallback?: () => void,
        errorCallback?: (error: Error) => void,
      ): void;
      sendMessage(
        namespace: string,
        message: unknown,
        successCallback?: () => void,
        errorCallback?: (error: Error) => void,
      ): void;
      stop(
        successCallback?: () => void,
        errorCallback?: (error: Error) => void,
      ): void;
    }

    interface ApiConfig {
      sessionRequest: SessionRequest;
      sessionListener: (session: Session | null) => void;
      receiverListener: (availability: string) => void;
      autoJoinPolicy: string;
    }

    interface SessionRequest {
      appId: string;
      language?: string;
    }

    interface Error {
      code: string | number;
      description?: string;
    }
  }
}

declare namespace cast {
  namespace framework {
    class CastContext {
      static getInstance(): CastContext;
      setOptions(options: CastOptions): void;
      requestSession(): Promise<void>;
      endSession(stopCasting: boolean): void;
      getCurrentSession(): CastSession | null;
      addEventListener(
        type: string,
        handler: (event: CastSessionEvent) => void,
      ): void;
      removeEventListener(
        type: string,
        handler: (event: CastSessionEvent) => void,
      ): void;
    }

    interface CastOptions {
      receiverApplicationId: string;
      autoJoinPolicy: string;
      language?: string;
      resumeSavedSession?: boolean;
    }

    class CastSession {
      getSessionId(): string;
      getSessionState(): string;
      getCastDevice(): CastDevice;
      loadMedia(request: chrome.cast.media.LoadRequest): Promise<RemoteMediaClient>;
      sendMessage(namespace: string, message: unknown): Promise<void>;
      endSession(stopCasting: boolean): void;
    }

    interface CastDevice {
      friendlyName: string;
      deviceId?: string;
    }

    class RemoteMediaClient {
      play(): Promise<void>;
      pause(): Promise<void>;
      seek(options: { currentTime: number }): Promise<void>;
      getMediaStatus(): MediaStatus | null;
      addUpdateListener(listener: (isAlive: boolean) => void): void;
      removeUpdateListener(listener: (isAlive: boolean) => void): void;
    }

    interface MediaStatus {
      playerState: string;
      currentTime: number;
      media?: { contentId: string };
    }

    interface CastSessionEvent {
      sessionState: string;
      session?: CastSession;
    }

    const CastContextEventType: {
      CAST_STATE_CHANGED: string;
      SESSION_STATE_CHANGED: string;
    };

    const SessionState: {
      NO_SESSION: string;
      SESSION_STARTING: string;
      SESSION_STARTED: string;
      SESSION_ENDING: string;
      SESSION_ENDED: string;
      SESSION_RESUMED: string;
    };

    const CastState: {
      NO_DEVICES_AVAILABLE: string;
      NOT_CONNECTED: string;
      CONNECTING: string;
      CONNECTED: string;
    };
  }
}

interface Window {
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
  cast?: typeof cast;
}
