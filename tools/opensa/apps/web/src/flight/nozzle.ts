/**
 * Hydra nozzle control, used to orient the stock model's jet plume.
 *
 * The stock Hydra DFF has no static_prop or moving_prop meshes. Modded Hydras may author those frames;
 * the recorder captures their local quaternions in ePlaneNodes slots 12..15 when present.
 *
 * `nozzleRotation` is `CAutomobile::m_wMiscComponentAngle` (`CAutomobile+0x86C`, SA 1.0 US), the HARRIER nozzle
 * control: 0..`HARRIER_NOZZLE_ROTATE_LIMIT` (5000). It is a raw control value rather than an angle. The
 * stock model has no movable nozzle mesh, so `deriveNozzleAngle` provides a documented approximate sweep
 * for the original jetthrust plume. Recorded part quaternions take priority for modded Hydra meshes.
 */
import type { Quat } from './math';

/** `HARRIER_NOZZLE_ROTATE_LIMIT` (SA 1.0 US `0x8D33C4`) — the raw control value's ceiling. */
export const NOZZLE_ROTATE_LIMIT = 5000;

/** `ePlaneNodes` 12..15: the static/moving prop frames on each side, in recorder `propNodes` order. */
export const PROP_NODE_NAMES = ['static_prop', 'moving_prop', 'static_prop2', 'moving_prop2'] as const;

/**
 * Approximate sweep span for the jet plume and for a modded Hydra without recorded prop quaternions.
 */
const INFERRED_NOZZLE_SWEEP = Math.PI / 2;

/** Whether a raw `nozzleRotation` is usable (present and finite). */
export function hasNozzleRotation(rotation: null | number | undefined): rotation is number {
  return typeof rotation === 'number' && Number.isFinite(rotation);
}

/**
 * Approximate local-X sweep from the raw 0..5000 control value. Clamped; absent values mean forward.
 */
export function deriveNozzleAngle(rotation: null | number): number {
  if (!hasNozzleRotation(rotation)) {
    return 0;
  }
  const progress = Math.min(1, Math.max(0, rotation / NOZZLE_ROTATE_LIMIT));

  return progress * INFERRED_NOZZLE_SWEEP;
}

/** A quaternion about the local X axis — the inferred nozzle pivot axis. */
export function axisAngleX(angle: number): Quat {
  const half = angle / 2;

  return [Math.sin(half), 0, 0, Math.cos(half)];
}
