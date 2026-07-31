/**
 * What a YouTube stream URL says about its own audio.
 *
 * Online tracks were badged with their transport — "HTTP", "MOBILE" — which names the code path
 * that fetched the bytes rather than anything about how they sound. The fidelity badge sits under
 * the title where a listener looks for quality, so that answer is true and useless.
 *
 * The real answer is already in the URL. YouTube's `itag` identifies an exact encoding: format,
 * codec and a bitrate that does not vary between videos for a given itag. Reading it costs a regex
 * and states a fact rather than an estimate.
 *
 * Deliberately not measured. A progressive itag carries video and audio in one file, so bytes over
 * duration would report the *combined* rate — around 500–700 kbps for itag 18, five to seven times
 * the real audio figure. Overstating fidelity is the one thing this badge must never do, so the
 * numbers here come from the format's definition, not from the file's size.
 */

export interface ItagAudioProfile {
  /** Container/codec as a listener would recognise it. */
  format: string;
  /** Audio bitrate in kbps, from the itag definition. */
  bitrateKbps: number;
  /** True when the stream also carries video the player will decode and discard. */
  progressive: boolean;
}

/**
 * Known itags, audio figures only.
 *
 * Progressive entries quote the audio track alone — the video bitrate is deliberately excluded,
 * because the badge describes what is heard, not what is downloaded.
 */
const ITAG_AUDIO: Record<number, ItagAudioProfile> = {
  // Progressive — video muxed in, audio is the part that matters here.
  17: { format: 'AAC', bitrateKbps: 24, progressive: true },
  18: { format: 'AAC', bitrateKbps: 96, progressive: true },
  22: { format: 'AAC', bitrateKbps: 192, progressive: true },
  43: { format: 'Vorbis', bitrateKbps: 128, progressive: true },
  // Adaptive, audio only.
  139: { format: 'AAC', bitrateKbps: 48, progressive: false },
  140: { format: 'AAC', bitrateKbps: 128, progressive: false },
  141: { format: 'AAC', bitrateKbps: 256, progressive: false },
  171: { format: 'Vorbis', bitrateKbps: 128, progressive: false },
  249: { format: 'Opus', bitrateKbps: 50, progressive: false },
  250: { format: 'Opus', bitrateKbps: 70, progressive: false },
  251: { format: 'Opus', bitrateKbps: 160, progressive: false },
  256: { format: 'AAC', bitrateKbps: 192, progressive: false },
  258: { format: 'AAC', bitrateKbps: 384, progressive: false },
  774: { format: 'Opus', bitrateKbps: 256, progressive: false },
};

/**
 * The itag a stream URL declares, or null.
 *
 * Handles the proxied form too: the app routes playback through a local proxy that base64-encodes
 * the upstream URL, so the itag is not visible in the outer URL at all. Missing it there would
 * silently drop the badge for every proxied track, which is most of them.
 */
export function parseYoutubeItag(url: string | null | undefined): number | null {
  const raw = url?.trim() ?? '';
  if (!raw) return null;

  const direct = readItagParam(raw);
  if (direct != null) return direct;

  // Proxied: /local/proxy/b64/<base64 of the real URL>.
  const encoded = /\/b64\/([A-Za-z0-9+/=_-]+)/.exec(raw);
  if (encoded?.[1]) {
    try {
      const normalised = encoded[1].replace(/-/g, '+').replace(/_/g, '/');
      const decoded =
        typeof atob === 'function'
          ? atob(normalised)
          : Buffer.from(normalised, 'base64').toString('binary');
      return readItagParam(decoded);
    } catch {
      // Not valid base64, or no decoder available — no itag to report, which is a badge we skip
      // rather than a failure.
    }
  }
  return null;
}

function readItagParam(url: string): number | null {
  // Accept both raw and percent-encoded separators; proxied URLs arrive escaped.
  const match = /[?&](?:itag|itag%3D)=?(\d{1,4})\b/.exec(url) ?? /itag(?:=|%3D)(\d{1,4})\b/.exec(url);
  if (!match?.[1]) return null;
  const itag = Number(match[1]);
  return Number.isFinite(itag) && itag > 0 ? itag : null;
}

/** The audio this itag always carries, or null when the itag is unknown to us. */
export function itagAudioProfile(itag: number | null | undefined): ItagAudioProfile | null {
  if (itag == null) return null;
  return ITAG_AUDIO[itag] ?? null;
}

/**
 * Audio profile for a stream URL, or null when nothing can be said.
 *
 * Null rather than a guess: an unrecognised itag means we do not know the bitrate, and inventing
 * one is worse than showing the transport label the badge already falls back to.
 */
export function youtubeStreamAudioProfile(
  url: string | null | undefined,
): ItagAudioProfile | null {
  return itagAudioProfile(parseYoutubeItag(url));
}
