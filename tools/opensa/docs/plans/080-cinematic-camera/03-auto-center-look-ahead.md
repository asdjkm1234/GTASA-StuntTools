# 080/03 — Auto-centering + look-ahead (behaviours 1, 4, 6)

Builds directly on the 02 rig: both features are just new WRITERS to channels 02 created
(`smoothDampAngle` yaw target, look-point offset). No new smoothing machinery.

## 1. Auto-centering (#6, and the visible half of #1)

The 036 prod camera solved this once; we port its semantics onto the spring channels, with one
GTA V refinement (idle recenter, which 036 did not have):

- **Turn-follow** (036 semantics, kept): heading = `atan2` of the per-frame world-position delta
  (orientation-agnostic — works on foot and later in cars, including reverse). A heading change
  faster than `TURN_THRESHOLD` (0.9 rad/s starting value) engages `following`, which steers the
  yaw target to _behind the movement_ until settled (`SETTLE_EPSILON` 0.03 rad). Walking straight
  **never** engages — a player-framed angle survives a whole straight run.
- **Idle recenter** (new, the GTA V behaviour): when `idleFor > recenterDelaySec` (look input only —
  movement does not reset it) AND the player is moving above `MOVE_THRESHOLD`, the yaw target eases
  behind the current heading at `recenterRate`, **scaled by speed** (walk barely recenters, sprint
  recenters confidently; standing still never recenters — GTA V leaves a parked camera alone).
- **Manual always wins**: any look input clears `following` and the idle timer
  (`MANUAL_GRACE_MS` 250 from 036). Pitch is never auto-touched.
