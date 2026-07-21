import type { MediaEnvelope } from '../sandboxLayer1';
import { isAndroid } from '../platformEnv';
import {
  findPlayableLockerEntryForTrack,
  reconcileLockerBlobIntegrity,
  refreshLockerCache,
  resolveLockerEnvelopeForPlayback,
  warmLockerNativePlaybackCache,
} from '../lockerStorage';
import { isNativeExoPlayableUrl } from '../nativeExoLockerBridge';
import { isOfflineUnplayableStreamUrl } from '../nativeExoStreamResolver';
import { isPodcastEnvelopeId } from '../podcastStorage';

/** True when the envelope explicitly references locker audio (not merely a title collision). */
export function envelopeClaimsLocker(env: MediaEnvelope): boolean {
  if (env.provider === 'local-vault') return true;
  const url = env.url?.trim() ?? '';
  const sourceId = env.sourceId?.trim() ?? '';
  if (url.startsWith('blob:')) {
    return sourceId.startsWith('locker-');
  }
  if (/^content:\/\//i.test(url) && url.includes('locker')) return true;
  if (sourceId.startsWith('locker-')) return true;
  const envelopeId = env.envelopeId?.trim() ?? '';
  return envelopeId.startsWith('local-') && sourceId.startsWith('locker-');
}

/** True when play/resume should run locker byte resolution (never for streaming podcasts). */
export function shouldRunLockerPlaybackGate(env: MediaEnvelope): boolean {
  if (isPodcastEnvelopeId(env.envelopeId)) return false;
  const envelopeId = env.envelopeId?.trim() ?? '';
  if (envelopeId.startsWith('audiobook:') || envelopeId.startsWith('audiobook-catalog:')) return false;
  const url = env.url?.trim() ?? '';
  return env.provider === 'local-vault' || !url || url.startsWith('blob:');
}

/** True when a local-vault envelope can load without async locker resolution. */
export function isImmediateLocalPlayable(env: MediaEnvelope): boolean {
  if (env.provider !== 'local-vault') return false;
  const url = env.url?.trim() ?? '';
  if (!url || isOfflineUnplayableStreamUrl(url)) return false;
  if (isAndroid()) {
    return isNativeExoPlayableUrl(url);
  }
  return true;
}

export type LockerPlayableResult =
  | { kind: 'playable'; envelope: MediaEnvelope }
  | { kind: 'missing-audio' }
  | { kind: 'not-locker' };

/**
 * Resolve locker / playlist locker refs to an Exo-safe envelope (content:// on Android).
 * Detects metadata-only locker rows (stale blob URL, empty IDB).
 */
async function resolvePlayableLockerEnvelope(
  env: MediaEnvelope,
): Promise<MediaEnvelope | null> {
  const stripped = { ...env, url: env.url?.startsWith('blob:') ? '' : env.url };

  let resolved = await resolveLockerEnvelopeForPlayback(stripped);
  if (resolved?.url?.trim()) return resolved;

  await refreshLockerCache({ hard: true });
  resolved = await resolveLockerEnvelopeForPlayback(stripped);
  if (resolved?.url?.trim()) return resolved;

  await reconcileLockerBlobIntegrity();
  await warmLockerNativePlaybackCache();
  resolved = await resolveLockerEnvelopeForPlayback(stripped);
  if (resolved?.url?.trim()) return resolved;

  const playableEntry = await findPlayableLockerEntryForTrack(
    env.title,
    env.artist,
    env.album,
  );
  if (playableEntry) {
    resolved = await resolveLockerEnvelopeForPlayback({
      ...stripped,
      provider: 'local-vault',
      sourceId: playableEntry.id,
      url: '',
    });
    if (resolved?.url?.trim()) return resolved;
  }

  return null;
}

export async function ensureLockerPlayable(
  env: MediaEnvelope,
): Promise<LockerPlayableResult> {
  if (!envelopeClaimsLocker(env)) return { kind: 'not-locker' };

  const resolved = await resolvePlayableLockerEnvelope(env);
  if (resolved?.url?.trim()) {
    if (isAndroid() && resolved.url.startsWith('blob:')) {
      return { kind: 'missing-audio' };
    }
    return { kind: 'playable', envelope: resolved };
  }

  return { kind: 'missing-audio' };
}
