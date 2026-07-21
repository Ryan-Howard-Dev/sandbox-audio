import React, { useState } from 'react';
import { Ban, ChevronDown, Clock, ThumbsDown } from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import { recordTasteFeedback } from '../../tasteFeedback';
import { lessLikeArtist, lessLikeTrack, snoozeTrack } from '../../tasteSuppressions';
import WhyPickedPanel from './WhyPickedPanel';
import { LocalOfflineBadge } from './LocalOfflineBadge';

export interface FeedDiscoverTrackActionsProps {
  envelope: MediaEnvelope;
  onAction?: () => void;
}

export default function FeedDiscoverTrackActions({
  envelope,
  onAction,
}: FeedDiscoverTrackActionsProps) {
  const [whyOpen, setWhyOpen] = useState(false);

  const handleSnooze = (e: React.MouseEvent) => {
    e.stopPropagation();
    snoozeTrack(envelope.envelopeId);
    onAction?.();
  };

  const handleLess = (e: React.MouseEvent) => {
    e.stopPropagation();
    lessLikeTrack(envelope.envelopeId);
    if (envelope.artist) lessLikeArtist(envelope.artist);
    onAction?.();
  };

  const handleNotForMe = (e: React.MouseEvent) => {
    e.stopPropagation();
    recordTasteFeedback({
      envelopeId: envelope.envelopeId,
      artist: envelope.artist,
      album: envelope.album,
      title: envelope.title,
      envelope,
      kind: 'dislike',
    });
    snoozeTrack(envelope.envelopeId, 30);
    onAction?.();
  };

  return (
    <div className="feed-track-actions" onClick={(e) => e.stopPropagation()} role="presentation">
      <LocalOfflineBadge envelope={envelope} />
      <button
        type="button"
        className="feed-track-why-toggle touch-manipulation"
        aria-expanded={whyOpen}
        onClick={(e) => {
          e.stopPropagation();
          setWhyOpen((v) => !v);
        }}
      >
        Why this song?
        <ChevronDown className={`w-3 h-3 transition-transform${whyOpen ? ' rotate-180' : ''}`} />
      </button>
      <button
        type="button"
        className="feed-track-action-btn touch-manipulation"
        aria-label="Not for me"
        title="Not for me"
        onClick={handleNotForMe}
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        className="feed-track-action-btn touch-manipulation"
        aria-label="Snooze 30 days"
        title="Snooze 30 days"
        onClick={handleSnooze}
      >
        <Clock className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        className="feed-track-action-btn touch-manipulation"
        aria-label="Less like this"
        title="Less like this"
        onClick={handleLess}
      >
        <Ban className="w-3.5 h-3.5" />
      </button>
      {whyOpen ? (
        <div className="feed-track-why-panel">
          <WhyPickedPanel envelope={envelope} />
        </div>
      ) : null}
    </div>
  );
}
