/**
 * The real Hydra / Rustler aircraft, baked locally from the owner's install (DFF + TXD), then uploaded
 * through the engine's rigid path. Nothing simplifying stands in
 * for the game model: the same `buildVehicleModel` the game uses keeps the full part hierarchy, materials
 * and collision, and the engine uploads it as a rigid model with per-part rotation.
 */
import type { Engine, VehicleInstance, VehicleModelId } from '@opensa/engine';
import type { VehicleModelData } from '@opensa/renderware';

import { toRigidModelInit } from '@opensa/game/adapters/vehicle-model-init';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';
import { MaterialClass } from '@opensa/renderware/vehicle/types';

import type { Quat, Vec3 } from './math';
import type { PakResources } from './pak-resources';
import type { VisualPropellerMotion } from './propeller';

import { type CanopyPlane, prepareAircraftCanopy } from './aircraft-canopy';
import { prepareAircraftInterior } from './aircraft-interior';
import { buildCanopyReflection } from './canopy-reflection';
import { prepareCanopySurface } from './canopy-surface';
import { fitsHydraDashboard } from './cockpit-instrument-mesh';
import { type CockpitInstruments, createCockpitInstruments } from './cockpit-instruments';
import { type CockpitPedals, createCockpitPedals } from './cockpit-pedals';
import { prepareCockpitSeat } from './cockpit-seat';
import { COCKPIT_STICK_PART, cockpitStickMotion, prepareCockpitStick } from './cockpit-stick';
import { NODE_NAMES, relativeNodeRotation } from './csv';
import { conjugate, quatMultiply, rotateVec } from './math';
import { axisAngleX, deriveNozzleAngle, hasNozzleRotation, HYDRA_NOZZLE_NODE_NAMES, PROP_NODE_NAMES } from './nozzle';
import { fitsRustlerDashboard } from './rustler-instrument-mesh';
import { createRustlerPedals } from './rustler-pedals';
import { surfaceFeedback, type SurfaceFeedback } from './surface-feedback';

/** Model id → DFF/TXD base name; `stuntplane` is accepted as the server name for the Rustler. */
const MODEL_NAMES: Record<number, string[]> = {
  476: ['rustler', 'stuntplane'],
  520: ['hydra'],
};

export interface AircraftHandle {
  /** Apply recorded surface rotations and gear status fallback. `nodes` follows {@link NODE_NAMES}. */
  applyNodes(nodes: readonly (null | Quat)[], gearStatus: number, damage?: readonly (null | number)[]): void;
  applyPaint(colors: readonly (null | number)[]): void;
  /** Apply a pose: model root in engine space from GTA position + orientation quaternion. */
  applyPose(positionGta: readonly [number, number, number], orientation: Quat): void;
  /** Apply Hydra nozzles, measured prop frames, or a capture-time Rustler display animation. */
  applyProps(props: {
    nodes?: (null | Quat)[];
    nozzleRotation?: null | number;
    propeller?: null | VisualPropellerMotion;
  }): void;
  /** Closed canopy planes in aircraft-local coordinates, used to keep the pilot eye inside. */
  canopyPlanes: readonly CanopyPlane[];
  controls: SurfaceFeedback;
  data: VehicleModelData;
  dispose(): void;
  instance: VehicleInstance;
  instruments: CockpitInstruments | null;
  modelId: VehicleModelId;
  /** DFF base name that actually loaded (for the readout). */
  name: string;
  pedals: CockpitPedals | null;
  /** Make only the stock upper seat back translucent during cockpit observation. */
  setCockpitLook(enabled: boolean): void;
  /** Hide the whole aircraft while the camera is inside the original first-person seat. */
  setVisible(visible: boolean): void;
  stickMotion: null | ReturnType<typeof cockpitStickMotion>;
}

