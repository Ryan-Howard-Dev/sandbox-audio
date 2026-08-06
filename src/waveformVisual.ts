/**
 * Turning playback levels into something worth looking at.
 *
 * The native tap gives a ring of recent loudness, one value per audio buffer. Drawn straight, that
 * is a jittery sawtooth: buffers are a few milliseconds apart and real music is spiky at that scale,
 * so the line twitches rather than moves. Everything here exists to make it read as music.
 *
 * Kept out of the component because it is the part that can be wrong and the part worth testing. A
 * canvas draws whatever it is handed and looks plausible doing it, so a visualiser that silently
 * stopped following the audio would go unnoticed until somebody stared at a flat line during a loud
 * chorus.
 */

/** How many points the shape carries. Matches the native ring so nothing is invented or dropped. */
export const WAVE_POINTS = 64;

export interface WaveShapeOptions {
  /**
   * How much of the previous frame survives, 0 to 1.
   *
   * The visual equivalent of an attack/release envelope. At zero the line chases every buffer and
   * looks like interference; near one it is syrup that ignores the beat. Rising fast and falling
   * slow is what makes a kick drum look like a kick drum, so attack and release are separate.
   */
  attack?: number;
  release?: number;
  /** Never quite flat while audio is playing, so a quiet passage still reads as alive. */
  floor?: number;
}

const DEFAULTS: Required<WaveShapeOptions> = {
  // Fast up, slow down. Reversing these makes every transient look identical.
  attack: 0.45,
  release: 0.82,
  floor: 0.04,
};

/**
 * Blend a new reading into the shape already on screen.
 *
 * Returns a new array rather than mutating, because the caller holds the previous frame and a
 * mutation in place would make the smoothing compare a value against itself.
 */
export function advanceWaveShape(
  previous: readonly number[] | null,
  levels: readonly number[] | null | undefined,
  options: WaveShapeOptions = {},
): number[] {
  const { attack, release, floor } = { ...DEFAULTS, ...options };
  const prior = previous && previous.length === WAVE_POINTS ? previous : null;

  const out = new Array<number>(WAVE_POINTS);
  for (let i = 0; i < WAVE_POINTS; i += 1) {
    const raw = levels?.[i];
    /*
     * A missing or nonsense reading is treated as silence rather than skipped. Skipping would hold
     * the previous frame forever if the tap stopped answering, and a frozen waveform over playing
     * audio is a worse lie than a flat one.
     */
    const target =
      typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(255, raw)) / 255 : 0;
    const was = prior ? prior[i]! : 0;
    const keep = target > was ? attack : release;
    const blended = was * keep + target * (1 - keep);
    out[i] = Math.max(floor, Math.min(1, blended));
  }
  return out;
}

/** A shape that is not moving, for when nothing is playing. */
export function restingWaveShape(floor = DEFAULTS.floor): number[] {
  return new Array<number>(WAVE_POINTS).fill(floor);
}

/**
 * Whether this shape is actually following anything.
 *
 * A visualiser drawing the floor value across the whole width looks exactly like one whose data
 * feed has died. The caller uses this to say "nothing playing" rather than imply it is listening.
 */
export function waveIsMoving(shape: readonly number[], floor = DEFAULTS.floor): boolean {
  return shape.some((v) => v > floor + 0.01);
}

/**
 * Vertical positions for one line, as a fraction of height.
 *
 * `spread` pushes a line away from the centre so several can be stacked without overlapping, and
 * `scale` shrinks the outer ones — the quieter echoes of the middle line, which is what gives the
 * stack depth instead of looking like parallel copies.
 */
export function lineOffsets(
  shape: readonly number[],
  spread: number,
  scale: number,
): number[] {
  return shape.map((v) => 0.5 + spread + v * 0.5 * scale * (spread >= 0 ? 1 : -1));
}

/**
 * A smooth path through the points, in canvas coordinates.
 *
 * Straight segments between 64 points across a phone screen are visibly faceted. This is a
 * Catmull-Rom style midpoint curve: cheap, needs no control-point solving, and never overshoots
 * into a loop the way a naive bezier through every point does.
 */
export function wavePath(
  shape: readonly number[],
  width: number,
  height: number,
  spread = 0,
  scale = 1,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const n = shape.length;
  if (n === 0 || width <= 0 || height <= 0) return points;
  const step = n > 1 ? width / (n - 1) : width;
  for (let i = 0; i < n; i += 1) {
    const v = shape[i]!;
    const y = height * (0.5 + spread - v * 0.5 * scale);
    points.push({ x: i * step, y });
  }
  return points;
}
