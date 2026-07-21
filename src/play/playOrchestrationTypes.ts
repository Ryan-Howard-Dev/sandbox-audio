import type { CandidateSource, MediaEnvelope } from '../sandboxLayer1';

/** Shared play-tap context passed into orchestration helpers (extracted from shell). */
export type PlayOrchestrationTapContext = {
  env: MediaEnvelope;
  candidates?: CandidateSource[];
  generation: number;
  isStale: () => boolean;
  seedEnvelope: MediaEnvelope;
  seedArtwork?: string;
  loadAutoPlay: boolean;
};

export type PlayOrchestrationLoadOptions = {
  autoPlay?: boolean;
  seamless?: boolean;
  instant?: boolean;
  playToken: number;
  playEnvelopeId: string;
};

export function buildEnvelopeLoadOpts(
  ctx: PlayOrchestrationTapContext,
  extra?: { autoPlay?: boolean; seamless?: boolean; instant?: boolean },
): PlayOrchestrationLoadOptions {
  return {
    autoPlay: extra?.autoPlay ?? ctx.loadAutoPlay,
    seamless: extra?.seamless,
    instant: extra?.instant,
    playToken: ctx.generation,
    playEnvelopeId: ctx.env.envelopeId,
  };
}
