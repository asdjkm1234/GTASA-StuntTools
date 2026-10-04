import { Quaternion, Vector3 } from '@opensa/math';

import type { CharacterControllerSystem } from '../character/character-controller.system';
import type { System } from '../core/system';
import type { Logger } from '../diagnostics/logger';
import type { InputState } from '../input';
import type { Config } from '../interfaces/config.interface';
import type { Vec3, VehicleHandling, VehicleWheelPlacement } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld, VehicleController } from '../physics/physics-world';
import type { SteeringModel } from './steering';
import type { VehicleHandle } from './vehicle-handle';
import type { VehicleRig } from './vehicle-rig';

import { airAttitudeDelta, carBasis } from './air-control';
import {
  buildGearbox,
  createDrivetrainState,
  dragDeceleration,
  driveAcceleration,
  type DrivetrainState,
  type Gearbox,
} from './drivetrain';
import { steerLimit } from './steering';
import {
  CAR_CRAWLOUT,
  CAR_GETIN,
  CAR_GETIN_RHS,
  CAR_GETOUT,
  CAR_GETOUT_RHS,
  CAR_SHUFFLE,
  CAR_SIT,
} from './vehicle-clips';

/** The driving values one fixed step handed the raycast controller (plan 081/01). */
export interface AppliedControls {
  /** Total brake force (N). */
  readonly brake: number;
  /** Total engine force (N), signed — negative is reverse. */
  readonly engineForce: number;
  /** The gear the drivetrain is in: 0 = reverse, 1…n forward. */
  readonly gear: number;
  /** The LEVER is up — it applies NO brake force, so nothing else in this record shows it. */
  readonly handbrake: boolean;
  /** Front-wheel steer angle (rad). */
  readonly steer: number;
  /** The raw throttle input behind it, −1..1. */
  readonly throttle: number;
}

/** A car the player can interact with + sit in (driver side). It is a dynamic
 * physics body; `position`/`heading` are kept live by the vehicle-physics system. */
export interface EnterableVehicle {
  /** Chassis rigid-body handle (dynamic). */
  body: number;
  /** Raycast vehicle controller (drive/brake/steer). */
  controller: VehicleController;
  /** Half-extents in vehicle space `[hx, hy, hz]` (routing uses x/y). */
  halfExtents: [number, number, number];
  /** The renderer-agnostic render handle (B5) — gameplay never touches a mesh. */
  handle: VehicleHandle;
  /** Driving feel from handling.cfg. */
  handling: VehicleHandling;
  /** Heading about Z (native) — kept live from the body by the physics system. */
  heading: number;
  /**
   * The chassis's FULL orientation (native GTA quaternion), kept live by the physics system.
   *
   * `heading` alone is a yaw, and a yaw cannot describe a car that is upside down. Anything bolted to the
   * BODY — its lamps, and the coronas that sit on them — has to ride this, or it slides off the car the
   * moment the car rolls.
   */
  orientation: [number, number, number, number];
  /** World position (native Z-up) — kept live from the body by the physics system. This is the GAMEPLAY
   *  pose (current physics state); the camera follows {@link renderPosition} instead. */
  position: Vec3;
  /** The interpolated DRAWN orientation (native GTA quaternion) — `slerp(prev, cur, alpha)` between the last
   *  two fixed steps. Lamps/coronas ride this so they don't twitch against the drawn body through a turn. */
  renderOrientation: [number, number, number, number];
  /** The interpolated DRAWN position (native Z-up) — `lerp(prev, cur, alpha)` between the last two fixed
   *  steps, so the drawn car and the camera that follows it are continuous at any refresh (plan 080/03). */
  renderPosition: Vec3;
  /** Wheel rig (spin/steer). */
  rig: VehicleRig;
  /** Driver seat position in vehicle space `[x, y, z]` (mirrored to the −X driver side). */
  seatLocal: [number, number, number];
  /** Per-wheel connection lift above the model hub (m) — the drawn wheel's offset is `lift − springLength`. */
  wheelLift: readonly number[];
  /** Raycast wheel placements (front flags for steering/drive). */
  wheels: VehicleWheelPlacement[];
}

/** A scripted clip's authored root travel (088/09a): ped-local metres, x = right of facing, y = forward,
 *  z = up — measured on `ped.ifp`: `CAR_getin_LHS` runs (0,0,0)→(0.95, 0.49, −0.35), i.e. ~1 m into the
 *  car, half a metre forward, dropping into the seat. */
export interface ScriptedMotion {
  /** Clip length (s) — the slide runs THIS long, not a hardcoded constant. */
  duration: number;
  /** Root position at `time` (clamped to the clip's ends). */
  sample(time: number): readonly [number, number, number];
}

/**
 * The animation surface enter/exit needs (B5 step 4). `CharacterAnimationSystem` (three) satisfies it
 * structurally, and so does the own engine's ped — the climb-in/sit/climb-out clips are the whole contract.
 */
export interface VehicleAnimator {
  faceTo(yaw: number): void;
  /** The authored root travel of a named scripted clip, or null (a TC without it → the linear slide). */
  scriptedMotion(clip: string): null | ScriptedMotion;
  setScripted(
    clip: null | string,
    options?: { facing?: number; loop?: boolean; orientation?: readonly [number, number, number, number] },
  ): void;
}

/** Front doors the enter sequence can use (088/09b): `lf` = driver (−X), `rf` = passenger (+X). */
type DoorSide = 'lf' | 'rf';

/** −1 on the driver (−X) side, +1 on the passenger side — mirrors every door-relative x. */
function sideSign(side: DoorSide): number {
  return side === 'lf' ? -1 : 1;
}

/** Planar distance (m) from the car within which Enter starts the sequence. */
const ENTER_RANGE = 4;
/** How far out from the hinge (m, driver −X side) the player stands to open the door. */
const DOOR_STANDOFF = 1.2;
/** Clearance (m) outside the body where the player stands in the open doorway before climbing in. */
const DOORWAY_CLEAR = 0.35;
/** Driver-door open angle about the hinge (sign tuned in-browser). */
const DOOR_OPEN_ANGLE = -Math.PI / 3;
/** Door swing speed (rad/s). */
const DOOR_SPEED = Math.PI;
/** Seconds the climb-in/out clip plays while the body slides between door and seat. */
const GETIN_DURATION = 1.2;
const GETOUT_DURATION = 1.2;
/** Capsule-CENTRE height above the ground a standing player needs (radius 0.3 + half-height 0.6,
 *  rounded up for the controller offset) — a ground-anchored exit spot must be lifted by it, or the
 *  capsule lands half-buried and sticks in the collision (field 2026-07-24, overturned crawl-out). */
const PLAYER_STAND_LIFT = 1;
/** How far behind the hinge the open panel's swept arc reaches (m, with margin) — the step-in path
 *  crosses inboard BEHIND this line so it never clips the door. */
const DOOR_SWEPT_CLEARANCE = 0.95;
/** Fallback seat-shuffle length (s) when the clip is absent — the real CAR_shuffle_RHS runs 0.4 s. */
const SHUFFLE_DURATION = 0.4;
/** Capsule-centre height above the seat dummy (tuned in-browser). */
const SEAT_RAISE = 0;

// handling.cfg → driving forces (tuned in-browser). Engine/brake are forces (N) scaled from the
// car's mass + handling accel/decel; the controller (raycast wheels) integrates them.
/**
 * Rapier's wheel-brake parameter per unit of deceleration per kg (plan 081/04).
 *
 * The old model was `480 × brakeDecel / 8.5` — **no mass term at all**, which 081/01's mod corpus caught:
 * a 4.7 t car braked 11.5× worse than a 1.4 t one and a 25 t tank 49× worse, while the light cars stopped at
 * 2.3 g against a road car's ~1. The mapping was then MEASURED (brake value vs achieved deceleration, two
 * masses × three values): **`decel ≈ 7.5 × brake / mass` in g**, linear until the tyres saturate near 2.4 g.
 *
 * Inverting it lets `fBrakeDeceleration` be read as what its name says — m/s² — so the authored 11 on an
 * infernus asks for 1.12 g and gets it, and the firetruck's 10 finally reaches a truck's ~1 g instead of the
 * 0.53 it managed on a mass-blind constant.
 */
const BRAKE_UNITS_PER_DECEL_PER_KG = 1 / 73.6;
/**
 * The off-throttle brake, from the original's own constant (081/04 §3).
 *
 * `CVehicle::ProcessWheel`: with no brake pressed and the pedal at rest, each wheel gets
 * `gHandlingDataMgr.fWheelFriction / mass` — and `fWheelFriction` is **0.9**. Carried through SA's units that
 * is a mass-INDEPENDENT impulse of 37.5 per wheel here, i.e. a constant retarding FORCE rather than a
 * constant deceleration: a light car slows sharply off the throttle and a 6.5 t truck barely notices, which
 * is the right way round.
 *
 * It replaces a flat 8 % of the car's own brake, which came to 0.27 m/s² on an admiral against the original's
 * 6.4 — **24× too weak**. That is most of why a car with the throttle released kept sailing.
 */
