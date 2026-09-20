/**
 * Own IFP clip sampler (plan 074/08, the B1 probe): keyframe slerp over pre-extracted clip tracks → a bone
 * palette (world × inverseBind per bone, column-major mat4). The prod path rode three's AnimationMixer —
 * NOT portable; this is the thin replacement the dynamics milestone builds on. Pure math, no dependencies.
 *
 * Conventions (fixed by the ped model format — `readPedOsm` / `build-ped-model.ts`):
 * - bones are in SKIN order, parents point at skin indices (−1 = root), locals = frame bind pose;
 * - a bone with an empty track holds its bind rotation (prod behaviour);
 * - root translation is NOT animated (locomotion stays in-place — gameplay owns the position);
 * - the palette buffer layout is [model matrix, bone 0, bone 1, …] — the sampler writes from slot 1.
 */

export interface SamplerBone {
  bindPosition: readonly [number, number, number];
  bindRotation: readonly [number, number, number, number];
  /** 16 floats, column-major (bone → model space inverted). */
  inverseBind: readonly number[];
  /** Skin-order parent index; −1 for the root. */
  parent: number;
}

export interface SamplerClip {
  duration: number;
  /**
   * Per skin-order bone: keyframe times (seconds, ascending) + quats (x,y,z,w × keyCount), and — for MAP
   * OBJECTS (074/08 B7·b) — an optional translation track (x,y,z × keyCount).
   *
   * A ped's clip deliberately has none: its locomotion is in-place and gameplay owns the position. A garage
   * door, though, SLIDES; drop its translation and the door merely rotates on the spot.
   */
  tracks: readonly { positions?: readonly number[]; quats: readonly number[]; times: readonly number[] }[];
}

/** Scratch reused across frames (bone count fixed per fixture) — the steady-state frame allocates zero. */
export class IfpSampler {
  /** Frozen local pose `holdPose` captured — the retarget source for interrupted crossfades. */
  private readonly holdPositions: Float32Array;
  private readonly holdQuats: Float32Array;
  /** Local pose of the LAST sample call (what is on screen) — `holdPose` freezes it. */
  private readonly lastPositions: Float32Array;
  private readonly lastQuats: Float32Array;
  private readonly local = new Float32Array(16);
  private readonly position = new Float32Array(3);
  private readonly positionB = new Float32Array(3);
  private readonly quat = new Float32Array(4);
  private readonly quatB = new Float32Array(4);
  private readonly worlds: Float32Array;

  constructor(private readonly bones: readonly SamplerBone[]) {
    this.worlds = new Float32Array(bones.length * 16);
    this.lastQuats = new Float32Array(bones.length * 4);
    this.lastPositions = new Float32Array(bones.length * 3);
    this.holdQuats = new Float32Array(bones.length * 4);
    this.holdPositions = new Float32Array(bones.length * 3);
    // Before any sample the last/held pose IS the bind pose — sampling from an empty hold stays defined.
    bones.forEach((bone, index) => {
      this.lastQuats.set(bone.bindRotation, index * 4);
      this.lastPositions.set(bone.bindPosition, index * 3);
    });
    this.holdQuats.set(this.lastQuats);
    this.holdPositions.set(this.lastPositions);
  }

  /** Freeze the last sampled local pose as the `sampleFromHold` source (plan 088/02 crossfade retarget). */
  holdPose(): void {
    this.holdQuats.set(this.lastQuats);
    this.holdPositions.set(this.lastPositions);
  }

  /** Sample `clip` at `time` (wraps by duration) and write bone palettes into `out` from `outSlot`. */
  sample(clip: SamplerClip, time: number, out: Float32Array, outSlot = 1): void {
    const looped = wrap(time, clip.duration);
    for (let bone = 0; bone < this.bones.length; bone += 1) {
      this.evaluateBone(clip, looped, bone, this.quat, this.position);
      this.writeBone(bone, out, outSlot);
    }
  }

