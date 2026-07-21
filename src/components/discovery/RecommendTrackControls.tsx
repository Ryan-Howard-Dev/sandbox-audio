import React, { useState } from 'react';
import { ChevronDown, ThumbsDown } from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import { recordTasteFeedback } from '../../tasteFeedback';
import { snoozeTrack } from '../../tasteSuppressions';
import WhyPickedPanel from './WhyPickedPanel';
import { LocalOfflineBadge } from './LocalOfflineBadge';

export interface RecommendTrackControlsProps {
  envelope: MediaEnvelope;
  onAction?: () => void;
  /** Inline expandable line (Feed / Sonic Locker rows). */
  variant?: 'compact' | 'inline';
}

export default function RecommendTrackControls({
  envelope,
  onAction,
  variant = 'compact',
}: RecommendTrackControlsProps) {
  const [whyOpen, setWhyOpen] = useState(false);

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

  if (variant === 'inline') {
    return (
      <div className="recommend-track-inline" onClick={(e) => e.stopPropagation()} role="presentation">
        <LocalOfflineBadge envelope={envelope} />
        <button
          type="button"
          className="recommend-why-toggle touch-manipulation"
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
          className="recommend-not-for-me touch-manipulation"
          onClick={handleNotForMe}
        >
          <ThumbsDown className="w-3 h-3" />
          Not for me
        </button>
        {whyOpen ? (
          <div className="recommend-why-panel">
            <WhyPickedPanel envelope={envelope} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="feed-track-actions" onClick={(e) => e.stopPropagation()} role="presentation">
      <LocalOfflineBadge envelope={envelope} />
      <button
        type="button"
        className="feed-track-action-btn touch-manipulation"
        aria-label="Why this song"
        title="Why this song"
        onClick={(e) => {
          e.stopPropagation();
          setWhyOpen((v) => !v);
        }}
      >
        Why?
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
      {whyOpen ? (
        <div className="feed-track-why-popover">
          <WhyPickedPanel envelope={envelope} />
        </div>
      ) : null}
    </div>
  );
}
