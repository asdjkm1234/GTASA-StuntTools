import type { OpenedPak, ResidencyView, StreamingHost, StreamStats } from '@opensa/engine';
import type { TimecycSource } from '@opensa/renderware';

import { CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { Engine, FrameSpans, frameSpans, openPakSource, pakTraffic, setupStreaming } from '@opensa/engine';
import {
  createEngineEnvironmentDriver,
  type EngineEnvironmentDriver,
} from '@opensa/game/adapters/engine-environment-driver';
import { describeTimecycSource, resolveTimecycSourceAsync } from '@opensa/renderware';

import type { GtaGround } from '../map/coords';
import type { HeldCommand, KeyBindings, PressedCommand } from '../map/keymap';
import type { CursorPick, MapPose, MapProjection } from '../map/map-camera';
import type { HistoryStats } from '../ops/history';
/**
 * The dispatch host: boot the engine on a canvas, stream the city, run the frame loop, and translate pointer
 * input into camera steps and selections. Plain DOM and engine — React never enters the loop, it only receives
 * a readout a few times a second and hands the board back in through a getter.
 *
 * What it deliberately does NOT use: the game layer's ECS, physics, peds, vehicles or weather simulation. A
 * dispatch map needs the renderer and the streamer, and nothing else — the one game-layer import is the
 * shared config→Environment driver, so the map is lit exactly as the game lights it.
 */
import type { Operations, Selection } from '../ops/types';

import { Beacons } from '../map/beacons';
import { engineToGta, gtaToEngine } from '../map/coords';
import { bindGestures } from '../map/gestures';
import { bindKeys, type KeyboardInput } from '../map/keys';
import {
  CAMERA_FAR,
  groundPoint,
  KEY_PAN_PER_SECOND,
  KEY_TILT_PER_SECOND,
  KEY_TURN_PER_SECOND,
  KEY_ZOOM_PER_SECOND,
  MAP_YAW,
  MapCamera,
} from '../map/map-camera';
import { mountMinimap } from '../map/minimap';
import { SymbologyLayer, warmOverlaySurface, warmTextMetrics } from '../map/overlay-2d';
import { ScreenProjector } from '../map/projection';
import { drawSketches, type MapTool, type Measurement, SketchStore } from '../map/sketch';
import { DEFAULT_TILE_SIZE } from '../map/tiles';
import { UnitModels } from '../map/unit-models';
import { readView, type SharedView, viewOfPose } from '../map/view-link';
import { bootBytes, bootDone, bootStep } from './boot-progress';
import { composeImage } from './capture';
import { buildDemoCity, DEMO_EXTENT, DEMO_REACH } from './demo-city';
import { DISTRICTS } from './districts';
import { createErrorLog } from './error-log';
import { FrameClock } from './frame-clock';
import { type FrameCpuSample, FrameInventory, type InventoryReport, UNNAMED_DISTRICT } from './inventory';
import { openModelSource } from './model-source';
import { DEFAULT_SRC, type PakBase, resolvePakBase } from './pak-source';
import { RenderGate } from './render-gate';
import { bakeFlatMap } from './tile-bake-host';
import { fetchWater, installWater } from './water';
import { type DistrictLookup, loadDistricts, NO_DISTRICTS, type SearchedPlace } from './zones';

export interface BootOptions {
  readonly canvas: HTMLCanvasElement;
  /**
   * Build the pak IO worker (201/2-02). Absent = the engine's module-relative default, which is what every
   * multi-file build wants. A SINGLE-FILE artifact passes one, because the chunk it would resolve to is not
   * beside it — `src/share.tsx` is this repo's own such host.
   */
  readonly createPakWorker?: () => Worker;
  /** How old each unit's last fix is, ms (201/8-02) — absent for a host with no board, whose markers are
   *  then all drawn as fresh. */
  readonly fixAges?: () => ReadonlyMap<string, number>;
  /** The radar's own canvas (201/7-04). Absent for a host that does not want one — an embedded map, or
   *  plan mode, which draws its own board and has no room for an inset. */
  readonly minimap?: HTMLCanvasElement;
  readonly onClick: (click: MapClick) => void;
  /** Right-click: "put a call here". `district` is what the world calls that point (201/5-03) — resolved
   *  here rather than in the board, because the baked table is the map's, and null when the world has none. */
  readonly onGround: (at: GtaGround, district: null | string) => void;
  readonly onReadout: (readout: DispatchReadout) => void;
  /** Live read of the board — called once a frame, so the loop never holds a stale snapshot. */
  readonly ops: () => Operations;
  readonly overlay: HTMLCanvasElement;
  readonly selection: () => Selection;
  /** The time axis's cost and window (201/8-01) — read only by `?inventory=1`, so it is optional and a host
   *  embedding the map without a board simply does not pass it. */
  readonly trackStats?: () => HistoryStats;
  /** Each unit's current leg as GTA `x, y` pairs (201/8-04) — absent for a host embedding the map with no
   *  board, which then simply draws no trails. */
  readonly trails?: () => ReadonlyMap<string, Float32Array>;
}

export interface DispatchHandle {
  readonly camera: MapCamera;
  dispose(): void;
  /**
   * A PNG of the situation: the world and the symbology drawn over it, composed into one image (201/7-07).
   * `null` when there is no world canvas to read — plan mode answers with its own single canvas instead.
   *
   * Resolves on the NEXT frame rather than immediately, and that is not an implementation detail: the two
   * canvases are only in step at the end of a frame, and a naive `toDataURL` of the WebGPU one alone
   * captures a city with no units on it.
   */
  exportImage(): Promise<Blob | null>;
  /** Ease the heading back to north (201/7-06's compass, and the `n` key). */
  faceNorth(): void;
  /**
   * Put every active unit and call in frame at once (201/7-03). A board with nothing on it is left alone
   * rather than flown to the origin.
   */
  fitBoard(): void;
  /** Ride a unit by id; `null` stops. An id the board does not have is the same as stopping. */
  follow(id: null | string): void;
  /** Fly to a searched place, framing its whole box. */
  goToPlace(place: SearchedPlace): void;
  /**
   * The 201/1-01 before-table, or null when `?inventory=1` was not set. Reading it does not stop or reset
   * the collection — the window keeps growing, so a later read is a longer sample of the same run.
   */
  inventory(): InventoryReport | null;
  /** Frame a GTA point at a sensible working height — what "locate" does in the panels. */
  locate(at: GtaGround): void;
  /** The view as it is right now — what a bookmark stores. */
  pose(): MapPose;
  /** Fly back to a saved view: the rig (tilt, heading, projection) is taken at once, the ground is flown. */
  recallView(pose: MapPose): void;
  /** Places whose name matches, from the world's own baked district table (201/5-03's data). */
  searchPlaces(query: string): readonly SearchedPlace[];
  /** Swap in a rebound key map, live — the sheet rebinds while the console is running. */
  setBindings(bindings: KeyBindings): void;
  setHour(hour: number): void;
  /** Perspective or the plan view (201/7-01). The pose in the readout says which is live. */
  setProjection(projection: MapProjection): void;
  /** What a tap on the map does (201/7-05): select, or add a point to a ruler, cordon or circle. */
  setTool(tool: MapTool): void;
  /** Fly to one of the three zoom levels over the point already under the view (201/7-02). */
  setZoomLevel(level: ZoomLevel): void;
  /** Everything a shared link carries about the world half of the view (201/7-07). */
  sharedView(): SharedView;
  /** Drop every shape this session drew. */
  sketchClear(): void;
  /** Close the shape being drawn. A shape with too few points is left alone rather than half-closed. */
  sketchFinish(): void;
  /** Step back one tap, then one whole shape. */
  sketchUndo(): void;
  /** Tilt by this many radians — the on-screen control's step, the same bound as every other tilt. */
  tiltBy(radians: number): void;
  /** Turn the view by this many radians, eased like the compass rather than snapped. */
  turnBy(radians: number): void;
  /** Zoom by whole steps: positive is in, negative is out, and each one is flown rather than jumped. */
  zoomBySteps(steps: number): void;
}

export interface DispatchReadout {
  readonly buildTime: string;
  readonly cellsTotal: number;
  readonly cellsVisible: number;
  /** What the frame COST the main thread, ms — the last drawn loop body. Reported beside `frameMs` because
   *  it is the number that still means something when the map drew one frame in a second and there is no
   *  interval to take (see `frame-clock.ts`). */
  readonly cpuMs: number;
  readonly draws: number;
  /** Whether the view is riding a unit (201/7-03) — the chrome shows it, and it is state rather than an
   *  event because the UI mounts after the boot that started it. */
  readonly following: boolean;
  /** Frames DRAWN in the last second — a count, never `1000 / mean(dt)` (`frame-clock.ts`). */
  readonly fps: number;
  /** The median interval between two consecutive drawn frames in that second, ms; 0 when the window holds
   *  no consecutive pair — a console at rest has no frame time, and inventing one is the old defect. */
  readonly frameMs: number;
  readonly hour: number;
  /** The console is at rest: nothing on screen has changed, so no frame was drawn (201/4-01). The numbers
   *  beside it are the last drawn frame's, which is what a console at rest still has. */
  readonly idle: boolean;
  /** Frames the render gate has skipped since boot — the `idle draws → 0` claim, as a running total. */
  readonly idleFrames: number;
  /** What the sketch in progress (or the last one finished) measures — null until one is drawn (201/7-05). */
  readonly measurement: Measurement | null;
  /** Labels the decluttering could not place this frame (201/3-03). The operator is told rather than left
   *  to believe the map is complete — the SYMBOLS are all there, only the names are missing. */
  readonly namesHidden: number;
  readonly pending: number;
  readonly pose: MapPose;
  readonly residencyMb: number;
  /** The flat map's tile layer, in words (201/6-02): which pyramid level is drawn and how many tiles, or why
   *  none is. Absent on the 3D host, which draws the streamed world instead. */
  readonly tiles?: string;
  /** What a tap on the map currently does. `none` is selection, the console's normal behaviour. */
  readonly tool: MapTool;
}

/** What a click resolved to — the app turns it into a {@link Selection}. */
export type MapClick =
  | {
      readonly at: GtaGround;
      /** The named district the point falls in (201/5-03), or null on a world with no `info.zon`. */
      readonly district: null | string;
      readonly kind: 'world';
      readonly model: string;
      readonly txd: string;
    }
  | { readonly at: GtaGround; readonly kind: 'ground' }
  | { readonly id: string; readonly kind: 'incident' | 'unit' };

/** How deep `?bake=tiles` goes when nothing says otherwise: z0–z4 is 341 tiles, which a phone finishes, and
 *  over San Andreas' 6 km square it is ~1.5 m per tile pixel at the deepest level. */
const DEFAULT_BAKE_MAX_ZOOM = 4;

/** Opening view: high over central Los Santos, north up, steeply tilted so the city still reads as 3D. */
const OPENING_POSE: MapPose = {
  at: [1700, -1500],
  height: 900,
  pitch: -1.15,
  projection: 'perspective',
  yaw: MAP_YAW,
};
/**
 * What "locate" frames: one render cell of ground around the thing being looked at, which is the block
 * level (see {@link zoomSpan}) and the tightest of the three. A unit or a call is a point, so the question
 * is how much of its surroundings an operator needs to place it, and one cell is the smallest unit of world
 * this pak is built out of.
 */
const LOCATE_SPAN = CELL_SIZE;
/** Readout pushes per second. The loop must not re-render React. */
const READOUT_HZ = 4;
/** A world with nothing to stream — the demo's synthetic grid is resident from the start. */
/**
 * How long an IDLE console waits before looking again, ms (201/4-01) — the named latency budget for a change
 * nobody touched: a board tick arriving from the feed, a clock crossing an hour. An operator's own input
 * never waits for it (the pointer/wheel/key handlers re-arm the animation frame directly), so this bounds
 * only the delay on something that happened elsewhere, and 100 ms is under the threshold at which a change
 * stops reading as immediate. PCAD publishes every 4 s, so it is two orders of magnitude inside the rate the
 * data actually arrives at.
 */
export const IDLE_WAKE_MS = 100;

const IDLE_STREAM: StreamStats = {
  blobMs: 0,
  created: 0,
  evicted: 0,
  lateCreates: 0,
  loadedCells: 0,
  pendingCells: 0,
  uploadMs: 0,
  worstBlobMs: 0,
  worstCreateMs: 0,
};

/**
 * What the render gate is shown instead of the board while `?overlay=0` is on — ONE frozen value, compared
 * by identity, so a roster nobody is drawing cannot pace the frames the engine is being judged on.
 */
const NO_BOARD: Operations = { incidents: [], log: [], now: 0, units: [] };

/**
 * What one press of the on-screen zoom control changes the framed span by. Halving and doubling is what a
 * map's `+`/`−` has meant since the first tile server, and it is one notch of the three zoom LEVELS' own
 * spacing rather than a number picked to feel right.
 */
const ZOOM_STEP = 2;
/** Streaming rings. Wider than the game's, because a map view looks at the city rather than at a street. */
const DEFAULT_HD_RADIUS = 450;
const DEFAULT_LOD_RADIUS = 2200;

/**
 * The three zoom levels an operator jumps between (201/7-02), and where each one's SPAN comes from.
 *
 * None of the three is a number somebody liked: each is a thing the world is actually made of, so the same
 * key means the same thing on a total conversion that has never heard of Los Santos.
 *
 * | Level | The span it frames | Read from |
 * | --- | --- | --- |
 * | `block` | one render cell | `CELL_SIZE` — the grid the pak is welded and streamed on |
 * | `district` | the named district under the view | the baked zone box (`districts.json`, 201/5-03) |
 * | `city` | everything the world has around the focus | the world's own reach: the LOD ring, or the demo's extent |
 *
 * **The fallback is derived too.** A world with no zone table has no district box to frame, so the middle
 * level becomes the geometric mean of the other two — zoom levels are logarithmic by nature, so the midpoint
 * of a zoom range is the geometric one, and a level that is missing should still land between its
 * neighbours rather than on top of one.
 */
export type ZoomLevel = 'block' | 'city' | 'district';

/**
 * A world the host can drive, however it was produced. `follow` is called once a frame with the ground point
 * the view sits over and answers how many cells are still in flight — the streamed world moves its rings, the
 * demo world has nothing to move.
 */
interface DispatchWorld {
  /** Let the world go — the pak worker and the streaming (201/6-03). The demo world holds neither. */
  dispose?: () => void;
  /** What the world's places are called (201/5-03) — baked beside the pak, empty on a world that ships no
   *  `info.zon` and on the synthetic demo. */
  districts: DistrictLookup;
  /** Where the world IS and how big it is, GTA — the radar's scale (201/7-04). Taken from the pak's own
   *  cell extent, so a district-sized pak gets a district-sized dial rather than an empty San Andreas. */
  readonly extent: { readonly centre: GtaGround; readonly radius: number };
  /** Called once a frame with the ground point the view sits over, and with the view that is about to be
   *  drawn (201/1-05 — residency is decided against the frustum this frame culls with). Returns the
   *  ENGINE's own streaming numbers — blob-handler and upload milliseconds, creates, evictions — which the
   *  console used to throw away, keeping only `pendingCells`. They are the between-frame half no in-loop
   *  timer can see. */
  follow: (focus: readonly [number, number, number], view: ResidencyView) => StreamStats;
  /** Where `data/` sits, for the game's own tables (timecyc, and the archives a unit's model is read from —
   *  201/5-04). Empty when there is no game dir (the demo). */
  gameDir: string;
  /** What the status bar shows as the world's provenance. */
  label: string;
  /** How far from the view's focus this world actually has content — the LOD ring for a streamed world,
   *  its own extent for the demo. The camera derives both of its bounds from it (201/7-02). */
  readonly reach: number;
}

/**
 * What the pak open produced while the GPU was starting (201/4-03), and what it cost. `openMs` is the whole
 * of it — the `?src=` probe AND the manifest AND the worker's own IO probe — because that is the span the
 * overlap either hid or did not.
 */
interface OpenedWorld {
  /** What the world's places are called — a small loose JSON beside the pak (201/5-03). */
  readonly districts: DistrictLookup;
  readonly openMs: number;
  readonly pak: OpenedPak;
  readonly source: PakBase;
  /** The game's own `data/timecyc.dat`, read beside the pak — it lives on the same server and is not the
   *  pak's business, so it has no reason to wait for it. `null` when the build ships no `data/`. */
  readonly timecyc: null | TimecycSource;
  /** The baked sea, read but not yet installed: 2.66 MB of loose file, and the largest single read the boot
   *  still had on its serial path before this rode the overlap too. `null` when the pak carries none. */
  readonly water: null | Uint8Array;
}

/**
 * One frame of whatever movement keys are held (201/7-06). Rates come from the camera, and every one of
 * them is a rate rather than a step: a key held for twice as long moves twice as far, at any frame rate.
 *
 * Opposite keys held together cancel, which is what a sum does and what an operator expects — the
 * alternative (last key wins) makes a mistyped combination feel like a stuck map.
 */
export function applyHeldKeys(camera: MapCamera, keyboard: KeyboardInput, dtMs: number): void {
  const seconds = Math.max(0, dtMs) / 1000;
  const axis = (positive: HeldCommand, negative: HeldCommand): number =>
    (keyboard.held(positive) ? 1 : 0) - (keyboard.held(negative) ? 1 : 0);

  const east = axis('panEast', 'panWest');
  const north = axis('panNorth', 'panSouth');
  if (east !== 0 || north !== 0) {
    // The two are normalised together, so a diagonal is not faster than a straight line.
    const length = Math.hypot(east, north);
    const step = (KEY_PAN_PER_SECOND * seconds) / length;
    camera.panBySpan(east * step, north * step);
  }
  const turn = axis('rotateRight', 'rotateLeft');
  if (turn !== 0) {
    camera.turnBy(turn * KEY_TURN_PER_SECOND * seconds);
  }
  const tilt = axis('tiltUp', 'tiltDown');
  if (tilt !== 0) {
    camera.tiltBy(tilt * KEY_TILT_PER_SECOND * seconds);
  }
  const zoom = axis('zoomOut', 'zoomIn');
  if (zoom !== 0) {
    camera.zoomBy(KEY_ZOOM_PER_SECOND ** (zoom * seconds));
  }
}

export async function bootDispatch(options: BootOptions): Promise<DispatchHandle> {
  const { canvas, overlay } = options;
  const params = dispatchParams();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  /**
   * Only ASSIGN when the size actually moved.
   *
   * Writing `canvas.width` resets the backing store even when the value is identical — and the
   * `ResizeObserver` below fires once on `observe()`, so the unguarded version threw away the store the boot
   * had just allocated (and every warm done against it) a tick after allocating it. It also cleared both
   * canvases on every observer tick for the rest of the session.
   */
  const resize = (): void => {
    const width = Math.max(2, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(2, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width === width && canvas.height === height) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
    overlay.width = width;
    overlay.height = height;
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  const engine = new Engine();
  /**
   * The GPU and the radio are two different machines, and this boot used them one at a time: `engine.init`
   * measured **2 607.5 ms** on the phone (201/4-03) with the network idle, and only when it returned did the
   * world start looking for its manifest. The pak's engine-free half — probing `?src=`, reading the
   * manifest, spinning the worker onto its IO mode and slice cache — is STARTED here and awaited after the
   * GPU, so the pair costs `max` rather than `sum`.
   *
   * What it costs when the world is the one that fails: the error now arrives after the GPU is up rather
   * than before it. The message is the same one; the wait in front of it is the GPU's, and it is the wait
   * the console pays on every successful boot anyway.
   */
  const bothStart = performance.now();
  const opening =
    params.get('demo') === '1'
      ? null
      : openWorld(params, options.createPakWorker ? { createWorker: options.createPakWorker } : {});
  // A rejection with nobody attached is an unhandled rejection the moment it happens, and nothing is
  // attached until the GPU is up. This one is discarded; the `await` below gets the real error.
  opening?.catch(() => undefined);
  // The phases the shell reports are the ones that actually take time here, in the order they take it. The
  // GPU first: `init` opens the device and compiles all 34 pipelines. That compile is asynchronous and
  // overlapped since 201/4-03, and this is the number that says whether it helped — the capture carries it
  // (`boot.gpuMs`), because a boot cost nobody records is one nobody can argue about.
  bootStep('starting the GPU…');
  const gpuStart = performance.now();
  await engine.init(canvas).catch((error: unknown) => {
    // A GPU that fails here is not the end of the console: `map-canvas` falls back to plan mode and keeps
    // running, so the worker the open beside it produced would sit there for the rest of the session
    // holding its slice cache. Close it when it arrives — which is the price of starting it early, and the
    // only one.
    void opening?.then((world) => world.pak.worker.terminate()).catch(() => undefined);

    throw error;
  });
  const gpuMs = performance.now() - gpuStart;
  // `?scale=` — the same manual knob `apps/web` has, and the only one that moves the `target` category:
  // 36.54 MB of the 2026-08-12 capture's 74.9 MB is scene + bloom targets, which scale with the square of
  // this number. Manual, per the refusal in performance/deferred-optimizations/render-scale-tier.md — the
  // console picks no tier for anybody. The report records it, so a capture says what it was drawn at.
  engine.renderScale = Math.min(1, Math.max(0.5, numberParam(params, 'scale', 1)));
  // Picking must be armed BEFORE the first cell loads — the capability only takes effect on load, and it is
  // what retains the per-placement mapper a click resolves against. It costs memory on a full map (read back
  // as `engine.cells.pickingBytes`, and reported by `?inventory=1`); this app is a map inspector with a
  // dispatch board on top, so it pays that cost by design and says so rather than borrowing a debug switch.
  engine.cells.picking = true;

  // `?demo=1` skips the pak entirely and builds a synthetic block grid, so the console can be driven on a
  // machine with no built game. Everything above the world — camera, beacons, symbology, picking — is the
  // same code path either way; only the geometry's provenance differs.
  bootStep(opening === null ? 'the demo world…' : 'reading the world…');
  const opened = opening === null ? null : await opening;
  // What the overlap was worth on the day, counted rather than claimed: both halves ran between
  // `bothStart` and here, so whatever their durations sum to beyond that wall is time that ran twice over.
  const openMs = opened?.openMs ?? 0;
  const overlapMs = Math.max(0, gpuMs + openMs - (performance.now() - bothStart));
  const world = opened === null ? demoWorld(engine) : await streamedWorld(engine, params, opened);
  const environment = buildEnvironment(engine, opened?.timecyc ?? null, params);
  let hour = numberParam(params, 'hour', 10);
  const applyHour = (next: number): void => {
    hour = next;
    environment.apply(next);
    pushFogOut(engine, params);
  };
  applyHour(hour);

  // Installed before anything else this boot does, because the failures worth catching happen during it.
  const errorLog = createErrorLog();
  const camera = new MapCamera(poseFromQuery(params));
  // The bounds are the world's, not the camera's: how far it may zoom out and how shallow it may tilt both
  // come from how much world there is around the focus (201/7-02).
  camera.setStreamedReach(world.reach);
  const beacons = new Beacons(engine);
  // Units are drawn as CARS under their symbols (201/5-04). The wake is the point of the callback: a model
  // arrives between frames and changes none of the values the render gate compares, so without it the fleet
  // would appear on whatever frame the operator happened to cause next.
  const unitModels = new UnitModels(engine, openModelSource(world.gameDir), () => gate.wake());
  const symbology = new SymbologyLayer();
  const sketch = new SketchStore();
  // A click on the radar is "look over there", not "zoom in on that": the flight keeps the operator's
  // current span, so an overview stays an overview and a street view stays a street view.
  const radar =
    options.minimap === undefined
      ? null
      : mountMinimap(
          options.minimap,
          { boxes: world.districts.boxes, centre: world.extent.centre, radius: world.extent.radius },
          (at) => camera.flyTo(at),
          dpr,
        );
  const projector = new ScreenProjector();
  const context = overlay.getContext('2d');
  if (!context) {
    throw new Error('overlay canvas has no 2d context');
  }
  // Before the loop, never inside it — here both overlap the wait for the pak instead of landing on the
  // first frame. The SURFACE is the expensive one: splitting the span on 2026-08-25 put 212 ms of a 333 ms
  // first frame inside the first `clearRect` and only 22.6 in the first glyph raster, which is why warming
  // the font alone (the first attempt) measured no improvement.
  warmOverlaySurface(context, overlay);
  warmTextMetrics(context);

  /** The symbology block of the report: what the last frame drew, plus how the beacon buffers held up. */
  const symbologyCounts = (): InventoryReport['symbology'] => {
    const ops = options.ops();
    const beaconStats = beacons.stats();

    const models = unitModels.stats();

    return {
      beaconCapacity: beaconStats.capacity,
      beaconGrowths: beaconStats.grownSets,
      incidents: ops.incidents.length,
      modelTextureMb: models.textureBytes / (1024 * 1024),
      modelTypes: models.types,
      units: ops.units.length,
      unitsAsModels: models.drawn,
      unitsAsSymbolOnly: models.withoutModel,
      unitsUnresolvedModels: models.unresolved,
      ...symbology.counted(),
    };
  };

  /** Every point an operator is working right now: units on duty and calls that are still open. */
  const boardPoints = (): readonly GtaGround[] => {
    const ops = options.ops();

    return [
      ...ops.units.map((unit) => unit.at),
      ...ops.incidents.filter((incident) => incident.status !== 'closed').map((incident) => incident.at),
    ];
  };
  /** Ride the selected unit, or stop if already riding — one function, so the key and the button agree. */
  const followSelected = (): void => {
    const selection = options.selection();
    camera.follow(
      camera.following() || selection?.kind !== 'unit'
        ? null
        : () => options.ops().units.find((unit) => unit.id === selection.id)?.at ?? null,
    );
  };

  const gestures = bindInput({ camera, canvas, districts: world.districts, engine, options, sketch, symbology });
  const zoomLevel = (level: ZoomLevel): void =>
    camera.flyTo(camera.positionGta(), zoomSpan(level, camera.positionGta(), world));
  /** The keyboard is bound to the WINDOW, not the canvas: the map is not React's, and a key has to work
   *  wherever the operator's focus happens to be — except in a field, which `bindKeys` guards. */
  const keyboard = bindKeys(window, (command) =>
    runCommand(command, { camera, fit: () => camera.fitBounds(boardPoints()), followSelected, options, zoomLevel }),
  );
  const unbind = (): void => {
    keyboard.unbind();
    gestures();
    for (const event of ['pointerdown', 'wheel'] as const) {
      canvas.removeEventListener(event, wake);
    }
    window.removeEventListener('keydown', wake);
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  // 201/1-01. Off unless asked for: draining the span recorder is cheap, but a mode that measures by default
  // is a mode nobody can trust to have measured nothing.
  const inventory = params.get('inventory') === '1' ? new FrameInventory() : null;
  /**
   * Draw the WORLD and nothing over it — `?overlay=0`.
   *
   * The field round of 2026-08-30 put `overlay-2d` at 2.37 ms of CPU against `engine-frame`'s 0.57 on a
   * phone at 150 units, and 5.53 against 1.67 on a continuously drawing one: a frame on this console is
   * mostly its symbology and hardly its engine. Every number the streaming and texture work is judged on
   * has to come off a frame that is not paying that tax, and the only honest way to get one is to STOP
   * DRAWING IT — subtracting the segment afterwards would credit the engine with work the GPU still did.
   *
   * It turns off what is drawn over the map (the symbol pass, the chips, the sketches, the radar) and the
   * per-frame update that feeds them. The layers themselves are still CONSTRUCTED, so this is the draw cost
   * and never the allocation — a capture taken with it says which one it measured.
   */
  const overlayOn = params.get('overlay') !== '0';
  // A SECOND span recorder, deliberately not the shared `frameSpans`. That one is for work between frames,
  // and a span opened inside the loop body would be subtracted from `dt` twice
  // (restrictions/architecture.md). Nobody subtracts this one from anything: it is the CPU-side proxy for a
  // device with no `timestamp-query`, and it only runs when the mode is on.
  const loopCpu = new FrameSpans();
  const time = <T>(name: string, run: () => T): T => (inventory ? loopCpu.measure(name, run) : run());
  /**
   * Render on demand (201/4-01). The gate decides whether a wake draws; the SCHEDULE decides how soon the
   * next wake is. While the picture is changing the loop rides `requestAnimationFrame`; while it is not, it
   * drops to a timer, which is what stops a still city being redrawn sixty times a second on a phone.
   */
  /**
   * The last phase the boot shell reports, and the moment it leaves.
   *
   * **It leaves when there is a PICTURE, not when `bootDispatch` returns.** Boot resolves as soon as the
   * streaming is wired, which is before the first cell has arrived — removing the shell there would hand the
   * operator an empty map and call it ready. So this waits for a drawn frame that has world in it, and the
   * fraction it shows on the way is a real one: cells resident out of the cells the district holds.
   *
   * The escape hatches matter as much as the rule. A pak with no cells (plan mode, the flat map, an empty
   * rect) would never satisfy the condition, and a district whose first cell is slow should not hold the
   * shell forever — so a drawn frame with `cellsTotal` 0 releases it, and so does the 40th frame whatever
   * the world is doing. Nothing here can leave the shell up.
   */
  let bootFrames = 0;
  const reportBoot = (stats: { cellsTotal: number; cellsVisible: number }): void => {
    if (bootFrames < 0) {
      return;
    }
    bootFrames += 1;
    if (stats.cellsTotal === 0 || stats.cellsVisible > 0 || bootFrames > 40) {
      bootFrames = -1;
      bootDone();

      return;
    }
    // The cached share is on the shell rather than only in a capture: on a phone it is the only place an
    // operator can see that a second open really is reading off the disk (201/4-03).
    const cached = pakTraffic.cachedBytes > 0 ? ` · ${bootBytes(pakTraffic.cachedBytes)} cached` : '';
    bootStep(
      'streaming the world…',
      stats.cellsVisible,
      stats.cellsTotal,
      `${bootBytes(pakTraffic.totalBytes)} read${cached}`,
    );
  };

  /** How many more overlay draws are broken into named steps — see the split inside `overlay-2d` below. */
  let overlayDetail = 3;
  const gate = new RenderGate();
  let idleTimer: null | ReturnType<typeof setTimeout> = null;
  const schedule = (idle: boolean): void => {
    if (disposed) {
      return;
    }
    if (idle) {
      /**
       * The handle is dropped as the timer FIRES, and that is the whole of it.
       *
       * It used to be `setTimeout(loop, …)`, so after every idle wake that drew, `idleTimer` kept a handle
       * to a timer that had already run. `wake()` reads that handle as "an idle wake is pending", clears the
       * corpse and arms a `requestAnimationFrame` — on top of the one the drawn frame had already armed. Two
       * entries into the loop for one displayed frame, the second arriving 0-2 ms after the first.
       *
       * It is invisible in every way that matters: nothing errors, the picture is correct, and the second
       * entry usually draws nothing because the gate compares values. It shows up only in a capture, as
       * frames faster than a vsync interval — 192 of them under 8 ms in
       * [the overlay A/B](../../../../docs/benchmarks/opensa-engine/2026-08-30-mobile-overlay-ab-150u.json),
       * which is where it was found. What it costs is a whole loop prologue each time (the held keys, the
       * camera advance, the gate) plus the wake-up itself, on the device where that is battery.
       */
      idleTimer = setTimeout(() => {
        idleTimer = null;
        loop();
      }, IDLE_WAKE_MS);
    } else {
      requestAnimationFrame(loop);
    }
  };
  /**
   * An input re-arms the fast schedule in its own handler, so the FIRST frame after a thumb lands is the
   * next animation frame rather than the next idle wake. The gate would find the change anyway — a pose is
   * a value it compares — but it would find it up to {@link IDLE_WAKE_MS} late, and a map that feels sticky
   * under the thumb has failed whatever it saves.
   */
  const wake = (): void => {
    gate.wake();
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
      requestAnimationFrame(loop);
    }
  };
  for (const event of ['pointerdown', 'wheel'] as const) {
    canvas.addEventListener(event, wake, { passive: true });
  }
  window.addEventListener('keydown', wake, { passive: true });
  /**
   * A capture waiting for the end of a frame (201/7-07). The two canvases are only in step there: the
   * WebGPU one holds a frame's world until the next one starts, and the overlay holds the symbology drawn
   * for THAT world. Reading either at an arbitrary moment gives a city with no units, or units over a
   * city that has moved.
   */
  let pendingCapture: ((image: Blob | null) => void) | null = null;
  let bodyMs = 0;
  /**
   * The last DRAWN pass's body, ms — which is not the same variable as `bodyMs`.
   *
   * A skipped wake also runs a body (the held keys, the camera advance, the gate) and it costs ~0.1 ms, so
   * reporting `bodyMs` put a wake's cost on screen as a frame's the moment the console had rested once. The
   * readout reads this one; the frame cost it names has to be a frame's.
   */
  let drawnBodyMs = 0;
  /** The streaming stats of the last DRAWN frame — what an idle wake compares against (201/4-01). */
  let lastStream: StreamStats = IDLE_STREAM;
  /** Whether the chrome has already been told the console is idle; one readout, not one per skipped frame. */
  let idleReported = false;
  /** The last readout sent, so going idle can re-send it marked idle rather than inventing a frame's worth
   *  of zeroes — a console at rest still has the cells, the residency and the pose it stopped at. */
  let lastPayload: DispatchReadout | null = null;
  const reportIdle = (): void => {
    if (lastPayload !== null) {
      options.onReadout({ ...lastPayload, idle: true });
    }
  };
  /** What the readout's fps and frame time are counted from — DRAWN frames only (`frame-clock.ts`). */
  const frameClock = new FrameClock();
  let disposed = false;
  let lastReadout = 0;
  let previous = performance.now();

  /** The tile bake owns the canvas while it runs (201/6-02) — it resizes the drawing buffer and drives the
   *  camera itself, and a live frame in the middle of that would render a tile at the wrong size. */
  let baking = false;

  const loop = (): void => {
    if (disposed) {
      return;
    }
    if (baking) {
      requestAnimationFrame(loop);

      return;
    }
    const now = performance.now();
    const dt = now - previous;
    previous = now;
    // Drained BEFORE this frame opens a segment of its own, so what comes out is the PREVIOUS body — the
    // work that actually ran inside the `dt` interval about to be reported.
    const cpu: FrameCpuSample = { bodyMs, canvasPixels: canvas.width * canvas.height, segments: loopCpu.drain() };

    const ops = options.ops();
    const aspect = canvas.width / Math.max(1, canvas.height);
    // Before the state is read, so the streamer follows where the held keys and the flight have taken the
    // view THIS frame rather than where it was last frame.
    applyHeldKeys(camera, keyboard, dt);
    camera.advance(dt);
    // Render on demand (201/4-01): the whole picture's inputs, as VALUES, compared against the frame that
    // last drew. Everything above this line has to run — a held key and a flight move the view, and a wake
    // that did not advance them would compare a pose nobody had updated.
    if (
      !gate.shouldDraw({
        canvas: canvas.width * canvas.height,
        created: lastStream.created,
        evicted: lastStream.evicted,
        hour,
        ops: overlayOn ? ops : NO_BOARD,
        pending: lastStream.pendingCells,
        pose: camera.pose(),
        selection: overlayOn ? options.selection() : null,
        sketch: overlayOn ? sketch.revision() : 0,
      })
    ) {
      if (!idleReported) {
        idleReported = true; // one readout says the console went idle; then the chrome stops re-rendering too
        reportIdle();
      }
      // Not a frame, and the interval that follows it is not a frame time either — both were counted as one
      // before this, which is why a console coming out of rest reported 10 fps for the next sixty frames.
      frameClock.skipped();
      bodyMs = performance.now() - now;
      schedule(true);

      return;
    }
    idleReported = false;
    // The clock classifies the interval and the collector is TOLD, rather than both deciding: the status
    // bar and a filed capture must not disagree about which gaps were frames (201/3-05).
    const intervalKind = frameClock.drew(now, dt);
    const state = camera.state(aspect);
    if (overlayOn) {
      time('board', () => {
        beacons.update(ops, options.selection(), options.trails?.());
        unitModels.update(ops.units);
      });
    }
    // Rings follow the ground point the view is over, never the eye: a camera a kilometre up sits outside
    // every ring and would stream nothing at all. The view goes with it, so what the frame will draw is what
    // the streamer fetches — judged at the DRAWING buffer's height, which is where a DPR of 3 lives.
    const stream = time('stream', () =>
      world.follow([state.target[0], state.target[1], state.target[2]], { camera: state, pixelHeight: canvas.height }),
    );
    const stats = time('engine-frame', () => engine.frame(state));
    reportBoot(stats);
    // Drained every frame the mode is on, so a span never carries into the next frame's total. Plan 091's
    // rule: the frame that DRAINS is the frame that paid, because the work ran in the gap before it.
    if (inventory) {
      inventory.sample(dt, stats, frameSpans.drain(), cpu, stream, intervalKind);
    }

    time('overlay-2d', () => {
      // `?overlay=0` (see `overlayOn`): the segment stays and reads ~0, so a capture SAYS the pass ran and
      // drew nothing rather than leaving a reader to wonder which build it came off.
      if (!overlayOn) {
        return;
      }
      /**
       * The first few overlay draws are SPLIT, and only those.
       *
       * The phone's first frame spends ~1.85 s here and nothing says which part
       * ([the 08-25 moving-camera row](../../../../docs/benchmarks/opensa-engine/2026-08-25-mobile-centre-moving-camera.json)).
       * `warmTextMetrics` was written on the assumption that font resolution was the cost, and the first
       * measurement after it shipped did not support that — so the next guess is a measurement instead. The
       * three candidates it separates: the canvas backing store being touched for the first time
       * (`clearRect`), the symbol layer's first glyph raster (`symbols`), and the sketch pass.
       *
       * `overlayDetail` counts down, so this costs two extra `performance.now()` pairs for three frames and
       * nothing at all afterwards — a permanent split would put three noise rows in every steady-state
       * frame's segments.
       *
       * It was written to be removed once it had answered, and it is KEPT instead: `overlay:clear` went
       * 212.1 ms → 0.1 on the device once the warm landed, and this split is the only thing that would say
       * if that ever came back. Six timestamps per session is a cheap regression detector for a cost that
       * used to be two seconds.
       */
      const detail = overlayDetail > 0;
      if (detail) {
        overlayDetail -= 1;
      }
      const step = <T>(name: string, run: () => T): T => (detail ? time(name, run) : run());
      projector.update(state, overlay.clientWidth, overlay.clientHeight);
      step('overlay:clear', () => {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
      });
      step('overlay:symbols', () =>
        symbology.render(
          context,
          projector,
          ops,
          options.selection(),
          { height: overlay.clientHeight, width: overlay.clientWidth },
          options.fixAges?.(),
        ),
      );
      // Over the symbols: an operator's own mark is the last thing drawn, so nothing hides it (201/7-05).
      step('overlay:sketches', () => drawSketches(context, (at) => projector.project(gtaToEngine(at)), sketch));
    });
    // The radar is drawn LAST and only when something on it moved (201/7-04) — it is an inset over a map
    // that is already correct, and a repaint every frame is what chain 4 would have to undo.
    if (overlayOn) {
      radar?.draw(ops, options.selection(), camera, aspect);
    }

    if (pendingCapture !== null) {
      const resolve = pendingCapture;
      pendingCapture = null;
      void composeImage(canvas, overlay, {
        build: world.label,
        district: districtLabel(params, world, camera),
        pose: camera.pose(),
      }).then(resolve);
    }

    if (now - lastReadout > 1000 / READOUT_HZ) {
      lastReadout = now;
      const rate = frameClock.read(now);
      lastPayload = {
        buildTime: world.label,
        cellsTotal: stats.cellsTotal,
        cellsVisible: stats.cellsVisible,
        // The PREVIOUS body, like the inventory's pairing: `dt` runs from one loop pass to the next, so the
        // work that ran inside the interval being reported is the one before it, and a body can then never
        // exceed the frame it is a share of.
        cpuMs: drawnBodyMs,
        draws: stats.drawsRecorded,
        following: camera.following(),
        fps: rate.fps,
        frameMs: rate.frameMs,
        hour,
        idle: false,
        idleFrames: gate.idleFrames,
        measurement: sketch.measurement(),
        namesHidden: symbology.counted().chipsDropped,
        pending: stream.pendingCells,
        pose: camera.pose(),
        residencyMb: stats.residencyBytes / (1024 * 1024),
        tool: sketch.tool(),
      };
      time('readout', () => options.onReadout(lastPayload as DispatchReadout));
    }
    lastStream = stream;
    bodyMs = performance.now() - now;
    drawnBodyMs = bodyMs;
    schedule(false);
  };
  requestAnimationFrame(loop);

  // 201/6-02: bake the flat map's pyramid out of THIS world. Driven by the URL rather than a control,
  // because it is an offline job with no offline home — the development machine has no headless browser,
  // so the bake runs where the world already is.
  if (params.get('bake') === 'tiles') {
    void bakeFlatMap(
      {
        canvas,
        extent: world.extent,
        frame: (state) => {
          engine.frame(state);
        },
        label: world.label,
        pause: (on) => {
          baking = on;
          if (!on) {
            wake();
          }
        },
        stream: (state, pixelHeight) =>
          world.follow([state.target[0], state.target[1], state.target[2]], { camera: state, pixelHeight })
            .pendingCells,
      },
      {
        maxZoom: numberParam(params, 'zmax', DEFAULT_BAKE_MAX_ZOOM),
        minZoom: numberParam(params, 'zmin', 0),
        tileSize: numberParam(params, 'tilesize', DEFAULT_TILE_SIZE),
      },
    ).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- a bake that failed must say so; there is no other surface
      console.error('[tilebake] failed:', error);
    });
  }

  return {
    camera,
    dispose(): void {
      disposed = true;
      // A capture waiting for a frame that will never come would leave its caller waiting forever; the
      // export says "no image" instead, which is a thing the operator can act on.
      pendingCapture?.(null);
      pendingCapture = null;
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      unbind();
      errorLog.dispose();
      beacons.dispose();
      unitModels.dispose();
      radar?.dispose();
      // **The GPU half, and it only became reachable when a mode could be SWITCHED** (201/6-03). Until then
      // this host was torn down exactly once, at the end of the page, so nothing here released anything and
      // nothing showed it. A switch that leaves the device alive leaks every buffer, texture and bundle the
      // world uploaded — `GPUDevice.destroy()` is the whole teardown by construction, because every one of
      // them belongs to the device. The streaming worker goes with it.
      world.dispose?.();
      engine.device.destroy();
    },
    exportImage(): Promise<Blob | null> {
      return new Promise((resolve) => {
        pendingCapture = resolve;
      });
    },
    faceNorth(): void {
      camera.turnTo(MAP_YAW);
    },
    fitBoard(): void {
      camera.fitBounds(boardPoints());
    },
    follow(id: null | string): void {
      camera.follow(id === null ? null : () => options.ops().units.find((unit) => unit.id === id)?.at ?? null);
    },
    goToPlace(place: SearchedPlace): void {
      camera.fitBounds([place.min, place.max]);
    },
    inventory(): InventoryReport | null {
      if (inventory === null) {
        return null;
      }
      const pose = camera.pose();

      return inventory.report({
        app: appBuild(),
        boot: { gpuMs, openMs, overlapMs, phases: engine.bootPhases.byName },
        build: world.label,
        byCategory: engine.ledger(),
        bytes: {
          byKind: pakTraffic.report(),
          cachedBytes: pakTraffic.cachedBytes,
          cachedRequests: pakTraffic.cachedRequests,
          requests: pakTraffic.requests,
          totalBytes: pakTraffic.totalBytes,
        },
        camera: { at: pose.at, height: pose.height, projection: pose.projection },
        device: engine.deviceReport,
        district: params.get('district') ?? UNNAMED_DISTRICT,
        errors: errorLog.entries(),
        firstFrames: engine.firstFrames.map((totals) => totals.byName),
        framesSkipped: gate.idleFrames,
        hasTimestamps: !engine.deviceReport.missing.includes('timestamp-query'),
        overlay: overlayOn,
        pickingBytes: engine.cells.pickingBytes,
        surface: {
          cssHeight: canvas.clientHeight,
          cssWidth: canvas.clientWidth,
          deviceHeight: canvas.height,
          deviceWidth: canvas.width,
          dpr,
          renderScale: engine.renderScale,
        },
        symbology: symbologyCounts(),
        tracks: options.trackStats?.() ?? null,
      });
    },
    locate(at: GtaGround): void {
      camera.flyTo(at, LOCATE_SPAN);
    },
    pose: () => camera.pose(),
    recallView(pose: MapPose): void {
      camera.flyToPose(pose);
    },
    searchPlaces: (query) => world.districts.search(query),
    setBindings(next: KeyBindings): void {
      keyboard.setBindings(next);
    },
    setHour: applyHour,
    setProjection(projection: MapProjection): void {
      camera.setProjection(projection);
    },
    setTool(tool: MapTool): void {
      sketch.setTool(tool);
    },
    setZoomLevel(level: ZoomLevel): void {
      camera.flyTo(camera.positionGta(), zoomSpan(level, camera.positionGta(), world));
    },
    sharedView: (): SharedView => ({
      ...viewOfPose(camera.pose()),
      hour,
      ...(params.get('src') === null ? {} : { src: params.get('src') ?? '' }),
      ...(params.get('district') === null ? {} : { district: params.get('district') ?? '' }),
    }),
    sketchClear(): void {
      sketch.clear();
    },
    sketchFinish(): void {
      sketch.finish();
    },
    sketchUndo(): void {
      sketch.undo();
    },
    tiltBy(radians: number): void {
      camera.tiltBy(radians);
    },
    turnBy(radians: number): void {
      camera.turnTo(camera.pose().yaw + radians);
    },
    zoomBySteps(steps: number): void {
      camera.flyTo(camera.positionGta(), camera.span() * ZOOM_STEP ** -steps);
    },
  };
}

/**
 * The console's query parameters.
 *
 * Normally the address bar, but a host that does not OWN its URL can set `window.__opensaDispatch` to the
 * same string instead. That is not hypothetical: a page opened from Android's downloads provider
 * (`content://…`) or from a `file://` path has an opaque origin where `history.replaceState` throws, so a
 * wrapper cannot put `?demo=1` in the URL — and the console would default to streaming a build that is not
 * there. Found in the field, on a phone, after the GPU side had finally started working.
 */
export function dispatchParams(): URLSearchParams {
  const override = (window as { __opensaDispatch?: string }).__opensaDispatch;

  return new URLSearchParams(override ?? window.location.search);
}
/** What a pressed key does. One switch, so the sheet, the buttons and the keyboard cannot drift apart. */
export function runCommand(
  command: PressedCommand,
  host: {
    camera: MapCamera;
    fit: () => void;
    followSelected: () => void;
    options: BootOptions;
    zoomLevel: (level: ZoomLevel) => void;
  },
): void {
  switch (command) {
    case 'fitBoard':
      host.fit();
      break;
    case 'followSelected':
      host.followSelected();
      break;
    case 'levelBlock':
      host.zoomLevel('block');
      break;
    case 'levelCity':
      host.zoomLevel('city');
      break;
    case 'levelDistrict':
      host.zoomLevel('district');
      break;
    case 'nextCall':
      stepCall(host, 1);
      break;
    case 'north':
      host.camera.turnTo(MAP_YAW);
      break;
    case 'previousCall':
      stepCall(host, -1);
      break;
    case 'stopFollowing':
      // Only when it is riding something: Escape belongs to the selection everywhere else, and a key that
      // silently eats an operator's Escape is worse than one that does nothing.
      if (host.camera.following()) {
        host.camera.follow(null);
      }
      break;
    case 'toggleHelp':
      // The sheet is React's, and it listens for the same key — nothing to do here, and saying so is
      // cheaper than a comment somewhere else explaining a missing case.
      break;
    case 'toggleMode':
      // Same shape, and for a stronger reason: a mode change tears THIS surface down (201/6-03), so the
      // one thing it cannot be is a command the surface runs on itself. The chrome owns it.
      break;
  }
}

export function zoomSpan(
  level: ZoomLevel,
  at: GtaGround,
  world: { readonly districts: DistrictLookup; readonly reach: number },
): number {
  const city = world.reach * 2;
  if (level === 'city') {
    return city;
  }
  if (level === 'block') {
    return CELL_SIZE;
  }
  const box = world.districts.boxAt(at);

  return box === null ? Math.sqrt(CELL_SIZE * city) : Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]);
}

