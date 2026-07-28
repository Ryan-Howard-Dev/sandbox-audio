/**
 * Overcast-style Voice Boost — presence EQ + gentle compression for speech clarity.
 * Runs in the Web Audio graph.
 *
 * The chain is shared with audiobooks, which need firmer settings than podcasts; the numbers live
 * in speechClarity.ts and the class below just builds whichever profile it is handed.
 */

import { Capacitor } from '@capacitor/core';
import { loadPodcastSmartSpeedEnabled, loadPodcastVoiceBoostEnabled } from './podcastSettings';
import { findSubscription, isPodcastEnvelopeId } from './podcastStorage';
import {
  PODCAST_CLARITY,
  dbToLinear,
  highPassHzForRoute,
  type SpeechClarityProfile,
} from './speechClarity';
import type { SonicOutputRoute } from './sandboxSonic';

/** Peaking filter center — vocal presence band. */
export const VOICE_BOOST_PRESENCE_HZ = PODCAST_CLARITY.presenceHz;
export const VOICE_BOOST_PRESENCE_GAIN_DB = PODCAST_CLARITY.presenceGainDb;
export const VOICE_BOOST_PRESENCE_Q = PODCAST_CLARITY.presenceQ;

export const VOICE_BOOST_HIGHPASS_HZ = PODCAST_CLARITY.highPassHz;
export const VOICE_BOOST_COMPRESSOR_THRESHOLD_DB = PODCAST_CLARITY.thresholdDb;
export const VOICE_BOOST_COMPRESSOR_RATIO = PODCAST_CLARITY.ratio;
/** Linear makeup after compression (~1.5 dB). */
export const VOICE_BOOST_MAKEUP_GAIN = dbToLinear(PODCAST_CLARITY.makeupGainDb);

export function resolveVoiceBoostEnabled(feedId: string | null | undefined): boolean {
  if (feedId) {
    const sub = findSubscription(feedId);
    if (sub?.voiceBoostDefault !== undefined) {
      return sub.voiceBoostDefault;
    }
  }
  return loadPodcastVoiceBoostEnabled();
}

export function podcastWebAudioEffectsRequired(envelopeId: string): boolean {
  if (!isPodcastEnvelopeId(envelopeId)) return false;
  // Android: Smart Speed + Voice Boost use native Exo — WebView Web Audio is unreliable on Capacitor.
  if (Capacitor.getPlatform() === 'android') return false;
  if (loadPodcastSmartSpeedEnabled()) return true;
  const parts = envelopeId.split(':');
  const feedId = parts.length >= 3 ? parts[1] : null;
  return resolveVoiceBoostEnabled(feedId);
}

export class PodcastVoiceBoostChain {
  private readonly input: GainNode;
  private readonly output: GainNode;
  private readonly highPass: BiquadFilterNode;
  private readonly presence: BiquadFilterNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly makeup: GainNode;
  private wired = false;
  readonly profile: SpeechClarityProfile;

  constructor(
    private readonly ctx: AudioContext,
    profile: SpeechClarityProfile = PODCAST_CLARITY,
  ) {
    this.profile = profile;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.highPass = ctx.createBiquadFilter();
    this.highPass.type = 'highpass';
    this.highPass.frequency.value = profile.highPassHz;
    this.highPass.Q.value = 0.7;

    this.presence = ctx.createBiquadFilter();
    this.presence.type = 'peaking';
    this.presence.frequency.value = profile.presenceHz;
    this.presence.Q.value = profile.presenceQ;
    this.presence.gain.value = profile.presenceGainDb;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = profile.thresholdDb;
    this.compressor.knee.value = profile.kneeDb;
    this.compressor.ratio.value = profile.ratio;
    this.compressor.attack.value = profile.attackSec;
    this.compressor.release.value = profile.releaseSec;

    this.makeup = ctx.createGain();
    this.makeup.gain.value = dbToLinear(profile.makeupGainDb);

    this.input.connect(this.highPass);
    this.highPass.connect(this.presence);
    this.presence.connect(this.compressor);
    this.compressor.connect(this.makeup);
    this.makeup.connect(this.output);
  }

  getInput(): GainNode {
    return this.input;
  }

  getOutput(): GainNode {
    return this.output;
  }

  setEnabled(_enabled: boolean): void {
    /* routing handled by PlaybackCrossfadeRouter */
  }

  /**
   * Move the rumble filter to suit the output.
   *
   * A phone speaker cannot reproduce what sits below ~200 Hz and only distorts trying, so on that
   * route the corner rises; everywhere else it stays where the profile put it, because the same
   * cut through headphones would thin a male narrator.
   */
  setOutputRoute(route: SonicOutputRoute | null | undefined): void {
    const hz = highPassHzForRoute(this.profile, route);
    if (this.highPass.frequency.value === hz) return;
    try {
      // Ramped rather than assigned: this can change mid-sentence when a listener pulls their
      // headphones out, and a stepped filter corner clicks.
      this.highPass.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.05);
    } catch {
      this.highPass.frequency.value = hz;
    }
  }

  disconnect(): void {
    try {
      this.input.disconnect();
      this.highPass.disconnect();
      this.presence.disconnect();
      this.compressor.disconnect();
      this.makeup.disconnect();
      this.output.disconnect();
    } catch {
      /* ignore */
    }
    this.wired = false;
  }

  dispose(): void {
    this.disconnect();
  }

  isWired(): boolean {
    return this.wired;
  }

  markWired(): void {
    this.wired = true;
  }
}
