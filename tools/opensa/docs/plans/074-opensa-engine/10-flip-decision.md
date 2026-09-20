# 074·10 — THE FLIP DECISION

[← chain](readme.md) · parent: [10 integration & flip](10-integration-flip.md) · gate for:
[13 cleanup](13-cleanup.md) — **C2 given the same day; 13 is COMPLETE**

**Decision date: 2026-07-18. Decision: FLIP — the OpenSA WebGPU engine is the shipping renderer.**
Signed off by the user on the pre-flip measurement sweep + the parity screenshot round ("parity ok").

This doc is the single place that answers "why did we drop the old renderer" for anyone reading the repo
in a year. Every claim links to the ledger that measured it; nothing here is a vibe.

## What is being decided

The engine has been the DEFAULT host since the boot gate landed 2026-07-17 — mechanically the switch
already happened. What this doc ratifies is the **commitment**: the WebGL path is no longer a supported
renderer, it is a comparison artefact on borrowed time, and the chain's follow-on work
([14 opensa-pack rework](14-pmb-integration.md), then the lab on the new format) may now assume the
engine is the only target.

**It did NOT itself trigger [13 cleanup](13-cleanup.md)** — per the user's standing gate (2026-07-13)
the three-WebGL path was to stay in the tree behind `?engine=three` until a separate explicit command
(**C2**). That command came the same day, and 13 ran to completion: **there is no longer a WebGL path
to roll back to.** The comparison artefact is now the git history and the measured rows in
[bench/series.md](../../benchmarks/opensa-engine/2026-07-18-series.md).

## Criteria — agreed in advance, judged now

| #     | Criterion (as written before the work)                                   | Verdict             | Evidence                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | 60 fps ls-noon @2× retina on M3 Pro, and ≥ prod fps on EVERY bench scene | **PASS, by 2×**     | [series § THE PRE-FLIP SWEEP](../../benchmarks/opensa-engine/2026-07-18-series.md): 119.6–120.3 fps on all six scenes (vsync-locked, p95 ≤ 9.3 ms = ~4.6 ms unspent) vs prod 16.2–37.8 fps on land, 59.6 on the empty ocean. Frame time 3.2–7.4×, draws 4.8–12.0×.                                                                                                                |
| **2** | Visual parity sign-off per bench scene                                   | **PASS**            | User's parity screenshot round on the same sweep, 2026-07-18: "parity ok". Preceded by the fix batch that made the comparison honest (below).                                                                                                                                                                                                                                     |
| **3** | Stress matrix green in Chrome + Safari; 30-min soak clean                | **PASS (rescoped)** | 30-min Chrome soak: all 8 self-judged checks green, 107 legs / 192 668 frames, heap SHRANK 2661 → 2499 MB ([series 10·soak30](../../benchmarks/opensa-engine/2026-07-18-series.md)). **Safari declared NOT relevant by the user 2026-07-17**; the earlier Safari smoke test passed anyway (plan 10 criterion 3 note).                                                             |
| **4** | ~~Non-WebGPU browsers keep the WebGL path~~ → **WebGPU-first boot gate** | **PASS**            | Criterion REPLACED by user decision 2026-07-17 (no dual-renderer support). `webgpu-gate.ts` probes adapter + `texture-compression-bc` mirroring `initDevice`; no WebGPU → sorry screen. All three branches harness-verified, 5 unit tests.                                                                                                                                        |
| **5** | 073 flags & code disposition executed                                    | **PASS (C2 done)**  | C2 was commanded the same day and [13](13-cleanup.md) ran to completion: the three-WebGL path, the flag zoo and the dependency are gone (`from 'three'` importers repo-wide: **0**; `node_modules` 512 → 455 MB; prod JS 5.4 → 2.88 MB). The 073 note is marked EXECUTED, and the surviving knobs are documented in [query-parameters.md](../../development/query-parameters.md). |

### The fix batch that made criteria 1–2 valid

The 07-17 measurements were taken on a build whose fog came from different DATA than prod's, so the
first parity screenshots showed prod drawing visibly further and two bench rows were invalidated. Three
root-fixes (all 2026-07-18, ledgers in [21](21-fog-draw-distance.md)) preceded this sweep:

