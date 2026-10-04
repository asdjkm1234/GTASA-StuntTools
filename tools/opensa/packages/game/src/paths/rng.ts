/**
 * The seeded RNG the video mode threads through EVERY choice (096 D9: `?seed=` must reproduce the car, the
 * weather, the hour, the route and the shot list). `Math.random` is banned in the route/director modules by
 * construction — a run that cannot be replayed cannot be A/B'd in the field.
 */

/** A stream of floats in [0, 1) — the one random source the route/director code accepts. */
export type Random = () => number;

/** Deterministic 32-bit PRNG (mulberry32): same seed → same stream, on every platform. */
export function mulberry32(seed: number): Random {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Index of a weighted pick; −1 when every weight is 0 (the caller decides what an empty choice means). */
export function pickWeighted(random: Random, weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) {
    return -1;
  }
  let ticket = random() * total;
  for (let index = 0; index < weights.length; index += 1) {
    ticket -= Math.max(0, weights[index]);
    if (ticket < 0) {
      return index;
    }
  }

  return weights.length - 1;
}
