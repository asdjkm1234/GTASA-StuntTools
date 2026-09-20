/**
 * The camera director (plan 080/01): one pure step that turns a frame SNAPSHOT into the `CameraState` the
 * engine renders. The host stops mutating yaw/pitch/eye in its event handlers — it reports raw input, the
 * director owns the rig.
 *
 * Layer order, fixed (each later plan fills its layer):
 *
 *   look → zoom → mode rig (foot | vehicle | fly) → collision (plan 04) → additive motion (plan 06) → resolve
 *
 * Collision runs BEFORE additive motion so a bob can never push the eye through a wall.
 *
 * Everything here is frame-rate independent by construction: the step takes `dt` and any smoothing goes
 * through `@opensa/math`'s damp/spring helpers (plan 02 onward). With every smoothing channel zeroed the rig
 * still reduces to the pre-080 stick camera exactly, which `camera-director.test.ts` pins.
 */
import type { CameraState } from '@opensa/engine';
import type { CameraConfig } from '@opensa/game';

import { angleDelta, clamp, damp, smoothDampAngle, type SmoothDampRef, smoothstep } from '@opensa/math';

import { type AutoCenterState, cancelAutoCenter, createAutoCenter, stepAutoCenter, yawBehind } from './auto-center';
import {
  type CameraProbe,
  type CollisionState,
  createCollisionState,
  type GroundProbe,
  guardFloor,
  resolveCollision,
} from './camera-collision';
import { createLookInput, type LookInputState, releaseLook } from './camera-input';
import { createMotion, type MotionOffset, type MotionState, stepMotion } from './camera-motion';
import { CAMERA_FOV_Y, forwardFrom, resolveCamera, screenBasis, type VideoCamera } from './engine-camera';
import { dollyStep, FLY_SPEED, flyStep, MAP_YAW, panStep, TOP_DOWN_PITCH, topDownEye } from './fly-rig';
import { createFollowPoint, type FollowPointState, resetFollowPoint, stepFollowPoint } from './follow-rig';
import { createLookAhead, type LookAheadState, stepLookAhead } from './look-ahead';
import { driftHeading, vehicleDistanceForSpeed, vehicleFovTarget, vehicleTuning } from './vehicle-camera';

/** The rig's live state. A plain mutable record owned by the host and stepped in place — the same shape the
 *  character controller uses, so the frame loop allocates nothing per frame. */
