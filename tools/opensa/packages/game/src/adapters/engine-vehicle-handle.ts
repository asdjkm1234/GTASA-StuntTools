/**
 * The own-engine implementation of {@link VehicleHandle} (plan 074/08 B5 step 4) — the twin of
 * `three-vehicle-handle.ts`. Where three had a scene graph to mutate, here everything is a part matrix or a
 * submesh-visibility flag on a `VehicleInstance`:
 *   - the chassis pose is the entity ROOT (GTA Z-up → engine Y-up rides in that one matrix);
 *   - wheels/doors are per-part animation rotations (the door's hinge pivot is baked into the part);
 *   - `_ok`/`_dam` and the `_vlo` LOD band are submesh visibility (which is exactly what `.visible` was);
 *   - a detached panel gets its own WORLD matrix, bypassing the root — the graph-free stand-in for
 *     three's `parent.attach()`.
 */
import type { VehicleInstance } from '@opensa/engine';
import type { VehicleModelData } from '@opensa/renderware';

import { pickVariants } from '@opensa/renderware';

import type { Vec3 } from '../interfaces/world-adapter.interface';
import type {
  VehicleBand,
  VehicleHandle,
  VehiclePartInfo,
  VehiclePose,
  VehicleQuat,
  VehicleWheelInfo,
  VehicleWheelPose,
} from '../vehicle/vehicle-handle';
import type { VehicleLampState } from '../vehicle/vehicle-lamps';

import { withLightSmashed } from '../vehicle/vehicle-lamps';

/**
 * Just the ARTICULATION a handle animates — doors, dummies, wheels, parts, submeshes — and nothing about
 * how the model reached the GPU. Both spawn paths satisfy it structurally: the unoptimized path's
 * `VehicleModelData` and the optimized path's `.osm` `DESC` fixture (opensa-pack 003).
 */
export type VehicleRigData = Pick<
  VehicleModelData,
  'doors' | 'dummies' | 'parts' | 'popUpLights' | 'submeshes' | 'variants' | 'wheels'
>;

/** Column-major mat4 scratch for the detached-part world matrix. */
const WORLD = new Float32Array(16);

export class EngineVehicleHandle implements VehicleHandle {
  readonly hasLod: boolean;
  readonly hasPopUpLights: boolean;
  readonly parts: VehiclePartInfo[];
  readonly wheels: VehicleWheelInfo[];
  private band: VehicleBand = 'hd';
  private readonly damaged = new Set<string>();

  private readonly data: VehicleRigData;
  /**
   * Which `extraN` this CAR shows. SA's optional parts are mutually exclusive and the choice is a spawn
   * decision, not a build one — the model ships every alternative and each instance hides the rest, so a
   * street of the same car does not wear the same optional part. Null when the model has no extras (and on
   * a pak built before the builder started shipping them, where the choice was already baked in).
   */
  private readonly extra: null | string;

  private readonly instance: VehicleInstance;

  /** The last state the lamp system pushed — kept so a smashed lamp can be re-pushed without one. */
  private lamps: null | VehicleLampState = null;

  /** One bit per SA `eLights` index, set = SMASHED (`CDamageManager::m_nLightsStatus`). */
  private lights = 0;
  private readonly onDispose: () => void;

  /** The body's last rotation — a detaching panel inherits it (see `detachPart`). */
  private rotation: VehicleQuat = [0, 0, 0, 1];

  /** CLEO's script-absolute part poses (plan 097/05), lazily seeded from the bind pose. */
  private readonly scriptParts = new Map<number, { quat: VehicleQuat; translation: Vec3 }>();
  /** The VehFuncs options this CAR shows — one walk of the model's variant tree per spawn (`variants.ts`).
   *  Null when the model carries no tree; a tagged submesh is then never shown, which cannot happen (the
   *  builder tags only from a tree it also ships). */
  private readonly variants: null | ReadonlySet<string>;

