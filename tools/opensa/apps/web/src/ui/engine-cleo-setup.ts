/**
 * Production wiring for CLEO (plan 097/04): the real `CleoHostDeps` over engine + VFS + world
 * adapter, boot discovery of `cleo/*.cs`, and the census line. Model loading is the engine-props
 * path — `.osm` first, DFF/TXD fallback — built ON-THREAD (decision 1: measure first, copy the
 * worker only if spawn hitches show; numbers go to the ledger).
 */
import type { Engine, VehicleInstance, VehicleModelId } from '@opensa/engine';
import type { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import type { Config } from '@opensa/game/interfaces/config.interface';
import type { AssetFileSystem } from '@opensa/renderware';

import { type NativeWorld, quatAxes, ScriptRunner, TraceRing } from '@opensa/cleo';
import { toRigidModelInit } from '@opensa/game/adapters/vehicle-model-init';
import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';
import { isLightSmashed } from '@opensa/game/vehicle/vehicle-lamps';
import { getClump, getTxdChain } from '@opensa/renderware/archive/asset-cache';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

import type { CleoObjectInstance } from './engine-cleo';
import type { EngineVehicles, ScriptVehicle } from './engine-vehicles';

import { CleoRunnerSystem, createCleoEngineHost, discoverAndSpawn } from './engine-cleo';

export interface EngineCleoArgs {
  readonly adapter: GtaSaWorldAdapter;
  /** Camera eye in GTA space — the LOD swaps and 0EBE read it. */
  readonly cameraGta: () => readonly [number, number, number];
  readonly config: Config;
  readonly engine: Engine;
  readonly fs: AssetFileSystem;
  readonly hour: () => number;
  readonly playerGta: () => readonly [number, number, number];
  /** The vehicle module (null when it failed to boot) — the script fleet + door reads live on it. */
  readonly vehicles: () => EngineVehicles | null;
}

interface BuiltModel {
  readonly id: VehicleModelId;
  readonly submeshCount: number;
}

/** Null when the VFS carries no `cleo/*.cs` — and then the frame loop pays nothing at all. */
export function setupEngineCleo(args: EngineCleoArgs): CleoRunnerSystem | null {
  const { adapter, config, engine, fs } = args;
  const models = new Map<string, BuiltModel | null>();

  const ensureModel = (modelName: string, txdName?: string): boolean => {
    const key = modelName.toLowerCase();
    const cached = models.get(key);
    if (cached !== undefined) {
      return cached !== null;
    }
    let built: BuiltModel | null = null;
    try {
      // OPTIMIZED first (the engine-props template — the phase-0 spike proved this exact path).
      const osm = fs.get(`${key}.osm`);
      if (osm) {
        const read = readModelOsm(modelName, new Uint8Array(osm));
        built = { id: engine.createVehicleModel(read.model), submeshCount: read.fixture.submeshes.length };
      } else {
        const clump = getClump(fs, modelName);
        const txds = txdName ? getTxdChain(fs, txdName) : [];
        const model = buildVehicleModel(clump, new VehicleTextures(txds));
        built = { id: engine.createVehicleModel(toRigidModelInit(model)), submeshCount: model.submeshes.length };
      }
    } catch (error) {
      built = null; // scripts poll HAS_MODEL_LOADED — an unbuildable model reads as never-loaded…
      // …but never SILENTLY (the anim-objects lesson: an invisible model without a name in the log
      // is undiagnosable in the field).
      // eslint-disable-next-line no-console
      console.warn(`[cleo] model '${modelName}' failed to build:`, error);
    }
    models.set(key, built);

    return built !== null;
  };

  const spawn = (modelName: string): CleoObjectInstance | null => {
    const built = models.get(modelName.toLowerCase());
    if (!built) {
      return null;
    }
    const instance: VehicleInstance = engine.createVehicle(built.id);

    return {
      destroy: (): void => engine.destroyVehicle(instance),
      setRoot: (root): void => instance.entity.setRoot(root),
      setVisible: (visible): void => {
        for (let submesh = 0; submesh < built.submeshCount; submesh += 1) {
          instance.setSubmeshVisible(submesh, visible);
        }
      },
    };
  };

  // The plan 05 phase-B native world over the live script fleet. Two honest gaps, both recorded:
  // lodDistMultiplier is 1.0 (we have no draw-distance slider), and wind is 0 — SA's per-weather
  // wind table (CWeather::Update) is not in the reversed clone yet, so Wind Farm keeps its accepted
  // zero-wind sway rather than a fabricated constant.
  const fleet = (): readonly ScriptVehicle[] => args.vehicles()?.scriptVehicles() ?? [];
  const byCar = (car: number): null | ScriptVehicle => fleet().find((entry) => entry.scriptHandle === car) ?? null;
  const nativeWorld: NativeWorld = {
    doorAngleRatio: (car, door): null | number => {
      // SA eDoors: 2 = front-left, 3 = front-right; the walk-up animator swings no other doors.
      const side = door === 2 ? 'lf' : door === 3 ? 'rf' : null;

      return side ? (args.vehicles()?.scriptDoorRatio(car, side) ?? 0) : null;
    },
    lightStatus: (car, light): number => (isLightSmashed(byCar(car)?.vehicle.lightsSmashed() ?? 0, light) ? 1 : 0),
    lodDistMultiplier: (): number => 1,
    nextSiblingPart: (car, part): null | number => {
      // FRAME-ORDER adjacency stands in for the dropped parent links —
      // docs/hacks/cleo-frame-sibling-order.md.
      const entry = byCar(car);

      return entry && part + 1 < entry.vehicle.scriptPartCount() ? part + 1 : null;
    },
    partForward: (car, part): readonly [number, number, number] => {
      const entry = byCar(car);

      return entry ? quatAxes(entry.vehicle.scriptPartLocalRotation(part)).forward : [0, 1, 0];
    },
    partIndex: (car, name): null | number => byCar(car)?.vehicle.scriptPartIndex(name) ?? null,
    partTranslation: (car, part): readonly [number, number, number] =>
      byCar(car)?.vehicle.scriptPartLocalTranslation(part) ?? [0, 0, 0],
    // SA writes 0 (OK) or 1 (SMASHED) into two bits per lamp; anything non-zero is damage here.
    setLightStatus: (car, light, status): void => {
      byCar(car)?.vehicle.setLightSmashed(light, status !== 0);
    },
    setPartRotation: (car, part, quat): void => {
      byCar(car)?.vehicle.scriptSetPartLocalRotation(part, [quat[0], quat[1], quat[2], quat[3]]);
    },
    setPartTranslationComponent: (car, part, axis, value): void => {
      const entry = byCar(car);
      if (!entry) {
        return;
      }
      const current = [...entry.vehicle.scriptPartLocalTranslation(part)] as [number, number, number];
      current[axis] = value;
      entry.vehicle.scriptSetPartLocalTranslation(part, current);
    },
    vehicleHandles: (): readonly number[] => fleet().map((entry) => entry.scriptHandle),
    wind: (): number => 0,
  };

  let sphereWalkCursor = 0;
  const playerCar = (): null | number => {
    const riding = args.vehicles()?.ridingVehicle() ?? null;

    return riding ? (fleet().find((entry) => entry.enterable === riding)?.scriptHandle ?? null) : null;
  };

  // The plan 07 tracer: created OFF unless config says otherwise; the F2 CLEO screen toggles it.
  const trace = new TraceRing();
  trace.enabled = config.cleo.trace;

  const host = createCleoEngineHost({
    cameraGta: args.cameraGta,
    cars: {
      anyCar: (progress): null | { car: number; progress: number } => {
        const entry = fleet()[progress];

        return entry ? { car: entry.scriptHandle, progress: progress + 1 } : null;
      },
      carInSphere: (x, y, z, radius, findNext): null | number => {
        // The 0AE2 walk cursor: findNext=false restarts, findNext=true resumes AFTER the last
        // match, and exhaustion answers null so the script's own loop terminates and WAITs (the
        // vandoor full-budget burn the 097/07 benchmark caught — 3 ms/tick behind a host that
        // could never say "no more cars").
        const cars = fleet();
        let index = findNext ? sphereWalkCursor : 0;
        for (; index < cars.length; index += 1) {
          const [px, py, pz] = cars[index].enterable.position;
          if (Math.hypot(px - x, py - y, pz - z) <= radius) {
            sphereWalkCursor = index + 1;

            return cars[index].scriptHandle;
          }
        }
        sphereWalkCursor = 0;

        return null;
      },
      carModel: (car): number => {
        const entry = byCar(car);

        return entry ? (adapter.cleoModelIdByName(entry.model) ?? 0) : 0;
      },
      isCarModel: (model): boolean => adapter.cleoIsCarModelId(model),
      playerCar,
    },
    ensureModel,
    flush: (): void => engine.updateVehicles(),
    hour: args.hour,
    nativeWorld,
    playerGta: args.playerGta,
    print: showToast,
    resolveById: (id) => adapter.cleoModelById(id),
    resolveByName: (name) => adapter.cleoModelIdByName(name),
    spawn,
    trace,
  });

  const runner = new ScriptRunner({ host, trace });
  const readScript = (name: string): null | Uint8Array => {
    const bytes = fs.get(name);

    return bytes ? new Uint8Array(bytes) : null;
  };
  const spawned = discoverAndSpawn(fs.names, readScript, runner, config.cleo.maxScripts);
  if (spawned.length === 0) {
    return null;
  }
  // The boot census (the populations restriction): say what is about to run, before it runs.
  // eslint-disable-next-line no-console
  console.log(`[cleo] ${spawned.length} script(s): ${spawned.map((name) => name.slice('cleo/'.length)).join(', ')}`);

  return new CleoRunnerSystem(config, runner, host, trace);
}

/** PRINT_STRING_NOW's surface: the HUD has no message lane yet, so this is a minimal DOM toast —
 *  recorded in the plan 04 ledger; a real HUD text lane can replace it without touching the host. */
function showToast(text: string, ms: number): void {
  let toast = document.getElementById('cleo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cleo-toast';
    toast.style.cssText =
      'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);padding:6px 14px;' +
      'background:rgba(0,0,0,0.65);color:#f5eec9;font:16px monospace;border-radius:4px;' +
      'pointer-events:none;z-index:30;white-space:pre;';
    document.body.append(toast);
  }
  toast.textContent = text;
  toast.style.display = 'block';
  const shown = toast;
  window.clearTimeout(Number(shown.dataset.timer ?? 0));
  shown.dataset.timer = String(window.setTimeout(() => (shown.style.display = 'none'), Math.max(500, ms)));
}
