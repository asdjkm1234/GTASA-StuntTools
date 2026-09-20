/**
 * The 201/1-01 inventory: what a map view actually costs per frame, measured before anything is cut.
 *
 * Two rules this collector exists to satisfy, both from the plan:
 *
 * - **It cuts nothing and changes nothing.** Its whole output is a before-table. A step that measured and
 *   tuned in one pass would have no baseline left to compare against.
 * - **It states what it could NOT measure.** On a phone there is no `timestamp-query`, so every GPU pass
 *   time is zero — not cheap, *absent*. A report that prints `gpuPassMs 0.0` beside real CPU numbers is a
 *   report that will be read six months later as "the GPU was free", which is the exact failure the mobile
 *   benchmark schema was written to prevent (200/1-02).
 *
 * Frame cost has three halves — the third one added after the first real capture, which is the point of it:
 *
 * 1. the engine's own per-frame stats (submit, GPU passes when the adapter can time them, draws, triangles,
 *    residency);
 * 2. the named spans for work that runs BETWEEN frames (`frameSpans`) — cell collider builds, `.osm` parses,
 *    texture uploads. The console never drained those before this mode existed;
 * 3. **the CPU side of the loop body itself.** The 2026-08-07 mobile row came back with `submitMs` at 5.6 %
 *    of a 31.8 ms frame, no `timestamp-query` on the adapter, and empty spans — so 94 % of the frame had no
 *    owner at all. A chain asked to cut what is never read cannot work against that, and the missing number
 *    is not a GPU one: it is how much of the frame the main thread was even running. That is measurable on
 *    any device, which is why it is here rather than waiting for a GPU timer no phone offers.
 *
 * The third half answers one question the mobile row left open and could not settle: **is the frame slow
 * because work is being done, or is it waiting?** A body of 6 ms inside a 32 ms frame says the main thread
 * is idle for 26 of them and the cost is downstream (present, GPU, vsync); a body of 28 ms says the opposite.
 * The two have opposite fixes, and the report now carries the split instead of the argument.
 */

import type { EngineStats, FrameSpanTotals, PakTrafficKind, StreamStats } from '@opensa/engine';

import type { MapProjection } from '../map/map-camera';
import type { FrameIntervalKind } from './frame-clock';

import { DISTRICTS, PINNED_DISTRICT } from './districts';
import { FrameHistogram } from './frame-histogram';

/** The CPU cost of ONE loop body, measured by the host around its own frame. */
export interface FrameCpuSample {
  /** rAF callback start → end, ms: everything the host's main thread did for that frame. */
  readonly bodyMs: number;
  /** The drawing buffer this frame was rendered into, in pixels. Carried for ONE reason: a size change
   *  rebuilds every render target, and a phone changes it without being asked — the browser's own chrome
   *  collapsing is a resize. Without it a frame that cost half a second has no candidate explanation. */
  readonly canvasPixels: number;
  /** Named segments inside the body. Their sum is ≤ `bodyMs`; the remainder is untimed glue. */
  readonly segments: FrameSpanTotals;
}

/** Where the frame went on the CPU, averaged over the sampled window. */
export interface InventoryCpu {
  /** The worst body seen on a PACED frame — a frame after a rest carries the gate's body, not its own. */
  readonly bodyMaxMs: number;
  /** Mean ms spent inside the rAF callback, over the frames whose interval is a frame time — the same
   *  population as `shareOfFrame`, and for a reason the field found rather than one anybody argued: the
   *  sample is paired one pass late, so after a SKIPPED pass it carries the render gate's own ~0.2 ms
   *  instead of a frame's. This read 1.48 ms against a real 13.84 on 2026-08-31 before the restriction. */
  readonly bodyMeanMs: number;
  /** Mean dt − mean body **over the frames whose interval is a frame time**. Present, GPU backpressure,
   *  vsync wait, other tasks and GC all live in here, and nothing on this device can separate them further —
   *  the number's value is that it says how much room there is to separate. Restricted to that population
   *  since 201/3-05: computed over every drawn frame it counted the render gate's idle wait as time the
   *  frame spent outside the CPU, which reads as "the frame is GPU-bound" and was the loop sleeping. */
  readonly outsideMeanMs: number;
  /** Mean ms per PACED frame, descending — the same population as `bodyMeanMs`, and divided by it rather
   *  than by every drawn frame; the latter read every segment ~11x low on the 2026-08-31 capture. `other`
   *  is body time no segment claimed. */
  readonly segmentsMs: readonly (readonly [string, number])[];
  /** Body mean ÷ dt mean over the frames whose interval is a frame time, 0..1 — see `outsideMeanMs`. The
   *  2026-08-31 capture reported **2.3 %** before that restriction, against 85 % of its samples being the
   *  idle poll rather than a frame. */
  readonly shareOfFrame: number;
  /** The WORST body of the window, with its own segment breakdown rather than the window's averages. Two
   *  captures in a row made the worst frame the interesting one, and a mean cannot answer which part of it
   *  grew — 1068 ms of body says nothing about whether it was the render, the overlay or the streamer. */
  readonly worstFrame: InventoryWorstFrame;
}