  /**
   * The DRAWN pose of every wheel part, as last written by {@link setWheel} — what a script must read
   * back for that part instead of its own stale shadow.
   *
   * SA carries this for free: `CAutomobile` rebuilds each wheel node's modelling matrix every frame
   * from `m_wheelRotation`/steer/suspension, so a script reading `m_aCarNodes[CAR_WHEEL_*]`'s
   * `m_forward` sees the live roll. Ours drove the wheels straight onto the entity and left the
   * script-visible state at the bind pose, so `wheel_rb_dummy` reported an unrotated frame forever —
   * rhino's tread read a CONSTANT angle and never advanced (field 2026-08-07, plan
   * `cleo/scripts` 001 step 5).
   */
  private readonly wheelPose = new Map<number, { quat: VehicleQuat; translation: Vec3 }>();

  constructor(instance: VehicleInstance, data: VehicleRigData, onDispose: () => void) {
    this.instance = instance;
    this.data = data;
    this.onDispose = onDispose;
    this.hasLod = data.submeshes.some((submesh) => submesh.kind === 'lod');
    this.hasPopUpLights = data.popUpLights !== undefined;
    this.wheels = data.wheels.map((wheel) => ({ front: wheel.front, radius: wheel.radius }));
    // Damageable parts = those with a `_dam` twin, keyed by the damage group the builder paired them under.
    const groups = new Map<string, number>();
    for (const submesh of data.submeshes) {
      if (submesh.damageGroup !== null && !groups.has(submesh.damageGroup)) {
        groups.set(submesh.damageGroup, submesh.part);
      }
    }
    this.parts = [...groups].map(([name, part]) => ({
      name,
      position: [...data.parts[part].localTranslation] as [number, number, number],
    }));
    const extras = [
      ...new Set(data.submeshes.map((submesh) => submesh.extra).filter((name): name is string => !!name)),
    ];
    this.extra = extras.length > 0 ? extras[Math.floor(Math.random() * extras.length)] : null;
    // The VehFuncs tree is walked once per spawn too — the plugin's own behaviour on the SA target.
    this.variants = data.variants ? pickVariants(data.variants) : null;
    this.setLodBand('hd'); // `_dam`, `_vlo` and the extras this car did not draw start hidden
  }

  detachPart(name: string): null | VehiclePose {
    const part = this.partIndex(name);
    if (part === null) {
      return null;
    }
    // The part's CURRENT world matrix is already flattened in the entity — read the position straight off it,
    // so the panel comes off exactly where it was (three got this from `attach()` preserving the transform).
    // Its orientation is the BODY's: a bolted-on panel shares the car's rotation, and handing back identity
    // would snap it flat the instant it detached from a car that was moving.
    const matrix = this.instance.entity.matrices.subarray(part * 16, part * 16 + 16);

    return { position: engineToGta([matrix[12], matrix[13], matrix[14]]), rotation: [...this.rotation] };
  }

  dispose(): void {
    this.onDispose();
  }

  doorHinge(side: string): null | Vec3 {
    const door = this.data.doors.find((candidate) => candidate.side === side);

    return door ? [...this.data.parts[door.part].localTranslation] : null;
  }

  lampAnchor(kind: 'head' | 'tail'): null | Vec3 {
    const dummy = this.data.dummies.find(
      (candidate) => candidate.name === (kind === 'head' ? 'headlights' : 'taillights'),
    );

    return dummy ? [...dummy.position] : null;
  }

  lightsSmashed(): number {
    return this.lights;
  }

  removeDetached(name: string): void {
    const part = this.partIndex(name);
    if (part !== null) {
      this.setPartSubmeshesVisible(part, false);
    }
  }

  scriptPartCount(): number {
    return this.data.parts.length;
  }

