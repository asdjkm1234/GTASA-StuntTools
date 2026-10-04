import type { DebugLineSetId, Engine, VehicleInstance, VehicleModelId } from '@opensa/engine';
import type { RWClump, VehicleModelData } from '@opensa/renderware';
import type { ColModel } from '@opensa/renderware/parsers/binary/col-types';

import { toRigidModelInit } from '@opensa/game/adapters/vehicle-model-init';
import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';
import { colLines, meshEdgeLines } from '@opensa/renderware/collision/col-lines';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

import { boxLines } from './viewer-engine';

/**
 * One DFF + its TXDs → something on screen, with no pak, no cells and no streaming.
 *
 * This reuses the engine's RIGID path, which is renderer-level rather than vehicle-level: props, felled
 * trees, animated objects and cars all upload through `createVehicleModel`. A viewed map object is just
 * a model with no paint — the same observation `engine-props.ts` already relies on in the game host.
 *
 * Geometry stays in its native RenderWare (Z-up) frame; {@link ROOT} carries the basis change to the
 * engine's Y-up world, so nothing here has to rotate vertices. Debug LINE sets are the exception —
 * they are world-space by contract, so their vertices are converted on the CPU.
 */

/** Model-space (native Z-up) axis-aligned bounds. */
export interface Bounds {
  max: [number, number, number];
  min: [number, number, number];
}

export interface HighlightOptions {
  /** Clamp the box to these bounds — modded DFFs carry stray vertices that blow the mesh bbox up. */
  clamp?: Bounds;
  /** The part's live animation rotation, so the box follows an opened door rather than its bind pose. */
  rotation?: PartRotation;
}

export interface LoadModelOptions {
  wheelScale?: [number, number];
}

/** xyzw, the same shape `RigidEntity.setPartRotation` takes. */
export type PartRotation = readonly [number, number, number, number];

/** The geometry the ViewedModel builder needs — shared by the DFF (`VehicleModelData`) and the converted
 *  `.osm` (`RigidModelInit`) paths, so both render, frame, wireframe and part-highlight identically. */
export interface RigidGeometry {
  indices: Uint16Array | Uint32Array;
  parts: VehicleModelData['parts'];
  positions: Float32Array;
  submeshes: VehicleModelData['submeshes'];
}

export interface ViewedModel<D extends RigidGeometry = RigidGeometry> {
  /** Axis-aligned bounds in ENGINE space, for framing the camera. */
  bounds: { center: [number, number, number]; radius: number };
  /** The geometry (+ whatever richer type the caller built it from — the DFF path keeps the full
   *  `VehicleModelData`, e.g. its `doors`; the `.osm` path carries only {@link RigidGeometry}). */
  data: D;
  dispose(): void;
  /** Box the given part in yellow (null clears it). */
  highlightPart(part: null | number, options?: HighlightOptions): void;
  instance: VehicleInstance;
  modelId: VehicleModelId;
  /** Model-space AABB of everything drawn by one part, or null when the part has no geometry. */
  partBounds(part: number, rotation?: PartRotation): Bounds | null;
  /** Attach a collision hull; call once, then drive it with {@link showCollision}. */
  setCollision(col: ColModel): void;
  /** World-space translation applied on top of the GTA→engine basis change. */
  setOffset(offset: readonly [number, number, number]): void;
  setVisible(visible: boolean): void;
  showCollision(visible: boolean): void;
  /** Mesh edges — built on first use, since most sessions never ask for them. */
  showWireframe(visible: boolean): void;
  triangles: number;
}

const COLLISION_COLOR: readonly [number, number, number, number] = [0, 1, 0.4, 1];
const WIREFRAME_COLOR: readonly [number, number, number, number] = [0.1, 0.1, 0.1, 1];
const HIGHLIGHT_COLOR: readonly [number, number, number, number] = [1, 1, 0, 1];

/**
 * Column-major GTA (Z-up) → engine (Y-up): x stays, engine-y = gta-z, engine-z = -gta-y.
 * The same basis change `writeGtaRoot` applies in the game host, without the position/rotation terms.
 */
