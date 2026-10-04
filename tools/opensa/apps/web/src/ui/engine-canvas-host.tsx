/**
 * Own-engine game host (plan 074/10 B3, `?engine=opensa`): the game world boots on `@opensa/engine`
 * instead of three-WebGL. REUSED from the game unchanged: the runtime Config (shared factory — behaviour
 * parity by construction), Rapier physics + the character controller system + collision streaming (all
 * pure), keyboard input. REPLACED: rendering (engine cells + streaming driver follow the PLAYER), the
 * camera (follow orbit producing a CameraState), the player body (the B1 ped probe driven by gameplay
 * state). Three and the own engine never share a canvas — this host IS the capability branch.
 */
import type { CellCoord, City } from '@opensa/game';
import type { LookDirectionSource } from '@opensa/game/character/character-controller.system';
import type { PerfStats } from '@opensa/game/perf/perf-monitor';
import type { TyreSmokeDials } from '@opensa/game/vehicle/vehicle-tyre-smoke.system';
import type { ModelSearchHit, ProcObjSlopeConfig } from '@opensa/renderware';
import type { ReactElement } from 'react';

import {
  type DebugLineSetId,
  Engine,
  formatFrameSpans,
  frameSpans,
  type FrameSpanTotals,
  type LocalPakSource,
  type PakSource,
  setupStreaming,
  type StreamStats,
} from '@opensa/engine';
import {
  createEngineEnvironmentDriver,
  DEFAULT_DRAW_DISTANCE,
  FOG_RING_MARGIN,
} from '@opensa/game/adapters/engine-environment-driver';
import { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import { CharacterControllerSystem } from '@opensa/game/character/character-controller.system';
import {
  LOCOMOTION_COLLAPSE,
  LOCOMOTION_GROUNDED,
  LOCOMOTION_HARD_LAND,
  LOCOMOTION_LAND,
} from '@opensa/game/character/locomotion';
import { Logger } from '@opensa/game/diagnostics/logger';
import { Locomotion, PlayerControlled, RigidBody, Transform, Velocity } from '@opensa/game/ecs/components';
import { createEcsWorld } from '@opensa/game/ecs/world';
import { EventBus } from '@opensa/game/events/event-bus';
import { type GameEvents } from '@opensa/game/events/events.global';
import { CombinedInput, Keyboard, KeyboardSource, TouchInputSource } from '@opensa/game/input';
import { PhysicsWorld } from '@opensa/game/physics/physics-world';
import { PhysicsSystem } from '@opensa/game/physics/physics.system';
import { initRapier } from '@opensa/game/physics/rapier';
import { CollisionStreamingSystem } from '@opensa/game/streaming/collision-streaming.system';
import { cellsWithin } from '@opensa/game/streaming/grid';
import { PathFollowSource, type VehiclePose } from '@opensa/game/vehicle/path-follow';
import { ScriptedDriveSource } from '@opensa/game/vehicle/scripted-drive';
import { type SteeringModel } from '@opensa/game/vehicle/steering';
import { wheelCornerLabels } from '@opensa/game/vehicle/vehicle-telemetry';
import { WeatherTransition } from '@opensa/game/weather/weather-transition';
import { weatherForCity } from '@opensa/game/weather/weather-zones';
import { cityAt, type CityBox, isDesertZone } from '@opensa/game/zones/city';
import { CityZoneSystem } from '@opensa/game/zones/city-zone.system';
import { type NamedZone, ZoneNameSystem } from '@opensa/game/zones/zone-name.system';
import { angleDelta, lerp } from '@opensa/math';
import {
  type AssetFileSystem,
  describeTimecycSource,
  flatWaterMesh,
  gxtKeyHash,
  parseTxd,
  resolveTimecycSource,
  WATER_VERTEX_FLOATS,
  WEATHER_NAMES,
} from '@opensa/renderware';
import { parseWater } from '@opensa/renderware/parsers/text/water.parser';
import { decodeDxt } from '@opensa/renderware/textures/dxt';
import { addComponent, addEntity } from 'bitecs';
import { useEffect, useRef, useState } from 'react';

import type { GameId } from '../game-config';
import type { PlayerPose } from './engine-video-runs';

import { IS_DEV } from '../dev-mode';
import { GAME_CONFIG } from '../game-config';
import { vehicleModelsFromIde } from '../vehicle-models';
import { aimAt, yawBehind } from './camera/auto-center';
import { type CameraProbe, type GroundProbe } from './camera/camera-collision';
import {
  type CameraRigState,
  type CameraSnapshot,
  createRigState,
  reseedDistance,
  setFlyEye,
  snapTopDown,
  steerYaw,
  stepCamera,
} from './camera/camera-director';
import { CAMERA_FOV_Y, createChordWatcher, cursorRay, forwardFrom, type VideoCamera } from './camera/engine-camera';
import { FLY_KEYS, lookAtStep } from './camera/fly-rig';
import { buildCollisionLines } from './collision-wireframe';
import { isTouchDevice } from './controls/is-touch-device';
import { foldTouchCamera } from './controls/touch-camera';
import { TouchControls } from './controls/touch-controls';
import { ENGINE_DEBUG_CAPABILITIES } from './debug/debug-capabilities';
import { type DebugActions, type DebugGame, DebugOverlay } from './debug/debug-overlay';
import { type MapGame } from './debug/map-inspector';
import { setupEngineAnimObjects } from './engine-anim-objects';
import { setupEngineBreakables } from './engine-breakables';
import { setupEngineCleo } from './engine-cleo-setup';
import { clutterRingRadius, setupEngineClutter } from './engine-clutter';
import { createEngineDebugActions, type EnginePerfSnapshot } from './engine-debug-actions';
import { type DynamicFxEmitter, loadCoronaSprites, loadSkidSprite, setupEngineParticles } from './engine-particles';
import { ledgerBreakdown, type LegSample, setupPerfRuns } from './engine-perf-runs';
import { setupPhysRuns } from './engine-phys-runs';
import { loadEnginePlayer } from './engine-player';
import { setupEngineProps } from './engine-props';
import { type EngineVehicles, setupEngineVehicles } from './engine-vehicles';
import { setupVideoRuns } from './engine-video-runs';
import { createGameRuntimeConfig, GAME_CELL_SIZE } from './game-runtime-config';
import { Hud, type HudGame } from './hud/hud';
import { loadFonts } from './hud/load-fonts';
import { setupOsmSpike } from './osm-spike';
import { loadCityBoxes, loadGxt, loadInfoZones } from './zone-data';

interface EngineCanvasHostProps {
  fs: AssetFileSystem;
  gameId: GameId;
  /** The photo (fly) camera opened or closed — the shell hides its own chrome for it. */
  onPhotoMode?: (enabled: boolean) => void;
  onWorldReady?: () => void;
  /** Folder mode: the picked install's world-pak source (opensa/ inside it). null/absent ⇒ HTTP mode, world
   *  from `?src=` or `public/pak-map`. The loading MODE selects the world — folder mode never reads public. */
  pakSource?: LocalPakSource | null;
  paused?: boolean;
}

/** `?spawncar` retry loop (097/05): spawn keeps failing until collision streams in — retry from the
 *  fixed loop, log the success coordinates and each DISTINCT failure once. */
function createSpawnCarRetry(
  spec: null | string,
  spawnParam: readonly number[],
  vehicles: EngineVehicles | null,
  reported: Set<string>,
): () => void {
  let pending = spec !== null && vehicles !== null;
  let busy = false;

  return (): void => {
    if (!pending || busy || !spec || !vehicles) {
      return;
    }
    const [carModel, sx, sy, sz, sHeading] = spec.split(',');
    const carAt: [number, number, number] =
      sx !== undefined && sy !== undefined
        ? [Number(sx), Number(sy), Number(sz ?? spawnParam[2] ?? 10)]
        : [spawnParam[0] ?? 0, (spawnParam[1] ?? 0) + 8, (spawnParam[2] ?? 10) + 1];
    busy = true;
    vehicles
      .spawn({ groundSnap: true, heading: Number(sHeading ?? 0), model: carModel, position: carAt })
      .then(() => {
        pending = false;
        // eslint-disable-next-line no-console -- field probes read this to know the car exists
        console.log(`[spawncar] ${carModel} spawned at ${carAt.join(',')}`);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!reported.has(`spawncar:${message}`)) {
          reported.add(`spawncar:${message}`);
          // eslint-disable-next-line no-console -- a silent retry loop costs a field round
          console.warn(`[spawncar] ${carModel}:`, message);
        }
      })
      .finally(() => {
        busy = false;
      });
  };
}

const FIXED_STEP = 1 / 60;
const MAX_CATCHUP_STEPS = 5;
const WORLD_READY_TIMEOUT_MS = 12000;
/** A frame slower than this gets its CPU breakdown logged (vsync is 8.3 ms at 120 Hz). */
const SLOW_FRAME_MS = 20;
/** [cam] jump watchdog thresholds (plan 080/09 §4.1): a look-target move (m) or an idle-mouse yaw move
 *  (rad, ~20°) in ONE frame that no legitimate discontinuity explains. Generous on purpose — the watchdog
 *  exists to catch the seen-once jump class, not to narrate ordinary motion. */
const CAM_JUMP_TARGET = 1.5;
const CAM_JUMP_YAW = 0.35;
/** Consecutive watched frames that must each report a jump before the run calls it a FALL rather than a
 *  discontinuity. A jump is a seen-once event by definition; a hundred in a row is the camera chasing a
 *  player nothing is holding up, and that reads as a wall of `[cam]` lines nobody counts by hand. */
const CAM_FALL_STREAK = 100;

/** The GTA heading the player spawns facing — the camera seeds behind it, the pose falls back to it. */
const SPAWN_FACING = Math.PI;
/** The rig's boot pitch (radians, positive = up): slightly down at the player. `?look` computes its own. */
const DEFAULT_CAMERA_PITCH = -0.25;
/** How long the camera keeps EASING its collision response after a scripted enter/exit ends (seconds). */
const EXIT_EASE_SECONDS = 0.8;
/** How close (world units) the player must stay to the car they left for the camera to keep ignoring it. */
const RIDDEN_IGNORE_RANGE = 6;
/** Player capsule (metres, GTA Z-up): the setup-character defaults for a human. */
const CAPSULE_RADIUS = 0.35;
const CAPSULE_HALF_HEIGHT = 0.55;
/** Fog distances the map viewer forces — past the camera far plane (10 000), so nothing is ever fogged. */
const NO_FOG_DISTANCE = 100000;

/** Shared mutable flags between React props and the boot closure. */
const hostState = { paused: false };
let booted: null | Promise<void> = null;
/** The HudGame the boot closure builds (module scope — survives StrictMode's dev double-mount). */
let hudGameRef: HudGame | null = null;
/** The F2 debugger's surfaces (074/22), built by the same boot closure. */
let debugRef: null | { actions: DebugActions; buildTime?: string; game: DebugGame; mapGame: MapGame } = null;
/** The on-screen controls the boot closure built (plan 055) — null on a device that has no touch. */
let touchRef: null | { canEnterExit: () => boolean; source: TouchInputSource } = null;

/** The [cam] jump watchdog's last frame (plan 080/09 §4.1) — null until the first watched frame. */
interface CamWatch {
  focus: [number, number, number] | null;
  /** Watched frames in a row that reported a jump — {@link CAM_FALL_STREAK} of them is a fall. */
  jumpStreak: number;
  mode: string;
  target: [number, number, number] | null;
  yaw: number;
}

/** One frame BODY's block timers plus the engine stats it produced — the snapshot the slow-frame line
 *  describes (see `past` in the loop: the interval `dt` measured ended before this frame's body ran). */
interface FrameBlocks {
  anim: number;
  camera: number;
  cars: number;
  collision: number;
  controller: number;
  fixed: number;
  paused: number;
  ped: number;
  physics: number;
  pose: number;
  props: number;
  render: number;
  stats: ReturnType<Engine['frame']>;
  steps: number;
  stream: number;
  vehicles: number;
  world: number;
}

export function EngineCanvasHost({
  fs,
  gameId,
  onPhotoMode,
  onWorldReady,
  pakSource = null,
  paused = false,
}: EngineCanvasHostProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hudGame, setHudGame] = useState<HudGame | null>(hudGameRef);
  const [debug, setDebug] = useState(debugRef);
  const [touch, setTouch] = useState(touchRef);
  const [locked, setLocked] = useState(false);
  /** The photo (fly) camera owns the screen: every piece of chrome hides for it and comes back on exit. */
  const [photoMode, setPhotoMode] = useState(false);
  hostState.paused = paused;

  // Mouse capture (pointer lock): the look uses movementX/Y while locked, so the player needs an
  // affordance telling them to click — prod's `sa-capture` button, ported verbatim (074/22 phase 6).
  useEffect(() => {
    const onChange = (): void => setLocked(document.pointerLockElement === canvasRef.current);
    document.addEventListener('pointerlockchange', onChange);

    return (): void => document.removeEventListener('pointerlockchange', onChange);
  }, []);

  // The photo camera announces itself on the game's event bus (the HUD already listens on the same one),
  // so the chrome follows it without the host loop knowing anything about React.
  useEffect(() => {
    if (!hudGame) {
      return;
    }
    const apply = (e: { enabled: boolean; photo?: boolean }): void => {
      // Leaving ALWAYS restores the chrome, whichever way it was left (K+M again, F2, or a pause).
      const hide = e.enabled && e.photo === true;
      // `apply` is an event handler; its ONE synchronous call is the mount-time read below.
      // eslint-disable-next-line @eslint-react/set-state-in-effect -- reads a state the host already holds
      setPhotoMode(hide);
      onPhotoMode?.(hide);
    };
    // Video mode hides the chrome while boot is still running — this effect exists only afterwards, so the
    // state is READ on mount and the subscription carries only what changes after it (096/08).
    apply(hudGame.getFlyCamera());

    return hudGame.events.on('fly-camera', apply);
  }, [hudGame, onPhotoMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    booted ??= boot(canvas, fs, gameId, pakSource, onWorldReady).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- boot failures must surface somewhere visible in dev
      console.error('[engine-host] boot failed', error);
    });
    void booted.then(() => {
      setHudGame(hudGameRef);
      setDebug(debugRef);
      setTouch(touchRef);
    });
  }, [fs, gameId, pakSource, onWorldReady]);

  function capture(): void {
    // Newer browsers return a Promise that can reject (denied / unsupported); swallow it either way.
    void Promise.resolve(canvasRef.current?.requestPointerLock()).catch(() => undefined);
  }

  // No wrapper: like CanvasHost, the canvas fills the shell's `.sa-game` container directly.
  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} />
      {hudGame && !locked && !paused && !photoMode && !touch ? (
        <button className="sa-capture" onClick={capture} type="button">
          Click to play
        </button>
      ) : null}
      {/* A touch device has no pointer to capture: the on-screen controls REPLACE the capture button (055). */}
      {touch && !paused && !photoMode ? (
        <TouchControls canEnterExit={touch.canEnterExit} source={touch.source} />
      ) : null}
      {hudGame ? <Hud game={hudGame} /> : null}
      {debug ? (
        <DebugOverlay
          actions={debug.actions}
          buildTime={debug.buildTime}
          capabilities={ENGINE_DEBUG_CAPABILITIES}
          game={debug.game}
          mapGame={debug.mapGame}
          suppressed={photoMode}
          teleports={GAME_CONFIG[gameId].teleports ?? []}
        />
      ) : null}
      <pre
        id="engine-hud"
        style={{
          background: 'rgba(10, 12, 18, 0.72)',
          color: '#9fe8a8',
          font: '12px/1.45 ui-monospace, monospace',
          left: 8,
          margin: 0,
          padding: '8px 10px',
          position: 'fixed',
          top: 8,
          whiteSpace: 'pre',
          zIndex: 10,
        }}
      />
    </>
  );
}

