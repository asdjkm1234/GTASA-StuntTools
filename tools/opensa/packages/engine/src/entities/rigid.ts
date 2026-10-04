/**
 * Rigid-part dynamic entity (plan 074/08 B2, extended for B5): a vehicle-style part hierarchy flattened on
 * the CPU each frame into a matrix storage buffer — parts draw with `firstInstance = slot × partCount + part`
 * and the vertex shader reads `matrices[instance_index]`. NEVER inside static bundles (the 073 barberpole
 * lesson). Pure CPU state here; the GPU side (buffers/bind group/draws) lives in the engine facade.
 */
import { composePosQuat, mulMat4 } from '../anim/ifp-sampler';

/**
 * A part is its PIVOT transform (the frame the animation rotates about) plus an optional mesh `offset`
 * inside that pivot. For a DOOR the pivot is the `door_*_dummy` hinge and the door's vertices are already
 * hinge-local — the vehicle builder puts them there because the original does (`PreprocessHierarchy`
 * collapses a damageable component's child frames onto it), so no vehicle part sets `offset` today; it
 * stays as the generic capability the flatten below implements.
 *
 * The swing therefore happens about the HINGE, in the HINGE's own axes, and that matters twice over:
 * `pivot.quaternion = closed ⊗ swing` means a right-side door whose hinge frame is turned 180° swings the
 * opposite world way — outward, on its own side — and a SCISSOR door (a mod that turns the hinge frame so
 * its local Z lies along the car's X) rises instead of swinging out, with no special case here. Rotating
 * about the hinge POINT in world axes would open both doors the same way, which looks wrong on exactly
 * half the car.
 */
export interface RigidPartInit {
  localRotation: readonly [number, number, number, number];
  localTranslation: readonly [number, number, number];
  name: string;
  /** Column-major mat4: the mesh's transform relative to the pivot (doors). Absent = identity. */
  offset?: ArrayLike<number>;
  /** Uniform scale (B5) — `vehicles.ide` wheelScale rides here. Absent = 1. */
  scale?: number;
}

/** Host-side handle: set the root + per-part animation rotations, then `flatten()` before upload. */
export class RigidEntity {
  /** Flattened world matrices, one mat4 per part — the storage-buffer payload. */
  readonly matrices: Float32Array;

  get partCount(): number {
    return this.parts.length;
  }
  private readonly animQuat: Float32Array;
  /** Per-part animation translation (plan 081/06 §3.2) — suspension travel is the first rider. */
  private readonly animTranslation: Float32Array;
  /** Per-part flag: 1 = the part carries its own world matrix (detached debris) and ignores root/locals. */
  private readonly detached: Uint8Array;
  private readonly detachedMatrix: Float32Array;
  private readonly local = new Float32Array(16);
  private readonly offset = new Float32Array(16);
  private readonly quat = new Float32Array(4);
  private readonly root = new Float32Array(16);

  private readonly scratch = new Float32Array(16);
  private readonly translation: [number, number, number] = [0, 0, 0];

  constructor(private readonly parts: readonly RigidPartInit[]) {
    this.matrices = new Float32Array(parts.length * 16);
    this.animQuat = new Float32Array(parts.length * 4);
    this.animTranslation = new Float32Array(parts.length * 3);
    this.detached = new Uint8Array(parts.length);
    this.detachedMatrix = new Float32Array(parts.length * 16);
    for (let part = 0; part < parts.length; part += 1) {
      this.animQuat[part * 4 + 3] = 1; // identity
    }
    this.root.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  /**
   * Recompute every part's world matrix: root × T(t + animT) × R(localQ ⊗ anim) × S × offset. Detached parts
   * pass their own world matrix straight through instead.
   */
  flatten(): void {
    for (let part = 0; part < this.parts.length; part += 1) {
      const target = this.matrices.subarray(part * 16, part * 16 + 16);
      if (this.detached[part] === 1) {
        target.set(this.detachedMatrix.subarray(part * 16, part * 16 + 16));
        continue;
      }
      const definition = this.parts[part];
      quatMultiply(this.quat, definition.localRotation, this.animQuat.subarray(part * 4, part * 4 + 4));
      const at = part * 3;
      this.translation[0] = definition.localTranslation[0] + this.animTranslation[at];
      this.translation[1] = definition.localTranslation[1] + this.animTranslation[at + 1];
      this.translation[2] = definition.localTranslation[2] + this.animTranslation[at + 2];
      composeTrs(this.local, this.quat, this.translation, definition.scale ?? 1);
      if (definition.offset) {
        this.scratch.set(this.local);
        this.offset.set(definition.offset);
        mulMat4(this.local, this.scratch, this.offset);
      }
      mulMat4(target, this.root, this.local);
    }
  }

  partIndex(name: string): number {
    return this.parts.findIndex((part) => part.name === name);
  }

  /** Per-part animation rotation (wheel spin/steer, door swing) — applied AFTER the bind-local rotation. */
  setPartRotation(part: number, quat: readonly [number, number, number, number]): void {
    this.animQuat.set(quat, part * 4);
  }

  /** Per-part animation translation (part-local frame, metres) — added to the bind-local translation.
   *  Suspension travel rides here (plan 081/06 §3.2); any part needing a per-frame local offset can. */
  setPartTranslation(part: number, translation: readonly [number, number, number]): void {
    this.animTranslation.set(translation, part * 3);
  }

  /**
   * Detach a part into WORLD space (damage debris): its matrix bypasses the root and the bind locals, so the
   * host can integrate it freely. `null` re-attaches it to the hierarchy. The own engine has no scene graph
   * to reparent into — this is its stand-in for three's `parent.attach()`.
   */
  setPartWorldMatrix(part: number, matrix: ArrayLike<number> | null): void {
    if (matrix === null) {
      this.detached[part] = 0;

      return;
    }
    this.detached[part] = 1;
    this.detachedMatrix.set(matrix, part * 16);
  }

  /** Column-major root matrix (the host owns axis conventions — GTA→engine change rides here). */
  setRoot(matrix: ArrayLike<number>): void {
    this.root.set(matrix);
  }
}

/** out = a ⊗ b (quaternion product, xyzw). */
export function quatMultiply(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
  const [ax, ay, az, aw] = [a[0], a[1], a[2], a[3]];
  const [bx, by, bz, bw] = [b[0], b[1], b[2], b[3]];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by + ay * bw + az * bx - ax * bz;
  out[2] = aw * bz + az * bw + ax * by - ay * bx;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** out = T(pos) × R(quat) × S(scale) — uniform scale commutes with the rotation, so scale the basis. */
function composeTrs(
  out: Float32Array,
  quat: ArrayLike<number>,
  pos: readonly [number, number, number],
  scale: number,
): void {
  composePosQuat(out, quat, pos);
  if (scale === 1) {
    return;
  }
  for (const column of [0, 4, 8]) {
    out[column] *= scale;
    out[column + 1] *= scale;
    out[column + 2] *= scale;
  }
}