/** One pass or cost centre, averaged over the sampled window. */
export interface InventoryPass {
  /** False when the adapter cannot produce this number at all — the value is then meaningless, not zero. */
  readonly available: boolean;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly name: string;
}

export interface InventoryReport {
  /** The commit the APP was built from (`__APP_BUILD__`), or `dev` for a bundle nobody stamped. It sits
   *  beside `build` — the PAK's `buildTime` — because a capture has to answer both halves of "what was
   *  running": three captures on 2026-08-26 were taken of an app the device had never updated to, and only
   *  a missing field gave it away. A trailing `+` means the tree was dirty when it was built. */
  readonly app: string;
  /** What the BOOT cost, before a frame existed. `gpuMs` is `engine.init` end to end; `phases` is its own
   *  split — device / canvas / pipelines / resources / sky-lut / targets (201/4-03). `openMs` is the pak's
   *  engine-free half (the `?src=` probe, the manifest, the worker's IO probe), which runs BESIDE the GPU,
   *  and `overlapMs` is how much of the two ran at the same time — the saving, counted rather than claimed.
   *  Both are 0 on `?demo=1`, which opens no pak. */
  readonly boot: {
    readonly gpuMs: number;
    readonly openMs: number;
    readonly overlapMs: number;
    readonly phases: readonly (readonly [string, number])[];
  };
  readonly build: string;
  /** What this surface actually READ out of the pak, by entry kind — wire bytes and request counts, live
   *  since boot rather than over the sampled window. The build's `report.json` says what the pak CONTAINS;
   *  the gap between the two is what 201/1 is for, and an entry kind absent from this list is one no frame
   *  of this surface ever asked for. */
  readonly bytes: {
    readonly byKind: readonly PakTrafficKind[];
    /** Of `totalBytes`, how much did NOT cross the network (201/4-03) — a SUBSET, never an addition. Pak
     *  slices come from Cache Storage; `water.bin` is a loose file the slice cache never sees and reports
     *  the browser's own HTTP cache instead (Resource Timing `transferSize === 0`, so a 304 revalidation
     *  counts as a miss and an unknown transfer is never counted as a hit). Zero on a first open, on an
     *  unversioned pak, and wherever Cache Storage is withheld (a LAN `http://` origin is not a secure
     *  context). */
    readonly cachedBytes: number;
    readonly cachedRequests: number;
    readonly requests: number;
    readonly totalBytes: number;
  };
  /** Where the operator was when they took the report, and how the world was PROJECTED — so the capture
   *  states its own ground and its own arm. A plan-view frame and a perspective one cover different
   *  amounts of world at the same pose, so a row that does not say which it was cannot be compared to
   *  anything (201/7-01, and the standing rule that an A/B is self-describing). */
  readonly camera: {
    readonly at: readonly [number, number];
    readonly height: number;
    readonly projection: MapProjection;
  };
  readonly cpu: InventoryCpu;
  readonly device: unknown;
  readonly district: string;
  /** The page's own errors during the capture (see `error-log.ts`) — a phone has no devtools to read. */
  readonly errors: readonly string[];
  /** The engine's own split of its FIRST frames, one entry per frame in order (201/4-03) — where the fixed
   *  77.9 ms of a first `engine-frame` went. Empty on a host that never reached a first frame. */
  readonly firstFrames: readonly (readonly (readonly [string, number])[])[];
  /**
   * The frame times, and ONLY those: every interval here had a drawn frame at both ends.
   *
   * Since 201/3-05 the interval that spans a skipped pass is kept apart in {@link InventoryReport.rest}
   * rather than averaged in here. Before that these fields described the render gate's idle poll on any
   * capture of a console that was not being flown continuously — 706 of 835 samples on the 2026-08-31 one,
   * where `dtP50` read 100.6 ms and no frame had cost anything like it.
   */
  readonly frame: {
    /** dt counts per bin, ascending, empty bins omitted — 2 ms up to 100, then 20 ms out to a second, then
     *  one tail (`frame-histogram.ts`). A frame waiting on a 60 Hz vsync piles into the bins around 16.7 and
     *  33.3; a frame that is simply slow spreads. The two look identical in a p50 and have opposite fixes,
     *  which is the whole reason the shape is kept. */
    readonly dtHistogramMs: readonly (readonly [number, number])[];
    /** Exact, never a bin's floor: the worst frame is the one a percentile is least able to describe. */
    readonly dtMaxMs: number;
    readonly dtMeanMs: number;
    /** A BIN's floor since 201/3-05, so up to one bin low and never high — the price of a collector whose
     *  memory does not grow with the capture. Exact percentiles cost a stored sample per frame. */
    readonly dtP50Ms: number;
    readonly dtP95Ms: number;
    readonly fps: number;
  };
  /** Frames DRAWN over the window — both kinds of interval, so this plus `framesSkipped` is every loop pass. */
  readonly frames: number;
  /**
   * Frames the render gate SKIPPED over the window (201/4-01) — the other half of `frames`, and the number
   * the "idle draws → 0" claim is read off rather than asserted. A capture with 400 frames and 0 skips was
   * taken on a moving map; one with 40 frames and 3 600 skips was taken on a console at rest, and the two
   * cannot be compared without it.
   */
  readonly framesSkipped: number;
  /**
   * Whether anything was drawn OVER the map in this window — false under `?overlay=0`.
   *
   * A capture states what its run was configured with, or an A/B is not one: with this false the symbology
   * counts below describe a board that was maintained and never drawn, and `overlay-2d` reads ~0 because
   * the pass returned rather than because it got cheap.
   */
  readonly overlay: boolean;
  /** Per-frame cost centres, descending by mean. */
  readonly passes: readonly InventoryPass[];
  /** Between-frame named work, mean ms per sampled frame, descending. Empty means nothing was wrapped. */
  /**
   * The half of the drawn frames whose interval was NOT a frame time (201/3-05): the previous loop pass was
   * skipped, so the gap is mostly the render gate's 100 ms idle wait. Reported rather than dropped, because
   * a window cannot be read without it — `frames` minus `rest.frames` is what the percentiles are over, and
   * `rest.totalMs` against `windowMs` says how much of the capture the console spent at rest on purpose.
   */
  readonly rest: {
    readonly frames: number;
    readonly maxMs: number;
    readonly meanMs: number;
    readonly totalMs: number;
  };
  readonly spans: readonly (readonly [string, number])[];
  /** What the streamer did over the window — the engine's own numbers, which the console used to drop. */
  readonly streaming: InventoryStreaming;
  /** What the frame was DRAWN AT. The `target` category below is a cost of resolution and of nothing else —
   *  36.54 MB of the 2026-08-12 capture's 74.9, larger than every texture in the district — and until this
   *  block existed a capture could not be read for it at all: the CSS size, the DPR and the render scale
   *  were sentences somebody wrote by hand afterwards. An A/B must be self-describing (`CLAUDE.md`). */
  readonly surface: {
    readonly cssHeight: number;
    readonly cssWidth: number;
    /** The drawing buffer, device pixels — what the swapchain and the post pass are sized at. */
    readonly deviceHeight: number;
    readonly deviceWidth: number;
    readonly dpr: number;
    /** `?scale=` — the engine's own knob, which shrinks the scene and bloom targets (never the swapchain). */
    readonly renderScale: number;
  };
  /**
   * What the SYMBOLOGY layer was carrying — a reading of the last frame before the report was taken, like
   * `world` below rather than a mean, because the counts are a property of the board and the camera rather
   * than of the interval.
   *
   * The block exists because 201/1-01 measured `overlay-2d` at **2.44 ms, the largest item in the body and
   * more than `engine-frame`'s 2.10** — while drawing NINE units. Read alone that number says nothing: the
   * declared worst case is 150 (201's budget table), and a capture that does not state its symbol count
   * cannot be compared with one taken at a different zoom, let alone at a different load. `?units=` and
   * `?calls=` set the load; this says what arrived on screen.
   */
  readonly symbology: {
    /** Markers the largest beacon set is allocated for. */
    readonly beaconCapacity: number;
    /** Times a beacon set has been GROWN past its allocation since boot. Non-zero is not a fault — it is the
     *  board going past the declared budget and the map still drawing every unit — but it is a number the
     *  budget table wants to hear about. */
    readonly beaconGrowths: number;
    readonly chips: number;
    /** Chips dropped for depth — the only decluttering this layer does today (3/03 owns the real rule). */
    readonly chipsDropped: number;
    readonly incidents: number;
    /** `measureText` calls on that frame. 0 with a warm width cache, whatever the symbol count; one per
     *  label the layer had never drawn before. A capture where this tracks `chips` is one where the cache
     *  is not working. */
    readonly measures: number;
    /** Texture megabytes the uploaded unit models hold (201/5-04) — the dominant per-type cost, and the
     *  half of a resident figure that belongs to the BOARD rather than to the world. */
    readonly modelTextureMb: number;
    /** Unit model TYPES uploaded right now. A shift of 150 cars is a handful of types, which is the whole
     *  reason a model layer is affordable at the declared count. */
    readonly modelTypes: number;
    /** Units drawn with an AGING fix — older than PCAD's 4 s publish interval (201/8-02). On the mock this
     *  is 0 while live and grows during a scrub; on a real feed it is what a quiet channel looks like. */
    readonly stale: number;
    readonly symbols: number;
    readonly units: number;
    /** Units drawn as a MODEL on that frame (201/5-04). */
    readonly unitsAsModels: number;
    /** Units drawn as a symbol ALONE — no model claimed, none in this build, or one still loading. On a pak
     *  served without its game dir this is every unit, which is the fallback working rather than a fault. */
    readonly unitsAsSymbolOnly: number;
    /** Distinct model names this build could not draw. Each one was reported to the log once. */
    readonly unitsUnresolvedModels: number;
  };
  /**
   * What the TIME AXIS is holding (201/8-01) — host bytes, samples, and the window a scrub may ask for.
   * Null when the host passed no board (an embedding with no dispatch state).
   *
   * Kept out of `world.residencyMb` on purpose: that ledger counts GPU bytes and this is JS heap, the same
   * distinction 5/01 drew for `pickingMb`. A capture that adds them together is one that charges a track
   * against a texture budget.
   */
  readonly tracks: {
    readonly bytes: number;
    readonly capacity: number;
    readonly samples: number;
    readonly tracks: number;
    /** Oldest → newest sample time held, ms. */
    readonly window: null | readonly [number, number];
  } | null;
  /** Human-readable reasons a column above is absent on this device. */
  readonly unavailable: readonly string[];
  /** Reasons this capture may NOT be cited as a before-table. Empty = nothing obviously wrong with it.
   *  The first real capture (2026-08-07) was pasted, read and filed before anyone noticed it had streamed
   *  no cells at all — the numbers describe water over an empty world. A capture that says so itself is
   *  the cheapest possible guard against that. */
  readonly warnings: readonly string[];
  readonly windowMs: number;
  readonly world: {
    /** Resident GPU bytes BY CATEGORY, from the engine's own ledger — `texture`, `cellVertex`, `cellIndex`,
     *  `target` (the render targets, a cost of RESOLUTION rather than of content), `uniform`. The 08-09
     *  capture reported 148 MB against a pak whose whole texture ceiling is 99.7, and the 48 MB difference
     *  had no owner; the engine has counted it by category since 074/01 and the console was not asking. */
    readonly byCategoryMb: readonly (readonly [string, number])[];
    readonly cellsTotal: number;
    readonly cellsVisible: number;
    readonly draws: number;
    /** What click-to-inspect is costing, HOST megabytes (`engine.cells.pickingBytes`): the placement mapper
     *  plus the index bytes retained with it. It is NOT part of `residencyMb` — that ledger counts GPU
     *  bytes — and it is here because 201/5-01 asks for this number measured on a real district rather than
     *  estimated. The console arms picking at boot, so a capture always carries the cost of its own best
     *  feature instead of leaving it to be discovered when a budget is blown. */
    readonly pickingMb: number;
    readonly residencyMb: number;
    readonly triangles: number;
  };
}

