/**
 * CLEO on the real engine (plan 097/04): `CleoHost` implemented over the engine's actual seams, plus
 * the runner system the boot closure wires into `runFixedSteps`. The host core is built over a small
 * `CleoHostDeps` seam so the headless integration runs the REAL facets against a fake engine and
 * asserts the handle table's transform sequence — the fake-GPU philosophy.
 *
 * Conventions (decision 4): everything stays GTA-native (metres, Z-up, degrees in the script space);
 * degrees→radians happens in ONE place — {@link gtaEulerToQuat} — and the engine basis change lives
 * entirely in `writeGtaRoot`. Script objects have NO physics (readme's out-of-scope).
 */
import type {
  AtlasMiss,
  CleoHost,
  NativeWorld,
  ScriptRunner,
  ThreadFaultRecord,
  TraceRing,
  UnimplementedHit,
} from '@opensa/cleo';
import type { System } from '@opensa/game/core/system';
import type { Config } from '@opensa/game/interfaces/config.interface';

import { AtlasMemory, decodeScript } from '@opensa/cleo';
import { gtaPositionToEngine, writeGtaRoot } from '@opensa/game/adapters/engine-vehicle-handle';

/** Everything the host asks of the engine/world — implemented over the real seams in
 *  {@link setupEngineCleo}, recorded by a fake in the headless integration. */
export interface CleoHostDeps {
  cameraGta(): readonly [number, number, number];
  /** Live-car queries over the script fleet (plan 097/05 phase B) — the vehicles facet's world. */
  readonly cars: {
    anyCar(progress: number): null | { car: number; progress: number };
    /** `0AE2`'s walk: findNext=false restarts, findNext=true continues, null when EXHAUSTED — a
     *  host that always answers the first match traps the script in a full-budget loop (the
     *  vandoor burn the 07 benchmark caught). */
    carInSphere(x: number, y: number, z: number, radius: number, findNext: boolean): null | number;
    carModel(car: number): number;
    isCarModel(model: number): boolean;
    /** The car the player sits in (script handle), or null on foot. */
    playerCar(): null | number;
  };
  /** Build + register the model (osm-first, DFF/TXD fallback). False = not buildable. Idempotent. */
  ensureModel(modelName: string, txdName?: string): boolean;
  /** Upload the instance matrices — once per tick, after the transform writes. */
  flush(): void;
  hour(): number;
  /** The plan 05 native world the `AtlasMemory` facade resolves against (parts, pool, wind…). */
  readonly nativeWorld: NativeWorld;
  playerGta(): readonly [number, number, number];
  print(text: string, ms: number): void;
  resolveById(id: number): null | { drawDistance: number; modelName: string; txdName: string };
  resolveByName(name: string): null | number;
  /** New instance of a previously ensured model, or null (not ensured / engine says no). */
  spawn(modelName: string): CleoObjectInstance | null;
  /** Plan 07 tracer: atlas ops emit symbolised lines into it as host effects while it is enabled. */
  readonly trace?: TraceRing;
}

/** One engine instance of a script object — the seam the headless test fakes. */
export interface CleoObjectInstance {
  destroy(): void;
  setRoot(root: Float32Array): void;
  setVisible(visible: boolean): void;
}

export interface EngineCleoHost extends CleoHost {
  /** The concrete memory facade — the F2 coverage view reads its `misses` (decision 3). */
  readonly atlas: AtlasMemory;
  dispose(): void;
  /** The object count — the boot census and tests read it. */
  objectCount(): number;
  /** Per-tick maintenance: LOD pair visibility vs the camera + one matrix flush. */
  update(): void;
}

interface ScriptObject {
  drawDistance: number;
  readonly handle: number;
  readonly instance: CleoObjectInstance;
  /** The far partner's handle when this is the NEAR half of a CONNECT_LODS pair. */
  lodFar: null | number;
  readonly modelName: string;
  /** GTA world position. */
  readonly position: [number, number, number];
  /** GTA Euler degrees (rx, ry, rz) — SET_OBJECT_HEADING collapses to (0, 0, deg). */
  readonly rotation: [number, number, number];
  /** True = this instance is currently the drawn half of its pair. */
  shown: boolean;
}

const DEG_TO_RAD = Math.PI / 180;
/** A LOD pair without a readable draw distance still needs a swap point somewhere. */
const DEFAULT_LOD_SWAP = 300;