  /** By FRAME name (`misc_a`, `dvan_l`…) — the damage-group lookup below serves a different space. */
  scriptPartIndex(name: string): null | number {
    const wanted = name.trim().toLowerCase();
    const index = this.data.parts.findIndex((part) => part.name.trim().toLowerCase() === wanted);

    return index >= 0 ? index : null;
  }

  /** A wheel reports what it is DRAWN at; every other part reports the script's own absolute pose. */
  scriptPartLocalRotation(part: number): VehicleQuat {
    return this.wheelPose.get(part)?.quat ?? this.scriptState(part).quat;
  }

  scriptPartLocalTranslation(part: number): Vec3 {
    return this.wheelPose.get(part)?.translation ?? this.scriptState(part).translation;
  }

  /** ABSOLUTE local rotation (SA's SetRotate* replaces the matrix): the engine's anim channel is
   *  applied AFTER the bind rotation (`R = bind ⊗ anim`), so anim = conj(bind) ⊗ target. */
  scriptSetPartLocalRotation(part: number, quat: VehicleQuat): void {
    const bind = this.data.parts[part]?.localRotation;
    if (!bind) {
      return;
    }
    this.scriptState(part).quat = [...quat];
    this.instance.entity.setPartRotation(part, quatMul(quatInvert(bind), quat));
  }

  /** ABSOLUTE local translation: the engine's channel is a DELTA on the bind translation. */
  scriptSetPartLocalTranslation(part: number, translation: Vec3): void {
    const bind = this.data.parts[part]?.localTranslation;
    if (!bind) {
      return;
    }
    this.scriptState(part).translation = [...translation];
    this.instance.entity.setPartTranslation(part, [
      translation[0] - bind[0],
      translation[1] - bind[1],
      translation[2] - bind[2],
    ]);
  }
  setDetachedPose(name: string, pose: VehiclePose): void {
    const part = this.partIndex(name);
    if (part === null) {
      return;
    }
    writeWorld(WORLD, gtaToEngine(pose.position), pose.rotation);
    this.instance.entity.setPartWorldMatrix(part, WORLD);
  }
  setDoorAngle(side: string, angle: number): void {
    const door = this.data.doors.find((candidate) => candidate.side === side);
    if (!door) {
      return;
    }
    // The hinge frame IS the part's pivot (the builder put it there), so the swing is a plain Z rotation.
    const swing = axisAngle(2, angle);
    this.instance.entity.setPartRotation(door.part, swing);
    if (!door.parts) {
      return;
    }
    // SA swings the hinge FRAME, so every part authored under it (a mod's separate glass/trim atomics)
    // travels with the door. Each member rotates about the HINGE, not its own pivot: same rotation carried
    // into body axes (conjugated by the hinge's bind rotation, so scissor doors keep their swing plane) and
    // then into the member's own local frame, plus the translation that turns a rotation-about-own-pivot
    // into a rotation-about-the-hinge. For the common export (member pivot ON the hinge, identity-rotated)
    // both corrections are zero.
    const hinge = this.data.parts[door.part];
    const world = quatMul(quatMul(hinge.localRotation, swing), quatInvert(hinge.localRotation));
    for (const member of door.parts) {
      if (member === door.part) {
        continue;
      }
      const part = this.data.parts[member];
      this.instance.entity.setPartRotation(
        member,
        quatMul(quatMul(quatInvert(part.localRotation), world), part.localRotation),
      );
      const toHinge: [number, number, number] = [
        hinge.localTranslation[0] - part.localTranslation[0],
        hinge.localTranslation[1] - part.localTranslation[1],
        hinge.localTranslation[2] - part.localTranslation[2],
      ];
      const rotated = quatRotate(world, toHinge);
      this.instance.entity.setPartTranslation(member, [
        toHinge[0] - rotated[0],
        toHinge[1] - rotated[1],
        toHinge[2] - rotated[2],
      ]);
    }
  }

  setLamps(state: VehicleLampState): void {
    this.lamps = state;
    this.instance.setLamps(state.headlights, state.brakes, state.intensity, this.lights);
  }

