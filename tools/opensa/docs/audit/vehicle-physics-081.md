# Audit — vehicle driving physics (plan 081/01–05), 2026-07-26

The chain that turned `handling.cfg` from a file we parsed into the file the cars are driven by. Five
sub-plans, seven field rounds in one day, every change measured on the same replays.

Raw numbers: [`../benchmarks/vehicle-physics/`](../benchmarks/vehicle-physics/) (schema + full chronology).
Per-decision reasoning: each sub-plan's ledger in [`../plans/081-vehicle-physics/`](../plans/081-vehicle-physics/).

## What changed

`handling.cfg` had **5 of ~40 fields** consumed. It now has **21**, and every one of them arrived as a
translation of the original's own code rather than as a fitted curve:

| Field(s)                                     | What now reads them                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `CentreOfMass`, `fTurnMass`                   | body mass properties, and the static load each corner carries             |
| `fSuspensionForceLevel/Bias/UpperLimit/LowerLimit/DampingLevel` | the spring, per axle, by SA's own law                    |
| `nNumberOfGears`, `fMaxVelocity`, `fEngineAcceleration`, `fEngineInertia`, `nDriveType` | the gearbox      |
| `fDragMult`                                   | air drag — and therefore the top speed, which is now emergent             |
| `fBrakeDeceleration`, `fBrakeBias`            | the foot brake, split across the axles                                    |
| `fTractionMultiplier/Bias/Loss`               | tyre grip per wheel, per axle, and what a sliding tyre keeps of it        |
| `fSteeringLock`                               | the steering limiter, against the tyres rather than a tuned falloff       |

