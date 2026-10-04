/**
 * Video mode (plan 096/02) — `?video=1&seed=N`, the self-directed showcase runner.
 *
 * A scene picks a seeded route out of the game's own road graph, stages a car on it behind a black overlay,
 * lifts the overlay once the world is streamed AND the frame rate has settled, and hands the wheel to the
 * autopilot for a fragment's worth of real seconds. Then the overlay comes back down and the next scene
 * stages behind it — for scenes 1 to `SCENE_LIMIT` of the seed, then the run STOPS on an end card. The user
 * screen-records the canvas and cuts the black gaps out by hand; nothing here captures anything.
 *
 * A run being a bounded SEQUENCE is what makes it nameable: `?seed=47` is a specific 100 scenes, and every
 * one of them is reproducible down to its car, hour, weather, route and shot list.
 *
 * The sequencer (05) is what turns that into a run: a cycle plays a drive scene in every region of
 * `REGION_CYCLE`, each in that region's own weather and one of the debugger's hours, in a car picked out of the
 * build's OWN mod cars when it ships any, else the game's road-car roster. What a cycle contains is a TABLE
 * (`video/presets.ts`), so this file stays about staging; the walk and flythrough kinds are skipped with a
 * notice until 07 gives them scenes.
 *
 * The staging recipe is the phys laps' (`engine-phys-runs.ts`), verbatim and for the same reasons — a
 * teleport's `pendingCells` lies for about a second, and a ground-snapped car is still moving on its springs
 * for two more. Everything outside the fragment happens behind the overlay, so none of it is ever recorded.
 */
import type { StreamStats } from '@opensa/engine';
import type { ScriptedGait } from '@opensa/game/character/character-controller.system';
import type { Route, RouteConstraints } from '@opensa/game/paths/route-builder';
import type { PathFollowSource } from '@opensa/game/vehicle/path-follow';
import type { TelemetryFrame } from '@opensa/game/vehicle/vehicle-telemetry';
import type { City, CityBox } from '@opensa/game/zones/city';
import type { AssetFileSystem } from '@opensa/renderware';

import { loadRouteGraph } from '@opensa/game/adapters/path-graph';
import { mulberry32, type Random } from '@opensa/game/paths/rng';
import { walkRoute } from '@opensa/game/paths/route-builder';
import { randomNode, type RouteGraph } from '@opensa/game/paths/route-graph';
import { summarisePhysFrames, thinFrames } from '@opensa/game/vehicle/phys-capture';
import { cityAt } from '@opensa/game/zones/city';

import type { VideoCamera } from './camera/engine-camera';
import type { EngineVehicles } from './engine-vehicles';
import type { DirectorState } from './video/director';
import type { FlyPass, FlyState } from './video/fly';
import type { ProgramEntry } from './video/presets';
import type { ShiverDiag } from './video/shiver-diag';
import type { Subject } from './video/shots';
import type { StationSupply } from './video/station-supply';
import type { StepCost, StepTimer } from './video/step-cost';
import type { WalkPath } from './video/walk';

import { modCarSlots, roadCarModels } from '../vehicle-models';
import { nextFrame, until, waitSeconds } from './frame-clock';
import { createDirector, nextStationSlot, planShots, stepDirector } from './video/director';
import { CLEARANCE_RADIUS, clearFlight, createFlight, FLY_MAX_EXTENT, planFlight, stepFlight } from './video/fly';
import {
  HOUR_SLOTS,
  parseSceneLimit,
  parseSceneStart,
  pickCar,
  REGION_CYCLE,
  SCENE_LIMIT,
  sceneProgramEntry,
  sceneSeed,
  sceneUrl,
  weatherPool,
} from './video/presets';
import { playSequence } from './video/sequence';
import { createShiverDiag, yawOfQuat } from './video/shiver-diag';
import { forwardFromHeading, SHOT_ROAD_SECONDS, SHOTS_PER_SCENE, WALK_SHOTS } from './video/shots';
import { createStationSupply } from './video/station-supply';
import { WALK_STATION_LATERALS, WALK_SURVEY_DEFAULTS } from './video/stations';
import { createStepTimer } from './video/step-cost';
import { createWalkCursor, WALK_LANE_OFFSET, walkWaypoints } from './video/walk';

/** The player, as {@link VideoRunsHost.playerPose} hands him over. */
export interface PlayerPose {
  /** GTA Z-up, the gameplay position — what the probes cast from and what the route is measured against. */
  gta: [number, number, number];
  /** The ped capsule's half-extents in the shot table's convention `[lateral, longitudinal, vertical]`. */
  halfExtents: [number, number, number];
  /** GTA heading (the locomotion facing) — one fixed step old at worst, like the car's. */
  heading: number;
  /** The DRAWN position, engine Y-up. */
  position: [number, number, number];
  /** Planar speed (m/s). */
  speed: number;
}

/** What video mode needs from the engine host — thin accessors over its loop state, like `PhysRunsHost`. */
export interface VideoRunsHost {
  /** The canvas aspect this frame — the framing math needs it, and a resize must reach it live. */
  aspect(): number;
  /** The autopilot installed in the host's `CombinedInput`; the fixed loop advances it. */
  autopilot: PathFollowSource;
  /** The city boxes the region predicate reads (desert first) — a thunk, because they load after boot. */
  cityBoxes(): readonly CityBox[];
  /** How far from the player collision is streamed (m) — the walk scene may only probe ground inside it. */
  collisionRadius(): number;
  /** The paint combos `carcols` authors for a model (empty when it authors none) — the scene picks one. */
  colourCombos(model: string): Promise<number[][]>;
  /** The game filesystem — the road graph is read from its own `data/paths/nodes*.dat`. */
  fs: AssetFileSystem;
  getStream(): null | StreamStats;
  /** Live accessor — the vehicle system arrives asynchronously after boot. */
  getVehicles(): EngineVehicles | null;
  /** The weather the world is heading for. Read at a scene's end to catch a route that leaked across a city
   *  boundary and let `CityZoneSystem` rewrite the weather mid-shot (D15's tripwire). */
  getWeather(): number;
  /** Ground Z under a GTA point (searching `maxDrop` down), or null — the station survey's ground snap. */
  groundBelow(at: readonly [number, number, number], maxDrop: number): null | number;
  params: URLSearchParams;
  /** Line of sight between two GTA points, one body excluded — the survey and the live tripod check. */
  pathClear(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    excludeBody?: number,
  ): boolean;
  /** The player as the walk scene has to film him: the DRAWN pose (engine Y-up) with the gameplay heading,
   *  the same pairing the car shots use, plus the GTA position the probes and the route work in. */
  playerPose(): PlayerPose;
  setHour(hour: number): void;
  /** The streaming-settle deadline after a teleport (the host's world-ready timeout). */
  settleTimeoutMs: number;
  /** Hide every piece of chrome (the shared photo-camera path). Video mode never asks for it back: a run
   *  ends on its own end card, and handing the chrome back would put the HUD into the last frame recorded. */
  setUiHidden(hidden: boolean): void;
  /**
   * Hand the host the frame this shot wants, or null to give it back to the shipped follow rig (the `chase`
   * shot). `cut` DECLARES the discontinuity to the `[cam] jump` watchdog for exactly one frame — an
   * undeclared jump still prints, which is the whole point of declaring the declared ones.
   */
  setVideoCamera(pose: null | VideoCamera, cut: boolean): void;
  /**
   * Install the director's per-frame step, or `null` to take it out again.
   *
   * The host calls it INSIDE its loop, after the car's render pose is written and before the camera snapshot
   * is built, handing over that frame's `dt`. A camera mounted on the car has to be composed from the frame
   * the car is drawn in — stepped from the module's own rAF instead, the pose reaches the screen one frame
   * late and the pairing carries the car's whole travel for that frame.
   */
  setVideoStep(step: ((dt: number) => void) | null): void;
  /** Set the weather INSTANTLY — the 6 s artistic fade must never play inside a fragment. */
  setWeather(index: number): void;
  /** Spawn a scene-owned car (not LOD-registered) and hand back its despawn. */
  spawnCar(
    model: string,
    position: readonly [number, number, number],
    heading: number,
    colour?: string,
  ): Promise<() => void>;
  /** Whether a SPHERE of `radius` can travel between two GTA points without hitting anything.
   *
   *  The flight's clearance check, and a sphere rather than a ray on purpose: a ray threads a gap between two
   *  balconies and calls a pass clear that a drone would clip. */
  sphereClear(from: readonly [number, number, number], to: readonly [number, number, number], radius: number): boolean;
  /** Teleport the player (streaming/collision anchor), GTA coords. */
  teleportPlayer(anchor: readonly [number, number, number]): void;
  /** GTA Z-up → engine Y-up. The director works in ONE space (engine) and converts here, at the boundary. */
  toEngine(gta: readonly [number, number, number]): [number, number, number];
  /** The scripted walk has reached its last waypoint (the controller's own `arrived`). */
  walkArrived(): boolean;
  /** Walk the player along GTA Z-up waypoints at the given gait — `CharacterControllerSystem.runPath`. */
  walkPath(points: readonly (readonly [number, number, number])[], gait: ScriptedGait): void;
  /** The ped's configured walking speed (m/s) — the walk route's length is derived from it, never guessed. */
  walkSpeed(): number;
  /** Hand movement back to the keyboard (an empty path) — the scene's teardown. */
  walkStop(): void;
  /** The timecyc weather row names — the region's own weather set is FILTERED out of these (D7). */
  weatherNames: readonly string[];
}

