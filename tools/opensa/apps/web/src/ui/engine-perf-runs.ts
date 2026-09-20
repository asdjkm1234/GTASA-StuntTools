/**
 * In-game perf runs on the own engine (extracted from engine-canvas-host):
 * - bench `?bench=<key|all>` (074/10 B3 → the C1 comparability requirement): SAME scenes + path sampler
 *   as prod's BenchPlugin, SAME `[bench] {json}` report protocol — only the harness is host-specific
 *   (teleport via physics, weather via the shared env driver, camera override, engine stats capture);
 * - soak `?soak=<minutes>` (074/10 pre-flip ③): cycles ALL bench scenes until the deadline and
 *   self-judges stability (./soak owns the loop + verdict). Bench wins when both flags are set.
 */
import { type Engine, type StreamStats } from '@opensa/engine';
import { benchRoadCarPlacements } from '@opensa/game/adapters/road-cars';
import { type BenchScene, samplePath } from '@opensa/game/perf/bench';
import { type AssetFileSystem } from '@opensa/renderware';

import type { EngineVehicles } from './engine-vehicles';

import { BENCH_SCENES } from '../bench-scenes';
import { nextFrame, until, waitSeconds } from './frame-clock';
import { parseSoakMinutes, runSoak } from './soak';

/** The teleport NOTICE (the same one phys/video runs carry): for the first frames after a warp the driver
 *  is still describing the ring around the PREVIOUS anchor — drained, so it answers 0 immediately. */
const TELEPORT_NOTICE_SECONDS = 1;

/** Shader compiles / fresh-ring uploads drain here, outside the capture (prod WARMUP_S). */
const WARMUP_SECONDS = 1.5;

/**
 * How far below the anchor the settle looks for its ground before a leg may start (m).
 *
 * This is also a CEILING on scene authoring: an anchor standing further than this above its floor finds no
 * ground at all, and the settle falls back to the authored anchor — silently. The measured span today is
 * 3.65-26.29 m, with `ocean-horizon` at 43.75 m, so the headroom is thin. The leg-start probe catches the
 * consequence; nothing catches the cause.
 */
const GROUND_PROBE_DROP = 60;

/**
 * How long the settle waits for the player to come to REST after the warp (ms).
 *
 * Deliberately much shorter than {@link PerfRunsHost.settleTimeoutMs}: where the probe ray answers with
 * something the capsule cannot stand on, he never lands at all, and the full world-ready budget turns an
 * 11 m fall into ~890 m (measured 2026-08-09 on `strip-noon`). That is not just an ugly number — the world
 * IS anchored to the player, so a fall that deep correctly despawns the whole district's cars and the leg
 * then measures an empty street. A bounded wait keeps a bad anchor's cost bounded; the row still reports
 * itself red either way.
 */
const REST_TIMEOUT_MS = 3000;

/** Metres above the found ground the settle drops the player from — a scene anchor's authored z is NOT the
 *  ground (measured 2026-08-09: 6 of the 9 scenes sit 3.65-26.29 m above it, so warping to the anchor put
 *  him into free fall for the whole warmup). Just enough to land on rather than spawn inside the surface. */
const SETTLE_LIFT = 1;

/** What the leg-start probe accepts (m): further than this from the anchor — or a single frame that drops
 *  him this far — and the player is falling, so the row measures the fall and not the scene. */
const PROBE_MAX_DROP = 2;

/** The leg-start probe (plan 102) — what the world was doing the moment the capture began. */
export interface LegProbe {
  /** The player's Z relative to {@link targetZ}: how far he has moved from where the settle put him. */
  dz: number;
  grounded: boolean;
  /** Every field within bounds. A false row's numbers describe a falling camera, not the scene. */
  ok: boolean;
  pendingCells: number;
  /** Where the settle placed him (found ground + {@link SETTLE_LIFT}) — stated so the row describes its
   *  own configuration instead of being read against the scene's camera anchor. */
  targetZ: number;
  /** The worst single-frame drop over the leg (m) — a fall that STARTS mid-leg shows up here. */
  worstDrop: number;
}

