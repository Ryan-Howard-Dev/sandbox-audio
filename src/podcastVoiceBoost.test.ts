import { describe, expect, it } from 'vitest';
import {
  VOICE_BOOST_COMPRESSOR_RATIO,
  VOICE_BOOST_COMPRESSOR_THRESHOLD_DB,
  VOICE_BOOST_HIGHPASS_HZ,
  VOICE_BOOST_MAKEUP_GAIN,
  VOICE_BOOST_PRESENCE_GAIN_DB,
  VOICE_BOOST_PRESENCE_HZ,
  podcastWebAudioEffectsRequired,
} from './podcastVoiceBoost';

describe('podcastVoiceBoost', () => {
  it('uses speech-friendly EQ and compression constants', () => {
    expect(VOICE_BOOST_PRESENCE_HZ).toBeGreaterThan(1500);
    expect(VOICE_BOOST_PRESENCE_HZ).toBeLessThan(5000);
    expect(VOICE_BOOST_PRESENCE_GAIN_DB).toBeGreaterThan(0);
    expect(VOICE_BOOST_PRESENCE_GAIN_DB).toBeLessThan(8);
    expect(VOICE_BOOST_HIGHPASS_HZ).toBeGreaterThan(60);
    expect(VOICE_BOOST_COMPRESSOR_RATIO).toBeGreaterThan(1);
    expect(VOICE_BOOST_COMPRESSOR_THRESHOLD_DB).toBeLessThan(0);
    expect(VOICE_BOOST_MAKEUP_GAIN).toBeGreaterThan(1);
  });

  it('requires Web Audio for podcast smart effects', () => {
    expect(podcastWebAudioEffectsRequired('podcast:feed-x:ep-y')).toBe(false);
    expect(podcastWebAudioEffectsRequired('music:track-1')).toBe(false);
  });
});