/** Load and upload the aircraft. Throws when the DFF or its TXD is missing. */
export async function loadAircraft(engine: Engine, resources: PakResources, model: number): Promise<AircraftHandle> {
  const name = await resolveName(resources, model);
  const dff = await resources.readRaw(`${name}.dff`);
  if (!dff) {
    throw new Error(`缺少 ${name}.dff`);
  }
  const txd = await resources.readRaw(`${name}.txd`);
  const genericTxd = await resources.readRaw('vehicle.txd');
  if (!txd || !genericTxd) {
    throw new Error(`预烘焙地图缺少 ${name}.txd 或共享 vehicle.txd，请重新烘焙`);
  }
  const clump = parseDff(new Uint8Array(dff).buffer);
  const data = buildVehicleModel(
    clump,
    new VehicleTextures([new Uint8Array(txd).buffer, new Uint8Array(genericTxd).buffer]),
    {
      wheelScale: wheelScaleFor(resources, name),
    },
  );
  const canopyPlanes = prepareAircraftCanopy(data, model);
  prepareAircraftInterior(data, model);
  // Rustler's underside and lower control surfaces are the only stock paint with coefficient 255;
  // the live sky probe turns those downward faces into a white, speckled stripe. Keep the authored
  // colors and alpha, and leave all other aircraft paint as authored.
  for (let vertex = 0; vertex < data.meta.length / 4; vertex += 1) {
    const materialClass = data.meta[vertex * 4 + 3] >> 4;
    if (materialClass === MaterialClass.canopy) {
      // Canopy reflection bytes are reserved for metre-scale surface coordinates, not environment images.
      data.reflect.fill(0, vertex * 4, vertex * 4 + 4);
    }
    const rustlerBelly = model === 476 && materialClass === MaterialClass.paint && data.reflect[vertex * 4 + 1] === 255;
    if (materialClass === MaterialClass.glass || rustlerBelly) {
      data.reflect.fill(0, vertex * 4, vertex * 4 + 4);
    }
  }
  prepareCanopySurface(data, model);
  prepareCockpitStick(data, model);
  const seatMeshes = prepareCockpitSeat(data, model);
  const modelId = engine.createVehicleModel({
    ...toRigidModelInit(data),
    canopyReflection: buildCanopyReflection(data, canopyPlanes),
  });
  const instance = engine.createVehicle(modelId);
  const instruments =
    fitsHydraDashboard(data, model) || fitsRustlerDashboard(data, model)
      ? createCockpitInstruments(engine, model)
      : null;
  const pedals = fitsHydraDashboard(data, model)
    ? createCockpitPedals(engine)
    : fitsRustlerDashboard(data, model)
      ? createRustlerPedals(engine)
      : null;
  let isVisible = true;
  // A raw engine instance starts with EVERY submesh visible. The DFF also contains a simplified `_vlo`
  // shell for distant rendering; drawing it over the HD body covers moving control surfaces and z-fights
  // across the wings. The replay camera is always near enough to use the intact HD mesh.
  // The generic vehicle builder instances the shared tyre at every wheel dummy. Hydra's middle
  // "wheel" frames are exhaust assemblies, so those two generated tyres must never be drawn.
  const nozzleTyres = new Set(
    model === 520
      ? data.wheels
          .filter((wheel) => HYDRA_NOZZLE_NODE_NAMES.some((node) => data.parts[wheel.part].name === node))
          .map((wheel) => wheel.part)
      : [],
  );
  const hdVisible = data.submeshes.map((submesh) => submesh.kind === 'body' && !nozzleTyres.has(submesh.part));
  let cockpitLook = false;
  seatMeshes?.translucent.forEach((submesh) => {
    hdVisible[submesh] = false;
  });
  hdVisible.forEach((visible, submesh) => instance.setSubmeshVisible(submesh, visible));

  // Bind rotation of each named node, so a recorded ABSOLUTE local rotation can be turned into the
  // animation delta `setPartRotation` expects (bind × anim).
  const partFor: (null | number)[] = NODE_NAMES.map((node) => findPart(instance, data.parts, node));
  const bindFor: (null | Quat)[] = partFor.map((part) => {
    if (part === null) {
      return null;
    }
    const rotation = data.parts[part].localRotation;

    return [rotation[0], rotation[1], rotation[2], rotation[3]];
  });
  const stickPart = instance.entity.partIndex(COCKPIT_STICK_PART);
  let controls = surfaceFeedback([], bindFor);
  let stickMotion: null | ReturnType<typeof cockpitStickMotion> = null;

  const nozzlePartFor = HYDRA_NOZZLE_NODE_NAMES.map((node) => findPart(instance, data.parts, node));

  // The stock Hydra DFF uses its middle wheel frames for nozzles; prop slots support mods and Rustler.
  const propPartFor: (null | number)[] = PROP_NODE_NAMES.map((node) => findPart(instance, data.parts, node));
  const propBindFor: (null | Quat)[] = propPartFor.map((part) => {
    if (part === null) {
      return null;
    }
    const rotation = data.parts[part].localRotation;

    return [rotation[0], rotation[1], rotation[2], rotation[3]];
  });
  /** True for the two MOVING prop entries (indices 1 and 3) of {@link PROP_NODE_NAMES}. */
  const isMovingProp = PROP_NODE_NAMES.map((_, index) => index % 2 === 1);
  let propellerSpinning = false;
  function showPropeller(): void {
    if (model !== 476) return;
    data.submeshes.forEach((mesh, index) => {
      const prop = propPartFor.indexOf(mesh.part);
      if (prop >= 0) {
        instance.setSubmeshVisible(index, isVisible && hdVisible[index] && isMovingProp[prop] === propellerSpinning);
      }
    });
  }
  showPropeller();

  function applyRustlerProps(
    nodes: (null | Quat)[] | undefined,
    propeller: null | undefined | VisualPropellerMotion,
  ): void {
    propellerSpinning = propeller?.spinning ?? false;
    for (let index = 0; index < propPartFor.length; index++) {
      const part = propPartFor[index];
      const bind = propBindFor[index];
      if (part === null || !bind) continue;
      const measured = nodes?.[index];
      // GTA's propeller shaft is native Y. Static blades turn at twice the disc phase.
      const angle = (index < 2 ? 1 : -1) * (isMovingProp[index] ? -1 : 2) * (propeller?.phase ?? 0);
      const rotation: Quat = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
      applyRotation(part, measured || propeller ? relativeNodeRotation(bind, measured ?? rotation) : [0, 0, 0, 1]);
    }
    showPropeller();
  }

  // A wheel authored under a gear strut is a CHILD of that strut's part. The engine flattens every part
  // independently, so the relation is composed here when a node rotates and a retracting gear carries its
  // wheels. `childrenOf` is that tree inverted once from the `parent` link the builder now records.
  const childrenOf: number[][] = data.parts.map(() => []);
  data.parts.forEach((part, index) => {
    if (part.parent !== undefined) {
      childrenOf[part.parent].push(index);
    }
  });

  // Carry a subtree rigidly with its parent's rotation delta `world` (the child's bind-relative transform).
  // This is the door-member math generalised: a grandchild's delta equals its parent's, so `world` is passed
  // down unchanged while each level corrects its own translation about the immediate parent's pivot.
  function carryToChildren(parent: number, world: Quat): void {
    const parentTranslation = data.parts[parent].localTranslation;
    for (const child of childrenOf[parent]) {
      const part = data.parts[child];
      instance.entity.setPartRotation(
        child,
        quatMultiply(quatMultiply(conjugate(part.localRotation), world), part.localRotation),
      );
      const toParent: Vec3 = [
        parentTranslation[0] - part.localTranslation[0],
        parentTranslation[1] - part.localTranslation[1],
        parentTranslation[2] - part.localTranslation[2],
      ];
      const moved = rotateVec(world, toParent);
      instance.entity.setPartTranslation(child, [
        toParent[0] - moved[0],
        toParent[1] - moved[1],
        toParent[2] - moved[2],
      ]);
      carryToChildren(child, world);
    }
  }

  /** Set a node's animation rotation and bring its whole child subtree along. */
  function applyRotation(index: number, anim: Quat): void {
    instance.entity.setPartRotation(index, anim);
    const quat = data.parts[index].localRotation;
    carryToChildren(index, quatMultiply(quatMultiply(quat, anim), conjugate(quat)));
  }

  // v7 records the centerline gear frames directly. Older CSVs need the angles measured from GTA:
  // misc_a goes to -80 degrees and misc_b to +130 degrees as |gearStatus| reaches one.
  function applyHydraCenterGear(gearStatus: number, nodes: readonly (null | Quat)[]): void {
    if (model !== 520) return;
    const progress = Math.min(1, Math.abs(gearStatus));
    for (const [nodeIndex, wheel, angle] of [
      [7, 'wheel_rf_dummy', (-80 * Math.PI) / 180],
      [8, 'wheel_lf_dummy', (130 * Math.PI) / 180],
    ] as const) {
      const part = partFor[nodeIndex];
      const bind = bindFor[nodeIndex];
      if (
        nodes[nodeIndex] ||
        part === null ||
        !bind ||
        !childrenOf[part].some((child) => data.parts[child].name === wheel)
      )
        continue;
      const half = (angle * progress) / 2;
      applyRotation(part, relativeNodeRotation(bind, [Math.sin(half), 0, 0, Math.cos(half)]));
    }
  }

  return {
    applyNodes(nodes, gearStatus, damage = []): void {
      controls = surfaceFeedback(nodes, bindFor, damage);
      nodes.forEach((recorded, index) => {
        const part = partFor[index];
        const bind = bindFor[index];
        if (part === null || !bind) {
          return;
        }
        if (recorded) {
          applyRotation(part, relativeNodeRotation(bind, recorded));

          return;
        }
        if (index >= 7) return; // Hydra center gear fallback is handled below.
        // Gear status supplies only unreadable gear nodes. Surface controls never use keyboard inference.
        // Gear openness is a signed status in SA; negative is not "down".
        const isGear = index >= 5;
        if (isGear) {
          const progress = Math.min(1, Math.abs(gearStatus));
          const half = (progress * Math.PI) / 2 / 2;
          applyRotation(part, [0, Math.sin(half) * (index === 5 ? 1 : -1), 0, Math.cos(half)]);

          return;
        }
        // An unreadable surface has no reliable control state. Clear its previous animation.
        applyRotation(part, [0, 0, 0, 1]);
      });
      applyHydraCenterGear(gearStatus, nodes);
      pedals?.update(nodes[0] ?? null, bindFor[0], damage[0]);
      if (stickPart >= 0) {
        stickMotion = cockpitStickMotion(nodes, bindFor, damage);
        for (let i = 0; i < data.submeshes.length; i++) {
          if (data.submeshes[i].part === stickPart) instance.setSubmeshVisible(i, isVisible && stickMotion.available);
        }
        const bind = data.parts[stickPart].localRotation;
        applyRotation(stickPart, quatMultiply(quatMultiply(conjugate(bind), stickMotion.rotation), bind));
      }
    },
    applyPaint(colors): void {
      const rgb = resolvePaint(resources, colors);
      if (rgb) {
        instance.setPaint({
          primary: rgb.primary,
          quaternary: rgb.tertiary,
          secondary: rgb.secondary,
          tertiary: rgb.quaternary,
        });
      }
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
      instruments?.setRoot(root);
      pedals?.setRoot(root);
    },
    applyProps({ nodes, nozzleRotation, propeller }): void {
      if (model === 476) {
        applyRustlerProps(nodes, propeller);

        return;
      }
      if (model !== 520) return;
      // GTA sets an ABSOLUTE X rotation, not bind × sweep. Each assembly already contains both sides.
      // Always update these independently of mod prop recordings; missing values clear the last pose.
      for (const part of nozzlePartFor) {
        if (part === null || nozzleTyres.has(part)) continue;
        const bind = data.parts[part].localRotation;
        applyRotation(
          part,
          hasNozzleRotation(nozzleRotation)
            ? relativeNodeRotation(bind, axisAngleX(deriveNozzleAngle(nozzleRotation)))
            : [0, 0, 0, 1],
        );
      }
      // 1) Recorder-measured prop-node rotations are authentic and win outright. The recorder captures every
      //    present frame, so a null entry means "this model/recording did not provide it", not "identity".
      const recorded = nodes ?? [];
      let anyRecorded = false;
      for (let index = 0; index < PROP_NODE_NAMES.length; index += 1) {
        const quat = recorded[index];
        const part = propPartFor[index];
        const bind = propBindFor[index];
        if (!quat || part === null || !bind) {
          continue;
        }
        applyRotation(part, relativeNodeRotation(bind, quat));
        anyRecorded = true;
      }
      if (anyRecorded) {
        return;
      }
      // 2) No measured prop nodes: drive the two MOVING nozzles from the raw 0..5000 control, an INFERRED
      //    local-X sweep (see nozzle.ts). Never presented as authentic geometry motion.
      if (!Number.isFinite(nozzleRotation ?? 0)) {
        return;
      }
      const angle = deriveNozzleAngle(nozzleRotation ?? null);
      const sweep = axisAngleX(angle);
      for (let index = 0; index < PROP_NODE_NAMES.length; index += 1) {
        const part = propPartFor[index];
        if (!isMovingProp[index] || part === null) {
          continue;
        }
        applyRotation(part, sweep);
      }
    },
    canopyPlanes,
    get controls(): SurfaceFeedback {
      return controls;
    },
    data,
    dispose(): void {
      instruments?.dispose();
      pedals?.dispose();
      engine.destroyVehicle(instance);
      engine.destroyVehicleModel(modelId);
    },
    instance,
    instruments,
    modelId,
    name,
    pedals,
    setCockpitLook(enabled): void {
      if (enabled === cockpitLook || !seatMeshes) return;
      cockpitLook = enabled;
      for (const [submeshes, show] of [
        [seatMeshes.opaque, !enabled],
        [seatMeshes.translucent, enabled],
      ] as const) {
        for (const submesh of submeshes) {
          hdVisible[submesh] = show;
          instance.setSubmeshVisible(submesh, isVisible && show);
        }
      }
    },
    setVisible(visible): void {
      if (visible === isVisible) return;
      for (let submesh = 0; submesh < data.submeshes.length; submesh += 1) {
        instance.setSubmeshVisible(submesh, visible && hdVisible[submesh]);
      }
      instruments?.setVisible(visible);
      pedals?.setVisible(visible);
      isVisible = visible;
      showPropeller();
    },
    get stickMotion(): null | ReturnType<typeof cockpitStickMotion> {
      return stickMotion;
    },
  };
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

/** Find a DFF part for a recorder node name (exact, then case-insensitive substring). */
function findPart(instance: VehicleInstance, parts: VehicleModelData['parts'], node: string): null | number {
  const exact = instance.entity.partIndex(node);
  if (exact >= 0) {
    return exact;
  }
  const lower = node.toLowerCase();
  const index = parts.findIndex((part) => part.name.toLowerCase().includes(lower));

  return index >= 0 ? index : null;
}

/** Resolve the model id to a DFF base name that exists in the install. */
async function resolveName(resources: PakResources, model: number): Promise<string> {
  for (const candidate of MODEL_NAMES[model] ?? []) {
    const dff = await resources.readRaw(`${candidate}.dff`);
    if (dff) {
      return candidate;
    }
  }
  throw new Error(`预烘焙地图中找不到模型 ${model} 的 DFF，请重新烘焙`);
}

/**
 * `vehicles.ide`'s wheelScale ([front, rear] diameters in metres) for the model, or [1, 1] when the row is
 * absent or unreadable. The Hydra's axles are authored separately (0.7 / 0.3) and the plane's landing gear
 * is sized by them; a hardcoded [1, 1] fitted every wheel to a 1 m tyre and read oversized.
 */
function wheelScaleFor(resources: PakResources, name: string): [number, number] {
  const text = resources.getText('data/vehicles.ide');
  const scale = text ? parseVehicleDefs(text).get(name)?.wheelScale : undefined;
  if (!scale || !Number.isFinite(scale[0]) || !Number.isFinite(scale[1])) {
    return [1, 1];
  }

  return [scale[0], scale[1]];
}

let carcolsCache: [number, number, number][] | null = null;

/** Parse `data/carcols.dat`'s `col` section once. */
function carcols(resources: PakResources): [number, number, number][] {
  if (carcolsCache) {
    return carcolsCache;
  }
  const result: [number, number, number][] = [];
  const text = resources.getText('data/carcols.dat');
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
      const rgb = line
        .split('#')[0]
        .split(',')
        .map((value) => Number(value.trim()));
      if (rgb.length >= 3 && rgb.slice(0, 3).every(Number.isFinite)) {
        result.push([rgb[0], rgb[1], rgb[2]]);
      }
    }
  }
  carcolsCache = result;

  return result;
}

function resolvePaint(
  resources: PakResources,
  colors: readonly (null | number)[],
): null | {
  primary: [number, number, number];
  quaternary: [number, number, number];
  secondary: [number, number, number];
  tertiary: [number, number, number];
} {
  const table = carcols(resources);
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
