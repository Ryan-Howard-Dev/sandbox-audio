/**
 * Sandbox Sonic — sovereign on-device DSP (Web Audio).
 *
 * ## Architecture
 *
 * ```
 * HTMLAudioElement
 *   → MediaElementSource
 *   → ReplayGain (track loudness, EBU -14 LUFS proxy when metadata missing)
 *   → Sandbox Sonic chain (this module, when enabled)
 *       → Device-profile EQ (route-aware biquads + optional crossfeed)
 *       → Sandbox Spatial widener (headphones / BT, optional)
 *       → BT gentle compressor (bluetooth route only)
 *       → Soft limiter (-1.0 dBTP ceiling, slow release)
 *       → Ear-safety gain (session exposure cap — see earSafety.ts)
 *   → Master volume (user slider)
 *   → destination
 * ```
 *
 * ## Route detection
 * - **Android**: `BackgroundMediaPlugin.getAudioOutputRoute()` → speaker / BT / wired
 * - **Android TV / HDMI WebView**: `detectTVPlatform()` → cinema EQ
 * - **Desktop browser / Tauri (audiophile off)**: laptop UA heuristic or unknown; use manual override
 * - **Linux Tauri**: same Web Audio Sonic chain as Windows; manual override is the primary path
 * - **Web**: `devicechange` + output label heuristics for wired headphones when available
 *
 * ## Manual override (Settings → Playback → Sandbox Sonic)
 * `sandbox_sonic_output_override_v1`: auto | speaker | headphones | line-out
 * Maps speaker → PC speakers on desktop, phone speaker on Android; line-out is flat/neutral.
 *
 * ## Bypass paths (no Web Audio DSP)
 * - Web Audio graph init failure → falls back to element.volume
 * - **Tauri audiophile mode ON** → native WASAPI (Windows) or cpal/ALSA/PipeWire (Linux).
 * - **External cast receivers** (Alexa skill, Sonos app, etc.) → out of scope; in-app cast
 *   from phone applies DSP **before** the stream URL is sent to the receiver
 *
 * All processing stays on-device; nothing is uploaded.
 */

import {
  getAndroidAudioOutputRoute,
  isAndroidBackgroundMediaAvailable,
  type AndroidAudioOutputRoute,
} from './backgroundMedia';
import { detectTVPlatform } from './tvDetection';
import { isTauri } from './platformEnv';
import {
  loadSandboxSonicEnabled,
  loadSandboxSpatialEnabled,
  loadSandboxSpatialWidth,
  loadSonicOutputOverride,
  loadSonicPeqPresetId,
  type SonicOutputOverride,
} from './sandboxSettings';
import {
  EAR_SAFETY_MIN_GAIN,
  getEarSafetyGain,
  resetEarSafetySession,
  tickEarSafety,
} from './earSafety';
import { updatePlaybackDiagnostics } from './playbackDiagnostics';
import type { SonicEqBand } from './sonicEqTypes';
import { resolvePlaybackEqBands } from './sonicPeqPresets';
import {
  createSpatialWidener,
  isHeadphoneSonicRoute,
  type SpatialWidener,
} from './sandboxSpatial';

export type SonicOutputRoute =
  | 'phone-speaker'
  | 'wired-headphones'
  | 'bluetooth'
  | 'tv-hdmi'
  | 'laptop'
  | 'pc-speaker'
  | 'line-out'
  | 'unknown';

export interface SonicRouteResolution {
  effectiveRoute: SonicOutputRoute;
  autoRoute: SonicOutputRoute;
  override: SonicOutputOverride;
  isManual: boolean;
}

const LIMITER_CEILING_DB = -1.0;

let cachedRoute: SonicOutputRoute = 'unknown';
let cachedAutoRoute: SonicOutputRoute = 'unknown';
let webHeadphoneHint = false;

function mapAndroidRoute(route: AndroidAudioOutputRoute): SonicOutputRoute {
  switch (route) {
    case 'speaker':
      return 'phone-speaker';
    case 'bluetooth':
      return 'bluetooth';
    case 'wired':
      return 'wired-headphones';
    default:
      return 'unknown';
  }
}

function detectWebHeadphonesFromLabels(labels: string[]): boolean {
  return labels.some((label) =>
    /headphone|headset|earbud|airpod|in-ear|wired/i.test(label),
  );
}

function initWebOutputListener(): void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
  const refresh = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      webHeadphoneHint = detectWebHeadphonesFromLabels(
        devices.filter((d) => d.kind === 'audiooutput').map((d) => d.label),
      );
    } catch {
      /* ignore */
    }
  };
  void refresh();
  navigator.mediaDevices.addEventListener('devicechange', () => {
    void refresh();
  });
}

if (typeof window !== 'undefined') {
  initWebOutputListener();
}