export interface CameraRigState {
  /** Auto-centering: the idle clock and the turn-follow latch (plan 03). */
  autoCenter: AutoCenterState;
  /** Collision layer's damped shown-distance (plan 04). */
  collision: CollisionState;
  /** Follow distance, in world units — damps toward {@link distanceTarget}. */
  distance: number;
  /** Where the zoom is heading (the wheel and, later, the mode/collision layers all write this one target). */
  distanceTarget: number;
  /** The detached free-fly eye, or null when the rig is attached to a focus. */
  flyEye: [number, number, number] | null;
  /** The smoothed point the rig frames (plan 02) — not the focus itself. */
  follow: FollowPointState;
  /** The eased idle distance offset (world units, ≥ 0) — creeps toward `footIdleDistanceEase` while still,
   *  returns through the zoom damp on any input. */
  footIdleEase: number;
  /** How long the player has been fully STILL on foot (no movement, no look, no zoom) — the idle
   *  distance-ease clock (plan 09 §2). Unlike `autoCenter.idleFor`, movement resets this one. */
  footStillFor: number;
  /** The live vertical field of view (radians) — driving widens it with speed (plan 05), everything else
   *  eases it back to {@link CAMERA_FOV_Y}. Picking unprojects through this same value. */
  fov: number;
  /** The focus this rig framed last frame — the planar velocity every 03 channel reads is derived from it,
   *  so the director needs no velocity plumbing from the host and measures the FRAMED object (ped or car). */
  lastFocus: [number, number, number] | null;
  /** The seated car's speed last frame (signed, u/s) — the acceleration source for plan 09 §3. Null on foot
   *  so the first seated frame never reads an entry jump as a launch. */
  lastVehicleSpeed: null | number;
  /** Unapplied pointer travel (plan 02's input damper). */
  look: LookInputState;
  /** The composition offset toward travel (plan 03). */
  lookAhead: LookAheadState;
  /** The look-behind hold was active last frame — the falling edge is what fires the swing back (plan
   *  080/05 §6; a standing car has no chase to bring the camera home on its own). */
  lookingBehind: boolean;
  /** Bob / landing dip / shake / sprint-kick state (plan 06). */
  motion: MotionState;
  pitch: number;
  /** Low-passed positive longitudinal acceleration, as a 0..{@link ACCEL_MAX_FACTOR} share of
   *  {@link ACCEL_FULL_MS2} — a launch stretches the framing back, gear noise does not (plan 09 §3). */
  vehicleAccel: number;
  /** The smoothed planar focus velocity (units/s) look-ahead and auto-center read — see {@link focusVelocity}. */
  velX: number;
  velZ: number;
  yaw: number;
  /** A one-swing lag override for the steered channel (seconds) — the look-behind flip uses its own fast
   *  time. Cleared with the target (settle or mouse), so it never outlives the swing it was set for. */
  yawLagOverride: null | number;
  /** A yaw something OTHER than the player asked for (vehicle entry today, auto-center in plan 03) — the rig
   *  swings toward it over `yawLagTime`. Null when the player owns the yaw, which any look input restores. */
  yawTarget: null | number;
  yawVelocity: SmoothDampRef;
}

/** Everything the director needs from the host this frame. Plain data, engine Y-up, assembled per frame. */
export interface CameraSnapshot {
  /** The player is off the ground — the bob damps out (a jump arc is already motion). Never true seated. */
  airborne: boolean;
  aspect: number;
  /** A running bench owns the frame outright (the BenchPlugin contract) — the rig still steps, its output is
   *  discarded. That is the invariant keeping camera work out of ritual/soak numbers. */
  bench: null | { eye: [number, number, number]; target: [number, number, number] };
  dt: number;
  /** The point the rig frames: the player, or the car they are seated in (engine space). */
  focus: readonly [number, number, number];
  /** Which way the framed object FACES (GTA heading radians) — `Locomotion.heading`, which is rate-limited
   *  and plant-aware, not an atan2 of the velocity (that jitters at low speed and flips on a strafe). */
  focusHeading: number;
  /** Peak vehicle contact force this frame (N), 0 when nothing was hit — the impact shake's trigger. Read
   *  off the damage system's own collision observation rather than a second listener. */
  impactForce: number;
  /** The vertical impact speed (units/s) of a landing that STARTED this frame, else 0 — plan 088's
   *  `Locomotion.fallSpeed` at the landing edge. */
  landingSpeed: number;
  /** Raw pointer deltas this frame, in pixels (sensitivity is the director's business, not the host's). */
  look: { x: number; y: number };
  /** The look-behind key is HELD this frame (plan 080/05 §6) — while driving, the camera flips to the
   *  car's front through `lookBehindLagTime` and swings back on release. Ignored on foot and in fly. */
  lookBehind: boolean;
  mode: CameraMode;
  /** Fly only: left-drag pan delta in NDC since the last frame; null when nothing is being dragged. */
  pan: null | { x: number; y: number };
  /** A scripted enter/exit is mid-sequence: hold auto-center off (the steered swing to the target still
   *  plays) so the camera does not chase the ped's approach-run and climb twitches. */
  settling: boolean;
  /** The driven car's speed and slip this frame, or null on foot — the physics channel (plan 081/01's
   *  `planarMotion`) the speed curves and the drift lean read. Deriving it from the focus delta instead
   *  would measure the RENDER loop, and a slide has no signature there at all. */
  vehicle: null | { slipAngle: number; speed: number };
  /** The follow distance a seated car wants (its length × `vehicleDistanceScale`), or null on foot. The live
   *  distance eases to it, and collision caps it. */
  vehicleDistance: null | number;
  /**
   * Video mode's director owns the frame (096/03) — the rig still steps, its output is discarded, exactly
   * as under a bench. Null whenever video mode is off OR the shot in play is `chase`, which yields the frame
   * back to the rig rather than re-deriving it.
   */
  video: null | VideoCamera;
  /** Fly only: the movement keys held this frame ({@link FLY_KEYS}). */
  walkKeys: ReadonlySet<string>;
  /** Wheel notches this frame: + away from the user (zoom out / dolly back), − toward it. */
  zoomSteps: number;
}

