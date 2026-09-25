/** Aircraft replay cameras. The exterior camera keeps a target/eye history and smoothed yaw/pitch,
 * based on the plane branch described by SACarCam. The front-seat and canopy cameras are separate. */
import type { Vec3 } from './math';

export type CameraMode = 'chase-near' | 'chase-mid' | 'chase-far' | 'first-person' | 'cockpit';

export interface CameraStateOut {
  aspect: number;
  eye: Vec3;
  far: number;
  fovYRad: number;
  near: number;
  target: Vec3;
  up: Vec3;
}

export interface CameraFrame {
  aspect: number;
  /** Aspect of the GTA display whose camera projection is being reproduced. */
  gameAspect?: number;
  cockpitPosition?: Vec3;
  dt: number;
  forward: Vec3;
  /** GTA's ped_frontseat dummy transformed into engine space. */
  firstPersonPosition?: Vec3;
  model: number;
  modelLength: number;
  modelTop: number;
  position: Vec3;
  snap: boolean;
  up: Vec3;
  velocity: Vec3;
}

const WORLD_UP: Vec3 = [0, 1, 0];
// GTASA.WidescreenFix (DontTouchFOV=0) expands SA's 4:3 horizontal FOV to the
// game display aspect. The CCam trace still says 70 degrees before this fix.
// Use the display's corrected horizontal angle when projecting onto the browser
// viewport, whose height may differ from the full-screen game recording.
export function saChaseFovY(viewAspect: number, gameAspect = 16 / 9): number {
  const halfHorizontalTan = Math.tan((70 * Math.PI) / 360) * Math.max(0.1, gameAspect) / (4 / 3);
  return 2 * Math.atan(halfHorizontalTan / Math.max(0.1, viewAspect));
}
// SA's plane entries in the vehicle camera zoom/alpha tables, recovered by the SACarCam port.
const PLANE_ZOOM: Record<'chase-near' | 'chase-mid' | 'chase-far', { alpha: number; zoom: number }> = {
  'chase-near': { alpha: 0.08, zoom: 0.05 },
  'chase-mid': { alpha: 0.08, zoom: 1.9 },
  'chase-far': { alpha: 0.06, zoom: 15.9 },
};
const COCKPIT_AHEAD = 0.6;
const COCKPIT_UP = 0.3;
// The 2026-09-25 Hydra camera trace gives a target 0.84104 m above the aircraft and a
// collision-box-based length of 14.3182 m. The visual mesh bounds are different.
const HYDRA_TARGET_UP = 0.84104;
const HYDRA_CAMERA_LENGTH = 14.3182;
// Plane values from SACarCam's reconstruction of SA's FollowCar camera. GTA time step is 50 Hz.
const PLANE = { heightScale: 1.1, heightInset: 0.2, baseOffset: 3.5, minHistoryDistance: 25,
  yawVelocityGain: 0.005, yawStepLimit: 0.2, yawResponse: 0.75, yawSpeedLimit: 0.1,
  pitchResponse: 0.5, pitchStepLimit: 1, pitchLimit: 1.5533431 };

function spring(position: Vec3, velocity: Vec3, goal: Vec3, smoothTime: number, dt: number): void {
  const omega = 2 / Math.max(0.001, smoothTime);
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change: Vec3 = [position[0] - goal[0], position[1] - goal[1], position[2] - goal[2]];
  const temp: Vec3 = [
    (velocity[0] + change[0] * omega) * dt,
    (velocity[1] + change[1] * omega) * dt,
    (velocity[2] + change[2] * omega) * dt,
  ];
  velocity[0] = (velocity[0] - temp[0] * omega) * decay;
  velocity[1] = (velocity[1] - temp[1] * omega) * decay;
  velocity[2] = (velocity[2] - temp[2] * omega) * decay;
  change[0] = (change[0] + temp[0]) * decay;
  change[1] = (change[1] + temp[1]) * decay;
  change[2] = (change[2] + temp[2]) * decay;
  position[0] = goal[0] + change[0];
  position[1] = goal[1] + change[1];
  position[2] = goal[2] + change[2];
}

