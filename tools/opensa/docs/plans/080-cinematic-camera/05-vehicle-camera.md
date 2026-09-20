# 080/05 — Vehicle camera (behaviours 5, 10) + enter/exit blends

Where the cinematic feel pays off most — and where all the data is already reachable but unused:
signed speed (`physics.vehicleSpeed`), full velocity (`getLinvel`), heading from the body quat
(`enter-vehicle.system.ts:470`). Today the vehicle camera is just the on-foot stick with the focus
swapped to the car (`engine-canvas-host.tsx:849`) plus a one-shot `aimCamera` yaw on entry.

## 1. Mode + snapshot

- `mode: 'vehicle'` when `vehicles.activeVehicle()` (seated) — the host already computes this for
  focus; the snapshot gains `vehicle: { speed, velocityDir, heading }` (signed forward speed u/s;
  planar velocity direction; car yaw in engine space). Climb-in/out (`ridingVehicle` without
  `activeVehicle`) stays in `foot` mode — the blend (§5) covers the visual transition.
- Vehicle mode RETUNES the shared channels (its own lambda/lag set from config) and adds writers;
  it does not fork the rig. One rig, two tuning tables — transitions are then just tuning blends.

## 2. Speed → distance + FOV (#5)

- `distanceTarget = followDistance + vehicleDistanceGain × smoothstep(0, vSpeedRef, |speed|)`,
  capped at `vehicleDistanceMax` (first guess: +2.0 m at ~40 u/s over a 6.5 m base). Through the
  02 distance damp — braking hard visibly lets the camera glide back in (#5's second half).
- `fovTarget = baseFov + vehicleFovKick × smoothstep(vFovLo, vFovHi, |speed|)` (first guess: up to
  +10° approaching top speed), damped with its own slower lambda — FOV pumping on throttle
  blips is the classic mistake; the damp plus the smoothstep dead-band below ~8 u/s prevents it.
  FOV is free per-frame (projection rebuilt in `Engine.frame`, readme constraint 2).
- Reverse uses |speed| for both; distance gain slightly lower (tunable).

## 3. Turn lag + drift framing (#10)

- **Yaw follows the car with mass**: the yaw target is the car's REAR direction; it is chased via
  `smoothDampAngle` with `vehicleYawLagTime` (~0.35 s first guess) — entering a corner the camera
  visibly hangs outside the turn, then swings through. This is the single biggest "GTA in a car"
  ingredient. Manual look still overrides (036 rule) with a shorter re-engage grace than on foot
  (~1.5 s) since hands-off is the norm while driving.
- **Drift framing**: slip = wrapped angle between `velocityDir` and car heading, dead-banded ~8°
  and only above ~10 u/s. The effective yaw target becomes
  `heading + driftLookBlend × slip` (`driftLookBlend` ~0.5): in a slide the camera looks partway
  along the actual travel direction — the player reads the trajectory, exactly the requested
  behaviour. Below the dead-band, zero contribution (straight driving is unaffected).
- **Pitch**: vehicle mode holds a slightly lower default polar and damps the look-point height a
  bit faster than on foot (suspension bounce must not pump the horizon — the vertical-softness
  channel from 02 does this with a vehicle lambda).

## 4. Collision variant

Same 04 layer; vehicle tuning widens the whisker angle (higher closing speeds) and raises
`collisionReleaseTime` slightly. Budget stays ≤ 5 casts/frame. Seated car body excluded from casts.

## 5. Enter/exit blends

- On seat (the moment `aimCamera` fires today): instead of snapping yaw, seed the vehicle yaw
  target and let the `smoothDampAngle` channel carry the camera behind the car (~0.6 s swing).
  Distance/FOV likewise re-target through their damps. `aimCamera`'s snap semantics remain only
  for teleport-grade cases (respawn in car).
- On exit: mode flips to foot tuning; channels keep their state — no cut, the camera just relaxes
  to on-foot framing. A test scripts seat→drive→exit and asserts continuity (no state reset).

## 6. Look-behind (polish, small)

Hold-key (default `KeyC`-class, config in `controls`): yaw target flips to car FRONT direction
through a fast damp; release swings back. Pure writer on the existing channel — cheap, high value
for gameplay. Ships last, behind the field round.

## Subtasks

- [x] Snapshot: vehicle speed/slip assembly in the host (from 081/01's shared `planarMotion`).
- [x] `vehicle-camera.ts`: distance/FOV curves + drift blend + the vehicle tuning table;
      unit tests with scripted drive traces (slip dead-band + its fade-in; FOV dead-band; reverse;
      settle-behind-travel in a slide).
- [x] Enter/exit blend + continuity test; `aimCamera` was ALREADY demoted (plan 02 routed it through
      the damped `steerYaw`, so entry has swung rather than snapped since then).
- [x] Vehicle tuning table in `CameraConfig` + Camera-tab rows (13 new sliders).
- [x] Look-behind key (§6 — this plan's own order: it ships after the field round; SHIPPED 2026-07-27
      after 09's rounds closed, see the ledger).
- [x] Field round 1: the seated distance halved, the speed ramp raised to carry it back — ACCEPTED.
- [~] **Field round** (drive-heavy): city corners at speed, handbrake drifts, highway top speed,
      tunnel (collision + FOV together), enter/exit repeatedly. The bench-road-cars scenes give a
      dense traffic backdrop. Freeze the two tuning tables in the ledger.

## Acceptance

- Corner-entry lag reads as weight, never as losing the car; drift shows travel direction.
- Speed changes move distance/FOV smoothly, no pumping on gear-shift-scale speed noise.
- Enter/exit shows zero camera cuts. Tests green; budgets hold.

## Ledger

### 2026-07-25 — code complete, AWAITING THE DRIVE FIELD ROUND

**The shape: one rig, two tuning tables.** `vehicleTuning(config)` returns the authored config with the
driving numbers substituted (`yawLagTime` → `vehicleYawLagTime`, `recenterDelaySec`, `verticalLagTime`,
`collisionReleaseTime`); `stepCamera` picks the table by mode and every channel below reads it without
knowing which one it got. Nothing branches on the mode except the two writers driving genuinely adds. That
is what makes a transition cheap — and it is the same rule plan 08's presets stand on, so 08 inherits a
working example instead of inventing one. A FRESH table per step is deliberate: the debugger mutates
`config.camera` live, so a cached one would freeze whatever the tab held when the player got in.

**What landed**

- `vehicle-camera.ts` (pure): `vehicleDistanceForSpeed` (size-based distance + `vehicleDistanceGain`
  smoothstepped to `vehicleDistanceSpeed`), `vehicleFovTarget` (base lens + `vehicleFovKick` between
  `vehicleFovMinSpeed` and `vehicleFovMaxSpeed`), `driftHeading` and `vehicleTuning`.
- Director: a live `fov` channel on the rig state (damped by `vehicleFovLambda`, target = the base lens on
  foot, so leaving a car EASES the widening out instead of cutting it) — `resolveCamera` now draws with
  `state.fov`, and cursor picking already unprojects through the rendered FOV, so the viewer follows it.
- **Drift framing is expressed as a HEADING, not as a second yaw writer**: `driftHeading` leans the heading
  fed to auto-center from the car's nose toward its travel by `driftLookBlend × slip`. Every existing rule —
  the swing, the settle epsilon, the manual override, the grace window — then applies to it unchanged, and
  there is no new channel to reconcile with the old ones.
- Host snapshot gains `vehicle: { slipAngle, speed }` from **081/01's `planarMotion`** off the physics body.
  Deriving it from the focus delta would measure the render loop, and a slide leaves no trace there at all.
- 13 new `CameraConfig` fields, all on the Camera tab (`CAR DIST GAIN` … `DRIFT FROM SPEED`).

**First-guess defaults (the drive round tunes them)**

| field                         | value    | why this number                                                          |
| ----------------------------- | -------- | ------------------------------------------------------------------------ |
| `vehicleDistanceGain`         | 2 m      | The plan's own first guess: +2 m over the size-based distance at speed.  |
| `vehicleDistanceSpeed`        | 40 u/s   | Roughly a fast car's cruise — the gain is full there, not at the limit.  |
| `vehicleFovKick`              | 0.175 rad| ~10°, the plan's guess. The classic overshoot is 20°+.                    |
| `vehicleFovMinSpeed` / `Max`  | 8 / 45   | The dead-band is what stops throttle blips from pumping the lens.        |
| `vehicleFovLambda`            | 2.5 /s   | ~0.28 s half-life — deliberately slower than the zoom channel's 8.       |
| `vehicleYawLagTime`           | 0.35 s   | 1.4× the on-foot swing: the corner-entry hang, without losing the car.   |
| `vehicleRecenterDelaySec`     | 1.5 s    | Shorter than on foot's 2 s — hands-off is the norm while driving.        |
| `vehicleVerticalLagTime`      | 0.15 s   | Roughly half the on-foot 0.28: suspension bounce must not pump the horizon. |
| `vehicleCollisionReleaseTime` | 0.6 s    | 1.5× the on-foot release — a car clears an occluder fast enough that the on-foot ease reads as a snap. |
| `driftLookBlend`              | 0.5      | The plan's guess: look HALF-way along the slide, never all the way.      |
| `driftSlipDeadZone`           | 0.14 rad | ~8°, the plan's guess — straight driving carries a small permanent slip. |
| `driftMinSpeed`               | 10 u/s   | Below it a slip angle is a parking manoeuvre, not a slide.               |

**Deliberate deviation from §4.** The plan asked for a WIDER whisker angle in the vehicle table. It is not
there: the 04 field round set `collisionWhiskerAngle` to **0** because the ±15° flanking casts fired on
poles and walls BESIDE the car and pulled the camera in for nothing. Re-widening it here would reintroduce a
behaviour the field already rejected, so the vehicle table changes only the release time; a whisker row is
one line away if the drive round asks for it.

**Measured** (`docs/benchmarks/opensa-engine/2026-07-25-headless-080-camera-director.json`, microbench row
080/05): `stepCamera` **0.545 µs mean / 0.570 µs p95 in vehicle mode**, against a **0.385 / 0.410 foot
control measured in the same run** — +0.16 µs (+42%), of which the per-step tuning-table spread is
0.061 µs. Absolute 0.0005 ms/frame, ~100× under this plan's 0.05 ms budget. That foot control is NOT the
0.203 µs row 03 recorded: this trace differs (it holds turn-follow armed every step) and pre-builds its
snapshots, which is exactly why the foot control was measured alongside instead of comparing across rows.
Camera suite 136 green (+27), full apps/web + packages/game 738 green; `tsc` + eslint clean.

### 2026-07-25 — DRIVE FIELD ROUND 1: the seated distance halved, the speed ramp carries it back

User's verdict after driving: the camera reads right overall, but **it sits too far from the car the moment
you get in — about half that, and let speed open it back out to roughly what it does now.**

That is exactly the split the two knobs were built for, so the fix is tuning, not code: the REST distance is
`vehicleDistanceScale` and the speed ramp is `vehicleDistanceGain`.

| field                  | was | now | effect on a ~4.4 m car                                    |
| ---------------------- | --- | --- | ---------------------------------------------------------- |
| `vehicleDistanceScale` | 2   | 1   | at rest 8.8 → **4.4 m** (one car length behind, half of it) |
| `vehicleDistanceGain`  | 2   | 5   | at 40 u/s 10.8 → **9.4 m** — about where the old rest framing sat |

So the framing now STARTS close and the speed ramp is what earns the old distance back, instead of starting
far and barely moving. The reference speed stays 40 u/s and the glide is the same zoom damp, so braking pulls
it back in over ~90 ms. A bus still frames further out than a hatchback — the base is a car LENGTH either way,
just one of them instead of two.

Test note: the seat→drive→exit continuity case asserted an absolute per-step distance change (< 0.5 m), which
was really a statement about the old gap. It now asserts the honest property — one step may close at most a
QUARTER of the way to the on-foot target — so a future retune cannot break it for the wrong reason.

**Field round 1 ACCEPTED (same day).** User re-drove it: the closer entry framing with the speed ramp
earning the distance back reads right. `vehicleDistanceScale` 1 and `vehicleDistanceGain` 5 are FROZEN as
shipped, along with everything the round did not object to.

**Owed**: the rest of the DRIVE field round (city corners at speed, handbrake drifts, highway top speed, a tunnel for
collision+FOV together, repeated enter/exit) — every default above is a first guess until the user drives
it. The look-behind key (§6) ships after that round, per this plan's own order.

### 2026-07-27 — REVISION: the physics moved under the frozen defaults; measured, no code owed

This plan closed against a physics that "barely slides at all" (06 round 1's own words — the drift gates
were CUT to compensate: dead zone 0.14 → 0.05 rad, `driftMinSpeed` 10 → 6). Since then 081 changed the slip
channel three times: the SLIDE_SPEED 50× unit-bug fix (the steering limiter works in corners again), 081/09's
lateral speed-grip assist (suppresses slides at speed), and 081/10's per-surface grip (grass/dirt slide
more). The revision measured what the drift channel NOW sees instead of guessing — three infernus laps,
slip stats against the gates, in
`docs/benchmarks/vehicle-physics/readme.md` § "camera slip survey" (run
`2026-07-27-headless-camera-slip-survey-infernus.json`):

- **Wiring verified end-to-end**: the camera's `vehicle.slipAngle` is the same `planarMotion` number the
  capture's `slipAngle` column records, radians, unit for unit — the laps are direct readings of the
  camera's input. No sign or unit drift; no code change needed.
- **The channel is alive in its intended domain and quiet outside it**: hard manoeuvring (u-turn) engages
  the lean fully (slip 0.16–0.29 rad → up to ~8° of lean); grass sits in the fade-in band (~0–1.7°); held
  cornering at speed stays inside the dead zone (median 0.011 rad) with only breakaway spikes, which the
  0.35 s yaw damp filters.
- **What this means for the owed drive round**: `driftLookBlend`/`driftSlipDeadZone` are now judgeable as
  TUNING (round 06/1 could not see the channel at all, so its defaults were unfalsifiable). The round's
  question is no longer "where is the lean" but "is 0.5 of the slip the right amount in a hard corner".
- 06's landing dip stays SHIPPED OFF — 081/06's air control changed jump attitude and airtime, but the
  reason the dip shipped off (a 20 cm dip is invisible at a 7 m third-person orbit) is viewpoint, not
  physics; its return remains plan 08's first-person preset.
- New since the freeze, for the round to watch: mid-air yaw is now player-controllable (081/06 §1
  `?airCtl`), and the camera swings with it through `vehicleYawLagTime` — jumps are a NEW judgement the
  original round list did not have.

### 2026-07-27 — §6 look-behind SHIPPED (after 09's field rounds closed, per this plan's own order)

Hold **C** (config `controls.lookBehind`; unbound = off) while driving: the yaw target flips to the car's
FRONT — the camera sits ahead, looking back over it — through `lookBehindLagTime` (0.15 s, config; a
mirror check is a glance, so it is deliberately quicker than `vehicleYawLagTime`). Release swings back
BEHIND through the same fast lag, fired EXPLICITLY on the falling edge, because a standing car has no
auto-center chase to bring the camera home. Exactly the planned shape: a pure writer on the existing
steered-yaw channel (the channel gained a one-swing `yawLagOverride`, cleared with the target), re-asserted
every frame so the mouse cannot wrestle the hold. On foot and in fly the key does nothing. **C is chosen
over the plan's original "KeyC-class" hedge because GTA V uses C for exactly this; plan 08's view presets
take V (SA's own camera key) when they come.** Pinned: foot no-op, mouse-wrestle, both swing directions at
rest, and the fast-lag property.

**FIELD-ACCEPTED same day** — the user drove it and confirmed it works exactly as intended (paraphrased:
"everything works great"); `lookBehindLagTime` 0.15 ships as authored. §6 is closed. The drive-heavy field
round above remains this plan's one open item.
