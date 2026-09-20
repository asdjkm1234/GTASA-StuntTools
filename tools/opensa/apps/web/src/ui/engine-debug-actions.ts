/**
 * The F2 debugger's actions on the own-engine host (plan 074/22 phase 2) — the `?engine=opensa` twin of
 * canvas-host's `debugActions`.
 *
 * Every graphics control is a plain mutation of the SHARED runtime `Config`: the environment driver re-reads
 * it each frame, so bucket-B rows work by construction (one source of truth, no per-host copy). The gameplay
 * rows (teleport, spawn, break, fly, time, weather) come in as thin host accessors — this module owns no
 * state of its own, exactly like `setupPerfRuns`.
 *
 * Bucket-C getters (SSAO, CSM, water sliders…) still read the config: their rows are HIDDEN by
 * `ENGINE_DEBUG_CAPABILITIES`, but `DebugOverlay` seeds all its state up front, so the getters must answer.
 * The matching setters are never reached — no dead buttons exist to reach them.
 */
import type { City, Config, ProcObjCategory, Vec3 } from '@opensa/game';
import type { PerfStats } from '@opensa/game/perf/perf-monitor';

import { atlasTierOf, opcodeDef } from '@opensa/cleo';
import { VEHICLE_PHYSICS_CONSTANTS } from '@opensa/game/physics/physics-world';
import { WEATHER_NAMES } from '@opensa/renderware';

import type { CleoReadout } from './debug/cleo-panel';
import type { DebugActions } from './debug/debug-overlay';
import type { PhysicsReadout } from './debug/physics-panel';
import type { CleoRunnerSystem } from './engine-cleo';

/** Selectable weathers for the Weather screen (same list prod shows). */
const WEATHERS: readonly { index: number; label: string }[] = WEATHER_NAMES.map((label, index) => ({
  index,
  label,
}));

/** Search radius (m) for "break nearest prop" — prod uses 8. */
const BREAK_RADIUS = 8;

export interface EngineDebugActionsDeps {
  /** Smash the loaded prop nearest the player; false when none is in range. */
  breakNearest: (position: Vec3, radius: number) => boolean;
  /** Live follow distance including wheel zoom (the Camera screen's "current" readout). */
  cameraDistance: () => number;
  /** The city the player is in (map.zon boxes, via the shared CityZoneSystem). */
  city: () => City;
  /** The CLEO runner system; null when the build carries no `cleo/*.cs` (plan 097/07). */
  cleo: () => CleoRunnerSystem | null;
  /** The host's live runtime config — mutated in place, re-read by the driver every frame. */
  config: Config;
  /** Flip the occupied car onto its wheels; no-op on foot. */
  flipVehicle: () => void;
  /** In-game hour (0–24 float) and its setter — the host's own clock. */
  getHour: () => number;
  /** Per-pass GPU timings of the last frame (label → ms). */
  gpuTimings: () => readonly (readonly [string, number])[];
  isFlying: () => boolean;
  /** Move the player (native Z-up); `moveBody` also teleports the physics capsule. */
  /** Whether the missing-texture highlight (magenta stand-ins, plan 085 row B) is on; default = dev build. */
  missingTextureHighlight: () => boolean;
  /** Whether the on-screen HUD is drawn (host state; defaults to the development build). */
  perfHud: () => boolean;
  /** Whether slow frames print their CPU breakdown (host state; defaults to the development build). */
  perfLogs: () => boolean;
  /** One frame's engine numbers for the Perf screen; null before the first frame. */
  perfSnapshot: () => EnginePerfSnapshot | null;
  /** Rolling frame stats; null until a frame was measured. */
  perfStats: () => null | PerfStats;
  /** The driven car's latest telemetry frame + its corner labels (plan 081/01); null on foot. */
  physicsReadout: () => null | PhysicsReadout;
  placePlayer: (position: Vec3, moveBody?: boolean) => void;
  playerCoords: () => Vec3;
  /** Re-scatter clutter after a procobj knob change (render + colliders share one scatter). */
  reloadClutter: () => void;
  /** Show FACES: the engine's scene-wide wireframe overlay pass (074/22). */
  /** Show NORMALS: the engine's debug VIEW lane (074/22), replacing three's scene-wide material override. */
  setDebugNormals: (enabled: boolean) => void;
  setFlyMode: (on: boolean) => void;
  setHour: (hour: number) => void;
  /** Repaint missing-texture stand-in layers: magenta on, packed material colour off. */
  setMissingTextureHighlight: (enabled: boolean) => void;
  setPerfHud: (enabled: boolean) => void;
  setPerfLogs: (enabled: boolean) => void;
  /** Start/stop the telemetry sampler — only the open Physics tab (or a capture) turns it on. */
  setPhysicsCapture: (enabled: boolean) => void;
  /** Start a weather transition (the shared WeatherTransition, 6 s blend). */
  setWeather: (index: number) => void;
  /** The player's start position — "To Ganton" on the original game. */
  spawn: Vec3;
  /** Spawn a car of this model in front of the player (awaits the worker model build). `plate` overrides
   *  the number the placement would resolve to on its own (plan 082/04). */
  spawnVehicle: (model: string, plate?: string) => Promise<void>;
  /** Lift the map-viewer camera straight above the player and aim it down — the inspector's "reset view". */
  topDownView: () => void;
  /** Spawnable model names from `vehicles.ide`. */
  vehicleModels: () => readonly string[];
  /** The weather id currently blending in. */
  weather: () => number;
}