/** The streaming work the ENGINE times for itself, kept because the console used to discard it.
 *
 *  `blobMs` is the worker's message handler — decode and `createTexture` — which runs BETWEEN frames where no
 *  in-loop timer can see it; `uploadMs` is the budgeted drain inside `update`. The game shell has read these
 *  since 2026-07-27, when a field report of 20-250 ms frames turned out to be whole-array uploads at 15-85 ms
 *  a call, invisible to every block the host timed. The map profile's first two captures reported a 185 ms
 *  and a 1068 ms body with no owner, which is the same shape of question. */
export interface InventoryStreaming {
  readonly blobMeanMs: number;
  /** Cells created SINCE THE PAGE BOOTED, not over the sampled window — the driver keeps this as a running
   *  total and the collector reads it. The collector starts with the page, so the two are the same span in
   *  practice, and boot's own creates are inside it by design. */
  readonly cellsCreated: number;
  readonly cellsEvicted: number;
  /** Creates whose cell was already inside the fog cut — each one a visible pop. Since boot, like
   *  {@link cellsCreated}. */
  readonly lateCreates: number;
  readonly uploadMeanMs: number;
  /** The single most expensive worker-handler call in the window: one huge upload and a pile-up of small
   *  ones are different problems, and only this tells them apart. */
  readonly worstBlobMs: number;
  readonly worstCreateMs: number;
}