/** Who the rig is framing this frame. The bench is not a mode — it overrides the whole rig (see below).
 *  Reachable from outside as `CameraSnapshot['mode']`. */
type CameraMode = 'fly' | 'foot' | 'vehicle';

/** How fast the measured focus velocity tracks its instantaneous value (per second). ~0.05 s half-life —
 *  enough to average out the fixed-step saw, short enough that look-ahead still feels responsive. */
const VELOCITY_LAMBDA = 14;
/** The longitudinal acceleration that earns the full `vehicleAccelDistanceGain` (m/s² ≈ 0.6 g) and the
 *  cap above it — a launch harder than authored still stretches, but boundedly (plan 09 §3). */
const ACCEL_FULL_MS2 = 6;
const ACCEL_MAX_FACTOR = 1.5;
/** Low-pass on the accel signal (per second, ~0.35 s half-life) — a gear shift is a blip, a launch is a
 *  second-plus; the filter passes one and not the other. */
const ACCEL_LAMBDA = 2;
/** The walk speed where the run distance gain starts fading in (u/s) — full at `footRunFullSpeed`. */
const FOOT_WALK_SPEED = 2;
/** How fast the idle distance ease creeps IN (per second) — deliberately far under `zoomLambda`, which is
 *  what carries it back OUT the moment any input arrives: settling is slow, waking is ordinary. */
const IDLE_EASE_LAMBDA = 0.5;

export function createRigState(config: CameraConfig, yaw: number, pitch: number): CameraRigState {
  return {
    autoCenter: createAutoCenter(),
    collision: createCollisionState(config.followDistance),
    distance: config.followDistance,
    distanceTarget: config.followDistance,
    flyEye: null,
    follow: createFollowPoint(),
    footIdleEase: 0,
    footStillFor: 0,
    fov: CAMERA_FOV_Y,
    lastFocus: null,
    lastVehicleSpeed: null,
    look: createLookInput(),
    lookAhead: createLookAhead(),
    lookingBehind: false,
    motion: createMotion(),
    pitch,
    vehicleAccel: 0,
    velX: 0,
    velZ: 0,
    yaw,
    yawLagOverride: null,
    yawTarget: null,
    yawVelocity: { velocity: 0 },
  };
}

/** Re-seed the zoom from an authored distance the debugger changed (074/22). */
export function reseedDistance(state: CameraRigState, config: CameraConfig, authored: number): void {
  state.distanceTarget = clamp(authored, config.followZoomMin, config.followZoomMax);
  state.distance = state.distanceTarget;
}

/** Detach (or re-attach) the free-fly eye. Entering seeds it from the live camera, so the view never jumps. */
export function setFlyEye(state: CameraRigState, eye: [number, number, number] | null): void {
  state.flyEye = eye;
}

/**
 * Enter the map viewer: straight over the focus, looking down (074/22 — activation must be visible) and
 * oriented north-up ({@link MAP_YAW}). The yaw is RESET, not inherited: the eye carries the player's heading,
 * so opening the viewer while he faced north drew the whole map upside down.
 */
