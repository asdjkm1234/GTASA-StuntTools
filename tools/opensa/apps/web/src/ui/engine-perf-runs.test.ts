/**
 * The bench settle gate (plan 102). Both negative cases replay the FIELD sequence that put the player under
 * the mesh for a whole sweep: the ring poll answers for the ring around the PREVIOUS anchor (already
 * drained), and nothing anywhere waits for collision. The scene under test is `ocean-horizon` on purpose —
 * it is the one whose anchor was moved onto the sand in 2026-07 to work this same class around
 * (78046648), and the only scene with no road cars, so the game fs is never touched.
 *
 * A race is only nondeterministic in the FIELD: here the frame clock and the collision promise are both
 * held in the test's hand, so "the collision lost the race" is a pinned ordering.
 */
import type { Engine, StreamStats } from '@opensa/engine';
import type { ModelColliders } from '@opensa/game/interfaces/collider.interface';
import type { AssetFileSystem } from '@opensa/renderware';

import { CharacterControllerSystem } from '@opensa/game/character/character-controller.system';
import { Locomotion, PlayerControlled, RigidBody, Transform, Velocity } from '@opensa/game/ecs/components';
import { createEcsWorld } from '@opensa/game/ecs/world';
import { KeyboardSource } from '@opensa/game/input';
import { PhysicsWorld } from '@opensa/game/physics/physics-world';
import { initRapier } from '@opensa/game/physics/rapier';
import { CollisionStreamingSystem } from '@opensa/game/streaming/collision-streaming.system';
import { Matrix4, type Vector3 } from '@opensa/math';
import { addComponent, addEntity } from 'bitecs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LegProbe, LegSample, PerfRunsHost } from './engine-perf-runs';

import { BENCH_SCENES } from '../bench-scenes';
import { hitchStats, setupPerfRuns } from './engine-perf-runs';
import { createGameRuntimeConfig } from './game-runtime-config';

/** The host's own capsule (engine-canvas-host) — the test player must stand exactly as the field one does. */
const CAPSULE_HALF_HEIGHT = 0.55;
const CAPSULE_RADIUS = 0.35;

const FRAME_MS = 1000 / 60;
const STEP = 1 / 60;

/** `WORLD_READY_TIMEOUT_MS` in the host — the settle budget the runs are wired with. */
const SETTLE_TIMEOUT_MS = 12000;

/** The warmup `settleAt` runs after the ring gate, in frames — a leg starts this long after the gate opens. */
const WARMUP_FRAMES = Math.ceil(1500 / FRAME_MS);

const OCEAN = BENCH_SCENES.filter((scene) => scene.key === 'ocean-horizon')[0];

/** Polls after a teleport that still answer for the PREVIOUS anchor's ring — the field's "ring drained (1 frames)". */
const STALE_POLL_FRAMES = 4;
/** Frames after the teleport at which the NEW anchor's ring finishes loading (past the warmup on purpose). */
const RING_DRAINED_FRAME = 260;

/** The fields of a printed `[bench]` row the tests read back. */
interface BenchRow {
  hitch: Record<string, number>;
  legStart: LegProbe;
}

/** What the leg-start probe sees the moment sampling begins — the plan-102 report row, taken in the test. */
interface LegStart {
  frame: number;
  grounded?: boolean;
  pendingCells: number;
  playerZ?: number;
}

/** The `[bench] {json}` rows a sweep printed, by scene key — that console line IS the deliverable. */
const reports = new Map<string, BenchRow>();

