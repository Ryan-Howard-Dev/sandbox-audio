import { useEffect, useState } from 'react';

/** Re-render only when envelope id changes — not on position/volume ticks. */
export function useStableEnvelopeId(envelopeId: string | null | undefined): string | null {
  const next = envelopeId ?? null;
  const [stable, setStable] = useState(next);
  useEffect(() => {
    setStable((prev) => (prev === next ? prev : next));
  }, [next]);
  return stable;
}