/**
 * The most expensive frame of the window, WITH the conditions it happened under.
 *
 * The 2026-08-23 field capture is why this carries more than a number: its worst frame was 600.3 ms — 422 of
 * them in `overlay-2d` and 163 in `engine-frame`, two segments that do not both inflate for the same reason —
 * and nothing in the report said when it happened, what the surface was, or whether the streamer was
 * delivering at the time. A number that large with no conditions cannot be acted on, only argued about.
 */
export interface InventoryWorstFrame {
  /** Ms into the sampled window. A cost at 200 ms is cold start; the same cost at 40 s is not. */
  readonly atMs: number;
  readonly bodyMs: number;
  /** Drawing-buffer pixels for THIS frame — compare with the report's `surface` to see a resize. */
  readonly canvasPixels: number;
  /** Cells created and evicted in this frame alone (the driver's totals are running, so these are deltas —
   *  summing them is the mistake the 2026-08-12 capture made, and it reported 2454 creates for 4 cells). */
  readonly cellsCreated: number;
  readonly cellsEvicted: number;
  readonly cellsVisible: number;
  readonly draws: number;
  /** The interval this frame took, which is what an operator felt. */
  readonly dtMs: number;
  /** Cells still on their way when it happened. */
  readonly pending: number;
  readonly segmentsMs: readonly (readonly [string, number])[];
}

