# 081/03 — Weight transfer and impact response

**Rewritten 2026-07-26, after 081/01-02 measured the things this plan was guessing about.** The original
brief opened with anti-roll bars and treated the flips as a cornering problem. The matrix says otherwise, and
two of its findings move the whole plan:

1. **Not one flip in the record is a cornering flip.** Three of five follow a vertical impact of 24-31 g
   (0.30 s, 0.85 s and 2.03 s later); the other two happen at **−1 and −6 km/h** — a car already
   destabilised, tipping slowly. The step-steer series is plainest: a full second of held lock produces
   **0.05° of roll**, and the car only goes over 1.2 s AFTER a 7.6 g kerb strike.
2. **The braking dive is not suppressed by the chassis damping.** The infernus pitches **0.15° under braking
   at damping 2.0 and at 0.5, identically** — and dropping the damping made impact flips worse while buying
   nothing. So the band-aid stays until this plan ships something real.

So this plan is no longer "four stability forces". It is **two questions, in order**: where does the weight
go when a car brakes, and what happens when a wheel meets an edge. Anti-roll and downforce survive as
smaller, later items, justified by their own numbers rather than by the flip complaint.

## 0. First, ANSWER a question the chain cannot proceed without

**Does the raycast controller transfer load at all under braking?**

Physics says it must: braking force acts at the contact patch, the centre of mass sits ~0.5 m above it, so a
1400 kg car at 1.7 g generates ~12 kN·m of pitch moment and the front springs should compress. The measured
answer is 0.15° of pitch, which is nearly nothing — and 081/02 proved it is not the damping and not the
spring rate (per-car springs changed the number by tenths).

That leaves one candidate: **Rapier's `DynamicRayCastVehicleController` may apply its engine/brake force at
the chassis centre of mass rather than at the contact patch**, in which case the pitch moment never exists
and NO anti-dive multiplier can ever produce a dive. This is cheap to settle and everything below depends on
it:

- An isolated Rapier test: a car at speed, full brake, read `wheelSuspensionForce` front vs rear across the
  stop. Load transfers ⇒ the moment exists and §1 is a tuning job. Load does NOT transfer ⇒ §1 becomes
  "apply the longitudinal tyre force ourselves, at the contact point", which is a different and larger task.
- Extend the `[phys]` capture with per-wheel load while doing it (the instrument rule from 081/02: measure
  what you are about to tune, and let the run say what it saw).

**Nothing else in this plan starts before this is answered in the ledger.**

## 1. Weight transfer under braking and power (the nose fix)

The complaint, quantified after 081/02, on a straight brake strip — positive is NOSE UP:

| Car      | Pitch while braking | Deceleration | Authored `antiDive` |
| -------- | ------------------: | -----------: | ------------------: |
| infernus |          **+0.15°** |      1.72 g  |                 0.4 |
| comet    |          **+0.45°** |      2.22 g  |                0.18 |
| admiral  |              −0.22° |      0.76 g  |             **0.0** |
| firetruk |              +0.06° |      0.53 g  |             **0.0** |

**Read the last column before designing anything.** Two of the four cars author `antiDive = 0.0` and they
brake correctly in the original game — so anti-dive is an ASSIST that shapes an existing transfer, never the
thing that creates it. A design that produces dive only where `antiDive > 0` is wrong on its face.

- If §0 says the moment exists: apply SA's own term — a pitch-compensation torque
  `T = antiDive × brakeForce × h_com` opposing the brake pitch moment, plus the mirrored
  `antiSquat × driveForce` for launch (keep a LITTLE squat; it reads as power). Then the sign comes from
  the physics and the multiplier only tempers it.
- If §0 says it does not: the longitudinal tyre force gets applied by us at the contact point, and the
  authored multiplier rides on top. Larger, and it is what makes the complaint fixable at all.
- `fBrakeBias` (0.51 / 0.55 / 0.63 / 0.45 on the trio + comet) is unread today and belongs here or in plan
  04 — a rear-biased brake is also what spins a car under braking, which the comet did before 081/02.

**Acceptance**: nose-DOWN pitch on every reference car, magnitude in a band recorded from the field round
(~1-3° for a sedan, tighter for a sports car), settling without porpoising. The `brake-strip` capture is the
instrument, and the BEFORE numbers above are what it is measured against.

