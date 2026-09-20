# Concept: WebGPU migration

**Question:** can moving the OpenSA renderer from WebGL2 to WebGPU break the CPU draw-call wall and turn OpenSA
into a genuinely AAA-capable browser engine?

**Status: 🎓 GRADUATED to [docs/plans/073-webgpu-migration](../readme.md)
(2026-07-11).** The park below lasted hours: the focused bundle hunt (patched three, see
[phase-1-findings.md](phase-1-findings.md)) made static render bundles WORK in the real engine — fast load, live
camera, smooth driving, **~13 ms render CPU vs the 65 ms WebGL baseline**. These concept docs remain as the
research record; actionable work lives in the plan chain.

<details><summary>Superseded park note (kept for history)</summary>

**Status: 🅿️ PARKED (2026-07-11) — three's WebGPU renderer is not ready for this streaming workload.**
The synthetic spikes said GO (render bundles cut submission ~6×, per-cell invalidation granular), but the
**real-engine integration failed in the field**: bundles never rendered correctly in-engine (static-bundle
transform baking), and per-InstancedMesh pipeline compilation (three's own TODO, PR 29066) freezes streaming with
no working pre-warm — in practice the WebGPU path ended up **worse than WebGL**. Full chronology + resume
conditions in **[phase-1-findings.md](phase-1-findings.md)** (the FINAL VERDICT section).

What the effort yielded on the shipping WebGL path: the **three 0.177 → 0.185.1 upgrade**, the r185
invisible-dynamics shadow fix, PCF shadows, and a complete map of the upstream blockers. **Correction (2026-07-11): PR 29066 itself MERGED in Aug 2024 — the uuid-in-key IS the merged workaround.** What's
pending upstream is the structural `referenceBuffer()` refactor its discussion calls for, with no timeline; the same
thread has a maintainer benchmark of WebGPURenderer ~3× slower than WebGL on complex scenes — matching our field
result. Resume only when that architecture work lands (re-run the spikes first). Meanwhile the "leave three?"
question is being measured: see the **Babylon spike** (`/babylon-spike.html`, snapshot rendering = mature
record-once + a streaming reset-cost scenario).

</details>

<details><summary>Pre-park status (the spike results that justified trying)</summary>

- **Phase 0:** render bundles cut per-frame draw submission ~6× (WebGPU+bundle 4.3 ms vs WebGL 10.3 ms vs WebGPU
  no-bundle 27 ms @ 15k draws) and move heavy per-draw material cost to record-time. WebGPU _without_ bundles
  regresses — bundles are the whole win.
- **Phase 1a:** per-cell `BundleGroup` invalidation is **granular** — a cell swap re-records one cell (steady
  4.5 ms → swap 8.9 ms), not the world.

Numbers in [phase-0-spike-checklist.md](phase-0-spike-checklist.md).

</details>

---

## TL;DR — honest verdict up front

|                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does it target the real bottleneck?** | **Yes.** The wall is CPU draw-call submission (65 ms/frame, 92 %). WebGPU render bundles + lower driver overhead attack it directly, without touching the art. Nothing else we tried does.                                                                                                                                                                                                                                         |
| **Expected upside**                     | Realistically **2–4×** frame-rate on the CPU-bound scenes (≈13 fps → ≈30–50 fps), by collapsing the ~65 ms submission cost to single-digit ms. Then we become GPU-bound (~32 fps floor today) — which further work (fewer triangles, cheaper post-FX) can lift.                                                                                                                                                                    |
| **Cost**                                | **Large.** A near-total rewrite of the rendering layer: renderer swap, **all custom shaders → TSL** (~2 300 lines of GLSL across 7 files, 5 `onBeforeCompile` patch sites), and the **entire post-FX stack** (currently the WebGL-only `postprocessing` lib) rebuilt on three's WebGPU node post-processing. Estimate: **many weeks, plausibly 2–3 months** of focused work.                                                       |
| **Biggest risks**                       | (1) three.js WebGPU **render-bundle** maturity / whether it auto-applies to a streaming scene; (2) TSL re-implementation of the complex `world-material` (sun/CSM/night/fog/emissive) being pixel-faithful; (3) no drop-in WebGPU replacement for **god-rays / SSAO / SMAA** from `postprocessing`.                                                                                                                                |
| **Recommendation**                      | **Worth a time-boxed spike, not a blind commit.** Do [Phase 0](04-migration-plan.md#phase-0--the-spike-12-weeks--gonogo-gate) first: a throwaway branch that renders the _static world only_ (one TSL material, no post-FX) under WebGPU with render bundles, and **measure the draw-submission ms**. If it collapses as predicted → green-light the full migration. If render bundles don't deliver in three 0.177 → stop, cheap. |

This is the only direction in the whole investigation that both **fixes the problem at its root** and **doesn't
require sacrificing visual quality**. But it is a real engine rewrite — go in with the spike, eyes open.

---

## The documents

1. [01-bottleneck.md](01-bottleneck.md) — the measured problem: what exactly is eating the frame, and why asset-side fixes can't touch it.
2. [02-current-render-stack.md](02-current-render-stack.md) — full inventory of what we'd have to port (renderer, materials, shaders, post-FX, shadows).
3. [03-webgpu-mechanism.md](03-webgpu-mechanism.md) — how WebGPU / three.js WebGPURenderer / TSL / render bundles actually remove the wall.
4. [04-migration-plan.md](04-migration-plan.md) — the phased, step-by-step plan (spike first, then material-by-material).
5. [05-risks-and-verdict.md](05-risks-and-verdict.md) — every risk, what would kill the project, and the final honest go/no-go.
6. [06-bake-vs-pass.md](06-bake-vs-pass.md) — fixed decision: which effects bake into the format, which shade in the material, which stay a fullscreen pass.
7. [phase-0-spike-checklist.md](phase-0-spike-checklist.md) — the actionable Phase-0 spike: concrete tasks, the exact numbers to capture, and the GO/NO-GO criteria.
8. [07-babylon-spike.md](07-babylon-spike.md) — the "leave three?" question measured: Babylon snapshot FAST = 0.12 ms steady but ~50 ms GLOBAL re-record per streaming swap; migration not justified.
9. [upstream-issue-draft.md](upstream-issue-draft.md) — ready-to-file three.js issue: the three BundleGroup defects + our measured fixes (30→5 ms).
10. [phase-1-findings.md](phase-1-findings.md) — real-engine integration: the engine runs under WebGPU (player walks); the static-BundleGroup transform-baking bug that blocks a clean bundle measurement; where to resume.