afterEach(() => {
  reports.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('setupPerfRuns settle', () => {
  describe('negative cases', () => {
    it('does not begin a leg while the new anchor’s ring is still pending (the stale poll)', async () => {
      const clock = installFrameClock();
      let teleportFrame = -1; // the frame the scene's FIRST teleport landed on (frame 0 is a real answer)
      let sawPending = false;
      const legStart: LegStart[] = []; // pushed once, by the first beginSamples the sweep makes
      // The ring around the OLD anchor is already drained, so the first polls answer 0 for a ring that has
      // nothing to do with where the player now stands; the driver retargets a few frames later.
      const pendingAt = (frame: number): number => {
        const since = frame - teleportFrame;

        return since <= STALE_POLL_FRAMES || since >= RING_DRAINED_FRAME ? 0 : 81;
      };
      const swept = untilSweepComplete();
      setupPerfRuns({
        ...silentHost(),
        beginSamples: (): void => {
          legStart.push({ frame: clock.frame(), pendingCells: pendingAt(clock.frame()) });
        },
        getStream: (): StreamStats => {
          const pendingCells = pendingAt(clock.frame());
          sawPending ||= pendingCells > 0;

          return streamStats(pendingCells);
        },
        params: new URLSearchParams(`bench=${OCEAN.key}`),
        teleportPlayer: (): void => {
          if (teleportFrame < 0) {
            teleportFrame = clock.frame(); // the settle's re-warp goes to the SAME anchor: the ring is unchanged
          }
        },
      });

      await swept;

      // The instrument could have printed non-zero: the replayed ring really did report a pending queue.
      expect(sawPending).toBe(true);
      expect(legStart[0]?.pendingCells).toBe(0);
      expect(legStart[0]?.frame ?? 0).toBeGreaterThanOrEqual(teleportFrame + RING_DRAINED_FRAME);
    });

    it('does not begin a leg with the player under the mesh when collision arrives late', async () => {
      const world = await physicalWorld();
      const clock = installFrameClock(() => world.tick());
      const legStart: LegStart[] = []; // pushed once, by the first beginSamples the sweep makes
      const swept = untilSweepComplete();
      setupPerfRuns({
        ...silentHost(),
        beginSamples: (): void => {
          legStart.push({
            frame: clock.frame(),
            grounded: world.grounded(),
            pendingCells: 0,
            playerZ: world.playerZ(),
          });
        },
        // The render ring is drained the whole time — only the GROUND can hold this leg back.
        getStream: (): StreamStats => streamStats(0),
        groundBelow: (at, maxDrop): null | number => world.groundBelow(at, maxDrop),
        params: new URLSearchParams(`bench=${OCEAN.key}`),
        playerProbe: (): { grounded: boolean; z: number } => ({ grounded: world.grounded(), z: world.playerZ() }),
        // Exactly what the host wires today (engine-canvas-host: perf-runs' own inline teleport).
        teleportPlayer: (anchor): void => {
          world.teleport([anchor[0], anchor[1], anchor[2]]);
        },
      });

      await swept;

      // The colliders under the anchor really did arrive late, and they really did arrive.
      expect(world.groundReleasedAtFrame()).toBeGreaterThan(WARMUP_FRAMES);
      expect(world.groundExists()).toBe(true);
      // The leg-start probe of the fix (plan 102 step 2), taken here: the player stands ON the anchor.
      expect(legStart[0]?.playerZ ?? 0).toBeCloseTo(OCEAN.anchor[2], 1);
      expect(legStart[0]?.grounded).toBe(true);
      world.dispose();
    });

    it('does not drop the player down to the ground when the anchor stands metres above it', async () => {
      // A scene anchor is authored for the CAMERA: six of the nine sit 3.65-26.29 m above their ground and
      // `ocean-horizon`'s own is 43.75 m up (measured 2026-08-09). Warping to it therefore means a fall.
      //
      // The fall is NOT observable at leg start — the rest gate (3 s) plus the warmup (1.5 s) give him 4.5 s
      // to land, which covers every floor the 60 m probe can even find, so the leg begins grounded either
      // way. Nor is the lowest point: he is already falling from the anchor while the gates wait, so both
      // versions bottom out on the same floor. What the warp target actually decides is how far he is made
      // to fall PER SCENE TRANSITION — once (placed on the ground) or twice (dropped onto it again) — and
      // residency is anchored to him, so every one of those metres empties and refills the district.
      const world = await physicalWorld({ groundDepth: 55 });
      const clock = installFrameClock(() => world.tick());
      const legStart: LegStart[] = [];
      const swept = untilSweepComplete();
      setupPerfRuns({
        ...silentHost(),
        beginSamples: (): void => {
          legStart.push({
            frame: clock.frame(),
            grounded: world.grounded(),
            pendingCells: 0,
            playerZ: world.playerZ(),
          });
        },
        getStream: (): StreamStats => streamStats(0),
        groundBelow: (at, maxDrop): null | number => world.groundBelow(at, maxDrop),
        params: new URLSearchParams(`bench=${OCEAN.key}`),
        playerProbe: (): { grounded: boolean; z: number } => ({ grounded: world.grounded(), z: world.playerZ() }),
        teleportPlayer: (anchor): void => {
          world.teleport([anchor[0], anchor[1], anchor[2]]);
        },
      });

      await swept;

      expect(legStart[0]?.grounded).toBe(true);
      expect(legStart[0]?.playerZ ?? 0).toBeCloseTo(world.restingZ(), 1); // standing on the real floor…
      // …having descended the 55 m gap ONCE. Warping to the anchor instead makes him fall it twice.
      expect(world.descent()).toBeLessThan(75);
      world.dispose();
    });

    it('marks the row RED and prints [fall] when the player never lands', async () => {
      // A scene whose anchor has no floor at all (strip-noon was one). The sweep must still finish, and the
      // row must refuse itself: the whole point of the probe is that a fall can no longer be silent.
      const world = await physicalWorld({ groundArrivesAtFrame: null });
      installFrameClock(() => world.tick());
      const swept = untilSweepComplete();
      const falls: string[] = [];
      vi.spyOn(console, 'warn').mockImplementation((line: unknown): void => {
        falls.push(String(line));
      });
      setupPerfRuns({
        ...silentHost(),
        getStream: (): StreamStats => streamStats(0),
        groundBelow: (at, maxDrop): null | number => world.groundBelow(at, maxDrop),
        params: new URLSearchParams(`bench=${OCEAN.key}`),
        playerProbe: (): { grounded: boolean; z: number } => ({ grounded: world.grounded(), z: world.playerZ() }),
        teleportPlayer: (anchor): void => {
          world.teleport([anchor[0], anchor[1], anchor[2]]);
        },
      });

      await swept; // the wait for rest is BOUNDED — a floorless anchor may not hang the sweep

      expect(world.groundExists()).toBe(false); // the instrument was pointed at a real hole
      expect(reportOf(OCEAN.key).legStart.ok).toBe(false);
      expect(reportOf(OCEAN.key).legStart.grounded).toBe(false);
      expect(falls.filter((line) => line.startsWith('[fall]'))).toHaveLength(1);
      world.dispose();
    });
  });

  describe('positive cases', () => {
    it('begins the leg promptly when the ring is drained and the ground is already there', async () => {
      const clock = installFrameClock();
      const legStart: LegStart[] = []; // pushed once, by the first beginSamples the sweep makes
      const swept = untilSweepComplete();
      setupPerfRuns({
        ...silentHost(),
        beginSamples: (): void => {
          legStart.push({ frame: clock.frame(), pendingCells: 0 });
        },
        getStream: (): StreamStats => streamStats(0),
        params: new URLSearchParams(`bench=${OCEAN.key}`),
      });

      await swept;

      // A settle that waits out its whole timeout on a world that is READY is the other way to be wrong.
      expect(legStart[0]?.frame ?? 0).toBeLessThan(SETTLE_TIMEOUT_MS / FRAME_MS);
    });

    it('carries the hitch block into the printed row, streaming columns included', async () => {
      // The gap the unit tests above leave: `hitchStats` is proven, but nothing proved its numbers REACH
      // the report. The field cannot close it either — a settled leg streams nothing, so `blobMaxMs`,
      // `uploadMaxMs` and `pendingMax` printed 0 on all five arms of the 2026-08-10 run, and a zero from an
      // instrument that has never printed non-zero is not evidence. Here they are made non-zero on purpose.
      const swept = untilSweepComplete();
      installFrameClock();
      setupPerfRuns({
        ...silentHost(),
        params: new URLSearchParams(`bench=${OCEAN.key}`),
        takeSamples: (): LegSample[] => [
          frame({ frameMs: 8.333 }),
          frame({ frameMs: 37.5, pendingCells: 9, streamBlobMs: 26.75, streamUploadMs: 3.25 }),
          frame({ frameMs: 8.4, pendingCells: 2 }),
        ],
      });

      await swept;

      expect(reportOf(OCEAN.key).hitch).toEqual({
        blobMaxMs: 26.75,
        maxMs: 37.5,
        p99Ms: 37.5,
        pendingMax: 9,
        slowFrames: 1,
        uploadMaxMs: 3.25,
      });
    });
  });
});

describe('hitchStats', () => {
  describe('negative cases', () => {
    it('reports zeroes for an empty leg rather than reading past the end of the samples', () => {
      expect(hitchStats([], 20)).toEqual({
        blobMaxMs: 0,
        maxMs: 0,
        p99Ms: 0,
        pendingMax: 0,
        slowFrames: 0,
        uploadMaxMs: 0,
      });
    });

    it('does not let a vsync-pinned leg hide its hitch — the mean and the p95 both sit on the frame period', () => {
      // The measured A/A shape: 199 capped frames and one 41 ms stall. p95 lands on a capped frame, so the
      // column the budget used to be read off says the leg was clean.
      const samples = [...capped(199), frame({ frameMs: 41, streamBlobMs: 33 })];
      const sortedMs = samples.map((sample) => sample.frameMs).sort((a, b) => a - b);
      expect(sortedMs[Math.floor(sortedMs.length * 0.95)]).toBe(8.333);

      const hitch = hitchStats(samples, 20);
      expect(hitch.maxMs).toBe(41);
      expect(hitch.slowFrames).toBe(1);
      expect(hitch.blobMaxMs).toBe(33);
    });

    it('counts no slow frame when every frame is under the host’s own [slow] threshold', () => {
      expect(hitchStats([...capped(50), frame({ frameMs: 19.9 })], 20).slowFrames).toBe(0);
    });

    it('does not see a stall rarer than one frame in a hundred in p99 either', () => {
      // Two stalls in 300 frames is 0.67 % of the leg, so the 99th percentile lands on a capped frame. A
      // real sweep flies ~1800 frames, where p99 is the worst EIGHTEEN — it answers about sustained
      // degradation, never about the seen-once stall. That is what `maxMs` and `slowFrames` are for.
      const hitch = hitchStats([...capped(298), frame({ frameMs: 30 }), frame({ frameMs: 52 })], 20);

      expect(hitch.p99Ms).toBe(8.333);
      expect(hitch.maxMs).toBe(52);
      expect(hitch.slowFrames).toBe(2);
    });
  });

  describe('positive cases', () => {
    it('takes the worst frame, the worst blob and upload spike, and the deepest backlog', () => {
      const hitch = hitchStats(
        [
          frame({ frameMs: 8.4, pendingCells: 2, streamBlobMs: 1.5, streamUploadMs: 0.4 }),
          frame({ frameMs: 26.5, pendingCells: 11, streamBlobMs: 18.25, streamUploadMs: 2.75 }),
          frame({ frameMs: 9.1, pendingCells: 7, streamBlobMs: 0, streamUploadMs: 1.1 }),
        ],
        20,
      );

      expect(hitch).toEqual({
        blobMaxMs: 18.25,
        maxMs: 26.5,
        p99Ms: 26.5,
        pendingMax: 11,
        slowFrames: 1,
        uploadMaxMs: 2.75,
      });
    });

    it('moves p99 when the degradation is sustained rather than seen-once', () => {
      // 10 % of the leg spent at 25 ms — the shape of a streaming budget actually being exceeded, as
      // opposed to one stall. This is the column that separates the two.
      const hitch = hitchStats([...capped(270), ...Array.from({ length: 30 }, () => frame({ frameMs: 25 }))], 20);

      expect(hitch.p99Ms).toBe(25);
      expect(hitch.slowFrames).toBe(30);
    });
  });
});

/** A leg's worth of frames pinned to the 120 Hz period — the shape every headless scene measures at DPR=2. */
function capped(count: number): LegSample[] {
  return Array.from({ length: count }, () => frame({ frameMs: 8.333 }));
}

/** One sampled frame; every column a hitch is not about defaults to a healthy value. */
function frame(over: Partial<LegSample>): LegSample {
  return {
    draws: 0,
    fixedSteps: 1,
    frameMs: 8.333,
    gpuMs: 0,
    liveVehicles: 0,
    pendingCells: 0,
    postMs: 0,
    probeMs: 0,
    streamBlobMs: 0,
    streamUploadMs: 0,
    submitMs: 0,
    triangles: 0,
    vehicleFixedMs: 0,
    ...over,
  };
}

/** A flat slab of collision `depth` metres under an anchor — the cell's ground, as the adapter hands it over. */
function groundUnder(anchor: readonly [number, number, number], depth: number): ModelColliders {
  const top = anchor[2] - depth;

  return {
    name: 'test-ground',
    shape: {
      boxes: [
        {
          max: [anchor[0] + 400, anchor[1] + 400, top],
          min: [anchor[0] - 400, anchor[1] - 400, top - 2],
        },
      ],
      indices: new Uint32Array(),
      spheres: [],
      vertices: new Float32Array(),
    },
    transforms: [new Matrix4()],
  };
}

/**
 * The frame clock the runs poll: `performance.now` and `requestAnimationFrame` both advance one fixed frame
 * per callback, so a settle/warmup/leg measured in milliseconds is measured in FRAMES here — deterministic,
 * and a 15 s leg costs no wall time. `onFrame` runs before the callback (the host's simulation step).
 */
function installFrameClock(onFrame?: () => void): { frame: () => number } {
  let frame = 0;
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frame += 1;
    now += FRAME_MS;
    queueMicrotask(() => {
      onFrame?.();
      callback(now);
    });

    return frame;
  });

  return { frame: (): number => frame };
}