const COAST_BRAKE_PER_WHEEL = 37.5;
/**
 * Seconds for the FOOT brake to reach full force. A pedal is not a switch — but it is not a dial either:
 * 0.45 read as "an unnaturally smooth dive" in the field, because a driver stabbing the brake reaches the
 * floor in a couple of tenths and the weight should transfer at that pace (plan 081/04, two field verdicts).
 */
const FOOT_BRAKE_RAMP_TIME = 0.2;
const DRAG_MIN_SPEED = 0.01; // below this, drag is noise and its direction is undefined (m/s)
const REVERSE_SPEED_EPS = 0.6; // below this forward speed, S means reverse (else brake)
const REVERSE_SEED_SPEED = 1; // m/s backward to kick reverse off a dead stop
const STEER_RATE = 1.2; // steering slew (rad/s) — eased so the car doesn't snap into turns
const STEER_RECENTER_RATE = 2.4; // faster return to centre when the wheel is released
const UPRIGHT_MIN = 0.6; // car-up·world-up above this = upright enough for the normal door entry
const STOP_THRESHOLD = 0.8; // forward speed (m/s) below which the car counts as stopped (for exit)
const VEHICLE_CLEARANCE = 0.6; // how far outside the car footprint the player must be to re-collide
const APPROACH_CANCEL_HOLD = 0.18; // s of movement input during the run-to-door before control returns (GTA-like lag)
const APPROACH_STALL_TIMEOUT = 1.5; // s of no progress toward the door (blocked path) before auto-cancelling
const APPROACH_STALL_EPSILON = 0.02; // planar distance (m) under which the player counts as not progressing per frame
/**
 * How long every wheel must be off the ground before the driver gets air control (s) — plan 081/06 §1.
 *
 * OURS, not the original's: SA gates on `m_nNumContactWheels`, which counts chassis collision contacts too
 * and drops to zero only when the car is genuinely flying. Here the four suspension RAYS are the whole test,
 * and they blink off over a kerb, a driveway lip or a crest for a frame or two. Without the debounce the
 * steering would briefly roll the car in the middle of an ordinary street corner.
 */
const AIRBORNE_DEBOUNCE = 0.15;

/** What {@link EnterVehicleSystem.appliedControls} reports while nobody is driving. */
const NO_CONTROLS: AppliedControls = { brake: 0, engineForce: 0, gear: 1, handbrake: false, steer: 0, throttle: 0 };

type Phase =
  | 'approaching'
  | 'exiting'
  | 'exitopen'
  | 'getin'
  | 'idle'
  | 'opening'
  | 'seated'
  | 'shuffle'
  | 'stepin'
  | 'stopping';

/**
 * Drives the full "enter the car" sequence (driver side): from within
 * {@link ENTER_RANGE}, Enter runs the player around to the driver door, opens it,
 * plays the climb-in clip while sliding into the seat, then holds the seated pose
 * and shuts the door. While seated the player rides the (dynamic) car. The
 * character controller + locomotion animation are gated while scripted.
 */
export class EnterVehicleSystem implements System {
  readonly name = 'enter-vehicle';

  private active: EnterableVehicle | null = null;
  private readonly aimCamera: (azimuth: number) => void;
  /** How long every wheel has been off the ground (s) — the in-air control's debounce (plan 081/06 §1). */
  private airborne = 0;
  private readonly animation: VehicleAnimator;
  private approachHeld = 0; // s of movement input held during 'approaching' → hand control back (GTA-like lag)
  private approachLast: Vec3 = [0, 0, 0]; // player position last 'approaching' frame (stall detection)
  private approachStalled = 0; // s without progress toward the door → auto-cancel a blocked approach
  /** Whether the driver is actively braking (handbrake or braking forward motion) — for the brake lights. */
  private braking = false;
  /** After an exit: pull the used door shut once the player has stepped clear of the footprint —
   *  closing it while he still stands in the doorway sweeps the panel through him. */
  private closeDoorWhenClear = false;
  private readonly config: Readonly<Config>;
  private readonly controller: CharacterControllerSystem;
  /** The last step's applied driving values — see {@link appliedControls}. */
  private controls: AppliedControls = { brake: 0, engineForce: 0, gear: 1, handbrake: false, steer: 0, throttle: 0 };
  /** Whether {@link applyControls} already ran this fixed step (the pre-step hook, or fixedUpdate's fallback). */
  private controlsAppliedStep = false;
  private readonly doors = new Map<EnterableVehicle, { lf: number; rf: number }>(); // per-side door angles
  private doorTarget = 0;
  /** The driven car's gearbox + its live shift state, rebuilt whenever the player changes car. */
  private drivetrain: DrivetrainState = createDrivetrainState();
  private engine = 0; // current engine force (N) the drivetrain asked for this step
  private enterHeld = false;
  private exitElapsed = 0;
  private exitFrom: Vec3 = [0, 0, 0];
  private exitTo: Vec3 = [0, 0, 0];
  /** Point the follow camera at the car while seated (null restores the player). */
  private readonly followTarget: (vehicle: EnterableVehicle | null) => void;
  /** How far the foot brake is pressed, 0..1 — see {@link rampFootBrake}. */
  private footBrakeRamp = 0;
  private gearbox: Gearbox | null = null;
  private gearboxFor: EnterableVehicle | null = null;
  private getinElapsed = 0;
  private getinFrom: Vec3 = [0, 0, 0];
  /** The climb-in/out clips' authored root travel (null on a TC without them → linear slide). */
  private getinMotion: null | ScriptedMotion = null;
  private getoutMotion: null | ScriptedMotion = null;
  private holdPos: Vec3 = [0, 0, 0]; // parked car pose, held still while the player slides in/out
  private holdQuat: [number, number, number, number] = [0, 0, 0, 1];
  private readonly input: InputState;
  private readonly logger: Logger;
  private phase: Phase = 'idle';
  private readonly physics: PhysicsWorld;
  private readonly placePlayer: (position: Vec3, moveBody?: boolean) => void;
  private readonly playerCollider: number;
  private readonly playerPosition: () => Vec3;
  private restoreWhenClear = false; // after exit: re-enable car collision once the player is clear
  private readonly seatOffset = new Vector3(); // scratch: seat-local → world offset (rotated by the car)
  private readonly seatQuat = new Quaternion(); // scratch: car body orientation
  private seatWorld: Vec3 = [0, 0, 0];
  /** The kerb-side shuffle to the driver seat after a passenger-door entry (088/09b). */
  private shuffleElapsed = 0;
  private shuffleFrom: Vec3 = [0, 0, 0];
  private shuffleMotion: null | ScriptedMotion = null;
  /** Which front door this sequence uses — picked by the player's side at approach (088/09b). */
  private side: DoorSide = 'lf';
  private steerAngle = 0; // current front-wheel steering (rad), slewed toward the input
  /** The lock the limiter granted on the last driven step (rad) — reported by {@link steeringModel}. */
  private steerLock = 0;
  private readonly vehicles: EnterableVehicle[] = [];

  constructor(
    input: InputState,
    playerPosition: () => Vec3,
    controller: CharacterControllerSystem,
    placePlayer: (position: Vec3, moveBody?: boolean) => void,
    animation: VehicleAnimator,
    aimCamera: (azimuth: number) => void,
    followTarget: (vehicle: EnterableVehicle | null) => void,
    config: Readonly<Config>,
    physics: PhysicsWorld,
    playerCollider: number,
    logger: Logger,
  ) {
    this.input = input;
    this.playerPosition = playerPosition;
    this.controller = controller;
    this.placePlayer = placePlayer;
    this.animation = animation;
    this.aimCamera = aimCamera;
    this.followTarget = followTarget;
    this.config = config;
    this.physics = physics;
    this.playerCollider = playerCollider;
    this.logger = logger;
  }

  add(vehicle: EnterableVehicle): void {
    this.vehicles.push(vehicle);
    this.doors.set(vehicle, { lf: 0, rf: 0 });
  }

  /**
   * What {@link drive} actually handed the controller on the last fixed step (plan 081/01 telemetry): a
   * capture must record the applied values, not the raw input — the engine force is ramped and the steer is
   * slewed, so the input alone cannot explain the response. All zero while nobody is driving.
   */
  appliedControls(): AppliedControls {
    return this.isSeated() ? this.controls : NO_CONTROLS;
  }