  setLightSmashed(light: number, smashed: boolean): void {
    const lights = withLightSmashed(this.lights, light, smashed);
    if (lights === this.lights) {
      return; // unchanged — or an index that is not a lamp at all
    }
    this.lights = lights;
    // Push it NOW rather than waiting for the next lamp update: only the DRIVEN car gets one, so a script
    // smashing the lights of anything else would otherwise leave the GPU reading the old mask forever.
    if (this.lamps) {
      this.instance.setLamps(this.lamps.headlights, this.lamps.brakes, this.lamps.intensity, lights);
    }
  }

  setLodBand(band: VehicleBand): void {
    const showLod = band === 'vlo';
    const culled = band === 'culled';
    this.data.submeshes.forEach((submesh, index) => {
      const damaged = submesh.damageGroup !== null && this.damaged.has(submesh.damageGroup);
      let visible: boolean;
      if (submesh.kind === 'lod') {
        visible = showLod;
      } else if (submesh.kind === 'dam') {
        visible = !showLod && damaged;
      } else {
        visible = !showLod && !damaged;
      }
      // An optional part only exists on the car that drew it — the alternatives sit in the same spot and
      // would render as one overlapping jumble.
      const wrongExtra = !!submesh.extra && submesh.extra !== this.extra;
      const wrongVariant = submesh.variant !== undefined && !this.variants?.has(submesh.variant);
      this.instance.setSubmeshVisible(index, visible && !culled && !wrongExtra && !wrongVariant);
    });
    this.band = band;
  }

  setPartDamaged(name: string, damaged: boolean): void {
    if (damaged) {
      this.damaged.add(name);
    } else {
      this.damaged.delete(name);
    }
    this.setLodBand(this.band); // one place decides visibility — damage and LOD compose
  }

  setPopUpLights(open: number): void {
    const popUp = this.data.popUpLights;
    if (popUp) {
      // About the pod's own X — the lateral axis it hinges on. The ANGLE came from the model (the pitch its
      // lamps are parked at), so nothing here knows which car it is.
      this.instance.entity.setPartRotation(popUp.part, axisAngle(0, open * popUp.angle));
    }
  }

  setTransform(position: Vec3, rotation: VehicleQuat): void {
    this.rotation = rotation;
    writeWorld(WORLD, gtaToEngine(position), rotation);
    this.instance.entity.setRoot(WORLD);
  }

  setWheel(index: number, pose: VehicleWheelPose): void {
    const wheel = this.data.wheels[index];
    if (!wheel) {
      return;
    }
    // Steer about the vehicle's up (Z), then CAMBER about the wheel's own forward (Y), then spin about the
    // axle (X). The order is the whole correctness of this line (plan 081/06 §3.3): a steered wheel must lean
    // about ITS forward axis and not the body's, and the spin has to be innermost or it drags the lean round
    // with it — a wheel that cambers while rolling would wobble like a bent rim.
    const anim = quatMul(quatMul(axisAngle(2, pose.steer), axisAngle(1, pose.camber)), axisAngle(0, pose.spin));
    this.instance.entity.setPartRotation(wheel.part, anim);
    // Suspension travel: the wheel part slides along the body's local Z (the model frame is Z-up like GTA).
    this.instance.entity.setPartTranslation(wheel.part, [0, 0, pose.lift]);
    // Publish it in the SAME space a script reads (absolute part-local = bind then anim) — see wheelPose.
    const bind = this.data.parts[wheel.part];
    this.wheelPose.set(wheel.part, {
      quat: bind ? quatMul(bind.localRotation, anim) : anim,
      translation: bind
        ? [bind.localTranslation[0], bind.localTranslation[1], bind.localTranslation[2] + pose.lift]
        : [0, 0, pose.lift],
    });
  }

  private partIndex(name: string): null | number {
    const submesh = this.data.submeshes.find((candidate) => candidate.damageGroup === name);

    return submesh ? submesh.part : null;
  }