const ROOT = new Float32Array([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);

export function loadModel(
  engine: Engine,
  dff: ArrayBuffer,
  txds: readonly ArrayBuffer[],
  options: LoadModelOptions = {},
): ViewedModel<VehicleModelData> {
  return loadModelFromClump(engine, parseDff(dff), txds, options);
}

/** As {@link loadModel}, for callers that already hold (and want to reuse or tweak) the parsed clump. */
export function loadModelFromClump(
  engine: Engine,
  clump: RWClump,
  txds: readonly ArrayBuffer[],
  options: LoadModelOptions = {},
): ViewedModel<VehicleModelData> {
  const data = buildVehicleModel(clump, new VehicleTextures(txds), options);
  const modelId = engine.createVehicleModel(toRigidModelInit(data));

  return viewModel(engine, data, modelId);
}

/**
 * A CONVERTED model (`<name>.osm`, own-engine format) → on screen, the AFTER side of the before/after viewer
 * (plan 079 phase 4). `readModelOsm` gives the engine-ready `RigidModelInit` directly — same decode the game
 * runs — so no `parseDff`/`buildVehicleModel`; the textures ride inside as `.ostex`. The buffers arrive as
 * `Uint8Array` views, so reinterpret positions/indices for the framing/wireframe maths.
 */
export function loadModelFromOsm(engine: Engine, name: string, osm: ArrayBuffer): ViewedModel {
  const { model } = readModelOsm(name, new Uint8Array(osm));
  // A world-textured model (most map objects + world clutter) carries NO textures in its `.osm` — they live
  // in the pak's SHARED texture dictionary, which the viewer does not load. It cannot be shown standalone.
  if (model.textures.length === 0) {
    throw new Error(`${name}: map object — textures live in the shared pak, not viewable standalone`);
  }
  const modelId = engine.createVehicleModel(model);
  const positions = new Float32Array(model.positions.slice().buffer);
  const indices =
    (model.index16 ?? true)
      ? new Uint16Array(model.indices.slice().buffer)
      : new Uint32Array(model.indices.slice().buffer);

  return viewModel(engine, { indices, parts: model.parts, positions, submeshes: model.submeshes }, modelId);
}

/** AABB over the vertices the given submeshes actually index (not the whole buffer). */
function boundsOfIndices(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  submeshes: readonly VehicleModelData['submeshes'][number][],
): Bounds | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let seen = false;

  for (const submesh of submeshes) {
    for (let i = 0; i < submesh.indexCount; i += 1) {
      const vertex = indices[submesh.indexOffset + i] * 3;
      seen = true;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = positions[vertex + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }

  return seen ? { max, min } : null;
}

/** Clamp `box` to `limit`; null when they do not overlap. */
function intersect(box: Bounds, limit: Bounds): Bounds | null {
  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    min[axis] = Math.max(box.min[axis], limit.min[axis]);
    max[axis] = Math.min(box.max[axis], limit.max[axis]);
    if (min[axis] > max[axis]) {
      return null;
    }
  }

  return { max, min };
}

/** Bounds over the raw vertex array, in engine space (positions are native Z-up, so y/z swap). */
function measure(positions: Float32Array): ViewedModel['bounds'] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 2];
    const z = -positions[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  if (minX > maxX) {
    return { center: [0, 0, 0], radius: 1 }; // empty geometry — don't hand the camera NaNs
  }

  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    radius: Math.max(0.5, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2),
  };
}

/** out = a × b, both column-major. */
function multiply(a: Float32Array, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = sum;
    }
  }

  return out;
}

/**
 * A part's matrix (column-major), mirroring `RigidEntity.flatten` minus the root:
 * T(localTranslation) × R(localRotation ⊗ animation) × S(scale), then × offset for doors (whose mesh
 * sits away from its hinge pivot).
 */
function partMatrix(part: VehicleModelData['parts'][number], rotation?: PartRotation): Float32Array {
  const [x, y, z, w] = rotation ? quatMultiply(part.localRotation, rotation) : part.localRotation;
  const scale = part.scale ?? 1;
  const out = new Float32Array(16);

  out[0] = (1 - 2 * (y * y + z * z)) * scale;
  out[1] = 2 * (x * y + z * w) * scale;
  out[2] = 2 * (x * z - y * w) * scale;
  out[4] = 2 * (x * y - z * w) * scale;
  out[5] = (1 - 2 * (x * x + z * z)) * scale;
  out[6] = 2 * (y * z + x * w) * scale;
  out[8] = 2 * (x * z + y * w) * scale;
  out[9] = 2 * (y * z - x * w) * scale;
  out[10] = (1 - 2 * (x * x + y * y)) * scale;
  out[12] = part.localTranslation[0];
  out[13] = part.localTranslation[1];
  out[14] = part.localTranslation[2];
  out[15] = 1;

  return part.offset ? multiply(out, part.offset) : out;
}

