/**
 * The replay camera (GTA-style delayed chase and cockpit). Position, look target, heading and pitch are
 * damped SEPARATELY against the aircraft's own frame, so a sudden bank or roll is followed a beat late
 * instead of snapping the view around the fuselage. Play, pause and timeline scrubbing all call the SAME
 * `update`, with `snap` forcing an immediate settle on scrub/reset — that is what keeps the aircraft the
 * same apparent distance whether it is flying or being dragged.
 */
import type { Vec3 } from './math';

export type CameraMode = 'chase' | 'cockpit';

export interface CameraStateOut {
  aspect: number;
  eye: Vec3;
  far: number;
  fovYRad: number;
  near: number;
  target: Vec3;
  up: Vec3;
}

const WORLD_UP: Vec3 = [0, 1, 0];
const CHASE_BACK = 16.2;
const CHASE_UP = 4.8;
const CHASE_TARGET_AHEAD = 4;
const CHASE_TARGET_UP = 1.1;
// Offsets are relative to the COCKPIT ANCHOR (the aircraft's canopy part), not the model origin.
const COCKPIT_AHEAD = 0.6;
const COCKPIT_UP = 0.3;

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

export class ReplayCamera {
  mode: CameraMode = 'chase';
  reset(): void {
    this.pose = null;
  }

  state(dt: number, position: Vec3, forward: Vec3, up: Vec3, aspect: number, speed: number, snap: boolean): CameraStateOut {
    // Speed pull-back is deliberately small: a big change is what made playback and scrubbing disagree.
    const pullBack = Math.min(6, Math.max(0, speed * 0.02));
    let desiredPosition: Vec3;
    let desiredTarget: Vec3;
    let cameraUp: Vec3;
    let positionSmooth: number;
    let targetSmooth: number;

    if (this.mode === 'cockpit') {
      desiredPosition = [
        position[0] + forward[0] * COCKPIT_AHEAD + up[0] * COCKPIT_UP,
        position[1] + forward[1] * COCKPIT_AHEAD + up[1] * COCKPIT_UP,
        position[2] + forward[2] * COCKPIT_AHEAD + up[2] * COCKPIT_UP,
      ];
      desiredTarget = [
        desiredPosition[0] + forward[0] * 85,
        desiredPosition[1] + forward[1] * 85,
        desiredPosition[2] + forward[2] * 85,
      ];
      positionSmooth = 0.018;
      targetSmooth = 0.018;
      cameraUp = up;
    } else {
      // GTA's vehicle chase frames the car with the WORLD's vertical, so a roll does not spin the camera.
      desiredTarget = [
        position[0] + forward[0] * CHASE_TARGET_AHEAD + WORLD_UP[0] * CHASE_TARGET_UP,
        position[1] + forward[1] * CHASE_TARGET_AHEAD + WORLD_UP[1] * CHASE_TARGET_UP,
        position[2] + forward[2] * CHASE_TARGET_AHEAD + WORLD_UP[2] * CHASE_TARGET_UP,
      ];
      // Camera sits BEHIND the nose and ABOVE the aircraft: subtract along forward, ADD along world up.
      // (Subtracting the up term put the camera under the belly and every chase view became an upward look.)
      desiredPosition = [
        desiredTarget[0] - forward[0] * (CHASE_BACK + pullBack) + WORLD_UP[0] * CHASE_UP,
        desiredTarget[1] - forward[1] * (CHASE_BACK + pullBack) + WORLD_UP[1] * CHASE_UP,
        desiredTarget[2] - forward[2] * (CHASE_BACK + pullBack) + WORLD_UP[2] * CHASE_UP,
      ];
      positionSmooth = 0.45;
      targetSmooth = 0.16;
      cameraUp = WORLD_UP;
    }

    const desiredPositionOffset: Vec3 = [desiredPosition[0] - position[0], desiredPosition[1] - position[1], desiredPosition[2] - position[2]];
    const desiredTargetOffset: Vec3 = [desiredTarget[0] - position[0], desiredTarget[1] - position[1], desiredTarget[2] - position[2]];
    if (snap || !this.pose) {
      this.pose = {
        positionOffset: desiredPositionOffset,
        positionVelocity: [0, 0, 0],
        targetOffset: desiredTargetOffset,
        targetVelocity: [0, 0, 0],
      };
    } else {
      spring(this.pose.positionOffset, this.pose.positionVelocity, desiredPositionOffset, positionSmooth, dt);
      spring(this.pose.targetOffset, this.pose.targetVelocity, desiredTargetOffset, targetSmooth, dt);
    }
    const eye: Vec3 = [position[0] + this.pose.positionOffset[0], position[1] + this.pose.positionOffset[1], position[2] + this.pose.positionOffset[2]];
    const look: Vec3 = [position[0] + this.pose.targetOffset[0], position[1] + this.pose.targetOffset[1], position[2] + this.pose.targetOffset[2]];

    return {
      aspect,
      eye,
      far: 12000,
      // First person needs a slightly wider vertical FOV so the nose does not fill the frame.
      fovYRad: this.mode === 'cockpit' ? (68 * Math.PI) / 180 : (70 * Math.PI) / 180,
      near: 0.5,
      target: look,
      up: cameraUp,
    };
  }

  private pose: null | {
    positionOffset: Vec3;
    positionVelocity: Vec3;
    targetOffset: Vec3;
    targetVelocity: Vec3;
  } = null;
}