export function snapTopDown(state: CameraRigState, focus: readonly [number, number, number]): void {
  state.flyEye = topDownEye(focus);
  state.pitch = TOP_DOWN_PITCH;
  state.yaw = MAP_YAW;
}

/**
 * Aim the camera BEHIND a facing the player did not choose — vehicle entry lines it up behind the car, the
 * exit swings it behind the dismounting player. `facing` is a GTA heading; the rig sits at `yawBehind` of it.
 * The swing is damped, and any look input cancels it.
 */
export function steerYaw(state: CameraRigState, facing: number): void {
  state.yawTarget = yawBehind(facing);
}

/**
 * Step the rig one rendered frame and resolve the camera. `state` is mutated in place; the returned
 * `CameraState` is what the engine draws.
 */
export function stepCamera(
  state: CameraRigState,
  snapshot: CameraSnapshot,
  authored: CameraConfig,
  probe: CameraProbe | null = null,
  groundProbe: GroundProbe | null = null,
): CameraState {
  // ONE rig, two tuning tables (plan 05): driving substitutes its own lag/release numbers and every channel
  // below reads them without knowing which table it got. Nothing branches on the mode except the two writers
  // driving actually adds (the speed curves and the drift lean).
  const config = snapshot.mode === 'vehicle' ? vehicleTuning(authored) : authored;
  // The debugger moves the zoom BOUNDS live (074/22), so the live target is re-clamped every frame.
  state.distanceTarget = clamp(state.distanceTarget, config.followZoomMin, config.followZoomMax);
  applyLook(state, snapshot, config);
  stepLookBehind(state, snapshot, config);
  steerYawChannel(state, config, snapshot.dt);
  const forward = forwardFrom(state.yaw, state.pitch);
  applyZoom(state, snapshot, config, forward);
  const [x, y, z] = snapshot.focus;
  // Measured BEFORE the distance writers: the run gain and the directional authority read it this frame.
  const velocity = focusVelocity(state, snapshot, config);
  const planarSpeed = Math.hypot(velocity.x, velocity.z);
  // In a car the distance follows the car's SIZE, opened up by its SPEED (#5) and stretched by a LAUNCH
  // (plan 09 §3); on foot it follows the wheel zoom, breathing with the gait (plan 09 §2 — a run opens it,
  // real stillness eases it in). Either way the live distance eases toward it — so a spun wheel, a fresh
  // car and hard braking all glide rather than step.
  const speed = snapshot.vehicle?.speed ?? 0;
  const offsets = stepDistanceOffsets(state, snapshot, config, planarSpeed);
  const distanceTarget =
    snapshot.vehicleDistance === null
      ? state.distanceTarget + offsets.foot
      : vehicleDistanceForSpeed(snapshot.vehicleDistance, speed, config) + offsets.vehicle;
  state.distance = damp(state.distance, distanceTarget, config.zoomLambda, snapshot.dt);
  if (snapshot.mode === 'fly') {
    stepFlyRig(state, snapshot, forward);
    // A detached eye owns its own position; the follow point must not fly across the map when it re-attaches.
    resetFollowPoint(state.follow);
  }
  // Additive motion (plan 06): bob, the landing dip, impact shake and the sprint FOV kick. Stepped here so
  // it reads THIS frame's measured speed; its FOV contribution joins the target below and eases through the
  // same damp, while its OFFSETS are applied last of all — after collision, so a bob can never push the eye
  // through a wall.
  const motion = stepMotion(
    state.motion,
    {
      airborne: snapshot.airborne,
      dt: snapshot.dt,
      impact: snapshot.impactForce,
      landing: snapshot.landingSpeed,
      mode: snapshot.mode,
      speed: planarSpeed,
    },
    config,
  );
  // FOV is the other half of the speed sense (#5), plus 06's sprint kick. On foot the base target is the
  // base lens, so leaving a car eases the widening out through the same channel instead of cutting it.
  const fovTarget = (snapshot.mode === 'vehicle' ? vehicleFovTarget(speed, config) : CAMERA_FOV_Y) + motion.fov;
  state.fov = damp(state.fov, fovTarget, config.vehicleFovLambda, snapshot.dt);
  // Auto-center runs on foot AND in a car — the camera settles behind whatever the player is driving. Only
  // the LOOK-AHEAD lean stays on foot: a car's version is drift framing (it leans toward the SLIDE, not the
  // heading), which is plan 05's, tuned against a car's speeds. A scripted enter/exit suspends it: the
  // steered swing (set at the start of the sequence) glides to the target while the ped's twitches are
  // ignored.
  //
  // How much movement may ROTATE the camera is the directional authority (plan 09 §1): the normalized
  // away-component of the focus velocity along the camera forward, shaped by the config band — walking
  // away is 1, a strafe ≈ 0, moving at the camera 0. That last case used to be a dedicated boolean (the
  // about-face loop: movement input is camera-relative and recentring behind a backing-up player flips
  // what "back" means, a spin the player cannot stop — SA holds the camera still for it too); the
  // authority subsumes it and extends the same protection continuously to every direction, which is the
  // 09 brief: movement never turns the camera, except easing behind a walk away.
  const awayRate = velocity.x * Math.sin(state.yaw) + velocity.z * Math.cos(state.yaw);
  const away = planarSpeed > 1e-3 ? awayRate / planarSpeed : 0;
  const authority = smoothstep(config.footYawAuthorityStart, config.footYawAuthorityFull, away);
  const approaching = awayRate < 0;
  const centering = !snapshot.settling && (snapshot.mode === 'foot' || snapshot.mode === 'vehicle');
  if (centering) {
    // Drift framing (#10) is expressed as a HEADING, not as a second yaw writer: the camera settles behind
    // where the car is going rather than where its nose points, and every existing rule (the swing, the
    // settle epsilon, the manual override) applies to it unchanged.
    const heading = snapshot.vehicle
      ? driftHeading(snapshot.focusHeading, snapshot.vehicle.slipAngle, snapshot.vehicle.speed, config)
      : snapshot.focusHeading;
    const step = stepAutoCenter(state.autoCenter, state.yaw, heading, planarSpeed, config, snapshot.dt, {
      authority,
      // Driving chases continuously; the on-foot turn-follow latch would hitch through a long corner.
      continuous: snapshot.mode === 'vehicle' && state.autoCenter.idleFor > config.recenterDelaySec,
    });
    state.yaw = step.yaw;
    if (step.steerTo !== null) {
      state.yawTarget = step.steerTo;
    } else if (step.released) {
      // The authority cut a steer short: drop the in-flight target too, or the camera finishes a swing the
      // player's movement no longer justifies. A natural settle keeps it — the fine end stays smooth.
      state.yawTarget = null;
    }
  } else {
    cancelAutoCenter(state.autoCenter);
  }
  const target = stepFollowPoint(
    state.follow,
    [x, y + config.followHeight, z],
    config,
    snapshot.dt,
    snapshot.mode !== 'fly',
  );
  // Look-ahead keeps the pre-09 gate exactly (accepted in the 02-04 field round): on foot, not mid-sequence,
  // and not while walking at the camera — the yaw's smooth authority does not apply to a look-point offset.
  const ahead =
    centering && !approaching && snapshot.mode === 'foot'
      ? stepLookAhead(state.lookAhead, velocity.x, velocity.z, config, snapshot.dt)
      : stepLookAhead(state.lookAhead, 0, 0, config, snapshot.dt);
  const lookPoint: [number, number, number] = [target[0] + ahead.x, target[1], target[2] + ahead.z];
  // Collision (plan 04): cap the distance so the eye clears geometry between the look point and the eye —
  // on foot AND in a car (the camera slides along walls, never through them). The eye sits at
  // `lookPoint − forward · distance`, so the cast runs from the look point along `−forward`. A detached fly
  // eye flies through geometry by design and the bench is bypassed. A scripted enter/exit keeps the cap but
  // EASES it in both directions: suspending it outright (the first cut) stopped the camera sliding along
  // surfaces and let it sink through the ground mid-climb, while snapping it in read as a jump — which is
  // what the 04 field round rejected.
  const attached = !state.flyEye && !snapshot.bench && !snapshot.video;
  const collideDistance = attached
    ? resolveCollision(
        state.collision,
        lookPoint,
        [-forward[0], -forward[1], -forward[2]],
        state.distance,
        config,
        probe,
        snapshot.dt,
        snapshot.settling,
      )
    : state.distance;

  const camera = resolveCamera({
    aspect: snapshot.aspect,
    bench: snapshot.bench,
    distance: collideDistance,
    flyEye: state.flyEye,
    forward,
    fovYRad: state.fov,
    // The offset moves eye AND target together (resolveCamera derives the eye from the target), so the
    // composition leans toward travel while the orbit geometry the collision layer defends is untouched.
    target: lookPoint,
    video: snapshot.video,
  });

  // Floor guard runs whenever the rig is attached (incl. during a car enter/exit) so a steep down-pitch on a
  // slope/porch, or a low seat, can't bury the eye and show only skybox.
  const guarded = attached ? { ...camera, eye: guardFloor(camera.eye, groundProbe) } : camera;

  // The additive layer goes on LAST — after collision AND the floor guard, which is why it must stay bounded
  // (MOTION_CAP 0.15, inside the guard's 0.3 margin and well inside the collision sphere). A detached fly
  // eye and a running bench are never touched: one is dragged by hand, the other owns the frame outright.
  return attached ? applyMotion(guarded, motion, forward) : guarded;
}

