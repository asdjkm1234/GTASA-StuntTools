# Vehicle physics — the behaviour record

The second measurement family in this folder. The rest of `benchmarks/` records what a frame **COSTS**; this
records what a car **DOES** — how long it takes to stop, how far it rolls, whether it goes over. Same standing
rule, same reason: a number that exists only in a conversation is gone when the session ends, and no later
tuning round can prove it improved anything without the run it improved on.

These are the captures plans 081/02-07 are judged against. `scripts/phys-compare.ts` diffs any two of them.

## How a run is produced

`?phys=<scene|all>&car=<model>` drives a scripted lap and prints one `[phys] {json}` line per scene — the
`[bench]` protocol's twin. Headless: `TAG='[phys]'` makes `tools-debug/bench-harness/drive.js` collect it.
**Full guide: [`../../development/physics-laps.md`](../../development/physics-laps.md)** · commands:
[`../../commands.md`](../../commands.md) · toolbox: [`../../debug/README.md`](../../debug/README.md).

## File naming

`YYYY-MM-DD-<surface>-<what>-<car>.json` — e.g. `2026-07-26-headless-before-infernus.json`. `surface` is
`headless` (the harness) or `ingame`. A full sweep is **one file per CAR** (an array of that car's scene
captures); a single-scene sweep across cars is one file named for the SCENE
(`2026-07-26-headless-step-steer-four-cars.json`).

## Format

Each file is the array of `[phys]` lines, verbatim. One capture:

```jsonc
{
  "car": "infernus",
  "key": "brake-strip", // scene id, from apps/web/src/phys-scenes.ts
  "what": "Time to speed, then a full-brake stop: …", // the scene's own statement of purpose
  "seriesHz": 20,
  // `x`, `y`, `z` (world GTA space) were APPENDED on 2026-07-27 — at the end, so a capture taken before that
  // still compares column-for-column with one taken after. Older captures simply carry the first eleven.
  "columns": ["t", "speed", "slipAngle", "pitch", "roll", "yawRate", "gLong", "gLat", "gVert", "throttle", "steer", "x", "y", "z"],
  "series": [[0.0167, 0, 0, -0.0022 /* … */]], // thinned to seriesHz; SI + radians
  "surfaceGrip": true, // 081/10: did grip come from the surface under each wheel, or was everything tarmac?
  "summary": {
    // What the lap DROVE on: the share of wheel-on-ground samples per surface, counted per WHEEL (a car with
    // two wheels on grass is half off the road). Named, not numbered — ids are a lookup nobody performs.
    "surfaces": { "tarmac": 0.79, "dirt": 0.1, "grass_medium_lush": 0.07, "pavement": 0.03 },
    "topSpeedKmh": 165.69,
    "timeTo100S": 3.98, // null when the car never gets there
    "brake": { "distanceM": 59.94, "fromKmh": 165.18, "seconds": 2.92 }, // null when the lap never braked to a stop
    "pitchUnderBrakeDeg": 0.07, // POSITIVE IS NOSE UP — the braking complaint is a sign on this field
    "pitchDeg": { "min": -0.53, "max": 0.07 },
    "rollDeg": { "min": 0, "max": 0 }, // positive = right side down
    "slipMaxDeg": 0, // largest body slip angle reached
    "turnedDeg": 0, // integrated yaw — counts a whole spin, not the shortest way round
    "gLong": { "min": -3.17, "max": 0.85 },
    "gLat": {}, "gVert": {}, // gravity excluded: resting on the springs reads 0 vertical
    "airborneS": 0, // seconds with NO wheel in contact
    "flip": null, // { atKmh, atS } the first time |roll| passed 90°
    "frames": 960, "durationS": 15.98,
  },
  // What the run was CONFIGURED with, PER WHEEL (stiffness, damping, travel, rest length, force cap). It
  // recorded one wheel until 2026-07-26, when the authored axle bias gave the two axles different springs —
  // and a savanna capture showed wheel 0 is not reliably the front one either (the order follows the
  // model's own dummy frames). A capture that cannot say what it was configured with proves nothing.
  "springs": [{ "stiffness": 25, "travel": 0.25 /* … */ }],
}
```

**The summary peaks come from EVERY fixed step; the series is thinned.** A spike survives as a number even
when its own sample is dropped from the curve — never read a peak off `series`.

## What makes two captures comparable

- **The build and the pak.** Same as the perf record: what the world contains decides what the car drives on.
  Record it in the index row.
- **The scene definition.** Scenes are calibrated data (`apps/web/src/phys-scenes.ts`) — a spot moved or a
  timeline retimed makes two runs of the same `key` incomparable. Note it when it changes.
- **The car model**, and that the same three (infernus / admiral / firetruk) are the calibration trio:
  sports, sedan, heavy.
- **NOT the machine.** Unlike a perf run, a lap is fixed-step physics: it does not care how fast the frames
  came. Determinism is measured — `brake-strip` reproduced to the second decimal across an isolated run and
  a full sweep on the same build.

## Chronology

### 2026-07-26 — the 081 BEFORE matrix (3 cars × 7 scenes, 21 of 21 laps)

The baseline the whole 081 chain is tuned against. **Pak: the canonical `./build/original/opensa`,
`pak/manifest.json` buildTime `08:41 24-07-2026`, cellSize 250, 1 272 901 632 B** (the same build every dev
surface reads — plan 079). Code at commit `596b0e9`; headless via the bench harness (M3 Pro, ANGLE/Metal).
Scenes v1 as authored that day; the analysis lives in the plan's ledger
([`../../plans/081-vehicle-physics/01-telemetry.md`](../../plans/081-vehicle-physics/01-telemetry.md)).

Headlines: a **firetruck reaches 149.1 km/h and does 0-100 in 4.53 s** while an infernus does 3.98 and an
**admiral never reaches 100 at all**; the infernus goes fully over (roll ±180°) in the slalom AND the
handbrake turn, the firetruck goes over in the slalom and lands on its side off the crest with **5.22 s of
air**, and the admiral goes over nowhere; a kerb throws the ten-tonne truck **2.45 s into the air** and spins
the infernus **−89.5°** at 125 km/h; and on a straight brake at 1.6 g the body pitches **+0.07°, nose UP** —
it does not dive at all.

Runs: [`2026-07-26-headless-before-infernus.json`](2026-07-26-headless-before-infernus.json) ·
[`2026-07-26-headless-before-admiral.json`](2026-07-26-headless-before-admiral.json) ·
[`2026-07-26-headless-before-firetruk.json`](2026-07-26-headless-before-firetruk.json).

### 2026-07-26 — comet, the car the user reported (a fourth set, same conditions)