- Both writers steer through the 02 `smoothDampAngle` channel — that spring is where the
  "camera softly catches up to the character's turn" weight (#1) is actually felt.

## 2. Look-ahead (#4)

- A lateral offset added to the look point: `lookAheadOffset` damps toward
  `normalize(planarVelocity) × lookAheadDistance × speedFactor` with `lookAheadTime` (a slow-ish
  `smoothDamp` — the frame shift should be felt as composition, not as tracking).
  `speedFactor = clamp(speed / runSpeed, 0, 1)` — walking gives a hint, sprinting the full shift.
- The offset applies to the LOOK POINT only (target), not the eye orbit centre — this yaws the
  composition toward travel (player slides toward the trailing screen edge) without changing the
  orbit geometry the collision layer (04) has to defend.
- Zeroes (through its damp — no snap) when velocity drops below the dead-zone threshold or in
  photo/bench. Cap the offset so the player never exits the safe frame (≤ ~0.8 m at sprint;
  tune in the field round).

## Subtasks

- [x] Heading tracker with `MOVE_THRESHOLD` freeze (036: a stationary player cannot drift heading).
- [x] Turn-follow engage/settle state + tests (engage only above threshold; straight run never
      engages; manual look cancels; reverse walks the camera to face the motion).
- [x] Idle recenter: timer from 02, speed-scaled rate, stand-still exclusion; tests for each gate.
- [x] Look-ahead offset channel + cap + tests (offset tracks velocity direction change through the
      damp; zero at rest; capped at sprint).
- [x] Config + Camera-tab rows: `recenterDelaySec`, `recenterRate`, `lookAheadDistance`,
      `lookAheadTime`, thresholds.
- [~] **Field round**: run a lap with no mouse input (does it settle behind you naturally?), zigzag
      between buildings (turn-follow), strafe-circle an enemy stand-in (look-ahead must not fight
      orbiting). Freeze defaults.

## Acceptance

- Tests green; no-input lap ends with camera behind the player without ever feeling yanked.
- Field verdict accepted for #1/#4/#6; values in the ledger.

## Ledger

### 2026-07-25 — code complete, AWAITING THE FIELD ROUND (with 02)

**What landed**

- `auto-center.ts` — the idle clock, the heading tracker and both writers. Turn-follow arms on a heading
  rate past `turnThreshold` and steers through 02's `smoothDampAngle` channel until it is within
  `settleEpsilon`; idle recenter runs after `recenterDelaySec` of untouched look, only while the player is
  actually moving, at `recenterRate × speed/lookAheadFullSpeed`. Any look input cancels both and restarts
  the clock; the `manualGraceSec` window then keeps turn-follow from re-arming immediately.
- `look-ahead.ts` — the composition offset: a spring toward `normalize(velocity) × lookAheadDistance ×
  speedFactor` over `lookAheadTime`, hard-capped at `lookAheadDistance`, fading to zero through the same
  channel when the player stops. It is added to the look point AFTER the follow spring, so eye and target
  move together — the orbit geometry plan 04 has to defend is untouched.
- Director: both run **on foot only** and never on the legacy path; the framed object's planar velocity is
  derived from the focus delta inside the director (no new host plumbing, and it measures whatever is being
  framed), with the same teleport guard the follow point uses.
- The snapshot gained `focusHeading` — `Locomotion.heading` (rate-limited, plant-aware), NOT an atan2 of
  velocity. The 036 plan called for the velocity atan2; 088 shipped a better signal, so this uses it.
- Camera tab: `RECENTER AFTER`, `RECENTER RATE`, `LOOK AHEAD`, `LOOK AHEAD TIME`, `TURN THRESHOLD`.

**The convention, pinned** (it is the one thing here that could be wrong by π): a GTA heading `h` points
along `(−sin h, cos h)`, the camera looks along `(sin yaw, −cos yaw)`, so **behind = `h + π`**. The
invariant the director test asserts is the readable form of it: running the way the camera already looks
needs no correction at all, and running 1 rad off recenters to `1 + π`.

**First-guess defaults (field round tunes them)**

| field              | value   | why this number                                                                     |
| ------------------ | ------- | ------------------------------------------------------------------------------------ |
| `turnThreshold`    | 0.9 /s  | 036's value. A straight run never reaches it; a corner does.                         |
| `settleEpsilon`    | 0.03    | 036's value — under 2°, invisible as a stop.                                          |
| `manualGraceSec`   | 0.25 s  | 036's manual grace: a small correction is not immediately undone.                     |
| `recenterDelaySec` | 2 s     | Long enough that looking around is not "fighting" the camera, short enough to help.  |
| `recenterRate`     | 1.6 /s  | At a full run that is a ~0.43 s half-life — a drift home, not a yank.                 |
| `moveThreshold`    | 0.6 u/s | Under the walk gait (2 u/s): standing still and micro-drift never rotate anything.    |
| `lookAheadDistance`| 0.8 m   | A visible lean at the run gait; the plan's own suggested cap.                         |
| `lookAheadTime`    | 0.45 s  | Slow enough to read as framing rather than tracking.                                  |
| `lookAheadFullSpeed`| 7 u/s  | The run gait — walk gets a hint, sprint the whole shift.                              |

**Measured**

| what                                | number                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| full suite                          | 348 files / **2624 tests green** (+24 over 080/02)                        |
| `stepCamera` with 01+02+03 channels | **0.203 µs mean · 0.214 µs p95** (02 was 0.185/0.208) — +10%              |
| headless run-then-strafe            | 120 fps, draws 657→714; the camera follows the turn home with no input     |

Recorded in [`docs/benchmarks/opensa-engine/2026-07-25-headless-080-camera-director.json`](../../benchmarks/opensa-engine/2026-07-25-headless-080-camera-director.json).

**Decisions / deviations**

1. **Idle recenter is a RATE (`dampAngle`), not the `smoothDampAngle` spring.** The plan asked for both
   writers on the one spring, but the behaviour it also asks for — "walk barely recenters, sprint
   recenters confidently" — is a speed-scaled RATE, which a fixed-time spring cannot express without a
   per-write lag override. Turn-follow (which has no speed scaling) keeps the spring.
2. **On foot only.** Turn-follow and look-ahead in a car are plan 05's, tuned against a car's speeds; a
   vehicle keeps today's behaviour (the entry swing) until then. One `mode === 'foot'` gate, not scattered.
3. **Velocity is derived, not plumbed.** The director measures the focus delta per frame instead of taking
   a velocity from the host — it then measures whatever it is framing (ped or car), and there is one less
   thing for the host to keep correct.

**Owed:** the field round (shared with 02): a no-input lap, a zigzag between buildings, a strafe-circle. The
one interaction to watch is the feedback loop every camera-relative game has — auto-center rotates the
camera, which rotates "forward", which curves a held strafe. The headless run converges rather than
spiralling, but only a human can say whether it FEELS right.

### 2026-07-25 — field-round fixes (user report, same day)

The first look surfaced three things the tests could not — the behind-yaw convention was a π off in
practice, and the vehicle was left out. Fixed:

1. **The camera framed the player's FACE at rest and behind them only once moving.** The rig SEEDED at
   yaw π while the ped spawns facing π, and `yawBehind(π) = 0` — so the start was nose-to-nose, and the
   first step's auto-center swung it round. Fix: seed the rig at `yawBehind(SPAWN_FACING)`. (The behind
   formula itself was right — a straight run showed the back, pinned by the invariant test — only the seed
   was wrong.)
