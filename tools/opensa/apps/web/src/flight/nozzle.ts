/**
 * Hydra nozzle control, used to rotate the stock nozzle assemblies and orient the jet plume.
 *
 * Stock Hydra uses wheel_lm_dummy / wheel_rm_dummy (ePlaneNodes 6 / 3) for its nozzle assemblies,
 * not the propeller slots 12..15. CPlane::PreRender (SA 1.0 US 0x6C9F26..0x6C9F71) sets both
 * frames' absolute local-X rotation to rotation * (PI/2) / 5000 via SetComponentRotation.
 *
 * `nozzleRotation` is `CAutomobile::m_wMiscComponentAngle` (`CAutomobile+0x86C`, SA 1.0 US), the HARRIER nozzle
 * control: 0..`HARRIER_NOZZLE_ROTATE_LIMIT` (5000). Recorded part quaternions still take priority
 * for modded Hydra prop meshes. The sprite plume remains an approximate visual effect.
 */
import type { Quat } from './math';

/** `HARRIER_NOZZLE_ROTATE_LIMIT` (SA 1.0 US `0x8D33C4`) — the raw control value's ceiling. */
export const NOZZLE_ROTATE_LIMIT = 5000;

/** `ePlaneNodes` 12..15: the static/moving prop frames on each side, in recorder `propNodes` order. */
export const PROP_NODE_NAMES = ['static_prop', 'moving_prop', 'static_prop2', 'moving_prop2'] as const;

/** Stock Hydra's front/rear nozzle assemblies, despite their misleading wheel names. */
export const HYDRA_NOZZLE_NODE_NAMES = ['wheel_lm_dummy', 'wheel_rm_dummy'] as const;

/**
 * Sweep span read from SA 1.0 US's PreRender multiplier at 0x858FE4.
 */
const NOZZLE_SWEEP = Math.PI / 2;

/** A quaternion about the local X axis. */
export function axisAngleX(angle: number): Quat {
  const half = angle / 2;

  return [Math.sin(half), 0, 0, Math.cos(half)];
}

/**
 * Game local-X sweep from the raw 0..5000 control value. Clamped; absent values mean bind pose.
 */
export function deriveNozzleAngle(rotation: null | number): number {
  if (!hasNozzleRotation(rotation)) {
    return 0;
  }
  const progress = Math.min(1, Math.max(0, rotation / NOZZLE_ROTATE_LIMIT));

  return progress * NOZZLE_SWEEP;
}

/** Whether a raw `nozzleRotation` is usable (present and finite). */
export function hasNozzleRotation(rotation: null | number | undefined): rotation is number {
  return typeof rotation === 'number' && Number.isFinite(rotation);
}