/**
 * Which build of the APP this is (`__APP_BUILD__`, the commit vite stamped in). A capture carries it beside
 * the pak's `buildTime` because on 2026-08-26 three field captures in a row were taken of an app the device
 * had not updated to, and nothing in them could say so. `dev` is a bundle nobody stamped — the dev server,
 * a test host, an embedding host on an older build.
 */
function appBuild(): string {
  return typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';
}

/**
 * Wire the map's gestures to the camera and to selection. The gesture layer decides WHAT happened (tap, pan,
 * orbit, pinch, long press); this decides what it MEANS: a tap selects, a long press opens a call there.
 */
function bindInput(input: {
  camera: MapCamera;
  canvas: HTMLCanvasElement;
  districts: DistrictLookup;
  engine: Engine;
  options: BootOptions;
  sketch: SketchStore;
  symbology: SymbologyLayer;
}): () => void {
  const { camera, canvas, districts, engine, options, sketch, symbology } = input;

  /** The world ray under a canvas-relative CSS position. */
  const rayAt = (x: number, y: number): CursorPick => {
    const rect = canvas.getBoundingClientRect();
    const ndc: [number, number] = [(x / rect.width) * 2 - 1, 1 - (y / rect.height) * 2];

    return camera.rayAt(ndc, rect.width / Math.max(1, rect.height));
  };

  return bindGestures(canvas, {
    dolly: (notch) => camera.dolly(notch),
    longPress: (x, y) => {
      const ground = groundPoint(rayAt(x, y));
      if (ground) {
        options.onGround(ground, districts.nameAt(ground));
      }
    },
    orbit: (dx, dy) => camera.orbit(dx, dy),
    pan: (delta) => camera.pan(delta),
    // Symbology first — the operator aimed at a chip; then whatever the world puts under the cursor.
    tap: (x, y) => {
      // A tool takes the tap whole: while one is armed the map draws instead of selecting, which is what
      // makes a cordon possible to place over a unit without picking the unit up (201/7-05).
      if (sketch.tool() !== 'none') {
        const ground = groundPoint(rayAt(x, y));
        if (ground) {
          sketch.addPoint(ground);
        }

        return;
      }
      const symbol = symbology.hitTest(x, y);
      if (symbol) {
        options.onClick(symbol);

        return;
      }
      const ray = rayAt(x, y);
      const hit = engine.cells.pick(ray.origin, ray.direction);
      options.onClick(
        hit
          ? {
              at: [hit.position[0], -hit.position[2]],
              district: districts.nameAt([hit.position[0], -hit.position[2]]),
              kind: 'world',
              model: hit.model,
              txd: hit.txd,
            }
          : { at: groundPoint(ray) ?? [0, 0], kind: 'ground' },
      );
    },
    zoomBy: (factor) => camera.zoomBy(factor),
  });
}