/** Mouse look: raw pixel deltas → damped yaw/pitch, clamped per mode. Manual look always wins (036's rule). */
function applyLook(state: CameraRigState, snapshot: CameraSnapshot, config: CameraConfig): void {
  const look = releaseLook(state.look, snapshot.look.x, snapshot.look.y, config.inputSmoothTime, snapshot.dt);
  if (snapshot.look.x !== 0 || snapshot.look.y !== 0) {
    // The player took the camera back: the steered swing stops and the idle clock restarts.
    state.yawTarget = null;
    cancelAutoCenter(state.autoCenter);
  }
  state.yaw -= look.x * config.sensitivity;
  // The viewer may look straight DOWN (that is its resting view), so it gets the full range the screen basis
  // allows — not the gameplay camera's floor.
  const floor = snapshot.mode === 'fly' ? TOP_DOWN_PITCH : config.pitchMin;
  state.pitch = clamp(state.pitch - look.y * config.sensitivity, floor, config.pitchMax);
}

/**
 * Shift the resolved camera by the motion layer's offset (plan 06).
 *
 * Lateral rides the camera's own right vector (a bob has to sway across the view, not along a world axis);
 * vertical rides world up. Eye and look point take the SAME lateral and (bar the dip) the same vertical, so
 * the frame translates instead of the aim wandering.
 */