/** What a scene drives when the roster is empty — a game with no readable `vehicles.ide` still gets a try. */
const DEFAULT_CAR = 'admiral';
/** The builder's calm cruise (m/s, D8) — also what a route's length is derived from. */
const CRUISE_SPEED = 12;
/** Road gathered per route, as a multiple of what the longest fragment can drive — margin, never a shortfall. */
const ROUTE_MARGIN = 1.3;
/**
 * Seeded start nodes tried before a scene gives up on the region.
 *
 * Raised from 40 with the 2026-07-31 timing model: a five-shot scene needs roughly 936 m of road where the
 * old fragment needed 390, and long routes are rarer — measured over 120 walks per region on the built tree,
 * San Fierro accepts 10 (Los Santos 19, Countryside 13, Desert 17, Las Venturas 33). At the worst of those,
 * 40 tries would fail a scene about 3 times in 100; 120 puts it under 1 in 10 000, and a walk is a graph
 * traversal behind the black overlay.
 */
const ROUTE_TRIES = 120;
/** How far to the side of the spawn the ped waits (m) — the phys laps' number, inside the 4 m enter range. */
const PED_OFFSET = 2.5;
/** Grace after a teleport before `pendingCells` means anything — it answers for the ring you just left. */
const TELEPORT_NOTICE_SECONDS = 1;
/** After the ring drains: the collision parse behind it is what a spawn actually needs. */
const WARMUP_SECONDS = 2;
/** A ground-snapped car is still moving on its suspension; the overlay stays down through this. */
const SETTLE_SECONDS = 2;
/** How long a spawn keeps retrying while the ground under the spot streams in. */
const SPAWN_RETRY_SECONDS = 15;
/** A seating that has not taken by now is a broken spot, not a slow one. */
const ENTER_TIMEOUT_S = 20;
/** How far from the route start the seated car may be and still be THIS scene's car (m). */
const SPOT_RADIUS = 20;
/** Consecutive frames under {@link STABLE_FRAME_MS} before the overlay lifts — the fps stability gate. */
const STABLE_FRAMES = 30;
/** What counts as a settled frame (ms) — 40 fps, comfortably clear of the cold-teleport spike (plan 091). */
const STABLE_FRAME_MS = 25;
/** How long the gate waits for that before starting anyway (behind a fair warning in the log). */
const STABLE_TIMEOUT_S = 20;
/** Overlay fade (ms) — long enough not to flash, short enough that the user's cut is unambiguous. */
const FADE_MS = 300;
/** The longest frame the director is allowed to integrate (s) — a hitch must not snap the damping. */
const MAX_FRAME_SECONDS = 0.1;
/** Frames spent surveying an OPENING tripod behind the overlay — an open street settles in 2-4 of them. */
const PRIME_FRAMES = 40;
/** Series rate in the printed JSON (Hz). Half the phys laps': this instrument judges a LINE, not a step. */
const SERIES_HZ = 10;
/**
 * Road a scene may need (s of driving), for sizing its route before it is walked.
 *
 * Every shot is charged the same {@link SHOT_ROAD_SECONDS}: a riding shot drives its whole clip, and a
 * planted one is charged its PASS rather than its watchdog, because a car that trips the watchdog has
 * stopped moving and is not consuming road either.
 */
const SCENE_ROAD_SECONDS = SHOTS_PER_SCENE * SHOT_ROAD_SECONDS;

/**
 * What a walk route asks of the road graph, over the driving defaults (096/07).
 *
 * The turn caps go because they exist for a CAR: `maxTurnDeg` 35 is what a saloon can take at a cruise, and
 * a person turns a street corner on the spot. Left at the driving numbers, a walk route would refuse every
 * junction and only ever walk straight lines — the one shape a city walk should not be.
 */
const WALK_ROUTE: Partial<RouteConstraints> = {
  laneOffset: WALK_LANE_OFFSET,
  maxTurnDeg: 100,
  maxWindowTurnDeg: 200,
  preferTurnDeg: 40,
};

/**
 * What a fly route asks of the graph, over the driving defaults.
 *
 * `laneOffset` 0 because a flight is planned over the road's CENTRE — the lane offset exists to put a car in
 * its lane, and a camera 30 m up has no lane. The turn caps go for the walk scene's reason: nothing about a
 * junction is hard for something that is not touching the ground.
 */
const FLY_ROUTE: Partial<RouteConstraints> = {
  laneOffset: 0,
  maxTurnDeg: 100,
  maxWindowTurnDeg: 200,
  preferTurnDeg: 40,
};

/** A flight that has not finished its five passes by now is not going to (ms) — five 10 s passes plus a
 *  generous margin for a stalled tab, so this is a hang guard and never the thing that ends a scene. */
const FLY_SCENE_TIMEOUT_MS = 90000;

/** Seeded routes a walk scene tries before it gives up — each one costs a teleport and a settle, because the
 *  ground under it can only be probed once the world around it has streamed. */
const WALK_ROUTE_TRIES = 3;

/** Everything one scene was seeded with — assembled once, so the report can state what it ran. */
interface SceneContext {
  car: string;
  graph: RouteGraph;
  /** Whether {@link car} came from 096/06's mod ledger — the log says so, and the ledger's share is measured. */
  modCar: boolean;
  /** `?at=x,y`: every scene starts at the graph node nearest this point, so a field round can look at the
   *  SAME hard street repeatedly. Null when the sequencer picks freely. */
  pinned: null | readonly [number, number];
  random: Random;
  /** The region this scene plays in (D2's cycle) — the route filter and the weather pool read the same token. */
  region: City;
  scene: number;
  /** The RUN's master seed, so a staged-scene line can print the scene's own derived one. */
  seed: number;
}