  /**
   * Driving + the seated rider run on the fixed step (lockstep with physics, after
   * the physics step and before render-sync) so the rider doesn't lag/jitter behind
   * the car: WSAD → engine/brake/steer, then snap the player onto the seat.
   */
  /**
   * Compute and APPLY this step's driving controls — called BEFORE the physics step (plan 081/02 §4).
   *
   * The raycast controller consumes engine/brake/steer inside `updateVehicle`, which runs at the top of
   * `physics.step`. Applying them afterwards, as `fixedUpdate` used to, meant every input reached the car
   * one step late: the player's press and the car's answer were always 16 ms apart, and plans 03-05 would
   * have tuned against that delay as if it were the car's behaviour.
   *
   * Idempotent within a step: {@link fixedUpdate} calls it if the host has no pre-step hook wired, so a host
   * that has not adopted the hook keeps working — one step late, exactly as before.
   */
  applyControls(step: number): void {
    if (this.controlsAppliedStep) {
      return;
    }
    this.controlsAppliedStep = true;
    if ((this.phase === 'seated' || this.phase === 'stopping') && this.active) {
      // Read the car's pose FIRST: controls are computed from the state the car is in right now, and the
      // stopping phase decides from that same state whether it may start the climb-out. Reading it after
      // driving would judge both on the previous step (a test caught exactly that — an overturned car chose
      // its crawl side from a stale orientation).
      this.readCarPose(this.active);
      this.drive(this.active, step);
    }
  }

  /** Whether pressing enter/exit now would do something: seated → can exit, idle with a car in range → can
   *  enter (mid-sequence the edge is a no-op). Drives the mobile Enter button's visibility (plan 055). */
  canEnterExit(): boolean {
    if (this.phase === 'seated') {
      return true;
    }

    return this.phase === 'idle' && this.nearestEnterable() !== null;
  }

  /** CLEO's `095F` read (plan 097/05): a door's current openness 0..1 — through the accessor the
   *  owning system publishes. Only the front doors swing (the walk-up animator drives no others). */
  doorOpenRatio(vehicle: EnterableVehicle, side: 'lf' | 'rf'): number {
    const angles = this.doors.get(vehicle);

    return angles ? Math.min(1, Math.abs(angles[side]) / Math.abs(DOOR_OPEN_ANGLE)) : 0;
  }

  fixedUpdate(step: number): void {
    // Controls FIRST if the host did not apply them pre-step; then the phase machine, which reads results.
    this.applyControls(step);
    this.controlsAppliedStep = false; // the step is over — the next one applies its own
    // All rider placement runs here (after the physics step, before render-sync) so render-sync
    // sees it the same frame AND the kinematic body is never teleported into the car (moveBody:
    // false) — a body inside the car shoves it (the entry/exit "pop").
    if (this.phase === 'getin') {
      this.advanceGetin(step);
    } else if (this.phase === 'shuffle') {
      this.advanceShuffle(step);
    } else if (this.phase === 'exiting') {
      this.advanceGetout(step);
    } else if ((this.phase === 'seated' || this.phase === 'stopping') && this.active) {
      this.driveSeated(this.active);
    }
  }

  /** The car the player is currently in/entering (for debug actions like flip), or null on foot. */
  getActive(): EnterableVehicle | null {
    return this.active;
  }

  /** Whether the seated driver is braking right now (for the brake lights). False unless actively driving. */
  isBraking(): boolean {
    return this.isSeated() && this.braking;
  }

  /**
   * Whether this system OWNS the player's pose right now — it is teleporting the rider along the climb-in /
   * seat / climb-out path, so a renderer must not apply its own walking rules (ground snap, locomotion
   * heading) on top. True from the moment the climb-in slide starts until the climb-out slide ends; merely
   * WALKING to the door is not riding.
   */
  isRiding(): boolean {
    return (
      this.phase === 'getin' ||
      this.phase === 'shuffle' ||
      this.phase === 'exiting' ||
      this.phase === 'exitopen' ||
      this.isSeated()
    );
  }

  /** Whether the player is seated in (driving) the active car — distinct from merely approaching/exiting. */
  isSeated(): boolean {
    return this.phase === 'seated' || this.phase === 'stopping';
  }

  /** True while a scripted enter/exit is playing — the camera should glide to its target, not auto-center on
   *  the ped's mid-sequence twitches (approach run, climb-in/out slides). `idle` and `seated` are the two
   *  settled states where auto-center belongs. */
  isSettling(): boolean {
    return this.phase !== 'idle' && this.phase !== 'seated';
  }

  /**
   * Put the player straight OUT of the car — no brake to a halt, no door, no climb-out clip. False (and
   * nothing changed) when nobody is seated.
   *
   * The twin of {@link seatInstantly}, taken for the same reason one step later: a scripted scene that must
   * hand its car back cannot depend on a sequence the WORLD is allowed to stall. The press-and-wait exit ran
   * five video scenes and then hung on the sixth — a route that ended on a freeway overpass — and because the
   * scene despawns its car afterwards, the player was left seated in a destroyed one: `Cannot read properties
   * of null (reading 'linvel')` every fixed step from then on, exactly the dead-body read {@link remove}
   * warns about. A climb-out that plays entirely behind a black overlay is not part of what a showcase shows.
   *
   * The player still leaves through a CLEAR door when there is one, and appears on the roof when there is
   * not — the same last resort {@link startExit} falls back to, so nothing here can be blocked.
   */
  leaveInstantly(): boolean {
    const car = this.isSeated() ? this.active : null;
    if (car === null) {
      return false;
    }
    this.physics.parkVehicle(car.controller); // handed back stationary, like every other exit
    this.steerAngle = 0;
    car.rig.setSteer(0);
    const side = this.isUpright(car) ? this.clearDoorSide(car) : null;
    if (side) {
      this.side = side;
      this.exitTo = this.doorwayWorld(car);
    } else {
      const [, , hz] = car.halfExtents;
      this.exitTo = [car.position[0], car.position[1], car.position[2] + hz + 1];
    }
    this.finishExit();

    return true;
  }

  /**
   * Drop a (parked, unoccupied) car when it is unloaded.
   *
   * `active` OUTLIVES the ride: the climb-out leaves it set so the door can finish closing behind the
   * player. If the streaming then unloads that car — walk far enough, or teleport — the caller destroys its
   * rigid body regardless of what this method decides, and a kept reference means the next door tick reads a
   * dead body: `Cannot read properties of null (reading 'translation')`, every fixed step, for good. (Found
   * by the 081/01 lap runner, whose per-scene teleports hit it on the second lap; on foot it needs a long
   * enough walk to be rare, not impossible.) So an IDLE active car is let go here. A car mid-sequence still
   * is not: dropping it would strand a climb — and the car being driven is at distance 0, so the
   * distance-based unload never asks.
   */
  remove(vehicle: EnterableVehicle): void {
    if (this.active === vehicle) {
      if (this.phase !== 'idle') {
        return;
      }
      this.active = null;
      this.closeDoorWhenClear = false;
    }
    const index = this.vehicles.indexOf(vehicle);
    if (index >= 0) {
      this.vehicles.splice(index, 1);
    }
    this.doors.delete(vehicle);
  }

  /** Settle into the seat: hold the driving pose and shut the door. */
  /**
   * Put the player straight into a car's driver seat — no walk, no door, no climb-in clip.
   *
   * Takes the same nearest-car-in-range choice a press would, so it seats the player in the car he is
   * standing next to. For automation that wants to measure DRIVING (the 081/01 lap runner) or to script a
   * character into a car later: the walk-in is a stateful sequence that depends on pathing and cancels
   * itself when the approach stalls, and making a capture depend on it meant losing laps on spots where the
   * identical walk had worked moments before — a lost lap is a hole in a baseline.
   *
   * Returns false (and changes nothing) when a sequence is already running or no car is in range.
   */
  seatInstantly(): boolean {
    const vehicle = this.phase === 'idle' ? this.nearestEnterable() : null;
    if (!vehicle) {
      return false;
    }
    this.active = vehicle;
    this.side = 'lf';
    this.closeDoorWhenClear = false;
    this.seatWorld = this.seatWorldOf(vehicle, 'driver');
    this.controller.setEnabled(false);
    this.physics.setColliderSensor(this.playerCollider, true); // rider = sensor → can't shove the car
    this.physics.ignoreVehicles(this.playerCollider, true);
    this.restoreWhenClear = false;
    this.startSeated();

    return true;
  }

  /**
   * The driven car's live steering model (096/02) — null on foot.
   *
   * Before the first driven step the granted lock is reported as the AUTHORED one, which is exactly what
   * {@link steerLimit} returns at a standstill — so a controller reading it on the step it takes the wheel
   * is not reading a zero.
   */
  steeringModel(): null | SteeringModel {
    const car = this.isSeated() ? this.active : null;
    if (car === null) {
      return null;
    }

    return {
      lockRad: this.steerLock > 0 ? this.steerLock : (car.handling.steeringLock * Math.PI) / 180,
      slewRate: STEER_RATE,
      steerAngle: this.steerAngle,
      wheelbase: wheelSpan(car.wheels),
    };
  }

