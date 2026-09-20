/**
 * The walk scene's route work (plan 096/07): turning a road route into waypoints a person can be walked
 * along, and rejecting the ones nobody can.
 *
 * Pure, like `stations.ts` and for the same reason: the ground query arrives as a probe interface, so the
 * rejection rule is testable without a physics world.
 *
 * Two facts shape everything here.
 *
 * **The game's node graph is a VEHICLE graph.** SA keeps no pedestrian paths we parse, so a walk route is a
 * driving route pushed sideways onto what is usually a pavement. Where the road has none — a bridge, a
 * tunnel mouth, a desert verge — the offset lands on whatever is there.
 *
 * **A waypoint's Z is never read.** `CharacterControllerSystem.moveToward` steers on the PLANAR delta only,
 * and the capsule finds its own ground every step. So the ground probe below is not a snap the walk needs —
 * it is the only test of whether the route is walkable at all, which is why a miss rejects the whole route
 * rather than nudging a point.
 */
import type { Route } from '@opensa/game/paths/route-builder';

/** How far right of the road CENTRE a walk route is offset (m) — `walkRoute`'s `laneOffset`.
 *
 * The driving offset is 2.5 (the lane), so this puts the walker about 4 m further out: clear of the traffic
 * lane and roughly where a pavement sits on SA's wider streets. It is a pavement GUESS, not a pavement. */
export const WALK_LANE_OFFSET = 6.5;

/** How far below a waypoint the ground is looked for (m) before the route is rejected. */
export const WALK_GROUND_DROP = 3;

/** How far ABOVE the waypoint the ground probe starts (m) — the same trick the station survey uses: start
 *  clear of whatever the point itself is embedded in, then search down through it. */
const WALK_GROUND_LIFT = 2;

/** Share of the collision radius the check trusts — the ring is measured from the player, and a point at
 *  its very edge is a coin toss between "no ground here" and "not streamed yet". */
const CHECKED_SHARE = 0.8;

/** Route points searched ahead of the last cursor for the walker's position — see {@link createWalkCursor}. */
const CURSOR_WINDOW = 12;

/** What {@link walkWaypoints} produced, and enough of why for the scene's line. */
export interface WalkPath {
  /** How many leading waypoints were actually probed — the rest were outside the streamed collision. */
  checked: number;
  /** The waypoint that had no ground under it, or null when every CHECKED one answered. */
  miss: null | number;
  /** GTA Z-up waypoints in travel order. Empty when the route was rejected. */
  points: readonly (readonly [number, number, number])[];
}

/**
 * How far along the route the walker is, as a fractional point index — what the driving scene reads off the
 * autopilot's `progress()`, which a scripted walk has no equivalent of.
 *
 * MONOTONIC by construction: it searches a window AHEAD of where it last was, never the whole route. A
 * nearest-point search over everything looks right until the route passes near itself — a block walked round,
 * a street doubled back on — and then the cursor snaps backwards, which the station survey reads as the
 * subject having teleported and predicts a window from the wrong stretch of pavement.
 *
 * The window is generous against the walk: at 2 m/s and 2 m point spacing the walker advances one point per
 * second, so twelve points is several seconds of slack for a stall or a frame hitch, and still far short of
 * the distance a route needs to double back over.
 */
export function createWalkCursor(
  points: readonly { position: readonly [number, number, number] }[],
): (at: readonly [number, number, number]) => number {
  let cursor = 0;

  return (at): number => {
    const last = points.length - 1;
    let best = cursor;
    let bestDistance = Infinity;
    for (let index = cursor; index <= Math.min(last, cursor + CURSOR_WINDOW); index += 1) {
      const [x, y] = points[index].position;
      const distance = Math.hypot(x - at[0], y - at[1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    cursor = best;

    return cursor;
  };
}

/**
 * Probe the walkable ground under a route's opening stretch, and reject the route if any of it is missing.
 *
 * **Only the stretch inside the streamed collision is judged.** Staging happens with the player at the route
 * START, and collision streams around the PLAYER: a 156 m route reaches well past the ring, so probing all
 * of it would return null for the far end and reject every long route as "over a void" — a check that fails
 * on the world not being loaded yet is not a check, it is a route filter with the wrong name. What is beyond
 * the ring is walked on the controller's own ground handling, exactly as a player walking there would be.
 *
 * ALL-OR-NOTHING within that stretch, on purpose: dropping the waypoints that miss would route the ped
 * straight through whatever the gap was — a bridge parapet, the water beside a quay — and that is a scene
 * the footage keeps. One probe per point, so a rejected route costs a fraction of a survey.
 */
export function walkWaypoints(
  route: Route,
  groundBelow: (at: readonly [number, number, number], maxDrop: number) => null | number,
  collisionRadius: number,
): WalkPath {
  const points = route.points.map((point) => point.position);
  const [sx, sy] = points[0];
  const reach = collisionRadius * CHECKED_SHARE;
  let checked = 0;
  for (const [index, [x, y, z]] of points.entries()) {
    if (Math.hypot(x - sx, y - sy) > reach) {
      continue; // outside the ring — and a later point may curve back inside it, so this is a skip, not a stop
    }
    checked += 1;
    if (groundBelow([x, y, z + WALK_GROUND_LIFT], WALK_GROUND_LIFT + WALK_GROUND_DROP) === null) {
      return { checked, miss: index, points: [] };
    }
  }

  return { checked, miss: null, points };
}