Six global constants died: `ENGINE_ACCEL_SCALE`, `MAXVEL_SCALE`, `REVERSE_FRACTION`, `ENGINE_RAMP_TIME`,
`STEER_LOCK_SCALE`, `STEER_SPEED_FALLOFF`. Two more were replaced by their measured or authored originals
(`WHEEL_FRICTION_SLIP 10.5` → `fTractionMultiplier`; `CHASSIS_ANGULAR_DAMPING 2` → SA's own 0.5).

Three new modules, all pure and unit-tested: `vehicle/drivetrain.ts` (`cTransmission`, line for line),
`vehicle/steering.ts` (the original's speed-sensitive lock limiter), and the `stance` block in the capture
protocol (what a car is standing on).

## What it cost

- **Tests**: 2 810 → 2 819 green, no suite slower.
- **Runtime**: no new per-frame allocation on the driving path; the drivetrain is arithmetic on ~10 numbers
  per step, the grip clamp four reads and four writes per car, both inside the existing fixed step. The
  per-step budget the plan set (≤ 0.5 ms for 8 live cars) is **not yet isolated** — owed at plan 07.
- **Code**: `enter-vehicle.system.ts` grew a drivetrain state and lost three branches; the rest landed in the
  two new modules and in `setVehicleControls`, which is now the one place where per-wheel forces are decided.

## What it bought, in numbers

| Behaviour                              | Before        | After                            |
| -------------------------------------- | ------------- | -------------------------------- |
| Admiral launch (a 1976 sedan)          | 1.00 g        | **0.37 g**                       |
| Firetruck launch                       | 1.86 g        | 0.35 g                           |
| Cars separating at all (0–100 km/h)    | 3.9…5.4 s     | 2.3 s … never (per car's row)    |
| Top speed                              | clamped       | **emergent** (infernus ~228 of an authored 240 km/h) |
| Braking                                | up to 2.4 g   | 0.58…1.14 g, grip-limited        |
| Coasting off-throttle                  | 0.27 m/s²     | ~6 m/s² (the original's own)     |
| Romero rake (a rear-heavy hearse)      | **+1.67°**    | +0.09°                           |
| Cornering yaw (u-turn, admiral)        | 36.9° round   | 49.2° round                      |
| Handbrake flick (admiral body slip)    | n/a           | 2.3° → **33.0°**                 |

## The five bugs the field found, and what they had in common

Every one was **a number this engine had guessed where the game ships the answer**:

1. `WHEEL_FRICTION_SLIP = 10.5` — Bullet's demo default, a tyre fifteen times grippier than a tyre.
2. `ROAD_ADHESION = 1` — `data/surface.dat` says 4.5 for rubber on road, so cars had 4.5× too little steering.
3. `sag = 2 / stiffness` — assumed every corner carries a quarter of the car; a hearse's rear carries 71 %.
4. `CHASSIS_ANGULAR_DAMPING = 2` — left 14 % of a car's yaw after a second; three field rounds blamed grip.
5. The handbrake's rear lock, faithful to the original and inert — because Rapier's friction circle weighs
   braking at half and cornering at full, so a locked wheel keeps 87 % of its lateral bite.

The first four are the same mistake. The fifth is a different one and the more interesting: **a faithful
translation can be inert if the host solver does not express the quantity it relies on.**

## What the chain owes

- **06 kerb probe** — the comet flips on kerbs since the damping band-aid came off (20.6° of roll → 179°).
  A raycast wheel cannot see a vertical kerb face until its centre crosses the edge. Do NOT re-raise the
  damping instead: that trades the whole fleet's cornering for one car's kerb.
- **06 visible suspension** — the wheels still do not move in their arches.
- **07** — the per-step cost measurement, the regression pack, and the class presets.
- Read `surface.dat`/`surfinfo.dat` instead of carrying 4.5; `abs`; gear-dependent engine braking; the
  firetruck's brake residual; the sag-per-rate constant (a measured bridge, ±7 %).

## Addendum — the 2026-07-27 post-close-out audit (field: "heavy turn-in at speed; the turismo is slammed")

One day after close-out the user reported exactly the two complaints above, and an audit against the
reversed source (fetched fresh: `ProcessCarWheelPair`, `ProcessWheel`, `SetupSuspensionLines`,
`ProcessSuspension`, `ApplySpringCollision`, `ConvertDataToGameUnits`, `SurfaceInfos_c`) found both real.
Both fixes shipped in one revertable commit; the numbers below are the derivations, the field verdict is
pending.

**1. `fTractionMultiplier` is not an earth μ — grip was ~2.3× below the original's own budget.** SA's tyre
limit is a per-wheel Δv budget: `4.5 (road×rubber) × TM × 0.001 × loadFactor`, where the load factor closes
to `4 × the weight share the wheel carries` (the static deflection `share/(forceLevel × axleBias)` cancels
its own forceLevel), capped at 2. In SI that is `μ_eff ≈ 4.59 × TM` per unit load against our 9.81 — ~3.2
for a 0.7 tyre, where 05 had handed Rapier the raw 0.7. The steering limiter (a bit-exact translation, its
`×0.001×16` verified against the source this round) was therefore handing out angles budgeted for a tyre
4.6× stronger than the one underneath it: "hard to turn in at speed" in one line. This also resolves 05's
recorded dead end — the ~1.8 g admiral-launch reconciliation was missing the load factor's static value.
The cap (`min(…, 2)`) is applied per step in `setVehicleControls`: a wheel carrying more than half the car
gains nothing further.

**2. The wheel-at-hub standing pose contradicts the original's own rest law — the turismo's slam.** SA
rests a car near full droop: `SetupSuspensionLines` computes the standing compression as `1 − 1/(4 ×
forceLevel)` of the span `upper − lower` (per corner: `share/(forceLevel × axleBias)`), consistent with
`ApplySpringCollision`'s `0.016` against gravity `0.008` at the RAW suspension bias. The wheel therefore
rests `|lower| − that deflection` BELOW its dummy — SA models author wheels high in the arches and the game
drops them. Our rule pinned the wheel AT the dummy, sitting every body low by that distance, proportional
to `|lower|`: turismo (−0.20, the stock table's largest) ~12 cm; admiral (−0.15) ~10 cm; infernus (−0.10)
~5 cm; comet (−0.05) ~2 cm. That gradient is why seven field rounds passed the fleet and still called out
the turismo. The pose now follows the original's law, and the drawn wheels follow the physics suspension
(plan 06 §3's travel channel — `RigidEntity.setPartTranslation`, smoothed in the rig at the fixed step);
camber and the axle rules remain 06's.

**3. Two more guessed constants died.** `CHASSIS_LINEAR_DAMPING = 0.1` — the original has NO flat linear
damping on a car (drag is `dragMult × v²/2000`, the 0.99/frame factor is angular); it added `0.1 × v` of
phantom drag (~3 m/s² at 108 km/h, 3× a sports car's authored drag) and capped the admiral at ~153 of its
authored 180 km/h. And the benchmarks readme's turismo verdict ("settles 5 mm into a 15 cm travel")
compared the spring LENGTH to the TRAVEL — the capture's own numbers say 5.1 cm, on the 35 % sag clamp: a
real field complaint was dismissed on a number wrong by 10× (corrected in place, with this pointer).

**Instrument added**: the `sweeper` scene — a held 0.4 steer entered at ~140 km/h — the moderate-steer-at-
speed case three field rounds complained about and no scene could see (05's recorded gap). What is still
owed on top of the chain's standing list: an absolute ride-height/clearance probe (no capture measures
body-to-ground), re-tuning `LOCKED_SIDE_FRICTION` in the new grip regime, and the kerb-flip check — more
lateral grip means more roll moment, so 06's kerb probe matters MORE after this, not less.

**Round 2, same day — the field falsified the grip normalisation and confirmed the stance.** Verdict on the
above, verbatim in effect: the cars became "almost weightless, uncontrollable, fast"; the turismo's
suspension is FIXED; turn-in at speed unchanged. Diagnosis: finding 1 ported SA's ABSOLUTE lateral budget
(~45 × TM m/s² ≈ 3 g) into a world with HALF SA's gravity — grip-to-weight came out 2× the original's. The
faithful port of a 2 g game into a 1 g world is the DIMENSIONLESS ratio: `μ = 45 × TM / g_SA(20) = 2.25 ×
TM` (≈ 2.3× the pre-audit value, exactly the steady-state gap the audit measured). Corrected; the linear
damping went back to the field-liked 0.1 in the same correction (zeroing it and re-scaling grip in ONE
change made the verdict unreadable — the multi-variable mistake the chain already knew). Two things this
round bought:

- **The recorded structural truth**: at 1 g you cannot have BOTH SA's cornering radii and SA's weight-feel;
  the dimensionless port halves absolute cornering vs the original at the same km/h. Closing that for real
  means vehicles under SA gravity with springs recalibrated — a plan-worthy decision, not a constant.
- **"Turn-in at speed unchanged" survived a 7× grip swing** — so the at-speed gate is NOT tyre grip. The
  remaining suspects are the steering limiter's granted angle and the steer slew; the `sweeper` capture
  exists now precisely to separate them, and that investigation is the next single-variable step.

**Round 3, the decision — park the tyre at the baseline, bet the conflict on gravity.** The dimensionless
port (2.25 × TM) restored the weight-feel but left the at-speed complaint ("swerving round an obstacle at
speed barely moves the car — you must slow down"), and the arithmetic says why: obstacle avoidance is a pure
test of ABSOLUTE lateral acceleration, ours tops at ~1.5 g where the original runs ~3 g, and no 1 g value of
this constant can close that without re-breaking the weight-feel (round 2 proved it). So the tyre went BACK
to the field-liked baseline (`μ = TM × axle`, the per-step load cap removed with it), the stance fix, the
travel channel and the sweeper stayed, and the whole conflict is staged onto **081/08 — vehicles under SA
gravity**: at 2 g the SAME dimensionless constant delivers SA's absolute budget through doubled wheel loads,
the springs move to SA's own absolute rate law (which then produces the standing pose as a natural
equilibrium), the steering limiter's granted angle matches what the tyres deliver, and falls/jumps/brakes
land on the numbers their rows were authored against. The experiment's risk list and gates are in the
sub-plan.