/** a ⊗ b, xyzw — the same product `RigidEntity` composes bind × animation with. */
function quatMultiply(a: PartRotation, b: PartRotation): PartRotation {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2],
    a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Line vertices arrive in native GTA (Z-up) space; the engine draws them in world (Y-up) space. */
function toEngineSpace(lines: Float32Array): Float32Array {
  const out = new Float32Array(lines.length);
  for (let i = 0; i < lines.length; i += 3) {
    out[i] = lines[i];
    out[i + 1] = lines[i + 2];
    out[i + 2] = -lines[i + 1];
  }

  return out;
}

/** Transform all eight corners and re-fit — a rotated box grows, as it must. */
function transformBounds(bounds: Bounds, matrix: Float32Array): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let corner = 0; corner < 8; corner += 1) {
    const source = [
      corner & 1 ? bounds.max[0] : bounds.min[0],
      corner & 2 ? bounds.max[1] : bounds.min[1],
      corner & 4 ? bounds.max[2] : bounds.min[2],
    ];
    for (let axis = 0; axis < 3; axis += 1) {
      const value =
        matrix[axis] * source[0] + matrix[4 + axis] * source[1] + matrix[8 + axis] * source[2] + matrix[12 + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }

  return { max, min };
}

/** The shared ViewedModel over uploaded geometry — the DFF and `.osm` paths differ only in how `data` is built. */
function viewModel<D extends RigidGeometry>(engine: Engine, data: D, modelId: VehicleModelId): ViewedModel<D> {
  const instance = engine.createVehicle(modelId);
  instance.entity.setRoot(ROOT);

  let collision: DebugLineSetId | null = null;
  let wireframe: DebugLineSetId | null = null;
  let highlight: DebugLineSetId | null = null;
  const offset: [number, number, number] = [0, 0, 0];
  const root = new Float32Array(ROOT);

  return {
    bounds: measure(data.positions),
    data,
    dispose(): void {
      for (const id of [collision, wireframe, highlight]) {
        if (id !== null) {
          engine.destroyDebugLines(id);
        }
      }
      engine.destroyVehicle(instance);
      engine.destroyVehicleModel(modelId);
    },
    highlightPart(part, options = {}): void {
      // Rebuilt rather than hidden: the box moves whenever the part does (an opened door).
      if (highlight !== null) {
        engine.destroyDebugLines(highlight);
        highlight = null;
      }
      const box = part === null ? null : this.partBounds(part, options.rotation);
      const clamped = box && options.clamp ? intersect(box, options.clamp) : box;
      if (clamped) {
        highlight = engine.createDebugLines(toEngineSpace(boxLines(clamped.min, clamped.max)), HIGHLIGHT_COLOR);
      }
    },
    instance,
    modelId,
    partBounds(part, rotation): Bounds | null {
      const local = boundsOfIndices(
        data.positions,
        data.indices,
        data.submeshes.filter((submesh) => submesh.part === part),
      );

      // Vertices live in the PART's frame (that is the whole point of the rigid path — the engine
      // composes root × part per draw). Raw bounds would box the model ORIGIN instead of the part.
      return local && data.parts[part] ? transformBounds(local, partMatrix(data.parts[part], rotation)) : local;
    },
    setCollision(col): void {
      if (collision !== null) {
        return;
      }
      collision = engine.createDebugLines(toEngineSpace(colLines(col)), COLLISION_COLOR);
      engine.setDebugLinesVisible(collision, false);
    },
    setOffset(next): void {
      offset[0] = next[0];
      offset[1] = next[1];
      offset[2] = next[2];
      root.set(ROOT);
      root[12] = offset[0];
      root[13] = offset[1];
      root[14] = offset[2];
      instance.entity.setRoot(root);
    },
    setVisible(visible): void {
      data.submeshes.forEach((_, index) => instance.setSubmeshVisible(index, visible));
    },
    showCollision(visible): void {
      if (collision !== null) {
        engine.setDebugLinesVisible(collision, visible);
      }
    },
    showWireframe(visible): void {
      if (wireframe === null) {
        if (!visible) {
          return;
        }
        wireframe = engine.createDebugLines(
          toEngineSpace(meshEdgeLines(data.positions, data.indices)),
          WIREFRAME_COLOR,
        );
      }
      engine.setDebugLinesVisible(wireframe, visible);
    },
    triangles: data.indices.length / 3,
  };
}