2. **Vehicle entry framed the car's FRONT, then swung to the rear.** `aimCamera` fed the car heading
   straight into the yaw target; the same convention says behind is `heading + π`, so it aimed at the
   front. Fix: `steerYaw` now takes a FACING and applies `yawBehind` itself — one place, and the exit swing
   (which also passes a facing) gets it too. The old `aimCamera(heading)` comment claiming it "centres
   behind the rear" was simply wrong and never visually checked.
3. **The camera did not settle behind a moving car at all.** Auto-center was gated `mode === 'foot'`. The
   user wants the camera to find the car's rear while driving, so auto-center now runs on foot AND in a
   vehicle (heading = the car's). Only the look-ahead LEAN stays on foot — a car's lean is drift framing
   (toward the slide, not the heading), still plan 05.

Field-checked headless: at rest the camera sits behind the standing player; entering a car it lines up
behind the rear. Suite 2625 green.

### 2026-07-25 — the jitter fix (rigid position, smoothed rotation)

The user reported the camera juddering while moving — the ped appearing to "double" at a run, the camera
sliding back-and-forth in a car. Root cause: physics runs at a fixed 1/60 in `runFixedSteps`, but `focus`,
`posePlayer` and the camera all step in the VARIABLE-rate render loop, so at 120 Hz every other frame does
no physics step. The framed object's position is a stair-step; a POSITION spring smoothing that stair-step
lags and catches up every render frame, so the object oscillates against the camera on the fixed-step saw.
The legacy stick never showed it because it moved in lockstep with the object.

**The fix, without waiting for render interpolation:** ship the position channels at 0 —
`positionLagTime`, `verticalLagTime`, `deadZone` all default to 0, so the camera position rigidly tracks
the focus (in lockstep with the drawn object → nothing to beat against). Everything that does NOT fight the
saw stays smoothed: input dampening, the yaw catch-up, auto-center, zoom, and look-ahead. Two details:

- The look-ahead offset reads the focus VELOCITY, and the raw per-frame delta is the same saw (zero on the
  no-physics frames). So `focusVelocity` now smooths the measurement — a `damp` at λ=14 (~0.05 s) recovers
  the saw's average without meaningful lag. This is a measurement filter, not a feel channel.
- The follow-rig code and its tests stay — the position spring is a real, tested mechanism gated by the
  config values; it returns the moment those values go non-zero.

**What this costs (recorded, standing rule):** behaviour #3 (position "weight" — the camera trailing a
sharp direction change) and the vertical follow softness are OFF at these defaults. They come back when the
host gains **render interpolation** (draw ped + car + camera focus at `lerp(prev, cur, accumulator/step)`),
which makes the focus continuous so a position spring no longer beats against the saw. That is a host-loop
change across the ped and vehicle draw paths — its own step, and the right home for the position weight.
See `docs/performance/deferred-optimizations/` for the lever with its price.

### 2026-07-25 — smooth enter/exit transition (user request, same day)

