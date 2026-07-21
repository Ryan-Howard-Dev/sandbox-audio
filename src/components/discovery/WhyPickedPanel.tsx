import React from 'react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import { getSessionVector } from '../../sessionTaste';
import { explainCandidateScore, type TasteScoreBreakdown } from '../../tasteScoring';
import { getTasteProfile } from '../../tasteProfile';
import TasteFactorBar from './TasteFactorBar';

export function explainTrackPick(envelope: MediaEnvelope): TasteScoreBreakdown {
  return explainCandidateScore(envelope, getSessionVector(), getTasteProfile());
}

export default function WhyPickedPanel({
  envelope,
  title = 'Why this song',
}: {
  envelope: MediaEnvelope;
  title?: string;
}) {
  const breakdown = explainTrackPick(envelope);

  if (breakdown.disqualified) {
    return (
      <div className="why-picked-panel">
        <p className="why-picked-title">{title}</p>
        <p className="why-picked-muted">Hidden by taste feedback or snooze.</p>
      </div>
    );
  }

  return (
    <div className="why-picked-panel">
      <p className="why-picked-title">{title}</p>
      <p className="why-picked-score">Match score {(breakdown.total * 100).toFixed(0)}</p>
      <div className="why-picked-factors">
        {breakdown.factors.map((factor) => (
          <div key={factor.id}>
            <TasteFactorBar factor={factor} />
          </div>
        ))}
      </div>
    </div>
  );
}
