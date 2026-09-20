import { describe, expect, it } from 'vitest';

import type { CharacterControllerSystem } from '../character/character-controller.system';
import type { Config } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld, VehicleController } from '../physics/physics-world';
import type { EnterableVehicle, VehicleAnimator } from './enter-vehicle.system';
import type { VehicleRig } from './vehicle-rig';

import { Logger } from '../diagnostics/logger';
import { KeyboardSource } from '../input';
import { EnterVehicleSystem, meanFrontAdhesion, warpAlongRootMotion } from './enter-vehicle.system';
import { FakeVehicleHandle } from './vehicle-handle.fake';
import { fakeHandling } from './vehicle-handling.fake';

const CONTROLS = { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD' };

/** Silent logger (showLogs off → never emits) for systems under test. */
const SILENT_LOGGER = new Logger({ emit: (): undefined => undefined }, { showLogs: false });

interface Harness {
  anim: { cameraAzimuth: number; clip: null | string; facing: number; loop: boolean };
  ctrl: { arrived: boolean; enabled: boolean; path: null | Vec3[] };
  hold: (code: string, down: boolean) => void;
  phys: {
    blocked: Set<string>;
    bodyPosition: Vec3;
    brake: number;
    engine: number;
    grounded: boolean;
    handbrake: boolean;
    parked: number;
    quaternion: [number, number, number, number];
    speed: number;
    spins: Vec3[];
    steer: number;
    teleports: Vec3[];
  };
  press: (down: boolean) => void;
  system: EnterVehicleSystem;
}

/** How far the driver door has swung from closed. */
function doorAngle(vehicle: EnterableVehicle): number {
  return Math.abs((vehicle.handle as FakeVehicleHandle).doorAngles.get('lf') ?? 0);
}

/** Run the full enter sequence so the system ends seated (Enter released, ready to drive). */
function seatPlayer(h: Harness, car: EnterableVehicle): void {
  h.system.add(car);
  h.press(true);
  h.system.update(0.016); // approaching
  h.ctrl.arrived = true;
  h.system.update(1); // arrived → open → step into the doorway
  h.system.update(0.016); // doorway → climb in (phase 'getin')
  h.system.fixedUpdate(2); // getin slide elapses (fixed step) → seated
  h.press(false);
  h.system.update(0.016); // release Enter so driving runs (no exit edge)
}

function setup(player: Vec3 = [0, 0, 0]): Harness {
  const held = new Set<string>();
  const keyboard = { isDown: (code: string): boolean => held.has(code) };
  const input = new KeyboardSource(keyboard, CONTROLS);

  const ctrl = { arrived: false, enabled: true, path: null as null | Vec3[] };
  const controller = {
    get arrived(): boolean {
      return ctrl.arrived;
    },
    runPath(points: Vec3[]): void {
      ctrl.path = points;
    },
    setEnabled(enabled: boolean): void {
      ctrl.enabled = enabled;
    },
  } as unknown as CharacterControllerSystem;

  const phys = {
    angvel: [0, 0, 0] as Vec3,
    blocked: new Set<string>(), // 'lf' | 'rf' | 'windscreen' — egress rays the world blocks (088/09d)
    bodyPosition: [0, 0, 0] as Vec3, // what readBody reports — driveSeated drags car.position to it
    brake: 0,
    drag: [0, 0, 0] as Vec3,
    engine: 0,
    grounded: true,
    handbrake: false,
    parked: 0,
    quaternion: [0, 0, 0, 1] as [number, number, number, number],
    speed: 0,
    spins: [] as Vec3[], // every in-air attitude write (081/06 §1)
    steer: 0,
    teleports: [] as Vec3[],
  };
  const placePlayer = (position: Vec3): void => {
    phys.teleports.push(position);
  };
  const physics = {
    airControlTuning: (): { scale: number } => ({ scale: 1 }),
    getAngvel: (): Vec3 => phys.angvel,
    getLinvel: (): Vec3 => [0, phys.speed, 0], // heading 0 → forward speed = vy
    groundBelow: (): null | number => (phys as { ground?: number }).ground ?? null, // road top for crawl targets
    holdBody: (): undefined => undefined,
    ignoreVehicles: (): undefined => undefined,
    parkVehicle: (): void => {
      phys.parked += 1;
    },
    // Egress probe (088/09d): heading 0 → the driver spot is at −x, passenger at +x, windscreen +y.
    pathClear: (_from: Vec3, to: Vec3): boolean => {
      const egress = to[1] > 2 ? 'windscreen' : to[0] < 0 ? 'lf' : 'rf';

      return !phys.blocked.has(egress);
    },
    push: (_handle: number, impulse: Vec3): void => {
      phys.drag = impulse;
    },
    readBody: (): { position: Vec3; quaternion: [number, number, number, number] } => ({
      position: phys.bodyPosition,
      quaternion: phys.quaternion,
    }),
    // 081/10 step 5: the drive path asks what the wheels stand on. The fake answers tarmac for all four, so
    // these tests keep measuring the drivetrain rather than the ground.
    readVehicleWheelAdhesion: (): readonly number[] => [4.5, 4.5, 4.5, 4.5],
    seedReverse: (): undefined => undefined,
    setColliderSensor: (): undefined => undefined,
    setVehicleControls: (
      _c: VehicleController,
      _w: unknown,
      controls: { brake: number; engine: number; handbrake: boolean; steer: number },
    ): void => {
      phys.engine = controls.engine;
      phys.brake = controls.brake;
      phys.handbrake = controls.handbrake;
      phys.steer = controls.steer;
    },
    spin: (_handle: number, delta: Vec3): void => {
      phys.spins.push(delta);
    },
    vehicleGrounded: (): boolean => phys.grounded,
    vehicleSpeed: (): number => phys.speed,
  } as unknown as PhysicsWorld;

  const anim = { cameraAzimuth: 0, clip: null as null | string, facing: 0, loop: true };
  const animation = {
    faceTo(yaw: number): void {
      anim.facing = yaw;
    },
    scriptedMotion: (): null => null, // no root travel in the stub → the legacy linear slide
    setScripted(clip: null | string, options: { loop?: boolean } = {}): void {
      anim.clip = clip;
      anim.loop = options.loop ?? true;
    },
  } satisfies VehicleAnimator;

  const aimCamera = (yaw: number): void => {
    anim.cameraAzimuth = yaw;
  };
  const system = new EnterVehicleSystem(
    input,
    () => player,
    controller,
    placePlayer,
    animation,
    aimCamera,
    () => undefined, // followTarget (camera) — unused in tests
    { controls: CONTROLS } as unknown as Readonly<Config>,
    physics,
    9,
    SILENT_LOGGER,
  );

  const hold = (code: string, down: boolean): void => {
    if (down) {
      held.add(code);
    } else {
      held.delete(code);
    }
  };

  return { anim, ctrl, hold, phys, press: (down): void => hold('Enter', down), system };
}

/** Car with hinge at the body origin, half-extents [1, 2], driver seat at [-0.4, 0, -0.16]. */
function vehicleAt(position: Vec3): EnterableVehicle {
  const rig = {
    setSpeed: (): undefined => undefined,
    setSteer: (): undefined => undefined,
    setThrust: (): undefined => undefined,
  } as unknown as VehicleRig;
  const handle = new FakeVehicleHandle();
  handle.hinges.set('lf', [0, 0, 0]); // hinges at the body origin — real cars author BOTH front doors
  handle.hinges.set('rf', [0, 0, 0]);

  return {
    body: 0,
    controller: {} as unknown as VehicleController,
    halfExtents: [1, 2, 0.7],
    handle,
    handling: fakeHandling(),
    heading: 0,
    orientation: [0, 0, 0, 1] as [number, number, number, number],
    position,
    renderOrientation: [0, 0, 0, 1] as [number, number, number, number],
    renderPosition: [...position],
    rig,
    seatLocal: [-0.4, 0, -0.16],
    wheelLift: [0, 0, 0, 0],
    wheels: [
      { connection: [0.8, 1.5, -0.4], front: true, radius: 0.4 },
      { connection: [-0.8, 1.5, -0.4], front: true, radius: 0.4 },
      { connection: [-0.8, -1.5, -0.4], front: false, radius: 0.4 },
      { connection: [0.8, -1.5, -0.4], front: false, radius: 0.4 },
    ],
  };
}

describe('EnterVehicleSystem', () => {
  describe('negative cases', () => {
    it('leaveInstantly does nothing when nobody is seated (096/02)', () => {
      const h = setup();
      h.system.add(vehicleAt([2, 0, 0]));

      expect(h.system.leaveInstantly()).toBe(false);
      expect(h.ctrl.enabled).toBe(true); // never gated, so never restored
    });

    it('does nothing without an Enter press', () => {
      const h = setup();
      h.system.add(vehicleAt([2, 0, 0]));
      h.system.update(1);
      expect(h.ctrl.path).toBeNull();
    });

    it('ignores Enter when no car is in range', () => {
      const h = setup();
      h.system.add(vehicleAt([10, 0, 0])); // beyond ENTER_RANGE
      h.press(true);
      h.system.update(1);
      expect(h.ctrl.path).toBeNull();
    });

    it('keeps the door shut until the player has reached it', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      h.press(true);
      h.system.update(1); // approaching, not arrived
      expect(doorAngle(car)).toBeCloseTo(0);
    });

    it('does not cancel once climbing in (movement input ignored mid-getin)', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      h.press(true);
      h.system.update(0.016); // approaching
      h.ctrl.arrived = true;
      h.system.update(1); // arrived → open → step into the doorway
      h.system.update(0.016); // doorway → climb in (phase 'getin', scripted)
      expect(h.ctrl.enabled).toBe(false);

      h.press(false);
      h.hold('KeyW', true); // try to bail out mid-getin
      h.system.update(0.5);
      h.system.fixedUpdate(2); // getin completes regardless of input
      expect(h.anim.clip).toBe('car_sit'); // committed to seating, not cancelled
    });

    it('does not drive while not seated', () => {
      const h = setup();
      h.system.add(vehicleAt([2, 0, 0]));
      h.hold('KeyW', true);
      h.system.fixedUpdate(0.1); // idle, not in the car
      expect(h.phys.engine).toBe(0);
    });

    it('applies no engine force when seated off-throttle (coast brake only)', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.system.fixedUpdate(0.1); // seated, no keys
      expect(h.phys.engine).toBe(0);
      expect(h.phys.brake).toBeGreaterThan(0); // light idle brake
    });

    it('does not report braking on foot or while merely coasting off-throttle', () => {
      const h = setup();
      expect(h.system.isBraking()).toBe(false); // on foot
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.phys.speed = 5; // rolling forward, no keys → idle coast brake, not real braking
      h.system.fixedUpdate(0.1);
      expect(h.system.isBraking()).toBe(false);
    });

    it('keeps a car that is mid-sequence — unloading it would strand the climb', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      h.press(true);
      h.system.update(0.016); // approaching — the sequence owns this car now

      h.system.remove(car);
      h.ctrl.arrived = true;
      h.system.update(1);

      expect(doorAngle(car)).not.toBeCloseTo(0); // the sequence carried on
    });

    it('lets go of the car it last used when that car is unloaded', () => {
      // `active` outlives the ride (the door closes behind the player), so an unloaded car used to stay
      // referenced while its rigid body was destroyed — every later door tick then read a dead body and
      // killed the fixed step. Found by the 081/01 lap runner's per-scene teleports.
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      seatPlayer(h, car);
      h.press(true);
      h.system.update(0.016); // seated → stopping
      h.system.fixedUpdate(1); // stops, opens, climbs out
      h.system.update(1);
      h.system.fixedUpdate(2);
      h.system.update(1); // back to idle, `active` still points at the car

      h.system.remove(car);
      h.system.update(1); // a tick that would have touched the removed car's body

      expect(h.system.getActive()).toBeNull();
    });

    it('hands out no air control while a wheel is still on the ground', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.hold('KeyW', true);
      for (let i = 0; i < 20; i += 1) {
        h.system.fixedUpdate(0.02);
      }

      expect(h.phys.spins).toHaveLength(0);
    });

    it('waits out the debounce, so a kerb-length hop cannot pitch the car (081/06 §1)', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.hold('KeyW', true);
      h.phys.grounded = false;
      h.system.fixedUpdate(0.1); // 0.1 s of air — a driveway lip, not a jump

      expect(h.phys.spins).toHaveLength(0);
    });

    it('canEnterExit is false when idle with no car in range', () => {
      const h = setup();
      expect(h.system.canEnterExit()).toBe(false); // no cars
      h.system.add(vehicleAt([10, 0, 0])); // beyond ENTER_RANGE
      expect(h.system.canEnterExit()).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('lets the driver pitch a car that is properly airborne (081/06 §1)', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.hold('KeyW', true);
      h.phys.grounded = false;
      h.system.fixedUpdate(0.1);
      h.system.fixedUpdate(0.1); // past the debounce — the car is flying

      expect(h.phys.spins).toHaveLength(1);
      expect(h.phys.spins[0][0]).toBeGreaterThan(0); // about the car's right axis = nose up
    });

    it('puts the air control away again the moment the car lands', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.hold('KeyW', true);
      h.phys.grounded = false;
      h.system.fixedUpdate(0.1);
      h.system.fixedUpdate(0.1);
      h.phys.grounded = true;
      h.system.fixedUpdate(0.1);
      const onLanding = h.phys.spins.length;
      h.phys.grounded = false;
      h.system.fixedUpdate(0.1); // airborne again — but the debounce starts over

      expect(h.phys.spins).toHaveLength(onLanding);
    });

    it('applies the controls BEFORE the step consumes them, not after (081/02 §4)', () => {
      // The raycast controller reads engine/brake/steer at the top of `physics.step`. Driving used to run
      // after it, so every press reached the wheels one step late. `applyControls` is what a host calls
      // pre-step; the same press must be visible without a `fixedUpdate` having run at all.
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.hold('KeyW', true);

      h.system.applyControls(0.1);

      expect(h.phys.engine).toBeGreaterThan(0);
    });

    it('does not apply the same step twice, and drives on its own when no host hook exists', () => {
      // Idempotence within a step (a host that wired the hook must not get a double dose from fixedUpdate),
      // and the fallback that keeps an un-migrated host working — one step late, exactly as before.
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.hold('KeyW', true);

      h.system.applyControls(0.1);
      const afterHook = h.phys.engine;
      h.system.fixedUpdate(0.1); // would re-drive if it were not idempotent
      expect(h.phys.engine).toBe(afterHook);

      h.hold('KeyW', false);
      h.system.fixedUpdate(0.1); // no hook this step — fixedUpdate drives instead
      expect(h.phys.engine).toBeLessThan(afterHook);
    });

    it('canEnterExit reports a car in range while idle', () => {
      const h = setup();
      h.system.add(vehicleAt([2, 0, 0]));
      expect(h.system.canEnterExit()).toBe(true);
    });

    it('a model with NO driver door boards through the door it HAS, from either side (the coach case)', () => {
      const h = setup();
      const coach = vehicleAt([2, 0, 0]); // player local x = -2: the DRIVER side approach
      coach.handle.doorHinge = (side): [number, number, number] | null => (side === 'rf' ? [0, 0, 0] : null);
      h.system.add(coach);
      h.press(true);
      h.system.update(0.016);
      // Routed AROUND the bumper to the rf-door standoff (a straight line runs through the body):
      // driver-flank corner → passenger-flank corner → the door.
      expect(h.ctrl.path).toHaveLength(3);
      expect(h.ctrl.path?.[0]).toEqual([2 - 2.2, 3.2, 0]);
      expect(h.ctrl.path?.[1]).toEqual([2 + 2.2, 3.2, 0]);
      expect(h.ctrl.path?.[2][0]).toBeCloseTo(2 + 0 + 1.2);

      h.ctrl.arrived = true;
      h.system.update(1); // arrived → the PASSENGER door swings
      h.system.update(0.016); // doorway → climb in through the rf door
      expect(h.anim.clip).toBe('car_getin_rhs');
    });

    it('a LONG vehicle is enterable from beside its body — range measures to the footprint, not the centre', () => {
      const h = setup();
      const coach = vehicleAt([0, 8, 0]);
      // An ~11 m coach ahead of the player: the centre sits 8 m out (a centre rule refused it), the body
      // ends 2.4 m away — well inside ENTER_RANGE.
      coach.halfExtents = [1.2, 5.6, 1.5];
      h.system.add(coach);
      expect(h.system.canEnterExit()).toBe(true);
    });

    it('canEnterExit stays true while seated (can exit)', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      expect(h.system.canEnterExit()).toBe(true);
    });

    it('approaches the driver door directly from the driver side', () => {
      const h = setup();
      h.system.add(vehicleAt([2, 0, 0])); // player local x = -2 (driver side) → straight
      h.press(true);
      h.system.update(1);
      expect(h.ctrl.path).toHaveLength(1);
      expect(h.ctrl.path?.[0][0]).toBeCloseTo(0.8); // entry = 2 + (0 - 1.2)
    });

    it('enters through the PASSENGER door from the passenger side, then shuffles across (088/09b)', () => {
      const h = setup();
      const car = vehicleAt([-3, 0, 0]); // player local x = +3 → passenger side
      h.system.add(car);
      h.press(true);
      h.system.update(0.016);
      // Straight to the rf-door standoff — no more hiking around the bumpers to the driver door.
      expect(h.ctrl.path).toHaveLength(1);
      expect(h.ctrl.path?.[0][0]).toBeCloseTo(-1.8); // -3 + (0 + 1.2) — the rf hinge sits at the origin

      h.ctrl.arrived = true;
      h.system.update(1); // arrived → the PASSENGER door swings open (mirrored angle)
      expect((car.handle as FakeVehicleHandle).doorAngles.get('rf')).toBeCloseTo(Math.PI / 3);

      h.system.update(0.016); // doorway → climb in through the rf door
      expect(h.anim.clip).toBe('car_getin_rhs');

      h.system.fixedUpdate(2); // climb-in done → the kerb-side shuffle to the driver seat
      expect(h.anim.clip).toBe('car_shuffle_rhs');

      h.system.fixedUpdate(1); // shuffle done → seated as the driver
      expect(h.anim.clip).toBe('car_sit');
    });

    it('hands control back when the player feeds movement during the run-up (after a short hold)', () => {
      const h = setup();
      h.system.add(vehicleAt([2, 0, 0]));
      h.press(true);
      h.system.update(0.016); // begin approach
      expect(h.ctrl.path).toHaveLength(1); // running to the door
      h.press(false); // release Enter
      h.hold('KeyW', true); // player takes over

      h.system.update(0.1); // held 0.1 s < threshold → still auto-running
      expect(h.ctrl.path).toHaveLength(1);
      h.system.update(0.1); // held 0.2 s ≥ threshold → control returns
      expect(h.ctrl.path).toEqual([]); // empty path = manual control restored
    });

    it('auto-cancels the run-up when the path is blocked (no progress), so Tommy stops running in place', () => {
      const h = setup(); // player position is fixed → never progresses toward the door
      h.system.add(vehicleAt([2, 0, 0]));
      h.press(true);
      h.system.update(0.016); // approaching
      h.press(false);
      expect(h.ctrl.path).toHaveLength(1);

      h.system.update(1); // ~1 s stalled, under the timeout → still running
      expect(h.ctrl.path).toHaveLength(1);
      h.system.update(1); // ~2 s stalled, over the timeout → cancelled
      expect(h.ctrl.path).toEqual([]);
    });

    it('opens the driver door once the player arrives', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      h.press(true);
      h.system.update(0.016); // approaching
      h.ctrl.arrived = true;
      h.system.update(1); // arrived → door swings open
      expect(doorAngle(car)).toBeCloseTo(Math.PI / 3);
    });

    it('steps into the doorway, climbs in (gates + getin clip), then sits and shuts the door', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      h.press(true);
      h.system.update(0.016); // approaching
      h.ctrl.arrived = true;
      h.system.update(1); // arrived → open door → step into the doorway
      h.system.update(0.016); // at the doorway → climb in
      expect(h.ctrl.enabled).toBe(false);
      expect(h.anim.clip).toBe('car_getin_lhs');

      h.system.fixedUpdate(2); // getin slide elapses (fixed step) → seated
      expect(h.anim.clip).toBe('car_sit');
      expect(h.phys.teleports.length).toBeGreaterThan(0);
      expect(h.anim.cameraAzimuth).toBeCloseTo(0); // heading 0 → camera behind the car's rear

      h.system.update(1); // door pulled shut
      expect(doorAngle(car)).toBeCloseTo(0);
    });

    it('seats the player facing the car forward (drive-ready)', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      h.press(true);
      h.system.update(0.016);
      h.ctrl.arrived = true;
      h.system.update(1);
      h.system.update(0.016);
      h.system.fixedUpdate(2); // seated
      expect(h.anim.facing).toBeCloseTo(0); // faces car forward (+Y at heading 0)

      h.system.update(1); // door pulled shut
      expect(doorAngle(car)).toBeCloseTo(0);
    });

    it('exits the car on Enter: reopens, climbs out, restores control, shuts the door once clear', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.phys.bodyPosition = [2, 0, 0]; // driveSeated re-reads the body — keep the car where it spawned
      h.system.add(car);
      // Enter and sit.
      h.press(true);
      h.system.update(0.016); // approaching
      h.ctrl.arrived = true;
      h.system.update(1); // open → stepin
      h.system.update(0.016); // doorway → getin
      h.system.fixedUpdate(2); // getin slide (fixed step) → seated
      expect(h.anim.clip).toBe('car_sit');

      // Now exit (stationary → coast-to-stop completes immediately on the fixed step).
      h.press(false);
      h.system.update(0.016); // release Enter
      h.press(true);
      h.system.update(0.016); // seated + Enter → 'stopping'
      h.system.fixedUpdate(0.016); // already stopped → begin exit (open the door)
      h.system.update(1); // door open → climb out (phase 'exiting')
      expect(h.anim.clip).toBe('car_getout_lhs');
      expect(h.ctrl.enabled).toBe(false); // still gated mid-exit

      h.system.fixedUpdate(2); // climb-out slide (fixed step) → control restored
      expect(h.ctrl.enabled).toBe(true);
      expect(h.anim.clip).toBeNull();
      expect(h.anim.facing).toBeCloseTo(Math.PI / 2); // heading 0 → faces −X, away from the car body
      expect(h.anim.cameraAzimuth).toBeCloseTo(Math.PI / 2); // camera swings behind, looking away from the car

      // The test player stands 2 m from the body — already CLEAR — so the door swings shut behind him.
      h.system.update(1);
      expect(doorAngle(car)).toBeCloseTo(0);
    });

    it('holds the exit door open while the player still stands in the doorway', () => {
      const player: Vec3 = [0, 0, 0];
      const h = setup(player);
      const car = vehicleAt([1.2, 0, 0]); // player local x = −1.2 → INSIDE the footprint+clearance
      h.phys.bodyPosition = [1.2, 0, 0];
      seatPlayer(h, car);
      h.press(true);
      h.system.update(0.016); // stopping…
      h.system.fixedUpdate(0.016); // …→ exitopen (door swings)
      h.system.update(1); // door open → climb-out starts
      h.system.fixedUpdate(2); // climb-out done, player still beside the body

      h.system.update(1);
      expect(doorAngle(car)).toBeCloseTo(Math.PI / 3); // waiting for him to step clear

      player[0] = -2; // steps away (clear of footprint + clearance)
      h.system.update(1);
      expect(doorAngle(car)).toBeCloseTo(0); // NOW it shuts
    });

    it('drives forward on throttle', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.hold('KeyW', true);
      h.system.fixedUpdate(0.1);
      expect(h.phys.engine).toBeGreaterThan(0);
      expect(h.phys.brake).toBe(0);
    });

    it('brakes when reversing key is held while moving forward', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.phys.speed = 5; // already rolling forward
      h.hold('KeyS', true);
      h.system.fixedUpdate(0.1);
      expect(h.phys.brake).toBeGreaterThan(0);
      expect(h.phys.engine).toBe(0);
    });

    it('reverses when back is held at rest', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.phys.speed = 0;
      h.hold('KeyS', true);
      h.system.fixedUpdate(0.1);
      expect(h.phys.engine).toBeLessThan(0);
    });

    it('steers the front wheels toward the input', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.hold('KeyD', true);
      h.system.fixedUpdate(0.2);
      h.system.fixedUpdate(0.2);
      expect(h.phys.steer).not.toBe(0);
    });

    it('leaves the car instantly at speed, out a clear door, with control restored (096/02)', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      seatPlayer(h, car);
      h.phys.speed = 12; // mid-drive: the instant exit does NOT wait for a coast-down

      expect(h.system.leaveInstantly()).toBe(true);
      // Out the same call — no phase to run out, which is the whole point. `getActive` still names the car
      // (the door has yet to shut), so a caller asking "is he in it" must ask `isSeated`, as the host does.
      expect(h.system.isSeated()).toBe(false);
      expect(h.ctrl.enabled).toBe(true); // walking again
      expect(h.phys.parked).toBeGreaterThan(0); // handed back stationary, like every other exit
      // Beside the car, not on its roof — the driver door was clear.
      expect(h.phys.teleports[h.phys.teleports.length - 1][2]).toBeLessThan(car.position[2] + 1);
    });

    it('parks the car (brakes to a stop) when the player begins exiting', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.press(true);
      h.system.update(0.016); // seated + Enter → 'stopping'
      h.system.fixedUpdate(0.016); // stationary → startExit parks the car
      expect(h.phys.parked).toBeGreaterThan(0);
    });

    it('coasts to a stop before exiting when moving (does not exit a moving car)', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.phys.speed = 10; // moving forward
      h.press(true);
      h.system.update(0.016); // → 'stopping'
      h.system.fixedUpdate(0.016); // still moving → brakes, stays in the car
      expect(h.phys.brake).toBeGreaterThan(0);
      expect(h.phys.parked).toBe(0); // not exited yet
      h.phys.speed = 0; // now stopped
      h.system.fixedUpdate(0.016); // → startExit
      expect(h.phys.parked).toBeGreaterThan(0);
    });

    it('presses the foot brake IN over time, and yanks the handbrake instantly (081/04)', () => {
      // The field verdict was "the brake works like a handbrake, not a gradual loss of speed" — and it was
      // literally true: full force on the first frame. Space is now a pedal; H is the lever.
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.phys.speed = 20;

      h.hold(CONTROLS.jump, true); // Space — the pedal
      h.system.applyControls(0.05);
      const earlyPedal = h.phys.brake;
      for (let step = 0; step < 20; step += 1) {
        h.system.fixedUpdate(0.05);
      }
      const fullPedal = h.phys.brake;

      expect(earlyPedal).toBeGreaterThan(0);
      expect(earlyPedal).toBeLessThan(fullPedal * 0.5); // it started well short of the floor

      h.hold(CONTROLS.jump, false);
      h.system.fixedUpdate(0.05); // released: back to the idle coast brake
      h.hold('KeyH', true); // the lever
      h.system.fixedUpdate(0.05);

      // The lever is not a bigger pedal: it asks the physics layer to LOCK THE REAR AXLE and takes the
      // service brake off entirely, so the front keeps its cornering grip and the car rotates (081/04 §4).
      expect(h.phys.handbrake).toBe(true);
      expect(h.phys.brake).toBe(0);
    });

    it('reports braking when pressing back while rolling forward (brake lights on)', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.phys.speed = 5; // rolling forward
      h.hold(CONTROLS.back, true); // S while moving forward → full brake
      h.system.fixedUpdate(0.1);
      expect(h.system.isBraking()).toBe(true);
    });
  });
});