## 2. Impact response (what the flips actually are)

Every flip in the record traces to a wheel meeting something. The mechanism is not exotic: a raycast wheel
sees the world through a downward ray, a kerb face is invisible to it until the wheel centre crosses the
edge, and then the whole penetration resolves in one step as a vertical impulse the spring cannot absorb —
24 to 31 g — which becomes body rotation because nothing else can take it.

- **The measurement first, again**: from the existing captures, correlate `gVert` spikes with the roll that
  follows (the ledger already has five cases). Then per case: was it a kerb, a landing, or a car-to-car hit?
  The `kerb-strike` and `crest-jump` scenes are the two controlled instruments.
- **Candidate mechanisms, in the order they should be tried** (each measured before the next):
  1. **Let the spring absorb it.** Travel and force cap are now per-car (081/02 §3) but the IMPULSE still
     arrives in one step. A contact-force clamp per wheel, or a sub-stepped suspension on large penetrations,
     may be the whole fix.
  2. **See the edge before hitting it.** A short forward probe per wheel converts a step ≤ ~0.25 m at low
     speed into a ramp instead of a wall (this is plan 06 §2's kerb assist, promoted here because the data
     says it is a STABILITY mechanism, not a polish one).
  3. **Cap what an impact can do to attitude.** A roll-rate limiter that engages only above a threshold —
     the honest, scoped replacement for the global damping (see §4).
- **Acceptance**: the four flips 081/02 fixed stay fixed; the fifth (infernus slalom) stops; a deliberate
  kerb strike at speed still hurts — SA punishes that and so should we.

## 3. Anti-roll bars — demoted, and justified separately

Still worth having, but NOT as the flip fix: the flips are impacts. What anti-roll bars are for is the roll
that cornering DOES produce — the infernus slalom still reaches 106.9° of roll after 081/02, and that is a
real number to reduce.

- Per axle `F = k_arb × (compressionLeft − compressionRight)`, applied down on the extended side and up on
  the other; an airborne wheel contributes 0. `k_arb` from `suspForce` × the axle's mass share (`suspBias`).
- Front-biased by default (understeer is the safe road-car bias); the per-class knob belongs to plan 07.
- **Do not tune this until §1 and §2 land** — a bar fights a symptom of both, and tuning it first would hide
  what they are supposed to fix.

## 4. Retiring the damping band-aid, with the evidence to do it

`CHASSIS_ANGULAR_DAMPING = 2` is still live because 081/02 MEASURED that removing it costs stability and buys
nothing: the dive does not change (0.15° either way) and impact flips get worse (step-steer roll −74° → −95°).

It comes off here, in the same change that ships §1 and §2, and the acceptance is the full scene matrix at
the new value against the 081/02 record — not an opinion. If a scoped roll-rate limiter (§2.3) is needed to
hold the line, that is the honest replacement: it acts on fast roll only and leaves pitch, yaw and slow body
motion alive, which is exactly what the global damping cannot do.

## 5. Downforce — last, and only if the numbers ask for it

A speed² term at the centre of mass, per class, for highway stability and jump attitude. **Deferred until
§1-§3 are measured**: nothing in the record currently blames high-speed instability, and adding a force with
no complaint behind it is how a chain acquires constants nobody can justify later. If the 03 field round
reports float at speed, it comes back with that verdict attached.

## Subtasks

- [~] **§0** Load-transfer test (isolated Rapier) + per-wheel load in the `[phys]` capture. Answer in the
      ledger BEFORE anything else starts.
- [~] §1 Weight transfer: whichever path §0 selects, + `brakeBias`, + tests on scripted wheel states.
- [~] §2 Impact response: correlate the record's spikes, then mechanisms 1→3, each measured before the next.
- [~] §3 Anti-roll bars, after §1-§2, with the slalom roll number as their justification.
- [~] §4 Damping to ≤0.5 + full matrix re-run against the 081/02 record.
- [~] §5 Downforce ONLY if the field round asks for it.
- [~] F2 Physics tab: live gains + per-system toggles (in-session A/B, the 080 pattern).
- [~] **Field round**: brake feel ("does the nose dip"), kerbs at low and high speed, flip resistance under
      abuse, plus a regression drive of everything since 02.

## Acceptance