  update(delta: number): void {
    const pressed = this.input.isActive('enterExit');
    const edge = pressed && !this.enterHeld;
    this.enterHeld = pressed;
    if (edge && this.phase === 'idle') {
      this.beginApproach();
    } else if (edge && this.phase === 'seated') {
      this.phase = 'stopping'; // brake to a halt first, then climb out (no exiting a moving car)
    }

    if (this.phase === 'approaching') {
      this.updateApproachCancel(delta); // movement input / a blocked path hands control back
    }
    if (this.phase === 'approaching' && this.controller.arrived) {
      this.phase = 'opening';
      this.doorTarget = this.openAngle();
      // Start the camera gliding behind the car NOW (the door is opening, the climb-in is next), so the
      // swing plays across the whole sequence instead of snapping when he lands in the seat.
      if (this.active) {
        this.aimCamera(this.active.heading);
      }
    }
    // Shut the exit door behind the player once he has stepped clear (field 2026-07-24: it must
    // close — just never through him standing in the doorway). Before animateDoor so the swing
    // starts this same frame.
    if (this.closeDoorWhenClear && this.phase === 'idle' && this.active && this.playerClearOf(this.active)) {
      this.doorTarget = 0;
      this.closeDoorWhenClear = false;
    }
    // The getin/exiting slides + seated ride run on the fixed step (see fixedUpdate).
    this.animateDoor(delta);
    if (this.phase === 'opening' && this.doorAngleOf(this.active) === this.openAngle()) {
      this.startStepin();
    }
    if (this.phase === 'stepin' && this.controller.arrived) {
      this.startGetin();
    }
    if (this.phase === 'exitopen' && this.doorAngleOf(this.active) === this.openAngle()) {
      this.startGetout();
    }
    // After exiting, only let the player collide with cars again once he's stepped clear —
    // restoring it while he still overlaps the body would shove the (dynamic) car.
    if (this.restoreWhenClear && this.phase === 'idle' && this.active && this.playerClearOf(this.active)) {
      this.physics.ignoreVehicles(this.playerCollider, false);
      this.restoreWhenClear = false;
    }
  }

  /** Move the player from the door to the seat along the climb-in clip's root path; then sit. */
  private advanceGetin(delta: number): void {
    if (this.active) {
      this.physics.holdBody(this.active.body, this.holdPos, this.holdQuat); // pin the parked car
    }
    this.getinElapsed += delta;
    const duration = this.getinMotion?.duration ?? GETIN_DURATION;
    const t = Math.min(this.getinElapsed / duration, 1);
    this.placePlayer(
      warpAlongRootMotion(this.getinFrom, this.seatWorld, this.getinMotion, t, this.active?.heading ?? 0),
    );
    if (t >= 1) {
      if (this.side === 'rf') {
        this.startShuffle();
      } else {
        this.startSeated();
      }
    }
  }

  /** Move the player from the seat back to the doorway along the climb-out clip's root path. */
  private advanceGetout(delta: number): void {
    if (this.active) {
      this.physics.holdBody(this.active.body, this.holdPos, this.holdQuat); // pin the parked car
    }
    this.exitElapsed += delta;
    const duration = this.getoutMotion?.duration ?? GETOUT_DURATION;
    const t = Math.min(this.exitElapsed / duration, 1);
    this.placePlayer(warpAlongRootMotion(this.exitFrom, this.exitTo, this.getoutMotion, t, this.active?.heading ?? 0));
    if (t >= 1) {
      this.finishExit();
    }
  }

  /** Advance the kerb-side shuffle to the driver seat (088/09b) — same warp as the climb-in. */
  private advanceShuffle(delta: number): void {
    if (this.active) {
      this.physics.holdBody(this.active.body, this.holdPos, this.holdQuat); // pin the parked car
    }
    this.shuffleElapsed += delta;
    const duration = this.shuffleMotion?.duration ?? SHUFFLE_DURATION;
    const t = Math.min(this.shuffleElapsed / duration, 1);
    this.placePlayer(
      warpAlongRootMotion(this.shuffleFrom, this.seatWorld, this.shuffleMotion, t, this.active?.heading ?? 0),
    );
    if (t >= 1) {
      this.startSeated();
    }
  }

  /** Move the active car's SEQUENCE door toward {@link doorTarget} — and always ease the OTHER
   *  door shut: an exit that picks the opposite side used to strand the entry door mid-swing
   *  (it read as "the driver door opened" while the body left through the passenger side). */
  private animateDoor(delta: number): void {
    if (!this.active) {
      return;
    }
    const angles = this.doors.get(this.active) ?? { lf: 0, rf: 0 };
    for (const side of ['lf', 'rf'] as const) {
      const target = side === this.side ? this.doorTarget : 0;
      const angle = angles[side];
      if (angle === target) {
        continue;
      }
      const remaining = target - angle;
      angles[side] = angle + Math.sign(remaining) * Math.min(Math.abs(remaining), DOOR_SPEED * delta);
      this.active.handle.setDoorAngle(side, angles[side]);
    }
    this.doors.set(this.active, angles);
  }

  /**
   * The driver's hands in the air (plan 081/06 §1): once every wheel has been off the ground for
   * {@link AIRBORNE_DEBOUNCE}, W/S pitch the car, A/D roll it (or yaw it with the handbrake up), at the
   * original's own strength. See `air-control.ts` for the formula and the three documented deviations.
   *
   * Only the DRIVEN car gets it — the original gates the whole block on there being a pad.
   */
  private applyAirControl(
    car: EnterableVehicle,
    input: { grounded: boolean; handbrake: boolean; steer: number; step: number; throttle: number },
  ): void {
    const { grounded, handbrake, steer, step, throttle } = input;
    this.airborne = grounded ? 0 : this.airborne + step;
    if (this.airborne <= AIRBORNE_DEBOUNCE) {
      return;
    }
    const delta = airAttitudeDelta({
      accelerating: throttle > 0,
      angular: this.physics.getAngvel(car.body),
      basis: carBasis(this.physics.readBody(car.body).quaternion),
      handbrake,
      pitch: throttle,
      scale: this.physics.airControlTuning().scale,
      steer,
      step,
      turnMass: car.handling.turnMass,
    });
    if (delta) {
      this.physics.spin(car.body, delta);
    }
  }

  /**
   * Air drag, the way the original applies it: a deceleration of `dragMult × v² / 2000` against the whole
   * velocity vector (`CPhysical::ApplyAirResistance`). It is what makes a top speed EXIST — before this, the
   * only thing that stopped a car accelerating was a hard cap, so every vehicle pulled as hard at 140 km/h as
   * it did at walking pace. Only the driven car gets it today; nothing else in the world drives itself yet.
   */
  private applyDrag(car: EnterableVehicle, step: number): void {
    const [vx, vy, vz] = this.physics.getLinvel(car.body);
    const speed = Math.hypot(vx, vy, vz);
    if (speed < DRAG_MIN_SPEED) {
      return;
    }
    const impulse = (dragDeceleration(car.handling.dragMult, speed) * car.handling.mass * step) / speed;
    this.physics.push(car.body, [-vx * impulse, -vy * impulse, -vz * impulse]);
  }

  /** Lock onto the nearest in-range car and send the player to its driver door. */
  private beginApproach(): void {
    const nearest = this.nearestEnterable();
    if (!nearest) {
      return;
    }

    this.active = nearest;
    this.closeDoorWhenClear = false; // entering again — the entry flow owns the door now
    // The NEAR front door (088/09b): a passenger-side approach uses the rf door + the seat shuffle,
    // instead of hiking around the car to the driver door. Among the doors the MODEL actually has:
    // a bus authored without a driver door boards through its real one (see doorSides).
    this.side = this.doorSides(nearest, this.playerLocal(nearest)[0] > 0 ? 'rf' : 'lf')[0];
    this.phase = 'approaching';
    this.approachHeld = 0;
    this.approachStalled = 0;
    this.approachLast = this.playerPosition();
    // Stop the player shoving the dynamic car while walking to the door / climbing in.
    this.physics.ignoreVehicles(this.playerCollider, true);
    this.restoreWhenClear = false; // entering again — keep ignoring cars
    this.controller.runPath(this.doorApproachPath(nearest, this.side));
    this.logger.debug('enter-vehicle', 'approach');
  }

