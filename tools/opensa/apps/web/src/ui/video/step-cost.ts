/**
 * What video mode's per-frame work COSTS (plan 096/08's benchmark).
 *
 * The module's whole frame-loop footprint is one call: the step the host runs between the car's render pose
 * and the camera snapshot (`setVideoStep`). Everything the feature does per frame — the director, the shot
 * framing, the autopilot's steering solve, the live occlusion probes — happens inside it. So timing that one
 * call IS the measurement, and it is the only honest one available: a whole-frame "video on vs off" A/B
 * compares different workloads (off, nothing drives, nothing streams, and the camera does not move), so its
 * difference is the scene, not the module.
 *
 * One timer per scene: the cost of a fly scene and of a drive scene are different questions.
 */

/** One scene's per-frame video cost, in ms. */
export interface StepCost {
  frames: number;
  maxMs: number;
  meanMs: number;
  p95Ms: number;
}

export interface StepTimer {
  /** The scene's cost so far, rounded for the capture. */
  cost(): StepCost;
  /** The same step, timed. */
  wrap(step: (dt: number) => void): (dt: number) => void;
}

export function createStepTimer(): StepTimer {
  const samples: number[] = [];

  return {
    cost: (): StepCost => {
      const sorted = [...samples].sort((a, b) => a - b);
      const total = samples.reduce((sum, value) => sum + value, 0);

      return {
        frames: samples.length,
        maxMs: round(sorted[sorted.length - 1] ?? 0),
        meanMs: round(samples.length === 0 ? 0 : total / samples.length),
        p95Ms: round(quantile(sorted, 0.95)),
      };
    },
    wrap:
      (step) =>
      (dt): void => {
        const started = performance.now();
        step(dt);
        samples.push(performance.now() - started);
      },
  };
}

function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

/** Four decimals: the step is expected well under a millisecond, so two would report it as zero. */
function round(ms: number): number {
  return Number(ms.toFixed(4));
}