/** The game's own timecyc when the build ships one, so the map is lit as the game lights it. */
function buildEnvironment(
  engine: Engine,
  timecyc: null | TimecycSource,
  params: URLSearchParams,
): EngineEnvironmentDriver {
  // Which of the three names won is otherwise unobservable — a shadowed table fails nothing (104/02).
  // eslint-disable-next-line no-console -- boot report, one line
  console.log(`[timecyc] ${describeTimecycSource(timecyc)}`);

  return createEngineEnvironmentDriver(engine.environment, {
    ...(timecyc ? { timecyc: { text: timecyc.text } } : {}),
    // A map camera hundreds of units up measures radial distances a street-level mood was never authored for.
    fogScale: numberParam(params, 'fogscale', 2.5),
    weather: numberParam(params, 'weather', 0),
  });
}

/** `?demo=1`: a synthetic block grid, resident from the start. */
function demoWorld(engine: Engine): DispatchWorld {
  const draws = buildDemoCity(engine);
  // eslint-disable-next-line no-console -- the boot record: a demo run must never be mistaken for a real one
  console.log(`[dispatch] DEMO world — synthetic blocks, ${draws} recorded draws. No pak, no model names.`);

  // A synthetic block grid is nowhere, so it has no district names and must not pretend to: the console
  // falls back to its landmark table, which is what a demo of stock Los Santos wants anyway.
  return {
    districts: NO_DISTRICTS,
    extent: DEMO_EXTENT,
    follow: () => IDLE_STREAM,
    gameDir: '',
    label: 'demo (synthetic)',
    reach: DEMO_REACH,
  };
}

