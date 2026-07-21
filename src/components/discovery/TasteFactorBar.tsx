import React from 'react';
import type { TasteScoreFactor } from '../../tasteScoring';

export default function TasteFactorBar({ factor }: { factor: TasteScoreFactor }) {
  const pct = Math.max(0, Math.min(100, factor.raw * 100));
  return (
    <div className="taste-factor-bar">
      <div className="taste-factor-bar-head">
        <span className="taste-factor-bar-label">{factor.label}</span>
        <span className="taste-factor-bar-score">{(factor.contribution * 100).toFixed(0)} pts</span>
      </div>
      <div className="taste-factor-bar-track" aria-hidden>
        <div className="taste-factor-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {factor.detail ? <p className="taste-factor-bar-detail">{factor.detail}</p> : null}
    </div>
  );
}
