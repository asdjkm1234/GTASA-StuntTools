import type { TouchInputSource } from '@opensa/game/input';

/** The slice of the host's per-frame camera input {@link foldTouchCamera} writes into. */
export interface PendingCameraInput {
  look: { x: number; y: number };
  zoom: number;
}

/** Pinch travel worth one wheel notch, in the units `TouchInputSource.addZoom` accumulates (`PINCH_ZOOM_GAIN`
 *  = 0.5 per pixel of finger spread) — so ~80 px of spread is one notch. A feel value, like the look gain. */
const PINCH_UNITS_PER_NOTCH = 40;

/**
 * Fold the look joystick and the pinch into this frame's camera input (plan 055). The camera is host-owned in
 * the engine host — the director steps over `pendingInput`, filled by the host's own DOM handlers, and never
 * reads an `InputState` — so without this the touch source's look and zoom reach nothing: the player would
 * walk, jump and get into cars while the view stayed put (`docs/restrictions/architecture.md`).
 *
 * Returns the pinch travel left over. The director counts WHOLE notches, so a remainder dropped every frame
 * would leave a slow spread zooming nothing at all.
 */
export function foldTouchCamera(
  source: null | TouchInputSource,
  pending: PendingCameraInput,
  residual: number,
): number {
  if (!source) {
    return residual;
  }
  // A rate, not a delta — the joystick HOLDS its deflection, so this is read every frame it is pressed.
  const look = source.consumeLook();
  pending.look.x += look.x;
  pending.look.y += look.y;
  const travel = residual + source.consumeZoom();
  const notches = Math.trunc(travel / PINCH_UNITS_PER_NOTCH);
  pending.zoom += notches;

  return travel - notches * PINCH_UNITS_PER_NOTCH;
}