- **Black night** — SA authors NEGATIVE timecyc cloud colours; `lin()` turned them into NaN and ONE NaN
  in the frame UBO poisoned every WGSL `mix()` even at factor 0 (sky AND fog).
  [open-issues/fixed/engine-night-sky-black.md](../../open-issues/fixed/engine-night-sky-black.md).
- **Timecyc source of truth → the live game VFS** — the host had been feeding the driver the pak-baked
  copy, so the user's timecyc experiments were invisible and engine-vs-prod fog compared different files.
- **Regional weather remap** — the host never applied SA's city-crossing rule, running CLOUDY\*LA
  (fog cut 700) in the countryside where prod runs CLOUDY\*COUNTRYSIDE (1150).

A known A/B caveat survives for anyone re-running those frames: the engine remaps weather regionally at
spawn while the prod bench sits on its literal id until a city crossing, so `ls-rain-night` compares
engine column 16 against prod's 8.

## What the flip is NOT claiming

Recorded so the decision is not read as "everything is done":

- **Map lighting ([17](17-map-lighting.md)) is DEFERRED, not solved.** Static 2dfx lamps were REMOVED
  from the light pool 2026-07-17; the no-lamp-pool state IS the accepted flip baseline (user decision).
  Lamp surface lighting restarts from zero in a later iteration.
- **Vehicle SSR + contact shadows ([16](16-vehicle-paint.md) steps 3+6) were built and rolled back** —
  the user judged they worsened the experience. Vehicle paint itself is CLOSED and accepted. Constraints
  for the next attempt are preserved in plan 16.
- **The residual hitches are PHYSICS, not the renderer.** `fixed` carries 11–19 ms (Rapier step) with
  ~1 000 bodies / 5 378 colliders standing still, while GPU sits at 1.2–4.7 ms. The collider streamer
  also has no per-frame budget (21.9 ms entry spike) unlike render cells. Own round, not a renderer debt
  — the 4.6 ms of render headroom cannot be spent on it.
- **Residency is bounded, not minimal** — ~1.6–1.7 GB at 2× with 841 cars (world texture arrays +
  vehicle-type accumulation, LRU floor 256 MB). Per-ring texture laziness (~767 MB world-array boot
  baseline) is the named post-flip lever.
- Parked by earlier user decisions and unaffected by this: water v1 (idea 0.5.0), stochastic texturing
  (default-OFF, unstable), the baked-shadow mechanic (redesign in ideas 0.6.0/04).

## Rollback

Cheap and explicitly preserved for the comparison period: `?engine=three` boots the untouched WebGL path
on the same VFS and the same 841-car bench population. If the field turns up something the six bench
scenes did not, that is the A/B, and C2 simply does not get called. The gate is one boolean in
`app.tsx`; nothing about the flip is one-way until deletion starts.

## What the flip unblocks (the agreed order)

1. **③ opensa-pack REWORK** ([14](14-pmb-integration.md)) — output becomes "almost a copy of the game in
   our format" with loose live-tunable files (timecyc first) as FILES next to the pak.
2. **④ the LAB consumes that output like a game dir** → `manifest.timecyc` + `setup.timecyc` plumbing die.
3. Post-migration queue, unchanged: opensa-pack plan 002 (fetch-game paks), bucket-D debugger knobs,
   per-ring texture laziness, the physics round above.
4. **C2 — [13 cleanup](13-cleanup.md) — on the user's explicit command only.**

## Ledger index (everything this decision rests on)

- [bench/series.md](../../benchmarks/opensa-engine/2026-07-18-series.md) — § THE PRE-FLIP SWEEP (the decisive row), § C1 WebGL-prod baseline,
  § 22·debug-tools, 10·soak30, and every per-plan cost point.
- [10 integration & flip](10-integration-flip.md) — boundary inventory, criteria as originally written,
  boot gate + soak task records.
- [21 fog & draw distance](21-fog-draw-distance.md) — the 07-18 fix batch ledger + residency diagnosis.
- [22 debug tools](22-debug-tools.md) — the last pre-flip blocker, shipped 2026-07-18.
- [06 world effects parity](06-world-effects-parity.md) — the effect-by-effect ledger (sky v2, night arc).
- [16](16-vehicle-paint.md) / [17](17-map-lighting.md) — the two accepted parity debts, with their state.
