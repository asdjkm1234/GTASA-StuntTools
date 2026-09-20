/**
 * TOPPLED props on the own engine (074/08 B7·a): the lampposts, meters and posts SA knocks OVER rather than
 * shattering (object.dat gives them a non-zero uproot limit).
 *
 * The first attempt animated the fall analytically in the debris pass — one shard, pivoting on the base. It
 * looked wrong immediately: a pole has to fall away from the car that hit it, and then it has to LAND on
 * something. Both of those are physics, and we already run physics. So a toppled prop becomes a real dynamic
 * body: Rapier decides where it falls, what it hits and how it comes to rest, and the renderer just follows
 * the body. It is also why the fall direction needs no arithmetic here — the impulse carries it.
 */
import type { Engine, VehicleInstance, VehicleModelId } from '@opensa/engine';
import type { PhysicsWorld } from '@opensa/game/physics/physics-world';
import type { AssetFileSystem } from '@opensa/renderware';

import { decodeOsm, decodeOsmHull, osmSection, OsmSectionTag } from '@opensa/engine-formats';
import { gtaPositionToEngine, writeGtaRoot } from '@opensa/game/adapters/engine-vehicle-handle';
import { toRigidModelInit } from '@opensa/game/adapters/vehicle-model-init';
import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';
import { getClump, getTxdChain } from '@opensa/renderware/archive/asset-cache';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

/** How long a felled prop lies there before it is cleaned up — the same few seconds the shards get. */
const PROP_LIFETIME = 8;
/** Speed (m/s) the shove imparts to the prop's top; the DIRECTION comes from the car that hit it. */
const TOPPLE_SPEED = 4;
/** How far ABOVE the centre of mass the shove lands, as a fraction of the prop's half-height. Above the
 *  centre of mass the prop goes over in the direction of the push; below it, it tips the other way. */
const PUSH_HEIGHT = 0.8;
/** A prop object.dat says nothing about still has to weigh something. */
const DEFAULT_MASS = 400;
export interface EngineProps {
  /** Knock a prop over. Returns false when its model cannot be rendered as an entity. */
  topple(request: ToppleRequest): boolean;
  /** Follow the physics bodies and retire the finished ones. */
  update(): void;
}

export interface ToppleRequest {
  /** Where the hit landed (GTA world). The prop falls away from THIS — see `topple`. */
  contact?: readonly [number, number, number];
  /** Velocity of whatever hit the prop (GTA Z-up, m/s) — the fallback when there is no contact point. */
  impact?: readonly [number, number, number];
  /** object.dat mass (a lamppost is 600 kg) — a thin box left on default density weighs almost nothing. */
  mass?: number;
  modelName: string;
  /** The prop's world matrix, column-major (GTA Z-up). */
  transform: readonly number[];
  txdName?: string;
}

interface Felled {
  body: number;
  expiresAt: number;
  instance: VehicleInstance;
}

