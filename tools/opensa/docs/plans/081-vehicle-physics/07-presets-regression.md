# 081/07 — Class presets, physics CI, close-out

The exit plan: prove the chain generalises beyond the reference trio, freeze it against regression,
and close the bookkeeping.

## 1. Per-class field sweep

- The chain so far tuned against infernus / admiral / firetruck. Sweep the shipped tuning across
  handling's natural classes: sports · sedan · heavy (truck/bus) · offroad · van/pickup — 2–3
  representatives each, spawned via the F2 vehicle spawner. Where a class needs a shared correction
  (e.g. bus steering-lock feel, offroad suspension bias), it lands as a NAMED class factor in one
  table — never per-model hand edits (the all-vehicle-types chain — now
  `docs/plans/098-all-land-vehicles/` — inherits this table as its preset seed; bikes/trailers stay out
  of scope here).
- The 841-car bench road sweep doubles as a mass spawn-sanity check (rest attitude, no sleep-jitter,
  parking holds on grades) — run it once on the final tuning.

## 2. Physics CI — the replay regression pack

- Lock the scene matrix (plan-01 scenes + the ones added since: hill-start, throttle-in-corner)
  × the trio into a committed regression pack: expected `[phys]` captures with per-signal tolerance
  bands (`phys-compare.ts` from plan 01), runnable headless via the bench harness — the physics
  twin of the render ritual. Any future PR touching physics/vehicle code runs the pack; a band
  breach is a finding, not noise (bands were set from accepted field rounds).
- Unit-level: the chain's pure modules (mapping, stability, drivetrain, telemetry) are already
  test-covered per plan; this plan audits coverage of the seams (pre-step hook order, quirk ledger
  tests all still meaningful) and deletes tests pinned to retired behaviour (e.g. the 480-N brake
  constant assertions).

## 3. Performance budget (measured, not assumed)

- Fixed-step cost with 8 live vehicles (player + road cars in ring 0): target ≤ 0.5 ms/step for
  the whole vehicle slice (controller updates + stability forces + drivetrain + telemetry-off).
  Measure on the bench road-car scene; ledger the number and the per-system breakdown from a
  one-off profiled run.
- Collision-damage coupling sanity: `collisionDamageMult` (plan-02 mapping) now scales the damage
  thresholds — verify the crash scene still classifies light/crash sensibly (damage system's
  207k/377k N thresholds were tuned pre-chain). **Corrected 2026-07-27: it does NOT. The field is parsed
  into the handling row and read by nothing** — `vehicle-damage.system.ts` gates on a flat
  `STRONG_HIT = 300000` for every car. So there is no coupling to sanity-check; what there is instead is an
  unread authored column, and whether a paper-thin car should dent sooner than a truck is a feel change with
  its own field verdict, not a close-out chore.

## 4. Close-out

- Ledgers complete in all 7 plans; readme status → DONE with field-verdict quotes (paraphrased,
  English-only rule).
- The superseded idea (`docs/ideas/0.4.0/plans/07-vehicle-physics/`) already points here; verify
  the 0.5.0/04 cross-reference and hand it the class-factor table location.
- Doc sweep: `docs/plans/018-vehicle-physics/readme.md` gains a banner pointing at this chain as the feel
  layer on top of its foundation; quirks ledger's final state recorded in the readme.
- Memory/handoff update (outside the repo): shipped tuning philosophy, the gate verdict, what
  0.5.0/04 inherits.

## Subtasks

- [x] Class sweep + class-factor table (**empty by measurement**, ledger below); the per-class field
      verdicts stay with the user.
- [x] 841-car spawn sanity run on final tuning — `lateCreates` 0 on all six bench scenes across three runs
      (benchmarks index, 2026-07-27 close-out row).
- [x] Regression pack committed + harness lane + bands from accepted captures (2026-07-27, ledger below).
- [x] Perf measurement + breakdown (2026-07-27); damage-coupling check — **there is no coupling to check**, see §3.
- [x] Docs/close-out items above (2026-07-27) — see the close-out audit; the last one open is the FIELD round.

## Acceptance

- User accepts driving across all five classes ("each feels like itself") — the chain's real gate.
- Regression pack green and committed; perf inside budget; suite green.

## Ledger

_(class factors, pack bands, perf numbers, final verdicts)_

### 2026-07-27 — §2 the regression pack: the shipped feel is frozen

**5 cars × 11 scenes, 55 of 55 laps, on `e50d913` with the dials at their shipped defaults** (`gripVd 12` /
`gripCap 3`, and every capture records them). Cars: infernus · admiral · firetruk · comet · turismo — the
calibration trio plus the two the field named (the flipping comet, the slammed turismo). The captures ARE the
reference: `docs/benchmarks/vehicle-physics/2026-07-27-headless-shipped-<car>.json`, with the conditions, the
headline numbers and the caveats in that folder's readme. This also closes 081/09's coverage note — the
shipped state had no committed matrix.

