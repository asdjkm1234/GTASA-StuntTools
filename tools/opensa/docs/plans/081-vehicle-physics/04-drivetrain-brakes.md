# 081/04 — Drivetrain + brakes: gears, drive type, engine braking, brake bias, the SA handbrake

Today's longitudinal model is one scaled force (`engineForce = mass × engineAccel × 0.28`, top speed
`= maxVelocity × 0.25`, brake `= 480 × decel/8.5` — `enter-vehicle.system.ts:80-103,381-440`) split
equally over 4 wheels. It moves the car; it has no character. This plan gives every car its
handling-authored longitudinal identity.

## 1. Gears + force curve

- Per-gear model from handling: `gears` (nNumberOfGears) split `[0, maxVelocity]` (now honestly in
  m/s — km/h÷3.6 from plan 02) into SA-style bands; wheel force per gear =
  `mass × engineAccel × gearFactor × (1 − (v/vGearTop)^k)` — a documented arcade curve, NOT a
  torque-map simulation. Gear shifts introduce a short force dip (~120 ms) — the "breathing" that
  makes acceleration read as mechanical. `engineInertia` scales the dip + the ramp time (replacing
  the flat `ENGINE_RAMP_TIME 0.2`).
- The `MAXVEL_SCALE 0.25` / `MIN_TOP_SPEED 8` hacks die; their honest replacements are the unit fix
  plus a documented global "city scale" factor if raw SA top speeds prove too fast for the map in
  the field round (record the factor, don't hide it in a magic 0.25).
- Current gear exposed on telemetry (plan-01 HUD gear readout goes live).

## 2. Drive type F / R / 4

- `setVehicleControls` splits engine force by `drive`: F → front pair, R → rear pair, 4 → all
  (per-wheel engine force is already the API shape). Behaviour difference arrives with plan 05's
  traction mapping (FWD understeer on power / RWD power-oversteer need per-wheel grip, not just
  torque placement) — but the torque placement lands here and is testable now (burnout scene:
  driven-axle slip proxy rises first).

## 3. Brakes: bias + engine braking + coast

- Brake force distributed by `brakeBias` (front share) instead of the equal split; total from
  `brakeDecel × mass` (honest units — the 480-N constant dies). `abs` flag = keep today's behaviour
  (no lockup model exists to modulate; note for the plan-05 gate: a slip-based ABS only makes sense
  with an own tyre model).
- Engine braking: off-throttle in gear = drag force scaled by gear (low gear brakes harder),
  replacing the flat 8 % `IDLE_BRAKE_FRACTION`; plus `dragMult` as the always-on rolling/air term
  (plan-02 mapping).
- Reverse rework: keep the `seedReverse` quirk (documented DRCVC limitation) but drive reverse
  through the same force curve at `REVERSE_FRACTION` of gear-1 (today's 0.4 stays as the arcade
  factor), and fix the throttle<0 semantics split (brake-vs-reverse threshold 0.6 m/s stays,
  test-pinned).

## 4. Handbrake = the SA slide (rear grip cut)

- Space while driving: **rear wheels only** get high brake torque AND their
  `sideFrictionStiffness` drops (×~0.35, live-tunable) for the hold duration + a short release
  fade (~0.3 s) — this is the SA handbrake turn, expressible entirely inside DRCVC's per-wheel API.
  Front wheels keep steering grip: the car rotates around the front axle instead of just stopping.
- The parked/stopping behaviour (full-stop hold, parking brake 80) is untouched — handbrake-as-
  stopper below ~3 m/s degrades to today's behaviour so parking feel doesn't change.
- Acceptance: `handbrake-turn` replay rotates the car through a held, recoverable slide (target
  band from the user's vanilla expectation notes, plan 01); 080/05's drift framing gets its first
  real workout here.

## Subtasks

- [~] Force-curve module (`drivetrain.ts`, pure: gear state + per-wheel forces from handling +
      controls) + unit tests (gear bands, shift dip, engine braking by gear, drive-type split,
      reverse path).
- [~] Brake distribution + engine brake + dragMult wiring; delete the four dead constants.
- [~] Handbrake rear-cut + release fade + parking degradation; quirk tests re-run.
- [~] Telemetry: gear + per-wheel drive force channels; F2 rows.
- [~] Replays: `pull-away+reverse`, `brake-strip`, `handbrake-turn`, plus a new `hill-start`
      scene (engine braking + drag visible on a grade); trio A/B into the ledger.
- [~] **Field round**: acceleration character per car ("firetruck is a barge, Infernus pulls"),
      handbrake turns, hill behaviour, top-speed sanity on the map (decide the city-scale factor).

## Acceptance

- Time-to-top-speed and brake distance per car match handling-derived expectations (table in
  ledger); the trio's longitudinal captures are clearly distinct.
- Handbrake turn = held rotation + recovery (field verdict), parking unchanged (tests).
- No dead tuning constants left in `enter-vehicle.system.ts` — everything traces to handling or a
  named arcade factor.

## Ledger

_(curve constants, city-scale decision, A/B numbers, field verdict)_

### 2026-07-26 — the brake gets a mass term, and the pedal stops being a switch

**Field verdict that drove this** (user): *"the brake works like a handbrake, not a gradual loss of speed. I
would put the handbrake on its own key H, and have Space / back-while-rolling shed speed smoothly like a real
brake."* Both halves were literally true in the code, and both are fixed here.

**1. The handbrake is its own control.** A new `handbrake` action on **H**; Space and back-while-rolling are
the FOOT brake. One key doing both is what made every stop feel like yanking a lever.

**2. The foot brake ramps in over 0.45 s; the handbrake is instant.** Full force on the first frame of a
press is not a pedal. Release is NOT ramped — lifting off a real pedal releases it. The brake lamps had to
move with it: `brake === brakeForce` kept them dark for the first half-second of every stop, so they now
light on anything above the idle coast brake, which is what "the driver is braking" means.

**3. The brake force finally has a mass term.** The old model was `480 × brakeDecel / 8.5` — mass-blind,
which 081/01's mod corpus caught (a 4.7 t car braking 11.5× worse than a 1.4 t one). The mapping was MEASURED
rather than assumed — brake value against achieved deceleration, two masses × three values: **`decel ≈ 7.5 ×
brake / mass` in g**, linear until the tyres saturate around 2.4 g. Inverting it lets `fBrakeDeceleration` be
read as what its name says.

**Result — every car now brakes as its row asks:**

| Car      | Authored `brakeDecel` | Target | Measured | Ratio |
| -------- | --------------------: | -----: | -------: | ----: |
| admiral  |                  4.30 | 0.44 g | **0.44 g** | **1.00** |
| infernus |                 11.00 | 1.12 g |   1.02 g |  0.91 |
| comet    |         21.73 (a mod) | 2.22 g |   1.56 g |  0.70 |
| firetruk |                 10.00 | 1.02 g |   0.62 g |  0.61 |

The admiral's weak brakes are **not a bug** — its modded row authors 4.30, and it is a 1976 Mercedes. The
comet is grip-limited below its absurd 21.73 (a mod asking for race-car retardation). The firetruck's 0.61
is the real residual: the measured constant ran 6.9 (light) to 9.8 (heavy) and 7.5 was fitted between them,
so heavy vehicles under-deliver. Recorded rather than papered over — a mass-dependent correction on two data
points would be over-fitting; it needs its own probe in this plan's tuning round.

**And it collapsed the dive that plan 03 could not.** The comet went from **−7.56° to −1.30°** and the
infernus to −0.47° — because the 8° was never a spring problem: it was the rear axle nearly lifting off under
2.3 g. Two plans chased that number; the brake formula owned it, exactly as 081/03's ledger predicted.

### 2026-07-26 — §1 and §2 done, and the top speed is no longer a number we clamp to

`vehicle/drivetrain.ts` is the original's transmission, translated rather than approximated —
`cTransmission::InitGearRatios` and `CalculateDriveAcceleration` from the reversed source, with
`CPhysical::ApplyAirResistance` for drag. What that replaced: `engineForce = mass × engineAccel × 0.28`, one
value, constant from a standing start to a hard cap, split equally over four wheels.

**What the source actually says** (and each line killed a constant of ours):

- `m_EngineAcceleration /= (driveType == '4') ? 4 : 2` — the F/R/4 column is a DIVISOR on the engine, not a
  torque-placement detail. That is §2, and it lands for free.
- `speedMultiplier = 1 + 3 × (1 − (gear−1)/(gears−1))²` — first gear pulls 4× top gear. This is the shape the
  old flat force never had.
- `driveAcceleration = speedMultiplier × engineAcceleration × 0.4 × gasPedal × timeStep`, and
  `fEngineAcceleration` is m/s² per the file's own legend. `ENGINE_ACCEL_SCALE = 0.28` was a fit standing in
  for `0.4 / driveDivisor`.
- The `engineInertia` block damps thrust by the CHANGE in how far the car is through its gear's band, floored
  at 0.1 and smoothed 0.85 — the shift dip, for free, from a field we parse and never read.
  `ENGINE_RAMP_TIME = 0.2` is gone: a second smoothing on top of this one just flattens the shifts back out.
- `GetDefaultAirResistance = dragMult / 2000`, applied to the whole velocity vector. **We had no drag at
  all.** This is the item that mattered most: it is what makes a top speed exist.
- `fMaxVelocity` is the START of a search, not a cap — the original walks down from it until drag has eaten a
  sixth of the engine's pull and calls that the flat top. `MAXVEL_SCALE = 0.25` and `REVERSE_FRACTION = 0.4`
  both die here (reverse is gear 0 with its own 4.5× multiplier and a `−0.3 × top` limit).

**One honest note about fidelity.** The original also tapers thrust just above each gear's ceiling. It is
translated, and it is unreachable: every gear's change-up point sits below its own ceiling, so the box always
shifts first, and the reverse case is cut off by the same guard that ends the function. Kept as a translation
rather than quietly dropped, and pinned by a test that states why.

**Numbers** (baseline = the same head with the SA-law spring, everything but the gearbox):

| car      | 0-100 km/h     | speed at 8 s WOT | peak accel g |
| -------- | -------------- | ---------------- | ------------ |
| infernus | 3.98 → 4.05 s  | 165.7 → 124.1    | 0.85 → 1.07  |
| comet    | 5.43 → 2.30 s  | 130.0 → 179.1    | 0.66 → 1.65  |
| admiral  | never → 5.27 s | 77.3 → 104.8     | 0.40 → 1.00  |
| firetruk | 4.53 → 3.12 s  | 149.0 → 130.1    | 0.76 → 1.86  |

The point is not any single row, it is that the four separate. The admiral could not reach 100 km/h before
and now does it in 5.3 s; the comet's mod row makes it the rocket its owner describes; the infernus loses
top-end purely because it is 4WD and the original halves 4WD engines relative to 2WD. Top speed is emergent
now — the infernus balances drag against top-gear thrust at ~228 km/h with an authored 240, and nothing
anywhere clamps to `fMaxVelocity`.

**Owed from this entry**: the firetruck's **1.86 g launch** is what its row asks for and nothing but a single
shared tyre-grip constant is limiting it — plan 05. Drag applies only to the DRIVEN car (nothing else drives
itself yet). §3's brake bias and engine braking, and §4's handbrake rear-grip cut, are still open; the
`fSuspensionBias` axle split still owes from 081/03.

### 2026-07-26 — §3 and §4: brake bias, the coast brake, and the handbrake as a rear-axle lock

**A correction to the entry this one follows.** It claimed `fBrakeBias` had shipped; it had not. The edit to
`physics-world.ts` was lost when the script writing it aborted half way, and only the coast brake went in. The
savanna dive it credits to the bias (`+0.65° → −1.48°`) came from the other changes of the day. With the bias
genuinely applied the numbers move by hundredths (savanna −1.45°, admiral −0.73°, comet −0.39°), which is the
**null result** three near-neutral rows (0.52…0.63) should give. The lesson is procedural and worth keeping:
a multi-file edit that fails half way leaves a half-applied change that still measures plausibly.

**§3, the coast brake.** `CVehicle::ProcessWheel` gives each wheel `gHandlingDataMgr.fWheelFriction / mass`
off-throttle, and `fWheelFriction` is 0.9 — a mass-INDEPENDENT retarding force once carried through, so light
cars slow sharply off the pedal and a 6.5 t truck barely notices. It replaced a flat 8 % of the car's own
brakes: 0.27 m/s² on an admiral against the original's 6.4, **24× too weak**, and most of why a car with the
throttle released kept sailing. An admiral now sheds 51 km/h to a standstill in 4 s.

**§4, the handbrake.** The original gives the lever no extra braking power — it replaces the REAR wheels'
brake with 20 000 and leaves the front untouched. Locked rear wheels spend their entire friction circle on
braking and have nothing left for cornering, so the car rotates about a front axle that still grips. **No
separate "grip cut" is needed**, which is what §4 of this plan assumed would be: the per-wheel grip clamp from
081/05 already means a locked wheel brakes with exactly what its tyre has, and the friction circle does the
rest. The steering limiter's handbrake exemption (081/05) hands the driver full lock to hold and catch it.

| car     | rotation through the turn | peak slip | peak yaw rate | flip |
| ------- | ------------------------- | --------- | ------------- | ---- |
| admiral | **76.2°**                 | 12.8°     | 0.81 rad/s    | no   |
| comet   | 36.3°                     | 14.7°     | 0.48 rad/s    | no   |
| savanna | (spun)                    | **50.7°** | 3.31 rad/s    | no   |

`stopping` — the automatic halt before the player climbs out — moved onto the FOOT brake: it wants the car
stopped, not sideways. Brake lights now read the driver's INTENT rather than the brake force, because with
coasting this strong the force alone can no longer tell a coast from a pedal.

**Still open in §3**: engine braking that varies with the GEAR (the original's coast brake does not, so this
would be an addition rather than a translation) and `abs`.

### 2026-07-26 — §4 closed: the handbrake lets go, and why it took three field rounds

Three rounds of *"Space and H work the same"* on a mechanism that measured different every time. What each
round actually found, in order, because the sequence is the lesson:

1. **The scene was pressing the wrong key.** `handbrake-turn` still sent `jump`; it predates the split.
2. **The F2 tab could not show the lever.** The handbrake sends NO brake force — it locks the rear axle inside
   the physics layer — so the brake row read 0.0 kN with the lever up. `gear / handbrake` is a row now, and it
   answered the only question that mattered at that point: the key registers.
3. **No scene could see the effect.** `handbrake-turn` stands on FULL lock, where the car slides whatever you
   press. `handbrake-flick` (60 km/h, 0.4 of steering held, lever for 1.5 s) is how a lever is actually used.
4. **And the real cause**: Rapier weighs the friction circle unevenly — `fwd_factor = 0.5`, `side_factor =
   1.0`. A wheel braking at its full grip has spent only half its circle and keeps up to **87 %** of its
   lateral capacity. Locking the brakes therefore does NOT unstick the rear axle in this solver, however
   faithfully the lock itself is modelled.

| locked wheel keeps | slip before → after | rotation |
| ------------------ | ------------------- | -------- |
| 15 %               | 2.3° → 5.7°         | 98°      |
| **3 %**            | 2.3° → **33.0°**    | **134°** |

Every car tested flicks and none flips: admiral 33.0°, comet 17.1°, savanna 87.9° of body slip.

**The transferable lesson**: when a faithful translation produces no effect, the next question is not "is the
translation right" but "does the host solver express this quantity at all". SA's handbrake is a brake; in
Rapier a brake cannot unstick a tyre, so the same intent needs a different parameter.