/**
 * The world settings a scene STAGED, carried into its capture.
 *
 * They were only ever in the log prose, which meant a `[video]` report could not say what world it was shot
 * in — and the scene-variety question (does the seeded stream ever deal two neighbours the same car, hour and
 * weather?) is unanswerable from a capture that omits two of the three. The self-describing-capture rule.
 */
interface StagedWorld {
  hour: number;
  /** The weather NAME, or null for a scene that left the weather alone. */
  weather: null | string;
}

/** The black DOM element between scenes, and the only thing that owns it (the 094 single-owner rule). */
interface VideoOverlay {
  /** The run is over: black, with a caption saying so. Nothing lifts this one. */
  end(caption: string): void;
  /** Fade to transparent and resolve once the fade has played out. */
  hide(): Promise<void>;
  /** Instantly black — a scene tears down behind it, never in front of it. */
  show(): void;
}

/** Wire the video runner when the URL asks for it; a no-op otherwise. */
export function setupVideoRuns(host: VideoRunsHost): void {
  const flag = host.params.get('video');
  if (flag === null || flag === '0') {
    return;
  }
  const graph = loadRouteGraph(host.fs);
  if (!graph) {
    // Only `original` ships a path graph; the total conversions have no `data/Paths` at all, so a drive
    // scene cannot exist there. Say so — a silent no-op reads as "video mode is broken".
    log('this game ships no road graph (data/paths/nodes*.dat) — drive scenes need one');

    return;
  }
  // A derived seed is still a REPLAYABLE seed — as long as it is printed, which is the whole of D9. Read
  // for PRESENCE, not truthiness: `?seed=0` is a seed like any other and must not fall through to the clock.
  const asked = host.params.get('seed');
  const seed = asked === null || Number.isNaN(Number(asked)) ? Date.now() >>> 0 : Number(asked);
  // `?car=` pins the car for every scene (a field round comparing streets must not also change the subject);
  // absent, each scene picks one — the build's mod cars when it has any (D10 as revised).
  const pinnedCar = host.params.get('car');
  const roster = roadCarModels(host.fs);
  const modCars = modCarSlots(host.fs);
  // What the pick will actually draw from (D10 as revised 2026-08-03: mod cars ONLY when the build has any).
  // The count is of the INTERSECTION, not of the ledger: a ledger row whose model this build does not carry
  // buys nothing, and a run that says "12 mod slots" while driving stock cars is exactly the report that sent
  // this to the field. Say which pool is in force, so the log answers it without a second run.
  const drivableMods = roster.filter((model) => modCars.has(model));
  const pinned = parsePin(host.params.get('at'));
  const scenes = parseSceneLimit(host.params.get('scenes'));
  // `?scene=N` starts the sequence at N instead of 1 — the only way to reach a scene a field note named
  // without playing the hour in front of it. `scenes` stays a COUNT, and the run still stops at the ceiling.
  const from = parseSceneStart(host.params.get('scene'));
  const last = Math.min(SCENE_LIMIT, from + scenes - 1);
  log(
    `seed=${seed} scenes ${from}-${last} cycle ${REGION_CYCLE.join('→')} ${SHOTS_PER_SCENE} shots/scene · ` +
      `${roster.length} road cars · ` +
      (drivableMods.length > 0
        ? `MOD CARS ONLY: ${drivableMods.length} of ${modCars.size} ledger slots drivable (${drivableMods.join(', ')})`
        : `stock cars (${modCars.size === 0 ? 'no mod-car ledger' : `${modCars.size} ledger slots, none drivable in this build`})`) +
      (pinnedCar ? ` · car pinned to ${pinnedCar}` : '') +
      (pinned ? ` · pinned at ${pinned[0]},${pinned[1]}` : ''),
  );

  const overlay = createOverlay();
  host.setUiHidden(true);
  // `&diag=1`: one full-rate `[diag]` line per scene, for a field report about camera MOTION (the scene
  // report's 10 Hz series cannot see a per-frame one). Off by default — it is a console line per frame's
  // worth of numbers, not something a showcase run should carry.
  const diag = createShiverDiag(host.params.get('diag') === '1');
  void (async (): Promise<void> => {
    // The program is rebuilt each lap from the lap's own seed, so a long run is not the same eight scenes
    // over and over — and `?seed=` still names every one of them.
    const played = await playSequence(from, last, {
      onFailure: (scene, message) => {
        // A scene that failed must SAY so behind its own overlay; a missing line reads as a scene that played.
        overlay.show();
        log(`scene ${scene} failed: ${message}`);
      },
      play: async (scene) => {
        // Name the scene in the address bar before staging it. REPLACE, never push: a 100-scene run would
        // otherwise leave 100 history entries and the back button would walk the reel instead of leaving it.
        // Marked at the START, so a scene that fails leaves the URL pointing at the scene that failed.
        window.history.replaceState(null, '', sceneUrl(window.location.href, seed, scene, last));
        // Per-scene seed off the master (D9), so scene N is the same scene however the run reached it — and
        // `sceneProgramEntry` is a pure function of `(seed, scene)` for the same reason, which is what lets a
        // run start in the middle of the sequence and still play the scene the full run would have.
        const random = mulberry32(sceneSeed(seed, scene));
        const entry = sceneProgramEntry(seed, scene);
        const car = pinnedCar ?? pickCar(random, roster, modCars) ?? DEFAULT_CAR;
        const context: SceneContext = {
          car,
          graph,
          modCar: modCars.has(car),
          pinned,
          random,
          region: entry.region,
          scene,
          seed,
        };
        await sceneOfKind(entry.kind, host, context, overlay, diag);
      },
    });
    // The run ENDS, and says so on screen as well as in the log: a recording's tail must state what it was,
    // and a black frame that simply never changes again is indistinguishable from a hang.
    log(`run complete: ${played} scenes played of ${last - from + 1} (${from}-${last}) from seed ${seed}`);
    overlay.end(`sequence complete · seed ${seed} · ${played} scenes`);
  })();
}

function createOverlay(): VideoOverlay {
  const style = document.createElement('style');
  style.textContent =
    `.opensa-video-overlay{position:fixed;inset:0;background:#000;pointer-events:none;z-index:2147483647;` +
    `opacity:1;transition:opacity ${FADE_MS}ms linear;display:flex;align-items:center;justify-content:center;` +
    `color:#8a8a8a;font:400 14px/1.4 system-ui,sans-serif;letter-spacing:0.08em;text-transform:uppercase}` +
    `.opensa-video-overlay.is-clear{opacity:0}`;
  const element = document.createElement('div');
  element.className = 'opensa-video-overlay';
  document.head.append(style);
  document.body.append(element);

  return {
    end: (caption): void => {
      element.classList.remove('is-clear');
      element.textContent = caption;
    },
    hide: async (): Promise<void> => {
      element.classList.add('is-clear');
      await waitSeconds(FADE_MS / 1000);
    },
    show: (): void => element.classList.remove('is-clear'),
  };
}

/** GTA heading of a step from `from` to `to` (0 faces +Y, counter-clockwise about +Z). */
function headingOf(from: readonly [number, number, number], to: readonly [number, number, number]): number {
  return Math.atan2(-(to[0] - from[0]), to[1] - from[1]);
}

/**
 * Get the player out of whatever he is in, instantly.
 *
 * NOT the press-and-wait exit the phys laps use: a scene tears down behind the overlay and then despawns its
 * car, so an exit the world is allowed to stall would leave the player seated in a car about to be destroyed
 * (measured: a route ending on a freeway overpass hung the climb-out, and every later scene then read a dead
 * body). The climb-out is never on camera here, so it is not part of what a scene owes.
 */
