/**
 * Vehicles on the own engine (plan 074/08 B5 step 4) — the `?engine=opensa` twin of canvas-host's vehicle
 * block. Every gameplay system here is REUSED verbatim (enter/exit, driving, physics, damage, LOD); the only
 * new code is the wiring, because the systems now speak {@link VehicleHandle} instead of three objects.
 *
 * The model cache is the point of the B5 engine work: one uploaded model per CAR TYPE, one instance per car.
 * A street of Landstalkers shares its geometry and its texture array, and differs only by part matrices and
 * a four-colour paint slot.
 */
import type { Engine, VehicleInstance, VehicleModelId } from '@opensa/engine';
import type { EngineVehicleData, GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import type { CharacterControllerSystem } from '@opensa/game/character/character-controller.system';
import type { Logger } from '@opensa/game/diagnostics/logger';
import type { InputState } from '@opensa/game/input';
import type { Config } from '@opensa/game/interfaces/config.interface';
import type { Vec3 } from '@opensa/game/interfaces/world-adapter.interface';
import type {
  PhysicsWorld,
  VehicleController,
  VehicleSpringReading,
  VehicleStance,
} from '@opensa/game/physics/physics-world';
import type { EnterableVehicle, VehicleAnimator } from '@opensa/game/vehicle/enter-vehicle.system';
import type { SteeringModel } from '@opensa/game/vehicle/steering';
import type { SpawnedVehicle, VehiclePlacement } from '@opensa/game/vehicle/vehicle-lod.system';
import type { PlatePlacement } from '@opensa/game/vehicle/vehicle-plates';
import type { CityBox } from '@opensa/game/zones/city';

import { frameSpans, PLATE_CAPACITY } from '@opensa/engine';
import { EngineVehicleHandle, gtaPositionToEngine } from '@opensa/game/adapters/engine-vehicle-handle';
import { EnterVehicleSystem } from '@opensa/game/vehicle/enter-vehicle.system';
import { composePlateText, plateBackgroundIndex } from '@opensa/game/vehicle/plate-raster';
import { BLANK_PLATE_SLOT, PlateSlots } from '@opensa/game/vehicle/plate-slots';
import { STRONG_HIT, VehicleDamageSystem } from '@opensa/game/vehicle/vehicle-damage.system';
import { type VehicleHandle } from '@opensa/game/vehicle/vehicle-handle';
import { VehicleLampSystem } from '@opensa/game/vehicle/vehicle-lamp.system';
import { VehicleLodSystem } from '@opensa/game/vehicle/vehicle-lod.system';
import { VehiclePhysicsSystem } from '@opensa/game/vehicle/vehicle-physics.system';
import { resolvePlate } from '@opensa/game/vehicle/vehicle-plates';
import { VehicleRig } from '@opensa/game/vehicle/vehicle-rig';
import { seatVehicleOnGround } from '@opensa/game/vehicle/vehicle-seating';
import { VehicleSkidMarkSystem } from '@opensa/game/vehicle/vehicle-skid-marks.system';
import {
  type SurfaceFxClass,
  surfaceFxClassOf,
  VehicleSurfaceFxSystem,
} from '@opensa/game/vehicle/vehicle-surface-fx.system';
import { planarMotion, type PlanarMotion, VehicleTelemetry } from '@opensa/game/vehicle/vehicle-telemetry';
import {
  TYRE_SMOKE_DEFAULTS,
  type TyreSmokeDials,
  VehicleTyreSmokeSystem,
} from '@opensa/game/vehicle/vehicle-tyre-smoke.system';

import type { DynamicFxEmitter } from './engine-particles';

import { parseParkedVehicles } from '../parked-vehicles';

export interface EngineVehicles {
  /** The car the player is seated in, or null — the host follows it with the camera. */
  activeVehicle(): EnterableVehicle | null;
  /**
   * Apply the driven car's controls — call BEFORE the physics step (plan 081/02 §4). Without it the systems
   * still drive, one step late; with it a press reaches the wheels in the step it was made.
   */
  applyControls(step: number): void;
  /** Whether enter/exit is actionable right now — gates the on-screen Enter button (plan 055). */
  canEnterExit(): boolean;
  /**
   * The driven car's speed and slip RIGHT NOW, or null on foot (plan 080/05's drift framing reads it every
   * rendered frame). Deliberately not behind {@link EngineVehicles.telemetry}'s capture gate: this is four
   * dot products off the body, while a capture is the ring plus the per-wheel channels. Same
   * `planarMotion` either way, so the camera and a capture can never disagree about a slide's direction.
   */
  drivenMotion(): null | PlanarMotion;
  /**
   * FIXED step — must be called from the host's fixed loop, AFTER the physics step. Enter/exit does all its
   * rider placement and its driving here (prod's `Game` runs every system's `fixedUpdate` before `update`).
   * Skipping this leaves the sequence frozen mid-climb-in: the controller stays disabled, the door stays
   * open and the car never drives — the phase machine simply never advances.
   */
  fixedUpdate(step: number): void;
  /**
   * The hardest contact force the DRIVEN car took this frame (N), 0 on foot or when nothing hit it — the
   * camera's impact shake (plan 080/06). It comes from the damage system's own collision observation
   * because `physics.takeImpacts()` drains: a second listener would race it and one of them would see
   * nothing.
   */
  impactForce(): number;
  /** True while a scripted enter/exit is mid-sequence — the camera glides to its target instead of
   *  auto-centering on the ped's approach/climb twitches. */
  isSettling(): boolean;
  /**
   * Put the player straight OUT of the car, no climb-out (096/02) — the twin of
   * {@link EngineVehicles.seatInstantly}. False when nobody is seated.
   */
  leaveInstantly(): boolean;
  /** The model's half-extents `[hx, hy, hz]` (vehicle space) — builds/caches the model as a side effect.
   *  The debug spawner reads hy (half the LENGTH) so a bus lands in FRONT of the player, not around him. */
  modelHalfExtents(model: string): Promise<readonly [number, number, number]>;
  /** Register placements to spawn LAZILY by distance (the LOD system streams them) — the bench road cars. */
  register(placements: readonly VehiclePlacement[]): void;
  /**
   * The car whose pose OWNS the player right now — from the start of the climb-in slide to the end of the
   * climb-out one, not merely while walking to the door. The host must switch its walking rules off for it
   * (ground snap, locomotion heading), else the rider floats above the roof through the whole climb-in.
   */
  ridingVehicle(): EnterableVehicle | null;
  /** The `095F` door read for a script vehicle (front doors only — the walk-up animator's swing). */
  scriptDoorRatio(scriptHandle: number, side: 'lf' | 'rf'): number;
  /** CLEO's live-vehicle surface: every spawned car under its stable script handle (plan 097/05). */
  scriptVehicles(): readonly ScriptVehicle[];
  /**
   * Put the player straight into the nearest car, skipping the walk/door/climb-in (plan 081/01). False when
   * nothing is in range or a sequence is already running. For automation that measures DRIVING — a scripted
   * lap must not lose its baseline to a walk-in that cancelled itself.
   */
  seatInstantly(): boolean;
  /** Spawn a car and register it with the LOD system (persists like a parked car) — used for test spawns. */
  spawn(placement: VehiclePlacement): Promise<void>;
  /**
   * Spawn a car that belongs to ONE scripted scene and hand back its despawn (096/02).
   *
   * Deliberately NOT registered with the LOD streamer: {@link EngineVehicles.spawn} adds a permanent,
   * respawnable placement, and an endless video session doing that would leave a car standing at the start of
   * every route it ever drove — each one ready to reappear the moment a later route passes within LOD range.
   */
  spawnOnce(placement: VehiclePlacement): Promise<() => void>;
  /**
   * The driven car's spring setup, or null on foot (plan 081/02). Constant per car, so a capture reads it
   * once — and it exists so a run can SAY what it was configured with. An A/B where the runs cannot be told
   * apart from their own record is not a measurement.
   */
  springs(): null | readonly VehicleSpringReading[];
  /** What the car is STANDING on — see {@link VehicleStance}. Null on foot. */
  stance(): null | VehicleStance;
  /**
   * The driven car's live steering model (096/02) — null on foot. What an autopilot needs to turn a wanted
   * wheel angle into `move.x`, which is a SHARE of a lock that changes every step, not an angle.
   */
  steering(): null | SteeringModel;
  /**
   * The driven car's physics telemetry (plan 081/01): speed, slip, per-wheel load and travel, sampled every
   * fixed step while `enabled`. **This is the slip/speed channel plan 080/05 reads for drift framing** —
   * the camera must not re-derive it from poses, or it measures the render loop instead of the physics.
   * Disabled by default and inert then.
   */
  readonly telemetry: VehicleTelemetry;
  /** Per-frame (variable dt): draw cars at the interpolated pose (`alpha` = fraction into the next fixed
   *  step), then input/approach/doors, damage, LOD streaming. */
  update(delta: number, alpha: number): void;
}

export interface EngineVehiclesDeps {
  adapter: GtaSaWorldAdapter;
  /** Turn the follow camera to an azimuth (enter-vehicle centres it behind the car once). */
  aimCamera: (azimuth: number) => void;
  animator: VehicleAnimator;
  /** The city boxes plates read (desert first) — a thunk because they load after this setup runs. */
  cityBoxes: () => readonly CityBox[];
  config: Readonly<Config>;
  engine: Engine;
  /** Camera position (native Z-up) — the lamp coronas fade by how squarely a lamp faces it. */
  eye: () => Vec3;
  fs: { getText(name: string): null | string };
  input: InputState;
  /** Night gate for the lamps (the shared timecyc `dn`, like prod's `isNight`). */
  isNight: () => boolean;
  logger: Logger;
  /** Register `parked.json` at all (default true). `?parked=0` leaves the streets empty of parked cars —
   *  a BISECTION knob: they are the one population that spawns and unloads by itself while driving, so a
   *  fault that only appears with them on is a fault in that churn, not in a car or a place. */
  parkedCars?: boolean;
  physics: PhysicsWorld;
  placePlayer: (position: Vec3, moveBody?: boolean) => void;
  playerCollider: number;
  playerController: CharacterControllerSystem;
  playerPosition: () => Vec3;
  /** Session overrides for the tyre-smoke dials (`?smokeStart/?smokeFull/?smokeRate` — 081/09 pattern). */
  smokeDials?: Partial<TyreSmokeDials>;
  /** The dynamic lane's collisionsmoke emitter (089/02); null = no FX library, smoke silently off. */
  smokeEmitter?: DynamicFxEmitter | null;
  /** Emitter factory for the surface effects (089/05) — `EngineParticles.createEmitter`, absent-tolerant. */
  surfaceEmitter?: (name: string) => DynamicFxEmitter | null;
  viewOf: () => Vec3;
}

/** One live car on CLEO's surface (plan 097/05): the slot-minted script handle + the part registry. */
export interface ScriptVehicle {
  readonly enterable: EnterableVehicle;
  /** The model name the car spawned as (resolves to an id through the adapter). */
  readonly model: string;
  /** `slot*256 + counter` (counter 1-127, bit7 clear) — what the pool-facade byte walk reconstructs. */
  readonly scriptHandle: number;
  readonly vehicle: VehicleHandle;
}

export function setupEngineVehicles(deps: EngineVehiclesDeps): EngineVehicles {
  const { adapter, config, engine, physics } = deps;

  // --- License plates (plan 082/04) -------------------------------------------------------------------
  // The rasters come from the game's own `generic/vehicle.txd` via the adapter (the layer that may read
  // renderware). A dictionary we cannot read leaves `plateSources` null and every car keeps the stock
  // placeholder — plates are cosmetic and must never be a reason a car fails to spawn.
  const plateSources = adapter.plateSources();
  const plateSlots = plateSources ? new PlateSlots(engine, PLATE_CAPACITY) : null;
  if (plateSources) {
    engine.uploadPlateBackgrounds(plateSources.backgrounds);
    // Layer 0 is reserved and never handed out — an unassigned car reads it, so it must hold a BLANK
    // plate rather than the uninitialised black the array starts as. Empty text composes eight blank cells.
    engine.uploadPlateText(BLANK_PLATE_SLOT, composePlateText('', plateSources.charset));
  }

  /** Give one spawned car its plate; returns the atlas layer it claimed, so despawn can release it. */
  const dressPlate = (instance: VehicleInstance, placement: PlatePlacement): null | number => {
    if (!plateSources || !plateSlots) {
      return null;
    }
    const plate = resolvePlate(placement, config.vehicle.plates, deps.cityBoxes());
    const slot = plateSlots.claim(plate.text, () => composePlateText(plate.text, plateSources.charset));
    instance.setPlate(slot, plateBackgroundIndex(plate.city));

    return slot;
  };

  const vehiclePhysics = new VehiclePhysicsSystem(physics);
  const vehicleDamage = new VehicleDamageSystem(physics, deps.logger);
  let seated: EnterableVehicle | null = null;

  const enterVehicle = new EnterVehicleSystem(
    deps.input,
    deps.playerPosition,
    deps.playerController,
    deps.placePlayer,
    deps.animator,
    deps.aimCamera,
    (vehicle) => (seated = vehicle), // the host's camera follows the car while seated
    config,
    physics,
    deps.playerCollider,
    deps.logger,
  );

  // Telemetry (plan 081/01): only the DRIVEN car is instrumented — a capture is about the car under the
  // player, and sampling a street of parked cars would cost per step for nothing. Off by default: the
  // `enabled` check comes first so a shipped build does not even read the body.
  // 60 s of fixed steps: the longest scripted scene is 24 s and a capture must hold the WHOLE lap — a ring
  // that wrapped mid-lap would silently drop the launch and report the tail as the run.
  const telemetry = new VehicleTelemetry(3600);
  let instrumented: EnterableVehicle | null = null;
  const stepTelemetry = (step: number): void => {
    const car = enterVehicle.isSeated() ? enterVehicle.getActive() : null;
    if (!telemetry.enabled || car === null) {
      instrumented = car;

      return;
    }
    if (car !== instrumented) {
      // A different car (or the first one this capture): its history belongs to the previous car.
      telemetry.reset();
      instrumented = car;
    }
    const controls = enterVehicle.appliedControls();
    telemetry.step(
      {
        brake: controls.brake,
        engineForce: controls.engineForce,
        gear: controls.gear,
        handbrake: controls.handbrake,
        linvel: physics.getLinvel(car.body),
        orientation: car.orientation,
        position: car.position,
        steer: controls.steer,
        // What each wheel is standing on (081/10 step 4). Only the DRIVEN car is probed, and only while a
        // capture is running — four rays are the same order as the whole controller update (081/07 §3).
        // What each wheel is standing on (081/10 step 4). Only the DRIVEN car is probed, and only while a
        // capture is running — four rays are the same order as the whole controller update (081/07 §3).
        surfaces: physics.readVehicleWheelSurfaces(car.controller, car.body),
        throttle: controls.throttle,
        wheels: physics.readVehicleWheels(car.controller),
      },
      step,
    );
  };

  // Lamps (step 5): the SAME decision logic the three path uses, wired to the engine's light pool and its
  // EXISTING corona pass — no second corona renderer.
  const lamps = new VehicleLampSystem(enterVehicle, deps.isNight, () => config.graphics.headlights, {
    corona: (corona): void => {
      engine.dynamicCoronas.push({
        color: corona.color,
        fade: corona.fade,
        position: gtaPositionToEngine(corona.position),
        size: corona.size,
      });
    },
    eye: deps.eye,
    light: (light): void => {
      engine.dynamicLights.push({
        color: light.color,
        // The cone DIRECTION is a vector, not a point — it takes the same Z-up → Y-up basis change.
        ...(light.cone
          ? {
              cone: {
                cosAngle: light.cone.cosAngle,
                direction: gtaPositionToEngine(light.cone.direction),
              },
            }
          : {}),
        position: gtaPositionToEngine(light.position),
        radius: light.radius,
      });
    },
    reset: (): void => {
      engine.dynamicLights.length = 0;
      engine.dynamicCoronas.length = 0;
    },
  });

  // Tyre smoke (plan 089/02): the driven car's sliding wheels burst collisionsmoke into the dynamic lane
  // (089/01). Signal = contact-patch slide speed (covers burnout, lockup and the handbrake slide with one
  // number); the look mapping is an EYE-FIT — docs/hacks/tyre-smoke-intensity-fit.md. Deliberately not on
  // the telemetry sampler: that is the F2/capture gate, and smoke must not need the debugger open.
  const smokeEmitter = deps.smokeEmitter ?? null;
  const tyreSmoke = new VehicleTyreSmokeSystem(
    () => (enterVehicle.isSeated() ? enterVehicle.getActive() : null),
    physics,
    (puff): void => {
      if (!smokeEmitter) {
        return;
      }
      const [ex, ey, ez] = gtaPositionToEngine(puff.position);
      smokeEmitter.position[0] = ex;
      smokeEmitter.position[1] = ey;
      smokeEmitter.position[2] = ez;
      // Life from intensity: a gentle chirp wisps away (~1.25 s of the authored 5), a hard skid lingers
      // (~2.5 s). Opacity from intensity SQUARED (field round 2): a launch reads ~12 %, a full slide 50 %.
      smokeEmitter.lifeScale = 0.25 + 0.25 * puff.intensity;
      smokeEmitter.alphaScale = 0.1 + 0.4 * puff.intensity * puff.intensity;
      smokeEmitter.burst(puff.count);
    },
    { ...TYRE_SMOKE_DEFAULTS, ...deps.smokeDials },
    () => config.graphics.effects.enabled,
  );

  // Impact smoke (plan 089/04): a puff at the contact point when a hit passes the damage system's
  // strong-hit gate — the same event that deforms a panel, so a kerb tap never puffs. Sized by how far
  // past the gate the force went (an eye-fit — docs/hacks/impact-smoke-fit.md). Reuses the collisionsmoke
  // emitter; a burst is instantaneous, so repositioning the shared emitter per event is safe.
  vehicleDamage.onStrongHit = (force, point): void => {
    if (!smokeEmitter || !config.graphics.effects.enabled) {
      return;
    }
    const [ex, ey, ez] = gtaPositionToEngine([point[0], point[1], point[2]]);
    smokeEmitter.position[0] = ex;
    smokeEmitter.position[1] = ey;
    smokeEmitter.position[2] = ez;
    const severity = Math.min(1, (force - STRONG_HIT) / (3 * STRONG_HIT)); // 1 at ~4× the damage gate
    smokeEmitter.lifeScale = 0.4 + 0.3 * severity;
    smokeEmitter.alphaScale = 0.25 + 0.25 * severity;
    smokeEmitter.burst(3 + Math.round(5 * severity));
  };

  // Skid marks (plan 089/03): the same slide signal, laid down as decal-ribbon segments. The sink converts
  // each corner to engine space; the engine's ring recycles the oldest mark when full and fades on the
  // WALL clock (the brief's 5 real seconds).
  const skidMarks = new VehicleSkidMarkSystem(
    () => (enterVehicle.isSeated() ? enterVehicle.getActive() : null),
    physics,
    (segment): void => {
      engine.addSkidSegment({
        alpha0: segment.alpha0,
        alpha1: segment.alpha1,
        l0: gtaPositionToEngine(segment.left0),
        l1: gtaPositionToEngine(segment.left1),
        r0: gtaPositionToEngine(segment.right0),
        r1: gtaPositionToEngine(segment.right1),
        v0: segment.v0,
        v1: segment.v1,
      });
    },
    () => config.graphics.effects.enabled,
  );

  // Surface effects (plan 089/05): dust/grass/gravel/mud/sand/spray by the surfinfo W_* flag under each
  // wheel — the original's AddWheelDirtAndWater dispatch. Rolling on a flagged surface at speed throws
  // material with no slide at all; the class → look table is an eye-fit (docs/hacks/surface-fx-fit.md).
  // The systems are lane ALIASES: the same white-authored prt_wheeldirt registered per class with an
  // earthy tint — the stand-in for SA's per-spawn ground colour (see DYNAMIC_SYSTEMS in engine-particles).
  const SURFACE_FX_LOOK: Record<SurfaceFxClass, { alpha: number; life: number; system: string }> = {
    dust: { alpha: 0.18, life: 0.35, system: 'wheeldirt-dust' },
    grass: { alpha: 0.16, life: 0.3, system: 'wheeldirt-grass' },
    gravel: { alpha: 0.18, life: 0.3, system: 'wheeldirt-dust' },
    mud: { alpha: 0.22, life: 0.4, system: 'wheeldirt-mud' },
    sand: { alpha: 0.22, life: 0.35, system: 'prt_sand' },
  };
  const surfaceEmitters = new Map<string, DynamicFxEmitter | null>();
  const surfaceRecords = (): ReturnType<GtaSaWorldAdapter['surfaces']> => adapter.surfaces();
  const surfaceFx = new VehicleSurfaceFxSystem(
    () => (enterVehicle.isSeated() ? enterVehicle.getActive() : null),
    physics,
    (surface): null | SurfaceFxClass => surfaceFxClassOf(surface === null ? undefined : surfaceRecords()?.[surface]),
    (puff): void => {
      const look = SURFACE_FX_LOOK[puff.fx];
      if (!surfaceEmitters.has(look.system)) {
        surfaceEmitters.set(look.system, deps.surfaceEmitter?.(look.system) ?? null);
      }
      const emitter = surfaceEmitters.get(look.system);
      if (!emitter) {
        return;
      }
      const [ex, ey, ez] = gtaPositionToEngine(puff.position);
      emitter.position[0] = ex;
      emitter.position[1] = ey;
      emitter.position[2] = ez;
      emitter.lifeScale = look.life;
      emitter.alphaScale = look.alpha * (0.6 + 0.4 * puff.intensity);
      emitter.burst(puff.count);
    },
    () => config.graphics.effects.enabled,
  );

  /**
   * One uploaded engine model per car TYPE — instances share geometry, textures and the pipeline. LRU-BOUNDED
   * (074/21 follow-up, pre-flip fix): types accumulated forever (+950 MB of texture arrays over one bench
   * sweep — the residency field report), so despawning the last instance of a type makes it evictable and
   * the cache trims back to {@link MODEL_CACHE_TEXTURE_BYTES} oldest-first. A re-encountered type rebuilds
   * through the existing worker (spawns already defer, so the ~100–200 ms build never blocks the frame).
   */
  const models = new Map<string, VehicleModelEntry>();
  // CLEO's live fleet (plan 097/05): slots REUSE (the pool walk is bounded at 140 slots and road
  // cars churn constantly); the counter (1-127, bit7 clear) is exactly SA's staleness detector.
  const scriptSlots: (null | (ScriptVehicle & { slot: number }))[] = [];
  const scriptCounters: number[] = [];
  const mintScriptVehicle = (enterable: EnterableVehicle, vehicle: VehicleHandle, model: string): { slot: number } => {
    let slot = scriptSlots.findIndex((entry) => entry === null);
    if (slot < 0) {
      slot = scriptSlots.length;
      scriptSlots.push(null);
      scriptCounters.push(0);
    }
    scriptCounters[slot] = (scriptCounters[slot] % 127) + 1;
    scriptSlots[slot] = { enterable, model, scriptHandle: slot * 256 + scriptCounters[slot], slot, vehicle };

    return { slot };
  };
  /** In-flight builds by type — two simultaneous spawns of a NEW type must share one build (the loser used
   *  to overwrite the winner's map entry, leaking the winner's GPU model — harmless before eviction existed,
   *  a real leak now). */
  const pendingModels = new Map<string, Promise<VehicleModelEntry>>();
  const evictModels = (): void => {
    let total = 0;
    for (const entry of models.values()) {
      total += entry.textureBytes;
    }
    while (total > MODEL_CACHE_TEXTURE_BYTES) {
      let lruName: null | string = null;
      let lru: null | VehicleModelEntry = null;
      for (const [name, entry] of models) {
        if (entry.instances === 0 && (lru === null || entry.lastUsed < lru.lastUsed)) {
          lru = entry;
          lruName = name;
        }
      }
      if (lruName === null || lru === null) {
        break; // every cached type has live instances — the budget is a trim floor, not a hard cap
      }
      engine.destroyVehicleModel(lru.id);
      models.delete(lruName);
      total -= lru.textureBytes;
    }
  };
  const buildModel = async (name: string): Promise<VehicleModelEntry> => {
    // The model is colour-AGNOSTIC by construction (paint is a per-vertex slot resolved per instance), so
    // one upload serves every colour of this car — and the DFF is parsed exactly once per type.
    const data = await adapter.loadVehicleData(name);
    const entry: VehicleModelEntry = {
      data,
      // The adapter hands over an already engine-ready model — both the optimized (`.osm`/`.ostex`) and the
      // unoptimized (DFF/TXD) path converge on it, so nothing here needs to know which one ran.
      //
      // This runs in a promise continuation, BETWEEN frames, so no timer the loop keeps can see it — it
      // reports itself instead (plan 091 phase 2), and the next frame is charged for it.
      id: frameSpans.measure(`vehicle-model:${name}`, () => engine.createVehicleModel(data.model)),
      instances: 0,
      lastUsed: performance.now(),
      textureBytes: textureBytesOf(data.model.textures),
    };
    models.set(name, entry);

    return entry;
  };
  /**
   * Resolve a type's model AND claim one instance on it, atomically from eviction's point of view: the
   * increment happens with no await between the entry becoming visible and the claim, and `evictModels`
   * only ever runs AFTER a claim (or on release) — so a fresh build can never be evicted before its
   * requester claims it. (The first version evicted the just-built entry inside `buildModel` whenever the
   * budget was already full of pinned types — the boot's parked cars died with "unknown model".)
   */
  const acquireModel = async (name: string): Promise<VehicleModelEntry> => {
    const cached = models.get(name);
    if (cached) {
      cached.instances += 1;
      cached.lastUsed = performance.now();

      return cached;
    }
    let pending = pendingModels.get(name);
    if (!pending) {
      pending = buildModel(name).finally(() => pendingModels.delete(name));
      pendingModels.set(name, pending);
    }
    const entry = await pending;
    entry.instances += 1;
    entry.lastUsed = performance.now();
    evictModels();

    return entry;
  };

  const spawnVehicle = async (placement: VehiclePlacement): Promise<SpawnedVehicle> => {
    const { heading, model } = placement;
    const entry = await acquireModel(model);
    const { data, id } = entry;
    let plateSlot: null | number = null;
    // What this spawn has already put into the world, so a throw part-way through can take it back out
    // (see the catch below — an abandoned chassis is not a leak, it is a crash waiting for the next step).
    let spawnedInstance: null | VehicleInstance = null;
    let spawnedPhysics: null | { body: number; controller: VehicleController } = null;
    let spawnedVehicle: EnterableVehicle | null = null;
    const release = (): void => {
      entry.instances = Math.max(0, entry.instances - 1);
      entry.lastUsed = performance.now();
      if (plateSlot !== null) {
        plateSlots?.release(plateSlot); // one fewer car wearing this plate; the raster stays resident
        plateSlot = null;
      }
      evictModels();
    };
    try {
      const paint = await adapter.vehiclePaint(model, placement.colour); // the model is shared; the paint is not
      // From here down the spawn is synchronous, and it runs between frames like the build above — so it
      // times itself (plan 091 phase 2). A spawn that THROWS is not attributed; that path is rare and it
      // already names itself in the console.
      const spawnStarted = performance.now();

      let position: Vec3 = placement.position;
      let pitch = 0;
      // The probe runs for EVERY placement, because its throw is what defers a spawn until the collision cell
      // exists — a dynamic body created over a hole free-falls, and the LOD system then measures its unload
      // distance from wherever it fell. `groundSnap` decides only whether we also RE-SEAT the car on what the
      // probe found (map car generators + bench road cars, whose IPL spots sit in tight/clipping places);
      // `parked.json`'s hand-authored spots keep their own position and pitch, as they always have.
      const seated = seatVehicleOnGround(physics, position, placement.heading, data.halfExtents);
      if (placement.groundSnap) {
        position = seated.position;
        pitch = seated.pitch;
      }

      const instance = engine.createVehicle(id);
      spawnedInstance = instance;
      instance.setPaint(paint);
      // The plate is resolved from the PLACEMENT, not from where the player is standing (plan 082/04), so a
      // far-streamed San Fierro car wears SF plates and a parked car keeps its number across LOD respawns.
      // This is the single wiring point every spawn path flows through: parked cars, map car generators,
      // popcycle road cars, the bench fleet and the debug spawner.
      plateSlot = dressPlate(instance, { ...placement, position });
      const handle = new EngineVehicleHandle(instance, data.rig, () => engine.destroyVehicle(instance));
      const wheels = data.wheels.map((wheel) => ({
        connection: wheel.connection,
        front: wheel.front,
        radius: wheel.radius,
      }));
      // The rig leans the drawn wheels the way the car was AUTHORED (081/06 §3): the axle build comes from
      // `modelFlags`, the track width from the same hub placements the physics is given.
      const rig = new VehicleRig(handle, {
        axles: { front: data.handling.axleFront, rear: data.handling.axleRear },
        drive: data.handling.drive,
        wheels,
      });
      const { body, controller, wheelLift } = physics.createDynamicVehicle(
        position,
        heading,
        data.colliders?.shape ?? null,
        {
          centreOfMass: data.handling.centreOfMass,
          mass: data.handling.mass,
          suspension: {
            bias: data.handling.suspBias,
            damping: data.handling.suspDamping,
            force: data.handling.suspForce,
            restLength: Math.abs(data.handling.suspLower),
            travel: Math.abs(data.handling.suspUpper),
          },
          traction: {
            bias: data.handling.tractionBias,
            loss: data.handling.tractionLoss,
            mult: data.handling.tractionMult,
          },
          turnMass: data.handling.turnMass,
        },
        wheels,
        data.halfExtents,
        pitch,
      );
      spawnedPhysics = { body, controller };
      // Driver seat = the front-seat dummy mirrored to the −X (driver) side.
      const seatLocal: [number, number, number] = data.seat
        ? [-Math.abs(data.seat[0]), data.seat[1], data.seat[2]]
        : [-0.4, 0, 0];
      const live: Vec3 = [position[0], position[1], position[2]];
      const vehicle: EnterableVehicle = {
        body,
        controller,
        halfExtents: data.halfExtents,
        handle,
        handling: data.handling,
        heading,
        // Seeded from the placement; the physics system keeps it live from the body.
        orientation: headingQuat(heading),
        position: live,
        renderOrientation: headingQuat(heading),
        renderPosition: [position[0], position[1], position[2]],
        rig,
        seatLocal,
        wheelLift,
        wheels,
      };
      handle.setTransform(position, headingQuat(heading)); // pose it before the first frame draws it
      spawnedVehicle = vehicle;
      vehiclePhysics.add(vehicle);
      enterVehicle.add(vehicle);
      vehicleDamage.add({ body, handle });
      const scriptSlot = mintScriptVehicle(vehicle, handle, model);
      frameSpans.add(`vehicle-spawn:${model}`, performance.now() - spawnStarted);

      return {
        despawn: (): void => {
          scriptSlots[scriptSlot.slot] = null;
          vehiclePhysics.remove(vehicle);
          enterVehicle.remove(vehicle);
          vehicleDamage.remove(body);
          physics.removeVehicle(controller); // drop the raycast controller before its body
          physics.removeBodies([body]);
          handle.dispose();
          release(); // the type becomes evictable once its last instance is gone
        },
        handle,
        position: live,
      };
    } catch (error) {
      // A throw PAST `createDynamicVehicle` used to abandon the chassis body and its raycast controller in
      // the physics world with nothing left holding a reference to either. That is not a mere leak: the
      // orphaned controller keeps being stepped, and `updateVehicle` PANICS the moment its body goes
      // (`PhysicsWorld.removeVehicle` documents the order). A panic inside wasm never releases Rapier's
      // borrow, so the whole world is poisoned and every later read dies with "recursive use of an object"
      // — pointing at whatever read it first, never at the spawn that caused it.
      // Unwind in `despawn`'s exact order: registrations, controller, THEN the body.
      if (spawnedVehicle !== null) {
        vehiclePhysics.remove(spawnedVehicle);
        enterVehicle.remove(spawnedVehicle);
      }
      if (spawnedPhysics !== null) {
        vehicleDamage.remove(spawnedPhysics.body);
        physics.removeVehicle(spawnedPhysics.controller);
        physics.removeBodies([spawnedPhysics.body]);
      }
      if (spawnedInstance !== null) {
        engine.destroyVehicle(spawnedInstance);
      }
      release(); // a failed spawn must not pin the type in the cache forever
      throw error;
    }
  };

  // ONE placement must never cost the whole system, and a car that never appears must never do it in silence:
  // two unconvertible hi-poly mod cars once killed spawning for all 201 models, and the whole map's parked
  // cars once vanished for a session with nothing in the console at all. A spawn is allowed to be REJECTED —
  // that is how it waits for its collision cell — so only an entry that keeps failing is worth a word, and
  // only the first one per model.
  const failedModels = new Set<string>();
  const reportSpawnFailure = (placement: VehiclePlacement, error: unknown, attempts: number): void => {
    if (attempts < STUCK_SPAWN_ATTEMPTS || failedModels.has(placement.model)) {
      return;
    }
    failedModels.add(placement.model);
    // eslint-disable-next-line no-console -- a silently missing car is exactly what hid this twice
    console.warn(
      `[vehicles] '${placement.model}' at ${placement.position.map((axis) => Math.round(axis)).join(',')} ` +
        `has failed to spawn ${attempts} times in a row: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  };
  const vehicleLod = new VehicleLodSystem(deps.viewOf, config, spawnVehicle, reportSpawnFailure);
  // Parked cars come from the game's `parked.json` in the VFS (shipped per game); absent → none. They are
  // REGISTERED, not spawned here: pre-spawning all of them put every car on the map into the world at boot,
  // most of them far outside the collision radius, where they fell (docs/open-issues/, fixed 2026-08-02).
  const parked = deps.parkedCars === false ? [] : parseParkedVehicles(deps.fs.getText('parked.json'));
  for (const placement of parked) {
    vehicleLod.register(placement);
  }
  // Every population of the world says how big it is at boot. An empty map renders exactly like a full one,
  // and that is how 1043 map car generators went unasked-for for six weeks with nothing in the console
  // (`docs/restrictions/architecture.md`).
  // eslint-disable-next-line no-console -- boot census, one line
  console.log(
    `[vehicles] parked placements registered: ${parked.length}` +
      (deps.parkedCars === false ? ' (DISABLED by ?parked=0)' : ''),
  );

  return {
    activeVehicle: (): EnterableVehicle | null => seated,
    applyControls: (step: number): void => enterVehicle.applyControls(step),
    canEnterExit: (): boolean => enterVehicle.canEnterExit(),
    drivenMotion(): null | PlanarMotion {
      const car = enterVehicle.isSeated() ? enterVehicle.getActive() : null;

      return car === null ? null : planarMotion(car.orientation, physics.getLinvel(car.body));
    },
    fixedUpdate(step: number): void {
      // Sample the bodies (which the physics step just moved) into the gameplay pose + the interp snapshots,
      // BEFORE enter/exit reads car.position/heading for this step.
      vehiclePhysics.snapshot(step);
      enterVehicle.fixedUpdate(step);
      // Telemetry LAST: it records the step as it ended, including the controls `drive()` just applied.
      stepTelemetry(step);
      // Smoke, marks and surface puffs after the snapshot: they read the wheel state this step produced.
      tyreSmoke.fixedUpdate(step);
      skidMarks.fixedUpdate();
      surfaceFx.fixedUpdate(step);
    },
    impactForce(): number {
      const car = enterVehicle.isSeated() ? enterVehicle.getActive() : null;

      return car === null ? 0 : vehicleDamage.peakImpact(car.body);
    },
    isSettling: (): boolean => enterVehicle.isSettling(),
    leaveInstantly: (): boolean => enterVehicle.leaveInstantly(),
    async modelHalfExtents(model: string): Promise<readonly [number, number, number]> {
      const entry = await acquireModel(model);
      // acquireModel counts an instance that this read never spawns — hand it straight back.
      entry.instances = Math.max(0, entry.instances - 1);

      return entry.data.halfExtents;
    },
    register(placements: readonly VehiclePlacement[]): void {
      for (const placement of placements) {
        vehicleLod.register(placement);
      }
    },
    ridingVehicle: (): EnterableVehicle | null => (enterVehicle.isRiding() ? enterVehicle.getActive() : null),
    scriptDoorRatio: (scriptHandle: number, side: 'lf' | 'rf'): number => {
      const entry = scriptSlots.find((candidate) => candidate?.scriptHandle === scriptHandle);

      return entry ? enterVehicle.doorOpenRatio(entry.enterable, side) : 0;
    },
    scriptVehicles: (): readonly ScriptVehicle[] =>
      scriptSlots.filter((entry): entry is NonNullable<(typeof scriptSlots)[number]> => entry !== null),
    seatInstantly: (): boolean => enterVehicle.seatInstantly(),
    async spawn(placement: VehiclePlacement): Promise<void> {
      vehicleLod.add(placement, await spawnVehicle(placement));
    },
    async spawnOnce(placement: VehiclePlacement): Promise<() => void> {
      const { despawn } = await spawnVehicle(placement);

      return despawn;
    },
    springs: (): null | readonly VehicleSpringReading[] => {
      const car = enterVehicle.isSeated() ? enterVehicle.getActive() : null;

      return car === null ? null : physics.readVehicleSprings(car.controller);
    },
    stance: (): null | VehicleStance => {
      const car = enterVehicle.isSeated() ? enterVehicle.getActive() : null;
      if (car === null) {
        return null;
      }
      const wheels = physics.readVehicleWheels(car.controller);
      const { mass } = physics.readMassProperties(car.body);

      return {
        mass,
        // The whole point of the block: a car standing on its own collision hull carries part of its weight
        // on the hull, so its springs read light — and since tyre grip is `μ × load`, its wheels quietly
        // stop steering, driving and braking. Nothing else in a capture shows that.
        weightOnGround: Number((wheels.reduce((total, w) => total + w.suspensionForce, 0) / (mass * 9.81)).toFixed(3)),
        wheels: wheels.map((wheel) => ({
          contact: wheel.contact,
          load: Number(wheel.suspensionForce.toFixed(1)),
          radius: wheel.radius,
          restLength: wheel.restLength,
          suspensionLength: Number(wheel.suspensionLength.toFixed(4)),
        })),
      };
    },
    steering: (): null | SteeringModel => enterVehicle.steeringModel(),
    telemetry,
    update(delta: number, alpha: number): void {
      // Draw each car at the interpolated pose (smooth at any refresh), then the variable-rate systems:
      // damage reacts to this step's impacts, enter/exit handles input and doors, LOD streams last.
      vehiclePhysics.render(alpha);
      vehicleDamage.update(delta);
      enterVehicle.update(delta);
      lamps.update();
      vehicleLod.update();
      engine.updateVehicles(); // ONE flatten+upload for every car, after all of them have moved
    },
  };
}

/**
 * Cached-model TEXTURE budget, bytes (the dominant per-type cost — geometry is small next to a 512²×16
 * RGBA array at ~16 MB). Types with live instances never evict, so this is a trim FLOOR, not a hard cap:
 * ~15 modded or ~70 stock idle types stay warm; beyond it the least-recently-used idle type is destroyed
 * and rebuilds through the worker on the next encounter.
 */
const MODEL_CACHE_TEXTURE_BYTES = 256 * 1024 * 1024;

/**
 * Consecutive rejected spawns before an entry is reported. A spawn is REJECTED while its collision cell is
 * still streaming, which is normal and self-healing, so the threshold has to outlast that — a few seconds of
 * frames. What it catches is the other kind: an entry that will retry silently until the tab closes.
 */
const STUCK_SPAWN_ATTEMPTS = 300;

/** One cached car TYPE: the adapter data + the uploaded engine model + the LRU bookkeeping. */
interface VehicleModelEntry {
  data: EngineVehicleData;
  id: VehicleModelId;
  /** Live engine instances of this type — non-zero pins the entry (never evicted under it). */
  instances: number;
  /** `performance.now()` of the last build/spawn/despawn touch — the LRU ordering key. */
  lastUsed: number;
  /** The texture-array payload size — what the budget actually meters. */
  textureBytes: number;
}

/** Body quaternion for a heading about GTA +Z. */
function headingQuat(heading: number): [number, number, number, number] {
  return [0, 0, Math.sin(heading / 2), Math.cos(heading / 2)];
}

/** What a model's texture arrays cost the budget — the `.ostex` payloads, or the raw RGBA8 layers. */
function textureBytesOf(textures: EngineVehicleData['model']['textures']): number {
  return textures.reduce(
    (total, texture) => total + (texture.kind === 'ostex' ? texture.bytes.byteLength : texture.rgba.byteLength),
    0,
  );
}