/** One row of the F2 thread list — UI-agnostic data the panel formats. */
export interface CleoThreadRow {
  /** Instructions dispatched in the last tick (0 while sleeping). */
  readonly instructions: number;
  readonly name: string;
  readonly state: 'done' | 'fault' | 'run' | 'sleep';
  /** Remaining WAIT (ms) when sleeping, 0 otherwise. */
  readonly waitMs: number;
}

/** The runner system the boot closure wires by name into `runFixedSteps` (decision 7). */
export class CleoRunnerSystem implements System {
  readonly name = 'cleo';

  get enabled(): boolean {
    return this.config.cleo.enabled;
  }

  // --- The F2 CLEO screen's surface (plan 097/07 decision 3) — UI-agnostic accessors. ---

  get tracing(): boolean {
    return this.trace.enabled;
  }

  constructor(
    private readonly config: Config,
    private readonly runner: ScriptRunner,
    private readonly host: EngineCleoHost,
    private readonly trace: TraceRing,
  ) {}

  atlasMisses(): readonly AtlasMiss[] {
    return this.host.atlas.misses;
  }

  coverage(): readonly UnimplementedHit[] {
    return this.runner.coverage();
  }

  dispose(): void {
    this.runner.dispose();
    this.host.dispose();
  }

  faults(): readonly ThreadFaultRecord[] {
    return this.runner.faults;
  }

  fixedUpdate(step: number): void {
    if (!this.config.cleo.enabled || this.config.gameState !== 'play') {
      return;
    }
    this.runner.tick(step * 1000);
    this.host.update();
  }

  instructionsLastTick(): number {
    return this.runner.instructionsLastTick;
  }

  objectCount(): number {
    return this.host.objectCount();
  }

  setEnabled(enabled: boolean): void {
    this.config.cleo.enabled = enabled;
  }

  setTracing(enabled: boolean): void {
    this.trace.enabled = enabled;
    this.config.cleo.trace = enabled;
    if (!enabled) {
      this.trace.clear(); // a stopped trace holds no stale story for the next open
    }
  }

  /** Dispatch ONE instruction on the named thread (the F2 step affordance). */
  step(thread: string): void {
    const target = this.runner.allThreads.find((candidate) => candidate.name === thread);
    if (target) {
      this.runner.step(target);
    }
  }

  threadRows(): readonly CleoThreadRow[] {
    const faulted = new Set(this.runner.faults.map((fault) => fault.thread));

    return this.runner.allThreads.map((thread) => ({
      instructions: thread.instructionsLastTick,
      name: thread.name,
      state: thread.terminated
        ? faulted.has(thread.name)
          ? 'fault'
          : 'done'
        : thread.wakeAt > this.runner.now
          ? 'sleep'
          : 'run',
      waitMs: Math.max(0, Math.round(thread.wakeAt - this.runner.now)),
    }));
  }

  traceLines(thread?: string): readonly string[] {
    return this.trace.snapshot(thread).map((entry) => entry.line);
  }
}