Added at the user's request: *"measure the comet — constant flips and very fast."* Same pak, same commit,
same seven scenes. It earns its place in the record because it isolates the diagnosis: by the five fields the
engine READS, the comet is almost exactly an infernus (mass 1400, engineAccel 30, brakeDecel 11 — identical;
only maxVelocity differs, 200 vs 240). Everything it should differ by is unread.

**It spins under braking on a dead-straight road, with no steering input at all.** Slip is 0.00° for the
whole eight-second run-up; the brake goes on, and 1.7 s later the yaw rate is 48.5°/s and the slip angle 48°.
The lap ends **50.9° off its heading**, stopped sideways, having braked 32.3 m from 129.6 km/h (**1.93 g**,
the hardest of the four). The other three cars finish the same scene with slip 0.0 and turned 0.0.

It also goes over in the slalom (like the infernus) and takes the kerb far worse (roll −14.7…29.3° against
±3.5°), while doing a CLEAN 135° handbrake turn the infernus cannot (that one flips instead).

Run: [`2026-07-26-headless-before-comet.json`](2026-07-26-headless-before-comet.json).

### 2026-07-26 — step-steer: the missing transient, measured

The scene the matrix could not see (every other one is straight or at full lock). A gentle held input —
0.15 after a 3 s run-up — on its own LV straight, across all four cars. Same pak and commit as above.

| Car      | Step at   | **Yaw rise** | Settled yaw | Overshoot | Settled slip |
| -------- | --------: | -----------: | ----------: | --------: | -----------: |
| infernus |  77 km/h  |  **0.08 s**  |  13.91 °/s  |     1.05  |      0.91°   |
| admiral  |  36 km/h  |  **0.17 s**  |   7.48 °/s  |     1.06  |      1.01°   |
| firetruk |  69 km/h  |  **0.07 s**  |   8.10 °/s  |     1.04  |      0.75°   |
| comet    |  60 km/h  |  **0.15 s**  |  16.95 °/s  |     1.06  |      0.86°   |

Three findings in one table. **The response is 0.07-0.17 s** where a road car takes 0.3-0.5. **A 6.5-tonne
fire truck answers FASTER (0.07 s) than a 1.4-tonne supercar** — yaw inertia is not modelled, and the
authored `turnmass` (36 671 vs 2 725) is the field that would say so. **Settled slip is ~1° and overshoot
~1.05 for every car**: no slip builds, nothing oscillates, and all four differ only in magnitude, never in
shape. The raw series is blunter still — the yaw goes 0.00 → 11.38 °/s in ONE 50 ms sample.

Run: [`2026-07-26-headless-step-steer-four-cars.json`](2026-07-26-headless-step-steer-four-cars.json).

**Method note.** The steady window is 0.3-1.0 s after the step, not the tail of the hold: a held corner
leaves a two-lane street in about two seconds, and the v1 scene's tail was a kerb strike, a spin and a bounce
backwards. Measuring a car SLOWER than ~0.3 s properly needs an open-ground scene — owed, and flagged in
code by `settled: false` rather than silently under-reported.

### 2026-07-26 — AFTER the authored centre of mass (081/02, infernus + comet)

Same pak, same scenes, the only change being that the body takes its mass, centre of mass and inertia from
`handling.cfg` instead of from an equal share per collision primitive. Two decisive wins and two regressions
— the analysis is in the plan's ledger
([`../../plans/081-vehicle-physics/02-handling-truth.md`](../../plans/081-vehicle-physics/02-handling-truth.md)).

The comet's braking spin — the bug the user reported for that car — goes from **50.9° of unasked-for rotation
to 1.6°**, and the infernus u-turn from a 3.65 s flight with ±55° of roll to a corner (0.35 s, ±7°). The
flips do NOT go away: the slalom and the handbrake turn still roll through ±180°, and airborne cases got
worse. Braking also got sharper (1.6 → 2.0 g), which is a regression against the complaint and makes plan
04's brake formula more urgent.

Runs: [`2026-07-26-headless-com-infernus.json`](2026-07-26-headless-com-infernus.json) ·
[`2026-07-26-headless-com-comet.json`](2026-07-26-headless-com-comet.json).

### 2026-07-26 — angular damping 2 → 0.5, and back (081/02)

The band-aid dropped to 0.5 on both flipping cars, to decide from data whether plan 02's retirement of it
should ship. It should not, and the runs are kept because the REASON is the interesting part: the braking
dive does not change at all between the two values (0.15° either way — the suspension suppresses it, not the
damping), while impact flips get worse. Checking every flip against the vertical g before it showed that none
of them is a cornering flip: three follow impacts of 24-31 g, two happen at walking pace on an
already-destabilised car.

Runs: [`2026-07-26-headless-damping05-infernus.json`](2026-07-26-headless-damping05-infernus.json) ·
[`2026-07-26-headless-damping05-comet.json`](2026-07-26-headless-damping05-comet.json).

### 2026-07-26 — AFTER 081/02 (authored mass properties + per-car springs), all four cars

The chain's first real improvement, measured against the BEFORE matrix on the same pak and scenes.
**Four of the five flips in the record are gone** — comet and firetruck slalom, firetruck crest landing,
infernus handbrake turn — with roll maxima collapsing from 180°/113.8°/99.7°/180° to 23.9°/11.9°/6.8°/3.0°.
The one survivor (infernus slalom) halved. The chassis angular damping was NOT touched: what changed is that
the mass sits where the car was designed to carry it and each car rides its own springs.

The body also starts moving under braking (comet 0.25° → 0.45° of dive on the strip, 6.8° → 20.9° in the
handbrake turn) and braking distance is finally per-car in both directions (admiral 23.7 → 28.5 m, comet
32.3 → 24.8 m). Captures carry a `springs` block from this run on — what the run was configured with.

Runs: `2026-07-26-headless-after02-{infernus,comet,admiral,firetruk}.json`.

### 2026-07-26 — the spring, re-expressed as the ORIGINAL writes it (081/03)

A clean A/B on the same head, the same pak and the same scenes, changing ONE thing: how the spring rate is
derived. Before, the rate was a fitted constant scaled by the authored force level, with a fitted sag target,
a fitted sag-of-travel floor and two fitted damping clamps. After, it is SA's own law —
`springForce = (1 − normalisedCompression) × mass × fSuspensionForceLevel × 0.016 × dt × bias` — which, once
the normalisation to the car's own travel is carried through, says `rate ∝ forceLevel / travel`. One bridging
constant survives (`SUSPENSION_LEVEL_SCALE = 5.2`, absorbing SA's `0.016` and Rapier's internal factor), plus
a bump stop, because SA has one and this engine does not.

The `pedalbase` runs are the baseline — the committed state, recaptured, because the older `softspring`
numbers predate the foot-brake pedal and their braking distances are not comparable.

