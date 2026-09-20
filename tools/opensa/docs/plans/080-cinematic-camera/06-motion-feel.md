# 080/06 — Motion feel: bob, landing dip, impact shake, FOV kick (behaviours 7, 8)

The additive layer (`camera-motion.ts`) — the LAST transform before `CameraState`, applied on top
of the collision-resolved pose. Small numbers, big perceived quality; also the layer most likely
to cause discomfort, so it ships with a master off-switch and conservative defaults.

## Ground rules for this layer

- **Additive and bounded**: the layer outputs an offset (eye + look point moved TOGETHER for bob —
  translating both avoids the nauseating aim-wander of rotating bob) plus an optional small roll…
  no, **no roll** — roll is the fastest route to motion sickness and GTA V uses none on foot.
  Offsets are hard-capped at 0.15 m, below 04's collision margin (sphere radius ~0.35), so bob can
  never push the eye through a surface — the layer needs no casts of its own.
- **`reducedMotion: true` zeroes the whole layer** (and 05's FOV kick) — one config flag, one
  Camera-tab toggle. Default OFF (effects on), but every effect also has its own scale.
- All oscillators are phase-continuous (phase accumulates by dt; amplitude damps in/out) — no
  restarts, no pops when speed crosses a threshold.

## 1. Bob (#7)

- Phase driven by DISTANCE TRAVELLED (`phase += speed × dt × k`), not wall time — bob frequency
  tracks stride naturally and freezes when the player stops (amplitude damps to zero).
- Vertical bob at stride frequency + lateral bob at half frequency (the figure-eight); amplitudes
  `bobAmplitude × speedFactor`, first guess 0.03 m walk / 0.05 m run — SUBTLE; the field round
  tunes downward if in doubt. Airborne ⇒ amplitude target zero (jump arcs are already motion).
- No bob in vehicles (suspension provides the life; 02's vertical channel already transmits a
  damped version of it).

## 2. Landing dip (#8a)

- Landing edge = `grounded` rising while previous vertical velocity < −2 u/s (the controller has
  no landing event; the director derives the edge from the snapshot — readme constraint 8).
- Response: a critically damped one-shot — eye dips by
  `landingDipScale × clamp(|impactVz| / jumpSpeed, 0, 2)` (first guess 0.06 m for a normal jump,
  capped ~0.12 m) and recovers in ~0.25 s via `smoothDamp` back to zero. Look point dips at half
  amplitude so the frame pitches down a whisker — reads as knees bending.

## 3. Impact shake (#8b)

- Trigger: vehicle collision impulse (Rapier contact force on the seated car — the damage system
  already observes collisions; reuse its signal rather than adding a second listener) and, later,
  heavy landings above 2× jump speed.
- Shape: damped noise, NOT sine — two-octave value noise sampled at ~15 Hz, amplitude
  `shakeScale × impulseFactor` decaying with `exp(−t/0.3)`, offsets only (no roll), capped 0.1 m.
  Deterministic PRNG seeded per shake from the frame's tick counter (no `Math.random` — testability
  - the workflow/date rule of the repo).
- Queueing: a new shake REPLACES a weaker active one, sums with amplitude cap otherwise.

## 4. Sprint FOV kick (readme addition)

- On foot, `run` active and speed near `runSpeed`: fov target +2…3°, damped slowly both ways.
  Same channel 05 uses; trivially small — its only job is making sprint feel faster.

## Subtasks

- [x] `camera-motion.ts`: bob oscillator (distance-phased, damped amplitude), landing one-shot,
      shake generator (seeded PRNG), FOV kick; the additive combiner with the 0.15 m cap.
- [x] Unit tests: phase freezes at rest; amplitude continuity across walk↔run; landing edge
      detection from scripted snapshots; shake decays deterministically for a fixed seed; caps
      hold under sum; `reducedMotion` zeroes everything.
- [x] Vehicle impact signal plumbed from the damage system's collision observation into the
      snapshot (one number: peak contact force this frame).
- [x] Config + Camera tab: `bobAmplitude`, `bobCyclesPerMetre`, `landingDipScale`, `shakeScale`,
      `sprintFovKick`, `reducedMotion` (+ the two "full at" references).
- [~] **Field round**: long walk (does bob read as life or as wobble?), stair runs, rooftop jumps,
      curb-hopping in a car, a deliberate wall crash. Explicitly ask for a comfort verdict, not
      only a looks verdict; tune down by default.