/** The engine-agnostic host core over {@link CleoHostDeps} — everything testable lives here. */
export function createCleoEngineHost(deps: CleoHostDeps): EngineCleoHost {
  const ring = deps.trace;
  const memory = new AtlasMemory(deps.nativeWorld, ring ? (line): void => ring.hostEffect(line) : undefined);
  let reportedMisses = 0;
  const objects = new Map<number, ScriptObject>();
  const deadLogged = new Set<number>();
  const requestedUnresolvable = new Set<number>();
  let nextHandle = 1;
  const root = new Float32Array(16);

  const writeTransform = (object: ScriptObject): void => {
    const [rx, ry, rz] = object.rotation;
    writeGtaRoot(root, gtaPositionToEngine(object.position), gtaEulerToQuat(rx, ry, rz));
    object.instance.setRoot(root);
  };

  /** Detach-safe lookup: a deleted/never-created handle no-ops with a once-log (decision 4). */
  const live = (handle: number): null | ScriptObject => {
    const object = objects.get(handle);
    if (!object && !deadLogged.has(handle)) {
      deadLogged.add(handle);
      // eslint-disable-next-line no-console -- a silently ignored handle is undiagnosable in the field
      console.warn(`[cleo] script object #${handle} does not exist — the call is ignored`);
    }

    return object ?? null;
  };

  const modelNameOf = (id: number): null | { drawDistance: number; modelName: string; txdName: string } => {
    const resolved = deps.resolveById(id);
    if (!resolved && !requestedUnresolvable.has(id)) {
      requestedUnresolvable.add(id);
      // eslint-disable-next-line no-console -- an unresolvable id means a mod's IDE was not installed
      console.warn(`[cleo] model id ${id} resolves to nothing — is the mod's IDE installed?`);
    }

    return resolved;
  };

  return {
    atlas: memory,

    dispose(): void {
      for (const object of objects.values()) {
        object.instance.destroy();
      }
      objects.clear();
    },

    memory,

    models: {
      byName: (name): null | number => deps.resolveByName(name),
      info: (): number => 0, // plan 05's memory facet gives this meaning
      isAvailable: (id): boolean => {
        const resolved = modelNameOf(id);

        return resolved ? deps.ensureModel(resolved.modelName, resolved.txdName) : false;
      },
      markUnneeded: (): void => {
        // The engine's model cache is the eviction authority; scripts cannot force an unload.
      },
      request: (id): void => {
        const resolved = modelNameOf(id);
        if (resolved) {
          deps.ensureModel(resolved.modelName, resolved.txdName);
        }
      },
    },

    objectCount(): number {
      return objects.size;
    },

    objects: {
      connectLods: (near, far): void => {
        const nearObject = live(near);
        const farObject = live(far);
        if (nearObject && farObject) {
          nearObject.lodFar = farObject.handle;
          farObject.shown = false;
          farObject.instance.setVisible(false);
        }
      },
      create: (model, x, y, z): number => {
        const resolved = modelNameOf(model);
        const instance = resolved ? deps.spawn(resolved.modelName) : null;
        if (!resolved || !instance) {
          // The script keeps a handle either way — a missing model must not fault the thread; the
          // handle simply refers to nothing drawn (same as real CLEO with a missing mod model).
          return -1;
        }
        const object: ScriptObject = {
          drawDistance: resolved.drawDistance > 0 ? resolved.drawDistance : DEFAULT_LOD_SWAP,
          handle: nextHandle,
          instance,
          lodFar: null,
          modelName: resolved.modelName,
          position: [x, y, z],
          rotation: [0, 0, 0],
          shown: true,
        };
        nextHandle += 1;
        objects.set(object.handle, object);
        writeTransform(object);

        return object.handle;
      },
      delete: (handle): void => {
        const object = live(handle);
        if (object) {
          object.instance.destroy();
          objects.delete(handle);
        }
      },
      exists: (handle): boolean => objects.has(handle),
      getCoordinates: (handle): readonly [number, number, number] => {
        const object = live(handle);

        return object ? [...object.position] : [0, 0, 0];
      },
      offsetInWorldCoords: (handle, x, y, z): readonly [number, number, number] => {
        // Corpus usage is translation-only reads on unrotated objects; the rotated-frame math
        // arrives with plan 05's part registry if a script demands it.
        const object = live(handle);

        return object ? [object.position[0] + x, object.position[1] + y, object.position[2] + z] : [x, y, z];
      },
      setCoordinates: (handle, x, y, z): void => {
        const object = live(handle);
        if (object) {
          object.position[0] = x;
          object.position[1] = y;
          object.position[2] = z;
          writeTransform(object);
        }
      },
      setHeading: (handle, degrees): void => {
        const object = live(handle);
        if (object) {
          object.rotation[0] = 0;
          object.rotation[1] = 0;
          object.rotation[2] = degrees;
          writeTransform(object);
        }
      },
      setRotation: (handle, rx, ry, rz): void => {
        const object = live(handle);
        if (object) {
          object.rotation[0] = rx;
          object.rotation[1] = ry;
          object.rotation[2] = rz;
          writeTransform(object);
        }
      },
    },

    onUnimplemented(opcode, thread): void {
      // eslint-disable-next-line no-console -- the tier policy (plan 07) needs these visible
      console.warn(
        `[cleo] opcode ${opcode.toString(16).toUpperCase().padStart(4, '0')} unimplemented (thread '${thread}')`,
      );
    },

    player: {
      charCoordinates: (): readonly [number, number, number] => deps.playerGta(),
      exists: (): boolean => true,
      isPlaying: (): boolean => true,
      playerChar: (): number => 1,
    },

    text: {
      printNow: (text, ms): void => deps.print(text, ms),
    },

    update(): void {
      // Surface NEW atlas misses as console lines (the plan 07 F2 panel grows from this): an
      // unserved native must have a NAMED cause in the field, never a silent wrong read.
      while (reportedMisses < memory.misses.length) {
        const miss = memory.misses[reportedMisses];
        reportedMisses += 1;
        // eslint-disable-next-line no-console
        console.warn(`[cleo] atlas miss: ${miss.kind} 0x${miss.address.toString(16)} — ${miss.detail}`);
      }
      const [cx, cy, cz] = deps.cameraGta();
      for (const object of objects.values()) {
        if (object.lodFar === null) {
          continue;
        }
        const far = objects.get(object.lodFar);
        if (!far) {
          continue;
        }
        const dx = object.position[0] - cx;
        const dy = object.position[1] - cy;
        const dz = object.position[2] - cz;
        const nearIsShown = Math.hypot(dx, dy, dz) <= object.drawDistance;
        if (nearIsShown !== object.shown) {
          object.shown = nearIsShown;
          object.instance.setVisible(nearIsShown);
          far.shown = !nearIsShown;
          far.instance.setVisible(!nearIsShown);
        }
      }
      deps.flush();
    },

    vehicles: {
      anyCar: (progress): null | { car: number; progress: number } => deps.cars.anyCar(progress),
      // skipWrecked is dropped knowingly: the script fleet has no wreck state to skip.
      carInSphere: (x, y, z, radius, findNext): null | number => deps.cars.carInSphere(x, y, z, radius, findNext),
      carModel: (car): number => deps.cars.carModel(car),
      doorAngleRatio: (car, door): null | number => deps.nativeWorld.doorAngleRatio(car, door),
      // The player is the only modelled driver — a script asking for another car's driver gets none.
      driverOf: (car): null | number => (deps.cars.playerCar() === car ? 1 : null),
      isCarModel: (model): boolean => deps.cars.isCarModel(model),
      isCharInAnyCar: (): boolean => deps.cars.playerCar() !== null,
      isCharInCar: (char, car): boolean => deps.cars.playerCar() === car,
      storeCarCharIsIn: (): number => deps.cars.playerCar() ?? -1,
    },

    world: {
      cameraWithin: (x, y, z, radius): boolean => {
        const [cx, cy, cz] = deps.cameraGta();

        return Math.hypot(x - cx, y - cy, z - cz) <= radius;
      },
      currentHour: (): number => deps.hour(),
      drawCorona: (): void => {
        // Deliberately dark in 04: the corona lane exists (engine particles) but wiring a per-frame
        // immediate-mode draw belongs with plan 05's field polish. Recorded in the ledger.
      },
      isGameVersionOriginal: (): boolean => true, // the impersonation doctrine
      isPcVersion: (): boolean => true,
      visibleArea: (): number => 0, // interiors are not modelled — outside, always
    },
  };
}

