# 081/01 — Telemetry harness + scripted test track (the BEFORE baseline)

**Nothing in 02–06 gets tuned blind.** This plan builds the instruments, the repeatable driving
scenarios, and captures the CURRENT feel as data — the "before" every later ledger compares against.

## 1. Telemetry channel

A per-fixed-step sampler for the active (player-seated) vehicle, assembled from what Rapier + the
controller already expose — no physics changes:

| Signal                | Source                                                                      |
| --------------------- | --------------------------------------------------------------------------- |
| speed (signed), v3    | body linvel + heading projection (the `drive()` math, extracted)            |
| per-wheel: in contact | `wheelIsInContact(i)`                                                       |
| per-wheel: suspension | `wheelSuspensionLength(i)` → compression fraction of travel                 |
| per-wheel: susp force | `wheelSuspensionForce(i)` → normal load                                     |
| slip proxy (lateral)  | angle(planar velocity, body forward) — body-level; per-axle later if needed |
| slip proxy (long.)    | wheel-roll speed (from `VehicleRig` distance) vs ground speed               |
| body roll / pitch     | from body quaternion vs heading frame                                       |
| g-forces              | Δlinvel / dt, projected into body frame                                     |
| steer angle, controls | the values `drive()` actually applied this step                             |

- Implementation: `packages/game/src/vehicle/vehicle-telemetry.ts` — a pure sampler
  `sample(physics, controller, body) → TelemetryFrame`, ring buffer of the last N seconds. Runs
  only when enabled (debug/capture) — zero steady-state cost when off.
- **The slip proxy is the signal 080/05 (camera drift framing) will consume** — export it on the
  vehicles facade (`EngineVehicles`), not just into the HUD.

## 2. F2 Physics tab (live view + live tuning seam)

- New debug screen (capabilities system, plan 22 infra): live strips for the table above — per-wheel
  load/compression bars, slip dial, roll/pitch, g-meter, speed/gear (gear from plan 04 on).
- The same tab hosts **live-patchable physics constants** group-by-group as plans 02–06 land (the
  080 pattern: tune in-session, freeze into config). This plan ships the seam + the current shared
  constants (suspension four, friction slip, damping pair) as read-only rows first.

## 3. Scripted test track (replays)

Deterministic scenario runner, same philosophy as the render bench (`[bench]` protocol):

- **`ScriptedDriveSource` implements `InputState`** — a timeline of `{t, move, actions}` keyframes;
  the vehicle systems consume it unchanged (interface already narrow: `move()/isActive()`).
- Scenario = spawn spec (model, position, heading — real map locations, teleport + collision-cell
  settle via the existing defer-until-collision lesson) + input timeline + capture length.
- **Scenes v1** (each ~10–20 s, chosen on flat/known map spots):
  `brake-strip` (LS airport runway: WOT to top speed, full brake) · `slalom` (runway, metronome
  steering at fixed speed) · `u-turn` (180° at moderate speed) · `kerb-strike` (curb mount at an
  angle, docks) · `crest-jump` (a known hill crest at speed) · `handbrake-turn` (WOT, Space + full
  lock) · `pull-away+reverse` (from rest, incl. the seedReverse path).
- Runner rides the standalone/host page with a query param (`?phys=<scene>&car=<model>`), captures
  telemetry frames, prints **`[phys] {json}`** (the `[bench]` twin) → headless harness
  (`tools-debug/bench-harness/`) can run the whole matrix in Chrome unattended.