**The gate**: `npx tsx scripts/phys-regression.ts sweep-*.log` (`scripts/phys-regression.ts`, unit-tested in
`scripts/phys-regression.test.ts`; capture loading shared with `phys-compare.ts` via `scripts/lib/`). It
fails on four different things, which is the point — a moved signal, a lap that never reported, a car nobody
swept, and a categorical change (a flip that appeared or vanished, a lap that stopped braking or stopped
reaching 100 km/h). It also gates what the run was CONFIGURED with: the `speedGrip` dials and the per-wheel
springs at 0.1 %, so a sweep driven with different dials says so instead of arriving as a fleet of moved
outcomes — and, on `rest` only, the settled stance (mass, weight on ground, per-wheel load and spring length
at 1 %), because **no summary signal carries the standing pose**: the `rest` lap reads zero on every channel
whether the car sits at its SA pose or on its bump stops, so the 2026-07-27 stance law would otherwise have
shipped ungated.

**The bands are measured, not guessed.** The infernus sweep was repeated (under three-way parallel load, to
prove machine load does not enter a fixed-step lap) and diffed: **nine of eleven scenes reproduced to the
second decimal**, every summary field and every series column, collisions included. The two exceptions —
`u-turn` and `crest-jump` — are the laps where the car flies and lands on streamed ground; their spread
(topSpeed 9 km/h, roll 14°, gLat 24, slip 37°) is what their widening is sized from at ~1.5×. `slalom` and
`kerb-strike` replayed but are the same shape of lap and carry the same widening. Everything else is held at
"a driver would notice": 2 % of top speed, 3 % of a braking distance, a few degrees of roll or slip.
Verification: the repeat sweep, checked against the committed pack, passes 11 of 11 laps in band.

### 2026-07-27 — §3 the vehicle slice, measured: ~8 µs per car per step

The budget (≤ 0.5 ms/step for the whole vehicle slice with 8 live cars) had never been isolated, because
nothing timed it: `physicsMs` lumps the raycast controllers in with the solver, `vehiclesMs` is the per-FRAME
visual tick, and the vehicle system's own `fixedUpdate` was inside the loop but outside every timer. So the
step came first — `PhysicsWorld.takeVehicleStepMs()` (the controllers' loop, taken once so a step that never
ran cannot report the previous one again) plus a timer around `vehicles.fixedUpdate`, summed per frame,
divided by that frame's step count and reported by the bench as `vehicles {live, meanMs, maxMs}`. Frames that
ran no fixed step are excluded, or a catch-up frame reads as one step costing double.

**Measured, headless on the canonical pak** (`docs/benchmarks/opensa-engine/2026-07-27-headless-vehicle-step-cost.json`):

| scene         | live cars | ms/step (mean) | ms/step (max) | µs per car |
| ------------- | --------- | -------------- | ------------- | ---------- |
| ls-noon       | **80**    | **0.605**      | 0.9           | 7.6        |
| sf-fog-dawn   | 66        | 0.555          | 1.4           | 8.4        |
| lv-night      | 58        | 0.484          | 0.8           | 8.3        |
| ls-rain-night | 57        | 0.547          | 0.9           | 9.6        |
| country-dusk  | 13        | 0.176          | 0.4           | 13.5       |
| ocean-horizon | **0**     | **0.003**      | 0.1           | —          |

**The budget is met with room to spare, and the budget's premise was wrong.** Eight cars cost ~**0.07 ms**,
a seventh of the 0.5 ms allowance; the empty scene shows the slice has no fixed overhead worth naming
(0.003 ms). What the plan did not anticipate is that the bench world runs **80** live raycast vehicles, not
8 — and even there the slice is 0.6 ms, i.e. the fleet could grow ten-fold before the number written in this
plan is reached. The per-car cost is flat across scenes (7.6-9.6 µs; `country-dusk`'s 13.5 is 13 cars sharing
the small constant, not a heavier car), so it scales linearly and predictably.

This also prices the two runtime probes this chain has considered: a per-wheel ray per step is the same order
as the whole controller update, so a kerb or surface probe on the DRIVEN car alone is free, and one on all 80
would roughly double the slice — still inside a frame, but no longer negligible.

§2's unit-level half is in the same state: the retired brake-constant assertions the plan named are already
gone (nothing in the vehicle or physics suites pins the 480 N figure), and the DRCVC quirks still carry their
own tests (`seedReverse` in `physics-world.test.ts`, the seat/parking-brake path in
`enter-vehicle.system.test.ts`). A seam-by-seam coverage audit stays with the close-out, not with the pack.