/** What `?district=` defaults to. Exported so the reader and the writer cannot drift apart — the check for
 *  "nobody named the district" is a string comparison, and a second copy of it would silently stop matching. */
export const UNNAMED_DISTRICT = 'unnamed — pass ?district=';

/** Frames below which a window is too short to carry a percentile. At the ~24 fps this device gives, 300 is
 *  about twelve seconds — long enough to be past the load and into steady state. */
const MIN_FRAMES = 300;

/** The engine timings this collector averages, and whether each needs `timestamp-query` to mean anything. */
const TIMED: readonly (readonly [keyof EngineStats, boolean])[] = [
  ['submitMs', false],
  ['gpuPassMs', true],
  ['gpuPostMs', true],
  ['gpuProbeMs', true],
];

/**
 * Accumulates frames until asked for a report, in memory that does not depend on how long it runs.
 *
 * **`dt` is TWO populations and mixing them was the defect** (201/3-05, measured on the phone 2026-08-31).
 * This is only ever called on a DRAWN frame — the call sits behind the render gate — but a skipped pass
 * arms the next loop entry with `setTimeout(IDLE_WAKE_MS)`, so the frame drawn after one carries a ~100 ms
 * interval that is 99 % sleep. On a live 150-unit board the console alternates draw/skip continuously, and
 * **706 of that capture's 835 samples were that interval**: `dtP50` read 100.6 ms, `shareOfFrame` 2.3 %,
 * and both describe a loop resting on purpose rather than a frame costing anything. Every capture since
 * render-on-demand landed (2026-08-22) had its moving half picked out of the histogram by hand, in the
 * row's own prose. The caller now says which kind each interval is and the two are kept apart.
 *
 * The frame's own COST is not split, because it is not an interval: a frame drawn after a rest ran a real
 * body and belongs in the body mean. Only the gap around it does not.
 */
export class FrameInventory {
  get frames(): number {
    return this.frameIntervals.count + this.restIntervals.count;
  }
  /** Body time over the frames whose interval is a frame time — the population `shareOfFrame` divides. */
  private consecutiveBodyMs = 0;
  private readonly cpuTotals = new Map<string, number>();
  /** Intervals where BOTH ends drew: the frame times, and the only population a percentile may come from. */
  private readonly frameIntervals = new FrameHistogram();
  private readonly maxima = new Map<string, number>();
  /** The driver's create/evict totals as of the previous sample, so a frame's own count is a DELTA. */
  private previousStream = { created: 0, evicted: 0 };
  /** Intervals that span a skipped pass. Kept rather than dropped — a window cannot be read without them. */
  private readonly restIntervals = new FrameHistogram();
  private readonly spanTotals = new Map<string, number>();
  private started = 0;
  private readonly stream = {
    blobMs: 0,
    created: 0,
    evicted: 0,
    lateCreates: 0,
    uploadMs: 0,
    worstBlobMs: 0,
    worstCreateMs: 0,
  };
  private readonly sums = new Map<string, number>();