/** One frame's numbers pushed by the host's render loop while a leg flies. */
export interface LegSample {
  draws: number;
  /** Fixed steps this frame — `vehicleFixedMs` is summed over them, and the budget is PER STEP. */
  fixedSteps: number;
  frameMs: number;
  gpuMs: number;
  /** Raycast vehicles alive in the physics world — the vehicle cost means nothing without the count. */
  liveVehicles: number;
  /** Cells still loading at this frame's stream update — the streaming BACKLOG behind a hitch. */
  pendingCells: number;
  postMs: number;
  probeMs: number;
  /** `StreamStats.blobMs` for this frame: pak-blob handler work, which runs BETWEEN frames and so lands in
   *  the frame INTERVAL without appearing in any in-frame block timer. The usual shape of a real hitch. */
  streamBlobMs: number;
  /** `StreamStats.uploadMs` for this frame — the budgeted, in-frame share of texture-array writes. */
  streamUploadMs: number;
  submitMs: number;
  triangles: number;
  /** The vehicle slice of this frame's fixed steps (081/07 §3): raycast controllers + the vehicle
   *  system's fixed update, apart from the solver and from the per-frame visual tick. */
  vehicleFixedMs: number;
}

/** What the runs need from the engine host — thin accessors over its loop state. */
export interface PerfRunsHost {
  /** Start pushing {@link LegSample}s from the render loop. */
  beginSamples(): void;
  engine: Engine;
  fs: AssetFileSystem;
  getStream(): null | StreamStats;
  /** Live accessor — the vehicle system arrives asynchronously after boot. */
  getVehicles(): EngineVehicles | null;
  /** Ground Z under a GTA point (searching `maxDrop` down), or null — the settle's ground truth. The
   *  streaming ring says nothing about collision, which is built in a promise continuation behind it. */
  groundBelow(at: readonly [number, number, number], maxDrop: number): null | number;
  params: URLSearchParams;
  /** The player as the leg-start probe has to see him: his Z and whether anything is holding him up. */
  playerProbe(): { grounded: boolean; z: number };
  setBenchCamera(camera: null | { eye: [number, number, number]; target: [number, number, number] }): void;
  setHour(hour: number): void;
  setSoakStatus(text: string): void;
  /** The streaming-settle deadline after a teleport (the host's world-ready timeout). */
  settleTimeoutMs: number;
  /** Instant weather switch — legs must not sample mid-blend. */
  setWeather(weather: number): void;
  slowFrameMs: number;
  /** Stop sampling and take the collected frames. */
  takeSamples(): LegSample[];
  /** Teleport the player (streaming/collision anchor), GTA coords. */
  teleportPlayer(anchor: readonly [number, number, number]): void;
  /** GTA Z-up → engine world space (the camera's frame). */
  toEngine(gta: readonly [number, number, number]): [number, number, number];
}

/**
 * The hitch columns — what a leg's WORST frames did, as opposed to its average one.
 *
 * Why they exist (lod-procobj 013's `opensa` streaming budget): under vsync the mean and the p95 both sit on
 * the frame period — measured 2026-08-09, `avgMs` 8.333 on seven of nine scenes and `p95Ms` 9.1 on ALL nine,
 * in both arms of an A/A. A cap bounds how FAST a frame may be and says nothing about how slow one gets, so
 * the tail still carries signal where the averages carry none. `maxMs` and `slowFrames` are that tail;
 * `blobMaxMs`/`uploadMaxMs`/`pendingMax` are what a streaming hitch is MADE of, so a budget that moves can
 * say which of the two it moved.
 */
export function hitchStats(
  samples: readonly LegSample[],
  slowFrameMs: number,
): { blobMaxMs: number; maxMs: number; p99Ms: number; pendingMax: number; slowFrames: number; uploadMaxMs: number } {
  if (samples.length === 0) {
    return { blobMaxMs: 0, maxMs: 0, p99Ms: 0, pendingMax: 0, slowFrames: 0, uploadMaxMs: 0 };
  }
  const sortedMs = samples.map((sample) => sample.frameMs).sort((a, b) => a - b);
  const max = (values: readonly number[]): number => values.reduce((best, value) => Math.max(best, value), 0);

  return {
    blobMaxMs: Number(max(samples.map((sample) => sample.streamBlobMs)).toFixed(3)),
    maxMs: Number(sortedMs[sortedMs.length - 1].toFixed(3)),
    p99Ms: Number((sortedMs[Math.min(sortedMs.length - 1, Math.floor(sortedMs.length * 0.99))] ?? 0).toFixed(3)),
    pendingMax: max(samples.map((sample) => sample.pendingCells)),
    // The same threshold the host prints `[slow]` at, so the count and the console lines are one instrument.
    slowFrames: samples.filter((sample) => sample.frameMs > slowFrameMs).length,
    uploadMaxMs: Number(max(samples.map((sample) => sample.streamUploadMs)).toFixed(3)),
  };
}