function isDesktopPlaybackEnvironment(): boolean {
  if (isTauri()) return true;
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return (
    /macintosh|windows nt|cros|linux x86|linux/i.test(ua) &&
    !/mobile|android.*mobile|iphone|ipad|ipod/i.test(ua)
  );
}

function isLaptopUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return /macintosh|windows nt|cros|linux x86|linux/i.test(ua) && !/mobile|android/i.test(ua);
}

function mapOverrideToRoute(
  override: SonicOutputOverride,
  autoRoute: SonicOutputRoute,
): SonicOutputRoute {
  switch (override) {
    case 'auto':
      return autoRoute;
    case 'headphones':
      return 'wired-headphones';
    case 'line-out':
      return 'line-out';
    case 'speaker':
      if (isDesktopPlaybackEnvironment()) return 'pc-speaker';
      if (isAndroidBackgroundMediaAvailable()) return 'phone-speaker';
      if (isLaptopUserAgent()) return 'laptop';
      return 'pc-speaker';
    default:
      return autoRoute;
  }
}

/** Auto-detected route before manual override. */
async function detectSonicOutputRouteAuto(): Promise<SonicOutputRoute> {
  if (isAndroidBackgroundMediaAvailable()) {
    const androidRoute = await getAndroidAudioOutputRoute();
    return mapAndroidRoute(androidRoute);
  }

  if (detectTVPlatform()) {
    return 'tv-hdmi';
  }

  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    if (/macintosh|windows nt|cros|linux x86|linux/i.test(ua) && !/mobile|android/i.test(ua)) {
      return 'laptop';
    }
  }

  if (webHeadphoneHint) {
    return 'wired-headphones';
  }

  return 'unknown';
}

/** Resolve the EQ preset key for the current output path (auto + manual override). */
export async function detectSonicOutputRoute(): Promise<SonicOutputRoute> {
  const autoRoute = await detectSonicOutputRouteAuto();
  cachedAutoRoute = autoRoute;
  const override = loadSonicOutputOverride();
  cachedRoute = mapOverrideToRoute(override, autoRoute);
  return cachedRoute;
}

export function getCachedSonicOutputRoute(): SonicOutputRoute {
  return cachedRoute;
}

export function getCachedSonicAutoRoute(): SonicOutputRoute {
  return cachedAutoRoute;
}

export function getSonicRouteResolution(): SonicRouteResolution {
  const override = loadSonicOutputOverride();
  return {
    effectiveRoute: cachedRoute,
    autoRoute: cachedAutoRoute,
    override,
    isManual: override !== 'auto',
  };
}

export function formatSonicOutputRoute(route: SonicOutputRoute): string {
  switch (route) {
    case 'phone-speaker':
      return 'Phone speaker';
    case 'wired-headphones':
      return 'Wired headphones';
    case 'bluetooth':
      return 'Bluetooth';
    case 'tv-hdmi':
      return 'TV / HDMI';
    case 'laptop':
      return 'Laptop speakers';
    case 'pc-speaker':
      return 'PC speakers';
    case 'line-out':
      return 'Line out';
    default:
      return 'Unknown';
  }
}

type EqBand = SonicEqBand;

function createBiquad(ctx: AudioContext, band: EqBand): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = band.type;
  node.frequency.value = band.frequency;
  if (band.gainDb != null) node.gain.value = band.gainDb;
  if (band.Q != null) node.Q.value = band.Q;
  return node;
}

/** Simple crossfeed to reduce ear fatigue on wide stereo (wired headphones). */
function createCrossfeed(ctx: AudioContext): {
  input: AudioNode;
  output: AudioNode;
} {
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const mix = 0.28;

  const ll = ctx.createGain();
  ll.gain.value = 1;
  const lr = ctx.createGain();
  lr.gain.value = mix;
  const rl = ctx.createGain();
  rl.gain.value = mix;
  const rr = ctx.createGain();
  rr.gain.value = 1;

  splitter.connect(ll, 0);
  splitter.connect(lr, 1);
  splitter.connect(rl, 0);
  splitter.connect(rr, 1);

  const leftSum = ctx.createGain();
  leftSum.gain.value = 1;
  const rightSum = ctx.createGain();
  rightSum.gain.value = 1;

  ll.connect(leftSum);
  lr.connect(leftSum);
  rl.connect(rightSum);
  rr.connect(rightSum);

  leftSum.connect(merger, 0, 0);
  rightSum.connect(merger, 0, 1);

  return { input: splitter, output: merger };
}

function createSoftLimiter(ctx: AudioContext): DynamicsCompressorNode {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER_CEILING_DB;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  return limiter;
}

function createBtCompressor(ctx: AudioContext): DynamicsCompressorNode {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 6;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.006;
  comp.release.value = 0.12;
  return comp;
}

