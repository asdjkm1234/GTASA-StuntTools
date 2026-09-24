/**
 * The real Hydra / Rustler aircraft, read from the user's own install (DFF + TXD from the IMG archive via
 * {@link AssetStore.readRaw}) and uploaded through the engine's rigid path. Nothing simplifying stands in
 * for the game model: the same `buildVehicleModel` the game uses keeps the full part hierarchy, materials
 * and collision, and the engine uploads it as a rigid model with per-part rotation.
 */
import type { Engine, VehicleInstance, VehicleModelId } from '@opensa/engine';
import type { VehicleModelData } from '@opensa/renderware';

import { toRigidModelInit } from '@opensa/game/adapters/vehicle-model-init';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

import type { LoadedMap } from './map-source';
import type { Quat } from './math';

import { NODE_NAMES, relativeNodeRotation } from './csv';

/** Model id → DFF/TXD base name; `stuntplane` is accepted as the server name for the Rustler. */
const MODEL_NAMES: Record<number, string[]> = {
  476: ['rustler', 'stuntplane'],
  520: ['hydra'],
};

export interface AircraftHandle {
  data: VehicleModelData;
  instance: VehicleInstance;
  modelId: VehicleModelId;
  /** DFF base name that actually loaded (for the readout). */
  name: string;
  /** Apply a pose: model root in engine space from GTA position + orientation quaternion. */
  applyPose(positionGta: readonly [number, number, number], orientation: Quat): void;
  /** Apply recorded/inferred animated node rotations. `nodes` follows {@link NODE_NAMES}. */
  applyNodes(nodes: readonly (Quat | null)[], gearStatus: number, inferred: { roll: number; pitch: number; yaw: number }): void;
  applyPaint(colors: readonly (number | null)[]): void;
  /** Hide the whole aircraft while the camera is inside the original first-person seat. */
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Resolve the model id to a DFF base name that exists in the install. */
async function resolveName(map: LoadedMap, model: number): Promise<string> {
  for (const candidate of MODEL_NAMES[model] ?? []) {
    const dff = await map.assets.readRaw(`${candidate}.dff`);
    if (dff) {
      return candidate;
    }
  }
  throw new Error(`本地安装中找不到模型 ${model} 的 DFF`);
}

/** Load and upload the aircraft. Throws when the DFF or its TXD is missing. */
export async function loadAircraft(engine: Engine, map: LoadedMap, model: number): Promise<AircraftHandle> {
  const name = await resolveName(map, model);
  const dff = await map.assets.readRaw(`${name}.dff`);
  if (!dff) {
    throw new Error(`缺少 ${name}.dff`);
  }
  const txd = await map.assets.readRaw(`${name}.txd`);
  const clump = parseDff(new Uint8Array(dff).buffer);
  const data = buildVehicleModel(clump, new VehicleTextures(txd ? [new Uint8Array(txd).buffer] : []), {
    wheelScale: [1, 1],
  });
  const modelId = engine.createVehicleModel(toRigidModelInit(data));
  const instance = engine.createVehicle(modelId);
  let isVisible = true;

  // Bind rotation of each named node, so a recorded ABSOLUTE local rotation can be turned into the
  // animation delta `setPartRotation` expects (bind × anim).
  const partFor: (number | null)[] = NODE_NAMES.map((node) => findPart(instance, data.parts, node));
  const bindFor: (Quat | null)[] = partFor.map((part) => {
    if (part === null) {
      return null;
    }
    const rotation = data.parts[part].localRotation;

    return [rotation[0], rotation[1], rotation[2], rotation[3]];
  });

  return {
    applyNodes(nodes, gearStatus, inferred): void {
      nodes.forEach((recorded, index) => {
        const part = partFor[index];
        const bind = bindFor[index];
        if (part === null || !bind) {
          return;
        }
        if (recorded) {
          instance.entity.setPartRotation(part, relativeNodeRotation(bind, recorded));

          return;
        }
        // Inferred fallback (keys / gear status) is applied ONLY when the real node was unreadable, and the
        // readout says so. Gear openness is a signed status in SA; negative is not "down".
        const isGear = index >= 5;
        if (isGear) {
          const progress = Math.min(1, Math.abs(gearStatus));
          const half = (progress * Math.PI) / 2 / 2;
          instance.entity.setPartRotation(part, [0, Math.sin(half) * (index === 5 ? 1 : -1), 0, Math.cos(half)]);

          return;
        }
        const axisAngle: Quat =
          index === 0
            ? [0, Math.sin(inferred.yaw / 2), 0, Math.cos(inferred.yaw / 2)] // rudder
            : index <= 2
              ? [Math.sin(inferred.pitch / 2), 0, 0, Math.cos(inferred.pitch / 2)] // elevator
              : [0, 0, Math.sin(inferred.roll / 2), Math.cos(inferred.roll / 2)]; // aileron
        const side = index === 1 || index === 3 ? 1 : -1;
        instance.entity.setPartRotation(part, [axisAngle[0] * side, axisAngle[1] * side, axisAngle[2] * side, axisAngle[3]]);
      });
    },
    applyPaint(colors): void {
      const rgb = resolvePaint(map, colors);
      if (rgb) {
        instance.setPaint({ primary: rgb.primary, quaternary: rgb.tertiary, secondary: rgb.secondary, tertiary: rgb.quaternary });
      }
    },
    setVisible(visible): void {
      if (visible === isVisible) return;
      for (let submesh = 0; submesh < data.submeshes.length; submesh += 1) {
        instance.setSubmeshVisible(submesh, visible);
      }
      isVisible = visible;
    },
    applyPose(positionGta, orientation): void {
      // `orientation` maps the model's native axes (X=right, Y=forward, Z=up) to engine world, and for the
      // identity pose it equals the engine's own ROOT basis (native Z-up → engine Y-up), which is the value
      // the map/vehicle viewer uses. So the direct basis is the correct root.
      const root = new Float32Array(16);
      root.set(quatToMatrix(orientation), 0);
      root[12] = positionGta[0];
      root[13] = positionGta[2];
      root[14] = -positionGta[1];
      instance.entity.setRoot(root);
    },
    data,
    dispose(): void {
      engine.destroyVehicle(instance);
      engine.destroyVehicleModel(modelId);
    },
    instance,
    modelId,
    name,
  };
}

/** Find a DFF part for a recorder node name (exact, then case-insensitive substring). */
function findPart(instance: VehicleInstance, parts: VehicleModelData['parts'], node: string): number | null {
  const exact = instance.entity.partIndex(node);
  if (exact >= 0) {
    return exact;
  }
  const lower = node.toLowerCase();
  const index = parts.findIndex((part) => part.name.toLowerCase().includes(lower));

  return index >= 0 ? index : null;
}

/** Column-major matrix from a quaternion (xyzw). */
export function quatToMatrix(q: Quat): Float32Array {
  const [x, y, z, w] = q;
  const out = new Float32Array(16);
  out[0] = 1 - 2 * (y * y + z * z);
  out[1] = 2 * (x * y + z * w);
  out[2] = 2 * (x * z - y * w);
  out[4] = 2 * (x * y - z * w);
  out[5] = 1 - 2 * (x * x + z * z);
  out[6] = 2 * (y * z + x * w);
  out[8] = 2 * (x * z + y * w);
  out[9] = 2 * (y * z - x * w);
  out[10] = 1 - 2 * (x * x + y * y);
  out[15] = 1;

  return out;
}

let carcolsCache: [number, number, number][] | null = null;

/** Parse `data/carcols.dat`'s `col` section once. */
function carcols(map: LoadedMap): [number, number, number][] {
  if (carcolsCache) {
    return carcolsCache;
  }
  const result: [number, number, number][] = [];
  const text = map.fs.getText('data/carcols.dat');
  if (text) {
    let inColours = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.toLowerCase() === 'col') {
        inColours = true;
        continue;
      }
      if (inColours && line.toLowerCase() === 'end') {
        break;
      }
      if (!inColours || !line || line.startsWith('#')) {
        continue;
      }
      const rgb = line.split('#')[0].split(',').map((value) => Number(value.trim()));
      if (rgb.length >= 3 && rgb.slice(0, 3).every(Number.isFinite)) {
        result.push([rgb[0], rgb[1], rgb[2]]);
      }
    }
  }
  carcolsCache = result;

  return result;
}

function resolvePaint(map: LoadedMap, colors: readonly (number | null)[]): null | {
  primary: [number, number, number];
  quaternary: [number, number, number];
  secondary: [number, number, number];
  tertiary: [number, number, number];
} {
  const table = carcols(map);
  const at = (index: number): [number, number, number] | null => {
    const id = colors[index];
    if (id === null || id === undefined || !table[id]) {
      return null;
    }
    const rgb = table[id];

    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  };
  const primary = at(0);
  if (!primary) {
    return null;
  }

  return {
    primary,
    quaternary: at(2) ?? primary,
    secondary: at(1) ?? primary,
    tertiary: at(3) ?? primary,
  };
}

/** Re-export so callers do not depend on csv's internals. */
export { NODE_NAMES };