  /** Abort an in-progress run-to-door: restore manual control and go idle. The player keeps ignoring the
   *  car until he steps clear (reuses the post-exit cleanup), so he doesn't shove it while standing next to it. */
  private cancelApproach(): void {
    this.controller.runPath([]); // empty path → manual control resumes next step
    this.phase = 'idle';
    this.restoreWhenClear = true; // re-collide with the car once the player walks clear (see update)
    this.approachHeld = 0;
    this.approachStalled = 0;
    this.logger.debug('enter-vehicle', 'approach cancelled');
  }

  /** The first clear crawl spot around a WRECK (roof-down OR on its side — the yaw-planar probe
   *  covers both): right side → left side → nose → tail; null when boxed in on all four. */
  private clearCrawlSpot(vehicle: EnterableVehicle): null | { local: [number, number]; target: Vec3 } {
    const [hx, hy] = vehicle.halfExtents;
    const candidates: [number, number][] = [
      [hx + DOORWAY_CLEAR + 0.4, vehicle.seatLocal[1]],
      [-(hx + DOORWAY_CLEAR + 0.4), vehicle.seatLocal[1]],
      [0, hy + 1.2],
      [0, -(hy + 1.2)],
    ];
    for (const local of candidates) {
      const target = this.crawlTargetAt(vehicle, local);
      if (this.pathClearTo(vehicle, target)) {
        return { local, target };
      }
    }

    return null;
  }

  /** The first FRONT door whose egress ray is clear, driver side first — or null when both are blocked. */
  private clearDoorSide(vehicle: EnterableVehicle): DoorSide | null {
    const [hx] = vehicle.halfExtents;
    for (const side of this.doorSides(vehicle, 'lf')) {
      this.side = side;
      // Probe PAST the doorway spot: a wall just beyond it still blocks the standing body there.
      const target = this.toWorld(vehicle, [sideSign(side) * (hx + DOORWAY_CLEAR + 0.6), vehicle.seatLocal[1]]);
      if (this.pathClearTo(vehicle, target)) {
        return side;
      }
    }

    return null;
  }

  /** Standing spot a crawl-out ends at, from a vehicle-local planar offset. The z is the real
   *  ground there LIFTED to capsule centre — anchoring at the ground itself buried half the capsule
   *  and stuck it in the collision (fell through / froze, field 2026-07-24). */
  private crawlTargetAt(vehicle: EnterableVehicle, local: [number, number]): Vec3 {
    const spot = this.toWorld(vehicle, local);
    const ground = this.physics.groundBelow([spot[0], spot[1], vehicle.position[2] + 1.5], 4, vehicle.body);

    return [spot[0], spot[1], ground === null ? spot[2] : ground + PLAYER_STAND_LIFT];
  }

  private doorAngleOf(vehicle: EnterableVehicle | null): number {
    return vehicle ? (this.doors.get(vehicle)?.[this.side] ?? 0) : 0;
  }

  /**
   * A world-space path (Z-up) to the standing spot outside `side`'s front door (088/09b). The door is
   * on the PLAYER'S side whenever the model has one there, so the approach is usually straight — the
   * bumper routing survives for ONE case: a model whose only front door sits on the far side (the
   * coach), where the straight line runs through the body and the approach stalls against it.
   */
  private doorApproachPath(vehicle: EnterableVehicle, side: DoorSide): Vec3[] {
    const [hx, hy] = vehicle.halfExtents;
    const sign = sideSign(side);
    const hinge = vehicle.handle.doorHinge(side);
    const entry: [number, number] = [(hinge?.[0] ?? sign * hx) + sign * DOOR_STANDOFF, hinge?.[1] ?? 0];
    const player = this.playerLocal(vehicle);
    if (Math.sign(player[0]) !== -sign) {
      return [this.toWorld(vehicle, entry)];
    }
    // Around the bumper END nearer the door, one corner per flank, then the door standoff.
    const cornerY = (entry[1] >= 0 ? 1 : -1) * (hy + DOOR_STANDOFF);

    return [
      this.toWorld(vehicle, [-sign * (hx + DOOR_STANDOFF), cornerY]),
      this.toWorld(vehicle, [sign * (hx + DOOR_STANDOFF), cornerY]),
      this.toWorld(vehicle, entry),
    ];
  }

  /** The DOOR PART that physically sits on a WORLD flank (plan 088 fr6): the crawl/egress spots are
   *  yaw-planar, but the door panels ride the body's FULL orientation — on a roof-down car model +x
   *  renders at world −x, so swinging `rf` for a world-+x crawl moved the door on the OPPOSITE side. */
  private doorOnWorldFlank(vehicle: EnterableVehicle, positiveX: boolean): DoorSide {
    const [qx, qy, qz, qw] = this.physics.readBody(vehicle.body).quaternion;
    // World direction of the model's +X axis, projected on the yaw-planar "right of heading".
    const axisX = 1 - 2 * (qy * qy + qz * qz);
    const axisY = 2 * (qx * qy + qz * qw);
    const rightDot = axisX * Math.cos(vehicle.heading) + axisY * Math.sin(vehicle.heading);
    // ε-biased: a car ON ITS SIDE has its x-axis vertical (dot ≈ ±1e−16 float noise) — bias the tie
    // to the upright naming instead of letting noise flip the door.
    const modelRightIsWorldRight = rightDot >= -1e-3;

    return positiveX === modelRightIsWorldRight ? 'rf' : 'lf';
  }

  /**
   * The front sides whose door PART the model actually carries, `preferred` first — the side an entry
   * or exit should use. A model authored without a driver door (the coach: only `door_rf`, the bus's
   * real entry) boards and leaves through the door it HAS — the same swap its bundled "Car Left Door"
   * CLEO script performs with ped tasks. A model with no front door parts at all (plain mods) keeps
   * both sides in order: the hinge fallback stands in, as it always has.
   */
  private doorSides(vehicle: EnterableVehicle, preferred: DoorSide): DoorSide[] {
    const ordered: DoorSide[] = preferred === 'lf' ? ['lf', 'rf'] : ['rf', 'lf'];
    const existing = ordered.filter((side) => vehicle.handle.doorHinge(side) !== null);

    return existing.length > 0 ? existing : ordered;
  }

  /** Standing spot in the open doorway of the sequence's side, aligned with the seat row. */
  private doorwayWorld(vehicle: EnterableVehicle): Vec3 {
    const [hx] = vehicle.halfExtents;

    return this.toWorld(vehicle, [sideSign(this.side) * (hx + DOORWAY_CLEAR), vehicle.seatLocal[1]]);
  }

