import React from 'react';

export function StationChunkFallback() {
  return (
    <div
      className="flex flex-1 items-center justify-center min-h-[12rem] text-[var(--text-dim)]"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="font-mono text-xs uppercase tracking-widest animate-pulse">
        Loading…
      </span>
    </div>
  );
}