  /**
   * Crossfade (plan 088/02): sample BOTH clips and blend the per-bone LOCAL quats/positions before
   * composing — blending the final palette matrices would shear. `alpha` 0 = pure `from`, 1 = pure `to`.
   */
  sampleBlended(
    from: SamplerClip,
    fromTime: number,
    to: SamplerClip,
    toTime: number,
    alpha: number,
    out: Float32Array,
    outSlot = 1,
  ): void {
    if (alpha <= 0) {
      this.sample(from, fromTime, out, outSlot);

      return;
    }
    if (alpha >= 1) {
      this.sample(to, toTime, out, outSlot);

      return;
    }
    const fromLooped = wrap(fromTime, from.duration);
    const toLooped = wrap(toTime, to.duration);
    for (let bone = 0; bone < this.bones.length; bone += 1) {
      this.evaluateBone(from, fromLooped, bone, this.quat, this.position);
      this.evaluateBone(to, toLooped, bone, this.quatB, this.positionB);
      this.blendScratch(alpha);
      this.writeBone(bone, out, outSlot);
    }
  }

  /** Blend the frozen `holdPose` pose into `to` — the pop-free source when a fade is interrupted. */
  sampleFromHold(to: SamplerClip, toTime: number, alpha: number, out: Float32Array, outSlot = 1): void {
    if (alpha >= 1) {
      this.sample(to, toTime, out, outSlot);

      return;
    }
    const toLooped = wrap(toTime, to.duration);
    for (let bone = 0; bone < this.bones.length; bone += 1) {
      this.quat.set(this.holdQuats.subarray(bone * 4, bone * 4 + 4));
      this.position.set(this.holdPositions.subarray(bone * 3, bone * 3 + 3));
      this.evaluateBone(to, toLooped, bone, this.quatB, this.positionB);
      this.blendScratch(alpha);
      this.writeBone(bone, out, outSlot);
    }
  }

  /** scratch quat/position ← blend(scratch, scratchB, alpha): quat slerp + position lerp. */
  private blendScratch(alpha: number): void {
    slerpBetween(this.quat, this.quatB, alpha);
    for (let axis = 0; axis < 3; axis += 1) {
      this.position[axis] += (this.positionB[axis] - this.position[axis]) * alpha;
    }
  }

  /** One bone's local rotation + translation from `clip` at the pre-wrapped `looped` time. */
  private evaluateBone(
    clip: SamplerClip,
    looped: number,
    bone: number,
    quat: Float32Array,
    position: Float32Array,
  ): void {
    const definition = this.bones[bone];
    const track = clip.tracks[bone];
    if (track && track.times.length > 0) {
      sampleQuat(track, looped, quat);
    } else {
      quat.set(definition.bindRotation);
    }
    // A translated bone only exists on map-object clips; a ped's bones keep their bind position.
    if (track?.positions && track.times.length > 0) {
      samplePosition(track, looped, position);
    } else {
      position.set(definition.bindPosition);
    }
  }

  /** Record the scratch local (for `holdPose`), compose, walk the parent chain, write the palette slot. */
  private writeBone(bone: number, out: Float32Array, outSlot: number): void {
    const definition = this.bones[bone];
    this.lastQuats.set(this.quat, bone * 4);
    this.lastPositions.set(this.position, bone * 3);
    composeLocal(this.local, this.quat, this.position);
    const world = this.worlds.subarray(bone * 16, bone * 16 + 16);
    if (definition.parent >= 0) {
      multiply(world, this.worlds.subarray(definition.parent * 16, definition.parent * 16 + 16), this.local);
    } else {
      world.set(this.local);
    }
    multiply(out.subarray((outSlot + bone) * 16, (outSlot + bone) * 16 + 16), world, definition.inverseBind);
  }
}

/** out = translation(position) × rotation(quat), column-major mat4. Shared with the rigid-entity layer. */
export function composePosQuat(
  out: Float32Array,
  quat: ArrayLike<number>,
  position: readonly [number, number, number],
): void {
  composeLocal(out, quat, position);
}

/** out = a × b (column-major 4×4); `out` must not alias inputs. Shared with the rigid-entity layer. */
export function mulMat4(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
  multiply(out, a, b);
}

/** local = translation(bindPosition) × rotation(quat), column-major. */
function composeLocal(out: Float32Array, quat: ArrayLike<number>, position: ArrayLike<number>): void {
  const [x, y, z, w] = [quat[0], quat[1], quat[2], quat[3]];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[0] = 1 - (yy + zz);
  out[1] = xy + wz;
  out[2] = xz - wy;
  out[3] = 0;
  out[4] = xy - wz;
  out[5] = 1 - (xx + zz);
  out[6] = yz + wx;
  out[7] = 0;
  out[8] = xz + wy;
  out[9] = yz - wx;
  out[10] = 1 - (xx + yy);
  out[11] = 0;
  out[12] = position[0];
  out[13] = position[1];
  out[14] = position[2];
  out[15] = 1;
}