/**
 * A real physics world with the host's player capsule and its collision streaming, driven per frame.
 *
 * `groundDepth` is how far BELOW the scene anchor the cell's floor sits — the default puts it exactly under
 * the capsule's feet, which is the one case where "warp to the anchor" and "warp onto the ground" look the
 * same. Scenes in the real map are not like that (measured 2026-08-09: six of nine anchors sit 3.65-26.29 m
 * above their ground), so a test that only ever uses the default cannot see the difference.
 * `groundArrivesAtFrame: null` is a floor that never comes at all.
 */
async function physicalWorld(options: { groundArrivesAtFrame?: null | number; groundDepth?: number } = {}): Promise<{
  descent: () => number;
  dispose: () => void;
  groundBelow: (at: readonly [number, number, number], maxDrop: number) => null | number;
  grounded: () => boolean;
  groundExists: () => boolean;
  groundReleasedAtFrame: () => number;
  playerZ: () => number;
  restingZ: () => number;
  teleport: (position: [number, number, number]) => void;
  tick: () => void;
}> {
  const groundDepth = options.groundDepth ?? CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;
  const groundArrivesAtFrame =
    options.groundArrivesAtFrame === undefined ? WARMUP_FRAMES * 2 : options.groundArrivesAtFrame;
  const config = createGameRuntimeConfig();
  const physics = new PhysicsWorld(await initRapier());
  const controller = physics.createCharacterController();
  const spawn: [number, number, number] = [OCEAN.anchor[0], OCEAN.anchor[1], OCEAN.anchor[2]];
  const capsule = physics.createKinematicCapsule(spawn, CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT);

  const ecs = createEcsWorld();
  const player = addEntity(ecs);
  addComponent(ecs, player, Transform);
  addComponent(ecs, player, PlayerControlled);
  addComponent(ecs, player, RigidBody);
  addComponent(ecs, player, Velocity);
  addComponent(ecs, player, Locomotion);
  Transform.x[player] = spawn[0];
  Transform.y[player] = spawn[1];
  Transform.z[player] = spawn[2];
  Velocity.x[player] = 0;
  Velocity.y[player] = 0;
  Velocity.z[player] = 0;
  Velocity.grounded[player] = 0;
  Locomotion.heading[player] = 0;
  Locomotion.state[player] = 0;
  Locomotion.stateTime[player] = 0;
  Locomotion.fallSpeed[player] = 0;
  RigidBody.handle[player] = capsule.body;
  RigidBody.collider[player] = capsule.collider;

  const positionOf = (): [number, number, number] => {
    const [x, y, z] = physics.readBody(capsule.body).position;

    return [x, y, z];
  };
  const controllerSystem = new CharacterControllerSystem(
    ecs,
    physics,
    new KeyboardSource({ isDown: (): boolean => false }, config.controls),
    config,
    controller,
    { getWorldDirection: (target): Vector3 => target.set(0, 0, -1) },
  );
  // The adapter's promise is HELD by the test: the cell's colliders build only once it is released, which is
  // the field race (an async continuation losing to the sweep) turned into an ordering.
  let releaseGround: () => void = vi.fn();
  let groundReleasedAtFrame = 0;
  const ground = new Promise<ModelColliders[]>((resolve) => {
    releaseGround = (): void => resolve([groundUnder(OCEAN.anchor, groundDepth)]);
  });
  const collision = new CollisionStreamingSystem(
    { cellSize: config.streaming.cellSize, loadCellColliders: (): Promise<ModelColliders[]> => ground },
    physics,
    positionOf,
    config,
  );

  let frame = 0;
  let descent = 0;
  let previousZ: null | number = null;

  return {
    descent: (): number => descent,
    dispose: (): void => physics.dispose(),
    groundBelow: (at, maxDrop): null | number => physics.groundBelow([at[0], at[1], at[2]], maxDrop, capsule.body),
    grounded: (): boolean => Velocity.grounded[player] === 1,
    groundExists: (): boolean => physics.groundBelow([spawn[0], spawn[1], OCEAN.anchor[2] + 50], 100) !== null,
    groundReleasedAtFrame: (): number => groundReleasedAtFrame,
    playerZ: (): number => positionOf()[2],
    restingZ: (): number => OCEAN.anchor[2] - groundDepth + CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS,
    teleport: (position: [number, number, number]): void => {
      physics.teleport(capsule.body, position);
    },
    tick: (): void => {
      frame += 1;
      // Late by construction: the colliders land well after the warmup a leg starts on.
      if (frame === groundArrivesAtFrame) {
        groundReleasedAtFrame = frame;
        releaseGround();
      }
      collision.update();
      controllerSystem.fixedUpdate(STEP);
      physics.step(STEP);
      const [x, y, z] = positionOf();
      descent += Math.max(0, (previousZ ?? z) - z); // metres travelled DOWNWARD, teleports included
      previousZ = z;
      Transform.x[player] = x;
      Transform.y[player] = y;
      Transform.z[player] = z;
    },
  };
}

