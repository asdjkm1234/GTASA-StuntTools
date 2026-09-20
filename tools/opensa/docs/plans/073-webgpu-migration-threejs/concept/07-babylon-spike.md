# 07 — Babylon.js spike: the "leave three?" question, measured

Harness: `apps/web/src/standalone/babylon-spike.ts` (`/babylon-spike.html`), @babylonjs/core **9.16.1** — mirrors
the three Phase-0/1a harnesses (≈15k independent draws, 8 unlit frozen materials, culling defeated, frozen world
matrices, orbiting camera) so the numbers are directly comparable on the same machine.

## Results (2026-07-11)

| Engine / mode                      | steady render CPU @ 15k draws | streaming (add a 150-mesh cell)            |
| ---------------------------------- | ----------------------------- | ------------------------------------------ |
| **three** WebGL                    | **10.3 ms**                   | —                                          |
| three WebGPU, no bundle            | 27 ms                         | —                                          |
| three WebGPU + BundleGroup         | 4.3 ms                        | broken in-engine (transform baking)        |
| Babylon WebGL2                     | 30.8 ms                       | —                                          |
| Babylon WebGPU, no snapshot        | 46.5 ms                       | —                                          |
| **Babylon WebGPU + Snapshot FAST** | **0.12 ms**                   | **~50–58 ms per reset** (global re-record) |
| Babylon WebGPU + Snapshot STANDARD | 38.5 ms                       | ~50 ms per reset (same)                    |

(fps ~20–33 in all runs is the synthetic's GPU overdraw artifact — 15k stacked boxes; the CPU column is the signal.)

## Reading

1. **Snapshot FAST is spectacular** — 0.12 ms steady CPU submission for 15k draws. Babylon's record-once machinery
   is production-mature; the record-once thesis (our Phase 0) is real and shipping in Babylon today.
2. **But the streaming cost is the SAME wall that killed the three attempt.** Babylon's snapshot is **engine-global**:
   `snapshotRenderingReset()` re-records the WHOLE world (~54 ms at 15k draws, scaling with total draws), on **every**
   cell add/remove. Our game swaps cells continuously while moving → a ~50 ms hitch per swap = the exact
   "heavy streaming lag" experience. STANDARD mode doesn't help: expensive steady (38.5 ms) AND the same reset cost.
3. **Babylon's WebGL fallback is a 3× regression** vs three WebGL (30.8 vs 10.3 ms) — migrating and staying on WebGL
   would make the shipping path worse.
4. Architectural irony: **three's `BundleGroup` design is the RIGHT shape for streaming** (per-cell granular
   re-record — our Phase-1a synthetic measured 1–13 ms per-cell swaps) — it's just immature/buggy in-engine.
   Babylon has the mature implementation but the WRONG granularity (global).

## Verdict

**Migration to Babylon is not justified.** 4–6 months of full rewrite would buy: a phenomenal steady-state
(0.12 ms) fenced by a ~50 ms global hitch on every streaming swap (unsolved, structural), a 3× worse WebGL
fallback, and unquantified dynamic-object complications under FAST mode (snapshot freezes per-object state;
player/vehicles/animations need special handling). The streaming-hitch problem — OUR defining workload — is
unsolved in both engines today.

**Strategic position:** stay on three WebGL (10.3 ms baseline, everything works). The record-once future arrives
either when three matures its granular BundleGroup path (watch the `referenceBuffer()` refactor discussed in
PR 29066 + the known ~3× WebGPU slowness), or — if we ever commit to AAA seriously — a **thin custom WebGPU
renderer for the static world only** (per-cell bundles; our Phase-0/1a numbers prove the mechanism) while three
keeps rendering dynamics/post-FX. That hybrid is a separate, months-scale decision with its own spike.