## Acceptance

- Effects visible in A/B (zero the channel on the debug Camera tab) but individually deniable in the tab;
  comfort verdict OK.
- All caps proven by test; collision layer untouched (motion applied after, bounded below margin).

## Ledger

### 2026-07-25 — code complete, AWAITING THE COMFORT FIELD ROUND

**What landed** — `apps/web/src/ui/camera/camera-motion.ts`, pure, stepped by the director and applied as
the LAST transform (after collision AND the floor guard, which is why the cap matters):

- **Bob** phased by DISTANCE travelled, so the frequency tracks stride for free and freezes at a standstill
  without any threshold logic. Vertical at stride frequency, lateral at half (the figure-eight), amplitude
  damped in/out by gait — crossing walk↔run eases, never steps, and the phase never restarts.
- **Landing dip**: an instant drop on the touchdown frame, recovered by `smoothDamp` over 0.25 s. The look
  point dips HALF as far, which is what pitches the frame a whisker and reads as knees bending.
- **Impact shake**: two-octave value noise at 15 Hz, decaying exponentially, from a deterministic per-shake
  seed (an LCG stepped per hit — no `Math.random`, so a crash replays identically in a test). A stronger hit
  takes over a weaker one with a fresh seed; a weaker one only adds amplitude.
- **Sprint FOV kick**: a couple of degrees as a run tips into a sprint. It contributes to the FOV TARGET, so
  it eases through 05's existing damp instead of getting its own channel.
- **Caps**: each effect is bounded and the SUM is capped at `MOTION_CAP` 0.15 m — inside the floor guard's
  0.3 m margin and well inside collision's sphere, so the layer needs no casts of its own. Proven by a test
  that fires a crash landing at a sprint with every scale cranked to 1.
- **No roll anywhere**, and eye + look point move TOGETHER for bob and shake: moving the eye alone swings
  the aim, which is the nauseating version of the same effect.

**Correction to this plan's §2.** It said "the controller has no landing event; the director derives the
edge from the snapshot". That was true when 080 was written — 088 has since given the controller real
`LOCOMOTION_LAND` / `HARD_LAND` / `COLLAPSE` states and `Locomotion.fallSpeed`. The host now reports the
EDGE into one of those states with its impact speed, so the dip is a genuine one-shot rather than something
inferred from a velocity sign (the same upgrade 03 made when it took `Locomotion.heading` over an atan2).

**The impact signal** comes from `VehicleDamageSystem.peakImpact(body)` — the damage system already observes
collisions, and `physics.takeImpacts()` DRAINS, so a second listener would race it and one of the two would
see nothing. It reports every contact, not only the `STRONG_HIT` ones that damage a panel: the camera should
react to a kerb the bodywork shrugs off.

**First-guess defaults (the comfort round tunes these DOWN by default)**

| field                 | value     | why this number                                                        |
| --------------------- | --------- | ----------------------------------------------------------------------- |
| `bobAmplitude`        | 0.05 m    | The plan's run figure. This is the knob that reads as life at 0.05 and as seasickness at 0.15. |
| `bobCyclesPerMetre`   | 0.7       | ~1.4 m per bob cycle — a stride. (The plan called this `bobFrequency`; phasing by distance made a cycles-per-metre name the honest one.) |
| `landingDipScale`     | 0.06 m    | The plan's guess for a normal jump; hard-capped at 0.12 internally.     |
| `landingDipFullSpeed` | 8 u/s     | The fall speed that earns the full dip; 2x it is the clamp.             |
| `shakeScale`          | 0.08 m    | Under the plan's 0.1 cap — a crash should jolt, not blind.              |
| `shakeImpactForce`    | 250 000 N | Between the damage system's own measurements (light ~207k, crash ~377k). |
| `sprintFovKick`       | 0.04 rad  | ~2.3°, the plan's "2-3°".                                               |
| `reducedMotion`       | false     | Effects on by default; the master switch is a Camera-tab toggle.        |

**Measured** (`docs/benchmarks/opensa-engine/2026-07-25-headless-080-camera-director.json`, microbench row
080/06): `stepCamera` **0.568 µs mean / 0.620 p95 on foot with the layer live**, against **0.399 µs with
`reducedMotion` on** — the layer costs **+0.17 µs (+42%)**, or +0.15 µs in a car. Absolute 0.0006 ms/frame.
Camera suite 153 green (+17), apps/web + packages/game 755 green; `tsc` + eslint clean.