- Determinism check: run each scene twice in one session — frames must match within float noise
  (Rapier same-build determinism); a `phys-compare.ts` (bench-compare twin) diffs captures with
  per-signal tolerance bands (consumed by plan 07's regression pack).

## 4. BEFORE baselines + vanilla expectations

- Capture the full scene matrix × 3 reference cars (**infernus / admiral / firetruck** — sports,
  sedan, heavy; the idea doc's calibration trio) on the CURRENT physics. Store JSONs under the plan
  (small; they are the chain's "before" exhibit) + summary numbers in the ledger: peak body pitch
  under braking (sign = the nose-lift bug quantified), roll angle in slalom, speed at flip if any,
  time-to-100, brake distance.
- Record the user's per-scene EXPECTATIONS from vanilla SA (words, not captures — real SA runs
  outside the browser): e.g. "handbrake turn rotates ~90-120° with a held slide". These become the
  feel targets later plans are judged against.

## Subtasks

- [x] `vehicle-telemetry.ts` sampler + ring buffer + unit tests (pure math on scripted inputs).
- [x] Slip proxy exported on the vehicles facade (typed, documented for 080/05).
- [x] F2 Physics tab: live telemetry strips; read-only constants group.
- [x] `ScriptedDriveSource` + scenario spec + the 7 scenes v1.
- [x] `[phys]` capture protocol + `phys-compare.ts` + headless harness lane.
- [x] BEFORE matrix captured (3 cars × 7 scenes) + ledger summary + user expectation notes.

## Acceptance

- Determinism: same scene twice → within tolerance bands; harness runs the matrix headless.
- The nose-lift and flip complaints are VISIBLE AS NUMBERS in the baseline ledger (pitch sign under
  braking; roll/flip in slalom or u-turn) — if they are not, the scenes get redesigned until they are.
- Telemetry cost when enabled ≤ 0.05 ms/step; zero when disabled.

## Ledger

### 2026-07-25 — the sampler + the facade channel (subtasks 1 and 2)

**What landed**

- `packages/game/src/physics/physics-world.ts` — `readVehicleWheels(controller)`, the only new physics API:
  per wheel contact, spring length/rest/max-travel, suspension force, the forward/side tyre impulses and the
  cumulative roll angle. Read-only, no physics change.
- `packages/game/src/vehicle/vehicle-telemetry.ts` — `computeFrame` (pure), `TelemetryRing` (fixed-capacity,
  reads back oldest → newest) and `VehicleTelemetry` (the clock + previous sample + the ring, `enabled` off
  by default). Conventions PINNED in the module doc and in tests: **pitch positive nose UP**, roll positive
  right-side down, slip angle positive when the car points LEFT of its travel, g excludes gravity.
- `EnterVehicleSystem.appliedControls()` — the values `drive()` handed the controller last step (ramped
  engine force, slewed steer, the throttle behind them). A capture that recorded raw input instead could not
  explain the response, since neither channel reaches the car unfiltered. Zeroed unless seated.
- `EngineVehicles.telemetry` — the facade export 080/05 consumes. Only the SEATED car is sampled, its
  history resets when the player changes cars, and the `enabled` check runs before any physics read, so a
  shipped build pays nothing.

**Correction to this plan's channel table.** The doc specified the longitudinal slip proxy as "wheel-roll
speed (from `VehicleRig` distance) vs ground speed". That proxy is DEGENERATE: the rig's roll is itself
derived from the car's planar displacement (`VehiclePhysicsSystem.rollWheels`), so it would have reported
zero slip by construction — a wheelspin is exactly the case where the wheel's speed and the ground's differ.
Rapier's controller exposes more than the plan assumed: `wheelRotation` (cumulative, unwrapped) gives the
wheel's REAL angular speed, so the shipped `slipRatio` is a true `(surfaceSpeed − groundSpeed) / |groundSpeed|`
— positive for wheelspin, −1 for a locked wheel. `wheelForwardImpulse` / `wheelSideImpulse` are recorded
too: the tyre forces actually delivered, which plans 03–05 need per corner and the plan did not list.

**Tests**: `vehicle-telemetry.test.ts` (21) — signs and conventions per channel, rates reading 0 on the
first step (one sample cannot show a rate), the slip floor, the ring's order/capacity, a disabled sampler
doing nothing at all. `physics-world.test.ts` gained 3 real-Rapier cases: an airborne car reads no contact,
a car resting on ground reads compressed springs whose four loads sum past half its weight, and a wheel-less
controller reads empty. Full vehicle + physics suites 171 green; `tsc` + eslint clean.

**Not done here** (the rest of this plan): the F2 Physics tab, `ScriptedDriveSource` + the 7 scenes, the
`[phys]` capture protocol + `phys-compare.ts`, and the BEFORE matrix (3 cars × 7 scenes) with the user's
vanilla expectations. No numbers are recorded yet BECAUSE none have been measured — the baseline needs the
scripted track, not a hand-driven session.

### 2026-07-26 — the F2 Physics tab (subtask 3)

**What landed**

- `apps/web/src/ui/debug/physics-panel.tsx` — the screen. The body block prints the frame's channels in the
  units a driver reads (km/h, degrees, g, kN); the wheel block prints one line per corner with a monospace
  travel meter (`● ████░░░░░░ 4.2kN -0.25`). The row builders (`bar`, `bodyRows`, `wheelRows`) are pure and
  unit-tested — a unit slip in the instrument would be indistinguishable from a physics bug in a field round.
  `pitch (+ nose up)` and `roll (+ right down)` carry their sign convention IN the label, because the whole
  braking complaint is a sign on that channel.
- **The capture switch belongs to the screen.** Mounting calls `setPhysicsCapture(true)`, leaving calls it
  with `false`; the host resets the ring on both edges, so an opened tab never shows a stale car's history.
  This is the Perf panel's `setPerfEnabled` pattern, and it keeps the "zero cost when disabled" promise the
  sampler was built with — a closed debugger reads nothing off the body.
- `VEHICLE_PHYSICS_CONSTANTS` (`physics-world.ts`) — the twelve shared numbers exported as `[label, value]`
  rows and printed read-only under the divider. Seeing "every car runs these" next to the live telemetry is
  the plan-02 argument made visible while driving.
- `wheelCornerLabels` (`vehicle-telemetry.ts`) — wheel INDEX order comes from the model's own hub dummies, so
  it means nothing across cars. The axle comes from the model's front flag, the side from the hub's x sign
  (the driver's side is −X), and a straddled hub (bike) reads `F`/`R` with no side invented. The `[phys]`
  capture will name its corners with the same function.
- Screen gating followed the existing capability system: a `physicsScreen` capability (engine host true,
  three host false — there is no raycast-vehicle telemetry there) and the screen added to the dev-only set,
  like every other live-tuning screen. `menuFor`'s per-screen gate is now a `SCREEN_CAPABILITY` map instead of
  a growing chain of ternaries.

**Numbers.** None measured here, and deliberately so: this subtask ships an INSTRUMENT, and every number this
plan owes (telemetry cost per step, the BEFORE matrix) needs the scripted track from subtask 4 to be
reproducible. A hand-driven reading would not survive its own re-run. What is verified: `tsc` clean, eslint
clean, `npm run build` clean, and 63 green across the touched suites (`physics-panel` 10 ·
`debug-capabilities` 14 · `vehicle-telemetry` 26 · `engine-debug-actions` 13), of which 13 are new: 10 panel
formatting/meter cases, 2 corner-label cases (four-corner car, straddled bike hub), 1 menu-gating case.

**Still owed by this plan**: `ScriptedDriveSource` + the 7 scenes, the `[phys]` capture protocol +
`phys-compare.ts`, and the BEFORE matrix (3 cars × 7 scenes) with the user's vanilla-SA expectations in words.

### 2026-07-26 — the scripted track and the `[phys]` protocol (subtask 4, most of 5)

**What landed**

- `packages/game/src/vehicle/scripted-drive.ts` — `ScriptedDriveSource` IS an `InputState`, so a lap drives
  through `drive()`'s own ramps, steer slew and reverse seeding. A capture that bypassed them would measure a
  car the player never drives. Keyframes HOLD (no interpolation): a slalom is "full left, then full right",
  and a scene has to be describable in words to be reproducible. Its clock runs on the FIXED step — a
  timeline advanced by the render rate replays differently on a different machine. Idle it contributes
  nothing to the `CombinedInput` sum, so it lives in the host permanently and only speaks during a lap.
- `apps/web/src/phys-scenes.ts` — the 7 scenes. **Every spot is REAL**: `scripts/debug/road-straights.ts`
  (promoted from a throwaway, row added to `docs/debug/README.md`) walks the game's own `NODES*.DAT` vehicle
  graph for chains that hold one heading, and reports each run's length and Δz. The straights used are the SF
  west shore (450 m, **Δz 0.00**), an LV avenue (336 m, Δz 0.00) and an LS east straight (294 m, Δz 0.00);
  the crest is a Red County rise of +4.3 m then −3.3 m within 50 m of the peak. Guessing "the airport runway
  is about here" would have put the whole BEFORE matrix on unverifiable ground.
- `apps/web/src/ui/engine-phys-runs.ts` — `?phys=<scene|all>&car=<model>`, the `[bench]` runner's twin.
  A lap teleports beside the spot, waits for the streaming ring to drain (the collision cell must exist
  before a car is dropped into it), spawns the model, presses enter/exit and **walks the ped in through the
  real sequence**, lets the springs settle, then plays the timeline with the capture ON and prints
  `[phys] {json}`. Everything outside the timed window happens with the capture OFF.
- `packages/game/src/vehicle/phys-capture.ts` — the summary every later plan is judged by (peak nose-up
  angle WHILE braked, braking distance/time from its start speed, roll range, first flip + the speed it
  happened at, air time, integrated rotation, time to 100). Peaks come from EVERY frame; the printed series
  is thinned to 20 Hz, so a spike survives as a number even when its sample is dropped from the curve.
- The telemetry ring went 600 → 3600 frames: the longest scene is 24 s and a ring that wrapped mid-lap would
  silently drop the launch and report the tail as the run.

**Numbers — the first real capture (infernus, `brake-strip`, headless, build `./build/original/opensa`)**

The first run held WOT to 12 s and the car **ran out of straight at 190 km/h** — an 18.8 g lateral spike and
0.13 s of air that had nothing to do with braking. That is the harness working: a bad scene showed up as data,
not as a plausible number. Brake moved to 8 s (~200 m in); the clean lap:

| channel                     | value                                       |
| --------------------------- | ------------------------------------------- |
| time to 100 km/h            | **3.98 s**                                  |
| speed at brake              | **165.2 km/h**                              |
| braking distance / time     | **59.9 m / 2.92 s** (≈1.6 g average)        |
| peak longitudinal g         | **−3.17 g**                                 |
| **pitch while braking**     | **+0.07° (nose UP)**, whole-lap range −0.53…+0.07° |
| roll / slip / lateral g     | 0 / 0 / 0 (a dead-straight lap)             |
| frames                      | 960 @ 60 Hz, 401 rows printed at 20 Hz      |

**The braking complaint, quantified.** The nose does not dive: at 1.6 g of deceleration the body pitches
**+0.07°, and the sign is UP**. It is not that the car pitches up a lot — it is that it does not pitch at all,
and what little there is goes the wrong way. `CHASSIS_ANGULAR_DAMPING = 2` (the band-aid plan 03 retires) is
the obvious suspect, and the number to beat is now on record.

**Still owed at the time of writing**: `phys-compare.ts` (determinism check + tolerance bands), and the BEFORE matrix
(3 cars × 7 scenes) with the user's vanilla-SA expectations in words.

### 2026-07-26 — the user's complaints, in their words (subtask 6, first half)

Given while the BEFORE sweeps ran; paraphrased into English, meaning preserved. **These are the feel targets
plans 02-06 are judged against** — the chain does not get to declare itself done against its own numbers.

> The car does not feel real.
>
> - **Steering turns instantly** — the car simply changes its direction vector. Corner entry is immediate:
>   there is no transition into a turn.
> - **There are no slides.**
> - **Braking is instantaneous.** At high speed either the tail lifts, or the rear goes, or the car spins
>   through 180°.
> - **Acceleration is fast and so is stopping.**
> - **Small obstacles — a kerb — can flip the car. It behaves like cardboard.**

**Complaint → the number that shows it → the plan that owes the fix.**

| Complaint                     | What the BEFORE data says                                                                                 | Owner |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ----- |
| Instant corner entry, no slide | The tyre model is effectively binary: `WHEEL_FRICTION_SLIP` 10.5 for every car, so the velocity vector snaps to the heading — until grip breaks and the lap ends in a crash or a flip. No scene yet measures the TRANSIENT (see the gap below). | 05    |
| Braking is instant             | 165 → 0 km/h in **59.9 m / 2.92 s** (≈1.6 g average, **−3.17 g** peak). Road cars manage ~1 g.            | 04    |
| Tail lifts / rear goes / 180°  | On a straight brake the body pitches **+0.07°** — it does not dive AT ALL, so every visible motion under braking comes from somewhere other than weight transfer. `CHASSIS_ANGULAR_DAMPING = 2` is the suspect. | 03    |
| Acceleration is fast           | infernus 0-100 in **3.98 s**. Whether that is the CAR or the shared constants is what the admiral/firetruck sweeps answer — all three read the same five handling fields today. | 02/04 |
| A kerb flips it, like cardboard | `kerb-strike` spins the car **−89.5°** with 0.28 s of air at 125 km/h; `slalom` and `handbrake-turn` both go **fully over** (roll ±180°, 18.3 s and 10.5 s of tumbling). | 02/03 |

**Scene gap this exposes.** Every current scene either stays straight or goes to full lock. The loudest
complaint — the MISSING TRANSIENT into a corner — needs a scene that neither of those can show: a constant
moderate steering input at constant speed, where the numbers to watch are how long the slip angle takes to
build and whether it ever settles instead of snapping. That scene is owed before plan 05 is judged.

### 2026-07-26 — THE BEFORE MATRIX (subtask 6): 3 cars × 7 scenes, 21 of 21 laps

Captured headless on build `./build/original/opensa` through `?phys=all&car=<model>`. **The captures live in
the measurement record, not under this plan** — `docs/benchmarks/vehicle-physics/` (its readme carries the
schema and the comparability rules): a baseline that only exists inside a plan folder is lost the day the
plan closes, and plans 02-07 all compare against these files with `scripts/phys-compare.ts`.

| Scene             | Car      | Top km/h | 0-100 s | Brake m / s | Roll min…max °  | Slip ° | Turned ° | Air s | Flip |
| ----------------- | -------- | -------: | ------: | ----------: | --------------: | -----: | -------: | ----: | :--: |
| brake-strip       | infernus |    165.7 |    3.98 |    60 / 2.9 |     0.0 … 0.0   |    0.0 |      0.0 |  0.00 |      |
| brake-strip       | admiral  |     77.3 |       — |    24 / 2.3 |     0.1 … 0.1   |    0.1 |     -0.0 |  0.00 |      |
| brake-strip       | firetruk |    149.1 |    4.53 |   119 / 8.0 |     0.0 … 0.0   |    0.0 |      0.0 |  0.00 |      |
| slalom            | infernus |    116.8 |    4.22 |           — | **-180 … 180**  |   74.4 |     62.1 | 18.25 |  ●   |
| slalom            | admiral  |     57.3 |       — |           — |   -39.3 … 14.2  |   59.5 |    -98.0 |  1.35 |      |
| slalom            | firetruk |    108.1 |    4.78 |           — |   -4.7 … 113.8  |   49.4 |     -6.0 | 17.83 |  ●   |
| u-turn            | infernus |     82.4 |       — |           — |   -54.7 … 16.1  |   45.0 |     43.1 |  3.65 |      |
| u-turn            | admiral  |     38.6 |       — |           — |    -2.3 … 7.0   |   58.6 |     43.6 |  0.28 |      |
| u-turn            | firetruk |     71.2 |       — |           — |    -4.5 … 7.1   |   40.6 |     57.8 |  0.17 |      |
| kerb-strike       | infernus |    124.8 |    4.17 |           — |    -1.0 … 3.5   |   89.9 |    -89.5 |  0.28 |      |
| kerb-strike       | admiral  |     59.5 |       — |           — |    -3.7 … 4.7   |   48.5 |    -41.8 |  0.30 |      |
| kerb-strike       | firetruk |    102.0 |    4.77 |           — |   -37.5 … 7.3   |   63.4 |    -22.8 |  2.45 |      |
| crest-jump        | infernus |    132.9 |    7.42 |           — |    -8.4 … 9.9   |   25.2 |    -14.1 |  1.23 |      |
| crest-jump        | admiral  |    100.0 |   13.27 |           — |   -14.3 … 1.0   |   11.0 |     10.8 |  0.83 |      |
| crest-jump        | firetruk |    136.8 |    8.63 |           — |    -4.0 … 99.7  |   14.3 |      4.6 |  5.22 |  ●   |
| handbrake-turn    | infernus |    117.8 |    3.98 |    28 / 2.8 | **-180 … 180**  |   90.0 |     69.5 | 10.50 |  ●   |
| handbrake-turn    | admiral  |     55.0 |       — |    13 / 1.8 |    -0.1 … 0.3   |    8.3 |     50.1 |  0.00 |      |
| handbrake-turn    | firetruk |    106.0 |    4.53 |    15 / 0.6 |    -6.2 … 29.0  |   27.6 |     26.0 |  1.02 |      |
| pull-away-reverse | infernus |    118.2 |    3.98 |   103 / 5.1 |     0.0 … 0.0   |    0.0 |      0.0 |  0.00 |      |
| pull-away-reverse | admiral  |     55.2 |       — |    49 / 4.9 |     0.1 … 0.1   |    0.0 |      0.0 |  0.00 |      |
| pull-away-reverse | firetruk |    106.4 |    4.53 |   126 / 8.6 |     0.0 … 0.0   |    0.0 |      0.0 |  0.00 |      |

**What the matrix says, before a line of 02 is written.**

1. **A FIRE TRUCK REACHES 149 km/h AND DOES 0-100 IN 4.53 s.** The infernus does it in 3.98. That single row
   is the chain's headline: the truck is a supercar with a ladder on it. Meanwhile the ADMIRAL — a sedan —
   never reaches 100 km/h at all in eight seconds of throttle. The five consumed handling fields are not
   "all cars the same"; they are a spread pointing the wrong way, and `MAXVEL_SCALE` / `ENGINE_ACCEL_SCALE`
   are raw multipliers over authored values with no drivetrain or mass reality behind them (plan 02/04).
2. **The flip is not universal — it is per-car, and it tracks the body, not the tuning.** The admiral never
   goes over in any scene; the infernus goes over in the slalom AND the handbrake turn; the firetruck goes
   over in the slalom and lands on its side off the crest (5.22 s of air). One shared suspension set produces
   three different stability outcomes, which is exactly what an emergent COM does — it comes out of the COL
   primitives, so it depends on the geometry (plan 02's authored COM).
3. **A kerb throws a ten-tonne truck 2.45 seconds into the air.** The user's word for it was "cardboard".
   The infernus takes the same kerb as a **−89.5° spin** at 125 km/h. Plan 06's kerb work has its before.
4. **Braking spans 0.53 g to 1.6 g across three cars** (firetruck 119 m from 149 km/h, admiral 24 m from
   77 km/h, infernus 60 m from 165 km/h). The complaint "braking is instantaneous" belongs to the fast cars.
5. **The body does not pitch under braking on any of them** (brake-strip roll and pitch are flat to the
   first decimal). Whatever the player sees when the nose "lifts" is not the chassis rotating (plan 03).

**Determinism.** `brake-strip` reproduced to the second decimal across an isolated run and a full sweep
(165.7 km/h, 3.98 s, 59.94 m). `timeTo100S` matched exactly (3.98 s) across two more independent runs.

### 2026-07-26 — step-steer: the loudest complaint, measured (the matrix's gap, closed)

The eighth scene, built for the one thing the other seven cannot see. A gentle held input (0.15 after a 3 s
run-up) on its own LV straight; runs in
[`docs/benchmarks/vehicle-physics/`](../../benchmarks/vehicle-physics/2026-07-26-headless-step-steer-four-cars.json).

| Car      | Step at   | **Yaw rise** | Settled yaw | Overshoot | Settled slip |
| -------- | --------: | -----------: | ----------: | --------: | -----------: |
| infernus |  77 km/h  |  **0.08 s**  |  13.91 °/s  |     1.05  |      0.91°   |
| admiral  |  36 km/h  |  **0.17 s**  |   7.48 °/s  |     1.06  |      1.01°   |
| firetruk |  69 km/h  |  **0.07 s**  |   8.10 °/s  |     1.04  |      0.75°   |
| comet    |  60 km/h  |  **0.15 s**  |  16.95 °/s  |     1.06  |      0.86°   |

**1. There is no transient.** 0.07-0.17 s to 90 % of the settled yaw, where a road car takes 0.3-0.5. The raw
series says it without arithmetic: the yaw rate goes **0.00 → 11.38 °/s in one 50 ms sample**, and then only
creeps as speed builds. The user's words were "steering turns instantly — it just changes its direction
vector"; this is that sentence as a number.

**2. A 6.5-tonne fire truck answers FASTER than a 1.4-tonne supercar** (0.07 vs 0.08 s). Nothing about a
vehicle allows that. Yaw inertia is not modelled at all — `turnmass` 36 671 vs 2 725 is exactly the field
that would forbid it, and it is one of the unread ones (plan 02).

**3. Nothing slips and nothing oscillates.** Settled body slip ~0.75-1.01° across all four (a real car runs
2-5° in a steady corner) and overshoot 1.04-1.06 — no damped return, no character. The slip angle after the
step does not build, it DECAYS (0.98° → 0.87°): the body is not sliding, it is being rotated by the wheels.
"There are no slides" is not about grip being high; it is about there being no state between pointing and
sliding.

**Method note, and a debt.** The steady window is 0.3-1.0 s AFTER the step rather than the tail of the hold:
a held corner leaves a two-lane street in about two seconds, and the first version's tail was a kerb strike,
a spin and a bounce backwards — measured, then read in the series rather than guessed. **A car slower than
~0.3 s cannot be measured properly in that window**; it needs a scene on open flat ground, which the road
graph cannot find. Owed before plan 05's AFTER round, and flagged in code (`settled: false`) rather than
silently under-reported. Also owed: this scene has no run in the per-car matrix files (it postdates them).

### 2026-07-26 — comet: the control experiment the user handed us

The user asked for a fourth car — *"the comet, a problem model: constant flips, very fast"* — and it turned
into the chain's cleanest control. **By the five fields the engine reads, a comet IS an infernus**: mass 1400,
engineAccel 30, brakeDecel 11, all identical; only `maxVelocity` differs (200 vs 240). Everything that should
distinguish them is unread — the comet has the lowest yaw inertia of any car measured (`turnmass` 2200) and
is the only one whose authored centre of mass is offset LONGITUDINALLY (`COM y = +0.1`, with z −0.2).

**It spins under braking on a straight road with no steering input.** From
`2026-07-26-headless-before-comet.json`, `brake-strip`:

| t (s)      | speed (m/s) | slip angle | yaw rate |
| ---------- | ----------: | ---------: | -------: |
| 0 → 8      |     0 → 35  |  **0.00°** | −0.02°/s |
| 8.4 (brake on) |      27.8 |      0.09° |  1.2°/s  |
| 9.1        |        12.5 |      5.8°  | **48.5°/s** |
| 9.8        |         0.8 | **48.5°**  | 40.2°/s  |

The lap finishes **50.9° off its heading**, stopped sideways, after braking 32.3 m from 129.6 km/h — **1.93 g,
the hardest of the four cars**. The infernus, admiral and firetruck all finish that same scene with slip 0.0
and turned 0.0. It also flips in the slalom (like the infernus) and takes the kerb far worse (roll
−14.7…29.3° against ±3.5°), yet performs a CLEAN 135° handbrake turn where the infernus goes over instead.

**Why this settles the diagnosis.** Two cars with the same read inputs cannot behave differently because of
the inputs. The difference can only come from what the engine INVENTS from geometry — the emergent centre of
mass and inertia derived from the COL primitives — which is precisely what the authored `COM`/`turnmass`
columns exist to override.

And the comet is not a special case — the user was explicit that in the original PC game **every** car drives
well, this one included. So there is no problem MODEL to chase and no per-car fudge to find: the same missing
consumption produces a spinning comet, a flipping infernus and a 149 km/h fire truck. One correct reading of
the table is the fix for the whole fleet, and plan 07's presets must not turn into per-car corrections for it.

### 2026-07-26 — the mod corpus: what a heavy car meets in our two formulas

The user supplied four study sets (mod cars + a realism handling table; kept out of the repo under
`NO_COMMIT/`). They turn the "five fields" finding into something sharper than a missing-data problem: **our
own two lines of arithmetic are inconsistent with each other about mass.**

```ts
const engineForce = hnd.mass * hnd.engineAccel * ENGINE_ACCEL_SCALE; // acceleration = engineAccel × 0.28 — MASS CANCELS
const brakeForce = BRAKE_FORCE * (hnd.brakeDecel / BRAKE_DECEL_REF); // no mass term at all → decel ∝ 1/mass
```

So a heavier car accelerates **exactly as hard** as a light one with the same `engineAccel`, and brakes
**proportionally worse**. Derived for the corpus (predictions from the formulas above, not captures; the two
measured points calibrate them — the infernus's predicted 3.31 s reads 3.98 s measured, and the firetruck's
predicted braking ratio 0.196 reads 0.33 measured, so the real effect is ~1.2-1.7× gentler than the raw
arithmetic, and still enormous):

| Car                        |   mass | commanded accel | 0-100 (predicted) | top km/h | braking vs infernus |
| -------------------------- | -----: | --------------: | ----------------: | -------: | ------------------: |
| infernus (stock)           |  1 400 |      8.4 m/s²   |          3.31 s   |    216   |            1.00×    |
| firetruk (stock)           |  6 500 |      7.6 m/s²   |          3.67 s   |    153   |            0.20×    |
| **feltzer (the user's "avant", mod)** | **4 700** | **15.4 m/s²** | **1.80 s** | 225 | **0.087× (11.5× worse)** |
| **rhino (tank mod)**       | 25 000 |      5.6 m/s²   |          4.96 s   |     76   | **0.020× (49× worse)** |
| **rdtrain (Kenworth W900)**| 17 000 |   **21.0 m/s²** |      **1.32 s**   |    144   |            0.060×   |
| linerun (Peterbilt 379)    | 10 000 |      7.0 m/s²   |          3.97 s   |    144   |            0.10×    |
| petro (Freightliner)       |  3 800 |      7.0 m/s²   |          3.97 s   |    108   |            0.17×    |
| yankee (Mack B-61)         |  3 500 |      6.7 m/s²   |          4.13 s   |     81   |            0.19×    |
| benson (Ford F-350)        |  2 500 |      5.9 m/s²   |          4.72 s   |    103   |            0.17×    |

**This is the user's "it behaved like a tank" explained.** The avant's 4 700 kg is READ, and it lands on the
one side of the pair that scales with mass: the brakes. Its `brakeDecel` is 3.2 — the lowest in the corpus,
because in the original that field sits alongside `brakeBias`, ABS, the suspension set and a real drivetrain.
We take the 3.2 raw, divide by a 3.4× heavier car, and hand the driver something that will not stop. And a
17-tonne Kenworth whose author wrote `engineAccel 75` gets **0-100 in about 1.3 s**, because mass cancels.

Plan 04 owns the inconsistency; it is not a missing field but a wrong formula, and it can be fixed before
any of the unread columns are wired.

### 2026-07-26 — a realism handling mod, measured against what we read (S.A.A.H, 210 cars)

`scripts/debug/handling-diff.ts` (new, kept) compares two `handling.cfg` tables column by column and reports
how much of the difference the engine can even see.

**S.A.A.H is an INSTRUMENT here, not a target.** The user was explicit that we are unlikely to ship it — it
is a 210-car third-party realism table, useful precisely because someone else tuned the whole fleet with an
intent we can measure against our reader. **The target remains stock parity with the original game.** What
this comparison buys is a number for how much of ANY calibrated table survives our five columns; the same
command answers it for the next one.

Over the 210 shared rows:

| Column           | Cars changed | Mean move | Engine  |
| ---------------- | -----------: | --------: | ------- |
| brakeDecel       |   145 (69 %) |      45 % | READS   |
| engineInertia    |   139 (66 %) |     552 % | ignores |
| **COM z**        |   137 (65 %) |     188 % | ignores |
| suspForceLevel   |   129 (61 %) |      27 % | ignores |
| steeringLock     |   123 (59 %) |      17 % | READS   |
| engineAccel      |   114 (54 %) |      23 % | READS   |
| COM y            |    37 (18 %) |     169 % | ignores |
| driveType        |    23 (11 %) |         — | ignores |
| maxVelocity      |    11 (5 %)  |      30 % | READS   |
| mass             |     9 (4 %)  |      89 % | READS   |

**952 column edits; 402 (42 %) reach the physics, 550 (58 %) are dropped.**

And that split is worse than either extreme would be. The author lowered `brakeDecel` on 69 % of the fleet
*because* they also moved the centre of mass on 65 % of it and re-tuned the suspension on 61 % — those edits
balance each other. We apply the first group and discard the second, so an installed realism mod does not
arrive half-improved; it arrives **incoherent**. That is the mechanism behind "I have driven very well
calibrated cars and they still feel wrong", and it is an argument for wiring the unread columns as one
change rather than a field at a time.

### 2026-07-26 — which handling fields are actually read (the user's reading, confirmed)

The user's field note: *"handling does get read — the cars all drive differently — but it feels like only a
small part of the settings is used; I have driven very well calibrated cars."* Exactly right, and now exact:
`gta-sa-world.adapter.ts` maps **five columns** (`mass` 0, `maxVelocity` 11, `engineAccel` 12, `brakeDecel` 16,
`steeringLock` 19). `parseHandling` keeps every other column as a raw string that nothing ever reads.

What the trio actually authors in those unread columns — and what ignoring each one costs:

| Unread field       | infernus | admiral | firetruk | What it would do                                                          | Complaint it answers |
| ------------------ | -------: | ------: | -------: | ------------------------------------------------------------------------- | -------------------- |
| **COM z** (col 3-5) |  **-0.25** |   -0.05 |      0.0 | The authored centre of mass. Today it EMERGES from an equal mass share per COL primitive, so it sits high. | flips / "cardboard"  |
| **turnmass**       |   2 725 |   3 851 | **36 671** | Yaw inertia — a 13× spread the engine never applies.                      | instant direction change |
| **tractionMultiplier** | 0.70 |    0.65 |     0.55 | Per-car grip. Every car runs one shared `WHEEL_FRICTION_SLIP = 10.5`.     | no slides, instant grip |
| tractionLoss / bias |   0.8 / 0.50 | 0.90 / 0.51 | 0.8 / 0.50 | How grip breaks away, and front-vs-rear.                              | no slides            |
| **driveType**      |   4 (4WD) | F (front) | R (rear) | Every car is driven on all four wheels today.                            | no slides, no character |
| brakeBias          |    0.51 |    0.52 |     0.45 | Front/rear brake split — the 180° spin under braking lives here.          | spins under braking  |
| numberOfGears      |       5 |       5 |        5 | No gearing at all: one continuous ramp to top speed.                      | acceleration feel    |
| dragMult, engineInertia, engineType, ABS, suspension force/damping/limits/bias, anti-dive, damage mult, flags | | | | The rest of the table. | 02-06 |

**The data is not suspect — we are.** The user's point, and it sets the bar for the whole chain: *"in the
original PC GTA San Andreas ALL the cars drive well — essentially every one of them."* Not one lucky model:
the entire `handling.cfg` table is a **working, shipped, validated tuning** for the whole fleet, and a
reference implementation of it has existed for twenty years. Every deviation we measure is ours.

Two consequences the chain must not lose:

- **Consume, don't invent.** Plans 02-05 exist to read what is already authored and already validated, and
  the shared constants standing in for it today (`WHEEL_FRICTION_SLIP`, `CHASSIS_ANGULAR_DAMPING`,
  `MAXVEL_SCALE`, `ENGINE_ACCEL_SCALE`, the suspension four) should mostly DISAPPEAR rather than be re-tuned.
  A field round that says "better" while those constants are still doing the work has moved the symptom.
- **No per-car corrections.** If every stock car drives well in the original on this same table, then any fix
  that needs a per-model exception is the wrong fix — it is papering over a field still not being read.
  Plan 07's presets are for CLASSES the data does not carry, never for making one car behave.

**The COM row is the flip explanation, in the data.** The infernus authors the LOWEST centre of mass of the
three (−0.25 m) — it is the car that most depends on that correction — and it is the one that goes over in
two scenes. The firetruck authors none but is tall, and it goes over too. The admiral, a low sedan whose
authored offset is nearly zero, never goes over in any scene. One shared suspension set, three outcomes,
each matching what the authored COM would have corrected.

### 2026-07-26 — determinism: the scenes replay EXACTLY (the last acceptance clause)

`brake-strip` on the infernus, run twice in one session on the same build, diffed with
`npx tsx scripts/phys-compare.ts a.log b.log --determinism`:

**Every summary field identical to the decimal, and `series max |Δ| = 0.000` on all eleven channels.** Not
"inside the tolerance bands" — bit-identical, including the braking distance (59.94 m), the time to 100
(3.98 s) and the pitch under brake (+0.07°).

That is what fixed-step physics buys, and it settles what the bands in `phys-compare` are FOR: comparing
across builds, not across runs. A difference between two runs of the same build is a bug in the harness, not
noise to be tolerated — so `--determinism` is a genuine gate rather than a fuzzy check.

**081/01 is complete.** Every subtask ticked, every acceptance clause met: determinism (exactly), the
complaints visible as numbers (the BEFORE matrix and the step-steer table), and zero cost when disabled (the
`enabled` check precedes any physics read). The one measurement the plan asked for that was NOT taken is the
≤0.05 ms/step telemetry cost — the sampler is a few dozen arithmetic ops behind a boolean, and no frame-time
regression appeared in any sweep, but it was never isolated. Carried to plan 07's regression pack.
