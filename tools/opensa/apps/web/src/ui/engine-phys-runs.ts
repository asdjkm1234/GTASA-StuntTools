/**
 * Scripted physics laps (plan 081/01) — `?phys=<scene|all>&car=<model>`, the `[bench]` runner's twin.
 *
 * A lap teleports next to the spot, spawns the model, seats the player, lets the springs settle, then hands
 * the wheel to a {@link ScriptedDriveSource} timeline while the telemetry ring records every fixed step. What
 * comes out is one `[phys] {json}` line per lap — the protocol the headless harness collects and
 * `phys-compare` diffs.
 *
 * The DRIVING is the real thing (the timeline goes through the same `InputState` and the same `drive()` the
 * player uses); the getting-in is not. Three sweeps were lost to the walk-in cancelling itself on a stalled
 * path, so a lap seats the player directly — 081 tunes how a car drives, not how a ped opens a door.
 *
 * Everything outside the timed window (streaming settle, seating, the spring settle) happens with the
 * capture OFF, so a lap's frames are the drive and nothing else.
 */
import { type StreamStats } from '@opensa/engine';
import { type VehicleSpringReading, type VehicleStance } from '@opensa/game/physics/physics-world';
import { type PhysSummary, summarisePhysFrames, thinFrames } from '@opensa/game/vehicle/phys-capture';
import { type PhysScene, type ScriptedDriveSource } from '@opensa/game/vehicle/scripted-drive';
import { type TelemetryFrame } from '@opensa/game/vehicle/vehicle-telemetry';

import type { EngineVehicles } from './engine-vehicles';

import { PHYS_CARS, PHYS_SCENES } from '../phys-scenes';
import { until, waitSeconds } from './frame-clock';

/** What a lap needs from the engine host — thin accessors over its loop state, like `PerfRunsHost`. */
export interface PhysRunsHost {
  /** The ACTIVE air-control dial (plan 081/06 §1, `?airCtl`) — a jump capture that cannot say how much
   *  authority the driver had cannot be compared with any other jump capture. */
  airControl(): { scale: number };
  /** The scripted source installed in the host's CombinedInput; the fixed loop advances its clock. */
  drive: ScriptedDriveSource;
  getStream(): null | StreamStats;
  /** Live accessor — the vehicle system arrives asynchronously after boot. */
  getVehicles(): EngineVehicles | null;
  params: URLSearchParams;
  setHour(hour: number): void;
  /** The streaming-settle deadline after a teleport (the host's world-ready timeout). */
  settleTimeoutMs: number;
  /** Spawn a ground-snapped car of this model at a spot/heading (native GTA Z-up). */
  spawnCar(model: string, position: readonly [number, number, number], heading: number): Promise<void>;
  /** The ACTIVE speed-grip dials (plan 081/09) — recorded in every capture, because a tuning session's runs
   *  are incomparable unless each one states what it ran with. */
  speedGrip(): { cap: number; reference: number };
  /** Whether the surface-grip lookup was live for this run (081/10, `?surfGrip=0` turns it off) — a capture
   *  that cannot say which of the two worlds it drove in proves nothing about either. */
  surfaceGrip(): boolean;
  /** The world's surface table (081/10), for naming what the wheels reported standing on — null for a world
   *  without one, and then a capture simply carries the raw ids. */
  surfaces(): null | readonly { name: string }[];
  /** Teleport the player (streaming/collision anchor), GTA coords. */
  teleportPlayer(anchor: readonly [number, number, number]): void;
}

/** Midday: physics does not read the clock, but a capture that also gets screenshotted should be legible. */
const CAPTURE_HOUR = 12;
/**
 * How far to the side of the spot the ped stands. Inside the enter system's own 4 m range WITH margin: the
 * ground-snap slides a blocked spawn up to 3 m along the heading, and at a 4 m offset that put the car out of
 * range — two laps failed with a car sitting right there.
 */
const PED_OFFSET = 2.5;
/** Springs settle before the capture opens: a ground-snapped car is still moving on its suspension. */
const SETTLE_SECONDS = 2;
/** Grace after a teleport before `pendingCells` means anything — it answers for the ring you just left. */
const TELEPORT_NOTICE_SECONDS = 1;
/** After the ring drains: the collision parse behind it is what a spawn actually needs (the bench warmup). */
const WARMUP_SECONDS = 2;
/** How long a spawn keeps retrying while the ground under the spot streams in. */
const SPAWN_RETRY_SECONDS = 15;
/** A climb-in that has not finished by now is a broken spot, not a slow one. */
const ENTER_TIMEOUT_S = 20;
/** How long a lap's car gets to coast to a halt before the climb-out is asked for. */
const COAST_TIMEOUT_S = 20;
/** Below this speed (m/s) the car counts as stopped — the exit will not start above it. */
const STOPPED_SPEED = 0.5;
/** How far from the scene's spot the seated car may be and still be THIS lap's car. */
const SPOT_RADIUS = 20;
/** Series rate in the printed JSON. Peaks are taken over EVERY frame (see `summarisePhysFrames`), so
 *  thinning costs the curve resolution, never a number. */