### 2026-07-25 — FIELD ROUND 1: REJECTED. Bob was a vibration, and the camera fought the player

User's verdict, driving and on foot: **unsatisfactory**. Four reports, three of them real defects rather
than taste:

**1. "At a run the camera shakes so hard you cannot concentrate."** The bug was FREQUENCY, not amplitude.
`bobCyclesPerMetre` 0.7 at the 7 u/s run gait is **4.9 Hz** — a vibration, not a stride. A stride is ~1.7
per second. Fixed: **0.7 → 0.25** (1.75 Hz at a run) and `bobAmplitude` **0.05 → 0.025**, since an amplitude
chosen for a fast wobble is far too much for a slow one.

**2. "The corner swing is the only thing I saw, and it looks jerky."** A real discontinuity, and the same
CLASS of bug as 04's rejected multi-ray gate — a boolean latch in a continuous channel. Turn-follow arms on
a heading rate, then DISARMS the moment the camera is within `settleEpsilon`, which nulls the steered-yaw
target and **zeroes the swing spring's velocity**; a frame later the still-turning car re-arms it and the
swing restarts from a standstill. Through a long corner that is a series of hitches. Fixed: driving now
chases the target CONTINUOUSLY (`stepAutoCenter(..., { continuous: true })`) — no arm, no settle, one
uninterrupted spring. The latch stays on foot, where it is right: a framing the player chose must survive a
straight run.

**3. "The FOV kick and the drift lean — I never saw them."** Both were gated past what the game actually
produces. The vehicle kick ramped between 8 and **45 u/s** while a car's real cruising speed sits far below
that, so it delivered a couple of degrees and stopped; the drift lean needed **8° of slip** before it began,
and this physics (uniform `frictionSlip` 10.5, 081 has not touched it yet) barely slides at all. Fixed:
`vehicleFovMaxSpeed` **45 → 28**, `vehicleFovMinSpeed` 8 → 6, `driftSlipDeadZone` **0.14 → 0.05 rad** (~3°),
`driftMinSpeed` 10 → 6. The sprint kick had the same disease — it ramped 7 → 9.8 u/s against a sprint gait
of 10, so it only arrived at top speed: band 1.4 → 1.2 and `sprintFovKick` 0.04 → **0.07** (~4°).

**4. NEW BUG — walking backward span the camera.** Holding "back" about-faced the ped, the camera recentred
behind the new facing, which flipped what "back" MEANT, so the ped about-faced again: a loop the player
cannot break. This is the risk 02's ledger flagged ("auto-center rotates the camera, which rotates forward,
which curves a held strafe") arriving in its worst form, because movement is camera-relative and
`Locomotion.heading` follows the input. Fixed in the director: **auto-center is suspended while the framed
object travels TOWARD the camera** (`dot(camera forward, velocity) < 0`). Walking at the camera is a
deliberate act and the camera now holds still for it, which is also SA's behaviour; a reversing car gets the
same protection for free. Regression tests cover both the loop and the continuous chase.

### 2026-07-25 — FIELD ROUND 2: the retune ACCEPTED, four more findings

User: the bob, the corner swing, the sprint kick and the backing-up fix all read right now. Four follow-ups,
three of them bugs:

**1. "The landing dip on foot — I see nothing."** Not a wiring fault (a normal jump does reach
`LOCOMOTION_LAND`; the tier floor is a 1 u/s impact): the numbers were simply below perception. A 4.5 u/s
jump against `landingDipFullSpeed` 8 earned 0.56 of a 0.06 m dip — **3.4 cm**, which at a 7 m framing is a
third of a degree. Now `landingDipScale` **0.06 → 0.12** and `landingDipFullSpeed` **8 → 5**, so an ordinary
jump takes very nearly the full dip (internal cap 0.12 → 0.14 so a hard landing still reads harder).

**2. "A hard crash shakes LESS than a light one."** A real bug, and a good catch. A crash is not one contact
— it is a BURST of them across several frames. Every contact re-triggered the shake, and the re-trigger
restarted the noise clock (`shakeTime = 0`) and re-seeded, so the noise was sampled at almost the same point
every frame: a nearly STATIC offset instead of a jitter. A light tap is a single contact, so its clock
actually ran and it visibly shook. Fixed: the clock and the seed survive a re-trigger — a new hit only ever
RAISES the amplitude; re-seeding happens on the first hit after silence. A regression test now compares the
frame-to-frame spread of a sustained burst against a single tap.