function applyMotion(
  camera: CameraState,
  motion: MotionOffset,
  forward: readonly [number, number, number],
): CameraState {
  if (motion.lateral === 0 && motion.vertical === 0 && motion.verticalTarget === 0) {
    return camera;
  }
  const { right } = screenBasis(forward);
  const dx = right[0] * motion.lateral;
  const dz = right[2] * motion.lateral;

  return {
    ...camera,
    eye: [camera.eye[0] + dx, camera.eye[1] + motion.vertical, camera.eye[2] + dz],
    target: [camera.target[0] + dx, camera.target[1] + motion.verticalTarget, camera.target[2] + dz],
  };
}

/** Wheel: dolly the free eye along the view, or move the follow zoom inside its config bounds. */
function applyZoom(
  state: CameraRigState,
  snapshot: CameraSnapshot,
  config: CameraConfig,
  forward: readonly [number, number, number],
): void {
  const notches = Math.trunc(snapshot.zoomSteps);
  if (notches === 0) {
    return;
  }
  const direction = Math.sign(notches);
  for (let step = 0; step < Math.abs(notches); step += 1) {
    if (state.flyEye) {
      state.flyEye = dollyStep(state.flyEye, forward, direction);
    } else if (config.followZoom) {
      // Wheel zoom is a config toggle (debug → Camera), like prod. It writes the TARGET; the live distance
      // damps toward it, so a spun wheel glides instead of stepping.
      state.distanceTarget = clamp(
        state.distanceTarget * (direction > 0 ? 1.08 : 0.93),
        config.followZoomMin,
        config.followZoomMax,
      );
    }
  }
}

