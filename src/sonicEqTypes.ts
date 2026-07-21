/** Shared biquad band definition for Sandbox Sonic + PEQ presets. */
export type SonicEqBand = {
  type: BiquadFilterType;
  frequency: number;
  gainDb?: number;
  Q?: number;
};