describe('warpAlongRootMotion (plan 088/09a)', () => {
  /** A synthetic clip whose root arcs 1 m right (+x) with a mid-way 0.5 m dip, over 2 s. */
  const MOTION = {
    duration: 2,
    sample: (time: number): readonly [number, number, number] => {
      const t = Math.min(Math.max(time / 2, 0), 1);

      return [t, 0, -0.5 * Math.sin(t * Math.PI)];
    },
  };

  describe('negative cases', () => {
    it('without a motion it degrades to the straight linear slide', () => {
      expect(warpAlongRootMotion([0, 0, 0], [2, 4, 0], null, 0.5, 1.23)).toEqual([1, 2, 0]);
    });
  });

  describe('positive cases', () => {
    it('starts exactly at `from` and ends exactly at `to` regardless of the clip travel', () => {
      const from: [number, number, number] = [10, 20, 3];
      const to: [number, number, number] = [11, 21, 3.5];
      expect(warpAlongRootMotion(from, to, MOTION, 0, 0.7)).toEqual(from);
      const end = warpAlongRootMotion(from, to, MOTION, 1, 0.7);
      expect(end[0]).toBeCloseTo(to[0], 6);
      expect(end[1]).toBeCloseTo(to[1], 6);
      expect(end[2]).toBeCloseTo(to[2], 6);
    });

    it('carries the authored VERTICAL dip that a straight slide flattens out', () => {
      // from → to is level; the clip dips 0.5 m at the midpoint — the warped path must dip too.
      const mid = warpAlongRootMotion([0, 0, 0], [1, 0, 0], MOTION, 0.5, Math.PI / 2);
      expect(mid[2]).toBeCloseTo(-0.5, 6);
    });

    it('maps the clip x (right of facing) through the heading', () => {
      // heading 0: forward = (0, 1), right = (1, 0) → the clip +x travel stays on world +x, and the
      // to−from residual (zero here, since `to` matches the mapped travel) adds nothing.
      const mid = warpAlongRootMotion([0, 0, 0], [1, 0, 0], MOTION, 0.5, 0);
      expect(mid[0]).toBeCloseTo(0.5, 6);
      expect(mid[1]).toBeCloseTo(0, 6);
    });
  });
});

