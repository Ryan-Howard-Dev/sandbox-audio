/**
 * Sandbox Spatial — lightweight stereo widener for headphone routes (Web Audio).
 * Binaural-ish width via short cross-delay + opposite-channel bleed (no licensed Atmos).
 */

import type { SonicOutputRoute } from './sandboxSonic';

const MAX_DELAY_SEC = 0.012;
const MAX_CROSS_MIX = 0.52;

export type SpatialWidener = {
  input: AudioNode;
  output: AudioNode;
  setWidth: (width01: number) => void;
  dispose: () => void;
};

export function isHeadphoneSonicRoute(route: SonicOutputRoute): boolean {
  return route === 'wired-headphones' || route === 'bluetooth';
}

/** Stereo widener: cross-delay + bleed for headphone immersion. */
export function createSpatialWidener(ctx: AudioContext): SpatialWidener {
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);

  const dryL = ctx.createGain();
  const dryR = ctx.createGain();
  const wetL = ctx.createGain();
  const wetR = ctx.createGain();

  const delayForRight = ctx.createDelay(MAX_DELAY_SEC);
  const delayForLeft = ctx.createDelay(MAX_DELAY_SEC);
  delayForRight.delayTime.value = 0.0009;
  delayForLeft.delayTime.value = 0.0009;

  const leftBus = ctx.createGain();
  const rightBus = ctx.createGain();

  splitter.connect(dryL, 0);
  splitter.connect(dryR, 1);
  splitter.connect(delayForRight, 0);
  splitter.connect(delayForLeft, 1);
  delayForRight.connect(wetR);
  delayForLeft.connect(wetL);

  dryL.connect(leftBus);
  wetL.connect(leftBus);
  dryR.connect(rightBus);
  wetR.connect(rightBus);

  leftBus.connect(merger, 0, 0);
  rightBus.connect(merger, 0, 1);

  dryL.gain.value = 1;
  dryR.gain.value = 1;
  wetL.gain.value = 0;
  wetR.gain.value = 0;

  const nodes: AudioNode[] = [
    splitter,
    merger,
    dryL,
    dryR,
    wetL,
    wetR,
    delayForLeft,
    delayForRight,
    leftBus,
    rightBus,
  ];

  return {
    input: splitter,
    output: merger,
    setWidth(width01: number) {
      const w = Math.max(0, Math.min(1, width01));
      const mix = w * MAX_CROSS_MIX;
      const now = ctx.currentTime;
      wetL.gain.setValueAtTime(mix, now);
      wetR.gain.setValueAtTime(mix, now);
      const delaySec = 0.0004 + w * 0.0018;
      delayForLeft.delayTime.setValueAtTime(delaySec, now);
      delayForRight.delayTime.setValueAtTime(delaySec, now);
    },
    dispose() {
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
