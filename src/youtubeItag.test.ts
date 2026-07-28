// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { itagAudioProfile, parseYoutubeItag, youtubeStreamAudioProfile } from './youtubeItag';

/** A real resolved URL from the device log, trimmed. */
const REAL =
  'https://rr4---sn-5np5po4v-c33z6.googlevideo.com/videoplayback?expire=1785261597&ei=vZloatTz&itag=18&source=youtube&mime=video%2Fmp4';

describe('parseYoutubeItag', () => {
  it('reads the itag from a real resolved URL', () => {
    expect(parseYoutubeItag(REAL)).toBe(18);
  });

  it('reads it through the local proxy that base64-wraps the upstream URL', () => {
    // Most playback URLs arrive proxied. Missing this would drop the badge for nearly every track.
    const proxied = `http://127.0.0.1:28765/local/proxy/b64/${btoa(REAL)}`;
    expect(parseYoutubeItag(proxied)).toBe(18);
  });

  it('handles base64url padding variants from the proxy', () => {
    const b64url = btoa(REAL).replace(/\+/g, '-').replace(/\//g, '_');
    expect(parseYoutubeItag(`http://127.0.0.1:28765/local/proxy/b64/${b64url}`)).toBe(18);
  });

  it('returns null when there is no itag to read', () => {
    expect(parseYoutubeItag('https://example.test/song.mp3')).toBeNull();
    expect(parseYoutubeItag('')).toBeNull();
    expect(parseYoutubeItag(null)).toBeNull();
    expect(parseYoutubeItag(undefined)).toBeNull();
  });

  it('does not throw on malformed proxy payloads', () => {
    expect(() => parseYoutubeItag('http://127.0.0.1/local/proxy/b64/!!!notbase64!!!')).not.toThrow();
    expect(parseYoutubeItag('http://127.0.0.1/local/proxy/b64/zzzz')).toBeNull();
  });
});

describe('itagAudioProfile', () => {
  it('reports the audio of a progressive stream, not the file', () => {
    /*
     * itag 18 is 360p video with a 96 kbps AAC track. Measuring bytes over duration would report
     * 500-700 kbps — the combined rate — and overstate fidelity five- to sevenfold. The badge must
     * describe what is heard.
     */
    expect(itagAudioProfile(18)).toEqual({ format: 'AAC', bitrateKbps: 96, progressive: true });
  });

  it('recognises the adaptive audio-only formats', () => {
    expect(itagAudioProfile(140)).toMatchObject({ format: 'AAC', bitrateKbps: 128, progressive: false });
    expect(itagAudioProfile(251)).toMatchObject({ format: 'Opus', bitrateKbps: 160, progressive: false });
    expect(itagAudioProfile(141)).toMatchObject({ bitrateKbps: 256 });
  });

  it('returns null for an itag it does not know', () => {
    // Inventing a number is worse than falling back to the transport label.
    expect(itagAudioProfile(9999)).toBeNull();
    expect(itagAudioProfile(null)).toBeNull();
  });

  it('never claims a progressive stream is lossless-grade', () => {
    for (const itag of [17, 18, 22, 43]) {
      expect(itagAudioProfile(itag)!.bitrateKbps).toBeLessThan(320);
      expect(itagAudioProfile(itag)!.progressive).toBe(true);
    }
  });
});

describe('youtubeStreamAudioProfile', () => {
  it('answers end to end for the stream the app actually plays', () => {
    expect(youtubeStreamAudioProfile(REAL)).toMatchObject({ format: 'AAC', bitrateKbps: 96 });
  });

  it('says nothing about a stream it cannot identify', () => {
    expect(youtubeStreamAudioProfile('https://archive.org/download/x/y.flac')).toBeNull();
  });
});