function angleDifference(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export class ReplayCamera {
  mode: CameraMode = 'chase-mid';

  reset(): void {
    this.pose = null;
    this.beta = null;
    this.alpha = 0;
    this.betaSpeed = 0;
    this.historyEye = null;
    this.distance = null;
  }

  state(frame: CameraFrame): CameraStateOut {
    const { position, forward, up, aspect, dt, snap } = frame;
    if (this.mode === 'first-person') {
      const eye: Vec3 = frame.firstPersonPosition ?? [
        position[0] + forward[0] + up[0],
        position[1] + forward[1] + up[1],
        position[2] + forward[2] + up[2],
      ];
      return {
        aspect, eye, far: 12000, fovYRad: (60 * Math.PI) / 180, near: 0.2,
        target: [eye[0] + forward[0] * 85, eye[1] + forward[1] * 85, eye[2] + forward[2] * 85],
        up,
      };
    }

    if (this.mode === 'cockpit') {
      const base = frame.cockpitPosition ?? position;
      const desiredPosition: Vec3 = [
        base[0] + forward[0] * COCKPIT_AHEAD + up[0] * COCKPIT_UP,
        base[1] + forward[1] * COCKPIT_AHEAD + up[1] * COCKPIT_UP,
        base[2] + forward[2] * COCKPIT_AHEAD + up[2] * COCKPIT_UP,
      ];
      const desiredTarget: Vec3 = [
        desiredPosition[0] + forward[0] * 85,
        desiredPosition[1] + forward[1] * 85,
        desiredPosition[2] + forward[2] * 85,
      ];
      const desiredPositionOffset: Vec3 = [desiredPosition[0] - base[0], desiredPosition[1] - base[1], desiredPosition[2] - base[2]];
      const desiredTargetOffset: Vec3 = [desiredTarget[0] - base[0], desiredTarget[1] - base[1], desiredTarget[2] - base[2]];
      if (snap || !this.pose) {
        this.pose = { positionOffset: desiredPositionOffset, positionVelocity: [0, 0, 0], targetOffset: desiredTargetOffset, targetVelocity: [0, 0, 0] };
      } else {
        spring(this.pose.positionOffset, this.pose.positionVelocity, desiredPositionOffset, 0.018, dt);
        spring(this.pose.targetOffset, this.pose.targetVelocity, desiredTargetOffset, 0.018, dt);
      }
      return {
        aspect,
        eye: [base[0] + this.pose.positionOffset[0], base[1] + this.pose.positionOffset[1], base[2] + this.pose.positionOffset[2]],
        far: 12000,
        fovYRad: (68 * Math.PI) / 180,
        near: 0.5,
        target: [base[0] + this.pose.targetOffset[0], base[1] + this.pose.targetOffset[1], base[2] + this.pose.targetOffset[2]],
        up,
      };
    }

    const zoom = PLANE_ZOOM[this.mode];
    const targetUp = frame.model === 520 ? HYDRA_TARGET_UP
      : Math.max(0, frame.modelTop * PLANE.heightScale - PLANE.heightInset);
    const cameraLength = frame.model === 520 ? HYDRA_CAMERA_LENGTH : frame.modelLength;
    const desiredDistance = Math.max(3.5, cameraLength + PLANE.baseOffset + zoom.zoom + targetUp);
    const alphaOffset = zoom.alpha + 0.3 * targetUp / desiredDistance;
    this.distance = snap || this.distance === null
      ? desiredDistance
      : this.distance + (desiredDistance - this.distance) * (1 - Math.exp(-dt / 0.25));
    const target: Vec3 = [position[0], position[1] + targetUp, position[2]];
    const planarSpeed = Math.hypot(frame.velocity[0], frame.velocity[2]);
    if (snap || this.beta === null || this.historyEye === null) {
      // A seek has no preceding camera state. Start behind the direction of travel when it is known.
      const initialDirection = planarSpeed > 0.02 ? frame.velocity : forward;
      this.beta = Math.atan2(initialDirection[0], initialDirection[2]);
      const speed = Math.hypot(...frame.velocity);
      const pathPitch = speed > 0.05 ? Math.atan2(frame.velocity[1], planarSpeed) : 0;
      this.alpha = clamp(pathPitch * 0.65 - alphaOffset, -PLANE.pitchLimit, PLANE.pitchLimit);
      this.betaSpeed = 0;
      const initialAim = directionFromAngles(this.beta, this.alpha + alphaOffset);
      this.historyEye = subtractScaled(target, initialAim, Math.max(this.distance, PLANE.minHistoryDistance));
    }
    const step = Math.min(5, Math.max(0, dt * 50));
    // Keep a previous predicted eye. As the plane climbs away, the target rises in that eye's view;
    // the elevation accumulates naturally instead of using a hard-coded height interval.
    const towardTarget = normalized([
      target[0] - this.historyEye[0], target[1] - this.historyEye[1], target[2] - this.historyEye[2],
    ]);
    const currentYaw = Math.atan2(towardTarget[0], towardTarget[2]);
    const velocityYaw = planarSpeed > 0.02 ? Math.atan2(frame.velocity[0], frame.velocity[2]) : currentYaw;
    const along = dot(frame.velocity, towardTarget);
    const sideSpeed = Math.hypot(
      frame.velocity[0] - along * towardTarget[0],
      frame.velocity[1] - along * towardTarget[1],
      frame.velocity[2] - along * towardTarget[2],
    );
    const velocityTurn = clamp(angleDifference(currentYaw, velocityYaw)
      * Math.min(1, PLANE.yawVelocityGain * step * sideSpeed),
    -PLANE.yawStepLimit * step, PLANE.yawStepLimit * step);
    const desiredBeta = currentYaw + velocityTurn;
    const wantedBetaSpeed = clamp(angleDifference(this.beta, desiredBeta) / Math.max(1, step),
      -PLANE.yawSpeedLimit, PLANE.yawSpeedLimit);
    this.betaSpeed = this.betaSpeed * Math.pow(PLANE.yawResponse, step)
      + wantedBetaSpeed * (1 - Math.pow(PLANE.yawResponse, step));
    this.beta += step * this.betaSpeed;
    const desiredAlpha = clamp(Math.asin(clamp(towardTarget[1], -1, 1)) - alphaOffset,
      -PLANE.pitchLimit, PLANE.pitchLimit);
    this.alpha += clamp((desiredAlpha - this.alpha) * (1 - Math.pow(PLANE.pitchResponse, step)),
      -PLANE.pitchStepLimit * step, PLANE.pitchStepLimit * step);
    this.alpha = clamp(this.alpha, -PLANE.pitchLimit, PLANE.pitchLimit);
    const eye = subtractScaled(target, directionFromAngles(this.beta, this.alpha), this.distance);
    this.historyEye = subtractScaled(target, directionFromAngles(this.beta, desiredAlpha + alphaOffset),
      Math.max(this.distance, PLANE.minHistoryDistance));
    return { aspect, eye, far: 12000, fovYRad: saChaseFovY(aspect, frame.gameAspect), near: 0.5, target, up: WORLD_UP };
  }

  private pose: null | {
    positionOffset: Vec3;
    positionVelocity: Vec3;
    targetOffset: Vec3;
    targetVelocity: Vec3;
  } = null;
  private beta: number | null = null;
  private alpha = 0;
  private betaSpeed = 0;
  private historyEye: Vec3 | null = null;
  private distance: number | null = null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function normalized(value: Vec3): Vec3 {
  const length = Math.hypot(...value);
  return length > 0.00001 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 1];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function directionFromAngles(beta: number, alpha: number): Vec3 {
  return [Math.sin(beta) * Math.cos(alpha), Math.sin(alpha), Math.cos(beta) * Math.cos(alpha)];
}

function subtractScaled(origin: Vec3, direction: Vec3, distance: number): Vec3 {
  return [origin[0] - direction[0] * distance, origin[1] - direction[1] * distance,
    origin[2] - direction[2] * distance];
}

export function horizontalFovToVertical(degrees: number, aspect: number): number {
  return 2 * Math.atan(Math.tan((degrees * Math.PI) / 360) / Math.max(0.1, aspect));
}
