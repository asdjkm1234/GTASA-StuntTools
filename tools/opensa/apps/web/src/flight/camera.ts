/** Aircraft replay cameras. The three exterior distances use SA's plane zoom values and follow the
 * horizontal travel direction, with an orbiting yaw so reversing flight never pulls the eye through the
 * aircraft. The original first-person view uses the model's front-seat dummy; the existing canopy camera
 * remains a separate mode. */
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
  cockpitPosition?: Vec3;
  dt: number;
  forward: Vec3;
  /** GTA's ped_frontseat dummy transformed into engine space. */
  firstPersonPosition?: Vec3;
  modelLength: number;
  modelTop: number;
  position: Vec3;
  snap: boolean;
  up: Vec3;
  velocity: Vec3;
  /** Current aircraft height minus its height a short time ago, in engine units. */
  heightTrail?: number;
}

const WORLD_UP: Vec3 = [0, 1, 0];
// SA's plane entries in the vehicle camera zoom/alpha tables, recovered by the SACarCam port.
const PLANE_ZOOM: Record<'chase-near' | 'chase-mid' | 'chase-far', { alpha: number; zoom: number }> = {
  'chase-near': { alpha: 0.08, zoom: 0.05 },
  'chase-mid': { alpha: 0.08, zoom: 1.9 },
  'chase-far': { alpha: 0.06, zoom: 15.9 },
};
const COCKPIT_AHEAD = 0.6;
const COCKPIT_UP = 0.3;
const MAX_CHASE_PITCH = (55 * Math.PI) / 180;

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
    this.yaw = null;
    this.distance = null;
    this.followingVelocity = false;
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

    const planarSpeed = Math.hypot(frame.velocity[0], frame.velocity[2]);
    if (planarSpeed > 0.12) this.followingVelocity = true;
    else if (planarSpeed < 0.06) this.followingVelocity = false;
    const planarForward = Math.hypot(forward[0], forward[2]);
    const direction = this.followingVelocity && planarSpeed > 0.06
      ? frame.velocity
      : planarForward > 0.05 ? forward : [Math.sin(this.yaw ?? 0), 0, Math.cos(this.yaw ?? 0)];
    const desiredYaw = Math.atan2(direction[0], direction[2]);
    if (snap || this.yaw === null) {
      this.yaw = desiredYaw;
    } else {
      // Preserve the orbit radius while the camera swings around a reversing plane.
      const turn = angleDifference(this.yaw, desiredYaw) * (1 - Math.exp(-dt / 0.65));
      const maxTurn = Math.PI * dt;
      this.yaw += Math.max(-maxTurn, Math.min(maxTurn, turn));
    }
    const zoom = PLANE_ZOOM[this.mode];
    const targetUp = Math.max(0.5, Math.min(8, frame.modelTop * 1.1 - 0.2));
    const desiredDistance = Math.max(12, frame.modelLength + 3.5 + zoom.zoom + targetUp);
    this.distance = snap || this.distance === null
      ? desiredDistance
      : this.distance + (desiredDistance - this.distance) * (1 - Math.exp(-dt / 0.25));
    const target: Vec3 = [position[0], position[1] + targetUp, position[2]];
    // SA's plane alpha is an offset to a moving camera angle, not a fixed pitch. A short target-height
    // history leaves the eye below a climbing plane (or above a diving one) even after a timeline seek.
    const heightTrail = Math.max(-this.distance * 2, Math.min(this.distance * 2, frame.heightTrail ?? 0));
    const pitch = Math.max(-MAX_CHASE_PITCH, Math.min(MAX_CHASE_PITCH,
      Math.atan2(heightTrail - Math.tan(zoom.alpha) * this.distance, this.distance)));
    const eye: Vec3 = [
      target[0] - Math.sin(this.yaw) * this.distance,
      target[1] - Math.tan(pitch) * this.distance,
      target[2] - Math.cos(this.yaw) * this.distance,
    ];
    return { aspect, eye, far: 12000, fovYRad: (70 * Math.PI) / 180, near: 0.5, target, up: WORLD_UP };
  }

  private pose: null | {
    positionOffset: Vec3;
    positionVelocity: Vec3;
    targetOffset: Vec3;
    targetVelocity: Vec3;
  } = null;
  private yaw: number | null = null;
  private distance: number | null = null;
  private followingVelocity = false;
}
