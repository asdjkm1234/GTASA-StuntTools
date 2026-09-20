# Feature-chain audit — plan 088, ped locomotion feel (both rounds)

**Verdict: the on-foot game went from three hard-switched clips and one-line jump physics to a
full modern locomotion stack — for ~zero runtime cost and +~100 unit tests — in one day
(2026-07-24), with every default field-verified the same day.** Plan:
[`../plans/088-ped-locomotion-feel/`](../plans/088-ped-locomotion-feel/readme.md) (per-phase
ledgers carry every number and every field verdict); raw perf record:
[`../benchmarks/opensa-engine/2026-07-24-microbench-ifp-sampler-blend.json`](../benchmarks/opensa-engine/2026-07-24-microbench-ifp-sampler-blend.json).

## What changed

Fourteen commits on `main` (`4fbe73b` … the round-2 close), two user-scoped rounds:

- **Round 1 (phases 01–06):** controller-owned rate-limited heading (720→240 °/s by speed, 120°
  reversal plant) · clip crossfades with walk↔run↔sprint phase carry + pop-free hold retarget
  (`IfpSampler.sampleBlended`/`holdPose`, the promised 074/08 follow-up) · walk/run/sprint tiers
  with hysteresis and cycle-speed sync (RUN became the default gait; foot sliding gone) · a jump/
  fall FSM (launch anticipation, coyote 0.12 s, jump buffer 0.15 s, landing recovery) on the clips
  already in `ped.ifp`.
- **Round 2 (phases 07–09):** impact-tiered landings (quick beat / `fall_land` crouch /
  `fall_front`+`getup_front` knockdown) · a real slope slide (own downhill push — Rapier's
  kinematic controller never accelerates one; the jump-ladder exploit died with it) · vehicle
  ingress/egress realism: authored ROOT MOTION drives the enter/exit slides (the "floats in the
  air" fix), passenger-door entry + seat shuffle, a step-in that walks around the open panel, a
  blockage-probed exit chain (driver → passenger → windscreen crawl → roof) with overturned
  crawl-out, and step-clear door choreography.

New load-bearing seams: the `Locomotion` ECS component (heading/state/stateTime/fallSpeed — plan
080's camera will consume it), `rootMotion`/`warpAlongRootMotion`,
`PhysicsWorld.pathClear`/`groundNormalBelow`, and the pure `GaitSelector`/`LocomotionMixer` pair.

## What it cost

- **Runtime: negligible, by measurement and by construction.** The only per-frame additions are
  CPU-side: a blended palette sample costs **8.24 µs vs 6.01 µs single** (32-bone/20-key clip,
  20k-iter microbench — invisible next to the ~2 ms resolution-independent GPU pass floor), plus
  one ground-normal ray per fixed step while grounded and 2–6 short rays once per car exit. No
  render-side change shipped in the whole chain (the palette contract is unchanged), so the
  in-game fps baseline (2026-07-24 087-ring record) is untouched by construction — no re-run
  needed.
- **Code: focused.** The controller grew an FSM and three pure helper modules; the enter-vehicle
  system grew sides/egress phases. Complexity was held under the lint cap by extraction
  (`moveOnFoot`/`advanceAirState` collaborators), not suppression.
- **Deliberate debts (recorded, not hidden):** phase 05 transition polish stays QUEUED
  (`WALK_start`/`Run_stop`/`turn_180` — no field gap showed); the slide pose is a `FALL_glide`
  stand-in (SA ships no slide clip); locomotion root motion stays unused (edge-cases row).

## What it bought

The user's original complaints — instant direction changes, a feel-less animation-less jump, no
sense of acceleration, floating car entry, doors clipping through the body, exits into walls,
standing calmly on 45° slopes — are all closed and field-verified (SIX field rounds on
2026-07-24, each fix landed same day — the last cracked the yaw-vs-body-orientation door mapping
on overturned wrecks). Tests grew from 2,451 (pre-088 merge baseline, full repo)
by **+~100 focused unit tests** across game/engine/web/renderware — including real-Rapier FSM
timing, a real 48° trimesh ramp, real-IFP root-travel numbers, and degradation gates that keep
every new clip TC-safe (absent clip → previous behaviour, never a bind pose).