- **Brake-strip: nose-DOWN on every reference car** — the sign flips, with a recorded band and a field
  verdict. This is the complaint the user has raised twice.
- **Zero flips in the matrix**, including the infernus slalom; a deliberate high-speed kerb strike still
  punishes.
- Angular damping at ≤0.5 with the matrix no worse than the 081/02 record.
- Fixed-step cost of everything added ≤ 0.05 ms for the player car (and this time it is measured — 081/01's
  equivalent clause was never isolated).

## Ledger

_(§0's answer first — everything below depends on it)_

### 2026-07-26 — §0 ANSWERED: the load transfers. The spring is 7× too stiff to show it.

An isolated Rapier test (a car at 42 m/s, full brake, per-wheel `suspensionForce` read across the stop):

| State           | Front load | Rear load | Front share |
| --------------- | ---------: | --------: | ----------: |
| at rest         |     6863 N |    6863 N |       50 %  |
| under power     |     4644 N |    9081 N | 34 % (squat — correct) |
| **under brake** | **13480 N** | **765 N** |  **94.6 %** |

**So the controller transfers weight, and hard.** The feared answer — that Rapier applies the brake force at
the centre of mass and no pitch moment exists — is WRONG, and the larger task it implied is not needed. The
transfer is even physically consistent with the deceleration we have (2 g × 0.5 m of COM height over a 2.8 m
wheelbase predicts ~4.9 kN of transfer; the measurement shows more because the deceleration is higher still).

**The dive is invisible for a different reason: the springs are far too stiff to move.**

| | Measured | A real road car |
| --- | ---: | ---: |
| Spring rate per wheel | **229 kN/m** | 20-55 kN/m (1.2-2.0 Hz) |
| Static deflection under its own weight | **1.5 cm** | 6-17 cm |
| Front-spring travel added by the braking transfer | **1.45 cm** | 10.7 cm |
| Resulting pitch over a 2.8 m wheelbase | **0.59°** | **4.36°** |

Doubling the load on a spring that deflects 15 mm under the whole car's weight moves it another 15 mm, and
15 mm across a wheelbase is half a degree. The car IS diving — by a distance no one can see.

**This redirects §1 completely.** Anti-dive REDUCES dive; the car has none to reduce. The lever is the
reference spring rate that everything scales off — `SUSPENSION_STIFFNESS = 120`, tuned in-browser for a car
that must not sink into the road, and about **7× a real one**. `fSuspensionForceLevel` multiplies that
reference, so every car in the game inherits the error.

It also explains three complaints at once, all of which have been treated separately until now:
- **no dive under braking** (this measurement),
- **0.05° of roll under a second of held lock** (081/01's step-steer — same stiffness, same reason),
- **"a kerb flips it, like cardboard"** — a spring that cannot deflect cannot absorb an impulse, so the
  impulse becomes body rotation. §2's first candidate mechanism was "let the spring absorb it"; it now has a
  number attached.

**What §1 becomes**: soften the reference rate toward a real one, and re-verify what it was raised to prevent
— the launch hop and the chassis sinking into the road on soft, under-damped springs (the 074 field lesson
the constant's comment records). Damping scales with the rate, so the two move together; the `rest` scene and
the brake-strip capture are the instruments, and the whole matrix is the regression net.

**Estimated size of the change**: one constant, one damping ratio, and a very careful measured walk down —
because the last time this chain changed a suspension number by 10 % a parked car started shivering.

### 2026-07-26 — §1 SHIPPED: the nose dives, on every car

Two changes, both derived from §0's measurement rather than tuned:

1. **The mass term is gone from the stiffness.** Rapier already multiplies by chassis mass (`force =
   stiffness × compression × mass × 1.43`, probed across 1400 kg and 6500 kg), so 081/02's mass normalisation
   double-counted and the rate grew with mass² — the firetruck was riding a spring that sagged **3.3 mm**
   under its own weight. Without it, static sag is a function of stiffness alone, so every car sits at its
   design height whatever it weighs.
2. **The reference rate went 120 → 34**, targeting ~5 cm of static sag against the old 1.5 cm, and **damping
   is now DERIVED from the rate** (`ratio × 2√stiffness`, Bullet's relation) with the ratios taken from the
   pair tuned in-browser at 112. Softening a spring without rescaling its damping would have left every car
   damped for a seven-times-stiffer spring — and the high compression ratio preserves the 074 launch-hop
   lesson as a RATIO, so it survives the next rate change too.

**The result, measured on the brake strip — negative is NOSE DOWN:**

| Car      | Dive (mean pitch while decelerating) | Deceleration | Stiffness |
| -------- | -----------------------------------: | -----------: | --------: |
| infernus |                          **−0.97°** |       2.04 g |      37.1 |
| comet    |                          **−1.08°** |       2.32 g |      19.8 |
| admiral  |                          **−1.49°** |       0.94 g |      28.7 |
| firetruk |                          **−0.28°** |       0.53 g |      37.1 |

**The sign is right on all four**, and the heavy truck dives least — which is what a heavy truck on soft
springs does. The magnitudes sit at the low end of the plan's 1-3° band; the deceleration being 2 g on the
sports cars (plan 04) is part of why, since a shorter stop spends less time in the transfer.

**A metric had to be fixed to see it.** `pitchUnderBrakeDeg` is the PEAK nose-up while braking, and it fires
at the instant the brake bites — before the nose has come down. The comet reports **+1.65°** there while
actually diving to −2.58°. The whole BEFORE record was measured with it, so it stays for comparability, and a
new `diveDeg` (mean pitch over the frames that are really slowing) answers the question that was being asked.
The old field is not wrong; it was answering a different question, and nobody noticed for two plans.

**Still owed in §1**: `fBrakeBias` is unread, and the deceleration is too high — both plan 04. Anti-dive
(`fSuspensionAntiDiveMultiplier`) is NOT needed to produce dive, exactly as the authored zeros predicted; it
remains available to SHAPE it once 04 makes the braking force honest.

### 2026-07-26 — ride height, and what the dive is REALLY limited by

**Field report**: *"the car is now very low — even at rest the wheels sink into the asphalt."* Correct, and it
was the predicted cost of §1: softening the spring 3.5× moved static sag from 1.5 cm to 5-9 cm, and the wheel
geometry still assumed the old sag, so every car settled that much lower than the model was drawn.

**Fixed by raising the connection point by `restLength − sag` instead of `restLength`.** The wheel now sits
at its MODEL HUB when the car is STANDING, not when it hangs in the air — which is the pose the artist drew,
and it holds at any spring rate. The sag itself is `2 / stiffness`: the `1/k` shape is derived (Rapier's mass
term cancels against the weight it carries), the constant is FITTED (2.0 against the analytic 1.72) because
the load per wheel is not exactly a quarter of the weight. Measured across a 4× rate range: wheel bottom
0.490 / 0.499 / 0.502 m against a ground at 0.500.

**And then a surprise worth recording.** The comet's dive came out at **−8.1°** — far past the 1-3° band. The
obvious suspect was the spring, so the reference rate was probed at 34 / 50 / 70:

| Reference stiffness | Comet spring | Dive |
| ------------------: | -----------: | ---: |
|                  34 |         19.8 | −8.11° |
|                  50 |         29.1 | −8.02° |
|                  70 |         40.7 | −7.03° |

**Doubling the spring rate barely moves it.** The dive is not spring-limited any more — it is limited by the
BRAKE FORCE. At 2.3 g the transfer puts 94.6 % of the load on the front axle, the rear nearly lifts off and
extends to full droop, and the pitch that follows is mostly rear droop rather than front compression. Raising
the rate would only undo §1's improvement while treating a symptom.

So the reference stays at 34, and **the dive magnitude is now plan 04's problem, not this plan's**: make the
braking force honest (it has no mass term and no bias) and the transfer, and with it the dive, comes back
into band on its own. This is the second time in the chain that a suspicious number turned out to be owned by
the brake formula.

### 2026-07-26 — a geometric floor on sag: the comet stops standing on its stops

**Field report**: the comet's wheels were still through the road when every other car sat right, and its dive
had become "unnaturally smooth" rather than a dip.

The first half was geometry. The comet's modded row authors the **softest force level (0.64) and the shortest
travel (10 cm)** of the fleet — a lowered race Porsche. Our reference rate read "soft force" as "soft spring"
and produced **10.1 cm of sag against 10 cm of travel**: the car stood on its bump stops, and no wheel
geometry can be right from there.

The authored force level is **relative to the car's own suspension, not an absolute rate**. So the spring now
takes a geometric floor: static sag may not exceed 35 % of the travel the car actually has (real setups run
25-35 %, for exactly this reason). Measured after:

| Car     | Stiffness   | Sag              | Share of travel | At rest |
| ------- | ----------: | ---------------: | --------------: | ------- |
| comet   | 19.8 → **57.1** | 10.1 → **3.5 cm** |          35 % | vertical g 0.000 |
| admiral |        28.7 |           7.0 cm |          32 % | vertical g 0.000 |

Only the comet moves; every car with generous travel is untouched, which is what a floor should do.

The second half was the pedal: `FOOT_BRAKE_RAMP_TIME` went 0.45 s → **0.2 s**. A pedal is not a switch, but
it is not a dial either — a driver stabbing the brake reaches the floor in a couple of tenths, and the weight
should transfer at that pace. Dives now read −1.05° (comet) and −0.95° (admiral): present, sharp, in band.

### 2026-07-26 — field verdict on cornering

> *"Cornering is noticeably better — the entry is smoother at low and medium speed. At high speed, braking
> and turning together still snaps the car round."*

The first half is 081/02-03 doing their job (mass properties, per-car springs, real weight transfer). The
second half is **plan 05, and the mechanism is already visible in the data**: braking puts 94.6 % of the load
on the front axle, and with one shared `WHEEL_FRICTION_SLIP = 10.5` and `tractionMultiplier` / `tractionLoss`
/ `tractionBias` unread, that load becomes unlimited front grip — so the car pivots about a front axle that
cannot break away. Recorded here so plan 05 starts with the case already framed.

### 2026-07-26 — THE ORIGINAL'S OWN FORMULAS (the answer to "stop fitting, dig for the truth")

The user's rule, now in `CLAUDE.md`: never hardcode, and **dig out the original game's real mapping before
fitting a constant of our own**. The reversed source (`docs/links.md` → gta-reversed) has both halves.

**1. `cHandlingDataMgr::ConvertDataToGameUnits` — the units, settled.**

```cpp
ACCEL_CONST    = 1.f / sq(50.f);      m_EngineAcceleration *= ACCEL_CONST;  // ÷ 2 or 4 by drive type
VELOCITY_CONST = 0.277778f / 50.f;    m_MaxVelocity        *= VELOCITY_CONST;
                                      m_fBrakeDeceleration *= ACCEL_CONST;
```

The `50` is SA's physics rate and `0.277778` is 1/3.6, so the fields mean exactly what their names say:
**`fMaxVelocity` is km/h**, **`fEngineAcceleration` and `fBrakeDeceleration` are m/s²**. That CONFIRMS the
brake interpretation 081/04 arrived at empirically (reading `brakeDecel` as m/s² produced 1.02 g against an
authored 11) — and it condemns `MAXVEL_SCALE = 0.25`, which lands near the right answer for a 240 km/h car
by coincidence and is wrong everywhere else. The honest conversion is ÷ 3.6.

**2. `CPhysical::ApplySpringCollision` — the spring, settled.**

```cpp
fSpringForceDampingLimit = fSpringStress * m_fMass * fSuspensionForceLevel * 0.016f * fTimeStep * fSuspensionBias;
// fSpringStress = 1.0f - fSpringLength   (spring length NORMALISED, 1 = extended, 0 = fully compressed)
```

Three consequences, and two of them retroactively judge today's work:

- **The force is proportional to MASS.** Rapier does the same internally, so removing the mass term from our
  stiffness was right — now confirmed rather than inferred from a probe.
- **The compression is NORMALISED to the car's own travel.** A short-travel car is therefore stiffer in
  absolute terms at the same `forceLevel` — which is exactly the relationship the comet's bump-stop bug
  forced us to add as a "sag may not exceed 35 % of travel" FLOOR. The original expresses it as a
  consequence, not a clamp. **So our floor is the right relationship implemented as a patch**, and the fix
  is to express the spring the way SA does: `∝ mass × forceLevel × (1 − normalisedCompression) × bias`.
  `SUSPENSION_STIFFNESS` then stops being a tuning constant at all — it becomes SA's `0.016`.
- **`fSuspensionBias` is part of the spring force**, front/rear. We do not read it. That is the axle balance
  the anti-roll and anti-dive sections were going to approximate.

**What this costs and buys.** It is a redesign of §1's implementation, not of its conclusion: the dive, the
ride height and the flips all came out right, but they came out right through a fitted rate plus two floors,
where the original needs neither. Doing it SA's way removes `SUSPENSION_STIFFNESS`, the sag constant, the
sag-of-travel floor and the damping-scale clamps — four fitted numbers for one literal `0.016` and two more
authored fields being read.

**Owed, in order**: express the spring as above and re-run the matrix (the numbers must not get worse — the
current state is measured and committed, so this is a clean A/B); then `fMaxVelocity` ÷ 3.6 in plan 04, which
also kills `MAXVEL_SCALE`; then `fSuspensionBias` into the axle split.

### 2026-07-26 — the spring now IS SA's law, and it costs nothing to switch

The debt above, paid. `suspensionSetup` derives the rate as `SUSPENSION_LEVEL_SCALE × forceLevel / travel`,
which is what SA's `(1 − normalisedCompression) × mass × forceLevel × 0.016 × bias` reduces to once the
normalisation is carried through and Rapier's own mass multiplication is accounted for. Gone: the fitted sag
target as a RATE source, and the sag-of-travel expression as a first-class rule. Left standing: one bridging
scale (5.2, calibrated so a mid-range level sits at ~30 % sag, where road-car setups live) and the same
sag-of-travel line, now demoted to what it actually is — **a bump stop**, kept because SA has one and this
engine does not.

The A/B is as clean as this chain gets. Same head, same pak, same scenes, one derivation changed:

| car      | rate         | static sag          | dive under brake    | brake distance |
| -------- | ------------ | ------------------- | ------------------- | -------------- |
| infernus | 37.1 → 25.0  | 5.4 → 8.0 cm (32 %) | −0.48° → **−0.71°** | 96.1 → 96.1 m  |
| comet    | 57.1 → 57.1  | 3.5 cm (35 %, stop) | −1.05° → −1.05°     | 38.5 → 38.5 m  |
| admiral  | 28.7 → 26.0  | 7.0 → 7.7 cm (35 %) | −0.95° → −1.01°     | 50.5 → 50.5 m  |
| firetruk | 37.1 → 13.3  | 5.4 → 15.1 cm (32 %)| −0.50° → **−1.41°** | 90.7 → 90.7 m  |

**Braking is bit-identical on all four** (distance, duration, entry speed, longitudinal g), which is the
proof that the change is isolated: a spring does not touch grip, and nothing here says otherwise. Every dive
grows or holds. The firetruck is where the fitted rate was most wrong — it was riding at 11 % of its authored
travel, a 6.5 t truck on a go-kart spring, and now uses 32 % and dives nearly 3× as far.

The comet is the honest caveat: unchanged, because it sits on the bump stop in both states. Its authored
level (0.64) over its 10 cm of travel asks for **52 %** static sag, and no car can stand on half its travel
and still absorb a kerb. That is a real property of that modded row, not a defect in the law — the field
verdict after the ride-height fix was that the comet's wheels look right, and this run does not move them.

`rest` re-captured on all four: no airborne time, no tremor, static attitude only. Numbers in
`docs/benchmarks/vehicle-physics/readme.md` (`pedalbase` = baseline, `salaw` = after) — the older
`softspring` captures are NOT the baseline for braking, they predate the foot-brake pedal.

**Still owed**: `fMaxVelocity` ÷ 3.6 in plan 04 (kills `MAXVEL_SCALE`), then `fSuspensionBias` into the axle
split — the two remaining authored fields this reading of the original exposed.

### 2026-07-26 — `fSuspensionBias` reaches the springs, and the last 03 debt is paid

`CAutomobile::ProcessCarWheelPair` turns the column into `2 × bias` on the front springs and `2 − 2 × bias`
on the rear. `suspensionSetup` now takes the axle and applies it; `VehicleWheelSpec` gained the `front` flag
the caller was already passing (it comes from the model's own `wheel_?f` / `wheel_?b` dummy names, so it is
authored data, not a guess about wheel order).

**A null result on purpose**: all four reference cars author a neutral 0.5, and the infernus `brake-strip`
came back bit-identical (stiffness 25.0, dive −0.67°, 124.1 km/h, 52.7 m). ~90 of the table's ~220 rows are
not neutral, so the change speaks only when a row asks it to. The savanna (0.3, rear-leaning) is the
demonstration: front 19.05, rear 24.27, with the front sitting on the **bump stop** — a strong bias is partly
absorbed by the floor, which is exactly the floor's job.

It also broke the capture protocol in a useful way: `springs` recorded ONE wheel, on the assumption that the
set shared a spring. It records all four now — and the savanna proved wheel 0 is not reliably the front one,
because the order follows the model's frames.

**Noted, not fixed**: the savanna dives +0.65° (nose UP) where the trio dives ≈ −0.7°, which is backwards for
a car with the softer front. The suspect is the brake split — still equal across the axles with `fBrakeBias`
unread (plan 04 §3). With this, 081/03 owes nothing further; the drivetrain debts moved to 04's ledger.

### 2026-07-26 — the ride height was assuming every corner carries a quarter of the car

**Field report** (screenshots): the romero stands tipped backwards, the turismo looks slammed.

The capture could not answer either question, so it learned to: a `stance` block now records, once the car has
settled, each wheel's spring length, the load it carries, its radius, and **the share of the car's weight the
springs carry at all**. That last number exists for a failure mode nothing else reveals — a car resting partly
on its collision hull reads normal everywhere while its tyres, whose grip is `μ × load`, quietly stop working.

It answered both in one run — and the turismo half of the answer was WRONG, caught by the 2026-07-27 audit.
What is true: 99.9 % on its springs, four wheels in contact. What this entry originally concluded from that —
"5 mm into a 15 cm travel, its stance is the model's own" — compared the spring LENGTH (0.149 m) against the
TRAVEL (0.150 m): the capture's own numbers give `restLength 0.200 − suspensionLength 0.149 = 5.1 cm` of
sag, 34 % of the travel, sitting ON the 35 % clamp. The field complaint was dismissed on a number wrong by
10×; the real cause (the wheel-at-hub standing pose vs the original's near-droop rest) is the audit
addendum's second finding (`docs/audit/vehicle-physics-081.md`). The romero was broken:

```
rear  spring length -0.033 m   load 8654 N    <- NEGATIVE: compressed past its own rest point
front spring length +0.073 m   load 3601 N
=> rear 71 mm low, front 46 mm high: 12 cm of rake, +1.67 deg nose up
```

`suspensionSetup` raised each connection by `restLength − sag`, and `sag` was `2 / stiffness` — a constant
that quietly assumes **a quarter of the mass on every corner**. The romero authors its centre of mass 0.8 m
back (it is a hearse), so its rear carries 71 % of 2.5 t and sank straight through the assumption.

Each corner's sag now comes from the load it actually carries, by the lever rule about the AUTHORED centre of
mass — verified against the solver, not assumed: it predicts the romero's 29 % front share against a measured
29.4 %. The same load feeds the bump stop, so a loaded axle is given the stiffer spring it needs.

| car      | rake before | rake after | shortest spring          |
| -------- | ----------- | ---------- | ------------------------ |
| romero   | **+1.67°**  | **+0.09°** | **−0.033 → +0.018 m**    |
| admiral  | −0.58°      | −0.34°     | +0.074 → +0.086 m        |
| turismo  | −0.50°      | −0.63°     | +0.146 → +0.149 m        |
| comet    | +0.03°      | +0.00°     | +0.015 → +0.018 m        |
| infernus | 0           | 0          | +0.019 m (unchanged)     |

**This is also the second time an assumption of "even quarters" has cost a session.** The first was the
emergent centre of mass in 081/02 (an equal mass share per COL primitive). Anything that divides a car by
four is now suspect by default.

The sag-per-rate constant is a MEASURED BRIDGE and says so in the code: a force probe gave 1.43, solving the
same relation from four settled cars gives 1.06…1.21, 1.15 is used, residual ±7 % (under a centimetre of ride
height). Rapier's settled length carries its damping and relaxation terms too; closing it properly means
solving the controller's equilibrium instead of probing it.

### 2026-07-27 — the standing pose follows the original's own rest law (the turismo verdict corrected)

The 2026-07-26 entry above dismissed "the turismo looks slammed" on a mis-read number (corrected in place).
The audit that reopened it (`docs/audit/vehicle-physics-081.md`, addendum) found the pose RULE wrong, not
just the number: SA rests a car near full droop — `SetupSuspensionLines` computes the standing compression
as `1 − 1/(4 × forceLevel)` of the span `upper − lower` (per corner `share/(forceLevel × axleBias)`,
consistent with `ApplySpringCollision`'s `0.016` against gravity `0.008` at the raw bias) — so the wheel
rests `|lower| − that deflection` BELOW its dummy, and the body correspondingly high. The wheel-at-hub rule
this plan shipped sat every body low by exactly that, in proportion to `|lower|`: turismo (−0.20) ~12 cm,
admiral (−0.15) ~10 cm, infernus (−0.10) ~5 cm, comet (−0.05) ~2 cm — the gradient that let the fleet pass
seven field rounds while the turismo kept being called out.

`suspensionSetup` now derives the per-corner rest offset from that law (`hubOffset`), the connection raise
carries it, and the DRAWN wheel follows the physics spring length instead of the dummy (06 §3's travel
channel, landed early as this fix's dependency: `RigidEntity.setPartTranslation` + the rig's smoothed lift).
Pinned by a twin-car test: +0.10 m of |lower| stands the body 7.7 cm higher, where the old rule read 0.
Field verdict: pending. Still owed: an absolute ride-height probe — no capture yet measures body-to-ground.

### 2026-07-28 — the pose law is only as good as the handling row under it (field: "the cars are jacked up")

The first field verdict on this law came back as **wrong stance on many gostown cars** — a 1965 Mustang
standing on stilts, its wheels hanging clear of the arches. The law was not at fault and neither was the
physics: those cars were running **stock handling rows**. Their mods ship the modloader-style
`*.settings.txt`, 8 of the 10 saved as UTF-16, and `vehicle-installer` read every one as UTF-8 — every block
came out NUL-interleaved, classified as nothing and was dropped in silence, so `handling.cfg`,
`vehicles.ide` and `carcols.dat` all kept stock values under a mod model (fixed: `decodeSettings`).

Because the pose is `fraction × (|lower| + upper) − |lower|`, a wrong row lands directly on ride height.
Per car, the rest offset the mod authors vs the stock row it was actually running (share 0.25, its own
axle bias — how much higher the body stood than the author drew):

| car | mod row (force / upper / lower) | rest offset | stock row it ran | rest offset | body too high |
| --- | --- | --- | --- | --- | --- |
| stallion | 0.917 / 0.195 / −0.045 | +2.0 cm | 1.2 / 0.30 / −0.20 | −9.6 cm | **11.6 cm** |
| hermes | 0.79 / 0.26 / −0.08 | +2.8 cm | 1.0 / 0.35 / −0.20 | −8.1 cm | 10.9 cm |
| yosemite | 0.903 / 0.20 / −0.10 | −1.7 cm | 1.0 / 0.24 / −0.20 | −9.0 cm | 7.3 cm |
| banshee | 0.92 / 0.10 / −0.05 | −0.9 cm | 1.6 / 0.30 / −0.15 | −8.0 cm | 7.0 cm |
| alpha | 0.85 / 0.15 / −0.05 | +0.4 cm | 1.2 / 0.30 / −0.15 | −5.6 cm | 6.1 cm |
| comet | 0.90 / 0.20 / −0.10 | −1.7 cm | 1.4 / 0.28 / −0.15 | −7.3 cm | 5.7 cm |
| stratum | 0.60 / 0.15 / −0.08 | +0.6 cm | 1.0 / 0.28 / −0.16 | −5.0 cm | 5.6 cm |
| supergt | 0.64 / 0.10 / −0.05 | +0.9 cm | 1.0 / 0.25 / −0.10 | −1.3 cm | 2.1 cm |

The two mods whose settings files are plain ASCII (admiral, petrol) merged all along and were never
reported. **Method note**: the stance law makes a car's authored suspension row VISIBLE at a glance — a car
standing wrong is now a first-class signal that its data never arrived. Whether the law itself is right for
mod GEOMETRY is still open: the mustang's own dummies sit at `z −0.485` with a 0.362 m wheel, so its
authored row puts the wheel 2 cm above the dummy — that is the prediction the next field look tests.