/**
 * The framed object's planar velocity, in units/s — SMOOTHED, not the raw per-frame delta.
 *
 * The raw delta is a saw: physics moves the focus on a 1/60 step, but this runs every render frame, so at
 * 120 Hz every other frame sees zero movement. Feeding that saw to look-ahead makes the offset stutter
 * toward 0 and back. A short exponential smoothing recovers the true speed (the saw's average) without adding
 * meaningful lag — this is a MEASUREMENT filter, not a feel channel.
 */
function focusVelocity(
  state: CameraRigState,
  snapshot: CameraSnapshot,
  config: CameraConfig,
): { x: number; z: number } {
  const [x, , z] = snapshot.focus;
  const previous = state.lastFocus;
  state.lastFocus = [x, snapshot.focus[1], z];
  if (previous === null || snapshot.dt <= 0) {
    return { x: state.velX, z: state.velZ };
  }
  // A teleport (respawn, debugger warp, vehicle entry) is not a velocity — the same jump the follow point
  // snaps on must not read as a sprint to the auto-center and look-ahead channels.
  if (Math.hypot(x - previous[0], z - previous[2]) <= config.teleportSnapDistance) {
    const instantX = (x - previous[0]) / snapshot.dt;
    const instantZ = (z - previous[2]) / snapshot.dt;
    state.velX = damp(state.velX, instantX, VELOCITY_LAMBDA, snapshot.dt);
    state.velZ = damp(state.velZ, instantZ, VELOCITY_LAMBDA, snapshot.dt);
  }

  return { x: state.velX, z: state.velZ };
}

/** The steered-yaw channel: swing toward a yaw the player did not ask for, then hand the camera back. */
function steerYawChannel(state: CameraRigState, config: CameraConfig, dt: number): void {
  if (state.yawTarget === null) {
    state.yawVelocity.velocity = 0;
    state.yawLagOverride = null;

    return;
  }
  const lagTime = state.yawLagOverride ?? config.yawLagTime;
  if (lagTime <= 0) {
    state.yaw = state.yawTarget;
    state.yawTarget = null;
    state.yawLagOverride = null;

    return;
  }
  state.yaw = smoothDampAngle(state.yaw, state.yawTarget, state.yawVelocity, lagTime, Number.POSITIVE_INFINITY, dt);
  if (Math.abs(angleDelta(state.yaw, state.yawTarget)) < 1e-3) {
    state.yaw = state.yawTarget;
    state.yawTarget = null;
    state.yawLagOverride = null;
  }
}

/**
 * The plan-09 distance writers, stepped every frame: the on-foot gait breathing (§2) and the vehicle launch
 * stretch (§3). Both return OFFSETS onto the mode's distance target — the smoothing stays with the one zoom
 * damp, so nothing here adds a second easing channel to reconcile.
 */
