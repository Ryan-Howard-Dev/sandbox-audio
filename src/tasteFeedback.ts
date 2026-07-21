/**
 * Explicit taste feedback (thumbs up/down) — local-only, persisted in taste profile.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { applyLikedPlaylistMutation } from './likedPlaylist';
import {
  getExplicitFeedback,
  getTasteProfile,
  setExplicitFeedbackMap,
  type TasteFeedbackKind,
} from './tasteProfile';

export const TASTE_FEEDBACK_CHANGE_EVENT = 'sandbox-taste-feedback-change';

const feedbackListeners = new Set<() => void>();

function notifyFeedbackChange(): void {
  feedbackListeners.forEach((fn) => fn());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(TASTE_FEEDBACK_CHANGE_EVENT));
  }
}

export function subscribeTasteFeedback(listener: () => void): () => void {
  feedbackListeners.add(listener);
  return () => feedbackListeners.delete(listener);
}

export type RecordTasteFeedbackOptions = {
  envelopeId: string;
  artist?: string;
  album?: string;
  title?: string;
  /** Full envelope snapshot for Liked playlist (catalog / podcast). */
  envelope?: MediaEnvelope;
  kind: TasteFeedbackKind | 'clear';
};

export function recordTasteFeedback(options: RecordTasteFeedbackOptions): TasteFeedbackKind | null {
  const id = options.envelopeId?.trim();
  if (!id) return null;

  const profile = getTasteProfile();
  const explicitFeedback = { ...profile.explicitFeedback };

  if (options.kind === 'clear') {
    delete explicitFeedback[id];
    setExplicitFeedbackMap(explicitFeedback);
    applyLikedPlaylistMutation({ envelopeId: id, kind: 'clear' });
    notifyFeedbackChange();
    return null;
  }

  explicitFeedback[id] = options.kind;
  setExplicitFeedbackMap(explicitFeedback);
  applyLikedPlaylistMutation({
    envelopeId: id,
    kind: options.kind,
    envelope:
      options.envelope ??
      (options.kind === 'like'
        ? {
            envelopeId: id,
            sourceId: id,
            title: options.title ?? '',
            artist: options.artist ?? '',
            album: options.album,
            url: '',
            provider: 'unknown',
            transport: 'element-src',
            durationSeconds: 0,
          }
        : undefined),
  });
  notifyFeedbackChange();
  return options.kind;
}

export function getTrackTasteFeedback(envelopeId: string): TasteFeedbackKind | null {
  return getExplicitFeedback(envelopeId);
}