  /** Script-absolute part state, lazily seeded from the bind pose. */
  private scriptState(part: number): { quat: VehicleQuat; translation: Vec3 } {
    let state = this.scriptParts.get(part);
    if (!state) {
      const bind = this.data.parts[part];
      state = {
        quat: bind ? [...bind.localRotation] : [0, 0, 0, 1],
        translation: bind ? [...bind.localTranslation] : [0, 0, 0],
      };
      this.scriptParts.set(part, state);
    }

    return state;
  }

  private setPartSubmeshesVisible(part: number, visible: boolean): void {
    this.data.submeshes.forEach((submesh, index) => {
      if (submesh.part === part) {
        this.instance.setSubmeshVisible(index, visible);
      }
    });
  }
}

/** GTA (Z-up) world position → the engine's Y-up frame. Exported alongside {@link writeGtaRoot}. */
export function gtaPositionToEngine(position: Vec3): [number, number, number] {
  return gtaToEngine(position);
}

/**
 * Column-major root: translate(engine position) × (GTA Z-up → engine Y-up basis change) × R(body rotation).
 * The geometry stays in its native RW frame; this one matrix carries the whole convention. Exported because
 * the SEATED PLAYER needs exactly the same math — prod seats the rider on the car's FULL transform (so he
 * tilts and rolls with it), which a yaw-only matrix cannot express.
 */
export function writeGtaRoot(
  out: Float32Array,
  position: readonly [number, number, number],
  rotation: VehicleQuat,
): void {
  writeWorld(out, position, rotation);
}

/** Axis-angle quaternion about axis 0 = X, 1 = Y, 2 = Z (vehicle-local, native GTA axes). */
function axisAngle(axis: number, angle: number): [number, number, number, number] {
  const half = angle / 2;
  const s = Math.sin(half);
  const quat: [number, number, number, number] = [0, 0, 0, Math.cos(half)];
  quat[axis] = s;

  return quat;
}

/** Engine (Y-up) → GTA (Z-up): the inverse of {@link gtaToEngine}. */
function engineToGta(position: readonly [number, number, number]): Vec3 {
  return [position[0], -position[2], position[1]];
}

/** GTA (Z-up) → engine (Y-up): e = (x, z, −y), the same axis change the cell converter bakes. */
function gtaToEngine(position: Vec3): [number, number, number] {
  return [position[0], position[2], -position[1]];
}

/** Unit-quaternion inverse (conjugate) — bind rotations are unit by construction. */
function quatInvert(q: readonly [number, number, number, number]): [number, number, number, number] {
  return [-q[0], -q[1], -q[2], q[3]];
}

function quatMul(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2],
    a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Rotate a vector by a unit quaternion: v' = q v q⁻¹. */
function quatRotate(
  q: readonly [number, number, number, number],
  v: readonly [number, number, number],
): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  // t = 2 (q.xyz × v); v' = v + qw t + q.xyz × t
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);

  return [v[0] + qw * tx + qy * tz - qz * ty, v[1] + qw * ty + qz * tx - qx * tz, v[2] + qw * tz + qx * ty - qy * tx];
}

function writeWorld(out: Float32Array, position: readonly [number, number, number], rotation: VehicleQuat): void {
  const [x, y, z, w] = rotation;
  // R (GTA space), column-major 3×3.
  const r = [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
  ];
  // Basis change B = (x, z, −y) applied to each rotated column: engine = B · R.
  for (let column = 0; column < 3; column += 1) {
    const [rx, ry, rz] = [r[column * 3], r[column * 3 + 1], r[column * 3 + 2]];
    out[column * 4] = rx;
    out[column * 4 + 1] = rz;
    out[column * 4 + 2] = -ry;
    out[column * 4 + 3] = 0;
  }
  out[12] = position[0];
  out[13] = position[1];
  out[14] = position[2];
  out[15] = 1;
}