**A finding the pack cannot fix, recorded so nobody reads past it: eight of the eleven scenes register
impact-class spikes** (50–300 g longitudinal). On the sweeper — the instrument 081/09 was accepted on — the
two fastest cars meet something about a second into the corner and never come round (`turnedDeg` ≈ 0 for
infernus and turismo, while the slower admiral and comet arc 88° and 66°). Every matrix in the record back to
the BEFORE set has these spikes, so the pack freezes what the game does today honestly; but a cornering
verdict taken off those laps is partly a record of where the wall is. **Owed: clean ground for the scenes
that leave the road (or a shorter run-up).** It re-bases every historical number on those scenes, so it is
its own step with the user's go-ahead — not a fix to slip into a tuning round.

### 2026-07-27 — §1 the class sweep: the tuning generalises and the class-factor table stays EMPTY

Five cars the chain never tuned against, one per class the calibration trio does not cover — **landstal** and
**sandking** (offroad, 4WD), **bus** (heavy, six wheels), **burrito** (van), **picador** (pickup, and a solid
rear axle) — on `rest` · `brake-strip` · `step-steer` · `u-turn`. Full table and captures in the
[benchmarks readme](../../benchmarks/vehicle-physics/readme.md); what it decides:

**The stance law generalises.** Every car sits on all its wheels with 99.9 % of its weight on the ground, at
13–42 % of its authored travel, none on its bump stops, per-corner loads summing to `mass × g`. The
six-wheeled bus loads its front axle twice as hard as either rear one and its springs answer. This is the
strongest result in the sweep, because it is the part that was NOT derivable — the SA law was calibrated on
four cars and it holds on classes with three axles and with 47 cm of travel.

**Longitudinally, three classes hit three DIFFERENT limits, and each is the car's own number.** The 4WD
offroaders pull 4.2 m/s² (engine-limited); the van and the pickup author the same `fEngineAcceleration` as the
landstalker and pull 2.2 because they are rear-drive and `μ × rear-axle load / mass` is 2.9 for them (the
081/04 clamp, doing exactly its job); the bus is short of its 4.9 m/s² grip ceiling and is simply a 5.5-tonne
vehicle with `fEngineAcceleration` 14. Braking spans 0.35 g (bus, the fleet's lowest authored
`fBrakeDeceleration`) to 0.91 g (sandking), and **every class dives** (−0.6…−2.1°) where 081/01 measured
+0.07° nose-UP on the trio.

**So no class factor is proposed, and that is a result rather than an omission**: the plan says a factor lands
only where a class needs a SHARED correction, and every difference the sweep found is a difference the data
authored. `docs/plans/098-all-land-vehicles/` (formerly `roadmap/0.5.0/plans/04-all-vehicle-types/`)
inherits an empty table and the reason for it.

**What did NOT generalise is the instrument set — the honest half of this section:**

- `brake-strip` brakes at ~8.5 s and every one of the five is still ACCELERATING there, so its `topSpeedKmh`
  reads as a top speed for the trio and as "how far it got in 8.5 s" for a bus. The three low-power classes'
  53–65 km/h is NOT a top-speed finding, and nothing may be concluded about `CHASSIS_LINEAR_DAMPING` from it.
- `step-steer` and `u-turn` hit scenery with anything wider or taller than the trio: the bus turns **0.28°**
  across its whole step-steer lap while registering ±20 g, and the burrito's u-turn ends on its roof at
  0.3 km/h after a −80 g impact. **No cornering or flip verdict per class comes off these laps.** The owed
  clean-ground work (07 §3's ledger) is now owed twice, and a class field round needs a spot a bus fits on.

The field half of §1 — "each class feels like itself" — is a driving verdict and stays with the user; what
this sweep hands it is the list of what to drive and the numbers to argue with.

### 2026-07-27 — what §2's pack owes after plan 06, stated rather than silently re-recorded

Air control changes what a lap does the moment a car is off the ground for more than the debounce, and two
of the pack's eleven scenes are exactly that: on `u-turn` (infernus) the same launch now ends **1.93 s of
flight instead of 3.27 s** with the nose 11° higher. `crest-jump` moves for the same reason, and both are the
scenes 07 §2 measured the widest bands for.

**The pack was NOT re-recorded**, deliberately. Its bands come from an ACCEPTED field round, and air control
has not had one yet — re-recording now would freeze an unjudged feel as the reference and destroy the only
baseline a verdict could be measured against. So the state is written down instead:

- A fresh sweep at head is EXPECTED to breach `u-turn` and `crest-jump` on the air-time and rotation
  channels for every car with a jump in its lap; nothing else in the pack should move (camber is drawn, not
  simulated, and air control cannot fire with a wheel on the ground).
- If the field ACCEPTS air control, re-record those laps (5 cars × the affected scenes) and note the dial the
  sweep ran with — every capture now carries `airControl` for exactly this.
- If the field rejects it, `?airCtl=0` restores the pack's world byte for byte, which is why the dial reaches
  zero rather than stopping at a minimum.