/** Raw numbers behind the Perf screen's engine rows — one frame's worth, straight off the host loop. */
export interface EnginePerfSnapshot {
  avgMs: number;
  /** LOD ring radius (boot-time on this host: `?draw=N`). */
  drawDistance: number;
  draws: number;
  /** Live fog ramp `[start, cut]` in world units — authored by timecyc for the active weather/hour, capped
   *  at `drawDistance − FOG_RING_MARGIN`. The cut IS the visible world edge, so it belongs next to it. */
  fog: { cut: number; start: number };
  gpu: { pass: number; post: number; probe: number; submit: number };
  p95Ms: number;
  /** Residency breakdown by category, already summarised (`cellIndex 5 · texture 763 · …`). */
  residency: string;
  residencyMb: number;
  stream: { late: number; loaded: number; pending: number };
  /** The REGIONAL weather actually driving timecyc (`weatherForCity` remaps the type per city). */
  weather: { id: number; name: string };
}

/**
 * The F2 CLEO readout (plan 097/07 decision 3): the system's raw surface joined with the opcode DB
 * (labels) and the tier tables (how each gap degrades). Pure over the system, so it is unit tested.
 */
export function cleoReadout(cleo: CleoRunnerSystem): CleoReadout {
  return {
    coverage: cleo.coverage().map((hit) => ({
      count: hit.count,
      declared: hit.declared,
      label: `${hit.opcode.toString(16).toUpperCase().padStart(4, '0')} ${opcodeDef(hit.opcode)?.name ?? '???'}`,
      tier: hit.tier,
    })),
    enabled: cleo.enabled,
    faults: cleo.faults().map((fault) => `${fault.thread}: ${fault.message}`),
    instructionsLastTick: cleo.instructionsLastTick(),
    misses: cleo.atlasMisses().map((miss) => {
      const resolved = atlasTierOf(miss);

      return { declared: resolved.declared, label: `${miss.kind} ${miss.detail}`, tier: resolved.tier };
    }),
    objects: cleo.objectCount(),
    threads: cleo.threadRows(),
    tracing: cleo.tracing,
  };
}

