/**
 * Frame-hierarchy transforms (renderer-agnostic). Lived in `tools/opensa-pack`'s welder until the vehicle
 * builder (074/08 B5) needed the same walk in the browser — one implementation, two consumers.
 */
import type { RWFrame } from '../parsers/binary/types';

/**
 * An atomic's model-space transform: its frame chain composed root→leaf, in the row-major mat3 convention
 * the welder's `appendInstance` uses (RW stores right/up/at basis vectors as COLUMNS → each local mat
 * transposes in). Null for the identity (the common case — static world DFFs bake geometry in model space),
 * so the hot per-vertex path skips it. Anim-hierarchy models (windmills, the Burger Shot sign) place parts
 * here, and so do vehicle wheels/doors. With `stopAt` the walk ends at that ancestor and yields the
 * frame's transform relative to it (a wheel mesh inside its `f_wheel` container).
 */
export function frameWorldTransform(
  frames: readonly RWFrame[],
  frameIndex: number,
  stopAt = -1,
): null | { pos: [number, number, number]; rot: number[] } {
  let rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let pos: [number, number, number] = [0, 0, 0];
  let hops = 0;
  for (let at = frameIndex; at >= 0 && at < frames.length && hops <= frames.length; at = frames[at].parentIndex) {
    const frame = frames[at];
    // `stopAt` — the transform RELATIVE to that ancestor (its own matrix excluded, like the root's below).
    if (at === stopAt || frame.parentIndex < 0) {
      // The clump ROOT's authored matrix never renders in SA: the engine overwrites it with the entity's
      // world matrix on attach, so its local values are dead data — and anti-rip exporters poison exactly
      // this slot (a comet mod shipped rotation[0][0] = −3.9e14 there; composing it flung every off-centre
      // part to ±1e14 while the game rendered the car whole). Stock roots are identity, so skipping the
      // root changes nothing for well-formed models.
      break;
    }
    const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = frame.rotation;
    const local = [r0, r3, r6, r1, r4, r7, r2, r5, r8];
    // accumulated = local ∘ accumulated (walking leaf → root).
    rot = mulMat3(local, rot);
    pos = [
      local[0] * pos[0] + local[1] * pos[1] + local[2] * pos[2] + frame.position[0],
      local[3] * pos[0] + local[4] * pos[1] + local[5] * pos[2] + frame.position[1],
      local[6] * pos[0] + local[7] * pos[1] + local[8] * pos[2] + frame.position[2],
    ];
    hops += 1;
  }
  const identityRot = rot.every((value, index) => Math.abs(value - (index % 4 === 0 ? 1 : 0)) < 1e-6);
  if (identityRot && Math.hypot(pos[0], pos[1], pos[2]) < 1e-6) {
    return null;
  }

  return { pos, rot };
}

export function mulMat3(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] = a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }

  return out;
}

/** Row-major rotation (as returned by {@link frameWorldTransform}) → quaternion (x, y, z, w). */
export function rotationToQuat(m: readonly number[]): [number, number, number, number] {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);

    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);

    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);

    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);

  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