| car      | rate         | static sag         | dive under brake   | brake distance |
| -------- | ------------ | ------------------ | ------------------ | -------------- |
| infernus | 37.1 → 25.0  | 5.4 → 8.0 cm (32 %) | −0.48° → **−0.71°** | 96.1 → 96.1 m  |
| comet    | 57.1 → 57.1  | 3.5 cm (35 %, stop) | −1.05° → −1.05°    | 38.5 → 38.5 m  |
| admiral  | 28.7 → 26.0  | 7.0 → 7.7 cm (35 %) | −0.95° → −1.01°    | 50.5 → 50.5 m  |
| firetruk | 37.1 → 13.3  | 5.4 → 15.1 cm (32 %)| −0.50° → **−1.41°** | 90.7 → 90.7 m  |

Two things to read here. **Braking is bit-identical** on every car — the spring does not touch grip, so the
change is isolated to the body's motion, which is what makes this a trustworthy A/B. And the **firetruck** is
where the old fitted rate was most wrong: it rode at 11 % of its authored travel and pitched half a degree
under a full stop; on its own law it uses 32 % and dives 1.4°, nearly three times as much. The comet is
unchanged because it was, and still is, held by the bump stop — its authored level (0.64) over its 10 cm of
travel asks for 52 % sag.

`rest` re-run on all four with the new law: zero airborne time, zero tremor, static attitude only
(admiral −0.58° pitch / +0.11° roll is the road, not the car).

Runs: `2026-07-26-headless-pedalbase-{infernus,comet,admiral,firetruk}.json` (baseline) ·
`2026-07-26-headless-salaw-{infernus,comet,admiral,firetruk}.json` (after, `brake-strip` + `rest`).

### 2026-07-26 — the drivetrain: gears, drive type and air drag (081/04)

The longitudinal model was one constant force (`mass × engineAccel × 0.28`) against a hard speed cap. The
original's is a gearbox plus air drag, and it is short enough to translate line for line
(`cTransmission::InitGearRatios`, `CalculateDriveAcceleration`, `CPhysical::ApplyAirResistance`). Baseline is
the `kmh` state — the SA-law spring with `fMaxVelocity` read as km/h, i.e. everything except the gearbox.

| car      | 0-100 km/h    | speed at 8 s WOT | peak accel g |
| -------- | ------------- | ---------------- | ------------ |
| infernus | 3.98 → 4.05 s | 165.7 → 124.1    | 0.85 → 1.07  |
| comet    | 5.43 → 2.30 s | 130.0 → 179.1    | 0.66 → 1.65  |
| admiral  | never → 5.27 s | 77.3 → 104.8    | 0.40 → 1.00  |
| firetruk | 4.53 → 3.12 s | 149.0 → 130.1    | 0.76 → 1.86  |

Read it as the cars separating. Before, one number scaled by `engineAccel` gave four cars the same shape of
acceleration; now first gear pulls four times what top gear pulls, so every car launches hard and tails off
at its own rate. The **admiral** could not reach 100 km/h in the old model at all and now does it in 5.3 s.
The **comet** (a mod with a 296 km/h row and the lowest drag in the set, 0.93) becomes the rocket its owner
describes. The **infernus** loses top-end because it is 4WD and the original divides the engine by 4 for
four-wheel drive against 2 for everything else — its 0-100 is unchanged, its 8-second speed is not.

Braking distances in the same runs are not comparable across the A/B: the cars now arrive at the braking
point at different speeds. Dive is unchanged (−0.71 → −0.67, −1.41 → −1.31 …), which is the expected
non-result — the spring did not move.

**The firetruck's 1.86 g launch is the honest reading of a row that authors 27 m/s² of engine, and it is
also a warning**: nothing is limiting it but a shared tyre-grip constant. That is plan 05's subject.

Top speed is now EMERGENT: drag rises with v² until it matches what the top gear pulls. The infernus balances
at ~228 km/h against an authored 240; the comet's mod row balances above its own gear ceiling and is held
there. Nothing is clamped to `fMaxVelocity` anywhere.

`pull-away-reverse` and `crest-jump` re-run on infernus and firetruck: launch clean, reverse reaches the
original's `−0.3 × top` limit, 1.28 s of air over the crest with no flip.

Runs: `2026-07-26-headless-drivetrain-{infernus,comet,admiral,firetruk}.json`.

### 2026-07-26 — the authored axle bias reaches the springs (081/03)

`fSuspensionBias` was parsed and ignored. The original turns it into a factor of `2 × bias` on the front
springs and `2 − 2 × bias` on the rear (`CAutomobile::ProcessCarWheelPair`), and that is now what happens.

Nothing moved on the calibration trio, and that is the point: all four reference cars author a neutral 0.5,
and the infernus `brake-strip` came back **bit-identical** to the run before the change (stiffness 25.0, dive
−0.67°, top 124.1 km/h, brake 52.7 m). Of the shipped table's ~220 rows, 130 are neutral and about 90 are
not, so this is a change that only speaks when a row asks it to.

The savanna (bias 0.3, a rear-leaning lowrider) is the demonstration: front springs 19.05, rear 24.27 —
and its front is at the **bump stop**, because 0.6 × its authored force over 0.30 m of travel would sag past
what the floor allows. So a strong bias is partly absorbed by the stop, which is the floor doing its job: a
car cannot be biased into standing on its stops. Both regimes are pinned by tests.

Two things noted rather than fixed: the shipped table contains bias 0.0 and 2.0 rows (zero and NEGATIVE
rates) — all of them boats and aircraft, none of which reach a raycast car, and the floor would catch them
anyway. And the savanna's dive reads **+0.65° (nose UP)** where the trio reads ≈ −0.7°; with the softer front
that is backwards, and the suspect is the brake split, which is still equal across the axles while
`fBrakeBias` sits unread (plan 04 §3).

Runs: `2026-07-26-headless-bias-savanna.json` (+ the infernus null-result alongside it).

### 2026-07-26 — the tyre gets its authored grip, and the fleet stops being a slot car (081/05, early)

**Field verdict that forced this** (user, on the drivetrain build): *"launches are very violent on both cars —
a 1976 Mercedes should be heavy and smooth and instead it rips away, barely slower than the sports car; the
cars have become hard to control from the speed and the lightness, they fly like aeroplanes; a kerb at speed
launches us into a flip. It feels like something is missing."* All three are one missing number.

`WHEEL_FRICTION_SLIP` was **10.5** — Bullet's raycast-vehicle demo default, and a friction coefficient
fifteen times a real tyre's. `fTractionMultiplier` is that same coefficient and the shipped table gives cars
**0.55…0.75**, which is what a tyre actually does. Everything the 10.5 touched was wrong in one direction: a
car turned in the instant the wheel moved, never slid, put every newton of engine straight into the road, and
tripped over kerbs instead of sliding along them.

Two things had to land together:

1. **Grip per wheel from `fTractionMultiplier`**, split across the axles by `fTractionBias` in the original's
   own `2 × bias` / `2 − 2 × bias` form.
2. **The clamp itself, applied on our side.** Rapier computes the friction limit `μ × suspensionForce × dt`
   and a `skid_info` factor — and then applies it only `if wheel.side_impulse != 0.0`. A car accelerating or
   braking DEAD AHEAD therefore has no longitudinal grip limit whatsoever, and eats any force it is handed.
   That is a Bullet inheritance and it is why the fleet launched at 5 g. The original clamps in exactly this
   place (`CVehicle::ProcessWheel`), so the model is SA's; only the location is ours.

Engine force also reaches DRIVEN wheels only now (`nDriveType`), which is what the drive-type divisor was
always for: engine ÷ 4 pushed by four wheels and engine ÷ 2 pushed by two come to the same total.

| car      | drive | μ    | launch g      | brake g       | 0-100 km/h    |
| -------- | ----- | ---- | ------------- | ------------- | ------------- |
| infernus | 4     | 0.70 | 1.07 → **0.70** | 1.33 → 1.14 | 4.05 → 5.40 s |
| comet    | R     | 0.67 | 1.65 → **0.43** | 2.39 → 0.92 | 2.30 → never  |
| admiral  | R     | 0.70 | 1.00 → **0.37** | 0.71 → 0.58 | 5.27 → never  |
| firetruk | R     | 0.55 | 1.86 → **0.35** | 1.36 → 0.80 | 3.12 → never  |

The infernus lands exactly on its coefficient (4WD, all four wheels pushing, 0.70 g = μ); the rear-drive cars
land near half of theirs, because a rear axle only carries about half the car. **These are real cars' numbers**
— and they agree with the original: running SA's own adhesion formula by hand for the admiral
(`adhesiveLimit × fTractionMultiplier × 2.5 × suspension term`, two driven wheels) gives ≈ 0.4 g against our
measured 0.37.

**Field verdict on THIS build** (user): *"significantly better — we pull away well at low speed, gather speed,
you feel the weight of the car, you feel the power. The best result so far. One flaw: it is now hard to turn
into a corner at speed — as if the car has been made too heavy."* That last one is the next item: the
steering still carries two FITTED constants (0.6 of the authored lock, falling by another 0.6 toward top
speed) that were tuned when grip was infinite, and they now stack on top of a real tyre.

Runs: `2026-07-26-headless-tyregrip-{infernus,comet,admiral,firetruk}.json`.

### 2026-07-26 — the steering stops throwing away 40 % of the authored lock (081/05)

**Field verdict that forced this** (user, on the tyre-grip build): *"significantly better… one flaw: it is now
hard to turn into a corner at speed, as if the car has been made too heavy."*

The steering carried two constants fitted when grip was infinite: use `0.6` of the authored lock, then shrink
that by up to `0.6` more toward top speed. At 90 km/h an admiral could reach 14.7° of its authored 35°. With a
real tyre underneath, that reads exactly as the user described.

Both are gone. What replaces them is the original's own limiter
(`steerAngle = asin(min(adhesive × traction × 16 / v², 1)) / lock`, `CAutomobile::ProcessControl`) applied on
top of the FULL authored lock — plus its two exemptions, which matter: countersteering into a slide and the
handbrake both restore full lock, because that is how a driver saves a car and how a handbrake turn works.

The important property is where it bites. At 50 km/h it allows 8.3° — more than the 5.25° an ordinary corner
asks for, so normal driving never meets it — and it tightens with the square of speed, so it only refuses the
demands no tyre could answer anyway.

| scene / car          | fitted 0.6 × lock | full lock + the original's limiter |
| -------------------- | ----------------- | ---------------------------------- |
| u-turn, comet        | 18.0° → yaw 0.932 | **30.0° → yaw 1.302**              |
| u-turn, admiral      | 16.8° → yaw 1.135 | 28.0° → yaw 0.611                  |
| step-steer, both     | (limiter inactive — the 0.15 input asks for less than it allows) |

Read honestly: the comet turns better, the admiral turns WORSE at full lock. The u-turn is a full-lock scene —
the pathological input — and the admiral's fitted run is not a clean comparison (35 g of impact and 2.33 s
airborne in it: it crashed, and some of that yaw is the crash). A rear-drive sedan asked for full lock at
40 km/h scrubbing its front tyres wide is also what a real one does. The case the field complained about is
the ordinary one, and there the change can only help: the angle is no longer capped below what a corner asks.

Runs: `2026-07-26-headless-steering-{admiral,comet}.json`.

### 2026-07-26 — ride height from the AUTHORED centre of mass (081/03, a real defect)