export function createEngineDebugActions(deps: EngineDebugActionsDeps): DebugActions {
  const { config } = deps;
  const graphics = config.graphics;

  return {
    bloom: () => graphics.bloom,
    breakNearest: () => void deps.breakNearest(deps.playerCoords(), BREAK_RADIUS),
    camera: () => config.camera,
    cameraDistance: deps.cameraDistance,
    city: deps.city,
    cleoReadout: (): CleoReadout | null => {
      const cleo = deps.cleo();

      return cleo ? cleoReadout(cleo) : null;
    },
    cleoStep: (thread): void => deps.cleo()?.step(thread),
    cleoTraceLines: (thread): readonly string[] => deps.cleo()?.traceLines(thread) ?? [],
    clouds: () => graphics.clouds,
    effects: () => graphics.effects,
    engineStats: (): readonly (readonly [string, string])[] => {
      const snapshot = deps.perfSnapshot();

      return snapshot ? engineStatRows(snapshot) : [];
    },
    flipVehicle: deps.flipVehicle,
    fogDistance: () => config.fog.distance,
    gameTime: () => Math.floor((((deps.getHour() % 24) + 24) % 24) * 60),
    godrays: () => graphics.sun.godrays,
    godraysSize: () => graphics.sun.godraysSize,
    gpuTimings: deps.gpuTimings,
    graphicsPipeline: () => graphics.pipeline,
    headlights: () => graphics.headlights,
    isFlying: deps.isFlying,
    lights: () => graphics.lights,
    missingTextureHighlight: deps.missingTextureHighlight,
    moon: () => graphics.moon,
    night: () => graphics.night,
    perfHud: deps.perfHud,
    perfLogs: deps.perfLogs,
    perfStats: deps.perfStats,
    physicsConstants: () => VEHICLE_PHYSICS_CONSTANTS,
    physicsReadout: deps.physicsReadout,
    playerCoords: deps.playerCoords,
    procObj: () => graphics.procobj,
    respawnPlayer: (): void => {
      const [x, y, z] = deps.playerCoords();
      deps.placePlayer([x, y, z + 1], true); // re-drop slightly above the current spot to unstick
    },
    setBloom: (patch): void => void Object.assign(graphics.bloom, patch),
    setCamera: (patch): void => void Object.assign(config.camera, patch),
    setCleoEnabled: (enabled): void => deps.cleo()?.setEnabled(enabled),
    setCleoTracing: (enabled): void => deps.cleo()?.setTracing(enabled),
    setClouds: (patch): void => void Object.assign(graphics.clouds, patch),
    setEffects: (patch): void => void Object.assign(graphics.effects, patch),
    setFlyMode: deps.setFlyMode,
    setFogDistance: (distance): void => {
      config.fog.distance = distance;
    },
    setGameTime: (minutes): void => deps.setHour(minutes / 60),
    setGodrays: (enabled): void => {
      graphics.sun.godrays = enabled;
    },
    setGodraysSize: (size): void => {
      graphics.sun.godraysSize = size;
    },
    setGraphicsPipeline: (pipeline): void => {
      graphics.pipeline = pipeline;
    },
    setHeadlights: (patch): void => void Object.assign(graphics.headlights, patch),
    setLights: (patch): void => void Object.assign(graphics.lights, patch),
    setMissingTextureHighlight: deps.setMissingTextureHighlight,
    setMoon: (patch): void => void Object.assign(graphics.moon, patch),
    setNight: (patch): void => void Object.assign(graphics.night, patch),
    setPerfEnabled: (): void => undefined, // the engine samples every frame anyway — nothing to gate
    setPerfHud: deps.setPerfHud,
    setPerfLogs: deps.setPerfLogs,
    setPhysicsCapture: deps.setPhysicsCapture,
    setProcObj: (category: ProcObjCategory, patch): void => {
      Object.assign(graphics.procobj[category], patch);
      // `drawDistance` joined this list on 2026-08-10, when the range stopped being dead config: it is baked
      // into a per-draw uniform (and into the streaming ring) at apply time, so moving the slider has to
      // re-issue the cells. Density and enabled re-run the SCATTER, which render + colliders share.
      if (patch.density !== undefined || patch.drawDistance !== undefined || patch.enabled !== undefined) {
        deps.reloadClutter();
      }
    },
    setShadows: (patch): void => void Object.assign(graphics.shadows, patch),
    setShowNormals: (enabled): void => deps.setDebugNormals(enabled),
    setSky: (patch): void => void Object.assign(graphics.sky, patch),
    setSkyModel: (model): void => {
      graphics.sky.model = model;
    },
    setSsao: (patch): void => void Object.assign(graphics.ssao, patch),
    setStars: (patch): void => void Object.assign(graphics.stars, patch),
    setStreaming: (patch): void => void Object.assign(config.streaming, patch),
    setSunSize: (size): void => {
      graphics.sun.sunSize = size;
    },
    setToneMapping: (enabled): void => {
      graphics.toneMapping = enabled;
    },
    setToneMappingMode: (mode): void => {
      graphics.toneMappingMode = mode;
    },
    setVehicleReflection: (patch): void => void Object.assign(graphics.vehicleReflection, patch),
    setWater: (patch): void => void Object.assign(graphics.water, patch),
    setWeather: deps.setWeather,
    setWorldLight: (patch): void => void Object.assign(graphics.worldLight, patch),
    shadows: () => graphics.shadows,
    sky: () => graphics.sky,
    skyModel: () => graphics.sky.model,
    spawnVehicle: deps.spawnVehicle,
    ssao: () => graphics.ssao,
    stars: () => graphics.stars,
    streaming: () => config.streaming,
    sunSize: () => graphics.sun.sunSize,
    teleport: (coords): void => deps.placePlayer([coords[0], coords[1], coords[2]], true),
    teleportToGanton: (): void => deps.placePlayer([...deps.spawn], true),
    toneMapping: () => graphics.toneMapping,
    toneMappingMode: () => graphics.toneMappingMode,
    topDownView: deps.topDownView,
    vehicleModels: deps.vehicleModels,
    vehicleReflection: () => graphics.vehicleReflection,
    water: () => graphics.water,
    weather: deps.weather,
    weatherList: () => WEATHERS,
    worldLight: () => graphics.worldLight,
  };
}

