# 073 — WebGPU migration on three.js (chain umbrella)

**Status: 🔒 CLOSED 2026-07-21 (user triage) — the parked chain is retired for good: the own engine ([074](../074-opensa-engine/readme.md)) replaced the three.js WebGPU path entirely; the leftover `?webgpu`/`bundle` flag zoo died with the three renderer in 074/13.**

> **The unticked boxes below are VOID with the plan, and are struck rather than deleted (2026-08-11).**
> They were left as `- [ ]` when the chain was closed, so every repo-wide scan for open work kept
> reporting them — 118 phantom tasks across the ten closed chains. Nothing here is a debt: the banner
> above is the authority. They stay readable because what these plans INTENDED is still the record of
> why the own engine does what it does.


**Status: ❌ FAILED (2026-07-11) — the blocker is on three.js's side.** Renamed `073-webgpu-migration` →
`073-webgpu-migration-threejs` to record WHICH WebGPU attempt failed: the one built on three's WebGPURenderer.
The campaign solved everything reachable from outside the framework (CPU 65 → ~4 ms) and hit an irreducible
GPU/present remainder inside three's Metal backend. **The path forward is our own framework:
[074 own-engine chain](../074-opensa-engine/readme.md).**

**Code/flags disposition — EXECUTED 2026-07-18, the answer was DELETE.** The flags
(`?webgpu/bundle/mat04/pool/fog/mesh1/cellcull/texfree/aa/dpr/appear/warm/bundledebug`) and the three
engine changes were kept in-tree for debugging until the own-framework work landed; they died with the
three-WebGL renderer in [074/13 phase 5](../074-opensa-engine/13-cleanup.md), and the surviving knobs are
now documented in [query-parameters.md](../../development/query-parameters.md). Backend-independent wins
(physics catch-up cap, bounded asset caches, texture-data freeing, frame-segment HUD) carried over to the
own engine as predicted.

<details><summary>Park write-up (the original data-driven verdict)</summary>

**Status: 🅿️ PARKED ON DATA (2026-07-11, evening).** The chain shipped plans 02/03-A/04-slices and a long
field-debugging campaign (see [08](08-pipeline-sharing.md) — the full forensic log). The CPU side is SOLVED
(render 65 → ~4-5 ms, physics catch-up capped, per-object pipeline compiles eliminated via the plain-Mesh path,
asset memory bounded). What killed it: on an M3 Pro the frame stays 40-300 ms in GPU/present territory
("unaccounted": resolution-INDEPENDENT, session-unstable, worse on interaction) across three peeled layers
(uniform-array codegen ~250 ms → fixed; no-culling world draw → fixed; memory pressure → mostly fixed) — and a
stubborn remainder attributable to the three-WebGPU backend on Metal, below our reach without owning the
backend. The bar was a stable 40 fps; the field says no. Everything is preserved: this chain, the patch
(`patches/three+0.185.1.patch`), the TSL materials, sky-lite, and the diagnostic toggles
(`?webgpu/bundle/mat04/pool/fog/mesh1/cellcull/texfree/aa/dpr/appear/warm/bundledebug`).

**What survives into PROD (WebGL) regardless:** the physics death-spiral cap (game.ts), the bounded asset
caches + texture-data freeing groundwork (memory pressure hurts WebGL too), the frame-segment HUD, and the
diagnosis that the path to 40 fps on ANY backend is fewer draw calls (art-side batching) — now with measured
certainty about where every millisecond goes.