  private readonly worldLast = { cellsTotal: 0, cellsVisible: 0, draws: 0, residencyBytes: 0, triangles: 0 };
  /** The worst body seen, kept WITH its own segments — the mean cannot say which part of it grew. */
  private worst: InventoryWorstFrame = {
    atMs: 0,
    bodyMs: 0,
    canvasPixels: 0,
    cellsCreated: 0,
    cellsEvicted: 0,
    cellsVisible: 0,
    draws: 0,
    dtMs: 0,
    pending: 0,
    segmentsMs: [],
  };

  report(context: {
    /** `__APP_BUILD__` — which commit this bundle is. */
    app: string;
    /** `performance.now()` around `engine.init`, plus the engine's own phase split of it — and what the
     *  pak open beside it cost and hid. */
    boot: { gpuMs: number; openMs: number; overlapMs: number; phases: readonly (readonly [string, number])[] };
    build: string;
    /** `engine.ledger()` — resident bytes and counts per category. */
    byCategory: Readonly<Record<string, { bytes: number; count: number }>>;
    bytes: {
      byKind: readonly PakTrafficKind[];
      cachedBytes: number;
      cachedRequests: number;
      requests: number;
      totalBytes: number;
    };
    camera: { at: readonly [number, number]; height: number; projection: MapProjection };
    device: unknown;
    district: string;
    errors: readonly string[];
    /** `engine.firstFrames` — the split of the first frames, taken straight from the engine. */
    firstFrames: readonly (readonly (readonly [string, number])[])[];
    /** Frames the render gate skipped over the window (201/4-01) — the host's own counter, since a skipped
     *  frame never reaches `sample`. */
    framesSkipped: number;
    hasTimestamps: boolean;
    /** Whether the frame drew anything over the map — `?overlay=0` makes it false. */
    overlay: boolean;
    /** `engine.cells.pickingBytes` — the host cost of the placement mapper the console picks against. */
    pickingBytes: number;
    surface: InventoryReport['surface'];
    symbology: InventoryReport['symbology'];
    tracks: InventoryReport['tracks'];
  }): InventoryReport {
    const frames = Math.max(1, this.frames);
    const windowMs = this.started === 0 ? 0 : performance.now() - this.started;
    // Over the FRAME intervals, never over every drawn frame. Both halves: dividing a body by a resting
    // loop's interval was the first defect, and averaging a SKIPPED pass's body into the numerator was the
    // second — the field run of 2026-08-31 found it after the first was fixed.
    const paced = Math.max(1, this.frameIntervals.count);
    const dtMeanMs = this.frameIntervals.meanMs;
    const bodyMeanMs = this.consecutiveBodyMs / paced;

    const passes = TIMED.map(([key, needsTimestamps]) => ({
      available: !needsTimestamps || context.hasTimestamps,
      maxMs: this.maxima.get(key) ?? 0,
      meanMs: (this.sums.get(key) ?? 0) / frames,
      name: key,
    })).sort((a, b) => b.meanMs - a.meanMs);

    const unavailable = context.hasTimestamps
      ? []
      : [
          'gpuPassMs, gpuPostMs, gpuProbeMs — this adapter has no timestamp-query, so GPU time is not measurable at all',
        ];

    return {
      app: context.app,
      boot: context.boot,
      build: context.build,
      bytes: context.bytes,
      camera: { at: context.camera.at, height: context.camera.height, projection: context.camera.projection },
      cpu: {
        bodyMaxMs: this.maxima.get('cpu-body') ?? 0,
        bodyMeanMs,
        outsideMeanMs: Math.max(0, dtMeanMs - bodyMeanMs),
        segmentsMs: this.cpuSegments(paced, bodyMeanMs),
        shareOfFrame: dtMeanMs > 0 ? bodyMeanMs / dtMeanMs : 0,
        worstFrame: this.worst,
      },
      device: context.device,
      district: context.district,
      errors: context.errors,
      firstFrames: context.firstFrames,
      frame: {
        dtHistogramMs: this.frameIntervals.bins(),
        dtMaxMs: this.frameIntervals.maxMs,
        dtMeanMs,
        dtP50Ms: this.frameIntervals.percentileMs(0.5),
        dtP95Ms: this.frameIntervals.percentileMs(0.95),
        fps: this.frameIntervals.percentileMs(0.5) > 0 ? Math.round(1000 / this.frameIntervals.percentileMs(0.5)) : 0,
      },
      frames: this.frames,
      framesSkipped: context.framesSkipped,
      overlay: context.overlay,
      passes,
      rest: {
        frames: this.restIntervals.count,
        maxMs: this.restIntervals.maxMs,
        meanMs: this.restIntervals.meanMs,
        totalMs: this.restIntervals.totalMs,
      },
      spans: [...this.spanTotals.entries()]
        .map(([name, ms]) => [name, ms / frames] as const)
        .sort((a, b) => b[1] - a[1]),
      streaming: {
        blobMeanMs: this.stream.blobMs / frames,
        cellsCreated: this.stream.created,
        cellsEvicted: this.stream.evicted,
        lateCreates: this.stream.lateCreates,
        uploadMeanMs: this.stream.uploadMs / frames,
        worstBlobMs: this.stream.worstBlobMs,
        worstCreateMs: this.stream.worstCreateMs,
      },
      surface: context.surface,
      symbology: context.symbology,
      tracks: context.tracks,
      unavailable,
      warnings: warningsFor({
        bodyMeanMs,
        cellsTotal: this.worldLast.cellsTotal,
        district: context.district,
        frames: this.frameIntervals.count,
      }),
      windowMs,
      world: {
        byCategoryMb: Object.entries(context.byCategory)
          .filter(([, entry]) => entry.bytes > 0)
          .map(([category, entry]) => [category, entry.bytes / (1024 * 1024)] as const)
          .sort((a, b) => b[1] - a[1]),
        cellsTotal: this.worldLast.cellsTotal,
        cellsVisible: this.worldLast.cellsVisible,
        draws: this.worldLast.draws,
        pickingMb: context.pickingBytes / (1024 * 1024),
        residencyMb: this.worldLast.residencyBytes / (1024 * 1024),
        triangles: this.worldLast.triangles,
      },
    };
  }