**Field report** (user, with screenshots): *"the stock turismo is very slammed"* and *"the romero is tipped
backwards"*. The second one was a genuine bug and the capture found it in one run, once the capture learned to
record what the car is STANDING on (a new `stance` block: per-wheel spring length, load, radius, and the share
of the car's weight its springs carry).

```
romero, before:  rear spring length -0.033 m  load 8654 N     <- NEGATIVE: compressed past its own rest point
                 front spring length +0.073 m  load 3601 N
                 rear sits 71 mm low, front 46 mm high -> 12 cm of rake, +1.67° nose up
```

The ride-height compensation raises each wheel's connection by `restLength − sag` so the wheel sits at the
model's hub when standing. Its `sag` assumed **every corner carries a quarter of the car**. The romero authors
its centre of mass 0.8 m back — it is a hearse — so its rear corners carry **71 %** of a 2.5 t body and sank
far past the assumption, while the front floated above it.

Now each corner's sag comes from the load it actually carries, by the lever rule about the authored centre of
mass. The rule was checked against the solver rather than assumed: it predicts the romero's 29 % front axle
share against a measured 29.4 %. The same load also feeds the bump stop, so a heavily-loaded axle gets the
stiffer spring it needs instead of being clamped by a rule that thought it was carrying a quarter of a car.

| car      | rake before | rake after | shortest spring before → after |
| -------- | ----------- | ---------- | ------------------------------ |
| romero   | **+1.67°**  | **+0.09°** | **−0.033 m → +0.018 m**        |
| admiral  | −0.58°      | −0.34°     | +0.074 → +0.086 m              |
| turismo  | −0.50°      | −0.63°     | +0.146 → +0.149 m              |
| comet    | +0.03°      | +0.00°     | +0.015 → +0.018 m              |
| infernus | +0.00°      | +0.00°     | +0.019 m (unchanged)           |

No spring is past its rest point on any car now, and every car stands within a few tenths of a degree of level.

The turismo, measured, is **not** riding on its belly: 99.9 % of its weight is on its springs with four wheels
in contact. **The rest of this verdict was wrong and is corrected by the 2026-07-27 audit**: "it settles 5 mm
into a 15 cm travel" compared the spring LENGTH (0.149 m) to the TRAVEL (0.150 m) — the capture's own numbers
give `restLength 0.200 − suspensionLength 0.149 = 5.1 cm` of sag, 34 % of the travel, on the 35 % clamp. The
field complaint was dismissed on a number wrong by 10×. The actual cause of the slammed look — the
wheel-at-hub standing pose, which sits a car's body low by `|lowerLimit| − rest deflection` against the
original's own `SetupSuspensionLines` law, worst exactly on the turismo's fleet-largest |lower| = 0.20 — is
the audit addendum's second finding (`docs/audit/vehicle-physics-081.md`). Its wheels do also differ by axle
(`vehicles.ide` gives it 0.7 front / 0.75 rear).

One number in this is a MEASURED BRIDGE and is flagged as such in the code: the sag-per-rate constant. A force
probe gave 1.43; solving the same relation from four settled cars gives 1.06…1.21, and 1.15 is used, with a
±7 % residual (under a centimetre of ride height). Rapier's settled length is not purely its spring — the
damping and relaxation terms are in it too — and closing that properly means solving the controller's
equilibrium rather than probing it.

Runs: `2026-07-26-headless-stance-{before,after}.json`.

### 2026-07-26 — the handbrake is a REAR-AXLE LOCK, and `fBrakeBias` (for real this time)

**A correction first.** The commit before this one claimed `fBrakeBias` had shipped. It had not — the edit to
`physics-world.ts` was lost when the script that made it aborted half way, so that commit carried only the
coast brake. The savanna's improvement recorded there (`+0.65° nose-up → −1.48° nose-down under braking`) was
therefore produced by the OTHER changes of the day (tyre grip, ride height, damping), not by the bias. With
the bias genuinely applied the numbers barely move again — see below — so its real verdict is a **null result
on these cars**, which is what their near-neutral rows (0.52…0.63) should produce.

| car     | `fBrakeBias` | dive   | brake distance | decel  |
| ------- | ------------ | ------ | -------------- | ------ |
| admiral | 0.63         | −0.73° | 39.9 m         | 0.58 g |
| comet   | 0.55         | −0.39° | 32.0 m         | 0.91 g |
| savanna | 0.52         | −1.45° | 48.9 m         | 1.00 g |

**The handbrake.** The original does not give the lever a bigger brake — `CAutomobile::ProcessCarWheelPair`
replaces the REAR wheels' brake with 20 000 and leaves the front alone. Locked rear wheels spend their whole
friction circle on braking, so they have nothing left for cornering, and the car rotates about a front axle
that still grips. That is the handbrake turn, and it needs no separate "grip cut" to model: our per-wheel grip
clamp already means a locked wheel brakes with exactly what its tyre has.

Ours now does the same: H locks the rears, takes the service brake off entirely, and the steering limiter's
handbrake exemption hands the driver full lock to hold and catch the slide with.

| car     | rotation through the turn | peak slip angle | peak yaw rate | flip |
| ------- | ------------------------- | --------------- | ------------- | ---- |
| admiral | **76.2°**                 | 12.8°           | 0.81 rad/s    | no   |
| comet   | 36.3°                     | 14.7°           | 0.48 rad/s    | no   |
| savanna | (spun)                    | **50.7°**       | 3.31 rad/s    | no   |

Before this, the lever applied the full service brake to all four wheels — it stopped the car in a straight
line, which is what "the brake works like a handbrake" meant when the field first complained about it.

`stopping` (the automatic halt before the player climbs out) moved onto the FOOT brake: it wants the car
stopped, not sideways.

Runs: `2026-07-26-headless-handbrake-brakebias.json`.

### 2026-07-26 — `fTractionLoss`: a wheel that has broken loose grips LESS (081/05)

**Field verdict**: *"Space and H feel the same."* Two separate causes, and the first one is an instrument bug.

**The `handbrake-turn` scene was pressing the wrong control.** It was written before the pedal and the lever
were split (081/04) and still sent `jump`, so every "handbrake" number in this record before today was
measured on the FOOT BRAKE. A scene that names one control and presses another cannot be caught by anything
except reading it.

**And the model was missing the half that makes a slide a slide.** `CVehicle::ProcessWheel` multiplies a
wheel's adhesion by `fTractionLoss` (0.72…0.85 on cars) once that wheel's state is not NORMAL — past the limit
a tyre does not merely stop giving MORE grip, it gives LESS, which is why the back steps out and stays out.
Rapier does not expose its `skid_info`, but it exposes the impulses, and a wheel sitting on its own friction
circle is the sliding one: last step's impulses drive this step's grip, the same one-frame feedback the
original runs (`bAlreadySkidding`).

Same manoeuvre, same build, only the control differs:

| car     | control | rotation | **peak slip angle** | speed at 7 s |
| ------- | ------- | -------- | ------------------- | ------------ |
| admiral | Space   | 61.8°    | 11.5°               | 21.9 km/h    |
| admiral | **H**   | 67.9°    | **40.9°**           | 17.2 km/h    |
| comet   | Space   | 53.3°    | 10.8°               | 16.2 km/h    |
| comet   | **H**   | 54.4°    | 10.6°               | 16.6 km/h    |

The admiral now does what a handbrake does: the back comes round to 41° of slip where the pedal holds 11°.

**The comet genuinely cannot tell them apart, and that is its own row.** It authors `fBrakeDeceleration =
21.73` — 2.2 g of braking against a 0.67 tyre — so its FOOT brake already locks all four wheels every time it
is touched. On that car the pedal IS a handbrake, because a mod asked for race brakes. Nothing to fix in the
engine; worth knowing before testing handbrake feel on it. (SA's `abs` flag is the thing that would modulate a
lock, and it is still unread — noted in 04 §3.)

Runs: `2026-07-26-headless-tractionloss-lever-vs-pedal.json`.

### 2026-07-26 — the handbrake finally lets go (and the scene that can see it)

**Field verdict, three times**: *"Space and H work the same."* The F2 tab settled the first question — the
lever registers (`gear / handbrake` reads `UP`), so this was never input plumbing. Two real causes remained.

**1. No scene could see it.** `handbrake-turn` stands on FULL lock, where the car slides whatever you press.
The new **`handbrake-flick`** scene is how a player actually uses a lever: 60 km/h, 0.4 of steering held, then
H for 1.5 s. It is the pedal-vs-lever discriminator the record was missing.

**2. Rapier weighs the friction circle UNEVENLY.** In `update_friction` the check is
`(forward × 0.5)² + (side × 1.0)² > (μ × load × dt)²`. A wheel braking at its full grip has therefore spent
only half of its circle, and keeps up to **87 %** of its lateral capacity — a "locked" rear axle stays
planted. The lateral cut has to be explicit and nearly total:

| locked wheel keeps | body slip before the lever → after | rotation |
| ------------------ | ---------------------------------- | -------- |
| 15 % of side grip  | 2.3° → **5.7°** (imperceptible)    | 98°      |
| **3 %**            | 2.3° → **33.0°**                   | **134°** |

At 3 % the flick works on every car tested, with no flips: admiral 2.3° → 33.0°, comet 0.9° → 17.1°, savanna
0.1° → **87.9°**. It applies only while the lever is up, so nothing else in the fleet's behaviour moves.

Runs: `2026-07-26-headless-handbrake-flick.json`.

### 2026-07-27 — THE REGRESSION PACK: the shipped feel, frozen (5 cars × 11 scenes, 55 of 55 laps)

The accepted state, recorded so a later change has something to be measured against — 081/07 §2, and the
capture matrix 081/09 shipped without (its ledger's coverage note). **Pak: the canonical
`./build/original/opensa`, `pak/manifest.json` buildTime `08:41 24-07-2026`, cellSize 250, 1 272 901 632 B**
— the same pak as the whole 07-26 record, so these laps are comparable with it. Code at commit `e50d913`
(081/09 shipped: the lateral speed-grip assist and the `SLIDE_SPEED` unit fix). **Dials at their shipped
defaults, `gripVd 12` / `gripCap 3`, and every capture says so itself** (`speedGrip` block). Headless via the
bench harness (M3 Pro, ANGLE/Metal); infernus was swept alone, the other four in pairs — the physics is
fixed-step, so machine load does not enter the numbers.

Cars: infernus · admiral · firetruk · comet · turismo (sports · sedan · heavy · the reported flipper · the
stance case). The gate that reads them: `npx tsx scripts/phys-regression.ts sweep-*.log`.

| car      | brake-strip top | 0–100  | brake                | sweeper turned | u-turn                |
| -------- | --------------- | ------ | -------------------- | -------------- | --------------------- |
| infernus | 126.4 km/h      | 5.43 s | 65.5 m / 4.22 s      | −0.2° (hit)    | 275.7°, roll −72/+82° |
| admiral  | 70.8 km/h       | never  | 40.1 m / 4.40 s      | −88.5°         | 48.3°                 |
| firetruk | 64.0 km/h       | never  | 27.0 m / 4.82 s      | −15.3°         | 35.8°                 |
| comet    | 80.6 km/h       | never  | 31.4 m / 3.08 s      | −65.7°         | **FLIPS** (roll ±180) |
| turismo  | 135.7 km/h      | 4.78 s | 70.1 m / 4.23 s      | −0.2° (hit)    | 12.7°                 |

**The replay was measured, not assumed.** The infernus sweep was run a second time, under three-way parallel
load, and diffed against the first: **nine of the eleven scenes reproduced to the second decimal** (max |Δ|
0.01 on every summary field AND every series column — rest, brake-strip, step-steer, sweeper, slalom,
kerb-strike, handbrake-turn, handbrake-flick, pull-away-reverse). The two that did not are `u-turn`
(topSpeed 79.8 → 70.8 km/h, roll −72.5 → −58.3°, airborne 4.13 → 3.45 s) and `crest-jump` (gLat 9.2 → 30.1,
slip 30.1 → 67.1°, turned −16.3 → −37.3°) — the two laps where this car spends seconds in the air and comes
down on ground the streamer decides. **That is what the pack's per-scene widening is sized from**, ~1.5× the
measured spread, and it is why those scenes gate coarsely (`scripts/phys-regression.ts` carries the numbers
at the constant).

**Read before trusting a cornering number from this matrix: eight of the eleven scenes register impact-class
spikes** (50–300 g longitudinal), the sweeper included — on the two fastest cars (infernus, turismo) the lap
meets something ~1 s into the corner and never comes round at all, which is why their `turnedDeg` reads ≈ 0
while the slower admiral and comet arc 88° and 66°. This is not new — every matrix in this record back to the
BEFORE set has the same spikes — but it caps what the pack can prove on those laps, and it means a "turn-in
at speed" verdict taken off the sweeper is partly a record of where the wall is. Cleaning the scene ground
(or shortening the run-up) is owed; it would make those laps incomparable with everything above, so it is a
deliberate step, not a fix to slip in.

Runs: `2026-07-27-headless-shipped-{infernus,admiral,firetruk,comet,turismo}.json` — the pack itself. A
re-record is a deliberate act: new captures, the new prefix in `scripts/phys-regression.ts`, a row here, and
the field verdict that accepted the new feel.

### 2026-07-27 — the grass corner: what surface grip is actually worth (081/10)

The instrument the step-5 A/B was missing. **`grass-corner`** starts the car ON grass — Red County at
(400, 200), found by scanning the map's own COL faces for ground that is ≥ 70 % LOOSE-group with no prop
within 40 m, then sampling the ground Z across the patch for the flattest part (the first candidate was 89 %
grass but fell 9 m over 60 m, and a slope confounds a corner with gravity). The lap reports what it drove on
and there is no tarmac in it: **grass_medium_lush 38 % · p_sandbeach 31 % · grass_short_lush 17 % ·
p_grassmid1 14 %**.

Comet, same lap, `?surfGrip=0` against the default:

| signal              | every wheel on tarmac | grip from the surface |
| ------------------- | --------------------- | --------------------- |
| top speed           | 71.91 km/h            | **52.71** (−27 %)     |
| settled yaw rate    | 34.83 °/s             | **21.67** (−38 %)     |
| heading come round  | −272.4°               | **−186.2°**           |
| slip peak           | 10.4°                 | 6.7°                  |
| yaw rise            | 0.10 s                | 0.15 s                |

**Both directions move, and that is the point**: LOOSE is 0.71 of tarmac and SAND 0.67, so the tyre has less
to give the drive as well as the corner — the car cannot put its power down on grass and cannot carry the
same speed through it. The yaw falls further than the grip does (−38 % against −29 %) because the steering
limiter is now given the same adhesion the tyres are, so it grants proportionally less lock as well; that
coupling is deliberate (a limiter promising what the tyre cannot pay is the 081/09 complaint's mechanism).

Runs: `2026-07-27-headless-grasscorner-off-comet.json` · `2026-07-27-headless-grasscorner-on-comet.json`.

### 2026-07-27 — grip from the SURFACE: the A/B, and why tarmac cannot move (081/10 step 5)

Same pak and harness. Comet, 12 scenes, run twice: `?surfGrip=0` (every wheel on tarmac, the old world) and
default (grip read from `surface.dat` through the material under each wheel). Every capture states which one
it drove in — `surfaceGrip: true|false` — and what it drove on (`summary.surfaces`).

**Seven of the twelve laps are identical to the decimal**: rest, brake-strip, sweeper, slalom, kerb-strike,
kerb-mount, pull-away-reverse. They run on `default`, `tarmac` and `pavement`, all of which are adhesion
group ROAD, and the road cell divides out of the scale — so tarmac feel is unchanged by construction.

**`crest-jump` is the one lap that spends real time off the road** (grass 6 %, dirt 11 %):

| signal      | tarmac-only | surface grip |
| ----------- | ----------- | ------------ |
| top speed   | 126.06 km/h | **122.24**   |
| slip peak   | 35.8°       | **40.7°**    |
| lateral peak| 25.3 g      | 19.4 g       |
| roll peak   | 25.7°       | 24.2°        |

**SA's own classification is worth knowing before reading any of this**: `dirt` and `dirttrack` are group
ROAD — a dirt road grips like tarmac. LOOSE (0.71 of tarmac) is grass, gravel, hedges, meadow; SAND is 0.67;
HARD (rock, metal) 0.80; wet 0.62. Of 179 surfaces: 73 ROAD, 60 LOOSE, 29 HARD, 12 SAND.

**The record's own gap, stated plainly: no scene corners on grass or sand.** `handbrake-flick` reports 54 %
grass, but the grass arrives after the manoeuvre is over. Until a grass/sand cornering scene exists, this
A/B proves the change is SAFE (tarmac untouched) rather than that it feels right off-road.

Runs: `2026-07-27-headless-surfgrip-off-comet.json` · `2026-07-27-headless-surfgrip-on-comet.json`.

### 2026-07-27 — a kerb stops a car dead, and the scene that was supposed to prove it never met one (081/06 §2)

Same pak, same commit as the pack, plus the capture's new **`x` / `y` / `z` columns** — a lap can finally say
WHERE something happened, appended at the end of the row so every existing series stays index-comparable.

**First it falsified its own instrument.** `kerb-strike` does not test a kerb. With positions in hand: the
comet's lap ends against the traffic light at (2221.8, 1203.3) — 57 → 20 km/h — and the infernus meets
something at 100 g at (2170.5, 1225.3), in a Las Venturas plaza of bollards, palms and ramps. Every "kerb"
number in this record came off that lap. The scene stays as it is (the whole record is measured against it),
but it is a prop-collision lap, not evidence about kerbs. **The comet's flip that justified plan 06 §2
(20.6° → 179° when the angular-damping band-aid came off) does not reproduce at head either**: 14.2° of roll,
no flip, on any of the five cars — because the lap now ends on a pole, not because the mechanism was fixed.

**Then it measured the real thing** — after three scenes that did not. The new **`kerb-mount`** drives SQUARE
at a pavement edge off the power at ~25 km/h; where it points took three tries, and each try is a datum:

1. SF street, drifting into the kerb at 40 km/h → drove into the traffic light at (−2798.9, 293.4). The kerb
   line carries a lamppost or tree every ~12 m and a light at every junction corner.
2. SF street, square at the pavement, mid-block in the longest pole-free span → **every car stopped dead**:
   comet −62.1 g, admiral −61.3 g, infernus −68.0 g, **firetruk −47.8 g**. But the SF pavement is FLUSH in
   collision (z is dead constant as a car crosses it) and a spawn probe put the ground beyond it 1.7 m up:
   what stops the lap there is a BUILDING WALL. A wall is not a kerb, so these are filed separately.
3. LV, square at the plaza edge the `kerb-strike` comet demonstrably climbs at 57 km/h (z +40 cm) — a real
   pavement edge, and the one this scene now stands on.

| car (LV edge, square) | speed at the edge | what happened                     | gLong | gVert | climb |
| --------------------- | ----------------- | --------------------------------- | ----- | ----- | ----- |
| comet                 | 27.9 km/h         | stopped, bounced back, stayed put | −61.0 | 5.5   | ~7 cm |
| firetruk              | 21.2 km/h         | stopped, no climb                 | −47.1 | 8.5   | ~5 cm |

**A car cannot get onto a pavement at all at town speed — and the same edge is climbable at 57 km/h and a
shallow angle.** That is the raycast-suspension weakness plan 06 §2 names: the downward ray cannot see a step
face, so the chassis collider meets it as a wall, and only momentum gets a car over. It reproduces on a
26 cm-clearance sports car and on a fire truck alike, which rules out ride height as the cause.

**FIELD VERDICT, same day: no problem in play.** Paraphrased: kerbs work well, including accelerating a comet
over one — the block could not be reproduced. Two follow-up checks explain the gap and close it: the lap
re-run with the throttle HELD returns numbers identical to the first (the edge arrives ~2 s in, before any
release — the car was always accelerating into it), and the SF probe showed most pavements are FLUSH in
collision, so there is usually no step to be stopped by. What LV has is a **40 cm ledge**, and a car stopped
by that at 25 km/h is behaving. **081/06 §2's kerb assist is parked as not-needed** — see the plan's ledger.

Runs: `2026-07-27-headless-kerbmount-baseline-{comet,firetruk}.json` (the LV kerb, the §2 baseline) ·
`2026-07-27-headless-kerbwall-sf-{comet,admiral,infernus,firetruk}.json` (the SF wall — a car meeting the
edge of the drivable surface square-on, kept because it is the cleanest four-car reproduction of the block) ·
`2026-07-27-headless-kerbstrike-located-{infernus,comet,admiral}.json` (the located `kerb-strike` laps).

### 2026-07-27 — air control (081/06 §1): the crest scene is a crest, the u-turn is the jump

The A/B for the in-air attitude control, `?airCtl=0` against the shipped `1`. Infernus, same pak
(`buildTime 08:41 24-07-2026`, cellSize 250), code at `7f8c592` + the §1 change, headless via the harness.
Every capture states its own `airControl` dial, like the speed-grip pair beside it.

| scene      | dial | longest flight | at    | nose over that flight | total air |
| ---------- | ---: | -------------: | ----: | --------------------: | --------: |
| u-turn     |    0 |     **3.27 s** | 4.23s |            **+24.4°** |    4.13 s |
| u-turn     |    1 |       1.93 s   | 4.23s |            **+35.6°** |    2.03 s |
| crest-jump |    0 |       0.45 s   | 10.52s|                −12.9° |    1.17 s |
| crest-jump |    1 |       0.20 s   | 6.33s |                 −5.0° |    0.62 s |

**Read the `at` column before the others.** On `u-turn` both runs launch from the same event at 4.23 s, so the
two rows are the same jump flown two ways: with the driver holding W the nose comes up **11° further** and the
car is back on the ground **1.3 s sooner** (a nose-up car meets the slope with its tail). That is the whole
measurement of §1, and it repeats — a second run of the shipped config returned the identical capture.

On `crest-jump` the two runs do not even pick the same flight (10.52 s against 6.33 s), because the scene is a
CREST, not a jump: its longest unbroken flight is a fifth to a half of a second, and the debounce that keeps a
kerb from rolling the car eats 0.15 s of it. Its 1.13 s of `airborneS` is a dozen hops, not a flight — which
is why the summary gained `air { atS, seconds, pitchDeg }` in this change: a total cannot answer whether the
driver was ever airborne long enough to have controls at all. **No air-control conclusion may be drawn from
`crest-jump`**, the same way none may be drawn from `kerb-strike` about kerbs. In the window it does allow
(0.2 s at the crest) the law measures exactly what it should: +0.9° of nose-up against the same lap flown with
`airCtl=0`, traces identical to the millimetre until the control engages.

Runs: [`2026-07-27-headless-aircontrol-off-infernus.json`](2026-07-27-headless-aircontrol-off-infernus.json) ·
[`2026-07-27-headless-aircontrol-on-infernus.json`](2026-07-27-headless-aircontrol-on-infernus.json).

### 2026-07-27 — the class sweep (081/07 §1): the tuning generalises, the SCENES do not

Five cars the chain never tuned against, one per class the calibration trio does not cover — **landstal**
and **sandking** (offroad, 4WD), **bus** (heavy, 6 wheels), **burrito** (van) and **picador** (pickup, and a
solid rear axle) — on four scenes each: `rest` · `brake-strip` · `step-steer` · `u-turn`. Same pak
(`buildTime 08:41 24-07-2026`), code at `6b0ab82`, headless.

| car      | mass | weight on ground | static sag (share of authored travel) | 8.5 s from rest | braking      | dive   |
| -------- | ---: | ---------------: | ------------------------------------- | --------------: | ------------ | -----: |
| landstal | 1700 |            0.999 | 18 % × 4                              |    128.1 km/h   | 80 m @ 0.80g | −0.66° |
| sandking | 2000 |            0.999 | 42/43 %                               |    129.7 km/h   | 73 m @ 0.91g | −0.61° |
| bus      | 5500 |            0.999 | 38 % front · 17 % · 13 %              |     53.0 km/h   | 32 m @ 0.35g | −1.11° |
| burrito  | 1900 |            0.999 | 38 % front · 28 % rear                |     63.1 km/h   | 24 m @ 0.64g | −2.11° |
| picador  | 1600 |            0.999 | 38 % front and rear                   |     65.4 km/h   | 24 m @ 0.70g | −1.78° |

**The stance law generalises — that is the headline.** Every car of every class sits on all four (or six)
wheels with 99.9 % of its weight on the ground, at 13–42 % of its authored travel, none on its bump stops,
and the per-corner loads sum to `mass × g`. A six-wheeled bus loads its front axle twice as hard as either
rear one and its springs answer accordingly.

**Longitudinally the classes differ exactly the way their rows say they should**, so the class-factor table
this section exists to fill is **empty by measurement**. The two 4WD offroaders pull **4.2 m/s²** and are
engine-limited. The van and the pickup author the SAME `fEngineAcceleration` (25) and pull **2.2 m/s²** —
because they are rear-drive, and `μ × rear-axle load / mass` is 2.9 m/s² for them: they run against the
longitudinal clamp 081/04 ported from `CVehicle::ProcessWheel`, with drag taking the rest. The bus is neither:
at 1.8 m/s² it is short of its own 4.9 m/s² grip ceiling and simply has `fEngineAcceleration` 14 to move
5.5 tonnes with. Three classes, three different limits, all of them the car's own numbers. A bus stops at
0.35 g on the fleet's lowest
authored `fBrakeDeceleration` (4.17) and an offroader at 0.89 g. **Every class dives** (−0.6…−2.1°), where
the whole chain started at +0.07° nose-UP.

**What does NOT generalise is the instrument set, and the numbers say so plainly:**

- `brake-strip` puts the brake on at ~8.5 s, and all five cars are still ACCELERATING there. For the
  calibration trio that column reads as a top speed; for a bus it reads "how far it got in 8.5 s". No
  top-speed conclusion may be drawn from these rows.
- `step-steer` and `u-turn` hit scenery with a vehicle wider or taller than the trio: the bus turns **0.28°**
  over its whole step-steer lap and registers ±20 g, the burrito's u-turn ends on its roof at 0.3 km/h after
  a −80 g impact and 3 s of air. These are the impact spikes 07 §3 recorded, and on wide vehicles they arrive
  early enough to eat the manoeuvre. **No cornering or flip verdict per class off these laps** — the owed
  "clean ground for the scenes that leave the road" is now owed twice.

Runs: `2026-07-27-headless-classes-{landstal,sandking,bus,burrito,picador}.json`.

### 2026-07-27 — camera slip survey (the 080 revision): what the drift channel now sees

Plan 080/05's drift framing reads the SAME `planarMotion` slip the capture's `slipAngle` column records —
radians, unit for unit — so these three infernus laps are direct readings of the camera's input under the
CURRENT physics (after the SLIDE_SPEED fix, 081/09's speed-grip assist and 081/10's surface grip; all three
landed AFTER the camera's drift gates were last tuned, when the physics "barely slid at all" and the dead
zone was cut 0.14 → 0.05 rad to compensate). Slip stats over steered rows (|steer| > 0.05) above the
camera's `driftMinSpeed` 6 u/s, against `driftSlipDeadZone` 0.05 rad (fade-in full at 2×, 0.10):

| lap | domain | slip median | p90 | max | > dead zone | > 2× (full lean) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `u-turn` | hard low-speed manoeuvring | 0.027* | 0.161* | 0.286 | 37 %* | — |
| `sweeper` | 0.4 steer held at speed (top 31.4 u/s ≈ 113 km/h) | 0.011 | 0.040 | 0.494 | 7 % | 4 % |
| `grass-corner` | off-road (surface grip 0.71) | 0.058 | 0.082 | 0.113 | 59 % | 1 % |

\* u-turn stats are over ALL rows above 6 u/s (its full-lock lap steers throughout).

**The distribution is exactly the shape the camera wants**: hard manoeuvring engages the lean fully (slip
0.16–0.29 rad → lean up to ~8° at `driftLookBlend` 0.5); grass sits mostly in the fade-in band (lean
~0–1.7° — engaged but subtle); held cornering at speed stays OUT (median 0.011, inside the dead zone) with
only transient spikes (max 0.494 for a frame or two at a breakaway, filtered by the 0.35 s yaw damp). The
channel that field round 06/1 reported as invisible is now ALIVE in its intended domain and quiet outside
it — which is what makes 05's owed drive round finally able to judge `driftLookBlend`/`driftSlipDeadZone`
as tuning rather than as dead code.

Run: [`2026-07-27-headless-camera-slip-survey-infernus.json`](2026-07-27-headless-camera-slip-survey-infernus.json).