const SERIES_HZ = 20;

/** Wire the scripted-lap runner when the URL asks for it; a no-op otherwise. */
export function setupPhysRuns(host: PhysRunsHost): void {
  const key = host.params.get('phys');
  if (!key) {
    return;
  }
  const scenes = key === 'all' ? PHYS_SCENES : PHYS_SCENES.filter((scene) => scene.key === key);
  const car = host.params.get('car') ?? PHYS_CARS[0];
  if (scenes.length === 0) {
    // eslint-disable-next-line no-console -- runner CLI feedback, same protocol as [bench]
    console.warn(`[phys] unknown scene '${key}' — known: all, ${PHYS_SCENES.map((scene) => scene.key).join(', ')}`);

    return;
  }
  void (async (): Promise<void> => {
    for (const scene of scenes) {
      try {
        await runScene(host, scene, car);
      } catch (error) {
        // eslint-disable-next-line no-console -- a lap that failed must SAY so; a missing line reads as a pass
        console.warn(`[phys] scene '${scene.key}' failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // eslint-disable-next-line no-console -- runner CLI feedback, same protocol as [bench]
    console.log('[phys] sweep complete');
  })();
}

/**
 * Get the ped out of whatever he is in, and confirm it.
 *
 * The exit refuses to start until the car has STOPPED (`stopping` brakes to a halt first), and a lap can end
 * at speed — the u-turn's timeline still has throttle on its last keyframe. So the car is left to coast down
 * before the press, or the climb-out silently outlasts the wait.
 */
async function leaveCar(host: PhysRunsHost, vehicles: EngineVehicles): Promise<void> {
  if (vehicles.activeVehicle() === null) {
    return;
  }
  host.drive.stop(); // no input: the car coasts down on its idle brake
  await until(() => Math.abs(vehicles.drivenMotion()?.speed ?? 0) < STOPPED_SPEED, COAST_TIMEOUT_S * 1000);
  await pressEnterExit(host);
  const left = await until(() => vehicles.activeVehicle() === null, ENTER_TIMEOUT_S * 1000);
  host.drive.stop();
  if (!left) {
    throw new Error('the ped never got out of the car — the next lap would have driven this one');
  }
}

/**
 * Re-key the summary's `surfaces` shares from SA material ids to NAMES (081/10). A capture that says
 * `{ "27": 0.31 }` is a lookup away from being readable and nobody performs it; `{ "dirttrack": 0.31 }` is
 * evidence. Ids with no row in the table keep their number, so a modded surface still shows up.
 */
function named(summary: PhysSummary, table: null | readonly { name: string }[]): PhysSummary {
  const entries = Object.entries(summary.surfaces);
  if (table === null || entries.length === 0) {
    return summary;
  }
  const surfaces: Record<string, number> = {};
  for (const [id, share] of entries) {
    surfaces[table[Number(id)]?.name ?? id] = share;
  }

  return { ...summary, surfaces };
}

/** Hold enter/exit for a moment: the system takes the PRESS edge, so it must also be released. */
async function pressEnterExit(host: PhysRunsHost): Promise<void> {
  host.drive.play([{ actions: ['enterExit'], t: 0 }, { t: 0.25 }]);
  await until(() => host.drive.time > 0.3, 2000);
}

function report(
  scene: PhysScene,
  car: string,
  frames: readonly TelemetryFrame[],
  springs: null | readonly VehicleSpringReading[],
  stance: null | VehicleStance,
  speedGrip: { cap: number; reference: number },
  surfaceTable: null | readonly { name: string }[],
  surfaceGrip: boolean,
  airControl: { scale: number },
): void {
  const capture = {
    // How much in-air authority the driver had (081/06 §1) — a jump lap says it, like every other dial.
    airControl,
    car,
    // Column-named so a reader (and phys-compare) never has to count positions.
    // WHERE the car was goes at the END of the row, never in the middle: `phys-compare` walks two series by
    // column index, and inserting a column would silently compare a capture's yaw against another's pitch.
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
    key: scene.key,
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
    // The dials this run ACTUALLY ran with (081/09) — a tuning session's captures are useless without them.
    speedGrip,
    // What the run was CONFIGURED with, per wheel. It used to record the first wheel alone, on the grounds
    // that every corner shared one spring — the authored axle bias (081/03) ended that, and a savanna
    // capture proved wheel 0 is not even reliably the front one. A capture that cannot say what it was
    // configured with cannot prove a change took effect.
    springs: springs ?? null,
    stance,
    summary: named(summarisePhysFrames(frames), surfaceTable),
    /** Whether grip came from the SURFACE under each wheel (081/10) or every wheel drove on tarmac. */
    surfaceGrip,
    what: scene.what,
  };
  // eslint-disable-next-line no-console -- the capture deliverable IS this JSON line (the [bench] twin)
  console.log('[phys]', JSON.stringify(capture));
}

async function runScene(host: PhysRunsHost, scene: PhysScene, car: string): Promise<void> {
  const vehicles = host.getVehicles();
  if (!vehicles) {
    throw new Error('no vehicle system on this host');
  }
  host.setHour(CAPTURE_HOUR);
  // On foot BEFORE the teleport, always. A seated rider is re-placed on his seat every fixed step, so
  // teleporting one drags him straight back to the car he is in — the second sweep lost four laps to it,
  // each reporting the honest but downstream symptom "the ped never got into the car".
  await leaveCar(host, vehicles);
  // The ped stands to the car's RIGHT of the road heading, so the spawn never lands on top of him.
  const [x, y, z] = scene.position;
  const beside: [number, number, number] = [
    x + Math.cos(scene.heading) * PED_OFFSET,
    y + Math.sin(scene.heading) * PED_OFFSET,
    z + 1,
  ];
  host.teleportPlayer(beside);
  // Settle, in three parts, all of them learned from the first sweep (5 of 7 laps failed without them):
  // the driver needs a moment to even NOTICE the teleport (`pendingCells` still reads the old ring and
  // answers 0 immediately), then the ring drains, then the collision parse behind it drains too.
  await waitSeconds(TELEPORT_NOTICE_SECONDS);
  await until(() => host.getStream()?.pendingCells === 0, host.settleTimeoutMs);
  await waitSeconds(WARMUP_SECONDS);
  await spawnWithRetry(host, scene, car);

  // Seat the player DIRECTLY. Three sweeps were spent on the walk-in: it cancels itself when the approach
  // path stalls, nothing retries it, and pressing again after a partial success made the ped climb back OUT.
  // A capture measures DRIVING — the climb-in is not part of what 081 tunes, so it is not part of a lap.
  // The `seatedAt` check still runs: it is what catches a lap that got into the wrong car.
  host.teleportPlayer(beside); // back beside the spot: the ped may have slid or fallen while the car built
  vehicles.seatInstantly();
  const seated = await until(() => seatedAt(vehicles, scene), ENTER_TIMEOUT_S * 1000);
  if (!seated) {
    throw new Error(`could not seat the player in the ${car} at ${scene.key}'s spot`);
  }
  await waitSeconds(SETTLE_SECONDS); // let the suspension stop moving

  vehicles.telemetry.reset();
  vehicles.telemetry.enabled = true;
  host.drive.play(scene.timeline);
  await until(() => host.drive.time >= scene.durationS, (scene.durationS + 10) * 1000);
  host.drive.stop();
  const frames = vehicles.telemetry.frames();
  const springs = vehicles.springs();
  const stance = vehicles.stance();
  vehicles.telemetry.enabled = false;

  report(scene, car, frames, springs, stance, host.speedGrip(), host.surfaces(), host.surfaceGrip(), host.airControl());
  await leaveCar(host, vehicles);
}

/** Seated, settled, and in a car standing at THIS scene's spot. */
function seatedAt(vehicles: EngineVehicles, scene: PhysScene): boolean {
  const car = vehicles.activeVehicle();
  if (car === null || vehicles.isSettling()) {
    return false;
  }

  return Math.hypot(car.position[0] - scene.position[0], car.position[1] - scene.position[1]) < SPOT_RADIUS;
}

/**
 * Spawn, retrying while the ground under the spot is still streaming.
 *
 * `seatVehicleOnGround` DEFERS by throwing when the collision has not arrived (the vehicle-lod stream
 * normally retries every frame). A one-shot spawn turns that into a dead lap, which is what the first sweep
 * produced: four scenes reported "no ground at …" and captured nothing.
 */
async function spawnWithRetry(host: PhysRunsHost, scene: PhysScene, car: string): Promise<void> {
  const deadline = performance.now() + SPAWN_RETRY_SECONDS * 1000;
  for (;;) {
    try {
      await host.spawnCar(car, scene.position, scene.heading);

      return;
    } catch (error) {
      if (performance.now() >= deadline) {
        throw error;
      }
      await waitSeconds(0.5);
    }
  }
}