With auto-center now running in a vehicle, the climb-IN sequence exposed a new problem: the ped twitches
through the approach run, the door open and the climb-in slide, and auto-center chased every one of those
mid-sequence headings — the camera swung back and forth before settling. The user wants one smooth glide
behind the car on entry, one behind the player on exit, ignoring the twitches between.

Fix: `EnterVehicleSystem.isSettling()` is true for every phase except `idle` and `seated` (the two settled
states). The host passes it as `CameraSnapshot.settling`; while set, the director suspends auto-center but
keeps stepping the steered-yaw channel. The swing target is now set at the START of each sequence, not the
end: entering aims behind the car the moment the door opens (`opening`), exiting aims behind the dismount
facing the moment the climb-out begins (`exiting`) — so the glide plays across the whole animation instead
of snapping when the ped lands. `exitFacing()` extracts the doorway-out yaw the finish already computed.
Any mouse movement still cancels the swing (the player takes over). Unit-pinned: the director ignores a
heading swinging around while `settling` yet still glides to the target. Suite 2626 green.

### 2026-07-25 — render interpolation → the position weight is BACK ON (user request)

The rigid-position stopgap did its job (no judder) but the user wanted the smooth position weight, so the
deferred render-interpolation lever was pulled. Physics still steps at a fixed 1/60; the host now draws the
world at `lerp(prev, cur, alpha)` between the last two fixed states (`alpha = accumulator / FIXED_STEP`):

- **Ped**: `runFixedSteps` snapshots the Transform before/after the last step into `prevPlayerGta`/
  `curPlayerGta`; the loop draws the lerp. Gameplay (ground ray, heading, streaming) stays on the live pose.
  `placePlayer` resets the pair so a teleport never sweeps. Riding shares the pair (the rider is teleported
  onto the seat each step, so the snapshot interpolates the seat pose — no ped-vs-car desync).
- **Vehicles**: `VehiclePhysicsSystem` split into `snapshot(step)` (fixed: read body, keep prev/cur pos+quat,
  write the gameplay pose, roll wheels) and `render(alpha)` (variable: draw `lerp`/`slerp` into
  `renderPosition`/`renderOrientation`). The seated focus follows `renderPosition`.
- **Lamps/coronas** ride `renderOrientation` — a field catch: on the raw fixed-step orientation they twitched
  against the slerp-drawn body through a turn (straight was fine, left/right jittered).

With a continuous focus the position spring smooths real motion, not the saw, so `positionLagTime` 0.12,
`verticalLagTime` 0.28 and `deadZone` 0.08 are back on. Cost: none measurable — `ls-noon` vsync-capped at
120 fps, draws/tris identical to the rigid row. Suite 2629 green. Lever record:
`docs/performance/deferred-optimizations/camera-position-render-interpolation.md` (now PULLED).

**Field fix (same day): the seated rider juddered fore/aft.** `driveSeated` calls the host's `placePlayer`
EVERY fixed step to snap the rider onto the seat, and `placePlayer` was resetting the interpolation each
time — so the ped drew on the raw stair-step while the car drew interpolated, juddering him against the
seat. The reset belongs only to a genuine warp: `placePlayer` no longer resets, and a new `teleportPlayer`
(place + reset) is what the debugger's teleport uses. The per-step seating now interpolates the seat pose
in lockstep with the car (the snapshot already captures Transform after the vehicle fixed step).

### 2026-07-25 — FIELD ROUND ACCEPTED (with 02 and 04)

User's verdict: accepted, no retune. **The first-guess defaults above are frozen as shipped** —
`turnThreshold` 0.9, `recenterDelaySec` 2, `recenterRate` 1.6, `lookAheadDistance` 0.8, `lookAheadTime`
0.45 all survive the round untouched.

The two behaviours the plan asked a human to call: the strafe-curving concern (auto-center rotates the
camera, which rotates "forward") did not come back as a complaint, and neither did the recenter rate. Both
stay as they are; they remain live on the Camera tab if a later round disagrees.