  /**
   * Drive the seated car from WSAD via the raycast controller: engine force toward
   * a handling-scaled top speed, braking / reverse on back, and slewed front-wheel
   * steering (lock shrinks with speed). Forces are integrated by the physics step.
   */
  private drive(car: EnterableVehicle, step: number): void {
    const stopping = this.phase === 'stopping'; // braking to a halt before the player climbs out
    const move = this.input.move();
    const throttle = stopping ? 0 : move.y;
    const steerInput = stopping ? 0 : move.x;
    // Two DIFFERENT controls (plan 081/04, the user's scheme). Space and back-while-rolling are the FOOT
    // brake: it ramps in, the way a pedal does. H is the handbrake: instant and total, which is what a
    // handbrake IS. One key doing both is what made every stop feel like yanking the lever.
    // The LEVER (H) locks the rear axle and nothing else. `stopping` — the automatic halt before the player
    // climbs out — goes on the FOOT brake instead: it wants the car stopped, not sideways.
    const handbrake = this.input.isActive('handbrake');
    const footBrake = stopping || this.input.isActive('jump');
    const hnd = car.handling;
    // Real forward speed from the body's *horizontal* velocity (the controller's
    // currentVehicleSpeed carries a phantom ~0.95 at rest → would misread reverse).
    const [vx, vy] = this.physics.getLinvel(car.body);
    const speed = -vx * Math.sin(car.heading) + vy * Math.cos(car.heading);
    if (stopping && Math.abs(speed) <= STOP_THRESHOLD) {
      this.startExit(); // stopped → begin the climb-out

      return;
    }
    const box = this.gearboxOf(car);
    const brakeForce = hnd.brakeDecel * hnd.mass * BRAKE_UNITS_PER_DECEL_PER_KG;
    this.applyDrag(car, step);
    const grounded = this.physics.vehicleGrounded(car.controller);
    this.applyAirControl(car, { grounded, handbrake, steer: steerInput, step, throttle });

    const { brake, driverBraking, gear, targetEngine } = this.longitudinal(car, {
      box,
      brakeForce,
      footBrake,
      grounded,
      handbrake,
      speed,
      step,
      throttle,
    });
    // Brake lights come on when the DRIVER brakes — read off the INTENT, not off the force. Testing the force
    // meant they stayed dark while the pedal ramped in, and then (once coasting got the original's much
    // stronger wheel friction) that they could not be told from a coast at all.
    this.braking = driverBraking;

    // No ramp: the drivetrain does its own shaping now (the gear's thrust factor eases in over ~0.1 s and
    // dips on every shift), and a second smoothing on top of it would flatten the shifts back out.
    this.engine = targetEngine;

    // Ease the steering toward the input (gentle turn-in, quicker return to centre); how much of the
    // authored lock is usable at this speed comes from the tyres — see `steering.ts`.
    const sway = vx * Math.cos(car.heading) + vy * Math.sin(car.heading);
    // What the wheels are standing on, read ONCE per step (081/10 step 5): the limiter and the tyres must be
    // given the same number, and the probe is four rays — worth doing once, not twice.
    const wheelAdhesion = this.physics.readVehicleWheelAdhesion(car.controller, car.body);
    const frontAdhesion = meanFrontAdhesion(car.wheels, wheelAdhesion);
    const lock =
      ((hnd.steeringLock * Math.PI) / 180) *
      steerLimit({
        adhesion: frontAdhesion,
        handbrake,
        lockDeg: hnd.steeringLock,
        speed,
        steerAngle: this.steerAngle,
        swaySpeed: sway,
        traction: hnd.tractionMult,
      });
    this.steerLock = lock; // what an autopilot's `move.x` is a share OF this step (096/02)
    const target = -steerInput * lock; // D (right) turns the car right
    const rate = steerInput === 0 ? STEER_RECENTER_RATE : STEER_RATE;
    this.steerAngle += clamp(target - this.steerAngle, -rate * step, rate * step);

    this.physics.setVehicleControls(car.controller, car.wheels, {
      brake,
      brakeBias: hnd.brakeBias,
      drive: hnd.drive,
      engine: this.engine,
      handbrake,
      speed,
      steer: this.steerAngle,
      step,
      traction: { bias: hnd.tractionBias, loss: hnd.tractionLoss, mult: hnd.tractionMult },
      wheelAdhesion,
    });
    this.controls = { brake, engineForce: this.engine, gear, handbrake, steer: this.steerAngle, throttle };
    car.rig.setSteer(this.steerAngle); // front wheels turn with the physics steer
    // The drivetrain's own output, not the key: it is what spins a DRIVEN wheel that has nothing under it
    // (the original's `acceleration`), and it is zero while coasting or braking — so a free wheel runs down.
    car.rig.setThrust(this.engine);
  }

  /** Snap the rider onto the driven car's (full-transform) seat, after the step moved it. */
  private driveSeated(car: EnterableVehicle): void {
    const { position, quaternion } = this.physics.readBody(car.body);
    this.readCarPose(car);
    // Driving already happened this step — see `applyControls`. What is left here is the RESULT: the car's
    // live pose and the rider that rides it.
    if (this.phase === 'exiting' || this.phase === 'idle') {
      // The exit consumed this step (a crawl-out began / the roof fallback placed the player) —
      // re-seating now would clobber the crawl clip. `exitopen` still seats: the door is only opening.
      return;
    }

    // Seat the rider via the car's FULL transform so he tilts/flips with it (not just yaw).
    this.seatQuat.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    this.seatOffset
      .set(car.seatLocal[0], car.seatLocal[1], car.seatLocal[2] + SEAT_RAISE)
      .applyQuaternion(this.seatQuat);
    this.placePlayer([
      position[0] + this.seatOffset.x,
      position[1] + this.seatOffset.y,
      position[2] + this.seatOffset.z,
    ]);
    this.animation.setScripted(CAR_SIT, { loop: true, orientation: quaternion });
  }

  /** The heading the player faces once out of the doorway (mirrored on a passenger-side exit). */
  private exitFacing(): number {
    const heading = this.active?.heading ?? 0;

    return this.side === 'lf'
      ? Math.atan2(Math.cos(heading), -Math.sin(heading))
      : Math.atan2(-Math.cos(heading), Math.sin(heading));
  }

  /** Out of the car: restore manual control + locomotion, face away from the car, shut the door. */
  private finishExit(): void {
    const outward = this.exitFacing();
    this.placePlayer(this.exitTo);
    this.followTarget(null); // back to following the player on foot
    this.animation.setScripted(null);
    this.animation.faceTo(outward);
    this.physics.setColliderSensor(this.playerCollider, false); // solid again — walking
    this.restoreWhenClear = true; // re-enable car collision once the player has stepped clear (update)
    this.controller.setEnabled(true);
    // The door closes only once the player has STEPPED CLEAR (see update) — closing it now would
    // sweep the panel straight through him standing in the doorway (field 2026-07-24).
    this.doorTarget = this.doorAngleOf(this.active);
    this.closeDoorWhenClear = true;
    this.phase = 'idle';
    this.logger.log('enter-vehicle', 'exited');
  }

  /** The driven car's gearbox, built on the first step in a new car and kept until the player leaves it. */
  private gearboxOf(car: EnterableVehicle): Gearbox {
    if (this.gearboxFor !== car || this.gearbox === null) {
      this.gearbox = buildGearbox(car.handling);
      this.drivetrain = createDrivetrainState();
      this.gearboxFor = car;
    }

    return this.gearbox;
  }

  /** True if the car is roughly the right way up (its local +Z still points mostly up). */
  private isUpright(vehicle: EnterableVehicle): boolean {
    const [x, y] = this.physics.readBody(vehicle.body).quaternion;

    return 1 - 2 * (x * x + y * y) > UPRIGHT_MIN; // world-Z component of the body's local up
  }

  /**
   * What the engine and the brakes are asked for this step — the whole longitudinal decision in one place.
   *
   * Order matters and is the driver's: the handbrake beats everything, the foot brake beats the throttle,
   * and only then does the throttle decide between drive, reverse and coasting.
   */
  private longitudinal(
    car: EnterableVehicle,
    input: {
      box: Gearbox;
      brakeForce: number;
      footBrake: boolean;
      grounded: boolean;
      handbrake: boolean;
      speed: number;
      step: number;
      throttle: number;
    },
  ): { brake: number; driverBraking: boolean; gear: number; targetEngine: number } {
    const { box, brakeForce, footBrake, grounded, handbrake, speed, step, throttle } = input;
    const gear = this.drivetrain.gear;
    if (handbrake) {
      this.footBrakeRamp = 0; // the lever does not leave the pedal half-pressed behind it

      // The REAR wheels lock (`setVehicleControls` does that); the front gets nothing, so it keeps its full
      // cornering grip and the car rotates about the front axle instead of merely stopping. This is the SA
      // handbrake turn, and the steering limiter's own handbrake exemption hands the driver full lock to
      // hold and to catch it with.
      return { brake: 0, driverBraking: true, gear, targetEngine: 0 };
    }
    if (footBrake || (throttle < 0 && speed > REVERSE_SPEED_EPS)) {
      return { brake: brakeForce * this.rampFootBrake(step), driverBraking: true, gear, targetEngine: 0 };
    }
    this.footBrakeRamp = 0;
    if (throttle === 0) {
      // Coasting: the original's wheel friction, not a share of the car's own brakes.
      return { brake: COAST_BRAKE_PER_WHEEL * car.wheels.length, driverBraking: false, gear, targetEngine: 0 };
    }
    if (throttle < 0 && speed > -REVERSE_SEED_SPEED) {
      // The raycast controller won't start reverse from a dead stop; seed a small backward velocity until
      // it's rolling, then the reverse gear's own thrust sustains it.
      this.physics.seedReverse(car.body, car.heading, REVERSE_SEED_SPEED);
    }
    // Everything a car does under power now comes from the gearbox: the gear it is in, what that gear pulls,
    // and where the gear ends. No top-speed test here — reaching a gear's ceiling IS the limiter.
    const drive = driveAcceleration(box, car.handling, this.drivetrain, { grounded, speed, step, throttle });
    this.drivetrain.gear = drive.gear;

    return { brake: 0, driverBraking: false, gear: drive.gear, targetEngine: car.handling.mass * drive.accel };
  }

