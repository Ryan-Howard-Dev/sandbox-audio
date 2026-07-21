/**
 * Overcast-style Voice Boost — presence EQ + gentle compression for speech clarity.
 * Runs in the Web Audio graph (podcasts only).
 */

import { Capacitor } from '@capacitor/core';
import { loadPodcastSmartSpeedEnabled, loadPodcastVoiceBoostEnabled } from './podcastSettings';
import { findSubscription, isPodcastEnvelopeId } from './podcastStorage';

/** Peaking filter center — vocal presence band. */
export const VOICE_BOOST_PRESENCE_HZ = 2800;
export const VOICE_BOOST_PRESENCE_GAIN_DB = 3.2;
export const VOICE_BOOST_PRESENCE_Q = 1.1;

export const VOICE_BOOST_HIGHPASS_HZ = 85;
export const VOICE_BOOST_COMPRESSOR_THRESHOLD_DB = -22;
export const VOICE_BOOST_COMPRESSOR_RATIO = 2.2;
/** Linear makeup after compression (~1.5 dB). */
export const VOICE_BOOST_MAKEUP_GAIN = 1.18;

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

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.highPass = ctx.createBiquadFilter();
    this.highPass.type = 'highpass';
    this.highPass.frequency.value = VOICE_BOOST_HIGHPASS_HZ;
    this.highPass.Q.value = 0.7;

    this.presence = ctx.createBiquadFilter();
    this.presence.type = 'peaking';
    this.presence.frequency.value = VOICE_BOOST_PRESENCE_HZ;
    this.presence.Q.value = VOICE_BOOST_PRESENCE_Q;
    this.presence.gain.value = VOICE_BOOST_PRESENCE_GAIN_DB;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = VOICE_BOOST_COMPRESSOR_THRESHOLD_DB;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = VOICE_BOOST_COMPRESSOR_RATIO;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.14;

    this.makeup = ctx.createGain();
    this.makeup.gain.value = VOICE_BOOST_MAKEUP_GAIN;

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
