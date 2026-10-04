/**
 * Seat resolution (plan 005): where the DONOR says a person sits, expressed in cutscene space.
 *
 * A cutscene actor's position is ABSOLUTE — it comes from the scene's own root channel in
 * `anim/cuts.img` — while `ped_frontseat` is read by the GAMEPLAY code only. R* authored every scene
 * against their own car, and measurement says they authored it EXACTLY there: across FINAL2B and
 * SMOKE2B the actors ride at ±the stock donor's `ped_frontseat`, x within 0.02 m and z within 0.03 m
 * (plan 005's census). So a converted donor whose cabin rides higher seats its occupants low — 0.281 m
 * on the glendale — and nothing inside the model can correct it.
 *
 * This module answers only "where would the donor put someone", in the emitted model's space. The
 * `anim/cuts.img` patch that uses it is `seat-patch.ts`.
 */
import type { ClumpModel } from './rig/clump-io';
import type { Transform, Vec3 } from './rig/matrix';

/** A place the donor says a person sits, in CUTSCENE space (root-relative, ground-lifted). */
export interface SeatPoint {
  /** The dummy this came from; a mirrored point keeps the source name. */
  readonly dummy: string;
  /** True when this is the x-mirror rather than the authored dummy. */
  readonly mirrored: boolean;
  readonly position: Vec3;
}

/** The dummies SA cars carry. One per ROW: the opposite side is the x-mirror, which is how the game
 *  derives the driver from the passenger seat — so the row, not the side, is what the model states. */
const SEAT_DUMMIES = /^ped_(?:front|back)seat$/i;

/**
 * How far a measured actor offset may sit from a seat point (metres, x/y only) and still be that seat.
 * The census offset is a MEAN over the scene, and an actor leans and turns: the worst y drift measured
 * across the four seated actors is 0.12 m, against x agreement inside 0.02 m.
 */
const MATCH_TOLERANCE = 0.35;

/**
 * The seat point a measured car-local actor offset belongs to, or null when none is close enough.
 * Matching is x/y ONLY — z is the very thing being corrected, so it may not be evidence.
 */
export function matchSeat(seats: readonly SeatPoint[], offset: Vec3): null | SeatPoint {
  let best: null | SeatPoint = null;
  let bestDistance = MATCH_TOLERANCE;
  for (const seat of seats) {
    const distance = Math.hypot(seat.position[0] - offset[0], seat.position[1] - offset[1]);
    if (distance < bestDistance) {
      [best, bestDistance] = [seat, distance];
    }
  }

  return best;
}

/**
 * Every seat the donor states, in cutscene space: each `ped_*seat` dummy plus its x-mirror. Empty when
 * the donor carries no seat dummy at all — the caller then leaves the scene's own placement alone,
 * which is the whole fallback (a mod that states nothing gets nothing decided for it).
 *
 * `shiftZ` is the conversion's ground lift, the same one the geometry rides; without it a seat read
 * from the donor sits in the donor's space rather than the emitted model's.
 */
export function resolveSeatPoints(
  model: ClumpModel,
  relativeToRoot: (frameIndex: number) => Transform,
  shiftZ: number,
): SeatPoint[] {
  const seats: SeatPoint[] = [];
  model.frames.forEach((frame, index) => {
    if (!SEAT_DUMMIES.test(frame.name.trim())) {
      return;
    }
    const [x, y, z] = relativeToRoot(index).position;
    const dummy = frame.name.trim().toLowerCase();
    seats.push({ dummy, mirrored: false, position: [x, y, z + shiftZ] });
    seats.push({ dummy, mirrored: true, position: [-x, y, z + shiftZ] });
  });

  return seats;
}