/** Boot discovery (decision 8): every `cleo/*.cs` in the VFS, capped by config, spawned as a thread. */
export function discoverAndSpawn(
  names: readonly string[],
  read: (name: string) => null | Uint8Array,
  runner: ScriptRunner,
  maxScripts: number,
): string[] {
  const scripts = names.filter((name) => name.startsWith('cleo/') && name.endsWith('.cs')).sort();
  if (scripts.length > maxScripts) {
    // eslint-disable-next-line no-console -- a silently skipped script is a missing mod in the field
    console.warn(`[cleo] ${scripts.length} scripts found, running the first ${maxScripts} (config.cleo.maxScripts)`);
  }
  const spawned: string[] = [];
  for (const name of scripts.slice(0, maxScripts)) {
    const bytes = read(name);
    if (!bytes) {
      continue;
    }
    try {
      runner.spawn(decodeScript(bytes), name.slice('cleo/'.length));
      spawned.push(name);
    } catch (error) {
      // eslint-disable-next-line no-console -- a broken script must not cost the others
      console.warn(`[cleo] ${name} failed to decode — skipped:`, error);
    }
  }

  return spawned;
}

/** GTA Euler degrees → native GTA quaternion, composed R = Rz·Ry·Rx (SA `CMatrix::SetRotate`). */
function gtaEulerToQuat(rxDeg: number, ryDeg: number, rzDeg: number): [number, number, number, number] {
  const hx = (rxDeg * DEG_TO_RAD) / 2;
  const hy = (ryDeg * DEG_TO_RAD) / 2;
  const hz = (rzDeg * DEG_TO_RAD) / 2;
  const [sx, cx] = [Math.sin(hx), Math.cos(hx)];
  const [sy, cy] = [Math.sin(hy), Math.cos(hy)];
  const [sz, cz] = [Math.sin(hz), Math.cos(hz)];

  // qz ⊗ qy ⊗ qx
  return [
    cz * cy * sx - sz * sy * cx,
    cz * sy * cx + sz * cy * sx,
    sz * cy * cx - cz * sy * sx,
    cz * cy * cx + sz * sy * sx,
  ];
}
