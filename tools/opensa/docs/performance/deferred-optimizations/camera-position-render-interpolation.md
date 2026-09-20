# Render interpolation for the camera position weight

**Impact: none, and it was never the point — kept here as the calibration case.** This is the one entry on
the list that is not a performance lever: it bought camera FEEL (the position weight, and the ped "doubling"
at a run), and its measured cost when it shipped was **none — `ls-noon` vsync-capped at 120 fps with draws
and triangles identical to the rigid-position row**. A lerp/slerp per drawn body is free at this scale. Read
it as the reminder that this rubric collects deliberate costs, not only frame time.

**Status: PULLED 2026-07-25.** Render interpolation SHIPPED, and the position weight
(`positionLagTime`/`verticalLagTime`/`deadZone`) is back on. This entry is kept as the record of the lever
and its price; what follows describes what it looked like BEFORE, and the note at the end is what was
actually built.

## What we do today

Physics steps at a fixed 1/60 in `runFixedSteps` (`engine-canvas-host.tsx`). The ped pose, the camera focus
and the drawn vehicle transform all read the physics state in the VARIABLE-rate render loop. At 120 Hz that
means every other frame does no physics step, so the framed object's position is a stair-step. The camera
position tracks it RIGIDLY (config zeros), so the object and the camera move in lockstep — no judder, but no
weight either. Rotation, zoom and look-ahead are still smoothed (they do not fight the saw), and look-ahead
reads a `damp`-smoothed focus velocity so its offset does not stutter.

## The lever

Interpolate the render pose between the last two fixed states: keep `prev` and `cur` for every drawn
physics body, compute `alpha = accumulator / FIXED_STEP` after the catch-up, and draw the ped, each vehicle,
and the camera focus at `lerp(prev, cur, alpha)` (slerp for orientation). The focus becomes CONTINUOUS, so a
position spring smooths real motion instead of the fixed-step saw — and the object, drawn on the same
interpolated pose, stays in lockstep with the smoothed camera.

## What it would win

The position "weight" the follow rig was built for: the camera trailing a sharp direction change and easing
back, and the vertical softness that keeps stairs/curbs/jump arcs from jolting the horizon. Turn
`positionLagTime` (~0.12) and `verticalLagTime` (~0.28) back on and they work as their tests already
describe. It also smooths every OTHER drawn body at high refresh, not just the camera — the ped "doubling"
at a run is the same saw seen directly.

## What it would cost

- `prev`/`cur` storage and a lerp for every drawn physics body each frame — cheap per body, but it spans the
  ped pose path (`posePlayer`), the vehicle draw (`vehicle-physics.system` `setTransform`), and anything
  else drawn from a body (props?). Every such path must interpolate or it desyncs from the ones that do.
- One-frame-of-latency framing: interpolation draws BETWEEN the two latest states, i.e. ~one fixed step
  behind "now". Standard and invisible at 60 Hz+, but it is a real semantic change to the render pose.
- Care at teleports/respawns/vehicle entry — the same jumps the camera already guards must reset `prev` so
  the lerp does not sweep across the map for a frame.

## What would have to be true to pull it

- A field round wants the position weight badly enough to justify touching the ped + vehicle draw paths,
  OR the ped "doubling" at a run is judged bad enough on its own (it is the same root cause, so this fixes
  both at once).

## What was actually built (2026-07-25)

The full sweep, because the ped doubling and the car back-and-forth are the same root:

- **Ped** (host-only): `runFixedSteps` keeps `prevPlayerGta`/`curPlayerGta` (the Transform before and after
  the last fixed step); the loop draws `lerp(prev, cur, renderAlpha)` where `renderAlpha = accumulator /
  FIXED_STEP`. Gameplay (ground ray, heading, streaming) still uses the live pose. Teleports reset the pair
  via `resetPlayerInterpolation` in `placePlayer`. Riding uses the same pair (the rider is teleported onto
  the seat every step, so the snapshot interpolates the seat).
- **Vehicles**: `VehiclePhysicsSystem` split into `snapshot(step)` (fixed loop — reads the body, keeps
  prev/cur pos+quat, writes the gameplay pose, rolls wheels) and `render(alpha)` (variable loop — draws
  `lerp`/`slerp` into `renderPosition`/`renderOrientation`). The camera's seated focus follows
  `renderPosition`; the lamps/coronas ride `renderOrientation` (on the raw fixed-step orientation they
  twitched against the slerp-drawn body through a turn — the field caught it).
- Position weight turned back on: `positionLagTime` 0.12, `verticalLagTime` 0.28, `deadZone` 0.08.

Cost: none measurable — `ls-noon` vsync-capped at 120 fps, draws/tris identical to the rigid-position row
(a lerp/slerp per drawn body is free at this scale).
