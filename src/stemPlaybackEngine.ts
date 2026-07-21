/**
 * Single-track stem mixer — plays pre-separated server blobs (not live Demucs).
 */

import type { StemKind, StemUrls } from './stemSeparation';
import { stemUrlsComplete } from './stemSeparation';

export const STEM_KINDS: StemKind[] = ['vocals', 'drums', 'bass', 'other'];

export type StemGainState = Record<StemKind, { db: number; muted: boolean }>;

export const DEFAULT_STEM_GAIN_STATE: StemGainState = {
  vocals: { db: 0, muted: false },
  drums: { db: 0, muted: false },
  bass: { db: 0, muted: false },
  other: { db: 0, muted: false },
};

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

type StemNodes = {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
};

export class ServerStemPlaybackEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private stems: Partial<Record<StemKind, StemNodes>> = {};
  private gains: StemGainState = structuredClone(DEFAULT_STEM_GAIN_STATE);
  private loaded = false;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  load(stemUrls: StemUrls): boolean {
    if (!stemUrlsComplete(stemUrls)) return false;
    this.disposeStems();
    const ctx = this.ensureContext();
    const master = this.master!;

    for (const kind of STEM_KINDS) {
      const url = stemUrls[kind];
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.src = url;
      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(master);
      this.stems[kind] = { audio, source, gain };
    }
    this.loaded = true;
    this.applyGains();
    return true;
  }

  setGain(kind: StemKind, db: number, muted: boolean): void {
    this.gains[kind] = { db: Math.max(-12, Math.min(12, db)), muted };
    this.applyGains();
  }

  setGains(next: StemGainState): void {
    this.gains = next;
    this.applyGains();
  }

  private applyGains(): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const kind of STEM_KINDS) {
      const node = this.stems[kind];
      if (!node) continue;
      const { db, muted } = this.gains[kind];
      const linear = muted ? 0 : dbToLinear(db);
      node.gain.gain.setValueAtTime(linear, now);
    }
  }

  private audioTargets(): HTMLAudioElement[] {
    return STEM_KINDS.map((k) => this.stems[k]?.audio).filter(Boolean) as HTMLAudioElement[];
  }

  async play(): Promise<void> {
    if (!this.loaded) return;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    await Promise.all(this.audioTargets().map((a) => a.play()));
  }

  pause(): void {
    for (const audio of this.audioTargets()) audio.pause();
  }

  isPlaying(): boolean {
    const targets = this.audioTargets();
    return targets.length > 0 && targets.some((a) => !a.paused);
  }

  seek(seconds: number): void {
    const clamped = Math.max(0, seconds);
    for (const audio of this.audioTargets()) {
      try {
        audio.currentTime = clamped;
      } catch {
        /* ignore */
      }
    }
  }

  getCurrentTime(): number {
    return this.stems.vocals?.audio.currentTime ?? this.audioTargets()[0]?.currentTime ?? 0;
  }

  getDuration(): number {
    const d = this.stems.vocals?.audio.duration ?? this.audioTargets()[0]?.duration ?? 0;
    return Number.isFinite(d) ? d : 0;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  disposeStems(): void {
    for (const kind of STEM_KINDS) {
      const node = this.stems[kind];
      if (!node) continue;
      node.audio.pause();
      node.audio.src = '';
      try {
        node.source.disconnect();
        node.gain.disconnect();
      } catch {
        /* ignore */
      }
      delete this.stems[kind];
    }
    this.loaded = false;
  }

  dispose(): void {
    this.disposeStems();
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
  }
}

let sharedStemEngine: ServerStemPlaybackEngine | null = null;

export function getServerStemPlaybackEngine(): ServerStemPlaybackEngine {
  if (!sharedStemEngine) sharedStemEngine = new ServerStemPlaybackEngine();
  return sharedStemEngine;
}

export function disposeServerStemPlaybackEngine(): void {
  sharedStemEngine?.dispose();
  sharedStemEngine = null;
}