**3. "Getting out, the camera jumps in close to the ped and then pulls away."** The exit hands the rig a new
focus — the ped, standing beside the car — while the eye is still behind the CAR, so the very next cast
finds the car between them and the INSTANT pull-in yanks the camera in, then releases over
`collisionReleaseTime`. Fixed by holding the eased collision response for `EXIT_EASE_SECONDS` (0.8 s) after
a sequence ends, so the camera settles into the new framing instead of snapping into it.

**4. "During entry the camera stops sliding along surfaces, and if it is low it can sink into the ground."**
This was 04's own decision arriving with a bill: the cap was SUSPENDED for the whole scripted sequence
because an instant pull-in mid-animation read as a jump. With no cap the camera neither slides nor clears
the ground — and once the eye is under the floor the guard cannot rescue it, because its probe casts
DOWNWARD from the eye and the floor is above. Fixed by keeping the cap on during a sequence but EASING it in
both directions (`resolveCollision(..., eased)`): the camera keeps clearing geometry and still never snaps
while the animation plays. The field verdict that rejected the snap is preserved; only the suspension is
gone.

### 2026-07-25 — FIELD ROUND 3: the shake and the sinking ACCEPTED, two left

Shake and the entry sinking read right now. The two that survived:

**1. The exit still closed in, just less.** Easing the response only SLOWED the pull-in; the cause was still
there — the car the player just left sits between the new focus (the ped, beside it) and the eye (still
behind it). Fixed properly: `PhysicsWorld.sphereCast` gained an `alsoExclude` (Rapier takes one exclusion
directly, a second through a filter predicate), and the host now ignores the car the player last rode while
they are within `RIDDEN_IGNORE_RANGE` (6 m) of it. The framed subject's own collider must stay excluded too,
which is exactly why one exclusion was not enough. The 0.8 s eased window stays — it smooths the framing
change itself.

**2. The landing dip was still invisible on foot.** Verified the path rather than guessing again: a scripted
landing at 4.5 u/s DID move the drawn eye, by 10.8 cm. So the wiring was never the problem — 10.8 cm at a
7 m orbit is simply not a thing a person notices, and **`MOTION_CAP` 0.15 was clipping it further**. Raised:
`MOTION_CAP` **0.15 → 0.25** (still under the floor guard's 0.3 m margin and collision's 0.35 m sphere, so
the layer still cannot breach a surface), `DIP_CAP` → 0.25, `landingDipScale` **0.12 → 0.22** and `DIP_TIME`
0.25 → 0.32 s. A normal jump now drops the eye ~0.2 m and takes a third of a second to come back.

### 2026-07-25 — FIELD ROUND 4: exit ACCEPTED; the landing dip SHIPS OFF

The exit no longer closes in — accepted. The landing dip was tried three times (3.4 cm → 10.8 cm → ~20 cm
with the layer cap raised out of its way) and the user never saw it: **"forget it, ship without it"**.

Shipped default `landingDipScale: 0`. The code, the tests and the `LANDING DIP` slider stay — the effect is
correct, it is the VIEWPOINT that defeats it: at a 7 m third-person orbit the whole frame dropping 20 cm is
a couple of percent of screen height on a body that already animates its own landing, so the camera's
contribution is swamped by the ped's. It is a first-person/close-camera effect, and **plan 08's first-person
preset is the natural place for it to come back** — the eye is the head there, and the same one-shot will
read immediately. (`TEST_CAMERA_CONFIG` deliberately keeps a non-zero value so the behaviour stays pinned by
tests even while it is off in the shipped config.)

**Round 4 net**: bob, corner swing, sprint kick, shake, entry sliding/sinking, the backing-up fix and the
exit framing are all field-accepted. The layer's remaining owed item is a long-session COMFORT verdict.

**Owed**: a long-session COMFORT verdict — a long walk (does the bob read as life or as wobble?), stair runs,
rooftop jumps, curb-hopping in a car and a deliberate wall crash. The plan asks for a comfort verdict
explicitly, not only a looks verdict, and to tune DOWN when in doubt. Every scale is live on the Camera tab
with `reducedMotion` as the A/B.