/**
 * What the export's stamp calls this place: the world's own name for the point under the view, else the
 * district the run was opened with, else nothing at all. Never a landmark table of our own — a total
 * conversion's places are its own (201/5-03).
 */
function districtLabel(params: URLSearchParams, world: DispatchWorld, camera: MapCamera): string {
  return world.districts.nameAt(camera.positionGta()) ?? params.get('district') ?? '';
}

function numberParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = Number(params.get(name) ?? Number.NaN);

  return Number.isFinite(raw) ? raw : fallback;
}

/**
 * The pak's engine-free half, started beside `engine.init` (201/4-03): where the world is, its manifest, and
 * a worker that has probed its IO mode. It reports no shell step — while this runs, the phase the console is
 * actually waiting on is the GPU, and a bar that narrates the faster of two parallel halves is a bar that
 * lies about what is taking the time.
 */
async function openWorld(params: URLSearchParams, host: StreamingHost): Promise<OpenedWorld> {
  const startedAt = performance.now();
  const source = await resolvePakBase(params.get('src') ?? DEFAULT_SRC);
  // Two files on the same server, neither waiting on the other: the pak's manifest and worker, and the
  // game's `data/` mood table (up to three candidate names, 104/01). The host's worker constructor is spent
  // HERE rather than in `setupStreaming`, because this is the call that opens the pak now (201/2-02).
  const [pak, timecyc] = await Promise.all([openPakSource(source.base, host), readTimecyc(source.gameDir)]);
  // The second wave, and it could not have been in the first: both of these are loose files the MANIFEST
  // points at, so they are not knowable until it is read. Together, because they are two servers' answers to
  // two independent questions — and still inside the GPU's wait, which is the whole point.
  const [water, districts] = await Promise.all([
    fetchWater(source.base, pak.manifest.water),
    loadDistricts(source.base, pak.manifest.districts),
  ]);

  return { districts, openMs: performance.now() - startedAt, pak, source, timecyc, water };
}