/** `?cleo=0|1` — session override over the ON-by-default runner (06 decision 6, closed 2026-08-06). */
function applyCleoOverride(config: ReturnType<typeof createGameRuntimeConfig>, params: URLSearchParams): void {
  if (params.has('cleo')) {
    config.cleo.enabled = params.get('cleo') !== '0';
  }
}

/**
 * The graphics A/B knobs, folded into the LIVE config so the debugger keeps telling the truth about what is
 * running: `?aces=0` and `?bloom=0|N` (the 074/09 post A/Bs), `?scale=0.75` (the 074/09 render-scale tier —
 * MSAA/bloomq were field-tested and dropped — WebGPU allows sampleCount 1|4 only, and bloom levels saved ~0.05 ms), and `?fx=N`, a multiplier over every fx system's shipped draw
 * distance (100/04). `?fx` doubles as the POSITIVE CONTROL a distance capture needs: a tiny value culls the
 * emitters, which is the only way a shot can prove the specks in it are particles at all.
 */
function applyGraphicsParams(config: ReturnType<typeof createGameRuntimeConfig>, params: URLSearchParams): void {
  if (params.get('aces') === '0') {
    config.graphics.toneMapping = false;
  }
  const bloomParam = Number(params.get('bloom') ?? Number.NaN);
  if (Number.isFinite(bloomParam)) {
    config.graphics.bloom.enabled = bloomParam > 0;
    if (bloomParam > 0) {
      config.graphics.bloom.intensity = bloomParam;
    }
  }
  const scaleParam = Number(params.get('scale') ?? Number.NaN);
  if (Number.isFinite(scaleParam)) {
    config.graphics.renderScale = scaleParam;
  }
  const fxParam = Number(params.get('fx') ?? Number.NaN);
  if (Number.isFinite(fxParam) && fxParam > 0) {
    config.graphics.effects.drawDistanceScale = fxParam;
  }
  // `?procobj=<multiplier>` scales the RUNTIME clutter scatter across every category, `?procobj=0` turns it
  // off. **It reaches only the rules the BUILD did not bake**, which since plan 014 is all 95 of them on
  // `opensa` — the bake moved into the `sa` branch, so this is a live lever again. (It was not before: a
  // baked `procobj.dat` carried 9 rules of 96, all `P_UNDERWATERBARREN`, and an A/B using this knob measured
  // zero on any dry scene.) **Its ceiling is `PROC_OBJ_MAX_DENSITY` (3), which is ours, not the data's**: the
  // lottery is uniform in `[0, 3)` and the renderer keeps `lottery < density`, so a multiplier of 3 or more
  // keeps every candidate and ×4/×8/×16 all draw the same world. Measured, and it is exactly linear below
  // that — clutter triangles run 1 : 2.08 : 3.13 for ×1/×2/×4, the whole layer being +10.1 % of
  // `country-dusk` at ×3 and below the noise on every cost column
  // (`benchmarks/opensa-engine/2026-08-10-headless-procobj-runtime-knob-ladder.json`).
  // Written so 0 reads as zero rather than as absent, like `?airCtl`.
  const procobjParam = Number(params.get('procobj') ?? Number.NaN);
  if (Number.isFinite(procobjParam) && procobjParam >= 0) {
    for (const setting of Object.values(config.graphics.procobj)) {
      setting.density *= procobjParam;
      setting.enabled = setting.enabled && procobjParam > 0;
    }
  }
  // `?procobjRange=<units>` OVERRIDES every category's draw distance with one number — the A/B knob for the
  // per-category ranges, and the only way to reproduce a uniform world: `150` is what the engine really drew
  // before the ranges were wired (the collision ring), `100` is SA's own flat `PLANTS_MAX_DISTANCE`. An
  // override rather than a multiplier precisely so those two are reachable exactly.
  const procobjRangeParam = Number(params.get('procobjRange') ?? Number.NaN);
  if (Number.isFinite(procobjRangeParam) && procobjRangeParam > 0) {
    for (const setting of Object.values(config.graphics.procobj)) {
      setting.drawDistance = procobjRangeParam;
    }
  }
}

/**
 * Sky A/B overrides (074/06 row 4 sky v2): `?sky=preetham` = the legacy dome vs the Hosek-Wilkie default;
 * `?clouds=N` = cloud-layer opacity (0 = the naked dome, kills cirrus+cumulus too).
 */
function applySkyOverrides(
  engine: Engine,
  config: ReturnType<typeof createGameRuntimeConfig>,
  params: URLSearchParams,
): void {
  if (params.get('sky') === 'preetham') {
    engine.environment.skyModel = 'preetham';
  }
  const cloudsParam = Number(params.get('clouds') ?? Number.NaN);
  if (Number.isFinite(cloudsParam)) {
    config.graphics.clouds.opacity = cloudsParam;
  }
}