export function setupEngineProps(engine: Engine, fs: AssetFileSystem, physics: PhysicsWorld): EngineProps {
  const models = new Map<string, null | VehicleModelId>();
  const felled: Felled[] = [];
  const root = new Float32Array(16);

  /** One upload per prop TYPE (the rigid path vehicles already use — a prop is just a model with no paint). */
  const modelOf = (request: ToppleRequest): null | VehicleModelId => {
    const cached = models.get(request.modelName);
    if (cached !== undefined) {
      return cached;
    }
    let id: null | VehicleModelId = null;
    try {
      // OPTIMIZED first (opensa-pack 003): the prop's `.osm`, read as sections. Falls back to the DFF/TXD
      // parse for anything unconverted or overridden by a mod.
      const osm = fs.get(`${request.modelName.toLowerCase()}.osm`);
      if (osm) {
        id = engine.createVehicleModel(readModelOsm(request.modelName, new Uint8Array(osm)).model);
      } else {
        const clump = getClump(fs, request.modelName);
        const txds = request.txdName ? getTxdChain(fs, request.txdName) : [];
        id = engine.createVehicleModel(toRigidModelInit(buildVehicleModel(clump, new VehicleTextures(txds))));
      }
    } catch {
      id = null; // not renderable as an entity — the prop just disappears, rather than crashing the frame
    }
    models.set(request.modelName, id);

    return id;
  };

  return {
    topple(request: ToppleRequest): boolean {
      const model = modelOf(request);
      if (model === null) {
        return false;
      }
      const box = boundsOf(fs, request.modelName);
      if (!box) {
        return false;
      }
      const base: [number, number, number] = [request.transform[12], request.transform[13], request.transform[14]];
      const rotation = quaternionOf(request.transform);
      const mass = request.mass ?? DEFAULT_MASS;
      // The collider is the mesh's own convex HULL, in model space — so the body's origin IS the prop's
      // origin, and the renderer needs no offset arithmetic. A bounding box lied twice here: a lamppost's arm
      // made its box 2.8 m wide, which both shifted the centre of mass off the pole and left the pole hanging
      // in the air when the box came to rest on that phantom face. (A FENCE, whose box IS its shape, fell
      // correctly all along — that is what pointed at the box.)
      const body = physics.createFalling(base, rotation, mass, box.hull, { centre: box.centre, half: box.half });

      // Shove it HIGH UP, so the GROUND is what it hinges on. Spinning it about its own centre instead (the
      // first attempt) drives the bottom half of an 8 m pole into the asphalt, the solver ejects it, and the
      // pole rockets out of sight.
      //
      // The direction is the vector from the CONTACT POINT to the prop: "away from whatever hit me" is true by
      // construction, whichever way the car happened to be pointing. Driving it off the car's velocity instead
      // got the sign wrong in the field — a glancing hit sent the pole over towards the car.
      const direction = awayFrom(base, request.contact, request.impact);
      // Push ABOVE the centre of mass — measured from the mesh's own centroid, not from its foot. Below the
      // centre of mass the same shove tips the prop the OTHER way (it kicks the base out, like a rug), which
      // is exactly what made the lamppost fall towards the car that hit it.
      const above = rotate(rotation, [box.centre[0], box.centre[1], box.centre[2] + box.half[2] * PUSH_HEIGHT]);
      physics.pushAt(
        body,
        [direction[0] * mass * TOPPLE_SPEED, direction[1] * mass * TOPPLE_SPEED, 0],
        [base[0] + above[0], base[1] + above[1], base[2] + above[2]],
      );

      const instance = engine.createVehicle(model);
      felled.push({ body, expiresAt: performance.now() / 1000 + PROP_LIFETIME, instance });

      return true;
    },

    update(): void {
      if (felled.length === 0) {
        return;
      }
      const now = performance.now() / 1000;
      for (let index = felled.length - 1; index >= 0; index -= 1) {
        const prop = felled[index];
        if (prop.expiresAt <= now) {
          engine.destroyVehicle(prop.instance);
          physics.removeBodies([prop.body]);
          felled.splice(index, 1);
          continue;
        }
        // The hull collider lives in model space, so the body's origin IS the mesh's origin — nothing to undo.
        // `writeGtaRoot` converts the ROTATION into engine space but takes the position ALREADY converted (the
        // vehicle handle and the player both do this); passing raw GTA coordinates put the pole 1 656 units
        // under the world, which is why a felled lamppost simply vanished.
        const body = physics.readBody(prop.body);
        writeGtaRoot(root, gtaPositionToEngine(body.position), body.quaternion);
        prop.instance.entity.setRoot(root);
      }
      // Flatten + upload the part matrices OURSELVES. They used to ride on the vehicle tick's
      // `updateVehicles()`, which made a felled prop invisible whenever that tick did not run — the entity
      // existed, the physics ran, and the GPU still read the zeroed matrix buffer.
      engine.updateVehicles();
    },
  };
}

/**
 * Which way a hit prop goes over: away from the contact point. Falls back to the hitter's velocity (a contact
 * point is not always reported), and finally to a fixed axis — a car that has already stopped still has to
 * knock the thing somewhere.
 */