function stepDistanceOffsets(
  state: CameraRigState,
  snapshot: CameraSnapshot,
  config: CameraConfig,
  planarSpeed: number,
): { foot: number; vehicle: number } {
  const dt = snapshot.dt;
  // §2 idle ease: FULL stillness only — movement, look or zoom all reset the clock (unlike
  // `autoCenter.idleFor`, which deliberately counts hands and ignores feet).
  const still =
    snapshot.mode === 'foot' &&
    planarSpeed < config.moveThreshold &&
    snapshot.look.x === 0 &&
    snapshot.look.y === 0 &&
    snapshot.zoomSteps === 0;
  state.footStillFor = still ? state.footStillFor + dt : 0;
  const idleTarget = state.footStillFor > config.footIdleDelaySec ? config.footIdleDistanceEase : 0;
  // Creep IN slowly; return through the ordinary zoom pace the moment anything wakes the player up.
  state.footIdleEase = damp(
    state.footIdleEase,
    idleTarget,
    idleTarget > state.footIdleEase ? IDLE_EASE_LAMBDA : config.zoomLambda,
    dt,
  );
  // §3 launch stretch: the accel is DERIVED from the signed speed the snapshot already carries (no new
  // physics tap) and low-passed, so a gear blip is a ripple and a launch is a stretch. Positive only —
  // braking already glides the camera in through the speed curve, and reverse never stretches.
  if (snapshot.vehicle && dt > 0) {
    const raw = state.lastVehicleSpeed === null ? 0 : (snapshot.vehicle.speed - state.lastVehicleSpeed) / dt;
    state.lastVehicleSpeed = snapshot.vehicle.speed;
    state.vehicleAccel = damp(state.vehicleAccel, clamp(raw / ACCEL_FULL_MS2, 0, ACCEL_MAX_FACTOR), ACCEL_LAMBDA, dt);
  } else {
    state.lastVehicleSpeed = null;
    state.vehicleAccel = damp(state.vehicleAccel, 0, ACCEL_LAMBDA, dt);
  }
  const run =
    snapshot.mode === 'foot'
      ? config.footRunDistanceGain * smoothstep(FOOT_WALK_SPEED, config.footRunFullSpeed, planarSpeed)
      : 0;

  return { foot: run - state.footIdleEase, vehicle: config.vehicleAccelDistanceGain * state.vehicleAccel };
}

/** Free-fly: arrow walk, then the drag pan (both in the eye's own screen plane). */
function stepFlyRig(state: CameraRigState, snapshot: CameraSnapshot, forward: readonly [number, number, number]): void {
  if (!state.flyEye) {
    return;
  }
  state.flyEye = flyStep(state.flyEye, snapshot.walkKeys, forward, state.yaw, FLY_SPEED * snapshot.dt);
  if (snapshot.pan) {
    // Pan by the eye's HEIGHT so the gesture covers the same apparent distance at any altitude.
    state.flyEye = panStep(state.flyEye, forward, [snapshot.pan.x, snapshot.pan.y], Math.max(1, state.flyEye[1]));
  }
}

/**
 * Look-behind (plan 080/05 §6): while the key is HELD in a car, the yaw target is the car's FRONT — the
 * camera sits ahead of it, looking back over it — through `lookBehindLagTime`, a deliberately quicker
 * swing than the composition channels (a mirror check is a glance). Re-asserted every frame, so the mouse
 * cannot wrestle the hold; the falling edge fires the swing back BEHIND explicitly, because a standing car
 * has no auto-center chase to bring the camera home on its own.
 */
function stepLookBehind(state: CameraRigState, snapshot: CameraSnapshot, config: CameraConfig): void {
  const wants = snapshot.lookBehind && snapshot.mode === 'vehicle';
  if (wants) {
    // The camera looks along (sin yaw, −cos yaw) and a heading h points along (−sin h, cos h): yaw = h
    // looks OPPOSITE the car's facing — the look-behind frame (yawBehind(h) = h + π is the normal one).
    state.yawTarget = snapshot.focusHeading;
    state.yawLagOverride = config.lookBehindLagTime;
  } else if (state.lookingBehind) {
    state.yawTarget = yawBehind(snapshot.focusHeading);
    state.yawLagOverride = config.lookBehindLagTime;
  }
  state.lookingBehind = wants;
}