describe('step-in walk-around (plan 088/09c)', () => {
  describe('positive cases', () => {
    it('routes back along the OUTSIDE of the open door, then in from abeam the seat', () => {
      const h = setup([1, 0, 0]);
      const car = vehicleAt([2, 0, 0]);
      car.seatLocal = [-0.4, -0.7, -0.16]; // seat behind the hinge → the walk-around leg is visible
      h.system.add(car);
      h.press(true);
      h.system.update(0.016); // approaching
      h.ctrl.arrived = true;
      h.system.update(1); // door swings fully open -> the step-in path is issued

      expect(h.ctrl.path).toHaveLength(3);
      const [back, across, doorway] = h.ctrl.path ?? [];
      // Leg 1 stays on the 1.2 m standoff ring while walking PAST the panel's swept rear edge
      // (hinge y − 0.95); leg 2 cuts inboard BEHIND the panel; leg 3 comes forward along the body
      // into the doorway. The old paths cut through the open panel.
      expect(back[0]).toBeCloseTo(2 - 1.2, 6);
      expect(back[1]).toBeCloseTo(-0.95, 6);
      expect(across[0]).toBeCloseTo(2 - 1.35, 6);
      expect(across[1]).toBeCloseTo(-0.95, 6);
      expect(doorway[0]).toBeCloseTo(2 - 1.35, 6);
      expect(doorway[1]).toBeCloseTo(-0.7, 6);
    });
  });
});