async function boot(
  canvas: HTMLCanvasElement,
  fs: AssetFileSystem,
  gameId: GameId,
  pakSourceProp: LocalPakSource | null,
  onWorldReady?: () => void,
): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const hud = document.getElementById('engine-hud') as HTMLPreElement;
  const config = createGameRuntimeConfig();
  applyGraphicsParams(config, params);
  // `?probe=0` — the 074/16 env-probe A/B: keeps reflections on the analytic-sky fallback.
  const probeEnabled = params.get('probe') !== '0';
  // `?probeview=1` — replace the frame with the probe cube panorama (orientation/content debug).
  const probeViewEnabled = params.get('probeview') === '1';
  // Draw distance (074/21 P1): ONE knob → the LOD streaming ring, with the fog cut capped at
  // `drawDistance − FOG_RING_MARGIN` — the outer margin band is always loaded before it leaves the fog,
  // so streaming pops are impossible by construction. Per-game default from GAME_CONFIG (an island TC
  // needs a wider ring than SA's continuous city); `?draw=N` = live A/B (min 400 keeps rings sane).
  const drawParam = Number(params.get('draw') ?? Number.NaN);
  const drawDistance = Number.isFinite(drawParam)
    ? Math.max(400, drawParam)
    : (GAME_CONFIG[gameId].drawDistance ?? DEFAULT_DRAW_DISTANCE);
  // `?spawn=x,y,z` (GTA coords) overrides the config spawn — field checks at arbitrary spots
  // (e.g. Santa Maria Beach for the water: `?spawn=342,-1803,4.8`).
  const spawnParam = (params.get('spawn') ?? '').split(',').map(Number);
  const spawn: [number, number, number] =
    spawnParam.length === 3 && spawnParam.every(Number.isFinite)
      ? [spawnParam[0], spawnParam[1], spawnParam[2]]
      : [...GAME_CONFIG[gameId].playerSpawn];
  const aim = bootAim(params, spawn);
  hud.textContent = 'own engine: initializing…';

  const dpr = window.devicePixelRatio;
  const resize = (): void => {
    // The shell mounts the game hidden during warmup — guard against a 0-sized layout pass.
    canvas.width = Math.max(2, Math.floor(canvas.clientWidth * dpr));
    canvas.height = Math.max(2, Math.floor(canvas.clientHeight * dpr));
  };
  resize();
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(canvas);

  const engine = new Engine();
  applySkyOverrides(engine, config, params);
  // SA corona billboards (B6): coronastar for lamps/headlights, coronamoon for the moon. They must exist
  // BEFORE the first cell loads — the frame bind group is baked into every cell bundle.
  await engine.init(canvas, loadCoronaSprites(fs));
  // The loading MODE selects the world (pak-source fix): folder mode reads the pak from the picked install's
  // opensa-pack/ sibling (086 phase 7; legacy: the nested opensa/ folder); HTTP mode keeps the URL (?src= or
  // public/pak-map). A folder with no pak fails loudly in setupStreaming — it must NEVER fall back to public
  // (that silent fallback made every folder-based measurement read whatever sat in public/, regardless of the pick).
  const pakSource: PakSource = pakSourceProp ?? `/${params.get('src') ?? 'pak-map'}`;
  const setup = await setupStreaming(engine, pakSource, { lodRadius: drawDistance });
  // Environment drive (074/10 config-API parity): the SHARED config→Environment driver — real timecyc
  // colours, sun/moon arcs built dynamically from config night.litFade, prod graphics tunables (sky mood,
  // cloud opacity, moon brightness, godrays, fog timecycScale) live on.
  const weather = Number(params.get('weather') ?? 0) || 0;
  // Weather transitions (prod parity): the SAME WeatherTransition class prod's Game runs — one driver,
  // its blend getter eases from→to over config.weatherTransitionSeconds (smoothstep, like prod).
  const weatherTransition = new WeatherTransition(weather);
  // Timecyc comes from the LIVE game files, through the ONE candidate order every reader shares
  // (plan 104/01, `TIMECYC_SOURCES`). There is no pak-baked copy to fall back to any more: the manifest
  // rule (opensa-pack 003) forbids carrying data that already exists in the game dir, and that copy is
  // precisely what froze weather/fog at convert time and diverged from prod (2026-07-18 field finding).
  const liveTimecyc = resolveTimecycSource((path) => fs.getText(path));
  const timecycSource = liveTimecyc !== null ? { text: liveTimecyc.text } : undefined;
  // Boot report (104/02): which of the three names won is otherwise unobservable — a mod's table shadowed
  // by a higher-priority one fails NOTHING.
  // eslint-disable-next-line no-console -- boot report, one line
  console.log(`[timecyc] ${describeTimecycSource(liveTimecyc)}`);
  const environmentDriver = createEngineEnvironmentDriver(engine.environment, {
    config,
    fogCap: drawDistance - FOG_RING_MARGIN,
    ...(timecycSource ? { timecyc: timecycSource } : {}),
    weather,
    weatherBlend: () => weatherTransition.blend(),
  });
  // '[' / ']' cycle the weather LIVE (sky v2 field iteration — a URL change costs a whole VFS reboot).
  // The transition's `target` IS the live weather id — the bench, the debugger, the regional remap and
  // these keys all go through it, so nothing can drift out of sync with what timecyc actually samples.
  const liveWeather = (): number => weatherTransition.target;
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'BracketLeft' && event.code !== 'BracketRight') {
      return;
    }
    weatherTransition.begin(
      (liveWeather() + (event.code === 'BracketRight' ? 1 : 19)) % 20,
      config.weatherTransitionSeconds,
    );
    // eslint-disable-next-line no-console -- field-iteration feedback (which weather id is on screen)
    console.log(`[engine-host] weather ${liveWeather()}`);
  });
  void installWater(engine, fs, setup.water, pakSource);

  // Physics + collision streaming (REUSED, pure): the adapter prepares the map defs once, then streams
  // COL cells around the player on the game's own 256-unit grid (independent of the pak's render grid).
  hud.textContent = 'own engine: preparing collision…';
  const adapter = new GtaSaWorldAdapter({
    // Baked collision (200/3-01): present only when the pak was built with `--bake-collision`, and then the
    // browser never parses that cell's COL. The adapter refuses a source keyed on a grid other than the one
    // below — the mismatch is silent otherwise.
    ...(setup.collision ? { bakedCollision: setup.collision } : {}),
    cellSize: GAME_CELL_SIZE,
    // Procedural clutter (074/19 B7·d): the engine now RENDERS the clutter (instanced), so it collides it too —
    // driven by ONE budget with the render (a per-category density lottery capped at 150/cell, lowest lotteries
    // win). Without the cap the countryside handed Rapier 9 803 static bodies (17 ms/step, 12 fps standing
    // still); the cap keeps the body count in the hundreds. Render and collision share the adapter's memoized
    // scatter, so they can never diverge (that divergence is what cost the 17 ms).
    clutterColliders: true,
    extraIpl: ['truthsfarm'],
    fs,
    // Clutter follows the live per-category debug knobs (0 when disabled) — see the debugger's setProcObj.
    procObjDensityOf: (category): number => {
      const setting = config.graphics.procobj[category];

      return setting.enabled ? setting.density : 0;
    },
    // `?procobjLimit=<n>` sweeps the per-cell budget itself. **Measured 2026-08-10**: 300 → 3000 buys nothing
    // (flat to 0.015 %), because the candidate pool per face is `area / spacing²` and at cutoff 1 a cell does
    // not hold 300 placements — so no value above 300 can bind. 150 → 300 buys +0.41 % of `country-dusk`'s
    // triangles, which is **13 % of the clutter layer** — small in scene terms, real in layer terms, and a
    // look call rather than a perf one. Plan 013's "set this from a streaming measurement" has no measurement
    // to make: the layer never hitches at any reachable setting.
    procObjLimit: Number(params.get('procobjLimit')) || 150,
    // `?procobjFloor=<n>` (plan 012): while the cap binds, keep at least n of every species the cell is
    // eligible for, instead of letting the lowest-lottery cut zero one — measured on the SHIPPING rule set to
    // zero at least one model in 17.7 % of clutter cells, worst 16 of 23. **ON at 1 since 2026-08-11** (his
    // call): it costs 0.32 % of the drawn placements, no frame time (the budget is conserved — the floor swaps
    // a placement, never adds one), and it puts `opensa` where `sa` already is, since a baked static row
    // cannot be capped at all. `?procobjFloor=0` is the A/B and is honoured as zero.
    procObjSpeciesFloor: params.has('procobjFloor') ? Number(params.get('procobjFloor')) : 1,
    // `?procobjSlope=<steep>,<flat>` (plan 011): the ROCK categories' candidate multiplier on steep and on
    // flat faces — scree collects on slopes, not on the plain beside them. Slope is the ONE terrain signal
    // that is not already in the surface (measured: `p_mountain` is 48.8 % steep and carries all six rubble
    // species, every other surface is under 20 %). Absent = unchanged, which is the shipped default until the
    // look is judged. The scatter is re-rolled by it, so two settings compare statistically, never placement
    // by placement.
    ...procObjSlopeParam(params),
    // `?procobjSampler=corner` (plan 010 task 12): the ORIGINAL's in-triangle routine instead of our
    // area-uniform one — it pulls toward whichever vertex the COL lists first. Same placement COUNT either
    // way; what moves is the close tail (map-wide p05 3.5 → 3.2 m). Default stays `area`.
    ...(params.get('procobjSampler') === 'corner' ? { procObjSampler: 'corner' as const } : {}),
  });
  await adapter.prepare();
  const physics = new PhysicsWorld(await initRapier());
  // 081/09: the speed-grip dials belong to the field — `?gripVd=<m/s>&gripCap=<×>` tune them per session.
  physics.tuneSpeedGrip({
    cap: Number(params.get('gripCap')) || undefined,
    reference: Number(params.get('gripVd')) || undefined,
  });
  // 081/06 §1: how much of the original's in-air authority the driver gets — `?airCtl=0` turns it off, which
  // is the A/B for a jump. Written so `?airCtl=0` reads as zero rather than as "absent".
  physics.tuneAirControl(params.has('airCtl') ? Number(params.get('airCtl')) : undefined);
  // 081/10: what a wheel is standing on decides its grip. `?surfGrip=0` puts every surface back on tarmac —
  // the A/B the field judges the whole feature by.
  const tyreAdhesion = adapter.tyreAdhesion();
  if (tyreAdhesion) {
    physics.setTyreAdhesion(tyreAdhesion.perMaterial, tyreAdhesion.road);
  }
  physics.tuneSurfaceGrip(params.get('surfGrip') !== '0');
  const controller = physics.createCharacterController();
  const capsule = physics.createKinematicCapsule(spawn, CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT);

  // ECS player entity (mirrors setup-character minus the three mesh — the ped probe renders the body).
  const world = createEcsWorld();
  const playerEid = addEntity(world);
  addComponent(world, playerEid, Transform);
  addComponent(world, playerEid, PlayerControlled);
  addComponent(world, playerEid, RigidBody);
  addComponent(world, playerEid, Velocity);
  addComponent(world, playerEid, Locomotion);
  Transform.x[playerEid] = spawn[0];
  Transform.y[playerEid] = spawn[1];
  Transform.z[playerEid] = spawn[2];
  Transform.qx[playerEid] = 0;
  Transform.qy[playerEid] = 0;
  Transform.qz[playerEid] = 0;
  Transform.qw[playerEid] = 1;
  // bitECS stores are plain arrays — EVERY field must be written or the controller math reads undefined
  // and poisons the whole move chain with NaN (the setup-character parity this host mirrors).
  Velocity.x[playerEid] = 0;
  Velocity.y[playerEid] = 0;
  Velocity.z[playerEid] = 0;
  Velocity.grounded[playerEid] = 0;
  // Spawn facing, mirrors the pose fallback below — `?look` re-points it so the rig's auto-centre HOLDS the
  // aim instead of swinging back behind a ped still facing south.
  Locomotion.heading[playerEid] = aim.heading;
  Locomotion.state[playerEid] = 0; // LOCOMOTION_GROUNDED
  Locomotion.stateTime[playerEid] = 0;
  Locomotion.fallSpeed[playerEid] = 0;
  RigidBody.handle[playerEid] = capsule.body;
  RigidBody.collider[playerEid] = capsule.collider;
  const viewOf = (): [number, number, number] => [
    Transform.x[playerEid],
    Transform.y[playerEid],
    Transform.z[playerEid],
  ];

  // Input (REUSED): keyboard for movement; the camera look is host-owned (drag), like the game's pointer.
  const keyboard = new Keyboard();
  keyboard.start();
  // A scripted lap (081/01, `?phys=`) drives through the SAME InputState the player uses — a capture that
  // bypassed `drive()`'s ramps would measure a different car. Idle it contributes nothing to the sum.
  const scriptedDrive = new ScriptedDriveSource();
  // Video mode's autopilot (096/02) — a closed-loop sibling of the scripted timeline, installed for good and
  // silent until a scene hands it a route. It reads the car through the same live `vehicles` accessor the
  // runners use, so nothing here depends on the vehicle system existing yet.
  const pathFollow = new PathFollowSource({
    pose: (): null | VehiclePose => {
      const car = vehicles?.activeVehicle() ?? null;
      const motion = vehicles?.drivenMotion() ?? null;

      return car === null || motion === null
        ? null
        : {
            heading: motion.heading,
            position: [car.position[0], car.position[1], car.position[2]],
            speed: motion.speed,
          };
    },
    steering: (): null | SteeringModel => vehicles?.steering() ?? null,
  });
  const input = new CombinedInput([new KeyboardSource(keyboard, config.controls), scriptedDrive, pathFollow]);
  // The on-screen controls, on a touch device only (plan 055). `vehicles` is assigned later in this closure;
  // the Enter-button thunk is only ever called from a rendered frame.
  const touchInput = setupTouchControls(input, () => vehicles?.canEnterExit() ?? false);
  /** Pinch travel not yet worth a whole zoom notch — see {@link foldTouchCamera}. */
  let pinchResidual = 0;

  // Camera (plan 080/01): the rig state lives in the director, the host only reports input. Click = mouse
  // capture (prod behaviour — the look uses movementX/Y continuously while pointer-locked, Esc releases),
  // drag-orbit stays as the unlocked fallback; wheel = zoom. The controller sees its forward through a
  // camera shim (the only three-shaped seam in CharacterControllerSystem).
  // Seat the camera BEHIND the spawn facing (the ped spawns facing π; behind it is yawBehind(π) = 0). Seeding
  // it at π put the camera nose-to-nose with a stationary player until they first moved.
  const rig = createRigState(config.camera, yawBehind(aim.heading), aim.pitch);
  /** This frame's raw camera input, drained by the loop: pointer deltas in pixels, drag pan in NDC, wheel
   *  notches. Accumulating instead of mutating the rig is what lets ONE pure step own the smoothing. */
  const pendingInput = { look: { x: 0, y: 0 }, pan: null as null | { x: number; y: number }, zoom: 0 };
  /** The FOV the last frame was rendered with — cursor picking must unproject through the SAME value. */
  let cameraFovY = CAMERA_FOV_Y;
  /** The config distance this zoom last followed — a debugger change (074/22) re-seeds the live zoom. */
  let authoredDistance = config.camera.followDistance;
  let dragging = false;
  /** Map-viewer state (074/22): a click PICKS instead of grabbing the pointer, and the mapper is resident. */
  let mapViewer = false;
  /** The photo gesture (K+M) is on — the loop hides the perf readout with the rest of the chrome. */
  let photoCamera = false;
  /** The last `'fly-camera'` state emitted, READABLE through {@link HudGame} — the chrome mounts long after
   *  boot, so an event alone cannot reach it. Video mode hides the UI while boot is still running (096/08). */
  let flyCameraState: { enabled: boolean; photo: boolean } = { enabled: false, photo: false };
  /** The one place the chrome's hide/show is announced: record it, then emit. */
  const emitFlyCamera = (enabled: boolean, photo: boolean): void => {
    flyCameraState = { enabled, photo };
    events.emit('fly-camera', flyCameraState);
  };
  let selectedPlacement: null | number = null;
  let hiddenPlacements = 0;
  /**
   * Pick along a caller-supplied ray. Gameplay passes the camera forward — under pointer lock the crosshair
   * IS the aim. The map viewer has no lock, so it passes {@link cursorRay}: there the cursor is the aim, and
   * a forward-vector pick would select whatever happened to sit at screen centre.
   */
  const pickAlong = (direction: [number, number, number]): void => {
    const hit = engine.cells.pick(cameraEye, direction);
    selectedPlacement = hit?.id ?? null;
    events.emit(
      'select',
      hit
        ? {
            // Engine (x, y, z) back to GTA (x, −z, y): the panel reports the coordinates the map files use.
            modelName: hit.model,
            position: [hit.position[0], -hit.position[2], hit.position[1]],
            txdName: hit.txd,
          }
        : null,
    );
  };
  /** Cursor position in NDC (y up), from a pointer event over the canvas. */
  const ndcOf = (event: PointerEvent | WheelEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();

    return [
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      1 - ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2,
    ];
  };
  /**
   * Map-viewer mouse (the three OrbitControls mapping prod used: LEFT pans, RIGHT rotates).
   *
   * A left press is ambiguous until it ends — it is a PICK if the pointer barely moved, a pan otherwise —
   * so the pick fires on pointer UP under the travel threshold, never on down. Panning a district would
   * otherwise select whatever the drag started on.
   */
  let mapDrag: null | { button: number; moved: number; ndc: [number, number] } = null;
  const PICK_TRAVEL = 0.01;
  canvas.addEventListener('contextmenu', (event) => {
    if (mapViewer) {
      event.preventDefault(); // right-drag orbits; the menu would eat the gesture
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (mapViewer) {
      mapDrag = { button: event.button, moved: 0, ndc: ndcOf(event) };
      canvas.setPointerCapture(event.pointerId);

      return; // in the map viewer a click SELECTS or drags; it must not also grab the pointer
    }
    // The pointer is grabbed ONLY by the "Click to play" button (prod's rule — `canvas-host` has exactly one
    // `requestPointerLock`, in that handler). Locking on any canvas press made the FIRST click anywhere a
    // capture: the map viewer's click-to-select could never fire, because the click that would have selected
    // was spent taking the pointer. Drag-look below covers looking around while unlocked.
    dragging = true;
  });
  window.addEventListener('pointerup', (event) => {
    dragging = false;
    if (mapViewer && mapDrag) {
      if (mapDrag.button === 0 && mapDrag.moved < PICK_TRAVEL) {
        pickAlong(cursorRay(forwardOf(), ndcOf(event), canvas.width / Math.max(1, canvas.height), cameraFovY));
      }
      mapDrag = null;
    }
  });
  window.addEventListener('pointermove', (event) => {
    if (mapViewer) {
      if (!mapDrag) {
        return;
      }
      const ndc = ndcOf(event);
      const delta: [number, number] = [ndc[0] - mapDrag.ndc[0], ndc[1] - mapDrag.ndc[1]];
      mapDrag.moved += Math.hypot(delta[0], delta[1]);
      mapDrag.ndc = ndc;
      if (mapDrag.button === 2) {
        // The viewer looks with the same deltas gameplay does — the director clamps its pitch by MODE (the
        // viewer's resting view is straight down, which gameplay may not reach).
        pendingInput.look.x += event.movementX;
        pendingInput.look.y += event.movementY;
      } else if (mapDrag.button === 0) {
        pendingInput.pan = { x: (pendingInput.pan?.x ?? 0) + delta[0], y: (pendingInput.pan?.y ?? 0) + delta[1] };
      }

      return;
    }
    if (document.pointerLockElement === canvas || dragging) {
      pendingInput.look.x += event.movementX;
      pendingInput.look.y += event.movementY;
    }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    // One notch, signed as the wheel reports it: the director dollies a detached eye and zooms an attached
    // one (a wheel zoom on the follow rig is a config toggle — `followZoom`).
    pendingInput.zoom += event.deltaY > 0 ? 1 : -1;
  });
  /** Re-read the authored camera distance (the debugger mutates it live); the bounds clamp inside the rig. */
  const syncCameraConfig = (): void => {
    if (config.camera.followDistance !== authoredDistance) {
      authoredDistance = config.camera.followDistance;
      reseedDistance(rig, config.camera, authoredDistance);
    }
  };
  /**
   * Photo camera (074/22 phase 2.7 + 5): a detached free-fly EYE. The player entity is untouched — it keeps
   * standing (or walking under WASD) exactly as prod's fly mode does; only the camera leaves the rig.
   * ARROW keys move it (prod semantics), the mouse look is the shared yaw/pitch.
   */
  const flyKeys = new Set<string>();
  /** The look-behind key is held (plan 080/05 §6) — reported to the director, which gates it to driving. */
  let lookBehindHeld = false;
  /** Enter/leave the photo camera. Entering seeds the eye from the live camera (no jump); the player entity
   *  is untouched either way. The HUD hides itself on the shared `'fly-camera'` event, exactly as in prod. */
  const setFlyMode = (on: boolean, photo = false): void => {
    photoCamera = on && photo;
    setFlyEye(rig, on ? [cameraEye[0], cameraEye[1], cameraEye[2]] : null);
    flyKeys.clear();
    emitFlyCamera(on, photo);
  };
  /**
   * The map viewer renders WITHOUT fog (field check, 2026-07-20).
   *
   * The viewer sits hundreds of units above the district (`TOP_DOWN_HEIGHT`), and the authored fog cut is
   * often far less
   * than that — LA-clear is 800, FOGGY_SF 250. The ground was therefore past the cut and the whole district
   * dissolved into fog colour: at night that reads as an empty brown screen, which is what "the map viewer
   * does not work" looked like. The geometry was there the whole time (a whole-map pin loaded 840 cells and
   * drew 1297 batches into an invisible frame).
   *
   * Fog is a look, and the viewer is an inspection tool — so it is simply switched off here rather than
   * stretched. Re-applied every frame because `environmentDriver.apply` rewrites both distances from timecyc.
   */
  const clearMapViewerFog = (): void => {
    if (!mapViewer) {
      return;
    }
    engine.environment.fogCutDistance = NO_FOG_DISTANCE;
    engine.environment.fogStartDistance = NO_FOG_DISTANCE;
  };
  /**
   * Lift the detached eye straight over the player and aim it down — what ENTERING the map viewer does, not
   * only the "Top" button. `setFlyMode` alone detaches the eye where it already stands, looking where it
   * already looked, which is indistinguishable from the activation doing nothing at all (074/22 phase 9).
   */
  const viewFromAbove = (): void => snapTopDown(rig, toEngine(viewOf()));
  const photoChord = createChordWatcher('KeyK', 'KeyM');
  window.addEventListener('keydown', (event) => {
    if (photoChord.down(event.code)) {
      setFlyMode(rig.flyEye === null, true); // the photo gesture: the chrome steps out of the shot
    }
    if (event.key === 'F2' && rig.flyEye) {
      setFlyMode(false); // entering the debugger leaves the photo camera (prod behaviour)
    }
    if (rig.flyEye && FLY_KEYS.has(event.code)) {
      event.preventDefault();
      flyKeys.add(event.code);
    }
    if (event.code === config.controls.lookBehind) {
      lookBehindHeld = true; // hold-to-look-behind while driving (plan 080/05 §6); the director gates by mode
    }
  });
  window.addEventListener('keyup', (event) => {
    photoChord.up(event.code);
    flyKeys.delete(event.code);
    if (event.code === config.controls.lookBehind) {
      lookBehindHeld = false;
    }
  });
  const forwardOf = (): [number, number, number] => forwardFrom(rig.yaw, rig.pitch);
  // The controller only calls camera.getWorldDirection(v) — hand it the follow camera's forward.
  const cameraShim: LookDirectionSource = {
    getWorldDirection: (target) => {
      const [fx, fy, fz] = forwardOf();

      return target.set(fx, fy, fz);
    },
  };

  const controllerSystem = new CharacterControllerSystem(world, physics, input, config, controller, cameraShim);
  const physicsSystem = new PhysicsSystem(world, physics, config);
  // Driving is applied at the TOP of the physics step, not after it (plan 081/02 §4): the raycast
  // controllers consume engine/brake/steer inside `updateVehicle`, so controls written afterwards arrive
  // one step late — 16 ms between the player's press and the car's answer, on every input.
  physicsSystem.beforeVehicles = (): void => vehicles?.applyControls(FIXED_STEP);
  const collision = new CollisionStreamingSystem(adapter, physics, viewOf, config);

  const player = loadEnginePlayer(engine, fs, GAME_CONFIG[gameId].mainCharacter, config.movement);
  // 2dfx particles (B6): the pak carries the emitter anchors, this reads effects.fxp + effectsPC.txd and
  // bakes them. Absent-tolerant — a profile without the FX files simply renders no particles.
  const particles = setupEngineParticles(engine, fs, drawDistance, config.graphics.effects.drawDistanceScale);
  // Skid-mark decal lane (089/03): SA's particleskid sprite, installed once — absent-tolerant like the FX.
  const skidSprite = loadSkidSprite(fs);
  if (skidSprite) {
    engine.initSkidMarks(skidSprite);
  }
  // `?fxprobe=<system>` (089/01): park one dynamic one-shot emitter beside the player's first position —
  // the headless screenshot check for the lane (rate 1 = as authored). `undefined` = not created yet.
  const fxProbeName = params.get('fxprobe');
  let fxProbe: DynamicFxEmitter | null | undefined;
  // Smashable props (B7·a): the colliders are already tagged with their placement key by the shared adapter.
  // Uproot props (lampposts, meters) fall as real dynamic bodies; the rest shatter into analytic debris.
  const props = setupEngineProps(engine, fs, physics);
  // `?osmspike=<model>` (097/04 phase 0): one map-object `.osm` loaded by NAME and rendered beside the
  // player — the CLEO host's model path, proven before the chain is built. Temporary.
  const osmSpikeName = params.get('osmspike');
  const osmSpike = osmSpikeName ? setupOsmSpike(engine, fs, osmSpikeName) : null;
  // Animated map objects (B7·b): the converter left their MOVING frames out of the bundle; these are them.
  const animObjects = setupEngineAnimObjects(engine, fs, adapter);
  const breakables = setupEngineBreakables(engine, physics, collision, adapter, fs, props);
  // Procedural clutter (074/19 B7·d): grass/bushes/rocks scattered per cell, rendered instanced. Streamed on
  // the SAME cells + budget as the colliders (adapter memoizes the scatter), so render and collision agree.
  const engineClutter = setupEngineClutter(engine, fs, (category) => config.graphics.procobj[category].drawDistance);
  const clutterLoaded = new Set<string>();
  const updateClutter = (): void => {
    // The ring is the WIDEST per-category range, not `collisionDrawDistance` — a category cannot be visible
    // past the radius its cell is streamed at, so tying the two capped every category at the collision ring
    // (150) whatever its own number said. The per-instance cull in the clutter shader is what brings each
    // category back to its own distance inside this ring, so a wider ring costs scatter and upload, never
    // fill. Clutter COLLIDERS deliberately stay on the collision ring: a bush 300 units away is scenery, and
    // Rapier static bodies at that radius are the cost that once bought 17 ms/step.
    const cells = cellsWithin(viewOf(), clutterRingRadius(config.graphics.procobj), adapter.cellSize);
    const desired = new Set(cells.map(([cx, cy]) => `${cx},${cy}`));
    for (const key of clutterLoaded) {
      if (!desired.has(key)) {
        engineClutter.removeCell(key);
        clutterLoaded.delete(key);
      }
    }
    // Bound the per-frame scatter+upload spike — new cells fill in over a few frames (the ring has a margin).
    let budget = 2;
    for (const [cx, cy] of cells) {
      const key = `${cx},${cy}`;
      if (clutterLoaded.has(key)) {
        continue;
      }
      engineClutter.applyCell(key, adapter.cellClutter(cx, cy));
      clutterLoaded.add(key);
      budget -= 1;
      if (budget <= 0) {
        break;
      }
    }
  };
  /**
   * "Show collision" (074/22): the collider set around the CAMERA, drawn through the engine's line-list debug
   * pipeline. The three build used a scene-wide `LineSegments`; the engine's `createDebugLines` wants one flat
   * endpoint array, which is what `buildCollisionLines` produces.
   *
   * It follows the camera, not the player — in the map viewer you fly away from the player, and collision you
   * cannot see is not a debug overlay. Rebuilt only when the camera changes CELL, so this is not frame work.
   */
  let collisionLines: DebugLineSetId | null = null;
  let collisionSignature = '';
  let showCollision = false;
  const COLLISION_COLOUR: [number, number, number, number] = [0, 1, 0.4, 1];
  const refreshCollision = async (force = false): Promise<void> => {
    if (!showCollision) {
      return;
    }
    const [gx, gy] = [cameraEye[0], -cameraEye[2]];
    const cells = cellsWithin([gx, gy, 0], config.streaming.collisionDrawDistance, adapter.cellSize);
    const signature = cells.map(([cx, cy]) => `${cx},${cy}`).join(';');
    if (!force && signature === collisionSignature) {
      return;
    }
    collisionSignature = signature;
    const loaded = await Promise.all(cells.map(([cx, cy]) => adapter.loadCellColliders(cx, cy)));
    if (!showCollision) {
      return; // toggled off while awaiting
    }
    const positions = buildCollisionLines(loaded.flat());
    if (collisionLines === null) {
      collisionLines = engine.createDebugLines(positions, COLLISION_COLOUR);
    } else {
      // The buffer is sized at creation, so a bigger set needs a new one rather than a partial upload.
      engine.destroyDebugLines(collisionLines);
      collisionLines = engine.createDebugLines(positions, COLLISION_COLOUR);
    }
  };
  const setShowCollision = (enabled: boolean): void => {
    showCollision = enabled;
    if (!enabled) {
      if (collisionLines !== null) {
        engine.destroyDebugLines(collisionLines);
        collisionLines = null;
      }
      collisionSignature = '';

      return;
    }
    void refreshCollision(true);
  };
  let debugError: null | string = null;
  /** Fixed-step throws already reported, BY MESSAGE — see the catch in `runFixedSteps`. */
  const reportedFixedStepErrors = new Set<string>();
  /** Last frame's camera eye (engine space) — the lamp coronas need it, one frame stale is invisible. */
  const cameraEye: [number, number, number] = [0, 0, 0];
  const logger = new Logger({ emit: (): undefined => undefined }, { showLogs: false });

  // Vehicles (074/08 B5 step 4): the SAME gameplay systems the three host runs — they speak VehicleHandle
  // now, so the only host-specific piece is the wiring.
  // Render interpolation (the camera position weight, plan 080/03): physics steps at a fixed 1/60, but the
  // frame draws in the variable loop, so the raw physics pose is a stair-step. We keep the pose from BEFORE
  // and AFTER the last fixed step and draw `lerp(prev, cur, alpha)` where alpha is the fixed-step remainder —
  // the drawn ped is then continuous, and the smoothed camera has a smooth focus to follow instead of a saw.
  const prevPlayerGta: [number, number, number] = [spawn[0], spawn[1], spawn[2]];
  const curPlayerGta: [number, number, number] = [spawn[0], spawn[1], spawn[2]];
  /** Snap the interpolation to the live pose (teleport/respawn) so the lerp never sweeps across the jump. */
  const resetPlayerInterpolation = (): void => {
    prevPlayerGta[0] = curPlayerGta[0] = Transform.x[playerEid];
    prevPlayerGta[1] = curPlayerGta[1] = Transform.y[playerEid];
    prevPlayerGta[2] = curPlayerGta[2] = Transform.z[playerEid];
  };
  // The vehicle system calls this EVERY fixed step to seat the rider (and to slide him through the climb),
  // so it must NOT snap the interpolation — that would draw the rider on the raw stair-step while the car is
  // interpolated, juddering him against the seat. A genuine warp (debugger teleport) resets separately.
  const placePlayer = (position: [number, number, number], moveBody = true): void => {
    if (moveBody) {
      physics.teleport(RigidBody.handle[playerEid], position);
    }
    Transform.x[playerEid] = position[0];
    Transform.y[playerEid] = position[1];
    Transform.z[playerEid] = position[2];
  };
  /** A debugger warp: place AND snap the interpolation so the ped does not streak across the map for a frame. */
  const teleportPlayer = (position: [number, number, number], moveBody = true): void => {
    placePlayer(position, moveBody);
    resetPlayerInterpolation();
  };
  // Plates read the city at each car's OWN spawn point (plan 082/04). The boxes are built further down
  // (they need info.zon), so vehicles take a thunk rather than forcing a load-order change here.
  let cityBoxes: readonly CityBox[] = [];
  let vehicles: EngineVehicles | null = null;
  try {
    vehicles = setupEngineVehicles({
      adapter,
      // The camera SWINGS behind the car instead of snapping (plan 080/02's steered-yaw channel); any
      // mouse movement takes it straight back.
      aimCamera: (azimuth: number): void => steerYaw(rig, azimuth),
      animator: player,
      cityBoxes: (): readonly CityBox[] => cityBoxes,
      config,
      engine,
      // The camera in NATIVE (Z-up) space — the lamp coronas fade by how squarely each lamp faces it.
      eye: (): [number, number, number] => {
        const [ex, ey, ez] = cameraEye;

        return [ex, -ez, ey];
      },
      fs,
      input,
      isNight: (): boolean => engine.environment.dn > 0.35,
      logger,
      // `?parked=0` empties the streets of parked cars — the bisection knob for anything that only shows up
      // once they are streaming themselves in and out (see `EngineVehiclesDeps.parkedCars`).
      parkedCars: params.get('parked') !== '0',
      physics,
      placePlayer,
      playerCollider: capsule.collider,
      playerController: controllerSystem,
      playerPosition: viewOf,
      // Tyre smoke (089/02): session dials ride the URL, like the 081/09 grip dials.
      smokeDials: smokeDialOverrides(params),
      smokeEmitter: particles?.createEmitter('prt_collisionsmoke') ?? null,
      // Surface effects (089/05) create their per-class emitters lazily — a factory, not five deps.
      surfaceEmitter: (name: string): DynamicFxEmitter | null => particles?.createEmitter(name) ?? null,
      viewOf,
    });
  } catch (error) {
    // A car that fails to load must not take the whole world down — walking still works.
    debugError ??= error instanceof Error ? error.message : String(error);
  }

  // Spawn at NIGHT: the headlights, brake lights and lamp coronas (B5 step 5) are the whole point of the
  // vehicle work right now, and a noon spawn hides all three. `?hour=` still overrides — and it accepts 0:
  // the old `|| DEFAULT` fallback treated midnight as "unset" and silently bounced it back to daytime.
  const hourParam = Number(params.get('hour'));
  // Boot clock: `?hour=` wins, else the game's configured start time (GAME_CONFIG.loadGame.startMinutes —
  // the field the engine host ignored until 2026-07-23; original keeps its 22:00 night default there).
  let hour =
    Number.isFinite(hourParam) && params.get('hour') !== null
      ? hourParam
      : GAME_CONFIG[gameId].loadGame.startMinutes / 60;
  environmentDriver.apply(hour);

  // `?spawncar=model[,x,y,z[,heading]]` (097/05 field checks): one car spawned at the given GTA spot
  // (default: 8 m north of the player's spawn) — how a specific vehicle mod is put in front of the
  // camera without waiting for traffic to deal one. Retries until the ground has streamed in.
  const trySpawnCar = createSpawnCarRetry(params.get('spawncar'), spawnParam, vehicles, reportedFixedStepErrors);

  // `?autoseat=1` (097/05 field checks): seat the player into the nearest car once it exists —
  // headless probes cannot walk the door approach reliably.
  let autoSeatPending = params.get('autoseat') === '1';

  // CLEO scripts (plan 097/04): discovered from `cleo/*.cs` in the VFS, run on the fixed step below.
  // ON by default since 2026-08-06 (the A/B/A priced it); `?cleo=0` opts a session out, `?cleo=1`
  // still force-enables. Explicit wiring, not SystemRegistry (that registry is dead — recon fact).
  applyCleoOverride(config, params);
  const cleo = setupEngineCleo({
    adapter,
    cameraGta: (): [number, number, number] => [cameraEye[0], -cameraEye[2], cameraEye[1]],
    config,
    engine,
    fs,
    hour: (): number => Math.floor(hour) % 24,
    playerGta: (): [number, number, number] => [Transform.x[playerEid], Transform.y[playerEid], Transform.z[playerEid]],
    vehicles: (): EngineVehicles | null => vehicles,
  });

  // Prod HUD + district names (074/10 reuse-not-duplicate): the SAME DOM <Hud> component fed through the
  // narrow HudGame surface; the lookup is the game's own ZoneNameSystem over info.zon + american.gxt.
  await loadFonts(config.fonts);
  const events = new EventBus<GameEvents>();
  let zoneName = '';
  const gxt = loadGxt(fs, 'text/american.gxt');
  const infoZones = loadInfoZones(fs, 'data/info.zon');
  const namedZones: NamedZone[] = infoZones.map((zone) => ({ max: zone.max, min: zone.min, name: zone.label }));
  const zoneSystem = new ZoneNameSystem(namedZones, viewOf, (key) => {
    zoneName = (gxt?.get(gxtKeyHash(key)) ?? '').trim();
    events.emit('zone', { name: zoneName });
  });
  // City tracking (plan 035 parity): the SAME CityZoneSystem over map.zon boxes, desert counties first so
  // they win over the coarse Las Venturas box. Feeds the debugger's city label through the shared bus.
  const desertBoxes: CityBox[] = infoZones.flatMap((zone) =>
    isDesertZone(zone.label) ? [{ city: 'DESERT' as const, max: zone.max, min: zone.min }] : [],
  );
  let city: City = 'COUNTRYSIDE';
  cityBoxes = [...desertBoxes, ...loadCityBoxes(fs, 'data/map.zon')];
  // Map-baked car generators (the binary IPL CARS section, plan 059): the specific-model ones plus the random
  // (`id = -1`) ones resolved through the zone-type popcycle. Registered LAZILY — the LOD stream materialises
  // each only when the view nears it and its collision cell exists, so ~1043 placements cost nothing until
  // they are reached. This has to run after `cityBoxes` (the random resolution asks which city a spot is in),
  // which is why it is not inside `setupEngineVehicles`.
  //
  // It lived in the three.js host and went out with it in `a312f0d` (074/13); nothing failed, and the map
  // simply had no cars but `parked.json`'s 212 for six weeks. Restored 2026-08-02.
  await registerMapCarGenerators(
    vehicles,
    adapter,
    { cityAt: (x, y) => cityAt(x, y, cityBoxes), hour: Math.floor(hour) },
    params.get('cargen') !== '0',
  );
  const citySystem = new CityZoneSystem(cityBoxes, viewOf, (next) => {
    city = next;
    events.emit('city', { city: next });
    // SA authors every weather TYPE per region (CLOUDY_LA / CLOUDY_COUNTRYSIDE / …) and each column carries
    // its own fog mood — countryside CLOUDY reaches 1150 u where the LA column stops at 700. Prod adapts the
    // weather when the player CROSSES into another region (canvas-host, plan 035); without it the engine
    // rendered LA's fog mood in the countryside (the "engine draws closer than prod" report, 074/22).
    //
    // KNOWN CONSEQUENCE (2026-07-18): RAINY has no LA/VEGAS column, so LS rain falls back to
    // RAINY_COUNTRYSIDE, whose authored night fog cut is ~330 u (and 1 u at 20:00 in the 24 h table) —
    // bench `ls-rain-night` then renders almost black. That is the authored mood meeting our night fog
    // colour; prod only avoids it because its remap happens to never fire in that bench. Tracked as an
    // open issue rather than papered over here (see plan 21 ledger).
    weatherTransition.begin(
      weatherForCity(WEATHER_NAMES, weatherTransition.target, next),
      config.weatherTransitionSeconds,
    );
  });
  const minutesNow = (): number => Math.floor((((hour % 24) + 24) % 24) * 60);
  let lastMinutes = minutesNow();
  hudGameRef = {
    events,
    getConfig: (): typeof config => config,
    getFlyCamera: (): { enabled: boolean; photo: boolean } => flyCameraState,
    getTime: minutesNow,
    getZone: (): string => zoneName,
  };

  // F2 debugger (074/22 phase 2): the SAME overlay prod runs, over thin host accessors. Graphics rows need
  // no wiring at all — they mutate the shared config the environment driver re-reads every frame.
  const vehicleModels = vehicleModelsFromIde(fs);
  /** Cycle each car's own carcols combos on repeated spawns (prod parity — a re-spawn gives a new colour). */
  const colourCycle = new Map<string, number>();
  debugRef = {
    actions: createEngineDebugActions({
      breakNearest: (position, radius) => breakables.breakNearest(position, radius),
      cameraDistance: () => rig.distance,
      city: (): City => city,
      cleo: () => cleo,
      config,
      flipVehicle: () => flipActiveVehicle(physics, vehicles?.activeVehicle() ?? null),
      getHour: () => hour,
      gpuTimings: () =>
        lastStats
          ? [
              ['world', lastStats.gpuPassMs],
              ['post', lastStats.gpuPostMs],
              ['probe', lastStats.gpuProbeMs],
              ['submit', lastStats.submitMs],
            ]
          : [],
      isFlying: () => rig.flyEye !== null,
      missingTextureHighlight: () => missingTexHighlight,
      perfHud: () => perfHud,
      perfLogs: () => perfLogs,
      perfSnapshot: (): EnginePerfSnapshot | null => {
        const stats = lastStats;
        const measured = frameStats(frames, stats);

        return stats && measured
          ? {
              avgMs: measured.avgMs,
              drawDistance,
              draws: stats.drawsRecorded,
              fog: { cut: engine.environment.fogCutDistance, start: engine.environment.fogStartDistance },
              gpu: {
                pass: stats.gpuPassMs,
                post: stats.gpuPostMs,
                probe: stats.gpuProbeMs,
                submit: stats.submitMs,
              },
              p95Ms: measured.p95Ms,
              residency: ledgerBreakdown(engine),
              residencyMb: stats.residencyBytes / 1048576,
              stream: {
                late: lastStream?.lateCreates ?? 0,
                loaded: lastStream?.loadedCells ?? 0,
                pending: lastStream?.pendingCells ?? 0,
              },
              weather: { id: liveWeather(), name: WEATHER_NAMES[liveWeather()] ?? '?' },
            }
          : null;
      },
      perfStats: () => frameStats(frames, lastStats),
      physicsReadout: () => {
        const car = vehicles?.activeVehicle() ?? null;
        const frame = vehicles?.telemetry.latest() ?? null;

        return car && frame
          ? {
              corners: wheelCornerLabels(car.wheels),
              frame,
              // 081/10: name the ground under each wheel and the grip share it gives, so the field can tell
              // "the change does nothing" from "this ground is adhesion group ROAD, so ×1.00 is correct".
              surfaceOf: (id: number): null | { factor: number; name: string } => {
                const table = adapter.surfaces();
                const grip = adapter.tyreAdhesion();
                const surface = table?.[id];

                return surface
                  ? { factor: grip ? (grip.perMaterial[id] ?? grip.road) / grip.road : 1, name: surface.name }
                  : null;
              },
            }
          : null;
      },
      placePlayer: teleportPlayer,
      playerCoords: viewOf,
      reloadClutter: (): void => {
        adapter.invalidateColliderCache();
        collision.reload();
        for (const key of clutterLoaded) {
          engineClutter.removeCell(key);
        }
        clutterLoaded.clear();
      },
      setDebugNormals: (enabled): void => {
        engine.debugNormals = enabled;
      },
      setFlyMode,
      setHour: (value): void => {
        hour = value;
      },
      setMissingTextureHighlight: (enabled): void => {
        missingTexHighlight = enabled;
        engine.textures.setMissingHighlight(enabled);
      },
      setPerfHud: (enabled): void => {
        perfHud = enabled;
      },
      setPerfLogs: (enabled): void => {
        perfLogs = enabled;
      },
      setPhysicsCapture: (enabled): void => {
        if (!vehicles) {
          return;
        }
        // Reset on BOTH edges: a capture that starts must not open with frames from the last time the tab was
        // looked at, and a capture that stops has no reader left to hold history for.
        vehicles.telemetry.reset();
        vehicles.telemetry.enabled = enabled;
      },
      setWeather: (index): void => weatherTransition.begin(index, config.weatherTransitionSeconds),
      spawn,
      spawnVehicle: async (model, plate): Promise<void> => {
        const combos = await adapter.vehicleColourCombos(model);
        const index = colourCycle.get(model) ?? 0;
        colourCycle.set(model, index + 1);
        const [px, py, pz] = viewOf();
        // In FRONT of the camera, facing the same way. The camera's native forward is (sin yaw, −cos yaw);
        // a heading h points along (−sin h, cos h), so the matching heading is yaw + π.
        // The gap scales with the MODEL: clearance + half its length — a fixed 5 m put the CENTRE of a
        // 11 m coach ahead, which wrapped the body around the player.
        const half = (await vehicles?.modelHalfExtents(model)) ?? [1, 2.5, 1];
        const distance = 2.5 + half[1];
        const position: [number, number, number] = [
          px + Math.sin(rig.yaw) * distance,
          py - Math.cos(rig.yaw) * distance,
          pz + 1,
        ];
        await vehicles?.spawn({
          ...(combos.length > 0 ? { colour: combos[index % combos.length].join(',') } : {}),
          groundSnap: true,
          heading: rig.yaw + Math.PI,
          model,
          // Stored WITH the placement, so a LOD respawn re-applies the typed number (plan 082/04).
          ...(plate === undefined ? {} : { plate }),
          position,
        });
      },
      topDownView: viewFromAbove,
      vehicleModels: () => vehicleModels,
      weather: liveWeather,
    }),
    ...(setup.buildTime !== undefined ? { buildTime: setup.buildTime } : {}),
    game: { events },
    // The Map screen (074/22 phases 7-8). Picking rides the `.oscell` placement mapper (minor 6): a pak
    // converted before it simply yields no hits, which the inspector reports rather than pretending.
    mapGame: {
      cellSize: (): number => setup.cellSize,
      events,
      /**
       * Centre the detached eye on the next placement of `name` and answer its cell, which the inspector
       * pins (plan 094/05). The pose is kept — only the looked-at point moves, the same rule the standalone
       * viewer follows — except when the tilt is too shallow to aim at all, where the viewer's own top-down
       * framing takes over rather than sliding the eye kilometres away.
       */
      focusModel: (name): CellCoord | null => {
        const index = adapter.modelIndex();
        const [ex, , ez] = rig.flyEye ?? toEngine(viewOf());
        const position = index?.focusNext(name, [ex, -ez]) ?? null;
        if (!position) {
          return null;
        }
        const target = toEngine(position);
        const moved = rig.flyEye && lookAtStep(rig.flyEye, forwardOf(), target);
        if (moved) {
          rig.flyEye = moved;
        } else {
          snapTopDown(rig, target);
        }

        return [Math.floor(position[0] / setup.cellSize), Math.floor(position[1] / setup.cellSize)];
      },
      hideSelectedObject: (): number => {
        if (selectedPlacement !== null && engine.cells.hidePlacement(selectedPlacement) > 0) {
          hiddenPlacements += 1;
          selectedPlacement = null;
          events.emit('select', null); // the object is gone from view — clear the selection panel
        }

        return hiddenPlacements;
      },
      listCells: (): ReturnType<MapGame['listCells']> => setup.driver.listCells(),
      restoreHiddenObjects: (): number => {
        // Hiding degenerates indices in place and has no inverse; a cell RELOAD rebuilds its index buffer
        // straight from the pak, so dropping every loaded cell restores the lot. The pinned set re-streams
        // on the next update, which is the same path entering the viewer already takes.
        setup.driver.unloadAll();
        hiddenPlacements = 0;

        return 0;
      },
      searchModels: (query): ModelSearchHit[] => adapter.modelIndex()?.search(query) ?? [],
      setManualCells: (cells, lod): void => setup.driver.setManualCells(cells, lod),
      setMapViewer: (enabled): void => {
        // The viewer detaches the camera (the existing photo camera) and hands the cell set to the
        // inspector; leaving restores focus-driven streaming. The HUD hides itself on the same event.
        mapViewer = enabled;
        // The mapper + retained index bytes are tens of MB on a full map, so they are viewer-only. This
        // takes effect on the next LOAD — `unloadAll` below is what makes that immediate, in both directions.
        engine.cells.picking = enabled;
        setup.driver.unloadAll();
        setFlyMode(enabled);
        if (enabled) {
          viewFromAbove(); // the viewer opens LOOKING at the district, as the three camera controller did
        }
        if (!enabled) {
          setShowCollision(false); // the overlay belongs to the viewer; leaving must not strand it on screen
          // Same rule for the two SUBTRACTIVE toggles, and here it cuts twice: the checkboxes live in the
          // inspector, so leaving with the sea or the clutter switched off strands the world without them AND
          // with no control left to bring them back — and the inspector's own state re-mounts checked, which
          // would make the panel lie about a world it no longer matches.
          engine.clutterEnabled = true;
          engine.waterEnabled = true;
          setup.driver.setManualCells(null);
          selectedPlacement = null;
          hiddenPlacements = 0;
          events.emit('select', null);
        }
        events.emit('map-viewer', { enabled });
      },
      setShowClutter: (enabled): void => {
        engine.clutterEnabled = enabled;
      },
      setShowCollision,
      setShowWater: (enabled): void => {
        engine.waterEnabled = enabled;
      },
      viewCell: (): [number, number] | null => {
        const [gx, gy] = viewOf();

        return [Math.floor(gx / setup.cellSize), Math.floor(gy / setup.cellSize)];
      },
    },
  };

  let previous = performance.now();
  let accumulator = 0;
  let readySent = false;
  let groundDelta = 0;
  /** The DRAWN player (engine Y-up) as of the last posed frame. Video mode's walk scene (096/07) frames the
   *  ped exactly as it frames a car, and for the same reason it must be the drawn pose rather than the
   *  fixed-step one: composed from anything else, the shot carries a frame of the ped's travel (round 1). */
  const playerDrawn: [number, number, number] = [0, 0, 0];
  let renderAlpha = 1;
  let pedMs = 0;
  /** Per-frame block timers (B7·b field stall): a stall must have a NUMBER, not a theory. */
  let animMs = 0;
  let fixedMs = 0;
  let fixedSteps = 0;
  let controllerMs = 0;
  let physicsMs = 0;
  let collisionMs = 0;
  let vehiclesMs = 0;
  /** The VEHICLE slice of the fixed step (081/07 §3's ≤ 0.5 ms budget), summed over this frame's steps: the
   *  raycast controllers inside the physics step plus the vehicle system's own fixed update. Separate from
   *  `physicsMs` (which is the solver too) and from `vehiclesMs` (which is the per-FRAME visual tick). */
  let vehicleFixedMs = 0;
  /**
   * The three blocks the stall log could not see (2026-07-27 field report: 20-250 ms frames whose named
   * parts summed to 5). `stream` is the driver pump (cell loads, model builds, collider creation), `camera`
   * is the rig step with its casts, `render` is the whole `engine.frame` call — `submit` is inside it. What
   * is left after all of them is printed as `other`, and that residual is the honest name for GC, the
   * browser's own work, and anything still untimed.
   */
  let streamMs = 0;
  let cameraMs = 0;
  let renderMs = 0;
  /**
   * The four blocks the loop still ran untimed (plan 091 phase 1) — `props` (felled props following their
   * bodies), `world` (weather/environment/zones/city/the time emit), `pose` (the view + the render-pose lerp)
   * and `paused` (the pause housekeeping). Expected to be small; they exist so `other` can mean exactly ONE
   * thing — the time between frames — instead of "either that, or something in here nobody timed".
   */
  let propsMs = 0;
  let worldMs = 0;
  let poseMs = 0;
  let pausedMs = 0;
  // In-game bench state (074/10 B3 tail): the loop consumes these; the runner below owns them.
  let benchCamera: null | { eye: [number, number, number]; target: [number, number, number] } = null;
  let benchSamples: LegSample[] | null = null;
  /**
   * Video mode's frame (096/03) and its cut flag. The flag is what keeps the `[cam] jump` watchdog honest: a
   * DECLARED cut is whitelisted for exactly one frame, and a jump the director did not declare still prints.
   *
   * The director steps through {@link videoStep}, IN this loop, between the car's render pose and the camera
   * snapshot — never from its own rAF pass. A camera mounted on the car must be composed from the same frame
   * the car is drawn in: posed a frame earlier, the pairing carries the car's whole travel for that frame
   * (`speed × dt`), and frame-clock jitter turns that into 0.3° of shiver whatever the director does
   * (096 field round 1 — the mount fix alone did not touch it).
   */
  let videoCamera: null | VideoCamera = null;
  let videoCut = false;
  /** The director's per-frame step while a fragment plays; null between scenes. */
  let videoStep: ((dt: number) => void) | null = null;
  let lastStream: null | StreamStats = null;
  /** Last frame's engine stats — the debugger's Perf screen and the HUD read them. */
  let lastStats: null | ReturnType<Engine['frame']> = null;
  /** The locomotion state the previous frame drew, so a landing is read as an EDGE (plan 080/06). */
  let lastLocomotion = LOCOMOTION_GROUNDED;
  /**
   * Seconds of eased-collision left after a scripted enter/exit ENDS.
   *
   * Climbing out hands the camera a new focus (the ped, standing beside the car) while the eye is still
   * behind the car — so the very next cast finds the car between them and the normal INSTANT pull-in yanks
   * the camera onto the ped's back, then releases. The field report was exactly that: "it jumps in close,
   * then pulls away". Holding the eased response a moment longer turns that into the camera settling into
   * its new framing.
   */
  let settleEase = 0;
  /** The car the player last rode — the camera ignores it for a few metres after they step out. */
  let lastRidden: null | ReturnType<NonNullable<typeof vehicles>['activeVehicle']> = null;
  /** The just-left car's body while the player is still beside it, else undefined. */
  const riddenNearby = (at: readonly number[], seated: unknown): number | undefined => {
    const car = seated === null ? lastRidden : null;

    return car !== null && planarDistance(at, car.position) < RIDDEN_IGNORE_RANGE ? car.body : undefined;
  };
  /** Refresh the eased-collision window: full while a sequence plays, then counting down. */
  const easeWindow = (left: number, dt: number): number =>
    vehicles?.isSettling() === true ? EXIT_EASE_SECONDS : Math.max(0, left - dt);
  /**
   * The vertical impact speed of a landing that STARTED this frame, else 0.
   *
   * 088 gave the controller real landing states and `fallSpeed`; the camera reads the transition INTO one
   * rather than re-deriving the touchdown from a velocity sign, which is what plan 06 assumed it would have
   * to do. Reading the edge (not the state) is what keeps the dip a one-shot: the state lasts a while.
   */
  const motionSignals = (
    seated: null | ReturnType<NonNullable<typeof vehicles>['activeVehicle']>,
  ): { airborne: boolean; impact: number; landing: number } => ({
    airborne: seated === null && Velocity.grounded[playerEid] !== 1,
    impact: vehicles?.impactForce() ?? 0,
    landing: landingEdge(),
  });
  const landingEdge = (): number => {
    const state = Locomotion.state[playerEid] ?? LOCOMOTION_GROUNDED;
    const landed = state === LOCOMOTION_LAND || state === LOCOMOTION_HARD_LAND || state === LOCOMOTION_COLLAPSE;
    const started = landed && state !== lastLocomotion;
    lastLocomotion = state;

    return started ? Math.abs(Locomotion.fallSpeed[playerEid] ?? 0) : 0;
  };
  // Developer readouts (074/22 phase 3.3): ON while developing, OFF in a production build; both are
  // toggled live from the debugger's Perf screen.
  let perfHud = IS_DEV;
  let perfLogs = IS_DEV;
  // The [cam] jump watchdog's last frame (plan 080/09 §4.1) — see `watchCameraJump`.
  const camWatch: CamWatch = { focus: null, jumpStreak: 0, mode: '', target: null, yaw: 0 };
  // Missing-texture highlight (plan 085 row B): magenta stand-ins ON while developing, the quiet material
  // colour in a production build; toggled live from the debugger's Map screen. Applying the flag here is
  // early enough — arrays stream in later and paint on load.
  let missingTexHighlight = IS_DEV;
  engine.textures.setMissingHighlight(missingTexHighlight);
  // Soak-mode HUD line (074/10 ③) — progress while running, the verdict when done (the Safari
  // read-off). Carries its own leading newline so the HUD appends it unconditionally.
  let soakStatus = '';
  const runFixedSteps = (pending: number): number => {
    let steps = 0;
    fixedSteps = 0;
    controllerMs = 0;
    physicsMs = 0;
    vehicleFixedMs = 0;
    while (pending >= FIXED_STEP && steps < MAX_CATCHUP_STEPS) {
      try {
        // Snapshot the pose from BEFORE this step so the interpolation has both ends of the last interval
        // (the ped body is kinematic — the controller writes Transform inside fixedUpdate).
        prevPlayerGta[0] = curPlayerGta[0];
        prevPlayerGta[1] = curPlayerGta[1];
        prevPlayerGta[2] = curPlayerGta[2];
        // The scripted lap's clock runs on the FIXED step, before anything reads its input — a timeline that
        // advanced with the render rate would replay differently on a different machine.
        scriptedDrive.advance(FIXED_STEP);
        // …and the autopilot computes ITS command here too, one call before `applyControls` reads the input
        // (`physicsSystem.beforeVehicles`). It sees the pose the last step ended on — 0.2 m at a cruise, and
        // the same staleness the player's own eyes have.
        pathFollow.advance(FIXED_STEP);
        const controllerStarted = performance.now();
        controllerSystem.fixedUpdate(FIXED_STEP);
        const physicsStarted = performance.now();
        controllerMs += physicsStarted - controllerStarted;
        physicsSystem.fixedUpdate(FIXED_STEP);
        physicsMs += performance.now() - physicsStarted;
        // Enter/exit places the rider and DRIVES here — after the physics step, exactly where prod's Game
        // runs it. Without this the climb-in freezes mid-phase (the whole sequence lives in fixedUpdate).
        const vehicleFixedStarted = performance.now();
        vehicles?.fixedUpdate(FIXED_STEP);
        vehicleFixedMs += performance.now() - vehicleFixedStarted + physics.takeVehicleStepMs();
        // CLEO runs AFTER the vehicle step (plan 097/04 decision 7): scripts read seated-vehicle
        // state the same step they animate. Gated inside on `cleo.enabled` + play state.
        cleo?.fixedUpdate(FIXED_STEP);
        trySpawnCar();
        if (autoSeatPending && vehicles?.seatInstantly()) {
          autoSeatPending = false;
        }
        // Snapshot AFTER: the cars sampled their bodies in fixedUpdate, and the ped Transform is now current.
        [curPlayerGta[0], curPlayerGta[1], curPlayerGta[2]] = viewOf();
        // Contact-force impacts are produced BY the physics step, so drain them here — one step late and a
        // hard hit's forces are already gone.
        breakables.update();
        // The fx probe ages on the FIXED step, like every future gameplay emitter (tyre smoke reads the
        // per-wheel telemetry, which is a fixed-step product). prt_* systems are code-triggered (no
        // authored rate), so the probe bursts one particle per step — 60/s, a steady visible plume.
        if (fxProbeName) {
          fxProbe ??= particles?.createEmitter(fxProbeName) ?? null;
          if (fxProbe) {
            // Half-opacity: a 60/s probe column at full authored alpha stacks into solid white (089/02).
            fxProbe.alphaScale = 0.5;
            // Beside the player, refreshed every step — a MOVING spawn point is the lane's whole point,
            // and parking once would freeze the pre-ground-snap boot position.
            const [ex, ey, ez] = toEngine(curPlayerGta);
            fxProbe.position[0] = ex + 2;
            fxProbe.position[1] = ey;
            fxProbe.position[2] = ez;
            fxProbe.burst(1);
            fxProbe.update(FIXED_STEP);
          }
        }
      } catch (error) {
        // The HUD line alone is not enough to diagnose this one: a throw out of the physics step can leave
        // Rapier's body set BORROWED (wasm never unwinds, so the guard is never dropped), and the next read
        // of it — `drivenMotion` in the render half, outside this try — dies with "recursive use of an
        // object". That second error is the one that reaches the console, and the frame carrying the FIRST
        // one never renders, so `debugError` is never displayed. Say it out loud.
        //
        // Once per DISTINCT message, not once per session: reporting only the first hid a second, different
        // throw behind the first for a whole debugging round — the world kept being poisoned with nothing in
        // the log to say by what. A repeating message still logs once; a NEW one always gets through.
        const message = error instanceof Error ? error.message : String(error);
        if (!reportedFixedStepErrors.has(message)) {
          reportedFixedStepErrors.add(message);
          // eslint-disable-next-line no-console -- an unreported fixed-step throw is a blind debugging round
          console.error(
            `[fixed-step] threw (physics phase: ${physics.stepPhase()}) — anything after this frame may be reading a poisoned world`,
            error,
          );
        }
        debugError ??= message;
      }
      pending -= FIXED_STEP;
      steps += 1;
      fixedSteps = steps;
    }

    return pending;
  };
  /**
   * Pose the ped for this frame. On foot: data-driven feet placement (a ground ray from the body CENTRE, own
   * capsule excluded — starting under the capsule slips through thin road shells into basements) plus the
   * controller-owned rate-limited heading (plan 088/01, `Locomotion.heading`). RIDING: both rules must be
   * switched OFF. Enter/exit teleports the rider onto the seat every fixed step, so the ground snap would
   * lift the seated pose to `ground − minZ` (about a metre — the driver ends up sitting on the ROOF), and a
   * walk-derived heading leaves him facing his old direction while the car turns under him. The seat IS the
   * pose: no lift, the car's own heading (written BACK into Locomotion so dismounting turns from the car's
   * yaw, not a stale walk yaw), and zero speed so the scripted CAR_sit clip is not dragged into locomotion.
   */
  const posePlayer = (
    gta: [number, number, number],
    playerEngine: [number, number, number],
    ridingCar: null | { heading: number },
    dt: number,
  ): void => {
    const vx = Velocity.x[playerEid];
    const vy = Velocity.y[playerEid];
    const speed = Math.hypot(vx, vy);
    if (ridingCar) {
      groundDelta = 0;
      heading = ridingCar.heading;
      Locomotion.heading[playerEid] = heading;
    } else {
      if (Velocity.grounded[playerEid] === 1) {
        const ground = physics.groundBelow([gta[0], gta[1], gta[2]], 4, RigidBody.handle[playerEid]);
        if (ground !== null) {
          groundDelta = ground - player.minZ - gta[2];
        }
      }
      heading = Locomotion.heading[playerEid] ?? heading;
    }
    const render: [number, number, number] = [playerEngine[0], playerEngine[1] + groundDelta, playerEngine[2]];
    [playerDrawn[0], playerDrawn[1], playerDrawn[2]] = render;
    // Riding forces the grounded state (0) — the seat pose must never pick a jump/fall clip.
    player.update(
      render,
      heading,
      ridingCar ? 0 : speed,
      dt,
      ridingCar ? 0 : (Locomotion.state[playerEid] ?? 0),
      ridingCar ? 0 : (Locomotion.stateTime[playerEid] ?? 0),
    );
  };

  /** A car system throwing must not kill the frame loop — surface it in the HUD and keep walking. */
  const tickVehicles = (delta: number, alpha: number): void => {
    try {
      vehicles?.update(delta, alpha);
    } catch (error) {
      debugError ??= error instanceof Error ? error.message : String(error);
    }
  };
  /**
   * Video mode's director, stepped from the loop between the car's render pose and the camera snapshot, so a
   * car-mounted shot is composed from the frame the car is drawn in. A pause holds the last pose rather than
   * integrating time nobody is watching.
   */
  const stepVideo = (delta: number): void => {
    if (!hostState.paused) {
      videoStep?.(delta);
    }
  };
  /** Pausing frees the cursor for the pause menu and drops the photo camera (as F2 and the debugger do). */
  const onPaused = (): void => {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    if (rig.flyEye) {
      setFlyMode(false);
    }
  };
  const bootStarted = performance.now();
  let heading = Math.PI;
  const frames: number[] = [];

  const loop = (): void => {
    const now = performance.now();
    /** The interval that actually elapsed, before the simulation clamp — what the breakdown must add up to:
     *  a 400 ms hitch reported as 250 would hide 150 ms of it in a residual that looks merely large. */
    const elapsedMs = now - previous;
    const dt = Math.min(0.25, elapsedMs / 1000);
    previous = now;
    frames.push(dt * 1000);
    if (frames.length > 120) {
      frames.shift();
    }
    // Everything that ran BETWEEN the last frame and this one and timed itself (plan 091 phase 2): a resolved
    // vehicle spawn, a cell's colliders. Drained here because `dt` measures rAF-start to rAF-start, so this
    // frame is the one that PAID for it — no in-loop timer can span that gap.
    const spans = frameSpans.drain();
    /**
     * The interval `dt` measures ENDED at this frame's start, so it is the PREVIOUS frame's body plus the gap
     * after it — and the block timers still hold that body's numbers here, before this frame overwrites them.
     * The slow-frame breakdown below is built from this snapshot, from the spans drained above (that gap's own
     * work) and from this frame's blob time (the worker handler ran in that same gap).
     *
     * Charging `dt` for THIS frame's body instead is what once printed a 25.1 ms stream block inside a 21.6 ms
     * frame — and a negative residual with it (plan 091 phase 1).
     */
    const past = {
      anim: animMs,
      camera: cameraMs,
      cars: vehicleFixedMs,
      collision: collisionMs,
      controller: controllerMs,
      fixed: fixedMs,
      paused: pausedMs,
      ped: pedMs,
      physics: physicsMs,
      pose: poseMs,
      props: propsMs,
      render: renderMs,
      stats: lastStats,
      steps: fixedSteps,
      stream: streamMs,
      vehicles: vehiclesMs,
      world: worldMs,
    };

    if (!hostState.paused) {
      const fixedStarted = performance.now();
      accumulator = runFixedSteps(accumulator + dt);
      // The fraction into the NEXT fixed step: the drawn pose interpolates the last physics interval by it.
      renderAlpha = accumulator / FIXED_STEP;
      fixedMs = performance.now() - fixedStarted;
      const collisionStarted = performance.now();
      collision.update();
      updateClutter();
      collisionMs = performance.now() - collisionStarted;
      // Felled props follow their physics bodies (B7·a) — after the step, like every other body-driven visual.
      const propsStarted = performance.now();
      props.update();
      propsMs = performance.now() - propsStarted;
      const animStarted = performance.now();
      animObjects.update(animStarted / 1000, [Transform.x[playerEid], Transform.y[playerEid], Transform.z[playerEid]]);
      animMs = performance.now() - animStarted;
      osmSpike?.update([Transform.x[playerEid], Transform.y[playerEid], Transform.z[playerEid]]);
      const vehiclesStarted = performance.now();
      tickVehicles(dt, renderAlpha);
      vehiclesMs = performance.now() - vehiclesStarted;
      const worldStarted = performance.now();
      const previousHour = hour;
      hour = (hour + dt / (config.time.secondsPerGameMinute * 60)) % 24;
      if (hour < previousHour) {
        // A day passed: the moon walks its ~29.5-day cycle, so a week of play changes its face.
        engine.environment.moonPhase = (engine.environment.moonPhase + 1 / 29.5) % 1;
      }
      weatherTransition.tick(dt);
      environmentDriver.apply(hour);
      clearMapViewerFog();
      zoneSystem.update();
      citySystem.update();
      if (minutesNow() !== lastMinutes) {
        lastMinutes = minutesNow();
        events.emit('time', { minutes: lastMinutes });
      }
      worldMs = performance.now() - worldStarted;
    } else {
      const pausedStarted = performance.now();
      onPaused();
      pausedMs = performance.now() - pausedStarted;
    }

    const poseStarted = performance.now();
    const gta = viewOf();
    const seatedCar = vehicles?.activeVehicle() ?? null;
    // Pose follows the RIDING car (climb-in included); the camera follows only the SEATED one.
    const ridingCar = vehicles?.ridingVehicle() ?? null;
    // The DRAWN ped rides the interpolated pose (smooth at any refresh); gameplay (ground ray, heading,
    // streaming) still uses the live `gta`. While riding, the rider is teleported onto the seat every fixed
    // step, so the SAME snapshot interpolates the seat pose — the ped stays welded to the interpolated car.
    const renderGta: [number, number, number] = [
      lerp(prevPlayerGta[0], curPlayerGta[0], renderAlpha),
      lerp(prevPlayerGta[1], curPlayerGta[1], renderAlpha),
      lerp(prevPlayerGta[2], curPlayerGta[2], renderAlpha),
    ];
    const playerEngine = toEngine(renderGta);
    poseMs = performance.now() - poseStarted;
    if (!hostState.paused) {
      const pedStarted = performance.now();
      posePlayer(gta, playerEngine, ridingCar, dt);
      pedMs = performance.now() - pedStarted;
    }

    // Streaming follows the PLAYER (the B3 contract), not the camera.
    const streamStarted = performance.now();
    const streamStats: StreamStats = setup.driver.update(playerEngine);
    // Emitters follow the streamed cell set; the call self-gates on a signature, so this is not per-frame work.
    // The live distance scale rides in on the same call — a changed value re-bakes both lanes.
    particles?.rebuild(config.graphics.effects.drawDistanceScale);
    void refreshCollision(); // self-gates on the camera's cell set — a no-op unless the overlay is on and moved
    streamMs = performance.now() - streamStarted;
    lastStream = streamStats;

    // While seated the camera trails the CAR (the rider is teleported into the seat every frame — following
    // the ped would judder); on foot it trails the player. Both are the INTERPOLATED render pose, so the
    // smoothed camera follows a continuous focus instead of the fixed-step saw (plan 080/03).
    const cameraStarted = performance.now();
    const focus = seatedCar ? toEngine(seatedCar.renderPosition) : playerEngine;
    const motion = motionSignals(seatedCar);
    settleEase = easeWindow(settleEase, dt);
    lastRidden = vehicles?.ridingVehicle() ?? lastRidden;
    syncCameraConfig();
    stepVideo(dt);
    pinchResidual = foldTouchCamera(touchInput, pendingInput, pinchResidual);
    // The rig is one pure step over a snapshot of this frame (plan 080/01): the handlers above only
    // ACCUMULATED input, so the smoothing that lands in plan 02 sees whole frames, dt included.
    const snapshot: CameraSnapshot = {
      // The camera's motion layer (plan 06) reads real gameplay edges, never guesses: 088 gives the
      // controller a LANDING STATE and the touchdown's vertical speed, and the damage system already
      // observes the crash this frame.
      airborne: motion.airborne,
      aspect: canvas.width / Math.max(1, canvas.height),
      bench: benchCamera,
      dt,
      focus,
      // What the camera FRAMES faces this way: the ped's rate-limited heading, or the car's while seated.
      focusHeading: seatedCar ? seatedCar.heading : (Locomotion.heading[playerEid] ?? heading),
      impactForce: motion.impact,
      landingSpeed: motion.landing,
      look: pendingInput.look,
      lookBehind: lookBehindHeld,
      mode: cameraModeOf(rig.flyEye !== null, seatedCar !== null),
      pan: pendingInput.pan,
      settling: settleEase > 0,
      // The car's speed and slip come from the PHYSICS body (081/01's shared `planarMotion`), not from the
      // focus delta: the delta measures the render loop, and a slide leaves no trace in it at all.
      vehicle: vehicles?.drivenMotion() ?? null,
      vehicleDistance: vehicleFollowDistance(seatedCar, config.camera.vehicleDistanceScale),
      video: videoCamera,
      walkKeys: flyKeys,
      zoomSteps: pendingInput.zoom,
    };
    // Camera collision probe (plan 04): sphere cast against the one Rapier world, excluding the camera's own
    // subject (the seated car body, or the player capsule on foot) so it never collides with what it frames.
    const collisionExclude = seatedCar?.body ?? RigidBody.handle[playerEid];
    // The car the player just climbed out of is ignored too, while they are still beside it: the exit hands
    // the rig a focus BESIDE the car with the eye still behind it, so the cast finds the car between them
    // and pulls the camera onto the ped's back. Rapier takes one exclusion directly and the second through
    // a predicate (`alsoExclude`), because the framed subject's own collider must stay excluded as well.
    const nearRidden = riddenNearby(gta, seatedCar);
    const cameraProbe: CameraProbe = (from, dir, radius, maxDist) =>
      physics.sphereCast(
        [from[0], from[1], from[2]],
        [dir[0], dir[1], dir[2]],
        radius,
        maxDist,
        collisionExclude,
        nearRidden,
      ) ?? null;
    // Floor guard: the ground below the eye, so a steep down-pitch can't bury the camera under a slope/porch.
    const groundProbe: GroundProbe = (at) => physics.groundBelow([at[0], at[1], at[2]], 30, collisionExclude);
    const camera = stepCamera(rig, snapshot, config.camera, cameraProbe, groundProbe);
    cameraMs = performance.now() - cameraStarted;
    watchCameraJump(perfLogs, camWatch, camera.target, rig, snapshot, config.camera.teleportSnapDistance, videoCut);
    videoCut = false; // a declared cut is worth exactly one frame of amnesty
    pendingInput.look.x = 0;
    pendingInput.look.y = 0;
    pendingInput.pan = null;
    pendingInput.zoom = 0;
    cameraFovY = camera.fovYRad;
    [cameraEye[0], cameraEye[1], cameraEye[2]] = camera.eye;
    engine.probeCenter = probeCenterOf(probeEnabled, focus);
    engine.probeView = probeViewEnabled;
    // Live tier knob (074/09): the config value drives the target size; the engine rebuilds on change.
    engine.renderScale = config.graphics.renderScale;
    // graphics.effects gate (089/01): kills both particle lanes' draws; dynamic spawns are dropped while off.
    engine.particlesEnabled = config.graphics.effects.enabled;
    const renderStarted = performance.now();
    const stats = engine.frame(camera);
    renderMs = performance.now() - renderStarted;
    lastStats = stats;
    // B7·b field stall: the CPU breakdown of the frames that actually hitch — a stall must arrive as a NUMBER,
    // not a theory. Quiet on a healthy frame. Everything below describes the interval `dt` measured: the
    // PREVIOUS frame's body (the `past` snapshot) plus the gap after it (the spans, the blob handler, GC).
    if (perfLogs && elapsedMs > SLOW_FRAME_MS && past.stats !== null) {
      // eslint-disable-next-line no-console
      console.log(
        slowFrameLine({
          census: physics.census(),
          elapsedMs,
          past: { ...past, stats: past.stats },
          simDtMs: dt * 1000,
          spans,
          stream: streamStats,
        }),
      );
    }
    benchSamples?.push({
      draws: stats.drawsRecorded,
      fixedSteps,
      frameMs: dt * 1000,
      gpuMs: stats.gpuPassMs,
      liveVehicles: physics.census().vehicles,
      pendingCells: streamStats.pendingCells,
      postMs: stats.gpuPostMs,
      probeMs: stats.gpuProbeMs,
      streamBlobMs: streamStats.blobMs,
      streamUploadMs: streamStats.uploadMs,
      submitMs: stats.submitMs,
      triangles: stats.trianglesRecorded,
      vehicleFixedMs,
    });

    if (
      !readySent &&
      ((streamStats.pendingCells === 0 && streamStats.created > 0) || now - bootStarted > WORLD_READY_TIMEOUT_MS)
    ) {
      readySent = true;
      onWorldReady?.();
    }

    // A running soak keeps the HUD up whatever the toggle says — its verdict is READ OFF the HUD.
    // The photo camera is for looking at the world — the perf readout hides with the rest of the chrome and
    // comes straight back on exit (a running soak still overrides, it must never be silently unobserved).
    const showHud = (perfHud && !photoCamera) || soakStatus !== '';
    if (hud.style.display !== (showHud ? 'block' : 'none')) {
      hud.style.display = showHud ? 'block' : 'none';
    }
    if (!showHud) {
      requestAnimationFrame(loop);

      return; // the HUD string is the only work left this frame — don't build it for a hidden element
    }
    hud.textContent = hudText({
      animMs,
      debugError,
      frames,
      grounded: Velocity.grounded[playerEid],
      gta,
      hour,
      move: input.move(),
      pedMs,
      residency: ledgerBreakdown(engine),
      seated: seatedCar !== null,
      soakStatus,
      stats,
      stream: streamStats,
      velocity: [Velocity.x[playerEid], Velocity.y[playerEid], Velocity.z[playerEid]],
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // In-game perf runs (bench `?bench=` + soak `?soak=`) — the runners live in ./engine-perf-runs; this
  // host only wires thin accessors over its loop state (camera override, sampling, teleport, env).
  setupPerfRuns({
    beginSamples: (): void => {
      benchSamples = [];
    },
    engine,
    fs,
    getStream: (): null | StreamStats => lastStream,
    getVehicles: (): EngineVehicles | null => vehicles,
    // The player's OWN capsule is excluded, or the probe answers with the body it is testing the ground
    // under: the settle asks about the anchor, and the player is standing exactly on it.
    groundBelow: (at, maxDrop): null | number =>
      physics.groundBelow([at[0], at[1], at[2]], maxDrop, RigidBody.handle[playerEid]),
    params,
    playerProbe: (): { grounded: boolean; z: number } => ({
      grounded: Velocity.grounded[playerEid] === 1,
      z: Transform.z[playerEid],
    }),
    setBenchCamera: (camera): void => {
      benchCamera = camera;
    },
    setHour: (value): void => {
      hour = value;
    },
    setSoakStatus: (text): void => {
      soakStatus = `\n${text}`;
    },
    settleTimeoutMs: WORLD_READY_TIMEOUT_MS,
    setWeather: (value): void => {
      weatherTransition.begin(value, 0);
    },
    slowFrameMs: SLOW_FRAME_MS,
    takeSamples: (): LegSample[] => {
      const samples = benchSamples ?? [];
      benchSamples = null;
      benchCamera = null;

      return samples;
    },
    // The SAME warp the debugger and the phys/video runs take (plan 102): its own inline teleport skipped
    // the interpolation snap, so a bench leg streaked the ped across the map for a frame.
    teleportPlayer: (anchor): void => {
      teleportPlayer([anchor[0], anchor[1], anchor[2]]);
    },
    toEngine,
  });

  // Scripted physics laps (081/01): the same teleport contract as a bench leg, then a driven capture.
  setupPhysRuns({
    airControl: (): { scale: number } => physics.airControlTuning(),
    drive: scriptedDrive,
    getStream: (): null | StreamStats => lastStream,
    getVehicles: (): EngineVehicles | null => vehicles,
    params,
    setHour: (value): void => {
      hour = value;
    },
    settleTimeoutMs: WORLD_READY_TIMEOUT_MS,
    spawnCar: async (model, position, heading): Promise<void> => {
      await vehicles?.spawn({
        groundSnap: true,
        heading,
        model,
        position: [position[0], position[1], position[2]],
      });
    },
    speedGrip: (): { cap: number; reference: number } => physics.speedGripTuning(),
    surfaceGrip: (): boolean => physics.surfaceGripActive(),
    surfaces: (): null | readonly { name: string }[] => adapter.surfaces(),
    teleportPlayer: (anchor): void => {
      teleportPlayer([anchor[0], anchor[1], anchor[2]]);
    },
  });

  // Video mode (096/02): the same staging contract as a phys lap, driven by the autopilot instead of a
  // timeline, with the module owning its own black overlay and the UI hide.
  setupVideoRuns({
    aspect: (): number => canvas.width / Math.max(1, canvas.height),
    autopilot: pathFollow,
    cityBoxes: (): readonly CityBox[] => cityBoxes,
    collisionRadius: (): number => config.streaming.collisionDrawDistance,
    colourCombos: async (model): Promise<number[][]> => adapter.vehicleColourCombos(model),
    fs,
    getStream: (): null | StreamStats => lastStream,
    getVehicles: (): EngineVehicles | null => vehicles,
    getWeather: (): number => weatherTransition.target,
    groundBelow: (at, maxDrop): null | number => physics.groundBelow([at[0], at[1], at[2]], maxDrop),
    params,
    pathClear: (from, to, excludeBody): boolean =>
      physics.pathClear([from[0], from[1], from[2]], [to[0], to[1], to[2]], excludeBody),
    playerPose: (): PlayerPose => ({
      gta: viewOf(),
      // The ped's own capsule, in the vehicle convention the shot table multiplies against
      // ([lateral, longitudinal, vertical]) — so one pedestrian preset frames whatever character is loaded.
      halfExtents: [CAPSULE_RADIUS, CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS],
      heading,
      position: [playerDrawn[0], playerDrawn[1], playerDrawn[2]],
      speed: Math.hypot(Velocity.x[playerEid], Velocity.y[playerEid]),
    }),
    setHour: (value): void => {
      hour = value;
    },
    settleTimeoutMs: WORLD_READY_TIMEOUT_MS,
    setUiHidden: (hidden): void => {
      photoCamera = hidden; // the dev readout hides behind the same gate the photo camera uses
      emitFlyCamera(hidden, hidden);
    },
    setVideoCamera: (pose, cut): void => {
      videoCamera = pose;
      videoCut ||= cut; // never clear a cut the loop has not consumed yet
    },
    setVideoStep: (step): void => {
      videoStep = step;
    },
    setWeather: (value): void => {
      weatherTransition.begin(value, 0);
    },
    spawnCar: async (model, position, heading, colour): Promise<() => void> => {
      const vehicleSystem = vehicles;
      if (!vehicleSystem) {
        throw new Error('no vehicle system on this host');
      }

      return vehicleSystem.spawnOnce({
        colour,
        groundSnap: true,
        heading,
        model,
        position: [position[0], position[1], position[2]],
      });
    },
    sphereClear: (from, to, radius): boolean => {
      const dir: [number, number, number] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const distance = Math.hypot(dir[0], dir[1], dir[2]);

      return distance === 0 || physics.sphereCast([from[0], from[1], from[2]], dir, radius, distance) === null;
    },
    teleportPlayer: (anchor): void => {
      teleportPlayer([anchor[0], anchor[1], anchor[2]]);
    },
    toEngine,
    walkArrived: (): boolean => controllerSystem.arrived,
    walkPath: (points, gait): void => {
      controllerSystem.runPath(
        points.map((point): [number, number, number] => [point[0], point[1], point[2]]),
        gait,
      );
    },
    walkSpeed: (): number => config.movement.walkSpeed,
    walkStop: (): void => {
      controllerSystem.runPath([]); // an empty path hands control back, exactly as enter-vehicle does
    },
    weatherNames: WEATHER_NAMES,
  });
}

function bootAim(params: URLSearchParams, from: readonly [number, number, number]): { heading: number; pitch: number } {
  const look = (params.get('look') ?? '').split(',').map(Number);

  return look.length === 3 && look.every(Number.isFinite)
    ? aimAt(from, [look[0], look[1], look[2]])
    : { heading: SPAWN_FACING, pitch: DEFAULT_CAMERA_PITCH };
}

/** Which rig frames this frame: a detached eye wins over a seat, a seat over the on-foot follow. */
function cameraModeOf(flying: boolean, seated: boolean): CameraSnapshot['mode'] {
  if (flying) {
    return 'fly';
  }

  return seated ? 'vehicle' : 'foot';
}

/** GTA Z-up → engine Y-up; the shore field + water class ride along untouched. */
function engineWaterVertices(gta: Float32Array): Float32Array {
  const vertices = new Float32Array(gta.length);
  for (let v = 0; v < gta.length; v += WATER_VERTEX_FLOATS) {
    vertices[v] = gta[v];
    vertices[v + 1] = gta[v + 2];
    vertices[v + 2] = -gta[v + 1];
    vertices[v + 3] = gta[v + 3];
    vertices[v + 4] = gta[v + 4];
  }

  return vertices;
}

function flipActiveVehicle(physics: PhysicsWorld, active: null | { body: number }): void {
  if (!active) {
    return;
  }
  const { position, quaternion } = physics.readBody(active.body);
  const [qx, qy, qz, qw] = quaternion;
  // Car forward = (0, 1, 0) rotated by q (native Z-up), via q·v·q⁻¹ expanded.
  const fx = 2 * (qx * qy - qw * qz);
  const fy = 1 - 2 * (qx * qx + qz * qz);
  const fz = 2 * (qy * qz + qw * qx);
  // A π turn about a unit axis is the pure quaternion (axis, 0); compose it with the current orientation.
  const length = Math.hypot(fx, fy, fz) || 1;
  const [ax, ay, az] = [fx / length, fy / length, fz / length];
  physics.holdBody(
    active.body,
    [position[0], position[1], position[2] + 1.5],
    [
      ay * qz - az * qy + qw * ax,
      az * qx - ax * qz + qw * ay,
      ax * qy - ay * qx + qw * az,
      -(ax * qx + ay * qy + az * qz),
    ],
  );
}

/** The debugger's Perf rows from the host's own numbers (three's renderer.info counters have no twin here —
 *  plan 074/22 phase 3.3 replaces the panel content with the engine ledger). */
function frameStats(frames: readonly number[], stats: null | ReturnType<Engine['frame']>): null | PerfStats {
  if (frames.length === 0) {
    return null;
  }
  const sorted = [...frames].sort((a, b) => a - b);
  const avgMs = frames.reduce((sum, value) => sum + value, 0) / frames.length;

  return {
    avgMs,
    drawCalls: stats?.drawsRecorded ?? 0,
    fps: 1000 / Math.max(avgMs, 0.001),
    geometries: 0,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    programs: 0,
    textures: 0,
    triangles: stats?.trianglesRecorded ?? 0,
  };
}

/** The on-screen HUD text (own engine). Extracted from the frame loop so the loop stays readable — it is one
 *  string build with a dozen conditional fields. Shown while the Perf-screen toggle is on (074/22). */
function hudText(frame: {
  animMs: number;
  debugError: null | string;
  frames: readonly number[];
  grounded: number;
  gta: readonly [number, number, number];
  hour: number;
  move: { x: number; y: number };
  pedMs: number;
  residency: string;
  seated: boolean;
  soakStatus: string;
  stats: ReturnType<Engine['frame']>;
  stream: StreamStats;
  velocity: readonly [number, number, number];
}): string {
  const { gta, stats, stream, velocity } = frame;
  const avg = frame.frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frame.frames.length);
  const ms = (value: number, absent = 'n/a'): string => (value > 0 ? value.toFixed(2) : absent);
  const clock = `${String(Math.floor(frame.hour)).padStart(2, '0')}:${String(Math.floor((frame.hour % 1) * 60)).padStart(2, '0')}`;

  return (
    `OWN ENGINE (074/10 B3) — walk: WASD, run: Shift, jump: Space, click = capture mouse (Esc frees)\n` +
    `        F2 = debugger · K+M = photo camera (ARROWS move, PgUp/PgDn lift, mouse looks)\n` +
    `frame   ${avg.toFixed(2)} ms (${(1000 / Math.max(avg, 0.001)).toFixed(0)} fps)\n` +
    `submit  ${stats.submitMs.toFixed(2)} ms · GPU ${ms(stats.gpuPassMs)} ms · post ${ms(stats.gpuPostMs)} ms · probe ${ms(stats.gpuProbeMs, 'off')} ms · draws ${stats.drawsRecorded} · signs ${stats.roadsignQuadsRecorded}\n` +
    `stream  ${stream.loadedCells} cells, ${stream.pendingCells} pending, late ${stream.lateCreates} · ` +
    `residency ${(stats.residencyBytes / 1048576).toFixed(0)} MB (${frame.residency})\n` +
    `GTA     ${gta[0].toFixed(1)}, ${gta[1].toFixed(1)}, ${gta[2].toFixed(1)} · ${clock}\n` +
    `debug   vel ${velocity[0].toFixed(2)},${velocity[1].toFixed(2)},${velocity[2].toFixed(2)} ` +
    `grounded ${frame.grounded} ${frame.seated ? '· SEATED ' : ''}` +
    `move ${JSON.stringify(frame.move)} · ped sampler ${frame.pedMs.toFixed(2)} ms · anim ${frame.animMs.toFixed(2)} ms` +
    frame.soakStatus +
    (frame.debugError ? `\nFIXED-STEP ERROR: ${frame.debugError}` : '') +
    (hostState.paused ? '\nPAUSED' : '')
  );
}

/** Water (074/06 row 12): prefer the BAKED tessellated mesh (`water.bin` — per-vertex shore field →
 *  displacement/foam/shallow); fall back to the flat runtime build (constant deep field) for paks
 *  converted before the water bake. Textures: particle.txd waterclear256 (ripple) + waterwake (foam). */
async function installWater(
  engine: Engine,
  fs: AssetFileSystem,
  water: undefined | { file: string; indexCount: number; vertexCount: number },
  source: PakSource,
): Promise<void> {
  const ripple = loadWaterTexture(fs, 'waterclear256');
  const foam = loadWaterTexture(fs, 'waterwake');
  if (water) {
    // The baked water.bin rides the SAME source as the pak — the picked folder in folder mode, the URL base
    // otherwise — so the map viewer and the game agree on which world they render.
    const bytes =
      typeof source === 'string'
        ? await fetch(`${source}/${water.file}`).then((response) => (response.ok ? response.arrayBuffer() : null))
        : await source.open(water.file).then((blob) => (blob ? blob.arrayBuffer() : null));
    if (bytes) {
      const bin = new Uint8Array(bytes);
      const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
      const vertexCount = view.getUint32(0, true);
      const indexCount = view.getUint32(4, true);
      // Vertex = [x, y, z, depth, class] (plan 075: class 0 = sea, 1 = inland) — stride 20.
      const gta = new Float32Array(bin.buffer, bin.byteOffset + 8, vertexCount * 5);
      const indices = new Uint32Array(bin.buffer.slice(bin.byteOffset + 8 + vertexCount * 20), 0, indexCount);
      engine.setWater(engineWaterVertices(gta), indices, ripple, foam);

      return;
    }
  }
  const text = fs.getText('data/water.dat');
  if (text === null) {
    return;
  }
  // No bake: the flat build from water.dat — the same one sa-map-viewer runs, so both render one sea.
  const flat = flatWaterMesh(parseWater(text));
  engine.setWater(engineWaterVertices(flat.positions), flat.indices, ripple, foam);
}

/** Decode one particle.txd texture to RGBA (null when the archive/texture is absent). */
function loadWaterTexture(
  fs: AssetFileSystem,
  name: string,
): null | { height: number; rgba: Uint8Array; width: number } {
  const buffer = fs.get('models/particle.txd');
  if (!buffer) {
    return null;
  }
  for (const texture of parseTxd(buffer).textures) {
    if (texture.name.toLowerCase() === name) {
      const base = texture.mipmaps[0];
      const rgba =
        texture.format === 'rgba8888'
          ? new Uint8Array(base.data)
          : decodeDxt(texture.format, base.data, base.width, base.height);

      return { height: base.height, rgba, width: base.width };
    }
  }

  return null;
}

/**
 * Roll the occupied car 180° about its OWN forward axis and lift it 1.5 m (the debugger's "flip vehicle" —
 * prod's implementation, with the quaternion algebra written out so the host keeps its three-free math).
 */
/** The follow distance a seated car wants: its LENGTH (2·halfExtent.y) × the config scale, or null on foot. */
/** Planar (x, y) distance between two GTA points. */
function planarDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Env-probe centre (074/16 step 2): the FOLLOWED thing — the seated car while driving, the player on foot
 * (nearby parked cars share the same probe, like prod's camera-centred cube). Lifted ~1 unit so the ground
 * plane doesn't split the cube in half at the centre. `?probe=0` keeps the analytic-sky fallback.
 */
function probeCenterOf(enabled: boolean, focus: readonly [number, number, number]): [number, number, number] | null {
  return enabled ? [focus[0], focus[1] + 1.0, focus[2]] : null;
}

/**
 * What the boot camera starts as: `?look=x,y,z` aims it at a GTA world point, otherwise the fixed spawn
 * facing. The ped is seeded with the same heading, which is what stops auto-centre swinging the aim away.
 *
 * **This knob exists because the headless harness has no mouse.** It presses keys, and look is pointer-only,
 * so without an aim every probe stares SOUTH — a subject then needs standable ground ~600 u to its NORTH to
 * be seen at LOD range, which the Las Payasadas boards do not have: the map ends ~350 u past them and a
 * spawn there falls through the void.
 *
 * The aim math itself is {@link aimAt}, beside the convention it inverts.
 */
/**
 * `?procobjSlope=<steep>,<flat>` — the slope gate as a field A/B knob (plan 011). One pair of multipliers for
 * the ROCK categories, because that is where the measurement put it: `p_mountain` carries all six `p_rubble*`
 * species and is the only surface with a large steep share. `?procobjSlope=2,0.5` is "twice the scree on the
 * slopes, half of it on the flat". Absent (or unparseable) leaves the scatter untouched.
 */
function procObjSlopeParam(params: URLSearchParams): { procObjSlope?: ProcObjSlopeConfig } {
  const raw = params.get('procobjSlope');
  if (raw === null) {
    return {};
  }
  const [steep, flat] = raw.split(',').map(Number);
  if (!Number.isFinite(steep) || steep < 0) {
    return {};
  }

  return { procObjSlope: { flat: { rocks: Number.isFinite(flat) && flat >= 0 ? flat : 1 }, steep: { rocks: steep } } };
}

/**
 * Register the map's car generators — or none, when `?cargen=0` bisects them out of a run.
 *
 * `?cargen=0` is the SECOND half of the `?parked=0` bisection: these ~962 placements stream themselves in
 * and out exactly like the parked cars do, so turning off `parked.json` alone leaves the churn running — a
 * field run that read as "without cars" still found them parked at the pirate ship (2026-08-03).
 *
 * The count is said out loud either way: the six weeks this took to notice were six weeks of an empty map
 * looking exactly like a full one, and the drive that finally caught it read the number nowhere.
 */
async function registerMapCarGenerators(
  vehicles: EngineVehicles | null,
  adapter: GtaSaWorldAdapter,
  options: Parameters<GtaSaWorldAdapter['mapCarGenerators']>[0],
  enabled: boolean,
): Promise<void> {
  const placements = enabled ? await adapter.mapCarGenerators(options) : [];
  vehicles?.register(placements);
  const count = vehicles === null ? 0 : placements.length;
  // eslint-disable-next-line no-console -- the one line that says whether the map has cars at all
  console.log(`[vehicles] map car generators registered: ${count}${enabled ? '' : ' (DISABLED by ?cargen=0)'}`);
}

/**
 * Build the on-screen controls (plan 055): another {@link TouchInputSource} in the SAME combiner the keyboard
 * feeds, so a 2-in-1 keeps both, published to the React tree through {@link touchRef}. Null — and no overlay —
 * on a device with no touch.
 */
function setupTouchControls(input: CombinedInput, canEnterExit: () => boolean): null | TouchInputSource {
  if (!isTouchDevice()) {
    return null;
  }
  const source = new TouchInputSource();
  input.add(source);
  touchRef = { canEnterExit, source };

  return source;
}

/**
 * The `[slow]` breakdown of ONE elapsed interval: the previous frame's body (`past`), the gap after it
 * (`spans` + the blob handler) and, as `other`, whatever the two together do not account for.
 *
 * `elapsedMs` is the REAL interval, not the simulation's clamped `dt` — a 400 ms hitch reported as 250 would
 * bury 150 ms of itself in the residual. When the two differ the clamp is named.
 */
function slowFrameLine(frame: {
  census: { bodies: number; colliders: number };
  elapsedMs: number;
  past: FrameBlocks;
  simDtMs: number;
  spans: FrameSpanTotals;
  stream: StreamStats;
}): string {
  const { census, elapsedMs, past, spans, stream } = frame;
  const other =
    elapsedMs -
    (past.fixed +
      past.collision +
      past.anim +
      past.vehicles +
      past.ped +
      past.stream +
      past.camera +
      past.render +
      past.props +
      past.world +
      past.pose +
      past.paused +
      stream.blobMs);
  const clamped = elapsedMs > frame.simDtMs + 0.5 ? ` (sim dt ${frame.simDtMs.toFixed(0)})` : '';

  return (
    `[slow] frame ${elapsedMs.toFixed(1)}${clamped} · gpu ${past.stats.gpuPassMs.toFixed(2)} · post ${past.stats.gpuPostMs.toFixed(2)} · probe ${past.stats.gpuProbeMs.toFixed(2)} · ` +
    `render ${past.render.toFixed(1)} (submit ${past.stats.submitMs.toFixed(2)}) · stream ${past.stream.toFixed(1)} (blob ${stream.blobMs.toFixed(1)} worst ${stream.worstBlobMs.toFixed(1)} upload ${stream.uploadMs.toFixed(1)}) · camera ${past.camera.toFixed(1)} · ` +
    `fixed ${past.fixed.toFixed(1)} (${past.steps} steps: controller ${past.controller.toFixed(1)} + physics ${past.physics.toFixed(1)} · cars ${past.cars.toFixed(2)}) · ` +
    `collision ${past.collision.toFixed(1)} · vehicles ${past.vehicles.toFixed(1)} · ` +
    `ped ${past.ped.toFixed(2)} · anim ${past.anim.toFixed(2)} · props ${past.props.toFixed(2)} · world ${past.world.toFixed(2)} · pose ${past.pose.toFixed(2)} · paused ${past.paused.toFixed(2)} · ` +
    `other ${other.toFixed(1)} (${formatFrameSpans(spans, other - spans.totalMs)}) · draws ${past.stats.drawsRecorded} · cells ${stream.loadedCells} · ` +
    `bodies ${census.bodies} colliders ${census.colliders}`
  );
}

/** Tyre-smoke session dials (089/02) — `?smokeStart/?smokeFull/?smokeRate`, the 081/09 URL-dial pattern. */
function smokeDialOverrides(params: URLSearchParams): Partial<TyreSmokeDials> {
  return {
    ...(params.has('smokeRate') ? { rate: Number(params.get('smokeRate')) } : {}),
    ...(params.has('smokeFull') ? { slideFull: Number(params.get('smokeFull')) } : {}),
    ...(params.has('smokeStart') ? { slideStart: Number(params.get('smokeStart')) } : {}),
  };
}

/** GTA Z-up point → engine Y-up: (x, y, z) → (x, z, −y). */
function toEngine(gta: readonly [number, number, number]): [number, number, number] {
  return [gta[0], gta[2], -gta[1]];
}

function vehicleFollowDistance(car: null | { halfExtents: readonly number[] }, scale: number): null | number {
  return car ? 2 * car.halfExtents[1] * scale : null;
}

/**
 * The [cam] jump watchdog (plan 080/09 §4.1): a camera discontinuity must arrive as a LINE with its state,
 * not as a memory of "it jumped once under strange circumstances". Composition signals only — the LOOK
 * TARGET moves with the focus and the framing, never with the mouse (the mouse orbits the eye AROUND it),
 * and the yaw moves fast only under the player's hand. A target jump, or a yaw jump on an idle mouse,
 * outside the legitimate discontinuities (teleport, mode switch, scripted seat sequence, fly, bench) is a
 * bug signature. Static collision snap-ins move the EYE by design and are deliberately not watched.
 */
function watchCameraJump(
  enabled: boolean,
  watch: CamWatch,
  target: readonly [number, number, number],
  rig: CameraRigState,
  snapshot: CameraSnapshot,
  teleportSnapDistance: number,
  videoCut: boolean,
): void {
  if (!enabled) {
    return;
  }
  const teleported =
    watch.focus !== null &&
    Math.hypot(snapshot.focus[0] - watch.focus[0], snapshot.focus[2] - watch.focus[2]) > teleportSnapDistance;
  const legit =
    watch.target === null ||
    watch.mode !== snapshot.mode ||
    snapshot.settling ||
    rig.flyEye !== null ||
    snapshot.bench !== null ||
    // A video CUT is whitelisted; video mode itself is NOT. Between its cuts the director's pose is
    // continuous by construction, so the watchdog stays the tripwire it was built to be (096/03 A2).
    videoCut ||
    teleported;
  const targetJump =
    watch.target === null
      ? 0
      : Math.hypot(target[0] - watch.target[0], target[1] - watch.target[1], target[2] - watch.target[2]);
  const yawJump = Math.abs(angleDelta(watch.yaw, rig.yaw));
  const looked = snapshot.look.x !== 0 || snapshot.look.y !== 0;
  if (!legit && (targetJump > CAM_JUMP_TARGET || (!looked && yawJump > CAM_JUMP_YAW))) {
    watch.jumpStreak += 1;
    // eslint-disable-next-line no-console -- deliberate field diagnostic: the seen-once jump needs a name
    console.log(
      `[cam] jump target ${targetJump.toFixed(2)} · yaw ${((yawJump * 180) / Math.PI).toFixed(1)}° · ` +
        `mode ${snapshot.mode} · dt ${(snapshot.dt * 1000).toFixed(1)} · dist ${rig.distance.toFixed(2)} ` +
        `shown ${rig.collision.shown.toFixed(2)} · look ${looked}`,
    );
    // Once per streak (`===`, not `>=`): the wall of jump lines is the symptom, this is the diagnosis, and a
    // diagnosis repeated every frame is another wall. `focus[1]` is the engine's up axis, so the drop per
    // frame is what separates a fall from a camera that merely lost its target.
    if (watch.jumpStreak === CAM_FALL_STREAK) {
      const drop = watch.focus === null ? 0 : watch.focus[1] - snapshot.focus[1];
      // eslint-disable-next-line no-console -- the marker IS the deliverable (see CAM_FALL_STREAK)
      console.log(
        `[fall] ${CAM_FALL_STREAK} jump frames in a row — nothing is holding the focus up · ` +
          `height ${snapshot.focus[1].toFixed(1)} · dropping ${drop.toFixed(2)}/frame · mode ${snapshot.mode}`,
      );
    }
  } else {
    watch.jumpStreak = 0;
  }
  watch.focus = [snapshot.focus[0], snapshot.focus[1], snapshot.focus[2]];
  watch.mode = snapshot.mode;
  watch.target = [target[0], target[1], target[2]];
  watch.yaw = rig.yaw;
}