/**
 * The Perf screen's rows for the own engine (plan 074/22 phase 3.3) — it shows the ENGINE ledger, not
 * three's `renderer.info` counters (there is no such thing here). Pure, so the formatting is unit tested.
 */
export function engineStatRows(snapshot: EnginePerfSnapshot): readonly (readonly [string, string])[] {
  const { gpu, stream } = snapshot;

  return [
    ['FPS', (1000 / Math.max(snapshot.avgMs, 0.001)).toFixed(0)],
    ['frame avg', `${snapshot.avgMs.toFixed(2)} ms`],
    ['frame p95', `${snapshot.p95Ms.toFixed(2)} ms`],
    ['draws', String(snapshot.draws)],
    ['gpu world', `${gpu.pass.toFixed(2)} ms`],
    ['gpu post', `${gpu.post.toFixed(2)} ms`],
    ['gpu probe', gpu.probe > 0 ? `${gpu.probe.toFixed(2)} ms` : 'off'],
    ['submit', `${gpu.submit.toFixed(2)} ms`],
    ['cells', `${stream.loaded} loaded, ${stream.pending} pending`],
    ['late creates', String(stream.late)],
    ['residency', `${snapshot.residencyMb.toFixed(0)} MB`],
    ['  by category', snapshot.residency],
    // The LOD ring is fixed at boot on this host; the debugger says so rather than offering a dead slider.
    ['draw distance', `${snapshot.drawDistance.toFixed(0)} m — boot-only, set with ?draw=N`],
    // What the frame ACTUALLY ends at: fog saturates at the cut, so geometry past it is invisible.
    ['fog start → cut', `${snapshot.fog.start.toFixed(0)} → ${snapshot.fog.cut.toFixed(0)} m (timecyc)`],
    ['weather', `${snapshot.weather.id} ${snapshot.weather.name}`],
  ];
}