describe('exit egress chain (plan 088/09d)', () => {
  /** Seat the player in a car at the origin (heading 0), then press Enter to begin the exit. */
  function seatAndExit(h: Harness, car: EnterableVehicle): void {
    seatPlayer(h, car);
    h.press(true);
    h.system.update(0.016); // stopping (speed 0) …
    h.system.fixedUpdate(0.016); // … → startExit picks the egress
  }

  describe('negative cases', () => {
    it('with EVERY egress blocked the player just appears on top of the car', () => {
      const h = setup();
      const car = vehicleAt([0, 0, 0]);
      h.phys.blocked.add('lf').add('rf').add('windscreen');

      seatAndExit(h, car);

      expect(h.ctrl.enabled).toBe(true); // control returned immediately — no climb clip
      const last = h.phys.teleports[h.phys.teleports.length - 1];
      expect(last[2]).toBeCloseTo(0.7 + 1, 6); // on the roof: hz + 1
    });
  });

  describe('positive cases', () => {
    it('a blocked driver door exits through the PASSENGER door', () => {
      const h = setup();
      const car = vehicleAt([0, 0, 0]);
      h.phys.blocked.add('lf');

      seatAndExit(h, car);
      h.system.update(1); // the rf door swings open → climb-out starts

      expect((car.handle as FakeVehicleHandle).doorAngles.get('rf')).toBeCloseTo(Math.PI / 3);
      expect(h.anim.clip).toBe('car_getout_rhs');
    });

    it('both doors blocked → crawls out over the WINDSCREEN', () => {
      const h = setup();
      const car = vehicleAt([0, 0, 0]);
      h.phys.blocked.add('lf').add('rf');

      seatAndExit(h, car);

      expect(h.anim.clip).toBe('car_crawloutrhs');
      h.system.fixedUpdate(3); // the crawl elapses (fallback duration)
      expect(h.ctrl.enabled).toBe(true);
      const last = h.phys.teleports[h.phys.teleports.length - 1];
      expect(last[1]).toBeCloseTo(2 + 1.2, 6); // ahead of the bonnet (hy + 1.2)
    });

    it('an OVERTURNED car skips the doors entirely and crawls out', () => {
      const h = setup();
      const car = vehicleAt([0, 0, 0]);
      seatPlayer(h, car);
      h.system.update(1); // let the entry door finish pulling shut
      h.phys.quaternion = [1, 0, 0, 0]; // 180° about X — upside down

      h.press(true);
      h.system.update(0.016);
      h.system.fixedUpdate(0.016);

      expect(h.anim.clip).toBe('car_crawloutrhs');
      // Roof-down flips model x in world (and the derived yaw is π): the crawl spot lands at world −x,
      // where the PHYSICAL door is door_lf — that is the one that swings, not a yaw-frame 'rf'.
      h.system.update(1);
      expect((car.handle as FakeVehicleHandle).doorAngles.get('lf')).toBeCloseTo(-Math.PI / 3);
    });

    it('a car ON ITS SIDE with the right flank grounded crawls out the OTHER side', () => {
      const h = setup();
      const car = vehicleAt([0, 0, 0]);
      seatPlayer(h, car);
      h.system.update(1); // let the entry door finish pulling shut
      h.phys.quaternion = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // 90° roll about Y — lying on a flank
      h.phys.blocked.add('rf'); // that flank is against a wall/the ground clutter

      h.press(true);
      h.system.update(0.016);
      h.system.fixedUpdate(0.016);

      expect(h.anim.clip).toBe('car_crawloutrhs'); // still a crawl, not a door swing
      h.system.update(1); // the LEFT door swings — it is the chosen flank's door
      expect((car.handle as FakeVehicleHandle).doorAngles.get('lf')).toBeCloseTo(-Math.PI / 3);
      h.system.fixedUpdate(3); // the crawl elapses
      const last = h.phys.teleports[h.phys.teleports.length - 1];
      expect(last[0]).toBeLessThan(0); // emerged on the CLEAR (−x) side, not into the grounded flank
    });

    it('a crawl-out ends STANDING on the ground, not buried at ground level', () => {
      const h = setup();
      const car = vehicleAt([0, 0, 0]);
      h.phys.blocked.add('lf').add('rf'); // → the windscreen crawl
      (h.phys as unknown as { ground: number }).ground = 0.5; // groundBelow reports the road top
      seatPlayer(h, car);
      h.press(true);
      h.system.update(0.016);
      h.system.fixedUpdate(0.016);
      h.system.fixedUpdate(3); // the crawl elapses → finishExit places the player

      const last = h.phys.teleports[h.phys.teleports.length - 1];
      expect(last[2]).toBeCloseTo(0.5 + 1, 6); // ground + capsule-centre lift, NOT the raw ground
    });
  });
});

describe('meanFrontAdhesion', () => {
  const FOUR = [{ front: true }, { front: true }, { front: false }, { front: false }];

  describe('negative cases', () => {
    it('falls back to tarmac when the car reported no wheels at all', () => {
      expect(meanFrontAdhesion([], [])).toBe(4.5);
    });

    it('uses every wheel when a model flags none as front (bikes, trailers)', () => {
      const wheels = [{ front: false }, { front: false }];

      expect(meanFrontAdhesion(wheels, [4.5, 3.2])).toBeCloseTo(3.85, 5);
    });
  });

  describe('positive cases', () => {
    it('averages the FRONT axle only — the rear is not what steers', () => {
      expect(meanFrontAdhesion(FOUR, [4.5, 4.5, 3.2, 3.2])).toBe(4.5);
    });

    it('takes the mean rather than the worst, so one wheel on the verge still steers', () => {
      expect(meanFrontAdhesion(FOUR, [4.5, 3.2, 4.5, 4.5])).toBeCloseTo(3.85, 5);
    });
  });
});