/**
 * The opening pose: `?at=` if given, else the point the named `?district=` opens over, else the default.
 *
 * The district step matters more than it looks. A capture is labelled by `?district=` and aimed by `?at=`,
 * and until they came from one table a run could be labelled one district while looking at another — with
 * nothing on screen or in the report saying so.
 */
function poseFromQuery(params: URLSearchParams): MapPose {
  // One reader for the link's own names (201/7-07), so a URL this console WRITES is one it opens.
  const view = readView(params);
  const district = DISTRICTS[params.get('district') ?? ''];

  return {
    at: view.at ?? district?.at ?? OPENING_POSE.at,
    height: view.height ?? OPENING_POSE.height,
    pitch: view.pitch ?? OPENING_POSE.pitch,
    projection: view.projection ?? OPENING_POSE.projection,
    yaw: view.yaw ?? OPENING_POSE.yaw,
  };
}

/**
 * Fog is pushed to the far plane, and this is NOT a look preference: the engine culls a cell that lies
 * entirely past `fogCutDistance` (2400 by default), so from the kilometre-high eye a city view needs, every
 * cell would be culled and the map would come back empty. `?fog=1` restores the game's own fog for looking
 * at fog. Re-applied after every hour change, because the environment driver rewrites both distances.
 */
function pushFogOut(engine: Engine, params: URLSearchParams): void {
  if (params.get('fog') === '1') {
    return;
  }
  engine.environment.fogStartDistance = CAMERA_FAR * 0.92;
  engine.environment.fogCutDistance = CAMERA_FAR;
}

