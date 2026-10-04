/** Measured local surface deflections. Never depends on keys, camera, or aircraft world attitude. */
import type { Quat } from './math';

import { conjugate, quatMultiply } from './math';

export interface SurfaceAxis {
  angle: null | number;
  source: 'partial' | 'recorded' | 'unknown';
  value: null | number;
}

export interface SurfaceFeedback {
  damaged: boolean;
  damageUnknown: boolean;
  pitch: SurfaceAxis;
  roll: SurfaceAxis;
  yaw: SurfaceAxis;
}

/** Independent visual pedal presses: the inactive side stays neutral; unavailable stays unknown. */
export function pedalPresses(value: null | number): { left: null | number; right: null | number } {
  if (value === null || !Number.isFinite(value)) return { left: null, right: null };

  return { left: Math.min(1, Math.max(0, -value)), right: Math.min(1, Math.max(0, value)) };
}

export function surfaceFeedback(
  nodes: readonly (null | Quat)[],
  binds: readonly (null | Quat)[],
  damage: readonly (null | number)[] = [],
): SurfaceFeedback {
  const read = (i: number): null | number =>
    damage[i] === 2 || damage[i] === 3 ? null : surfaceTwist(nodes[i] ?? null, binds[i] ?? null, i === 0 ? 2 : 0);
  const axis = (angles: (null | number)[], sign: number, limit: number): SurfaceAxis => {
    const known = angles.filter((a): a is number => a !== null);
    const angle = known.length ? (sign * known.reduce((a, b) => a + b, 0)) / known.length : null;

    return {
      angle,
      source: known.length === 0 ? 'unknown' : known.length === angles.length ? 'recorded' : 'partial',
      value: angle === null ? null : Math.max(-1, Math.min(1, angle / limit)) || 0,
    };
  };
  const right = read(4);

  return {
    damaged: damage.some((state) => state !== null && state > 0),
    damageUnknown: Array.from({ length: 5 }, (_, i) => damage[i] ?? null).some((state) => state === null),
    pitch: axis([read(1), read(2)], -1, (30 * Math.PI) / 180),
    roll: axis([read(3), right === null ? null : -right], 1, (30 * Math.PI) / 180),
    // Rudder extends aft (-Y): positive Z twist moves its trailing edge right (+X).
    yaw: axis([read(0)], 1, (40 * Math.PI) / 180),
  };
}

/** Signed twist with authored bind cancelled; invalid/zero quaternions are unavailable. */
export function surfaceTwist(node: null | Quat, bind: null | Quat, axis: 0 | 2): null | number {
  if (!node || !bind || ![...node, ...bind].every(Number.isFinite)) return null;
  if (Math.hypot(...node) < 0.5 || Math.hypot(...bind) < 0.5) return null;
  const delta = quatMultiply(node, conjugate(bind));
  if (Math.hypot(delta[axis], delta[3]) < 0.000001) return null;
  const angle = 2 * Math.atan2(delta[axis], delta[3]);
  const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle));

  // Tiny matrix/CSV rounding errors should not make an idle control tremble.
  return Math.abs(wrapped) < (0.15 * Math.PI) / 180 ? 0 : wrapped;
}