**Revive conditions:** three lands the `referenceBuffer()` refactor + the WebGPU backend matures on Metal
(re-run `/webgpu-spike.html` + this chain's toggles first), or we build the thin custom static-world WebGPU
renderer (see the Babylon verdict's hybrid note).

> **SUPERSEDED 2026-07-18 — this chain is CLOSED and its harnesses are DELETED.** The third option won:
> the thin custom WebGPU renderer was built ([chain 074](../074-opensa-engine/readme.md)) and
> [shipped as the game's renderer](../074-opensa-engine/10-flip-decision.md). The spike harnesses
> (`webgpu-spike`, `webgpu-bundle-repro`, `webgpu-stream-compile`, `webgpu-tsl-material`,
> `babylon-spike`) were removed in 074/13 phase 3 — **their measurements and verdicts are preserved in
> prose under [`concept/`](concept/)**, which is what the revive instructions above should be read
> against. Re-creating a harness from those docs is cheap; three itself is gone from the tree.

</details>

<details><summary>Original ACTIVE status (2026-07-11 morning)</summary>

The concept's make-or-break bets are field-proven; this chain turns the working spike into a real renderer mode.

</details>

## Where we actually are (validated baseline)

Static render bundles **work in the real engine** behind `?webgpu=1&bundle=1` (three 0.185.1 +
`patches/three+0.185.1.patch`): fast initial load, live camera, smooth driving, **render CPU ~13 ms vs the 65 ms
WebGL baseline (5×)** — frozen floor ~5 ms. The composed streaming pipeline: budgeted appearance (`?appear=N`,
default 8; atomic behind the boot veil) → chunked wrap into ≤64-object `BundleGroup`s (one chunk/frame) →
heartbeat keeps shared camera groups uploading. Non-block-aligned DXT decodes to RGBA (WebGPU strictness).
Full chronology: [concept findings](concept/phase-1-findings.md).

## Concept audit — what survived, what changed

| Concept doc          | Verdict                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 bottleneck        | ✅ Valid — the diagnosis held exactly (draw submission wall; bundles collapse it).                                                                                                       |
| 02 port surface      | ⚠️ Partially outdated: world material EXISTS in TSL (classic+sun, cached); the rest of the inventory (sky/water/particles/post-FX/dynamics) still accurate — it is this chain's backlog. |
| 03 mechanism         | ✅ Validated, amended: bundles need OUR three patch (needsRefresh order, version-sync, heartbeat) until upstream lands.                                                                  |
| 04 migration plan    | ❌ Superseded by this chain (phases played out differently: bundles came FIRST, materials follow).                                                                                       |
| 05 risks             | ✅ Outcomes recorded; R1 materialized and was beaten by the patch.                                                                                                                       |
| 06 bake-vs-pass      | ✅ Standing decision — drives plan 07 (post-FX) + ties back to the parked 066 tooling (baked AO).                                                                                        |
| 07 Babylon           | ✅ Closed: not justified (global snapshot reset ~50 ms/swap; WebGL 3× worse).                                                                                                            |
| upstream-issue-draft | → action item, plan 01.                                                                                                                                                                  |

## The chain (priority order)

| #   | Plan                                                 | Priority | One-liner                                                                                     |
| --- | ---------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| 01  | [Upstream contribution](01-upstream-contribution.md) | **P0**   | File the three.js issue; keep the patch minimal/maintainable.                                 |
| 02  | [Dynamics materials](02-dynamics-materials.md)       | **P0**   | Player/vehicles are black silhouettes — lit TSL path + night fill.                            |
| 03  | [Sky & ambient](03-sky-and-ambient.md)               | **P0**   | No sky/sun/ambient under WebGPU — the world is dark; also drives the world-material uniforms. |
| 04  | [World-material slices](04-world-material-slices.md) | **P1**   | CSM sampling, unified fog, night emissive, moon, local lights in TSL.                         |
| 05  | [Shadows under WebGPU](05-shadows-under-webgpu.md)   | **P1**   | Sun near map + CSM plugin on WebGPURenderer; interplay with frozen bundles.                   |
| 06  | [Remaining effects](06-remaining-effects.md)         | **P2**   | Water, particles, coronas, uv-anim, wind, vehicle reflection.                                 |
| 07  | [Post-FX](07-post-fx.md)                             | **P2**   | Bloom+tonemap (TSL nodes), god-rays (custom), AO per bake-vs-pass, MSAA vs SMAA.              |
| 08  | [Pipeline sharing](08-pipeline-sharing.md)           | **P2**   | uuid-key neutralization + instanceMatrix capture → lighter cell appearances.                  |
| 09  | [Productionize](09-productionize.md)                 | **P3**   | bundle=1 default, flags→config, fallback policy, bench parity, patch hygiene.                 |

Rule of thumb: P0 makes `?webgpu=1` **playable-looking** (visible dynamics + sky); P1 brings **visual parity**
features; P2 completes parity + perf polish; P3 ships it.