/** Residency by ledger category, MB (074/21 P3 — the sweep-accumulation diagnosis): non-zero buckets only. */
export function ledgerBreakdown(engine: Engine): string {
  return Object.entries(engine.ledger())
    .filter(([, entry]) => entry.bytes > 0)
    .map(([category, entry]) => `${category} ${(entry.bytes / 1048576).toFixed(0)}`)
    .join(' · ');
}

/** Wire the bench/soak runners when the URL asks for them; a no-op otherwise. */
export function setupPerfRuns(host: PerfRunsHost): void {
  const benchKey = host.params.get('bench');
  const soakMinutes = parseSoakMinutes(host.params.get('soak'));
  if (!benchKey && soakMinutes === 0) {
    return;
  }
  const flyAt = (scene: BenchScene, t: number): void => {
    const pose = samplePath(scene.path, t);
    host.setBenchCamera({
      eye: host.toEngine(pose.pos),
      target: host.toEngine(pose.look),
    });
  };
  /** Where the settle actually put the player — the reference the leg-start probe is judged against, and
   *  the number the report row states so a reader can see what the run was configured with. */
  let settledZ: null | number = null;
  // Shared leg mechanics (bench + soak): teleport + settle + warmup OUTSIDE the capture, then the timed
  // flight with frame sampling. Bench formats the plan-063 report; soak accumulates stability intervals.
  const settleAt = async (scene: BenchScene): Promise<void> => {
    host.setHour(scene.hour);
    host.setWeather(scene.weather);
    host.teleportPlayer(scene.anchor);
    flyAt(scene, 0);
    // Settle in three gates, and a sweep needs all three (plan 102 — the first two are the recipe phys and
    // video runs already carry). The NOTICE first: polling straight after the warp reads the ring the player
    // LEFT, which is drained, so the settle used to exit on frame 1 with the new ring untouched.
    await waitSeconds(TELEPORT_NOTICE_SECONDS);
    await until(() => host.getStream()?.pendingCells === 0, host.settleTimeoutMs);
    // Then the GROUND, which the ring says nothing about: collision is built in a promise continuation
    // behind it and loses the race under sweep load by a second or two.
    await until(() => host.groundBelow(scene.anchor, GROUND_PROBE_DROP) !== null, host.settleTimeoutMs);
    // Put him back ON THAT GROUND — not on the anchor, which is authored for the CAMERA and stands metres
    // above the surface. Gravity is integrated whether or not the world is there, so he has been falling for
    // as long as the gates took, and a warp to the anchor would only restart the fall. The warp resets his
    // motion state; the small lift lands him instead of spawning him inside the surface.
    const groundZ = host.groundBelow(scene.anchor, GROUND_PROBE_DROP);
    settledZ = groundZ === null ? scene.anchor[2] : groundZ + SETTLE_LIFT;
    host.teleportPlayer([scene.anchor[0], scene.anchor[1], settledZ]);
    // Finally, wait for him to be AT REST. Where the probe ray lands is not always where he can stand: at
    // strip-noon it answers with a rooftop he then slides off (measured 2026-08-09, deterministic), and a
    // player still moving churns streaming and the LOD rings all through the capture. Whatever he ends up
    // standing on, the leg starts from a stopped player.
    await until(() => host.playerProbe().grounded, REST_TIMEOUT_MS);
    await waitSeconds(WARMUP_SECONDS);
  };
  const flyLeg = async (
    scene: BenchScene,
  ): Promise<{ lateCreates: number; legStart: LegProbe; samples: LegSample[] }> => {
    host.beginSamples();
    const lateStart = host.getStream()?.lateCreates ?? 0; // late-create DELTA over the measure window (074/21 P3)
    // The permanent leg-start probe (plan 102): the falls were silent for a month because no instrument
    // could print non-zero. Taken HERE, on the first captured frame, and judged in the report row.
    const start = host.playerProbe();
    const pendingCells = host.getStream()?.pendingCells ?? 0;
    let previousZ = start.z;
    let worstDrop = 0;
    const runStart = performance.now();
    let t = 0;
    while (t < 1) {
      t = Math.min(1, (performance.now() - runStart) / 1000 / scene.durationS);
      flyAt(scene, t);
      await nextFrame();
      const z = host.playerProbe().z;
      worstDrop = Math.max(worstDrop, previousZ - z);
      previousZ = z;
    }
    const samples = host.takeSamples();
    host.setBenchCamera(null);
    const targetZ = settledZ ?? scene.anchor[2];
    const dz = start.z - targetZ;

    return {
      lateCreates: (host.getStream()?.lateCreates ?? 0) - lateStart,
      legStart: {
        dz: Number(dz.toFixed(2)),
        grounded: start.grounded,
        // `dz` is CONTEXT, not a verdict: where he stands is the scene's business (a rooftop the settle
        // found is a legitimate place to stand), while a player still MOVING is what invalidates the row.
        ok: start.grounded && worstDrop <= PROBE_MAX_DROP && pendingCells === 0,
        pendingCells,
        targetZ: Number(targetZ.toFixed(2)),
        worstDrop: Number(worstDrop.toFixed(2)),
      },
      samples,
    };
  };
  const runScene = async (scene: BenchScene): Promise<void> => {
    await settleAt(scene);
    const { lateCreates, legStart, samples } = await flyLeg(scene);
    const avg = (values: readonly number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const sortedMs = samples.map((sample) => sample.frameMs).sort((a, b) => a - b);
    const avgMs = avg(sortedMs);
    const gpuSamples = samples.filter((sample) => sample.gpuMs > 0).map((sample) => sample.gpuMs);
    const postSamples = samples.filter((sample) => sample.postMs > 0).map((sample) => sample.postMs);
    const probeSamples = samples.filter((sample) => sample.probeMs > 0).map((sample) => sample.probeMs);
    const report = {
      avgDrawCalls: Math.round(avg(samples.map((sample) => sample.draws))),
      avgMs: Number(avgMs.toFixed(3)),
      avgTriangles: Math.round(avg(samples.map((sample) => sample.triangles))),
      fps: Number((1000 / Math.max(0.001, avgMs)).toFixed(1)),
      frames: samples.length,
      gpuMs: {
        pass: Number(avg(gpuSamples).toFixed(3)),
        post: Number(avg(postSamples).toFixed(3)),
        probe: Number(avg(probeSamples).toFixed(3)),
        submit: Number(avg(samples.map((sample) => sample.submitMs)).toFixed(3)),
      },
      // The TAIL, which is the only cost column a frame cap cannot pin (lod-procobj 013's opensa budget).
      hitch: hitchStats(samples, host.slowFrameMs),
      key: scene.key,
      // The fog-mask honesty gate (074/21 P3): creates inside the fog cut during the measure window.
      lateCreates,
      // Where the player stood when the capture began, and the worst he moved during it (plan 102): a row
      // whose `ok` is false was measured while he fell, and its cost columns compare nothing.
      legStart,
      p95Ms: Number((sortedMs[Math.floor(sortedMs.length * 0.95)] ?? 0).toFixed(3)),
      // Residency at scene end + its category breakdown — the sweep-accumulation diagnosis (074/21 P3).
      residency: ledgerBreakdown(host.engine),
      // The vehicle slice against 081/07 §3's budget: mean and worst cost of ONE fixed step, beside the
      // car count that produced it. Frames with no fixed step (the loop caught up) carry no vehicle work
      // and would drag the mean toward zero, so they are left out rather than counted as free steps.
      vehicles: vehicleStepCost(samples),
    };
    // eslint-disable-next-line no-console -- the bench deliverable IS this JSON line (plan 063 protocol)
    console.log('[bench]', JSON.stringify(report));
    if (!legStart.ok) {
      // The `[fall]` tag on purpose: the fallwatch run (TAG='[fall]') then catches a bench leg that measured
      // a falling camera as well as the camera watch's own streak marker.
      // eslint-disable-next-line no-console -- the verdict has to be visible in the run log, not only in JSON
      console.warn(
        `[fall] ${scene.key} leg started off its anchor: dz ${legStart.dz} m · grounded ${String(legStart.grounded)} · ` +
          `pending ${legStart.pendingCells} · worst frame drop ${legStart.worstDrop} m`,
      );
    }
  };
  // Road cars (074 bench realism): typed cars from vehicles.ide on the path-node road graph around
  // every measured scene, registered LAZILY — the vehicle-lod system streams them exactly like the
  // game's own parked cars, so each scene measures a realistic vehicle load. Shared with the prod
  // three host (canvas-host) so the C1 baseline sweeps the SAME population.
  const registerRoadCars = (targetScenes: readonly BenchScene[]): void => {
    const vehicles = host.getVehicles();
    const placements = benchRoadCarPlacements(host.fs, targetScenes, host.params.get('benchcar'));
    if (vehicles && placements.length > 0) {
      vehicles.register(placements);
    } else if (targetScenes.some((scene) => scene.cars !== undefined)) {
      // eslint-disable-next-line no-console -- a silent empty street would read as a false measurement
      console.warn('[bench] road cars SKIPPED: no vehicle system, path graph or car models');
    }
    // eslint-disable-next-line no-console -- bench CLI feedback (the record's context, same protocol)
    console.log(`[bench] road cars registered: ${vehicles ? placements.length : 0}`);
  };
  // Printed ONCE per sweep, because it does not vary by scene: what the adapter offers, what it LACKS, its
  // feature level, and the size the run was taken at. On a phone the missing half is the schema — no
  // `timestamp-query` means the `gpuMs` column below is absent rather than zero, and a reader who cannot
  // see that will compare the row to a desktop one (`docs/benchmarks/readme.md`, mobile schema).
  const reportDevice = (): void => {
    // eslint-disable-next-line no-console -- same `[bench]` protocol; this line IS part of the record
    console.log('[bench] device', JSON.stringify(host.engine.deviceReport));
  };
  if (benchKey) {
    reportDevice();
    const scenes = benchKey === 'all' ? BENCH_SCENES : BENCH_SCENES.filter((scene) => scene.key === benchKey);
    if (scenes.length === 0) {
      // eslint-disable-next-line no-console -- bench CLI feedback, same as prod
      console.warn(`[bench] unknown scene '${benchKey}' — known: all, ${BENCH_SCENES.map((s) => s.key).join(', ')}`);
    }
    void (async (): Promise<void> => {
      registerRoadCars(scenes);
      for (const scene of scenes) {
        await runScene(scene);
      }
      // eslint-disable-next-line no-console -- bench CLI feedback, same as prod
      console.log('[bench] sweep complete');
    })();
  } else {
    void runSoak(
      {
        flyLeg,
        registerRoadCars,
        sample: () => ledgerSample(host.engine, host.getStream()),
        setStatus: (text: string): void => {
          host.setSoakStatus(text);
        },
        settleAt,
      },
      BENCH_SCENES,
      soakMinutes,
      host.slowFrameMs,
    );
  }
}

/** Soak residency snapshot (074/10 ③): ledger totals + the texture bucket + streamed cells. */
function ledgerSample(
  engine: Engine,
  stream: null | StreamStats,
): { cells: number; residencyMb: number; textureMb: number } {
  const ledger = engine.ledger();
  let totalBytes = 0;
  for (const entry of Object.values(ledger)) {
    totalBytes += entry.bytes;
  }

  return {
    cells: stream?.loadedCells ?? 0,
    residencyMb: Math.round(totalBytes / 1048576),
    textureMb: Math.round((ledger.texture?.bytes ?? 0) / 1048576),
  };
}

/**
 * The vehicle slice PER FIXED STEP (081/07 §3's ≤ 0.5 ms budget), from the frames that actually stepped.
 *
 * A frame's `vehicleFixedMs` covers every step it ran, so the per-step cost is the ratio — averaging the
 * frame numbers instead would read a catch-up frame (two steps) as if one step had cost double. `live` is
 * the busiest car count seen, because the budget is stated for eight and a mean would hide the moment it
 * was reached.
 */
function vehicleStepCost(samples: readonly LegSample[]): { live: number; maxMs: number; meanMs: number } {
  const stepped = samples.filter((sample) => sample.fixedSteps > 0);
  if (stepped.length === 0) {
    return { live: 0, maxMs: 0, meanMs: 0 };
  }
  const perStep = stepped.map((sample) => sample.vehicleFixedMs / sample.fixedSteps);

  return {
    live: Math.max(...stepped.map((sample) => sample.liveVehicles)),
    maxMs: Number(Math.max(...perStep).toFixed(3)),
    meanMs: Number((perStep.reduce((sum, value) => sum + value, 0) / perStep.length).toFixed(3)),
  };
}