  /**
   * One frame.
   *
   * `spans` is the drain of the SAME frame — the loop drains at the top, per plan 091. `cpu` is the
   * PREVIOUS loop body, and that is arithmetic rather than taste: `dt` runs from one rAF start to the next,
   * so the body that ran inside the interval being reported is the one before it. Paired that way the body
   * can never exceed the frame it is a share of.
   */
  sample(
    dtMs: number,
    stats: EngineStats,
    spans: FrameSpanTotals,
    cpu: FrameCpuSample,
    stream: StreamStats,
    /** Whether the interval before this frame is a FRAME time. `after-rest` means the previous loop pass was
     *  skipped, so the gap is mostly the render gate's idle wait and belongs to no frame. */
    interval: FrameIntervalKind = 'consecutive',
  ): void {
    if (this.started === 0) {
      // The FIRST delta is not a frame time. It is measured against whatever the loop did last — page load,
      // the pak's first fetch, device init — so it enters dtMax and the percentiles as a frame that never
      // happened. The 2026-08-07 capture reported dtMaxMs 41026.5 inside a windowMs of 1590.4, which is the
      // arithmetic tell: a frame longer than the window it was sampled in. The world state is still taken
      // from this call, since it is a reading rather than an interval.
      this.started = performance.now();
      this.worldFrom(stats);
      // Seed the running totals here too: without it the SECOND frame claims every cell created before the
      // window opened as its own, which is the same class of mistake as summing them (2026-08-12).
      this.previousStream = { created: stream.created, evicted: stream.evicted };

      return;
    }
    // The interval decides where the CPU numbers go, and ONLY they are split this way. Everything below —
    // the streamer, the engine timings, the spans, the world — is measured on the frame itself, so a frame
    // drawn after a rest contributes to all of it.
    //
    // `cpu` does not, and that is arithmetic rather than taste: it is paired one pass late on purpose (the
    // body that ran inside the interval being reported is the previous pass's), so when the previous pass
    // was SKIPPED it carries the GATE's own body — ~0.2 ms of held keys, camera advance and the comparison
    // itself. The 2026-08-31 field run reported `bodyMeanMs` **1.48 ms against a real 13.84** because 480
    // of those were averaged in with 47 real ones, and every segment came out ~11x low with it.
    if (interval === 'consecutive') {
      this.frameIntervals.add(dtMs);
      this.consecutiveBodyMs += cpu.bodyMs;
      this.bump('cpu-body', cpu.bodyMs);
      for (const [name, ms] of cpu.segments.byName) {
        this.cpuTotals.set(name, (this.cpuTotals.get(name) ?? 0) + ms);
      }
      if (cpu.bodyMs > this.worst.bodyMs) {
        this.worst = {
          atMs: performance.now() - this.started,
          bodyMs: cpu.bodyMs,
          canvasPixels: cpu.canvasPixels,
          cellsCreated: Math.max(0, stream.created - this.previousStream.created),
          cellsEvicted: Math.max(0, stream.evicted - this.previousStream.evicted),
          cellsVisible: stats.cellsVisible,
          draws: stats.drawsRecorded,
          dtMs,
          pending: stream.pendingCells,
          segmentsMs: cpu.segments.byName,
        };
      }
    } else {
      this.restIntervals.add(dtMs);
    }
    // Only HALF the streamer's numbers are per-update. `blobMs` is reset every update and `uploadMs` is
    // assigned every update, so those two sum like the spans do; `created`, `evicted` and `lateCreates` are
    // RUNNING TOTALS the driver never resets, so they are READ. Summing them added the whole history to
    // every later frame — the 2026-08-12 capture reported 2454 creates against 4 resident cells and 0
    // evictions, which is 4 creates counted once per frame for the rest of a 685-frame window.
    // The two worsts are kept rather than averaged: one 85 ms upload and twenty 4 ms ones are different
    // problems, and both are running maxima, so a max over the samples is the same number either way.
    this.stream.blobMs += stream.blobMs;
    this.stream.uploadMs += stream.uploadMs;
    this.stream.created = stream.created;
    this.stream.evicted = stream.evicted;
    this.stream.lateCreates = stream.lateCreates;
    this.stream.worstBlobMs = Math.max(this.stream.worstBlobMs, stream.worstBlobMs);
    this.stream.worstCreateMs = Math.max(this.stream.worstCreateMs, stream.worstCreateMs);
    this.previousStream = { created: stream.created, evicted: stream.evicted };
    for (const [key] of TIMED) {
      this.bump(key, stats[key]);
    }
    for (const [name, ms] of spans.byName) {
      this.spanTotals.set(name, (this.spanTotals.get(name) ?? 0) + ms);
    }
    this.worldFrom(stats);
  }