function copyQuat(out: Float32Array, quats: readonly number[], at: number): void {
  out[0] = quats[at];
  out[1] = quats[at + 1];
  out[2] = quats[at + 2];
  out[3] = quats[at + 3];
}

/** out = a × b (column-major 4×4). `out` must not alias `a` or `b`. */
function multiply(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
  for (let column = 0; column < 4; column += 1) {
    const b0 = b[column * 4];
    const b1 = b[column * 4 + 1];
    const b2 = b[column * 4 + 2];
    const b3 = b[column * 4 + 3];
    out[column * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[column * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[column * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[column * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
}

/** Linear keyframe lerp of a bone's TRANSLATION track (map objects only — a garage door slides). */
function samplePosition(
  track: { positions?: readonly number[]; times: readonly number[] },
  time: number,
  out: Float32Array,
): void {
  const positions = track.positions;
  if (!positions) {
    return;
  }
  const times = track.times;
  const last = times.length - 1;
  if (time <= times[0]) {
    out.set(positions.slice(0, 3));

    return;
  }
  if (time >= times[last]) {
    out.set(positions.slice(last * 3, last * 3 + 3));

    return;
  }
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (times[mid] <= time) {
      low = mid;
    } else {
      high = mid;
    }
  }
  const span = times[high] - times[low] || 1;
  const t = (time - times[low]) / span;
  for (let axis = 0; axis < 3; axis += 1) {
    out[axis] = positions[low * 3 + axis] + (positions[high * 3 + axis] - positions[low * 3 + axis]) * t;
  }
}

/** Binary-search the keyframe pair around `time`, slerp into `out` (shortest path). */
function sampleQuat(
  track: { quats: readonly number[]; times: readonly number[] },
  time: number,
  out: Float32Array,
): void {
  const times = track.times;
  const last = times.length - 1;
  if (time <= times[0]) {
    copyQuat(out, track.quats, 0);

    return;
  }
  if (time >= times[last]) {
    copyQuat(out, track.quats, last * 4);

    return;
  }
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (times[mid] <= time) {
      low = mid;
    } else {
      high = mid;
    }
  }
  const t = (time - times[low]) / (times[high] - times[low] || 1);
  slerp(out, track.quats, low * 4, high * 4, t);
}

function slerp(out: Float32Array, quats: readonly number[], a: number, b: number, t: number): void {
  let bx = quats[b];
  let by = quats[b + 1];
  let bz = quats[b + 2];
  let bw = quats[b + 3];
  const ax = quats[a];
  const ay = quats[a + 1];
  const az = quats[a + 2];
  const aw = quats[a + 3];
  let cosom = ax * bx + ay * by + az * bz + aw * bw;
  if (cosom < 0) {
    cosom = -cosom;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let scale0: number;
  let scale1: number;
  if (1 - cosom > 1e-6) {
    const omega = Math.acos(Math.min(1, cosom));
    const sinom = Math.sin(omega);
    scale0 = Math.sin((1 - t) * omega) / sinom;
    scale1 = Math.sin(t * omega) / sinom;
  } else {
    scale0 = 1 - t;
    scale1 = t;
  }
  out[0] = scale0 * ax + scale1 * bx;
  out[1] = scale0 * ay + scale1 * by;
  out[2] = scale0 * az + scale1 * bz;
  out[3] = scale0 * aw + scale1 * bw;
}

/** a ← slerp(a, b, t), shortest path — the two-clip blend twin of the keyframe `slerp` below. */
function slerpBetween(a: Float32Array, b: Float32Array, t: number): void {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let cosom = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cosom < 0) {
    cosom = -cosom;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let scale0: number;
  let scale1: number;
  if (1 - cosom > 1e-6) {
    const omega = Math.acos(Math.min(1, cosom));
    const sinom = Math.sin(omega);
    scale0 = Math.sin((1 - t) * omega) / sinom;
    scale1 = Math.sin(t * omega) / sinom;
  } else {
    scale0 = 1 - t;
    scale1 = t;
  }
  a[0] = scale0 * a[0] + scale1 * bx;
  a[1] = scale0 * a[1] + scale1 * by;
  a[2] = scale0 * a[2] + scale1 * bz;
  a[3] = scale0 * a[3] + scale1 * bw;
}

/** Clip-local time: wraps by duration, holds 0 for the zero-duration (unresolved) clip. */
function wrap(time: number, duration: number): number {
  return duration > 0 ? time % duration : 0;
}