function leaveCar(host: VideoRunsHost, vehicles: EngineVehicles): void {
  host.autopilot.stop(); // hands off the wheel first, or the car drives away from under the exit
  vehicles.leaveInstantly();
}

/** `?at=x,y` → the point every scene's route starts nearest to, or null when the pair is absent/unreadable. */
function parsePin(value: null | string): null | readonly [number, number] {
  if (value === null) {
    return null;
  }
  const [x, y] = value.split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    log(`ignoring ?at=${value} — expected two numbers, "x,y"`);

    return null;
  }

  return [x, y];
}

// eslint-disable-next-line no-console -- the runner's whole progress protocol is this tag (D12: no on-screen status)
const log = (message: string): void => console.log(`[video] ${message}`);

/** The `p`-th percentile of a sample set (0..1), 0 for an empty one. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * A seeded route inside the region, or null when the region gave none in {@link ROUTE_TRIES} tries.
 *
 * Only a route that reached its TARGET length is accepted: one that stopped early is a fragment that runs
 * out of road on camera, and 096/01 measured 45-69 acceptable routes per region per 200 tries, so this is
 * cheap. The rejects are the builder's business, not the scene's.
 */
function pickRoute(
  graph: RouteGraph,
  random: Random,
  inRegion: (x: number, y: number) => boolean,
  targetLength: number,
  pinned: null | readonly [number, number],
  extra?: Partial<RouteConstraints>,
): null | Route {
  // A PINNED start (`?at=x,y`, 096/04) is how a hard case gets looked at deliberately: `video-routes.ts
  // --worst` prints the coordinates of the tightest routes, and this is what takes one of them. The walk is
  // still seeded, so the same pin plus the same seed is the same drive, every time.
  if (pinned) {
    const start = graph.nearest(pinned[0], pinned[1]);
    for (let attempt = 0; start !== undefined && attempt < ROUTE_TRIES; attempt += 1) {
      const route = walkRoute(graph, start, random, { cruiseSpeed: CRUISE_SPEED, inRegion, targetLength, ...extra });
      if (route && route.stop === 'target') {
        return route;
      }
    }
    // Saying so matters: a field round that quietly drove somewhere else would be measuring the wrong street.
    log(`no route out of the pinned start in ${ROUTE_TRIES} tries — this scene takes a seeded one`);
  }
  for (let attempt = 0; attempt < ROUTE_TRIES; attempt += 1) {
    const start = randomNode(
      graph,
      random,
      (node) => !node.boats && node.links.length > 0 && inRegion(node.position[0], node.position[1]),
    );
    if (start === undefined) {
      return null;
    }
    const route = walkRoute(graph, start, random, { cruiseSpeed: CRUISE_SPEED, inRegion, targetLength, ...extra });
    if (route && route.stop === 'target') {
      return route;
    }
  }

  return null;
}

