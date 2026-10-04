const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const degToRad = (degrees: number): number => degrees * DEG2RAD;

export const radToDeg = (radians: number): number => radians * RAD2DEG;

export const lerp = (x: number, y: number, t: number): number => (1 - t) * x + t * y;

/** Always returns a non-negative remainder, unlike `%`. */
export const euclideanModulo = (n: number, m: number): number => ((n % m) + m) % m;

/** Hermite ease between two edges: 0 below `edge0`, 1 above `edge1`, smooth (no kink) at both ends.
 *  Degenerate edges (`edge1 <= edge0`) collapse to a step at `edge1` — a config slider dragged past its
 *  partner must not divide by zero. */
export const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (edge1 <= edge0) {
    return value >= edge1 ? 1 : 0;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);

  return t * t * (3 - 2 * t);
};

export const MathUtils = { clamp, degToRad, euclideanModulo, lerp, radToDeg, smoothstep } as const;