export class SandboxSonicChain {
  private ctx: AudioContext;
  private input: GainNode;
  private output: GainNode;
  private earSafetyGain: GainNode;
  private limiter: DynamicsCompressorNode;
  private eqNodes: AudioNode[] = [];
  private crossfeed: { input: AudioNode; output: AudioNode } | null = null;
  private spatial: SpatialWidener | null = null;
  private btCompressor: DynamicsCompressorNode | null = null;
  private route: SonicOutputRoute = 'unknown';
  private enabled = true;
  private userVolume = 0.8;
  private isPlaying = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.earSafetyGain = ctx.createGain();
    this.limiter = createSoftLimiter(ctx);
    this.input.connect(this.limiter);
    this.limiter.connect(this.earSafetyGain);
    this.earSafetyGain.connect(this.output);
  }

  getInput(): GainNode {
    return this.input;
  }

  getOutput(): GainNode {
    return this.output;
  }

  getRoute(): SonicOutputRoute {
    return this.route;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.clearEqChain();
      this.input.disconnect();
      this.input.connect(this.output);
      this.stopTick();
      updatePlaybackDiagnostics({ sonicRoute: null, earSafetyGain: 1 });
      return;
    }
    void this.refreshRoute(true);
    this.startTick();
  }

  setUserVolume(level: number): void {
    this.userVolume = level;
    this.applyEarSafetyGain();
  }

  setPlaying(playing: boolean): void {
    this.isPlaying = playing;
  }

  async refreshRoute(forceRebuild = false): Promise<void> {
    if (!this.enabled || !loadSandboxSonicEnabled()) return;
    const next = await detectSonicOutputRoute();
    if (!forceRebuild && next === this.route && this.eqNodes.length > 0) return;
    this.route = next;
    this.rebuildEqChain();
    updatePlaybackDiagnostics({
      sonicRoute: next,
      earSafetyGain: getEarSafetyGain(),
    });
  }

  dispose(): void {
    this.stopTick();
    resetEarSafetySession();
    try {
      this.input.disconnect();
      this.output.disconnect();
      this.earSafetyGain.disconnect();
      this.limiter.disconnect();
      this.clearEqChain();
    } catch {
      /* ignore */
    }
  }

  private startTick(): void {
    if (this.tickTimer != null) return;
    this.tickTimer = setInterval(() => {
      if (!this.enabled) return;
      tickEarSafety(this.userVolume, this.isPlaying);
      this.applyEarSafetyGain();
    }, 2000);
  }

  private stopTick(): void {
    if (this.tickTimer != null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private applyEarSafetyGain(): void {
    const gain = this.enabled ? getEarSafetyGain() : 1;
    this.earSafetyGain.gain.setValueAtTime(gain, this.ctx.currentTime);
    updatePlaybackDiagnostics({ earSafetyGain: gain });
  }

  private clearEqChain(): void {
    for (const node of this.eqNodes) {
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.eqNodes = [];
    this.crossfeed = null;
    this.spatial?.dispose();
    this.spatial = null;
    this.btCompressor = null;
  }

  private rebuildEqChain(): void {
    this.clearEqChain();
    this.input.disconnect();
    this.limiter.disconnect();
    this.earSafetyGain.disconnect();

    let tail: AudioNode = this.input;
    const presetId = loadSonicPeqPresetId();
    const bands = resolvePlaybackEqBands(this.route, presetId);
    for (const band of bands) {
      const filter = createBiquad(this.ctx, band);
      tail.connect(filter);
      tail = filter;
      this.eqNodes.push(filter);
    }

    const spatialOn =
      loadSandboxSpatialEnabled() && isHeadphoneSonicRoute(this.route);
    if (spatialOn) {
      this.spatial = createSpatialWidener(this.ctx);
      this.spatial.setWidth(loadSandboxSpatialWidth());
      tail.connect(this.spatial.input);
      tail = this.spatial.output;
      this.eqNodes.push(this.spatial.input, this.spatial.output);
    }

    if (this.route === 'wired-headphones') {
      this.crossfeed = createCrossfeed(this.ctx);
      tail.connect(this.crossfeed.input);
      tail = this.crossfeed.output;
      this.eqNodes.push(this.crossfeed.input, this.crossfeed.output);
    }

    if (this.route === 'bluetooth') {
      this.btCompressor = createBtCompressor(this.ctx);
      tail.connect(this.btCompressor);
      tail = this.btCompressor;
      this.eqNodes.push(this.btCompressor);
    }

    tail.connect(this.limiter);
    this.limiter.connect(this.earSafetyGain);
    this.earSafetyGain.connect(this.output);
  }
}

export { EAR_SAFETY_MIN_GAIN };
