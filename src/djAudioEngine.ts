/**
 * DJ Console Web Audio routing — 2-deck crossfade, EQ, send FX, and stem mixing.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';
import type { StemKind, StemUrls } from './stemSeparation';
import { stemUrlsComplete } from './stemSeparation';

export const DJ_AUDIO_ROUTING_KEY = 'sandbox_dj_audio_routing';

export function isDjAudioRoutingEnabled(): boolean {
  return prefsGetItem(DJ_AUDIO_ROUTING_KEY) === 'true';
}

export function setDjAudioRoutingEnabled(enabled: boolean): void {
  prefsSetItem(DJ_AUDIO_ROUTING_KEY, enabled ? 'true' : 'false');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sandbox-settings-change'));
  }
}

export type DjDeckId = 'A' | 'B';

export type DjEqBands = {
  low: number;
  mid: number;
  high: number;
};

export type DjSendFx = {
  delayMix: number;
  reverbMix: number;
};

export type DjStemGains = Record<StemKind, { db: number; muted: boolean }>;

type DeckNodes = {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  filter: BiquadFilterNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  gain: GainNode;
  delaySend: GainNode;
  reverbSend: GainNode;
  stems?: Partial<Record<StemKind, { audio: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode }>>;
  stemMode: boolean;
};

const DEFAULT_EQ: DjEqBands = { low: 0, mid: 0, high: 0 };
const DEFAULT_FX: DjSendFx = { delayMix: 0, reverbMix: 0 };
const STEM_KINDS: StemKind[] = ['vocals', 'drums', 'bass', 'other'];

const DEFAULT_STEM_GAINS: DjStemGains = {
  vocals: { db: 0, muted: false },
  drums: { db: 0, muted: false },
  bass: { db: 0, muted: false },
  other: { db: 0, muted: false },
};

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Minimal 2-deck Web Audio mixer — crossfade, 3-band EQ, delay/reverb sends, optional 4-stem mix.
 */
