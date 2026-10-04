/**
 * Vehicle → `.osm` (plan opensa-pack/003 phase 2). The OPTIMIZED half of the optimized/unoptimized split:
 * everything the game currently does at SPAWN time — parse the DFF, build the model, walk the chunk tree
 * for the embedded COL, map faces into indices, derive half-extents — happens here instead, once, offline.
 *
 * The generic half lives in `model-osm.ts` (every rigid class bakes the same way); what is vehicle-specific
 * is the `COLL` section and the shared `vehicle.txd` sets appended below the car's own dictionary.
 */
import type { AssetFileSystem } from '@opensa/renderware/archive/asset-fs';
import type { VehicleFixture, VehicleModelData } from '@opensa/renderware/vehicle/types';

import { encodeOsmCollision, type OsmCollision, type OsmSection, OsmSectionTag } from '@opensa/engine-formats';
import { parseDffCollision } from '@opensa/renderware/parsers/binary/col';

import { buildModelOsm } from './model-osm';

/** Half-extents when a DFF carries no collision — the runtime's own fallback (`gta-sa-world.adapter.ts`). */
const DEFAULT_HALF_EXTENTS: [number, number, number] = [1.2, 2.5, 0.7];

/** The shared sets a car's own dictionary falls back to, lowest priority last. */
const SHARED_VEHICLE_TXDS = ['vehicle.txd', 'models/generic/vehicle.txd'];

export interface VehicleOsm {
  /** The `.osm` bytes: `DESC` (fixture JSON) + `GEOM` (buffers) + `COLL` (baked collision). */
  bytes: Uint8Array;
  fixture: VehicleFixture;
  /** True when the source DFF carried collision (false = the fallback box was baked). */
  hasCollision: boolean;
  /** The model's dictionary — the `TEXS` section payload (one `.ostex` per texture size in use). */
  ostex: Uint8Array;
  /** The sections themselves, for merging with another class's contribution to the same model. */
  sections: OsmSection[];
  texture: VehicleModelData['texture'];
  /** Non-fatal degradations from the bake, e.g. a dictionary that fell back to the single-array shape. */
  warnings: string[];
}

export interface VehicleOsmOptions {
  /** Emit the car's dictionary as RGBA8 — the model half of `--rgba8` (a car is not in the pak). */
  forceRgba8?: boolean;
  /** `features.txt` → `UP/DOWN_LIGHTS`: force the retractable-headlight component on a pod whose faces
   *  carry no head-lamp marker. */
  popUpLights?: boolean;
  /** `vehicles.ide` txd name — defaults to the model name, which is what stock SA uses for every car. */
  txd?: string;
  /** `vehicles.ide` wheelScale as [front, rear]. */
  wheelScale?: readonly [number, number];
}

/** Build one vehicle's `.osm` from the game archives. Throws when the model is absent. */
export function buildVehicleOsm(fs: AssetFileSystem, model: string, options: VehicleOsmOptions = {}): VehicleOsm {
  let present = false;
  const osm = buildModelOsm(fs, model, {
    extraSections: (_built, dff) => {
      const collision = collisionOf(dff);
      present = collision.present;

      return [{ bytes: encodeOsmCollision(collision.collision), tag: OsmSectionTag.COLL }];
    },
    ...(options.forceRgba8 ? { forceRgba8: true } : {}),
    sharedTxds: SHARED_VEHICLE_TXDS,
    ...(options.txd ? { txd: options.txd } : {}),
    ...(options.popUpLights ? { popUpLights: true } : {}),
    ...(options.wheelScale ? { wheelScale: options.wheelScale } : {}),
  });

  return {
    bytes: osm.bytes,
    fixture: osm.fixture,
    hasCollision: present,
    ostex: osm.ostex,
    sections: osm.sections,
    texture: osm.built.texture,
    warnings: osm.warnings,
  };
}

/** The embedded COL, mapped into the engine's collider shape — or the fallback box when there is none. */
function collisionOf(dff: ArrayBuffer): { collision: OsmCollision; present: boolean } {
  const col = parseDffCollision(dff);
  if (!col) {
    return {
      collision: {
        boxes: [],
        halfExtents: DEFAULT_HALF_EXTENTS,
        indices: new Uint32Array(0),
        spheres: [],
        vertices: new Float32Array(0),
      },
      present: false,
    };
  }

  const indices = new Uint32Array(col.faces.length * 3);
  col.faces.forEach((face, index) => {
    indices[index * 3] = face.a;
    indices[index * 3 + 1] = face.b;
    indices[index * 3 + 2] = face.c;
  });

  return {
    collision: {
      boxes: col.boxes.map((box) => ({ max: box.max, min: box.min })),
      halfExtents: [
        Math.max(Math.abs(col.bounds.min[0]), Math.abs(col.bounds.max[0])),
        Math.max(Math.abs(col.bounds.min[1]), Math.abs(col.bounds.max[1])),
        Math.max(Math.abs(col.bounds.min[2]), Math.abs(col.bounds.max[2])),
      ],
      indices,
      spheres: col.spheres.map((sphere) => ({ center: sphere.center, radius: sphere.radius })),
      vertices: col.vertices,
    },
    present: true,
  };
}
