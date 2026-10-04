/**
 * The vehicle camera (plan 080/05, behaviours #5 and #10).
 *
 * The rig is NOT forked. Driving retunes the shared channels through {@link vehicleTuning} — one rig, two
 * tuning tables — and adds two writers of its own: the speed curves (distance + FOV) and the drift lean.
 * That is what keeps a transition cheap: entering a car blends between two tables, it does not switch code
 * paths. Plan 08's view presets stand on the same rule.
 *
 * Everything here is pure and frame-rate independent; the damping lives in the director.
 */
import type { CameraConfig } from '@opensa/game';

import { smoothstep } from '@opensa/math';

import { CAMERA_FOV_Y } from './engine-camera';

/**
 * Where the yaw target should point while driving: the car's heading, leaned toward its actual travel
 * direction by `driftLookBlend` of the slip angle.
 *
 * In a slide the camera therefore looks partway ALONG the trajectory instead of squarely at the car's nose,
 * which is what lets the player read where the car is actually going. Straight driving is untouched: a small
 * permanent slip sits inside the dead-band and contributes nothing, and the band fades in (smoothstep) so
 * there is no kink at its edge — a hard edge here would flicker the framing exactly the way 04's rejected
 * all-hit collision gate did.
 */
export function driftHeading(heading: number, slipAngle: number, speed: number, config: CameraConfig): number {
  if (Math.abs(speed) < config.driftMinSpeed || config.driftLookBlend <= 0) {
    return heading;
  }
  const magnitude = Math.abs(slipAngle);
  if (magnitude <= config.driftSlipDeadZone) {
    return heading;
  }
  const relief =
    config.driftSlipDeadZone > 0 ? smoothstep(config.driftSlipDeadZone, config.driftSlipDeadZone * 2, magnitude) : 1;

  // Reversing points the car the other way round its travel; the lean follows the SIGN of the slip either way.
  return heading + slipAngle * relief * config.driftLookBlend;
}

/**
 * The follow distance a car wants at this speed: its size-based distance, opened up toward
 * `vehicleDistanceGain` as it gets quick. The live distance damps toward this through the 02 zoom channel, so
 * hard braking visibly glides the camera back in.
 */
export function vehicleDistanceForSpeed(sizeDistance: number, speed: number, config: CameraConfig): number {
  return sizeDistance + config.vehicleDistanceGain * speedFactor(Math.abs(speed), 0, config.vehicleDistanceSpeed);
}

/** The FOV (radians) the current speed asks for: the base lens, widened toward the top of the speed range. */
export function vehicleFovTarget(speed: number, config: CameraConfig): number {
  return (
    CAMERA_FOV_Y +
    config.vehicleFovKick * speedFactor(Math.abs(speed), config.vehicleFovMinSpeed, config.vehicleFovMaxSpeed)
  );
}

/**
 * The same config with the driving numbers substituted — the second tuning table.
 *
 * A fresh object per step while seated is deliberate: the debugger mutates `config.camera` live (a field
 * round turns sliders), so a cached table would freeze whatever the tab held when the player got in.
 */
export function vehicleTuning(config: CameraConfig): CameraConfig {
  return {
    ...config,
    collisionReleaseTime: config.vehicleCollisionReleaseTime,
    recenterDelaySec: config.vehicleRecenterDelaySec,
    verticalLagTime: config.vehicleVerticalLagTime,
    yawLagTime: config.vehicleYawLagTime,
  };
}

/** How far into a speed band a speed sits, eased at both ends. Below `lo` it is 0, above `hi` it is 1. */
function speedFactor(speed: number, lo: number, hi: number): number {
  return smoothstep(lo, hi, speed);
}