export class DjAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayReturn: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbReturn: GainNode | null = null;
  private decks: Partial<Record<DjDeckId, DeckNodes>> = {};
  private crossfader = 0;
  private sendFx: DjSendFx = { ...DEFAULT_FX };
  private stemGains: Record<DjDeckId, DjStemGains> = { A: { ...DEFAULT_STEM_GAINS }, B: { ...DEFAULT_STEM_GAINS } };
  private rafId: number | null = null;
  private onTick: ((deck: DjDeckId, elapsed: number) => void) | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.delayNode = this.ctx.createDelay(1.0);
      this.delayNode.delayTime.value = 0.35;
      this.delayFeedback = this.ctx.createGain();
      this.delayFeedback.gain.value = 0.35;
      this.delayReturn = this.ctx.createGain();
      this.delayReturn.gain.value = 0;
      this.delayNode.connect(this.delayFeedback);
      this.delayFeedback.connect(this.delayNode);
      this.delayNode.connect(this.delayReturn);
      this.delayReturn.connect(this.masterGain);

      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = this.buildReverbImpulse(this.ctx);
      this.reverbReturn = this.ctx.createGain();
      this.reverbReturn.gain.value = 0;
      this.reverbNode.connect(this.reverbReturn);
      this.reverbReturn.connect(this.masterGain);

      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private buildReverbImpulse(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 1.5;
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
      }
    }
    return impulse;
  }

  private ensureDeck(deck: DjDeckId): DeckNodes {
    const existing = this.decks[deck];
    if (existing) return existing;

    const ctx = this.ensureContext();
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';

    const source = ctx.createMediaElementSource(audio);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 20000;
    filter.Q.value = 0.7;

    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 200;

    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1000;
    mid.Q.value = 0.9;

    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 4000;

    const gain = ctx.createGain();
    const delaySend = ctx.createGain();
    const reverbSend = ctx.createGain();

    source.connect(filter);
    filter.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(gain);
    gain.connect(this.masterGain!);
    gain.connect(delaySend);
    gain.connect(reverbSend);
    delaySend.connect(this.delayNode!);
    reverbSend.connect(this.reverbNode!);

    const nodes: DeckNodes = {
      audio,
      source,
      filter,
      low,
      mid,
      high,
      gain,
      delaySend,
      reverbSend,
      stemMode: false,
    };
    this.decks[deck] = nodes;
    this.applyCrossfader();
    this.applySendFx();
    return nodes;
  }

  private clearDeckStems(deck: DjDeckId): void {
    const nodes = this.decks[deck];
    if (!nodes?.stems) return;
    for (const kind of STEM_KINDS) {
      const stem = nodes.stems[kind];
      if (!stem) continue;
      stem.audio.pause();
      stem.audio.src = '';
      stem.source.disconnect();
      stem.gain.disconnect();
    }
    nodes.stems = undefined;
    nodes.stemMode = false;
    nodes.gain.gain.value = 1;
  }

  private applyStemGains(deck: DjDeckId): void {
    const nodes = this.decks[deck];
    if (!nodes?.stems || !this.ctx) return;
    const gains = this.stemGains[deck];
    const now = this.ctx.currentTime;
    for (const kind of STEM_KINDS) {
      const stem = nodes.stems[kind];
      if (!stem) continue;
      const g = gains[kind];
      const linear = g.muted ? 0 : dbToLinear(g.db);
      stem.gain.gain.setValueAtTime(linear, now);
    }
  }

  setOnTick(fn: ((deck: DjDeckId, elapsed: number) => void) | null): void {
    this.onTick = fn;
  }

  hasStemMix(deck: DjDeckId): boolean {
    return Boolean(this.decks[deck]?.stemMode);
  }

  private startTickLoop(): void {
    if (this.rafId != null) return;
    const loop = () => {
      for (const deck of ['A', 'B'] as DjDeckId[]) {
        const nodes = this.decks[deck];
        if (!nodes) continue;
        const clock =
          nodes.stemMode && nodes.stems?.vocals?.audio && !nodes.stems.vocals.audio.paused
            ? nodes.stems.vocals.audio
            : nodes.audio;
        if (!clock.paused) {
          this.onTick?.(deck, clock.currentTime);
        }
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopTickLoopIfIdle(): void {
    const anyPlaying = (['A', 'B'] as DjDeckId[]).some((d) => {
      const nodes = this.decks[d];
      if (!nodes) return false;
      if (nodes.stemMode && nodes.stems) {
        return STEM_KINDS.some((k) => {
          const stem = nodes.stems?.[k];
          return stem && !stem.audio.paused;
        });
      }
      return !nodes.audio.paused;
    });
    if (!anyPlaying && this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  loadTrack(deck: DjDeckId, url: string): void {
    this.clearDeckStems(deck);
    const nodes = this.ensureDeck(deck);
    if (nodes.audio.src !== url) {
      nodes.audio.src = url;
      nodes.audio.load();
    }
  }

  loadStems(deck: DjDeckId, stemUrls: StemUrls): boolean {
    if (!stemUrlsComplete(stemUrls)) return false;
    const nodes = this.ensureDeck(deck);
    this.clearDeckStems(deck);
    const ctx = this.ensureContext();
    nodes.audio.pause();
    nodes.audio.src = '';
    nodes.gain.gain.value = 0;

    const stems: DeckNodes['stems'] = {};
    for (const kind of STEM_KINDS) {
      const url = stemUrls[kind];
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.src = url;
      const source = ctx.createMediaElementSource(audio);
      const stemGain = ctx.createGain();
      source.connect(stemGain);
      stemGain.connect(nodes.filter);
      stems[kind] = { audio, source, gain: stemGain };
    }
    nodes.stems = stems;
    nodes.stemMode = true;
    this.applyStemGains(deck);
    return true;
  }

  setStemGain(deck: DjDeckId, kind: StemKind, db: number, muted: boolean): void {
    this.stemGains[deck][kind] = { db: Math.max(-12, Math.min(12, db)), muted };
    this.applyStemGains(deck);
  }

  setFilterWash(deck: DjDeckId, wash: number): void {
    const nodes = this.decks[deck];
    if (!nodes) return;
    const clamped = Math.max(-100, Math.min(100, wash));
    if (clamped === 0) {
      nodes.filter.type = 'lowpass';
      nodes.filter.frequency.value = 20000;
      return;
    }
    if (clamped < 0) {
      nodes.filter.type = 'lowpass';
      const cutoff = 200 + (1 + clamped / 100) * 8000;
      nodes.filter.frequency.value = cutoff;
    } else {
      nodes.filter.type = 'highpass';
      const cutoff = 200 + (clamped / 100) * 4000;
      nodes.filter.frequency.value = cutoff;
    }
  }

  setEqBand(deck: DjDeckId, band: keyof DjEqBands, db: number): void {
    const nodes = this.decks[deck];
    if (!nodes) return;
    const clamped = Math.max(-12, Math.min(12, db));
    if (band === 'low') nodes.low.gain.value = clamped;
    if (band === 'mid') nodes.mid.gain.value = clamped;
    if (band === 'high') nodes.high.gain.value = clamped;
  }

  setSendFx(fx: Partial<DjSendFx>): void {
    this.sendFx = { ...this.sendFx, ...fx };
    this.applySendFx();
  }

  private applySendFx(): void {
    const ctx = this.ctx;
    if (!ctx || !this.delayReturn || !this.reverbReturn) return;
    const now = ctx.currentTime;
    this.delayReturn.gain.setValueAtTime(this.sendFx.delayMix / 100, now);
    this.reverbReturn.gain.setValueAtTime(this.sendFx.reverbMix / 100, now);
    for (const deck of ['A', 'B'] as DjDeckId[]) {
      const nodes = this.decks[deck];
      if (!nodes) continue;
      nodes.delaySend.gain.setValueAtTime(this.sendFx.delayMix / 100, now);
      nodes.reverbSend.gain.setValueAtTime(this.sendFx.reverbMix / 100, now);
    }
  }

  setCrossfader(value: number): void {
    this.crossfader = Math.max(-100, Math.min(100, value));
    this.applyCrossfader();
  }

  private applyCrossfader(): void {
    const t = (this.crossfader + 100) / 200;
    const gainA = Math.cos(t * Math.PI * 0.5);
    const gainB = Math.sin(t * Math.PI * 0.5);
    this.decks.A?.gain.gain.setValueAtTime(gainA, this.ensureContext().currentTime);
    this.decks.B?.gain.gain.setValueAtTime(gainB, this.ensureContext().currentTime);
  }

  private deckPlayTargets(deck: DjDeckId): HTMLAudioElement[] {
    const nodes = this.decks[deck];
    if (!nodes) return [];
    if (nodes.stemMode && nodes.stems) {
      return STEM_KINDS.map((k) => nodes.stems![k]?.audio).filter(Boolean) as HTMLAudioElement[];
    }
    return [nodes.audio];
  }

  async play(deck: DjDeckId): Promise<void> {
    this.ensureDeck(deck);
    this.ensureContext();
    const targets = this.deckPlayTargets(deck);
    await Promise.all(targets.map((a) => a.play()));
    this.startTickLoop();
  }

  pause(deck: DjDeckId): void {
    for (const audio of this.deckPlayTargets(deck)) {
      audio.pause();
    }
    this.stopTickLoopIfIdle();
  }

  toggle(deck: DjDeckId): void {
    const targets = this.deckPlayTargets(deck);
    if (targets.length === 0) return;
    if (targets.some((a) => a.paused)) void this.play(deck);
    else this.pause(deck);
  }

  isPlaying(deck: DjDeckId): boolean {
    const targets = this.deckPlayTargets(deck);
    return targets.some((a) => !a.paused);
  }

  dispose(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    for (const deck of ['A', 'B'] as DjDeckId[]) {
      this.clearDeckStems(deck);
      const nodes = this.decks[deck];
      if (nodes) {
        nodes.audio.pause();
        nodes.audio.src = '';
        nodes.source.disconnect();
        nodes.filter.disconnect();
        nodes.low.disconnect();
        nodes.mid.disconnect();
        nodes.high.disconnect();
        nodes.gain.disconnect();
        nodes.delaySend.disconnect();
        nodes.reverbSend.disconnect();
      }
    }
    this.decks = {};
    void this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
  }
}

let sharedEngine: DjAudioEngine | null = null;

export function getDjAudioEngine(): DjAudioEngine {
  if (!sharedEngine) sharedEngine = new DjAudioEngine();
  return sharedEngine;
}

export function disposeDjAudioEngine(): void {
  sharedEngine?.dispose();
  sharedEngine = null;
}

export { DEFAULT_EQ, DEFAULT_FX, DEFAULT_STEM_GAINS };