  /**
   * The nearest upright car within enter range, or null — the car Enter would target from idle.
   *
   * Range is measured to the car's FOOTPRINT (the halfExtents rectangle at its heading), not its centre:
   * a centre rule scaled with the car, so an 11 m coach was un-enterable from beside its own front door
   * (5.6 m of body between the door and the centre already spent the whole range).
   */
  private nearestEnterable(): EnterableVehicle | null {
    const [px, py] = this.playerPosition();
    let nearest: EnterableVehicle | null = null;
    let nearestDistance = ENTER_RANGE * ENTER_RANGE;
    for (const vehicle of this.vehicles) {
      // Can't get into an overturned / on-its-side car (must be roughly on its wheels).
      if (!this.isUpright(vehicle)) {
        continue;
      }
      const dx = px - vehicle.position[0];
      const dy = py - vehicle.position[1];
      // Into the vehicle frame: heading h faces (−sin h, cos h), its right side (cos h, sin h).
      const sin = Math.sin(vehicle.heading);
      const cos = Math.cos(vehicle.heading);
      const localRight = dx * cos + dy * sin;
      const localForward = -dx * sin + dy * cos;
      const [hx, hy] = vehicle.halfExtents;
      const outsideRight = Math.max(0, Math.abs(localRight) - hx);
      const outsideForward = Math.max(0, Math.abs(localForward) - hy);
      const distance = outsideRight * outsideRight + outsideForward * outsideForward;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = vehicle;
      }
    }

    return nearest;
  }

  /** The sequence door's fully-open angle — the driver-side sign, mirrored for the passenger door. */
  private openAngle(): number {
    return this.side === 'lf' ? DOOR_OPEN_ANGLE : -DOOR_OPEN_ANGLE;
  }

  /** Whether the egress toward `target` is unobstructed (the car excluded): two HORIZONTAL rays at
   *  fixed heights above the car's ground contact (knee 0.35 m + chest 0.85 m). Heights anchored to
   *  the car CENTRE grazed the road on cambered streets and false-blocked the driver door — the exit
   *  then silently went out the passenger side (field 2026-07-24). */
  private pathClearTo(vehicle: EnterableVehicle, target: Vec3): boolean {
    const { position } = this.physics.readBody(vehicle.body);
    // Anchor the ray heights to the REAL ground under the car: `position.z − hz` sat BELOW the road
    // for real models (the bbox is roof-heavy, the origin near the axles), so the knee ray grazed
    // the asphalt and false-blocked whichever side faced the road crown (field 2026-07-24 ×2).
    const ground = this.physics.groundBelow([position[0], position[1], position[2] + 0.5], 5, vehicle.body);
    const base = ground ?? position[2] - vehicle.halfExtents[2];
    for (const height of [0.35, 0.85]) {
      const z = base + height;
      const clear = this.physics.pathClear(
        [position[0], position[1], z],
        [target[0], target[1], z],
        vehicle.body,
        this.playerCollider, // belt-and-braces: the seated rider sits ON the driver-side ray
      );
      if (!clear) {
        return false;
      }
    }

    return true;
  }

  /** True once the player is outside the car's footprint (+ clearance) — safe to re-collide. */
  private playerClearOf(vehicle: EnterableVehicle): boolean {
    const [hx, hy] = vehicle.halfExtents;
    const [lx, ly] = this.playerLocal(vehicle);

    return Math.abs(lx) > hx + VEHICLE_CLEARANCE || Math.abs(ly) > hy + VEHICLE_CLEARANCE;
  }

  /** Player position in the vehicle's local frame (planar). */
  private playerLocal(vehicle: EnterableVehicle): [number, number] {
    const [px, py] = this.playerPosition();
    const dx = px - vehicle.position[0];
    const dy = py - vehicle.position[1];
    const cos = Math.cos(vehicle.heading);
    const sin = Math.sin(vehicle.heading);

    return [dx * cos + dy * sin, -dx * sin + dy * cos];
  }

  /**
   * The foot brake presses IN over {@link FOOT_BRAKE_RAMP_TIME}, and lets go instantly.
   *
   * The field verdict that produced this: *"the brake works like a handbrake, not a gradual loss of speed."*
   * It was literally true — full brake force on the first frame of the press. A pedal takes a moment to
   * reach the floor, and that moment is most of what braking FEELS like. Release is not ramped, because
   * lifting off a real pedal releases it.
   */
  private rampFootBrake(step: number): number {
    this.footBrakeRamp = Math.min(1, this.footBrakeRamp + step / FOOT_BRAKE_RAMP_TIME);

    return this.footBrakeRamp;
  }

  /** Copy the chassis pose off the rigid body onto the car — the gameplay state everything else reads. */
  private readCarPose(car: EnterableVehicle): void {
    const { position, quaternion } = this.physics.readBody(car.body);
    car.position[0] = position[0];
    car.position[1] = position[1];
    car.position[2] = position[2];
    car.heading = headingFromQuat(quaternion);
  }

  /** World seat position (Z-up): seat dummy in vehicle space → world, raised onto the capsule centre.
   *  The passenger seat is the driver seat mirrored to +X (088/09b). */
  private seatWorldOf(vehicle: EnterableVehicle, seat: 'driver' | 'passenger' = 'driver'): Vec3 {
    const seatX = seat === 'passenger' ? -vehicle.seatLocal[0] : vehicle.seatLocal[0];
    const [wx, wy] = this.toWorld(vehicle, [seatX, vehicle.seatLocal[1]]);

    return [wx, wy, vehicle.position[2] + vehicle.seatLocal[2] + SEAT_RAISE];
  }

  /** Crawl out (overturned / windscreen egress, 088/09d): no door swing, the crawl clip's root motion
   *  carries the low scramble; reuses the exiting phase's warp. */
  private startCrawlout(target: Vec3): void {
    if (!this.active) {
      return;
    }
    this.phase = 'exiting';
    this.exitElapsed = 0;
    this.exitFrom = this.playerPosition();
    this.exitTo = target;
    this.getoutMotion = this.animation.scriptedMotion(CAR_CRAWLOUT);
    this.storeHold(this.active);
    this.animation.setScripted(CAR_CRAWLOUT, { facing: this.active.heading, loop: false });
  }

  /** Settled in the seat + Enter → park (brake to a stop) and open the door to climb back out. */
  private startExit(): void {
    if (!this.active) {
      return;
    }
    this.physics.parkVehicle(this.active.controller); // hold the car still while CJ climbs out
    this.steerAngle = 0;
    this.active.rig.setSteer(0);
    if (!this.isUpright(this.active)) {
      // A WRECK (roof-down or on its side): probe the four planar exits and crawl out the first
      // clear one — a side-lying car has one door against the ground, so nothing is assumed. The
      // door that swings is the one on the CHOSEN flank (a fixed rf swing read as "the wrong door
      // opened" in the field); nose/tail crawls swing nothing. All four blocked → appear on top.
      const spot = this.clearCrawlSpot(this.active);
      if (spot && spot.local[0] !== 0) {
        // The door that swings is the one PHYSICALLY on the crawl-out flank — through the body's
        // full orientation, not yaw (roof-down flips model x in world).
        this.side = this.doorOnWorldFlank(this.active, spot.local[0] > 0);
        this.doorTarget = this.openAngle();
      }
      this.logger.log(
        'enter-vehicle',
        `egress wreck ${spot ? `crawl [${spot.local.join(',')}] door ${this.side}` : 'boxed in'}`,
      );
      if (spot) {
        this.startCrawlout(spot.target);

        return;
      }
      const top = Math.max(...this.active.halfExtents);
      this.exitTo = [this.active.position[0], this.active.position[1], this.active.position[2] + top + 1];
      this.finishExit();

      return;
    }
    // The 09d egress chain: driver door → passenger door → windscreen → appear on the car. A ray
    // from the car's centre to each spot decides "blocked" (a wall/car inside it).
    const side = this.clearDoorSide(this.active);
    this.logger.log('enter-vehicle', `egress ${side ?? 'doors blocked'}`);
    if (side) {
      this.side = side;
      this.phase = 'exitopen';
      this.doorTarget = this.openAngle();

      return;
    }
    const windscreen = this.crawlTargetAt(this.active, [0, this.active.halfExtents[1] + 1.2]);
    if (this.pathClearTo(this.active, windscreen)) {
      this.startCrawlout(windscreen);

      return;
    }
    // Everything around is blocked — appear on top of the car (the honest last resort, no clip).
    const [, , hz] = this.active.halfExtents;
    this.exitTo = [this.active.position[0], this.active.position[1], this.active.position[2] + hz + 1];
    this.finishExit();
  }

  /** At the doorway → gate the player, start the climb-in clip and slide to the seat. */
  private startGetin(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'getin';
    this.getinElapsed = 0;
    this.getinFrom = this.playerPosition();
    const clip = this.side === 'rf' ? CAR_GETIN_RHS : CAR_GETIN;
    this.getinMotion = this.animation.scriptedMotion(clip);
    // A passenger-door entry climbs into the PASSENGER seat first; the shuffle crosses after.
    this.seatWorld = this.seatWorldOf(this.active, this.side === 'rf' ? 'passenger' : 'driver');
    this.storeHold(this.active); // pin the parked car here while the player climbs in
    this.controller.setEnabled(false);
    this.physics.setColliderSensor(this.playerCollider, true); // rider = sensor → can't shove the car
    this.animation.setScripted(this.side === 'rf' ? CAR_GETIN_RHS : CAR_GETIN, {
      facing: this.active.heading,
      loop: false,
    });
  }

  /** Door is open → play the climb-out clip and slide from the seat to the doorway. */
  private startGetout(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'exiting';
    this.exitElapsed = 0;
    this.exitFrom = this.playerPosition();
    this.exitTo = this.doorwayWorld(this.active);
    // Glide the camera behind where the player will stand as the climb-out plays (not a snap on finish).
    this.aimCamera(this.exitFacing());
    this.getoutMotion = this.animation.scriptedMotion(this.side === 'rf' ? CAR_GETOUT_RHS : CAR_GETOUT);
    this.storeHold(this.active); // pin the (stopped) car here while the player climbs out
    this.animation.setScripted(this.side === 'rf' ? CAR_GETOUT_RHS : CAR_GETOUT, {
      facing: this.active.heading,
      loop: false,
    });
  }

  private startSeated(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'seated';
    this.engine = 0; // start from idle; drive() ramps the throttle
    this.steerAngle = 0; // start straight; drive() takes over the wheels from here
    this.airborne = 0; // a car climbed into mid-drop does not start with air control already earned
    this.placePlayer(this.seatWorld);
    this.animation.setScripted(CAR_SIT, { facing: this.active.heading, loop: true });
    this.followTarget(this.active); // track the car (smooth) — not the per-frame-teleported rider
    this.aimCamera(this.active.heading); // centre behind the rear once; free to orbit while driving
    this.doorTarget = 0; // pull the door shut from inside
    this.logger.log('enter-vehicle', 'seated');
  }

  /** Passenger-door entry reached the passenger seat → slide across to the driver seat (088/09b). */
  private startShuffle(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'shuffle';
    this.shuffleElapsed = 0;
    this.shuffleFrom = this.playerPosition();
    this.shuffleMotion = this.animation.scriptedMotion(CAR_SHUFFLE);
    this.seatWorld = this.seatWorldOf(this.active, 'driver');
    this.doorTarget = 0; // pull the passenger door shut while sliding across
    this.animation.setScripted(CAR_SHUFFLE, { facing: this.active.heading, loop: false });
  }

  /** Door is open → walk AROUND the open panel into the doorway (088/09c): back along the outside
   *  of the door's swept arc at the standoff distance (the panel at 60° reaches ~0.9 m out — inside
   *  the 1.2 m standoff ring), then straight in from abeam the seat. The old single-waypoint path cut
   *  a diagonal THROUGH the open panel. */
  private startStepin(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'stepin';
    const [hx] = this.active.halfExtents;
    const sign = sideSign(this.side);
    const hinge = this.active.handle.doorHinge(this.side);
    const standoffX = (hinge?.[0] ?? sign * hx) + sign * DOOR_STANDOFF;
    // Three legs, all outside the open panel (field 2026-07-24 — the two-leg path still clipped it):
    // back along the standoff ring past the panel's swept rear edge, inboard BEHIND the panel, then
    // forward along the body into the doorway.
    const behindY = Math.min(this.active.seatLocal[1], (hinge?.[1] ?? 0) - DOOR_SWEPT_CLEARANCE);
    this.controller.runPath([
      this.toWorld(this.active, [standoffX, behindY]),
      this.toWorld(this.active, [sign * (hx + DOORWAY_CLEAR), behindY]),
      this.doorwayWorld(this.active),
    ]);
  }

  /** Snapshot the car's current transform so {@link advanceGetin}/{@link advanceGetout} can pin it. */
  private storeHold(car: EnterableVehicle): void {
    const { position, quaternion } = this.physics.readBody(car.body);
    this.holdPos = [position[0], position[1], position[2]];
    this.holdQuat = [quaternion[0], quaternion[1], quaternion[2], quaternion[3]];
  }

  /** A vehicle-local planar point → world point (Z-up), at the car's height. */
  private toWorld(vehicle: EnterableVehicle, local: [number, number]): Vec3 {
    const cos = Math.cos(vehicle.heading);
    const sin = Math.sin(vehicle.heading);

    return [
      vehicle.position[0] + local[0] * cos - local[1] * sin,
      vehicle.position[1] + local[0] * sin + local[1] * cos,
      vehicle.position[2],
    ];
  }

  /**
   * GTA-style interrupt of the run-to-door (only while 'approaching'): movement input hands control back
   * after a short hold (a slight lag, not an instant cancel on a stray tap); and a blocked path — no planar
   * progress for {@link APPROACH_STALL_TIMEOUT} — auto-cancels so Tommy doesn't run in place forever.
   */
  private updateApproachCancel(delta: number): void {
    const move = this.input.move();
    const moving = move.x !== 0 || move.y !== 0;
    this.approachHeld = moving ? this.approachHeld + delta : 0;

    const [px, py] = this.playerPosition();
    const progressed = Math.hypot(px - this.approachLast[0], py - this.approachLast[1]) > APPROACH_STALL_EPSILON;
    this.approachLast = [px, py, 0];
    this.approachStalled = progressed ? 0 : this.approachStalled + delta;

    if (this.approachHeld >= APPROACH_CANCEL_HOLD || this.approachStalled >= APPROACH_STALL_TIMEOUT) {
      this.cancelApproach();
    }
  }
}

