# 081/02 — handling.cfg as the source of truth: mapping, COM, per-car suspension

The root-cause plan. Two of the three original complaints trace here: **cars flip easily because the
COM emerges high** (equal mass share across COL primitives incl. cabin boxes, `physics-world.ts:700`;
authored `CentreOfMass` unread), and every car drives the same because **35 of 40 handling fields are
ignored**.

## 1. The typed mapping table (written once, unit-tested, never re-derived)

Extend `VehicleHandling` (today 5 fields, `world-adapter.interface.ts:19-31`) to the full set the
chain consumes, with explicit unit conversions documented per field (SA community docs + the column
legend already in `fixtures/original/data/handling.cfg:24-84`):

| handling column                                       | → typed field                                          | Unit conversion                                              | Consumed by    |
| ----------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ | -------------- |
| fMass                                                 | `mass` (kg)                                            | as-is (already mapped)                                       | body           |
| fTurnMass                                             | `turnMass` (kg·m²)                                     | as-is → yaw inertia                                          | this plan      |
| fDragMult                                             | `dragMult`                                             | → linear damping term (documented factor)                    | plan 04        |
| CentreOfMass x,y,z                                    | `centreOfMass` (m, model)                              | model space: x=right, y=forward, z=up (GTA frame)            | this plan      |
| fTractionMultiplier / Loss / Bias                     | `traction{Mult,Loss,Bias}`                             | dimensionless; bias 0..1 front share                         | plan 05        |
| nNumberOfGears / fMaxVelocity                         | `gears`, `maxVelocity` (m/s)                           | **km/h ÷ 3.6** (today's `maxVelocity*0.25` hides this)       | plan 04        |
| fEngineAcceleration / nDriveType / EngineInertia      | `engineAccel`, `drive: 'F'\|'R'\|'4'`, `engineInertia` | accel as-is (m/s²); drive char                               | plan 04        |
| fBrakeDeceleration / fBrakeBias / bABS                | `brakeDecel`, `brakeBias`, `abs`                       | decel m/s²; bias 0..1 front share                            | plan 04        |
| fSteeringLock                                         | `steeringLock` (rad)                                   | degrees → rad (already mapped)                               | plan 05        |
| fSuspensionForceLevel / DampingLevel / HighSpdComDamp | `susp{Force,Damping,HighSpeedDamp}`                    | dimensionless levels → stiffness/damping scales (documented) | this plan      |
| Suspension upper / lower limit                        | `suspUpper`, `suspLower` (m)                           | metres → rest length + travel                                | this plan      |
| fSuspensionBias / AntiDiveMultiplier                  | `suspBias`, `antiDive`                                 | bias 0..1 front; anti-dive 0..1                              | this plan / 03 |
| fCollisionDamageMultiplier                            | `collisionDamageMult`                                  | → damage system (today's fixed thresholds scale)             | plan 07 note   |

- Parser stays raw-string (`handling.parser.ts` untouched); the adapter's `vehicleHandling()` grows
  the mapping + fallback row. Unit tests pin LANDSTAL, ADMIRAL, INFERNUS full rows against
  `fixtures/original/data/handling.cfg` (the real-fixtures rule).
- Fields deliberately NOT consumed by the chain get a one-line "why" here (nPercentSubmerged — no
  water physics; monetary/light/anim columns — other systems).

## 2. Centre of mass + inertia (THE flip fix)

- Apply authored COM: convert handling's model-space `CentreOfMass` (GTA: y forward, z up — same
  frame the chassis already uses) and set it as the body's mass properties:
  `setAdditionalMassProperties(mass, com, principalInertia, identity)` with collider densities
  zeroed (colliders keep SHAPE for contacts; mass properties become fully authored). Principal
  inertia: yaw from `turnMass`; pitch/roll from a box model on the chassis half-extents scaled to
  `turnMass` (document the formula; SA only ships yaw inertia).
- Telemetry A/B (plan-01 scenes, before/after): slalom roll angle and u-turn/flip behaviour must
  drop visibly; brake pitch changes sign only in plan 03 (COM alone helps but anti-dive finishes).
- **Then re-tune down `CHASSIS_ANGULAR_DAMPING` (2 → target ≤0.5)** — it was the band-aid for the
  high COM and it currently deadens legitimate body motion (part of why nothing feels alive). The
  stability that damping faked comes back honestly in plan 03.
- Watch the quirks ledger: parking brake hold, spawn pitch/slide, `holdBody` during enter/exit —
  re-run their tests with authored COM (a low COM changes rest attitude on slopes).

## 3. Per-car suspension

Replace the five shared suspension constants with handling-derived per-wheel values at
`createDynamicVehicle` time: rest length + travel from upper/lower limits, stiffness from force
level (mass-normalised — document), compression/rebound from damping level (keep the ratio lesson:
compression raised to damp the launch hop), front/rear split from `suspBias`,
`suspensionHighSpeedDamp` noted for plan 03. Wheels keep model-measured radius.

- Expected field outcome: firetruck stops wallowing like a sedan; Infernus sits stiff. The
  brake-strip and kerb scenes quantify it (pitch amplitude, settle time, no launch-hop regression —
  the compression=12 lesson stays honored via the mapping's floor).

## 4. Control-latency fix (small, here because 03–05 tune against it)

`drive()` currently writes controls AFTER the step consumed them (one-step latency,
`engine-canvas-host.tsx:708-719` + `physics.step` order). Split control application out of
`EnterVehicleSystem.fixedUpdate`: compute+apply controls via a pre-step hook (`physics.step` gains
an optional callback before `updateVehicle`), keep the state machine post-step where it reads
results. Verify by test (controls visible to the same step) and confirm no behavioural regression
in the enter/exit suite; capture steering-response delta in the slalom replay (expected small but
free).

## Subtasks

- [x] Typed mapping + conversions + 3 pinned-row tests; fallback row documented.
- [x] COM/inertia application (+ the angular-damping retune MEASURED and deferred to plan 03 — see ledger).
- [x] Per-car suspension mapping + spawn/settle re-verification (the `rest` scene is the settle check now;
      a field report caught the first attempt and the clamp fixed it).
- [x] Pre-step control hook + latency test.
- [x] Replay A/B captures (4 cars × 9 scenes) into the ledger + the benchmark record.
- [~] **Field round**: the flip complaint specifically — aggressive city driving, the user tries to
      flip a sedan honestly; plus "do different cars feel different now".

## Acceptance

- Slalom/u-turn: no flip at sane speeds on the trio; roll angle down vs baseline (numbers in ledger).
- Three cars measurably distinct in brake-strip + slalom captures.
- Angular damping ≤0.5 with stability not worse than baseline (03 finishes the job).
- Suite green incl. quirks ledger tests; bench road-car sweep unchanged.

## Ledger

### 2026-07-26 — the typed row (subtask 1)

`VehicleHandling` went from 5 fields to the whole row; `parseHandling` was already keeping every column as a
raw string, so this is purely the adapter's mapping plus a documented fallback row. Values pass through AS
AUTHORED — what a number becomes is the consuming plan's decision, made with its own evidence.

**The column indices are pinned by the DATA, not by the file's legend.** `handling.cfg`'s own FIELD
DESCRIPTIONS block lists an `(E) (not used)` column between `fDragMult` and `CentreOfMass.x` that the shipped
rows do not carry; trusting it would have shifted every field after `dragMult` by one. Cross-checked both
ways before writing anything: `nPercentSubmerged` 70 lands at index 6 and `fMaxVelocity` 240 at index 11 on
the stock infernus, and its `CentreOfMass.z` reads −0.25 — the value 081/01 had already tied to the flip.
The legend's RANGES are stale too (it claims `fMaxVelocity [5..150]`), which is a good reminder that the
comment block is documentation, not data.

A new integration test pins the entire ADMIRAL row against the stock fixture. `vehicle-handling.fake.ts`
gives other tests a full row without spelling out 24 fields.

### 2026-07-26 — authored COM + inertia (subtask 2, first half), MEASURED

`createDynamicVehicle` takes `VehicleMassProperties` instead of a bare mass. Colliders now carry **zero
mass** — they are the car's shape and nothing else — and the body is born with `handling.cfg`'s mass, its
authored centre of mass and an inertia tensor whose yaw term IS `fTurnMass`. Pitch and roll come from a
solid-box model on the chassis half-extents scaled so its own yaw term matches the authored one: that keeps
the three axes in a consistent ratio rather than inventing two numbers, and the scale lands near 1 on real
cars (the stock infernus authors 2725 against a box model's 2637 — SA computed it much the same way).

**A Rapier trap, documented in the API and the test.** `setAdditionalMassProperties` is folded in during
`world.step()`. Before a body's first step it reports **mass 0 with its centre of mass at the origin**, which
looks exactly like the properties having failed to apply — a probe over four API variants was needed to tell
the two apart. (`setAdditionalMass` alone never applies at all.)

**A/B, same pak and scenes, `before-*` vs `com-*` in the benchmark record:**

| Scene / car                | Before                          | After                          | Verdict |
| -------------------------- | ------------------------------- | ------------------------------ | ------- |
| **comet brake-strip**      | turned **50.9°**, slip 61.4°    | turned **1.6°**, slip 2.9°     | **the user's reported bug, gone** |
| **infernus u-turn**        | roll −55…16°, pitch −38…31°, 3.65 s air | roll −1…7°, pitch 0…9°, 0.35 s air | **a crash became a corner** |
| infernus kerb-strike       | slip 89.9°                      | slip 53.3°                     | better  |
| infernus slalom            | roll ±180°, FLIP                | roll ±180°, FLIP (slip 74→45)  | **unchanged** |
| infernus handbrake-turn    | roll ±180°, FLIP                | roll ±180°, FLIP               | **unchanged** |
| comet slalom               | roll −177…180°, FLIP            | roll −14…159°, FLIP            | less extreme, still over |
| infernus crest-jump        | slip 25°, roll −8…10°           | slip 89°, roll −7…25°          | **worse** |
| comet kerb-strike          | slip 56°, 0.75 s air            | slip 86°, 1.62 s air           | **worse** |
| infernus brake-strip       | 59.9 m / 2.92 s (1.6 g)         | 45.2 m / 2.33 s (2.0 g)        | shorter — see below |
| comet brake-strip          | 32.3 m / 1.90 s                 | 26.6 m / 1.78 s                | shorter |

**What this says.** The authored centre of mass fixes what it was supposed to fix — a car that braked
straight now brakes straight, and a u-turn that ended in a 3.65 s flight is a corner. It does **not** stop
the flips: the slalom and the handbrake turn still go over, and airborne cases got worse. That is consistent
with the plan's own reading — the COM is half of it and roll stiffness is the other half (plan 03) — but it
must be said plainly rather than filed as a win.

**And braking got SHARPER, which is a regression against the user's complaint** (1.6 → 2.0 g on the
infernus). The mechanism is straightforward: a lower, better-placed centre of mass puts more load through the
front tyres, and the tyre force the raycast controller can deliver scales with suspension load. It makes plan
04's brake-formula fix more urgent, not less — `brakeForce` still has no mass term at all (081/01's mod-corpus
finding), so heavier cars remain hopeless while light ones get sharper.

**Next**: `CHASSIS_ANGULAR_DAMPING` 2 → ≤0.5 (the band-aid this plan is supposed to retire), measured the
same way. Expect the flips to get WORSE before plan 03's anti-roll puts stability back honestly — that
sequence is the point of measuring each step separately.

### 2026-07-26 — the angular-damping band-aid: measured, and KEPT (with a re-plan for 03)

This plan says to retire `CHASSIS_ANGULAR_DAMPING` (2 → ≤0.5) once the authored centre of mass lands. It was
dropped to 0.5 and the full matrix re-run on the two flipping cars (`damping05-*` in the benchmark record).
The measurement says **do not**, for two reasons the plan could not have known:

**1. It is not what suppresses the braking dive.** The infernus pitches **0.15° under braking at BOTH
values** — identical. The plan assumed the damping was deadening the body; it is not. The missing dive is the
SUSPENSION: one shared spring rate for every car, 0.25 m of travel, a 40 kN force cap. That moves the
brake-dive complaint out of §2 and into §3 / plan 03.

**2. Its removal makes impact flips worse.** At 0.5 the gentle step-steer rolls to **−95°** where 2.0 held it
at −74; the slalom and the crest landing repeat the pattern. Body motion does return (slalom pitch −28° →
−86°), but much of that motion is the car tumbling further after an impact, not living.

**The bigger finding — and it re-plans 03.** Every flip in the matrix, checked against the vertical
acceleration BEFORE it:

| Flip                    | Happens at            | Biggest vertical g before it |
| ----------------------- | --------------------: | ---------------------------: |
| infernus handbrake-turn |                6.27 s | **−23.8 g**, 0.30 s earlier  |
| comet slalom            |                7.50 s | **30.1 g**, 2.03 s earlier   |
| comet crest-jump        |               15.37 s | **30.9 g**, 0.85 s earlier   |
| infernus slalom         | 7.50 s at **−1 km/h** | 1.7 g                        |
| comet u-turn            | 5.82 s at **−6 km/h** | 1.0 g                        |

The first three follow a violent vertical impact. The last two happen at walking pace — a car already
destabilised, tipping slowly, with the flag catching the moment it crosses 90°. **Not one flip in the matrix
is a cornering flip.** The step-steer series makes it plainest: a full second of held lock produces 0.05° of
roll, and the car only goes over 1.2 s AFTER a 7.6 g kerb strike.

So the user's two complaints — "cars flip too easily" and "a kerb flips it, it behaves like cardboard" — are
**one complaint**, and the lever is not anti-roll stiffness, which fights CORNERING roll that is not
happening. It is what a wheel does when it meets a raised edge: the shared spring cannot absorb the impulse,
so the impulse becomes body rotation. Plan 03's brief should be re-read with that in mind, and plan 06's kerb
work may belong before it rather than after.

The band-aid therefore stays at 2 until plan 03 ships a real answer to a vertical impact — removing it early
costs stability and buys nothing measurable.

### 2026-07-26 — per-car suspension: WRITTEN, MEASURED, REVERTED (§3 is not done)

The derivation was written as the plan describes — rest length and travel from the authored limits, stiffness
mass-normalised off the sedan the shared constants were tuned on, damping scaled about its reference with
floors that keep the launch-hop lesson, force cap following weight. It shipped for about an hour and then a
FIELD REPORT killed it: *"the admiral that spawns at Ganton shivers, right at load — and it barely drives.
A second one I spawned does the same. The comet has no such problem."*

**Reproduced, then reverted.** A new `rest` scene (the car is asked to do nothing for ten seconds; anything
non-zero is a tremor) showed it deterministically at an EMPTY spot, so it was not a car-on-car collision:

| Build                          | Vertical g at rest | Airborne of 10 s |
| ------------------------------ | -----------------: | ---------------: |
| shared constants (before/after) |    **0.000…0.000** |         **0.00** |
| per-car suspension, admiral     |      −1.010…**7.15** |       **6.35** |
| per-car suspension, firetruck   |        0.000…0.000 |             0.00 |

Airborne 6.35 s of 10 also explains the second half of the report: a car whose wheels are off the ground two
thirds of the time cannot pull away. Two symptoms, one cause. After the revert the admiral matches its
baseline to the centimetre (77.3 km/h, 23.68 m of braking against 23.67).

**Why it is reverted rather than fixed.** The only per-car differences for the admiral are rest 0.15 → 0.19 m,
travel 0.25 → 0.27 m and a force cap 40 → 44 kN; stiffness, compression and rebound come out identical to the
shared values (verified by reading them back off the Rapier controller, not by arithmetic). **None of those
reproduces the tremor in an isolated Rapier test** that copies the real spawn rule, a realistic chassis and
the parking brake — and in-game single-variable probes came back clean while the whole set jittered, which is
a contradiction. At least one measurement in that bisection is untrustworthy.

**The instrument gap that blocked it, and the next step.** A `[phys]` capture does not record the spring
values the run actually used, so an in-game probe cannot be shown to have taken effect — exactly the class of
doubt this chain exists to remove. §3 resumes only after the capture reports its own per-wheel suspension
parameters. The mapping itself is kept in this ledger and in the reverted diff; it is the VALUES that are
held back, not the reading of them.

**What survives**: the `rest` scene (a car at rest must be still — the cheapest regression test in the set),
and the knowledge that the shared spring is what suppresses the braking dive, which §3 still has to fix.

### 2026-07-26 — §3 lands, and the instrument found the bug in one line

The revert above blocked on an instrument gap, so the instrument came first: `PhysicsWorld.readVehicleSprings`
reads a controller's per-wheel setup back, the vehicles facade exposes it, and every `[phys]` capture now
carries a `springs` block — **what the run was actually configured with**.

It paid off immediately. The re-applied mapping was re-measured, and the capture reported:

```
compression 64.8   relaxation 12.42   stiffness 94.7   rest 0.15   travel 0.22   maxForce 37333
```

Nothing matched what the mapping should have produced for an admiral (12 / 2.3 / 120 / 0.19 / 0.27 / 44000).
Solving backwards from `maxForce 37333` gave mass 1400, and from `compression 64.8` a damping level of 0.81 —
which is not the admiral's row. **It was being read from the wrong file all along.**

| Source                                          | mass | force | damping  | upper | lower |
| ----------------------------------------------- | ---: | ----: | -------: | ----: | ----: |
| `game-src/original/data/handling.cfg` (diagnosed against) | 1650 |   1.0 |     0.15 |  0.27 | −0.19 |
| **`build/original/opensa/data/handling.cfg` (the game reads THIS)** | **1400** | **0.93** | **0.81** | **0.22** | **−0.15** |

The install has a mod that replaces the admiral, and its row authors `fSuspensionDampingLevel = 0.81` against
a stock range of 0.02…0.19. The mapping scaled it linearly — `12 × (0.81 / 0.15) = 64.8` — and a wheel damped
five times too hard cannot follow the road: it skips, the car shivers at rest, and it never puts its power
down. **Both halves of the field report, from one number.**

**The fix is a CEILING on the damping scale**, the half that was missing: a floor already kept a 0.02 tank off
its pogo stick, and now `[0.35 … 2.0]` keeps an out-of-range row from freezing a wheel. The authored value
still orders the cars; it just cannot leave the range the solver works in. After it, at rest: vertical g
**0.000…0.000**, airborne **0.00 s**, and driving is intact — the admiral still tops 77.3 km/h, the comet 130.

**Braking moved, per car and in opposite directions**: the admiral 23.7 → 28.5 m (softer, longer) and the
comet 32.3 → 24.8 m, with the comet's brake-dive pitch nearly doubling (0.25° → 0.45°). Different cars now
brake differently because their springs differ — which is the point of §3.

**Two rules out of this**, both now written down where they will be met again:
1. **A field run reads `build/<game>/opensa` and NOTHING else, its `data/` included** — saved to memory, and
   `scripts/debug/handling-diff.ts` now defaults its baseline to the built table for the same reason.
2. **An A/B must be self-describing.** No amount of careful bisection beat one capture that stated its own
   configuration. Any future tuning surface gets read back into the capture before it is tuned.

### 2026-07-26 — the A/B: 4 of 5 flips are gone

Full matrix, 4 cars × 9 scenes, same pak and scenes as the BEFORE record
(`after02-*` against `before-*`). What §2 (authored mass properties) and §3 (per-car springs) did together:

| Scene / car             | Roll max BEFORE → AFTER | Flip |
| ----------------------- | ----------------------: | ---- |
| slalom, comet           |         **180° → 23.9°** | **gone** |
| slalom, firetruk        |         **113.8° → 11.9°** | **gone** |
| crest-jump, firetruk    |         **99.7° → 6.8°** | **gone** |
| handbrake-turn, infernus |        **180° → 3.0°** | **gone** |
| slalom, infernus        |           180° → 106.9° | still flips |
| kerb-strike, comet      |             29.3° → 20.0° | — |
| kerb-strike, firetruk   |              7.3° → 3.6° | — |
| slalom, admiral         |             14.2° → 5.5° | — |

**The flip complaint is largely answered, and by data rather than by damping.** The chassis angular damping
is still the same 2 it always was; what changed is that the mass now sits where the car was designed to carry
it and each car rides its own springs. The one survivor — the infernus slalom — is also the most violent
scene in the set, and its roll halved.

**The body finally moves under braking.** `pitchUnderBrakeDeg` was flat to a tenth of a degree across the
whole BEFORE matrix; now it is per-car and visible: comet 0.25° → **0.45°** on the brake strip and 6.8° →
**20.9°** in the handbrake turn, firetruck 0.21° → 0.06° (a heavy truck on soft springs dives LESS, which is
right). The 081/01 finding that the suspension — not the damping — was suppressing the dive is confirmed by
fixing the suspension.

**Braking is now per-car in both directions**, which is what one shared spring made impossible: infernus
59.9 → 54.0 m, comet 32.3 → 24.8 m, admiral 23.7 → **28.5 m** (longer — a soft sedan should stop later than
a supercar), firetruck unchanged at 119.3 m.

**Two numbers that are NOT wins and need reading before anyone quotes them**: `pull-away-reverse` braking
distance moved from 2.1 → 40.3 m on the comet and 126.1 → 23.6 m on the firetruck. That scene brakes twice
(coast-down, then the reverse), and the summary reports the FIRST run that reaches a stop — so a change in
which of the two qualifies swings the number wildly. The metric needs to name which braking event it took,
or the scene needs splitting. Recorded rather than quietly dropped.

**Subtask status**: §1 typed mapping, §2 mass properties and §3 per-car suspension are done and measured.
§4 (the pre-step control hook) and the field round remain; the angular-damping retirement is deferred to
plan 03 with the reasons measured above.

### 2026-07-26 — FIELD VERDICT (user, after driving the A/B build)

> *"Braking and the kerbs got better. Braking at speed is of course still sharp and unsettled, but a lot of
> factors play into that — I think it will get better further on."*

Accepted, and the numbers agree with every part of it, including the part that is not a win yet:

**What the field felt as better is in the data.** Kerbs: roll on the `kerb-strike` scene fell on three of
four cars (comet 29.3° → 20.0°, firetruck 7.3° → 3.6°, admiral 4.7° → 2.8°). Braking: distances became
per-car in both directions and the body finally moves at all.

**What is still wrong, precisely.** On a straight brake strip the nose STILL RISES instead of diving —
`pitchUnderBrakeDeg` is positive on three of four cars, and 081/02 only made it larger, not correct:

| Car      | Nose-up while braking | Deceleration |
| -------- | --------------------: | -----------: |
| infernus |     0.07° → **0.15°** | 1.60 → 1.72 g |
| comet    |     0.25° → **0.45°** | 1.93 → **2.22 g** |
| admiral  |       −0.21° → −0.22° | 0.94 → 0.76 g |
| firetruk |         0.21° → 0.06° | 0.53 → 0.53 g |

Two separate defects sit in that table, and neither belongs to this plan:

1. **The deceleration is too high and got higher** (comet 2.22 g; a road car manages ~1). `brakeForce` has no
   mass term at all and no bias — plan **04**, and the mod-corpus finding says the same.
2. **The dive has the wrong SIGN**, which no amount of spring rate fixes. SA authors the lever for exactly
   this and nothing reads it: `fSuspensionAntiDiveMultiplier` (infernus 0.4, comet 0.18, admiral 0.0,
   firetruck 0.0) together with `fBrakeBias` (0.51 / 0.55 / 0.63 / 0.45). Anti-dive is a geometry term that
   converts braking torque into a downward force at the front hub; without it, the only thing the front
   suspension sees is weight transfer that the raycast controller does not generate on its own. Plan **03**.

So the user's "many factors" reading is right, and the factors are now named rather than guessed. 081/02 is
**field-accepted**; the braking complaint moves on with its own two owners.

### 2026-07-26 — §4 the pre-step control hook: the latency was a FAKE transient

`physics.step` gained a `beforeVehicles` hook that runs before the raycast controllers consume their
engine/brake/steer; `EnterVehicleSystem.applyControls` computes and applies the driving there, and
`fixedUpdate` keeps the phase machine and the rider. The host wires the hook; a host that does not still
drives, one step late, exactly as before — the method is idempotent within a step, and both halves are
pinned by tests.

One behaviour had to move with it: the car's POSE is now read at the top of `applyControls` rather than
inside the seated branch. A test caught the reason within a minute — an overturned car chose its crawl-out
side from a stale orientation, because the exit decision lives inside `drive()` and was suddenly running
before the read. Controls are computed from the state the car is in NOW; so is the decision to climb out.

**Measured** (step-steer, against the pre-§3 run, so the suspension changed too — attribution is not clean):

| Car      | Yaw rise |
| -------- | -------: |
| infernus | 0.080 → **0.000 s** |
| comet    | 0.150 → 0.170 s     |

**And that is not an improvement in FEEL — it is the opposite.** The one-step latency was accidentally
supplying the only transient the car had: a 16 ms delay between the press and the answer reads a little like
a car taking a moment to load its tyres. Removing it is right (the delay was an artefact, it scaled with
nothing, and plans 03-05 would have tuned against it as if it were physics) and it makes the missing tyre
model MORE exposed, not less. The user's "the car just changes its direction vector" gets slightly worse
before plan 05 makes it better, and that is the honest order: remove the fake, then build the real one.
