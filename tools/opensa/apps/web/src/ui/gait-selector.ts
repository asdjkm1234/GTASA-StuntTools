/**
 * Speed → gait tier with hysteresis (plan 088/03). A raw threshold flickers the clip at the boundary
 * (accel/decel noise crosses it every few frames); a gait only drops back once the speed has fallen a
 * real gap below the threshold it climbed. Pure state, unit-tested without a GPU.
 */

/** How far (units/s) below an up-threshold the speed must fall before the gait drops back down. */
export const GAIT_HYSTERESIS = 0.5;

export class GaitSelector {
  private tier = 0;

  constructor(
    /** Ascending up-switch thresholds; `thresholds[i]` lifts tier i → i+1. Tier count = length + 1. */
    private readonly thresholds: readonly number[],
    private readonly hysteresis = GAIT_HYSTERESIS,
  ) {}

  /** The sticky gait tier (0-based) for this frame's speed. */
  update(speed: number): number {
    while (this.tier < this.thresholds.length && speed > this.thresholds[this.tier]) {
      this.tier += 1;
    }
    while (this.tier > 0 && speed < this.downThreshold(this.tier - 1)) {
      this.tier -= 1;
    }

    return this.tier;
  }

  /** The drop point for a boundary — never below half its up-threshold (the idle boundary is tiny). */
  private downThreshold(boundary: number): number {
    const up = this.thresholds[boundary];

    return up - Math.min(this.hysteresis, up / 2);
  }
}