/** A weather index from the scene region's own timecyc set (D7), or null when the game authors none for it. */
function pickWeather(weatherNames: readonly string[], region: City, random: Random): null | number {
  const pool = weatherPool(weatherNames, region);
  if (pool.length === 0) {
    return null;
  }

  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/**
 * The fragment itself: hand the director to the host's own loop, then watch for the end of the scene.
 *
 * The pose is NOT stepped from here. A camera mounted on the car has to be composed from the frame the car is
 * drawn in, and only the host's loop is inside that frame ({@link VideoRunsHost.setVideoStep}); this function
 * owns the fragment's clock and its end conditions, nothing per-frame.
 */
async function playFragment(
  host: VideoRunsHost,
  vehicles: EngineVehicles,
  director: DirectorState,
  supply: StationSupply,
  diag: ShiverDiag,
  timer: StepTimer,
): Promise<string> {
  // A hitch must not teleport the damping: a 400 ms frame would land the eye on its target in one step.
  host.setVideoStep(
    timer.wrap((dt) => poseFrame(host, vehicles, director, supply, Math.min(MAX_FRAME_SECONDS, dt), diag)),
  );
  try {
    for (;;) {
      await nextFrame();
      // The SHOT LIST ends the scene now, not a clock: the fifth shot finishing is what `done` says. A scene
      // therefore runs for as long as its five cameras take, which is the point of the 2026-07-31 model —
      // nothing here, and nothing in a URL, decides a fragment's length any more.
      if (director.done) {
        return 'shots-done';
      }
      const state = host.autopilot.state();
      if (state !== 'following') {
        return state;
      }
    }
  } finally {
    host.setVideoStep(null);
  }
}

/**
 * The walk scene's clock: the shot list ends it, or the walker running out of route does.
 *
 * `walkArrived` is the second end condition and it is NOT a failure — a route sized for five shots is walked
 * in about the time five shots take, and which of the two lands first is a matter of seconds. What it must
 * not do is leave the ped standing still on camera, which is why it ends the scene rather than being waited
 * out.
 */
async function playWalk(
  host: VideoRunsHost,
  director: DirectorState,
  supply: StationSupply,
  diag: ShiverDiag,
  timer: StepTimer,
): Promise<string> {
  host.setVideoStep(timer.wrap((dt) => poseWalkFrame(host, director, supply, Math.min(MAX_FRAME_SECONDS, dt), diag)));
  try {
    for (;;) {
      await nextFrame();
      if (director.done) {
        return 'shots-done';
      }
      if (host.walkArrived()) {
        return 'arrived';
      }
    }
  } finally {
    host.setVideoStep(null);
  }
}

/** One rendered frame of a flight: sample the pass, hand the host the pose, declare the cut. */
function poseFlyFrame(host: VideoRunsHost, flight: FlyState, dt: number): void {
  const frame = stepFlight(flight, dt, (from, to) => host.sphereClear(from, to, CLEARANCE_RADIUS));
  if (!frame) {
    return; // the last pass ended on the previous frame; the pose simply stands until the overlay drops
  }
  host.setVideoCamera(
    {
      eye: host.toEngine(frame.eye),
      fovYRad: frame.fovYRad,
      target: host.toEngine(frame.target),
    },
    frame.cut,
  );
}

/**
 * One rendered frame of the director: pose the shot, hand it to the host, and say nothing when there is no
 * car to film (a despawn mid-teardown) — the last pose then simply stands, which is what a held frame looks
 * like behind the overlay that is already coming down.
 */
function poseFrame(
  host: VideoRunsHost,
  vehicles: EngineVehicles,
  director: DirectorState,
  supply: StationSupply,
  dt: number,
  diag?: ShiverDiag,
): void {
  const car = vehicles.activeVehicle();
  if (!car) {
    return;
  }
  supply.beginFrame();
  const subject: Subject = {
    // The DRAWN position with the GAMEPLAY heading — the pairing the shipped rig already follows a car with
    // (`focus`/`focusHeading` in the host): the heading is at most one fixed step old, which at a cruise yaw
    // rate is a fraction of a degree, while the position must be the interpolated one or the shot judders.
    forward: forwardFromHeading(car.heading),
    halfExtents: car.halfExtents,
    position: host.toEngine([car.renderPosition[0], car.renderPosition[1], car.renderPosition[2]]),
    speed: Math.abs(vehicles.drivenMotion()?.speed ?? 0),
  };
  const frame = stepDirector(director, subject, dt, host.aspect(), supply);
  host.setVideoCamera(frame.pose, frame.cut);
  if (diag?.enabled && frame.pose && frame.screen) {
    diag.record({
      car: subject.position,
      cut: frame.cut,
      eye: frame.pose.eye,
      heading: car.heading,
      renderYaw: yawOfQuat(car.renderOrientation),
      screen: [frame.screen.x, frame.screen.y],
      shot: frame.shot,
      t: performance.now(),
      target: frame.pose.target,
    });
  }
  // The survey runs AFTER the pose, on what is left of the budget: a live sightline is the frame's first
  // claim on it, and a survey is the thing that can always wait one more frame.
  supply.step();
}

/** One rendered frame of a walk scene — the car's {@link poseFrame} with the ped as the subject. */
function poseWalkFrame(
  host: VideoRunsHost,
  director: DirectorState,
  supply: StationSupply,
  dt: number,
  diag?: ShiverDiag,
): void {
  const pose = host.playerPose();
  supply.beginFrame();
  const subject: Subject = {
    forward: forwardFromHeading(pose.heading),
    halfExtents: pose.halfExtents,
    position: pose.position,
    speed: pose.speed,
  };
  const frame = stepDirector(director, subject, dt, host.aspect(), supply);
  host.setVideoCamera(frame.pose, frame.cut);
  if (diag?.enabled && frame.pose && frame.screen) {
    diag.record({
      car: subject.position,
      cut: frame.cut,
      eye: frame.pose.eye,
      heading: pose.heading,
      // A ped has no render orientation of its own to compare against — the drawn facing IS the locomotion
      // heading (`posePlayer`), so the shiver tool's two heading columns are the same signal here.
      renderYaw: pose.heading,
      screen: [frame.screen.x, frame.screen.y],
      shot: frame.shot,
      t: performance.now(),
      target: frame.pose.target,
    });
  }
  supply.step();
}

/**
 * Give the survey its frames before the fragment starts, for a scene whose FIRST shot is a tripod.
 *
 * Bounded by frames, not by an answer: a survey that finds nothing simply stops asking, and the slot plays
 * its fallback exactly as it would have.
 */
async function primeStations(supply: StationSupply): Promise<void> {
  for (let frame = 0; frame < PRIME_FRAMES; frame += 1) {
    supply.beginFrame();
    if (supply.step() === 0) {
      return;
    }
    await nextFrame();
  }
}

/** One `[video] {json}` line per scene — the phys protocol's twin, plus what only an autopilot can report. */
function report(
  host: VideoRunsHost,
  context: SceneContext,
  route: Route,
  frames: readonly TelemetryFrame[],
  settleMs: number,
  ended: string,
  director: DirectorState,
  supply: StationSupply,
  seconds: number,
  stepMs: StepCost,
  staged: StagedWorld,
): void {
  const errors = host.autopilot
    .errorSamples()
    .map(Math.abs)
    .sort((a, b) => a - b);
  const capture = {
    car: context.car,
    // Column-named so a reader never has to count positions; WHERE the car was goes at the END of the row,
    // exactly as the `[phys]` protocol has it.
    columns: [
      't',
      'speed',
      'slipAngle',
      'pitch',
      'roll',
      'yawRate',
      'gLong',
      'gLat',
      'gVert',
      'throttle',
      'steer',
      'x',
      'y',
      'z',
    ],
    /** How far off the driven line the autopilot ever was (m) — 02's own acceptance instrument. */
    crossTrack: {
      max: Number((errors[errors.length - 1] ?? 0).toFixed(3)),
      p50: Number(percentile(errors, 0.5).toFixed(3)),
      p95: Number(percentile(errors, 0.95).toFixed(3)),
      samples: errors.length,
    },
    /** Why the fragment ended: it ran its seconds out, arrived, or the car wedged. */
    ended,
    /** The hour slot this scene was staged in (D6). */
    hour: staged.hour,
    /** Whether the car came from the mod ledger — the ledger's realised share is counted off these. */
    modCar: context.modCar,
    region: context.region,
    route: {
      length: Number(route.length.toFixed(1)),
      maxTurnDeg: Number(route.maxTurnDeg.toFixed(1)),
      minCurveRadius: Number(route.minCurveRadius.toFixed(1)),
      points: route.points.length,
      progress: Number(host.autopilot.progress().toFixed(3)),
      start: route.points[0].position.map((value) => Number(value.toFixed(1))),
    },
    scene: context.scene,
    /** How long the scene actually RAN (s) — an outcome now, not an input: the five shots decide it. */
    seconds: Number(seconds.toFixed(2)),
    series: thinFrames(frames, SERIES_HZ).map((frame) =>
      [
        frame.t,
        frame.speed,
        frame.slipAngle,
        frame.pitch,
        frame.roll,
        frame.yawRate,
        frame.gLong,
        frame.gLat,
        frame.gVert,
        frame.throttle,
        frame.steer,
        frame.position[0],
        frame.position[1],
        frame.position[2],
      ].map((value) => Number(value.toFixed(4))),
    ),
    seriesHz: SERIES_HZ,
    /** How long the fps stability gate held the overlay down (ms) — the cold-teleport cost, measured. */
    settleMs: Number(settleMs.toFixed(0)),
    /** What the director did (096/03): the dealt list, the cuts it fired, and the acceptance number —
     *  `safe` is the share of DIRECTED frames the car sat inside the safe frame (chase frames are the rig's
     *  framing, so they are not judged here). */
    shots: {
      /** What ended each shot — `scheduled` is its own clock, the rest are the guard (096/04). */
      causes: director.causes,
      cuts: director.cuts,
      judged: director.framesJudged,
      list: director.plan.map((entry) => `${entry.preset.name}:${entry.seconds.toFixed(1)}`),
      panClips: director.panClips,
      safe: Number((director.framesJudged === 0 ? 0 : director.safeFrames / director.framesJudged).toFixed(3)),
    },
    /** The tripod survey (096/04): what it filled, what it rejected, and what it cost per frame. */
    stations: {
      ...supply.ledger(),
      /** Candidate spots a PLANTED shot stepped over because the line to the car was blocked (096/09).
       *  0 means every authored spot was clear — the assumption 09 exists to stop making. */
      blockedPlants: director.blockedPlants,
      /** Tripod slots that played a car-anchored stand-in because no candidate passed — and, since 096/09,
       *  planted shots given up because every spot they could reach was inside something. */
      fallbacks: director.fallbacks,
      predictionErrorMax: Number(supply.ledger().predictionErrorMax.toFixed(1)),
    },
    /** What the module's own per-frame work cost inside the host loop (ms) — 096/08's benchmark. */
    stepMs,
    summary: summarisePhysFrames(frames),
    /** The weather this scene was staged in (D7), or null when it left the weather alone. */
    weather: staged.weather,
  };
  // eslint-disable-next-line no-console -- the capture deliverable IS this JSON line (the [phys] twin)
  console.log('[video]', JSON.stringify(capture));
}

/** A fly scene's `[video] {json}` line: what was planned, what flew, and what it cost to find out. */
function reportFly(
  context: SceneContext,
  route: Route,
  passes: readonly FlyPass[],
  planned: number,
  casts: number,
  settleMs: number,
  seconds: number,
  flight: FlyState,
  stepMs: StepCost,
  staged: StagedWorld,
): void {
  const capture = {
    /** The LIVE guard (096/07 B task 6): probes fired at 1 Hz, and how many found something to climb over.
     *  The acceptance number is `hits` — a staged flight that was cleared properly should not need the
     *  guard at all, so a non-zero count is the staging check being wrong about something. */
    guard: { hits: flight.guardHits, probes: flight.guardProbes },
    hour: staged.hour,
    kind: 'fly',
    passes: {
      /** Clearance casts spent at staging — all of them behind the overlay. */
      casts,
      /** What each pass had to be lifted by to clear the city (m) — 0 is a pass that was clear as planned. */
      lifts: passes.map((pass) => pass.lifted),
      list: passes.map((pass) => pass.preset.name),
      planned,
      rejected: planned - passes.length,
    },
    region: context.region,
    route: {
      length: Number(route.length.toFixed(1)),
      points: route.points.length,
      start: route.points[0].position.map((value) => Number(value.toFixed(1))),
    },
    scene: context.scene,
    seconds: Number(seconds.toFixed(2)),
    settleMs: Number(settleMs.toFixed(0)),
    /** What the module's own per-frame work cost inside the host loop (ms) — 096/08's benchmark. */
    stepMs,
    weather: staged.weather,
  };
  // eslint-disable-next-line no-console -- the capture deliverable IS this JSON line (the [phys] twin)
  console.log('[video]', JSON.stringify(capture));
}

/** A walk scene's `[video] {json}` line — the drive report without the half of it that needs a car. */
function reportWalk(
  context: SceneContext,
  route: Route,
  path: WalkPath,
  settleMs: number,
  ended: string,
  director: DirectorState,
  supply: StationSupply,
  seconds: number,
  stepMs: StepCost,
  staged: StagedWorld,
): void {
  const capture = {
    ended,
    hour: staged.hour,
    kind: 'walk',
    region: context.region,
    route: {
      length: Number(route.length.toFixed(1)),
      maxTurnDeg: Number(route.maxTurnDeg.toFixed(1)),
      points: route.points.length,
      /** How much of the route the ground probe could actually judge (the streamed collision's reach). */
      probed: path.checked,
      start: route.points[0].position.map((value) => Number(value.toFixed(1))),
    },
    scene: context.scene,
    seconds: Number(seconds.toFixed(2)),
    settleMs: Number(settleMs.toFixed(0)),
    shots: {
      causes: director.causes,
      cuts: director.cuts,
      judged: director.framesJudged,
      list: director.plan.map((entry) => `${entry.preset.name}:${entry.seconds.toFixed(1)}`),
      panClips: director.panClips,
      safe: Number((director.framesJudged === 0 ? 0 : director.safeFrames / director.framesJudged).toFixed(3)),
    },
    stations: {
      ...supply.ledger(),
      blockedPlants: director.blockedPlants,
      fallbacks: director.fallbacks,
      predictionErrorMax: Number(supply.ledger().predictionErrorMax.toFixed(1)),
    },
    /** What the module's own per-frame work cost inside the host loop (ms) — 096/08's benchmark. */
    stepMs,
    weather: staged.weather,
  };
  // eslint-disable-next-line no-console -- the capture deliverable IS this JSON line (the [phys] twin)
  console.log('[video]', JSON.stringify(capture));
}

/**
 * A flythrough scene: five aerial passes over one neighbourhood, and nobody on screen (096/07 B, D3).
 *
 * The player is teleported to the route start and left standing there, out of every frame — he is the
 * streaming anchor, and that is his whole job in this scene. Which is also why `fly.ts` caps the flight's
 * extent: the ring is around HIM, and a camera that outran it would film the empty world.
 *
 * There is no director here. The director frames a SUBJECT — anchors, lead room, an empty-frame guard — and
 * a flight has none: its eye is a spline sample and its look point travels the ground line ahead of it. Bolt
 * the flight onto the director and every one of those instruments would be measuring a car that is not there.
 */
async function runFlyScene(host: VideoRunsHost, context: SceneContext, overlay: VideoOverlay): Promise<void> {
  overlay.show();
  const boxes = host.cityBoxes();
  const inRegion = (x: number, y: number): boolean => cityAt(x, y, boxes) === context.region;
  const hour = HOUR_SLOTS[Math.min(HOUR_SLOTS.length - 1, Math.floor(context.random() * HOUR_SLOTS.length))];
  const weather = pickWeather(host.weatherNames, context.region, context.random);
  host.setHour(hour);
  if (weather !== null) {
    host.setWeather(weather);
  }
  // A flight needs a LINE through the city, not a drive: the route is only the ground the passes are planned
  // over, so it is asked for the extent cap's worth of road and never more.
  const route = pickRoute(context.graph, context.random, inRegion, FLY_MAX_EXTENT, context.pinned, FLY_ROUTE);
  if (!route) {
    throw new Error(`no fly route inside ${context.region} in ${ROUTE_TRIES} tries`);
  }
  const anchor = route.points[0].position;
  host.teleportPlayer([anchor[0], anchor[1], anchor[2] + 1]);
  await waitSeconds(TELEPORT_NOTICE_SECONDS);
  await until(() => host.getStream()?.pendingCells === 0, host.settleTimeoutMs);
  await waitSeconds(WARMUP_SECONDS);

  const planned = planFlight(route, context.random, anchor);
  // Clearance runs behind the overlay, where casts are free — the live guard below is one probe a second.
  const { casts, passes } = clearFlight(planned, (from, to) => host.pathClear(from, to, undefined));
  log(
    `scene ${context.scene} seed=${sceneSeed(context.seed, context.scene)} region=${context.region} kind=fly ` +
      `hour=${hour} weather=${weather === null ? 'unchanged' : host.weatherNames[weather]} ` +
      `route=${route.length.toFixed(0)}m passes ${passes.map((pass) => pass.preset.name).join('→')} ` +
      `(${planned.length - passes.length} rejected, ${casts} clearance casts)`,
  );
  if (passes.length === 0) {
    throw new Error(`every aerial pass over ${context.region} was blocked`);
  }

  const settleMs = await waitForStableFrames();
  const flight = createFlight(passes);
  const timer = createStepTimer();
  try {
    poseFlyFrame(host, flight, 0);
    await overlay.hide();
    const started = performance.now();
    host.setVideoStep(timer.wrap((dt) => poseFlyFrame(host, flight, Math.min(MAX_FRAME_SECONDS, dt))));
    await until(() => flight.done, FLY_SCENE_TIMEOUT_MS);
    const seconds = (performance.now() - started) / 1000;
    overlay.show();
    host.setVideoCamera(null, true);
    reportFly(context, route, passes, planned.length, casts, settleMs, seconds, flight, timer.cost(), {
      hour,
      weather: weather === null ? null : host.weatherNames[weather],
    });
  } finally {
    host.setVideoStep(null);
  }
}

/** One fragment: stage it black, play it, report it. */
async function runScene(
  host: VideoRunsHost,
  context: SceneContext,
  overlay: VideoOverlay,
  diag: ShiverDiag,
): Promise<void> {
  const vehicles = host.getVehicles();
  if (!vehicles) {
    throw new Error('no vehicle system on this host');
  }
  overlay.show();
  const boxes = host.cityBoxes();
  const inRegion = (x: number, y: number): boolean => cityAt(x, y, boxes) === context.region;
  // The shot list is dealt BEFORE the route, because it is what says how much road the scene needs: five
  // cameras, each worth its own stretch of driving. A scene is as long as its shots (user, 2026-07-31), so
  // nothing here knows its duration until it has played.
  const plan = planShots(context.random);
  const route = pickRoute(
    context.graph,
    context.random,
    inRegion,
    SCENE_ROAD_SECONDS * CRUISE_SPEED * ROUTE_MARGIN,
    context.pinned,
  );
  if (!route) {
    throw new Error(`no route inside ${context.region} in ${ROUTE_TRIES} tries`);
  }
  const hour = HOUR_SLOTS[Math.min(HOUR_SLOTS.length - 1, Math.floor(context.random() * HOUR_SLOTS.length))];
  const weather = pickWeather(host.weatherNames, context.region, context.random);
  // One self-describing line per staged scene (the self-describing-capture rule applied to scenes): everything
  // the seed decided, before anything is driven, so a field note names a scene the next run can reproduce.
  log(
    `scene ${context.scene} seed=${sceneSeed(context.seed, context.scene)} region=${context.region} kind=drive ` +
      `car=${context.car}${context.modCar ? '(mod)' : ''} hour=${hour} ` +
      `weather=${weather === null ? 'unchanged' : host.weatherNames[weather]} ` +
      `route=${route.length.toFixed(0)}m corner=${route.minCurveRadius.toFixed(1)}m ` +
      `shots ${plan.map((entry) => entry.preset.name).join('→')}`,
  );

  // On foot BEFORE the teleport, always: a seated rider is re-placed on his seat every fixed step, so
  // teleporting one drags him back into the car he is in (the phys laps lost four runs to exactly this).
  leaveCar(host, vehicles);
  host.setHour(hour);
  if (weather !== null) {
    host.setWeather(weather);
  }
  const start = route.points[0].position;
  const heading = headingOf(start, route.points[1].position);
  // The ped waits to the car's RIGHT of the road heading, so the spawn never lands on top of him.
  const beside: [number, number, number] = [
    start[0] + Math.cos(heading) * PED_OFFSET,
    start[1] + Math.sin(heading) * PED_OFFSET,
    start[2] + 1,
  ];
  host.teleportPlayer(beside);
  // The three-part settle, all of it the phys recipe: the driver needs a moment to even NOTICE the teleport
  // (`pendingCells` still answers for the ring he left), then the ring drains, then the collision behind it.
  await waitSeconds(TELEPORT_NOTICE_SECONDS);
  await until(() => host.getStream()?.pendingCells === 0, host.settleTimeoutMs);
  await waitSeconds(WARMUP_SECONDS);
  // A seeded paint from the car's OWN `carcols` combos: a stock car that appears twice in a run should not be
  // the same colour twice. A model that authors none spawns in its default (the combos list is empty).
  const combos = await host.colourCombos(context.car);
  const colour =
    combos.length === 0
      ? undefined
      : combos[Math.min(combos.length - 1, Math.floor(context.random() * combos.length))].join(',');
  const despawn = await spawnWithRetry(host, context.car, start, heading, colour);
  try {
    host.teleportPlayer(beside); // back beside the spot: the ped may have slid while the car built
    vehicles.seatInstantly();
    // The distance check is what catches a scene that seated the player in a PARKED car standing nearby —
    // `seatInstantly` takes the nearest one in range, and a street corner is where cars are parked.
    const seated = await until(() => seatedAt(vehicles, start), ENTER_TIMEOUT_S * 1000);
    if (!seated) {
      throw new Error(`could not seat the player in the ${context.car} at the route start`);
    }
    await waitSeconds(SETTLE_SECONDS);

    // The fps gate is the last thing before the overlay lifts: the cold-teleport spike (plan 091, ~20 frames
    // of 110-170 ms) is real, unfixed, and the one thing a viewer would notice in the first second of a shot.
    const settleMs = await waitForStableFrames();
    vehicles.telemetry.reset();
    vehicles.telemetry.enabled = true;
    host.autopilot.follow(route);
    const director = createDirector(plan);
    // The survey reads the SAME seeded stream as the shot list, so a replay picks the same candidate order.
    const supply = createStationSupply({
      carGta: (): readonly [number, number, number] => vehicles.activeVehicle()?.position ?? start,
      carSpeed: (): number => Math.abs(vehicles.drivenMotion()?.speed ?? 0),
      cursor: (): number => host.autopilot.progress() * (route.points.length - 1),
      excludeBody: (): number | undefined => vehicles.activeVehicle()?.body,
      probes: {
        groundBelow: (at, maxDrop): null | number => host.groundBelow(at, maxDrop),
        pathClear: (from, to, exclude): boolean => host.pathClear(from, to, exclude),
      },
      random: context.random,
      route,
      toEngine: (gta): [number, number, number] => host.toEngine(gta),
      upcoming: () => nextStationSlot(director),
    });
    // If the scene OPENS on a tripod, its survey happens here — behind the overlay, where casts are free and
    // there is no preceding shot to amortise them over.
    await primeStations(supply);
    // Compose the opening shot BEFORE the overlay lifts. Staged after it, the fragment would open on the
    // chase rig and cut one frame later — a cut INSIDE the footage, which is exactly what the user's manual
    // edit is not supposed to have to find.
    poseFrame(host, vehicles, director, supply, 0, diag);
    await overlay.hide();
    // WHY it ended is read INSIDE the loop, before the stop. Reading it after `stop()` made every early end
    // report `idle`, and a real `stuck` — a scene that started on an 18° hill the car could not climb — hid
    // behind that for a whole headless run.
    const started = performance.now();
    const timer = createStepTimer();
    const ended = await playFragment(host, vehicles, director, supply, diag, timer);
    const seconds = (performance.now() - started) / 1000;
    overlay.show();
    host.setVideoCamera(null, true); // the rig takes its frame back, and that hand-over is a declared cut
    host.autopilot.stop();
    vehicles.telemetry.enabled = false;
    report(
      host,
      context,
      route,
      vehicles.telemetry.frames(),
      settleMs,
      ended,
      director,
      supply,
      seconds,
      timer.cost(),
      {
        hour,
        weather: weather === null ? null : host.weatherNames[weather],
      },
    );
    diag.dump(context.scene);
    // D15's tripwire: a route is built inside ONE region precisely so `CityZoneSystem` never fires its 6 s
    // weather rewrite on camera. If the target moved anyway, the route leaked across a boundary — say which
    // scene, or a fade nobody expected becomes a mystery in the footage.
    if (weather !== null && host.getWeather() !== weather) {
      log(
        `scene ${context.scene} weather changed mid-scene: ${host.weatherNames[weather]} → ` +
          `${host.weatherNames[host.getWeather()]} — the route left ${context.region}`,
      );
    }
    // A scene's normal end is its SHOT LIST finishing (D1/D4 as revised 2026-07-31). This line is for the
    // other ends — a wedged car, an autopilot that went idle — and it said `ran-out`, the clock-driven end
    // condition the revision deleted, so every healthy scene since has logged itself as ending early. Caught
    // by reading 08's own benchmark log, which is the only place it showed: nothing asserts on log prose.
    if (ended !== 'shots-done') {
      log(
        `scene ${context.scene} ended early: ${ended} at ${(host.autopilot.progress() * 100).toFixed(0)}% of the route`,
      );
    }
    leaveCar(host, vehicles);
  } finally {
    despawn(); // the scene owns this car; nothing respawns it and nothing inherits it
  }
}

/**
 * A walk scene: the same staging, the same director, a person instead of a car (096/07, D3).
 *
 * What it does NOT do is as deliberate as what it does. There is no vehicle anywhere in it — no spawn, no
 * seating, no telemetry — so the whole car half of the drive scene simply is not here; and the route's own
 * per-vertex speeds still matter, because they are what the station survey predicts the SUBJECT's position
 * from, which is why the route is built at the ped's real walking speed rather than a driving one.
 *
 * The route is picked, staged and probed up to {@link WALK_ROUTE_TRIES} times: whether a route is walkable
 * can only be asked of streamed collision, and collision streams around the player, so the question costs a
 * teleport and a settle every time it is asked.
 */
async function runWalkScene(
  host: VideoRunsHost,
  context: SceneContext,
  overlay: VideoOverlay,
  diag: ShiverDiag,
): Promise<void> {
  overlay.show();
  const boxes = host.cityBoxes();
  const inRegion = (x: number, y: number): boolean => cityAt(x, y, boxes) === context.region;
  const plan = planShots(context.random, WALK_SHOTS);
  const hour = HOUR_SLOTS[Math.min(HOUR_SLOTS.length - 1, Math.floor(context.random() * HOUR_SLOTS.length))];
  const weather = pickWeather(host.weatherNames, context.region, context.random);
  const speed = host.walkSpeed();
  host.setHour(hour);
  if (weather !== null) {
    host.setWeather(weather);
  }

  let route: null | Route = null;
  let path: null | WalkPath = null;
  for (let attempt = 0; attempt < WALK_ROUTE_TRIES && path === null; attempt += 1) {
    const candidate = pickRoute(
      context.graph,
      context.random,
      inRegion,
      SCENE_ROAD_SECONDS * speed * ROUTE_MARGIN,
      context.pinned,
      // `cruiseSpeed` is the ped's, and it is NOT cosmetic: the route's per-vertex speeds are what the
      // station survey predicts the subject's position from. Left at the driving default, the survey expects
      // a 15 s window to cover 180 m of pavement instead of 30 and rejects every candidate on dwell — which
      // is exactly what the first headless run measured (8 of 8 rejected, the tripod never filled).
      { ...WALK_ROUTE, cruiseSpeed: speed },
    );
    if (!candidate) {
      throw new Error(`no walk route inside ${context.region} in ${ROUTE_TRIES} tries`);
    }
    const start = candidate.points[0].position;
    host.teleportPlayer([start[0], start[1], start[2] + 1]);
    await waitSeconds(TELEPORT_NOTICE_SECONDS);
    await until(() => host.getStream()?.pendingCells === 0, host.settleTimeoutMs);
    await waitSeconds(WARMUP_SECONDS);
    const probed = walkWaypoints(candidate, (at, maxDrop) => host.groundBelow(at, maxDrop), host.collisionRadius());
    if (probed.points.length === 0) {
      // The rejection SAYS which point and how much of the route was judged: a walk scene that quietly took
      // its third route would hide a region where every pavement probe misses.
      log(
        `scene ${context.scene} walk route rejected: no ground under waypoint ${probed.miss} ` +
          `of ${probed.checked} probed (attempt ${attempt + 1}/${WALK_ROUTE_TRIES})`,
      );
      continue;
    }
    route = candidate;
    path = probed;
  }
  if (!route || !path) {
    throw new Error(`no walkable route inside ${context.region} in ${WALK_ROUTE_TRIES} staged tries`);
  }

  log(
    `scene ${context.scene} seed=${sceneSeed(context.seed, context.scene)} region=${context.region} kind=walk ` +
      `hour=${hour} weather=${weather === null ? 'unchanged' : host.weatherNames[weather]} ` +
      `route=${route.length.toFixed(0)}m gait=walk@${speed}m/s probed=${path.checked}/${route.points.length} ` +
      `shots ${plan.map((entry) => entry.preset.name).join('→')}`,
  );

  const settleMs = await waitForStableFrames();
  const director = createDirector(plan);
  const cursorAt = createWalkCursor(route.points);
  const supply = createStationSupply({
    carGta: (): readonly [number, number, number] => host.playerPose().gta,
    carSpeed: (): number => host.playerPose().speed,
    cursor: (): number => cursorAt(host.playerPose().gta),
    // Nothing to exclude: the sightline aims at the PED, and the ped is not a body the world casts against
    // the way a spawned car is — the capsule is kinematic and the probe already starts outside it.
    excludeBody: (): number | undefined => undefined,
    laterals: WALK_STATION_LATERALS,
    probes: {
      groundBelow: (at, maxDrop): null | number => host.groundBelow(at, maxDrop),
      pathClear: (from, to, exclude): boolean => host.pathClear(from, to, exclude),
    },
    random: context.random,
    route,
    survey: WALK_SURVEY_DEFAULTS,
    toEngine: (gta): [number, number, number] => host.toEngine(gta),
    upcoming: () => nextStationSlot(director),
  });
  try {
    host.walkPath(path.points, 'walk');
    await primeStations(supply);
    poseWalkFrame(host, director, supply, 0, diag);
    await overlay.hide();
    const started = performance.now();
    const timer = createStepTimer();
    const ended = await playWalk(host, director, supply, diag, timer);
    const seconds = (performance.now() - started) / 1000;
    overlay.show();
    host.setVideoCamera(null, true);
    reportWalk(context, route, path, settleMs, ended, director, supply, seconds, timer.cost(), {
      hour,
      weather: weather === null ? null : host.weatherNames[weather],
    });
    diag.dump(context.scene);
    if (weather !== null && host.getWeather() !== weather) {
      log(
        `scene ${context.scene} weather changed mid-scene: ${host.weatherNames[weather]} → ` +
          `${host.weatherNames[host.getWeather()]} — the route left ${context.region}`,
      );
    }
  } finally {
    host.walkStop(); // the keyboard gets its ped back whatever happened
  }
}

/** The three scene kinds D3 names, dispatched — the sequencer no longer skips any of them (096/07). */
async function sceneOfKind(
  kind: ProgramEntry['kind'],
  host: VideoRunsHost,
  context: SceneContext,
  overlay: VideoOverlay,
  diag: ShiverDiag,
): Promise<void> {
  if (kind === 'fly') {
    return runFlyScene(host, context, overlay);
  }
  if (kind === 'walk') {
    return runWalkScene(host, context, overlay, diag);
  }

  return runScene(host, context, overlay, diag);
}

/** Seated, settled, and in a car standing at THIS scene's route start. */
function seatedAt(vehicles: EngineVehicles, start: readonly [number, number, number]): boolean {
  const car = vehicles.activeVehicle();
  if (car === null || vehicles.isSettling()) {
    return false;
  }

  return Math.hypot(car.position[0] - start[0], car.position[1] - start[1]) < SPOT_RADIUS;
}

/** Spawn the scene's car, retrying while the ground under the spot is still streaming in. */
async function spawnWithRetry(
  host: VideoRunsHost,
  car: string,
  position: readonly [number, number, number],
  heading: number,
  colour?: string,
): Promise<() => void> {
  const deadline = performance.now() + SPAWN_RETRY_SECONDS * 1000;
  for (;;) {
    try {
      return await host.spawnCar(car, position, heading, colour);
    } catch (error) {
      if (performance.now() >= deadline) {
        throw error;
      }
      await waitSeconds(0.5);
    }
  }
}

/**
 * Hold until the frame rate has settled: {@link STABLE_FRAMES} consecutive frames under
 * {@link STABLE_FRAME_MS}. Returns how long that took (ms), which is the number the ledger wants — the
 * cold-teleport spike is unfixed, so what a scene can honestly promise is that it is over before the shot.
 *
 * Measured here rather than through the bench's sampler on purpose: `takeSamples` is the perf runner's leg
 * collector and clearing it would step on a bench run's own state.
 */
async function waitForStableFrames(): Promise<number> {
  const started = performance.now();
  let previous = started;
  let run = 0;
  while (run < STABLE_FRAMES && performance.now() - started < STABLE_TIMEOUT_S * 1000) {
    await nextFrame();
    const now = performance.now();
    run = now - previous < STABLE_FRAME_MS ? run + 1 : 0;
    previous = now;
  }
  const waited = performance.now() - started;
  if (run < STABLE_FRAMES) {
    log(`frame rate never settled in ${STABLE_TIMEOUT_S}s — starting anyway`);
  }

  return waited;
}