/** The report row a sweep printed for a scene; throws rather than let a missing row read as a pass. */
function reportOf(key: string): { hitch: Record<string, number>; legStart: LegProbe } {
  const row = reports.get(key);
  if (row === undefined) {
    throw new Error(`no [bench] row was printed for '${key}'`);
  }

  return row;
}

/** The host accessors a settle test does not care about — every run overrides what it measures. */
function silentHost(): PerfRunsHost {
  return {
    beginSamples: vi.fn(),
    engine: { ledger: (): Record<string, never> => ({}) } as unknown as Engine,
    fs: {} as AssetFileSystem,
    getStream: (): StreamStats => streamStats(0),
    getVehicles: (): null => null,
    // A world whose ground is already there — the runs that measure the RING override this.
    groundBelow: (at): number => at[2] - 1,
    params: new URLSearchParams(),
    playerProbe: (): { grounded: boolean; z: number } => ({ grounded: true, z: OCEAN.anchor[2] }),
    setBenchCamera: vi.fn(),
    setHour: vi.fn(),
    setSoakStatus: vi.fn(),
    settleTimeoutMs: SETTLE_TIMEOUT_MS,
    setWeather: vi.fn(),
    slowFrameMs: 20,
    takeSamples: (): LegSample[] => [],
    teleportPlayer: vi.fn(),
    toEngine: (gta): [number, number, number] => [gta[0], gta[2], -gta[1]],
  };
}

function streamStats(pendingCells: number): StreamStats {
  return {
    blobMs: 0,
    created: 0,
    evicted: 0,
    lateCreates: 0,
    loadedCells: 81,
    pendingCells,
    uploadMs: 0,
    worstBlobMs: 0,
    worstCreateMs: 0,
  };
}

/** Resolves on the sweep's own last line — the runs are fire-and-forget, so their protocol is the join.
 *  Collects the report rows on the way through, since that console line is the only place they exist. */
function untilSweepComplete(): Promise<void> {
  return new Promise<void>((resolve) => {
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]): void => {
      if (parts[0] === '[bench]' && typeof parts[1] === 'string') {
        const row = JSON.parse(parts[1]) as { hitch: Record<string, number>; key: string; legStart: LegProbe };
        reports.set(row.key, row);
      }
      if (parts[0] === '[bench] sweep complete') {
        resolve();
      }
    });
  });
}