/**
 * The adhesion the STEERING wheels have: the mean over the front axle (081/10 step 5).
 *
 * The mean rather than the worst, because a car with one front wheel on the verge still steers on the other,
 * and the limiter's job is to grant what the axle can answer. Falls back to the whole set when a model has
 * no wheel flagged front (bikes, trailers) — better a number than a special case.
 */
export function meanFrontAdhesion(wheels: readonly { front: boolean }[], adhesion: readonly number[]): number {
  const front = adhesion.filter((_, index) => wheels[index]?.front);
  const used = front.length > 0 ? front : adhesion;

  return used.length === 0 ? ROAD_ADHESION_FALLBACK : used.reduce((sum, value) => sum + value, 0) / used.length;
}

/**
 * A point along a scripted move (plan 088/09a): the clip's authored root path carries the SHAPE
 * (the doorway dip, the drop into the seat) while a linear correction distributes the clip-vs-world
 * endpoint mismatch — the move still starts exactly at `from` and ends exactly at `to`. The clip's
 * ped-local frame maps through the facing `heading` (x = right, y = forward, z = up). Without a
 * motion (a TC whose IFP lacks the clip) it degrades to the straight slide. Pure + exported so the
 * warp guarantees are unit-testable.
 */
export function warpAlongRootMotion(
  from: Vec3,
  to: Vec3,
  motion: null | ScriptedMotion,
  t: number,
  heading: number,
): Vec3 {
  if (!motion) {
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
  }
  const start = motion.sample(0);
  const now = motion.sample(t * motion.duration);
  const end = motion.sample(motion.duration);
  const forward: [number, number] = [-Math.sin(heading), Math.cos(heading)];
  const right: [number, number] = [Math.cos(heading), Math.sin(heading)];
  const world = (p: readonly [number, number, number]): Vec3 => [
    right[0] * (p[0] - start[0]) + forward[0] * (p[1] - start[1]),
    right[1] * (p[0] - start[0]) + forward[1] * (p[1] - start[1]),
    p[2] - start[2],
  ];
  const path = world([now[0], now[1], now[2]]);
  const total = world([end[0], end[1], end[2]]);

  return [
    from[0] + path[0] + (to[0] - from[0] - total[0]) * t,
    from[1] + path[1] + (to[1] - from[1] - total[1]) * t,
    from[2] + path[2] + (to[2] - from[2] - total[2]) * t,
  ];
}

/** Tarmac, for a car whose wheels reported nothing at all — the same value `steering.ts` falls back to. */
const ROAD_ADHESION_FALLBACK = 4.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Yaw about +Z from a body quaternion `[x, y, z, w]` (the car's heading), via its forward (+Y). */
function headingFromQuat(q: readonly number[]): number {
  const [x, y, z, w] = q;
  const forwardX = 2 * (x * y - w * z);
  const forwardY = 1 - 2 * (x * x + z * z);

  return Math.atan2(-forwardX, forwardY);
}

/**
 * Front-to-rear hub span of the car's OWN wheel placements (m) — the wheelbase {@link SteeringModel} reports.
 *
 * Derived from the asset, never a constant per model: a bike, a bus and a Comet each answer for themselves,
 * and a modded slot answers for whatever geometry is in it. 0 for a car with no wheels at all (the caller
 * treats that as "no steering model to command").
 */
function wheelSpan(wheels: readonly VehicleWheelPlacement[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const wheel of wheels) {
    min = Math.min(min, wheel.connection[1]);
    max = Math.max(max, wheel.connection[1]);
  }

  return max > min ? max - min : 0;
}
