/**
 * The one place the dispatch app converts between the two coordinate systems it has to speak.
 *
 * A mod author reads and writes GTA coordinates — they are what `IPL` rows, `.ide` entries, teleport scripts
 * and every wiki page use — so every number this app SHOWS is GTA. The engine is Y-up with `z = −y`, so every
 * number it FEEDS the engine goes through here. Mixing the two silently mirrors the map about its diagonal,
 * which looks plausible enough on a top-down view to survive a whole session.
 */

/** Engine-space position (x, y-up, z). */
export type EnginePoint = readonly [number, number, number];

/** A ground position as a dispatcher reads it: GTA x (east) and y (north). */
export type GtaGround = readonly [number, number];

/**
 * The ground point `distance` AHEAD of a unit facing `heading` — the FORWARD convention, in one place.
 *
 * Two layers draw the same direction and they may not disagree: the 3D model is turned by
 * {@link gtaRootMatrix}, and the 2D chevron takes its screen angle by projecting a point ahead of the unit
 * (so it stays correct under any camera yaw or tilt without knowing the camera's basis). Written twice,
 * those two are one sign apart from a map whose cars and whose symbols point different ways — plausible
 * separately, absurd together, and nobody would call it a bug in either file. A test pins them to each other.
 */
export function aheadOf(at: GtaGround, heading: number, distance: number): [number, number] {
  return [at[0] + Math.sin(heading) * distance, at[1] + Math.cos(heading) * distance];
}

/** Engine point → the GTA ground point under it (the y-up height is dropped). */
export function engineToGta(point: EnginePoint): [number, number] {
  return [point[0], -point[2]];
}

/** Ground distance between two GTA points, in world units (≈ metres in SA). */
export function gtaDistance(a: GtaGround, b: GtaGround): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Column-major root matrix for a MODEL standing on the map (201/5-04): translate to the engine point under
 * `at` at `elevation`, then rotate about the up axis so the model faces GTA `heading`.
 *
 * **This reproduces the GAME's own placement, and that is the requirement rather than a nicety.** The
 * console draws a unit where the server said it is, and the operator's whole job is done on that agreement,
 * so the translation is verified to be identical to what `engine-vehicle-handle` writes for a real car:
 * `[x, z, −y]` from a GTA position, height verbatim. A map that places the same numbers half a metre off is
 * a map that disagrees with the game a dispatcher is looking at.
 *
 * The rotation is the same matrix as the handle's, restricted to yaw — verified numerically against the
 * handle's quaternion path at every one of 360 z-angles (max difference 4e-16, double-precision noise), and
 * the basis change is a proper rotation (determinant +1), so nothing is mirrored. Yaw is all there IS to
 * draw: the feed publishes one angle, so a car never leans and a slope makes it cut into the road — recorded
 * in [edge-cases](../../../../docs/edge-cases/dispatch-console.md) rather than papered over with a derived
 * pitch, which would be inventing an orientation at 110 m between fixes.
 * It is also where a car ends up facing backwards: a converted model is authored GTA Z-up with **+y
 * forward**, the engine is Y-up with `z = −y`, and the yaw therefore runs the OTHER WAY round than
 * {@link headingOf} reports it. Pinned by a test rather than by this paragraph — north must come out as
 * engine −z and east as engine +x.
 */
export function gtaRootMatrix(out: Float32Array, at: GtaGround, elevation: number, heading: number): void {
  const c = Math.cos(-heading);
  const s = Math.sin(-heading);
  out.set([c, 0, -s, 0, -s, 0, -c, 0, 0, 1, 0, 0, at[0], elevation, -at[1], 1]);
}

/** GTA ground point → the engine ground point under it. `height` lifts it off y = 0. */
export function gtaToEngine(at: GtaGround, height = 0): [number, number, number] {
  return [at[0], height, -at[1]];
}

/**
 * SA's Z-ANGLE → this app's heading. The one conversion a live feed needs, and the one that is silent when
 * it is wrong.
 *
 * The game and this map measure the same direction in opposite senses. SA's z-angle (`GetVehicleZAngle`,
 * and what PCAD publishes beside the position — [202 §4](../../../../docs/plans/202-pcad-dispatch/readme.md))
 * is **degrees counter-clockwise from north**: 90° faces WEST. {@link headingOf} is a compass bearing,
 * **radians clockwise from north**: 90° faces EAST. Feeding one in as the other mirrors every unit's facing
 * about the north-south axis, which on a top-down map is not a broken picture — it is a plausible car
 * pointing somewhere else, and nothing anywhere says so.
 *
 * Degrees in, because that is what every SA API answers with. Confirm the field's unit against `cadui.lua`
 * when the socket lands; the sense is derived from the game's own matrix, not assumed.
 */
export function headingFromZAngle(degrees: number): number {
  const radians = (-degrees * Math.PI) / 180;

  return radians - Math.PI * 2 * Math.floor(radians / (Math.PI * 2)); // 0 ≤ heading < 2π
}

/** GTA heading (radians, 0 = +y/north) for a movement delta — what points a unit's chevron. */
export function headingOf(from: GtaGround, to: GtaGround): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1]);
}

/** One step of length `distance` from `from` towards `to`, clamped so it never overshoots. */
export function stepTowards(from: GtaGround, to: GtaGround, distance: number): [number, number] {
  const remaining = gtaDistance(from, to);
  if (remaining <= distance || remaining === 0) {
    return [to[0], to[1]];
  }
  const t = distance / remaining;

  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}
