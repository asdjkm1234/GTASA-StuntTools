/**
 * ANIMATED map objects on the own engine (074/08 B7·b): garage doors, windmills, the spinning signs.
 *
 * These are not skinned meshes. The DFF is a multi-frame CLUMP and the IFP's "bones" are its FRAMES, matched
 * by name — each atomic rides one frame rigidly. So the existing pieces already do the whole job:
 *   · `IfpSampler` composes the frame chain (a frame tree IS a skeleton where every vertex has one bone);
 *   · the rigid entity's `setPartWorldMatrix` — written for damage debris — drives each atomic from it.
 * No new pipeline, no new shader.
 *
 * The CONVERTER leaves only the MOVING frames out of the cell bundle, so what this module draws is the moving
 * part alone: `burger01_LAw` is a 22 × 35 m diner that lives in the anim section purely because its sign
 * spins, and dragging the whole diner out of the merged batch (or, worse, dropping it — the "blue hole" of
 * plan 041) would be a poor trade for one sign.
 */
import type { Engine, SamplerClip, VehicleInstance, VehicleModelId } from '@opensa/engine';
import type { AnimatedPlacement, GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import type { RigidModelInit } from '@opensa/game/adapters/vehicle-model-init';
import type { AssetFileSystem } from '@opensa/renderware';
import type { AnimFrame, FrameBone } from '@opensa/renderware/anim/frame-clip';

import { IfpSampler } from '@opensa/engine';
import { decodeOsm, decodeOsmSkeleton, osmSection, OsmSectionTag } from '@opensa/engine-formats';
import { toRigidModelInit } from '@opensa/game/adapters/vehicle-model-init';
import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';
import { animatedFrames, clipForModel, frameBones, frameClip } from '@opensa/renderware/anim/frame-clip';
import { getClump, getIfp, getTxdChain } from '@opensa/renderware/archive/asset-cache';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

/** Spawn radius (m). Only ~64 of these exist map-wide, so the whole list is scanned; this just bounds draws. */
const RANGE = 300;
/**
 * How many objects may be BORN in one frame. Creating a model means a DFF parse, an IFP parse, GPU buffers, a
 * texture and a bind group — about 3 ms of CPU each, but the GPU-resource creation is what stalls the main
 * thread, and several at once cost a visible hitch (84 ms measured, walking up to the windmill). The clip is a
 * loop nobody is watching yet, so a few frames of delay is free.
 */
const SPAWNS_PER_FRAME = 1;
/** Leave before you re-enter: without hysteresis an object sitting exactly at the edge respawns every frame. */
const DESPAWN_RANGE = RANGE + 40;

export interface EngineAnimObjects {
  /** Spawn/retire by range and advance every live clip. */
  update(seconds: number, eye: readonly [number, number, number]): void;
}

interface AnimModel {
  bones: FrameBone[];
  clip: SamplerClip;
  id: VehicleModelId;
  /** Which part indices move — the rest are welded into the cell and must stay hidden here. */
  moving: Map<number, number>;
  /** Submesh → part, so the static submeshes can be hidden (the engine gates visibility per submesh). */
  submeshParts: number[];
}

/**
 * What driving an animated object needs, from either side of the optimized/unoptimized split: the frame
 * tree the IFP matches by name, the parts/submeshes the builder produced, and the engine-ready upload.
 */
interface AnimSource {
  frames: readonly AnimFrame[];
  init: RigidModelInit;
  parts: readonly { name: string }[];
  submeshes: readonly { part: number }[];
}

interface Live {
  instance: VehicleInstance;
  model: AnimModel;
  palette: Float32Array;
  placement: AnimatedPlacement;
  sampler: IfpSampler;
}

export function setupEngineAnimObjects(
  engine: Engine,
  fs: AssetFileSystem,
  adapter: GtaSaWorldAdapter,
): EngineAnimObjects {
  const placements = adapter.animatedPlacements();
  const models = new Map<string, AnimModel | null>();
  const live = new Map<number, Live>();
  const world = new Float32Array(16);

  const modelOf = (placement: AnimatedPlacement): AnimModel | null => {
    const cached = models.get(placement.modelName);
    if (cached !== undefined) {
      return cached;
    }
    let built: AnimModel | null = null;
    try {
      // OPTIMIZED first (opensa-pack 003 phase 5): the `SKEL` section IS the frame tree, so the clip, the
      // moving-part map and the sampler bones all resolve with no clump. The IFP stays a separate asset —
      // baking the clip into the model would freeze a binding a mod is allowed to change.
      const source = optimizedSource(fs, placement.modelName) ?? unoptimizedSource(fs, placement);
      const animation = clipForModel(getIfp(fs, placement.anim), placement.modelName);
      const moved = animation ? animatedFrames(source.frames, animation) : new Set<number>();
      if (animation && moved.size > 0) {
        // The builder names each part after its frame — that is the ONLY link back to the clip, whose bones
        // are frame names too. Parts whose frame does not move belong to the bundle, not to us.
        const frameOf = new Map<string, number>();
        source.frames.forEach((frame, index) => frameOf.set(frame.name.trim().toLowerCase(), index));
        const moving = new Map<number, number>();
        source.parts.forEach((part, index) => {
          const frame = frameOf.get(part.name.trim().toLowerCase());
          if (frame !== undefined && moved.has(frame)) {
            moving.set(index, frame);
          }
        });
        built = {
          bones: frameBones(source.frames),
          clip: frameClip(source.frames, animation),
          id: engine.createVehicleModel(source.init),
          moving,
          submeshParts: source.submeshes.map((submesh) => submesh.part),
        };
      }
    } catch (error) {
      built = null; // a model we cannot build simply stays as the converter welded it…
      // …but never SILENTLY (085 row G): the converter left this model's moving frames OUT of the cell
      // bundle, so a swallowed build failure here means the object is simply MISSING in the world — the
      // exact "mod 46 radars are invisible" field report, undiagnosable without the name and the error.
      // eslint-disable-next-line no-console -- a hole in the world must not fail silently
      console.warn(`[anim-objects] ${placement.modelName} failed to build — its moving parts stay missing:`, error);
    }
    models.set(placement.modelName, built);

    return built;
  };

  const spawn = (index: number, placement: AnimatedPlacement): void => {
    const model = modelOf(placement);
    if (!model || model.moving.size === 0) {
      return;
    }
    const instance = engine.createVehicle(model.id);
    // Everything that does NOT move is already in the cell bundle: draw it again and it z-fights with itself.
    model.submeshParts.forEach((part, submesh) => {
      if (!model.moving.has(part)) {
        instance.setSubmeshVisible(submesh, false);
      }
    });
    live.set(index, {
      instance,
      model,
      palette: new Float32Array((model.bones.length + 1) * 16),
      placement,
      sampler: new IfpSampler(model.bones),
    });
  };

  return {
    update(seconds: number, eye: readonly [number, number, number]): void {
      let born = 0;
      placements.forEach((placement, index) => {
        const distance = Math.hypot(
          placement.position[0] - eye[0],
          placement.position[1] - eye[1],
          placement.position[2] - eye[2],
        );
        const entry = live.get(index);
        if (entry && distance > DESPAWN_RANGE) {
          engine.destroyVehicle(entry.instance);
          live.delete(index);

          return;
        }
        if (!entry) {
          if (distance <= RANGE && born < SPAWNS_PER_FRAME) {
            born += 1;
            spawn(index, placement);
          }

          return;
        }
        // The clip is ALWAYS playing — SA has no trigger for these, and neither does prod.
        entry.sampler.sample(entry.model.clip, seconds, entry.palette);
        for (const [part, frame] of entry.model.moving) {
          composeWorld(world, entry.placement, entry.palette.subarray((frame + 1) * 16, (frame + 2) * 16));
          entry.instance.entity.setPartWorldMatrix(part, world);
        }
      });
      if (live.size > 0) {
        engine.updateVehicles(); // flatten + upload, exactly as the felled props do
      }
    },
  };
}

/**
 * `placement × frameWorld`, then GTA (Z-up) → engine (Y-up).
 *
 * The mesh's vertices stay in GTA model space, so the basis change rides on the LEFT of the whole product:
 * every column, and the translation, goes through e = (x, z, −y). Convert one and not the other and the part
 * ends up mirrored about the floor.
 */
function composeWorld(out: Float32Array, placement: AnimatedPlacement, frame: Float32Array): void {
  const [qx, qy, qz, qw] = placement.rotation;
  // The IPL quaternion is the CONJUGATE of the maths convention (plan 041 / the collider builder agree).
  const r = quatMatrix(-qx, -qy, -qz, qw);
  for (let column = 0; column < 3; column += 1) {
    const [x, y, z] = [frame[column * 4], frame[column * 4 + 1], frame[column * 4 + 2]];
    const gx = r[0] * x + r[3] * y + r[6] * z;
    const gy = r[1] * x + r[4] * y + r[7] * z;
    const gz = r[2] * x + r[5] * y + r[8] * z;
    out[column * 4] = gx;
    out[column * 4 + 1] = gz;
    out[column * 4 + 2] = -gy;
    out[column * 4 + 3] = 0;
  }
  const [px, py, pz] = [frame[12], frame[13], frame[14]];
  const wx = r[0] * px + r[3] * py + r[6] * pz + placement.position[0];
  const wy = r[1] * px + r[4] * py + r[7] * pz + placement.position[1];
  const wz = r[2] * px + r[5] * py + r[8] * pz + placement.position[2];
  out[12] = wx;
  out[13] = wz;
  out[14] = -wy;
  out[15] = 1;
}

/** The converted model: `SKEL` + the rigid sections. Null when this object is not converted. */
function optimizedSource(fs: AssetFileSystem, modelName: string): AnimSource | null {
  const osm = fs.get(`${modelName.toLowerCase()}.osm`);
  if (!osm) {
    return null;
  }
  const bytes = new Uint8Array(osm);
  const section = osmSection(decodeOsm(bytes), OsmSectionTag.SKEL);
  if (!section) {
    return null; // converted, but not as an animated object — fall back to the clump
  }
  const { fixture, model } = readModelOsm(modelName, bytes);

  return {
    frames: decodeOsmSkeleton(section).frames,
    init: model,
    parts: fixture.parts,
    submeshes: fixture.submeshes,
  };
}

/** Column-major 3×3 of a quaternion. */
function quatMatrix(x: number, y: number, z: number, w: number): number[] {
  return [
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
}

/** The stock or modded DFF/TXD, parsed and built on first spawn in range. */
function unoptimizedSource(fs: AssetFileSystem, placement: AnimatedPlacement): AnimSource {
  const clump = getClump(fs, placement.modelName);
  const model = buildVehicleModel(clump, new VehicleTextures(getTxdChain(fs, placement.txdName)));

  return { frames: clump.frames, init: toRigidModelInit(model), parts: model.parts, submeshes: model.submeshes };
}
