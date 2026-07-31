/**
 * Narration as playback, not as an app making noise.
 *
 * Reading a book aloud went straight to the TTS engine and registered nothing with the system, so
 * there was no mini player, no lock screen controls, no pausing from headphones or a car, and the
 * OS treated it as incidental audio it could duck or kill. An audiobook you cannot pause from your
 * pocket is not an audiobook.
 *
 * There is no new session here. MediaPlaybackForegroundService already owns a MediaSessionCompat
 * with transport controls, and BackgroundMediaPlugin already exposes startForeground,
 * updateMetadata and updatePlaybackState. Narration simply uses the one session the app already
 * has, which is also what keeps a book and a track from ever fighting over the lock screen.
 */
import type { NarrationReaderState } from './narrationReader';

export interface NarrationSessionTrack {
  /** Book or document title — what the lock screen shows first. */
  title: string;
  /** Author where the file names one; the narrator's voice otherwise reads as the artist. */
  author?: string;
  /** Cover from the EPUB's own manifest, when it carried one. */
  artworkUrl?: string;
  /** Stable id so a metadata update for the same book is not treated as a new one. */
  documentId: string;
}

interface BackgroundMediaLike {
  startForeground(): Promise<void>;
  stopForeground(): Promise<void>;
  updateMetadata(o: {
    title: string;
    artist: string;
    album?: string;
    artworkUrl?: string;
    envelopeId?: string;
    revision?: number;
  }): Promise<void>;
  updatePlaybackState(o: {
    isPlaying: boolean;
    positionMs?: number;
    durationMs?: number;
    playbackRate?: number;
    revision?: number;
  }): Promise<void>;
}

async function backgroundMedia(): Promise<BackgroundMediaLike | null> {
  try {
    const mod = await import('./backgroundMedia');
    const bm = (mod as unknown as { BackgroundMedia?: BackgroundMediaLike }).BackgroundMedia;
    return bm ?? null;
  } catch {
    return null;
  }
}

/*
 * Monotonic, because metadata and state arrive from different callbacks and the native side keeps
 * the highest revision it has seen. Without it a late state update can undo a newer one.
 */
let revision = 0;
let foregroundHeld = false;
let currentDocumentId: string | null = null;

/** Announce the book to the system and take the foreground, so narration survives the screen off. */
export async function beginNarrationSession(track: NarrationSessionTrack): Promise<void> {
  const bm = await backgroundMedia();
  if (!bm) return;
  revision += 1;
  currentDocumentId = track.documentId;
  try {
    if (!foregroundHeld) {
      await bm.startForeground();
      foregroundHeld = true;
    }
    await bm.updateMetadata({
      title: track.title,
      // The narrator, not a performer. Where the file names an author, that is the truer second line.
      artist: track.author?.trim() || 'Read aloud',
      artworkUrl: track.artworkUrl,
      envelopeId: `narration:${track.documentId}`,
      revision,
    });
  } catch {
    // A missing session must never stop the reading itself.
  }
}

/**
 * Mirror the reader's state onto the session.
 *
 * 'finished' releases the foreground: a completed book holding a permanent notification is the
 * kind of thing users uninstall an app over.
 */
export async function syncNarrationSession(
  state: NarrationReaderState,
  position?: { positionMs: number; durationMs?: number },
): Promise<void> {
  const bm = await backgroundMedia();
  if (!bm) return;
  revision += 1;
  try {
    if (state === 'finished' || state === 'idle') {
      await bm.updatePlaybackState({ isPlaying: false, revision });
      if (foregroundHeld && state === 'finished') {
        await bm.stopForeground();
        foregroundHeld = false;
        currentDocumentId = null;
      }
      return;
    }
    await bm.updatePlaybackState({
      isPlaying: state === 'speaking',
      positionMs: position?.positionMs,
      durationMs: position?.durationMs,
      playbackRate: 1,
      revision,
    });
  } catch {
    // Same rule: the session is a courtesy, the narration is the product.
  }
}

/** Give the foreground back — on unmount, or when the user stops reading. */
export async function endNarrationSession(): Promise<void> {
  const bm = await backgroundMedia();
  if (!bm || !foregroundHeld) return;
  revision += 1;
  try {
    await bm.updatePlaybackState({ isPlaying: false, revision });
    await bm.stopForeground();
  } catch {
    // Nothing to release.
  } finally {
    foregroundHeld = false;
    currentDocumentId = null;
  }
}

/** Which document currently owns the session, if any — so a second reader does not steal it blind. */
export function narrationSessionOwner(): string | null {
  return currentDocumentId;
}
