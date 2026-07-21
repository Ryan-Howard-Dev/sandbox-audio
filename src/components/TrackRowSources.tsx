import React, { useEffect, useMemo, useState } from 'react';
import type { CandidateSource, MediaEnvelope } from '../sandboxLayer1';
import { resolveMediaEnvelope } from '../sandboxLayer1';
import {
  envelopeSourceToCandidate,
  rankSourceQuality,
  sortCandidatesByFidelity,
} from '../fidelityPolicy';
import { displayTransportLabel } from '../displaySanitize';
import { getTier34BaseUrl, tier34EnvelopeSources, type EnvelopeSource } from '../tier34/client';
import LockerMoreMenu, { type LockerMenuAction } from './LockerMoreMenu';
import { themeBadgeOutlineClass } from '../stations/theme';

export type TrackRowSourcesProps = {
  envelopeId: string;
  title: string;
  /** Pre-loaded candidates (search hits). When omitted, fetched from tier34. */
  candidates?: CandidateSource[];
  /** Base envelope for play — url/provider overridden by selected source. */
  baseEnvelope: MediaEnvelope;
  onPlay: (env: MediaEnvelope, candidates?: CandidateSource[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alwaysVisible?: boolean;
};

function resolvePlayUrl(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return `${getTier34BaseUrl().replace(/\/$/, '')}${trimmed}`;
  }
  return trimmed;
}

function envelopeSourceToCandidateSource(source: EnvelopeSource): CandidateSource {
  return envelopeSourceToCandidate(source);
}

function buildEnvelopeFromSource(
  base: MediaEnvelope,
  source: EnvelopeSource,
  candidate: CandidateSource,
): MediaEnvelope {
  const uri = source.uri?.trim() || `/api/locker/blob/${source.contentHash}`;
  return {
    ...base,
    envelopeId: source.envelopeId || base.envelopeId,
    url: resolvePlayUrl(uri),
    provider: candidate.provider,
    transport: candidate.transport,
    sourceId: String(source.id),
    mimeType: candidate.mimeType,
  };
}

export default function TrackRowSources({
  envelopeId,
  title,
  candidates: candidatesProp,
  baseEnvelope,
  onPlay,
  open,
  onOpenChange,
  alwaysVisible = false,
}: TrackRowSourcesProps) {
  const [fetchedSources, setFetchedSources] = useState<EnvelopeSource[] | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  useEffect(() => {
    if (candidatesProp?.length) return;
    let cancelled = false;
    void tier34EnvelopeSources(envelopeId).then((sources) => {
      if (!cancelled) setFetchedSources(sources);
    });
    return () => {
      cancelled = true;
    };
  }, [envelopeId, candidatesProp?.length]);

  const candidates = useMemo((): CandidateSource[] => {
    if (candidatesProp?.length) {
      return sortCandidatesByFidelity(candidatesProp);
    }
    const ranked = rankSourceQuality(fetchedSources ?? []);
    return ranked.map(envelopeSourceToCandidateSource);
  }, [candidatesProp, fetchedSources]);

  const audioCandidates = useMemo(
    () =>
      candidates.filter((c) => {
        const uri = (c.uri ?? '').toLowerCase();
        return !uri.includes('/cover') && !uri.endsWith('.jpg') && !uri.endsWith('.png');
      }),
    [candidates],
  );

  const defaultCandidate = audioCandidates[0] ?? null;

  useEffect(() => {
    if (!defaultCandidate) return;
    setSelectedSourceId((prev) => prev ?? defaultCandidate.id);
  }, [defaultCandidate?.id]);

  const selectedCandidate = useMemo(() => {
    if (!audioCandidates.length) return null;
    return (
      audioCandidates.find((c) => c.id === selectedSourceId) ?? audioCandidates[0]
    );
  }, [audioCandidates, selectedSourceId]);

  if (audioCandidates.length <= 1) return null;

  const actions: LockerMenuAction[] = audioCandidates.map((source) => {
    const label = displayTransportLabel(source.provider, source.transport, source.uri);
    const active = source.id === selectedCandidate?.id;
    return {
      id: `source-${source.id}`,
      label: active ? `✓ ${label}` : label,
      onClick: () => {
        setSelectedSourceId(source.id);
        onOpenChange(false);
        try {
          const env = resolveMediaEnvelope(audioCandidates, source.id);
          onPlay({ ...baseEnvelope, ...env, title: baseEnvelope.title }, audioCandidates);
        } catch {
          onPlay(baseEnvelope, audioCandidates);
        }
      },
    };
  });

  const activeLabel = selectedCandidate
    ? displayTransportLabel(
        selectedCandidate.provider,
        selectedCandidate.transport,
        selectedCandidate.uri,
      )
    : 'Sources';

  return (
    <div className="flex items-center gap-1 shrink-0">
      <span
        className={`search-results-badge search-results-badge--transport hidden sm:inline ${themeBadgeOutlineClass}`}
        title={`${audioCandidates.length} sources`}
      >
        {activeLabel}
      </span>
      <LockerMoreMenu
        open={open}
        onOpenChange={onOpenChange}
        actions={actions}
        ariaLabel={`Sources for ${title}`}
        align="right"
        portaled
        alwaysVisible={alwaysVisible}
        panelClassName="catalog-download-menu-panel"
      />
    </div>
  );
}

/** Resolve play envelope using tier34 sources when available. */
export function resolvePlayEnvelopeWithSources(
  base: MediaEnvelope,
  sources: EnvelopeSource[],
  selectedSourceId?: string | null,
): MediaEnvelope {
  const ranked = rankSourceQuality(sources);
  const audio = ranked.filter((s) => {
    const uri = (s.uri ?? '').toLowerCase();
    return !uri.includes('/cover');
  });
  if (audio.length === 0) return base;
  const pick =
    audio.find((s) => String(s.id) === selectedSourceId) ??
    audio[0];
  const candidate = envelopeSourceToCandidate(pick);
  return buildEnvelopeFromSource(base, pick, candidate);
}
