import type { MediaEnvelope } from '../sandboxLayer1';
import { isPodcastEnvelopeId } from '../podcastStorage';

export type HealAttemptKey = string;

export function buildHealAttemptKey(env: MediaEnvelope): HealAttemptKey {
  if (env.provider === 'local-vault' && env.sourceId) {
    return `local:${env.sourceId}`;
  }
  return env.envelopeId;
}

export type HealAction =
  | { kind: 'local-refresh'; sourceId: string }
  | { kind: 'mobile-re-resolve' }
  | { kind: 'tier34-heal' }
  | { kind: 'podcast-retry' }
  | { kind: 'fail' };

export function resolveHealAction(
  env: MediaEnvelope,
  priorAttemptKey: HealAttemptKey | null,
  options?: { mobileResolverActive?: boolean },
): HealAction {
  const key = buildHealAttemptKey(env);
  if (priorAttemptKey === key) return { kind: 'fail' };

  if (isPodcastEnvelopeId(env.envelopeId)) {
    return { kind: 'podcast-retry' };
  }

  if (env.provider === 'local-vault' && env.sourceId) {
    return { kind: 'local-refresh', sourceId: env.sourceId };
  }
  if (env.provider !== 'local-vault') {
    if (options?.mobileResolverActive) {
      return { kind: 'mobile-re-resolve' };
    }
    return { kind: 'tier34-heal' };
  }
  return { kind: 'fail' };
}
