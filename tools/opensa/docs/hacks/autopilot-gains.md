# Autopilot gains

**Live.** Taken 2026-07-30 with plan 096/02 (video mode's `PathFollowSource`).

## What it is

`packages/game/src/vehicle/path-follow.ts`, the constants the controller is made of:

```ts
const LOOKAHEAD_TIME = 0.9;  // s of travel the pure pursuit aims ahead
const LOOKAHEAD_MIN = 6;     // m
const LOOKAHEAD_MAX = 25;    // m
const CROSS_GAIN = 0.05;     // rad of extra bearing per metre off the line
const CROSS_MAX = 0.15;      // rad
const LEAD_MAX_S = 0.4;      // ceiling on the actuator-lag prediction
const BRAKE_DECEL = 3;       // m/s² the speed plan assumes it can brake at
const THROTTLE_P = 0.8;      // pedal per m/s of speed error
const THROTTLE_I = 0.08;
const DEADBAND = 0.02;       // steering dither floor on a straight
const ARRIVE_M = 8;          // how close to the last vertex counts as done
const STUCK_SPEED = 1;       // m/s under throttle …
const STUCK_SECONDS = 3;     // … for this long = wedged
```

## What it stands in for

SA's own car AI — `CCarAI` / `CCarCtrl`, which drives traffic along the same `NODES*.DAT` graph. It is not
ported, and porting it would answer a different question: SA's traffic cars are steered toward a lane target
by a controller tuned for cars the player is not sitting in, on a physics model that is not Rapier's raycast
controller. What is NOT fitted here is everything the route already carries — the per-vertex target speeds
come from the builder's `sqrt(latAccelMax × radius)`, and the wheel command goes through the car's OWN
granted lock and wheelbase (`SteeringModel`), so no number here encodes a particular car.

The pure-pursuit law itself (`κ = 2·sin α / chord`, `δ = atan(κ · wheelbase)`) is textbook geometry, not a
fit; the fit is the four gains that schedule it.

## What it was judged on

Two instruments, in this order:

1. **A kinematic bicycle** (`path-follow.test.ts`) — deterministic, with the real slew (1.2 rad/s) and the
   real lock. Convergence from 5 m off, a 90° corner at 25 m radius, and the mirror of that corner.
2. **The headless field run** (096/02, `?video=1`, 21 scenes over three seeds against
   `build/original/opensa`): cross-track error p95 ≤ 0.13 m and max ≤ 0.19 m against a plan floor of
   1.5 m / 3 m, `|gLat|` p95 ≤ 0.29 g against a 0.35 g calm band, 0 stuck flags.

The gains were not swept to an optimum. `THROTTLE_P` was the one that got a sweep (0.5 / 0.8 / 1.2 on the
bicycle), and it moved corner-entry speed by 0.4 m/s across that whole range — which is why the file says the
horizon, not the gain, is what brakes early.

## What would retire it

Either a recovered `CCarCtrl` steering/throttle law worth matching, or the honest replacement: gains
DERIVED from the car's own numbers (lookahead from wheelbase and top speed, `BRAKE_DECEL` from
`fBrakeDeceleration` instead of a flat 3). The second is cheap and is the obvious next step if a heavy or a
very light car reads badly — nothing in the design prevents it, the constants are simply not asked for yet.

## Blast radius

Video mode only. Nothing in the game reads `PathFollowSource` but `engine-video-runs.ts`, and it is neutral
unless a scene hands it a route. Changing a gain changes how the shots LOOK (a longer lookahead cuts corners,
a shorter one weaves), so a change here is a change to the trailer footage and to the cross-track numbers in
the 096 ledger — not to how the player's car drives.