async function readTimecyc(gameDir: string): Promise<null | TimecycSource> {
  if (gameDir === '') {
    return null;
  }

  // The candidate order is `TIMECYC_SOURCES` and nowhere else (plan 104/01): a second copy of it here is a
  // console lit by a different table than the game it is a map of, and nothing would say so.
  return resolveTimecycSourceAsync(async (path) => {
    try {
      const response = await fetch(`${gameDir}/${path}`);

      return response.ok ? await response.text() : null;
    } catch {
      // A build served without its `data/` folder simply goes parametric — not an error worth failing on.
      return null;
    }
  });
}

/**
 * Walk the open calls in the order the queue shows them, selecting and flying to each. The step is taken
 * from the CURRENT selection, so an operator working a call and pressing "next" gets the one after it
 * rather than the one after wherever they last looked.
 */
function stepCall(
  host: { camera: MapCamera; options: BootOptions; zoomLevel: (level: ZoomLevel) => void },
  step: number,
): void {
  const open = host.options.ops().incidents.filter((incident) => incident.status !== 'closed');
  if (open.length === 0) {
    return;
  }
  const selection = host.options.selection();
  const current = selection?.kind === 'incident' ? open.findIndex((incident) => incident.id === selection.id) : -1;
  const next = open[(((current + step) % open.length) + open.length) % open.length];
  host.options.onClick({ id: next.id, kind: 'incident' });
  host.camera.flyTo(next.at, LOCATE_SPAN);
}

/** The real thing: a built game, streamed from its already-opened pak. */
async function streamedWorld(engine: Engine, params: URLSearchParams, opened: OpenedWorld): Promise<DispatchWorld> {
  const base = opened.source.base;
  const setup = await setupStreaming(
    engine,
    base,
    {
      hdRadius: numberParam(params, 'hd', DEFAULT_HD_RADIUS),
      lodRadius: numberParam(params, 'lod', DEFAULT_LOD_RADIUS),
    },
    // The worker exists already and the host knob that builds it was spent in `openWorld`; this hands the
    // setup the opened pak rather than a way to open one.
    {},
    opened.pak,
  );
  // Nothing here reaches the network any more: the sea and the district table were read under the GPU
  // (`openWorld`), and this is the engine half of the sea — a parse and one `setWater`.
  installWater(engine, opened.water);

  return {
    dispose: () => setup.dispose(),
    districts: opened.districts,
    extent: { centre: engineToGta(setup.center), radius: setup.radius },
    follow: (focus, view) => setup.driver.update(focus, view),
    gameDir: opened.source.gameDir,
    label: setup.buildTime ?? 'unknown',
    reach: numberParam(params, 'lod', DEFAULT_LOD_RADIUS),
  };
}