function awayFrom(
  base: readonly [number, number, number],
  contact: readonly number[] | undefined,
  impact: readonly number[] | undefined,
): [number, number, number] {
  const candidates: readonly number[][] = [
    contact ? [base[0] - contact[0], base[1] - contact[1]] : [],
    impact ? [impact[0], impact[1]] : [],
  ];
  for (const candidate of candidates) {
    const length = Math.hypot(candidate[0] ?? 0, candidate[1] ?? 0);
    if (length > 0.1) {
      return [candidate[0] / length, candidate[1] / length, 0];
    }
  }

  return [1, 0, 0];
}

/** The `HULL` section of `<prop>.osm`, when the converter wrote one. */
function bakedHull(fs: AssetFileSystem, modelName: string): null | ReturnType<typeof decodeOsmHull> {
  const osm = fs.get(`${modelName.toLowerCase()}.osm`);
  if (!osm) {
    return null;
  }
  try {
    const section = osmSection(decodeOsm(new Uint8Array(osm)), OsmSectionTag.HULL);

    return section ? decodeOsmHull(section) : null;
  } catch {
    return null; // a malformed `.osm` falls back to the clump walk rather than killing the topple
  }
}

/**
 * The prop in MODEL space: its vertices (the collider's hull) plus a bounding box as the fallback.
 *
 * A converted prop carries this as a baked `HULL` section, so toppling it no longer walks the clump a
 * second time (opensa-pack 003 phase 5). The walk below stays for the unoptimized path.
 */
function boundsOf(
  fs: AssetFileSystem,
  modelName: string,
): null | { centre: [number, number, number]; half: [number, number, number]; hull: Float32Array } {
  const baked = bakedHull(fs, modelName);
  if (baked) {
    return { centre: [...baked.centre], half: [...baked.half], hull: baked.points };
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const points: number[] = [];
  try {
    for (const geometry of getClump(fs, modelName).geometries) {
      for (let at = 0; at < geometry.positions.length; at += 3) {
        points.push(geometry.positions[at], geometry.positions[at + 1], geometry.positions[at + 2]);
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], geometry.positions[at + axis]);
          max[axis] = Math.max(max[axis], geometry.positions[at + axis]);
        }
      }
    }
  } catch {
    return null;
  }
  if (!Number.isFinite(min[0]) || !Number.isFinite(max[0])) {
    return null;
  }

  return {
    centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    // Only the FALLBACK box. A lamppost's box is thin: too thin and the solver jitters, so keep a floor on it.
    half: [
      Math.max(0.12, (max[0] - min[0]) / 2),
      Math.max(0.12, (max[1] - min[1]) / 2),
      Math.max(0.12, (max[2] - min[2]) / 2),
    ],
    hull: new Float32Array(points),
  };
}

/** The rotation of a column-major mat4, as a quaternion (x, y, z, w). */
function quaternionOf(m: readonly number[]): [number, number, number, number] {
  const trace = m[0] + m[5] + m[10];
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);

    return [(m[6] - m[9]) * s, (m[8] - m[2]) * s, (m[1] - m[4]) * s, 0.25 / s];
  }
  if (m[0] > m[5] && m[0] > m[10]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[5] - m[10]);

    return [0.25 * s, (m[4] + m[1]) / s, (m[8] + m[2]) / s, (m[6] - m[9]) / s];
  }
  if (m[5] > m[10]) {
    const s = 2 * Math.sqrt(1 + m[5] - m[0] - m[10]);

    return [(m[4] + m[1]) / s, 0.25 * s, (m[9] + m[6]) / s, (m[8] - m[2]) / s];
  }
  const s = 2 * Math.sqrt(1 + m[10] - m[0] - m[5]);

  return [(m[8] + m[2]) / s, (m[9] + m[6]) / s, 0.25 * s, (m[1] - m[4]) / s];
}

/** Rotate a vector by a quaternion (x, y, z, w). */
function rotate(q: readonly number[], v: readonly number[]): [number, number, number] {
  const [x, y, z, w] = q;
  const cx = y * v[2] - z * v[1] + w * v[0];
  const cy = z * v[0] - x * v[2] + w * v[1];
  const cz = x * v[1] - y * v[0] + w * v[2];

  return [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)];
}