  private bump(key: string, value: number): void {
    this.sums.set(key, (this.sums.get(key) ?? 0) + value);
    this.maxima.set(key, Math.max(this.maxima.get(key) ?? 0, value));
  }

  /** The named segments plus `other` — the body time nobody claimed. Without that row the breakdown looks
   *  complete while summing to less than the body, which is the same lie as printing an absent GPU as zero. */
  private cpuSegments(frames: number, bodyMeanMs: number): readonly (readonly [string, number])[] {
    const segments = [...this.cpuTotals.entries()].map(([name, ms]) => [name, ms / frames] as const);
    const claimed = segments.reduce((sum, [, ms]) => sum + ms, 0);

    return [...segments, ['other', Math.max(0, bodyMeanMs - claimed)] as const].sort((a, b) => b[1] - a[1]);
  }

  /** The world figures are a READING of the latest frame, not an interval, so the skipped first sample still
   *  contributes them — a report asked for immediately then still says `cellsTotal: 0` rather than nothing. */
  private worldFrom(stats: EngineStats): void {
    this.worldLast.cellsTotal = stats.cellsTotal;
    this.worldLast.cellsVisible = stats.cellsVisible;
    this.worldLast.draws = stats.drawsRecorded;
    this.worldLast.residencyBytes = stats.residencyBytes;
    this.worldLast.triangles = stats.trianglesRecorded;
  }
}

/** What makes a capture unusable as a before-table, in the order it bites. */
function warningsFor(capture: { bodyMeanMs: number; cellsTotal: number; district: string; frames: number }): string[] {
  const { bodyMeanMs, cellsTotal, district, frames } = capture;
  const warnings: string[] = [];
  if (cellsTotal === 0) {
    warnings.push(
      'VOID: no cells streamed (cellsTotal 0) — these numbers describe an empty world. Wait for the world ' +
        'to arrive before taking a report.',
    );
  }
  if (frames < MIN_FRAMES) {
    warnings.push(`only ${frames} frames sampled — let it settle to at least ${MIN_FRAMES} before citing it`);
  }
  if (district === UNNAMED_DISTRICT) {
    warnings.push('district not named — pass ?district=<name>, 201/1-01 pins one and the row has to say which');
  } else if (district !== PINNED_DISTRICT) {
    // The 2026-08-07 row said this in a paragraph somebody had to write by hand AFTER the capture was filed.
    // A capture that says it itself is the difference between a caught mistake and a session of archaeology.
    const known = district in DISTRICTS ? '' : ' (and it is not a district this build knows at all)';
    warnings.push(
      `taken on '${district}'${known}, not on '${PINNED_DISTRICT}' which 201/1-01 pinned — a valid ` +
        "measurement of that ground, and NOT part of this chain's before/after series",
    );
  }
  if (frames > 0 && bodyMeanMs === 0) {
    warnings.push(
      'the host did not time its loop body, so the CPU/outside split is meaningless here — read shareOfFrame ' +
        'as absent, never as "the CPU was free"',
    );
  }

  return warnings;
}
