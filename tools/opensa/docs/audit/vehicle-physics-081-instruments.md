# 081 — the instruments day (2026-07-27): what got measured, and what the measuring found

The 081 chain's second big day. It began as bookkeeping (freeze the accepted feel, price the vehicle slice)
and turned into an instrument arc: **four of the day's five findings were the instruments falsifying the
questions they were built to answer.** Sixteen commits on `main`, 2828 → 2882 unit tests, nothing pushed.

The tuning half of the chain is audited separately: [`vehicle-physics-081.md`](./vehicle-physics-081.md).

## What shipped

| Row | Deliverable | Where the numbers live |
| --- | ----------- | ---------------------- |
| 07 §2 | **The regression pack** — 5 cars × 11 scenes = 55 laps frozen as the accepted feel, gated by `scripts/phys-regression.ts` | `benchmarks/vehicle-physics/2026-07-27-headless-shipped-*.json` |
| 07 §3 | **The vehicle-slice cost**, isolated for the first time | `benchmarks/opensa-engine/2026-07-27-headless-vehicle-step-cost.json` |
| 06 §2 | **The kerb question, closed** — with a capture that can finally say WHERE it happened | `benchmarks/vehicle-physics/2026-07-27-headless-kerb*.json` |
| 10 (1–5) | **Surface types** — the wheel reads what it stands on, and grip follows | `benchmarks/vehicle-physics/2026-07-27-headless-{surfgrip,grasscorner}-*.json` |
| — | Two new plans ([081/10](../plans/081-vehicle-physics/10-surface-types.md), [089 vehicle particles](../plans/089-vehicle-particles/readme.md)) and one open issue | — |

## The numbers that matter

- **The vehicle slice costs ~8 µs per car per fixed step** — `ls-noon` 0.605 ms at **80 live cars**,
  `ocean-horizon` 0.003 ms at zero. Eight cars is ~0.07 ms against a 0.5 ms budget: **met with 7× headroom**,
  and the plan's premise was backwards (the bench world runs 80 vehicles, not 8).
- **Replay is measured, not assumed**: a repeat sweep reproduced **9 of 11 scenes to the second decimal**,
  collisions included. The two that did not (`u-turn`, `crest-jump`) are the laps that fly and land on
  streamed ground — their spread is what the pack's per-scene widening is sized from.
- **A car cannot get onto a pavement at town speed**: square at a kerb at ~25 km/h, comet −61 g, firetruk
  −47 g, 5–7 cm of climb, both stopped. The same edge is climbable at 57 km/h — momentum is the only thing
  that gets a car over.
- **Off-road grip, measured on the `grass-corner` lap** (comet, `?surfGrip=0` vs on): top speed
  **71.9 → 52.7 km/h**, settled yaw **34.8 → 21.7 °/s**. On tarmac: **seven laps identical to the decimal**,
  because ROAD-group ground divides out by construction.

## What the instruments falsified

This is the day's real product, and it is uncomfortable reading in the best way.

1. **`kerb-strike` never tested a kerb.** With the capture's new position channel: the comet's lap ends
   against a traffic light at (2221.8, 1203.3), the infernus meets plaza props at 100 g. Every "kerb" number
   in the record came off that lap.
2. **The flip that motivated plan 06 §2 had stopped reproducing** — comet 14.2° of roll, no flip on any of
   five cars — and nobody had noticed, because the scene had quietly become a prop-collision lap.
3. **`collisionDamageMult` scales nothing.** The plan asserted it scaled the damage thresholds; the field is
   parsed into the handling row and read by nobody, and every car is judged on a flat 300 kN.
4. **The regression gate's own rule was wrong**, found by running it: it read the capture's new `surfaces`
   block as "a signal appeared" and failed all twelve laps. A field the reference PREDATES cannot be a
   regression.
5. **SA classifies dirt roads as ROAD group.** `dirt` and `dirttrack` grip like tarmac — 73 of 179 surfaces
   are ROAD — so "off-road" in this data means grass, sand and rock, and `×1.00` on a dirt track is correct.

## The field's verdicts, and what they cost

Three field rounds, three different answers, and all three changed the plan rather than the code:

- **Kerbs**: "everything works well" → 06 §2's assist **parked as not needed**. Two follow-up checks closed
  the gap between that and the capture (throttle-held run identical; SF pavements are flush in collision, and
  the LV edge is a 40 cm ledge a car SHOULD be stopped by).
- **Surface grip**: "no real difference on grass, none on sand, several cars" → then, with the new F2
  readout open, "maybe a very small difference, almost unnoticeable" **while the panel showed
  `p_grassmid1 ×0.71`**. So the mechanism is applied and verified; a grip CEILING is invisible until the tyre
  is against it. Shelved as [`open-issues/offroad-feels-like-tarmac.md`](../open-issues/offroad-feels-like-tarmac.md)
  with three options and their costs. **The field's call: keep it, do not bend the number.**
- **Rain**: there is none, so 081/10's step 6 (`WET_GRIP`) moved to
  [roadmap 0.5.0 / 05 rain](../roadmap/0.5.0/plans/05-weather-rain/readme.md) rather than shipping a rule
  nobody could switch on.

## Method notes worth carrying (each cost real time)

- **A capture that cannot say WHERE it was cannot say what it hit.** The position channel took an hour and
  invalidated three conclusions in an afternoon.
- **Verify a geometry probe against the MAP, not against a fixture that agrees with it by construction.** The
  surface probe passed every unit test and returned null in the game: parry encodes a back-face trimesh hit
  as `featureId + triangleCount`, and hand-written quads wind toward the ray while roads wind away.
- **A ray sees nothing until the world has stepped once** (the query pipeline is built in `step`).
- **The headless harness forwards only tagged lines, `[slow]` and console WARNINGS** — a `console.log`
  diagnostic from the game is invisible, which cost a run.
- **Never edit app source while a sweep flies** (HMR): one bench sweep was discarded for exactly that, and
  the clean re-run reproduced its means within 10 %.
- Both new runtime traps are now in [`edge-cases/browser-runtime.md`](../edge-cases/browser-runtime.md).

## Cost

- **Tests**: 2828 → 2882, all green; coverage 90.15 % statements / 80.53 % branches / 91.86 % functions
  (floors 86/77/88).
- **Runtime**: the surface probe is four rays a step on the DRIVEN car — inside the noise of a 0.07 ms
  eight-car slice. The lever if traffic ever needs it is priced in
  [`performance/deferred-optimizations/surface-probe-per-wheel.md`](../performance/deferred-optimizations/surface-probe-per-wheel.md).
- **New instruments the chain keeps**: the regression pack + its gate, the `[phys]` position channel and
  per-lap `surfaces` block, the `vehicles {live, meanMs, maxMs}` bench field, the `kerb-mount` and
  `grass-corner` scenes, the F2 per-wheel `surface ×factor` readout, and `?surfGrip=0`.

## What remains

- **081/06**: §1 in-air attitude control and §3 camber/axle lean are untouched; §2 is closed.
- **081/07**: the class sweep (§1) and the close-out (§4) remain; §2 and §3 are done.
- **081/10**: steps 1–5 shipped and field-reviewed; step 6 moved to the rain plan; what is left is whatever
  the open issue's option 2 becomes, if it is picked up.
- **089 vehicle particles**: written, unstarted — and its step 5 waits on 081/10.
- The pack was **not** re-recorded: tarmac laps are unchanged, so it did not have to be.
