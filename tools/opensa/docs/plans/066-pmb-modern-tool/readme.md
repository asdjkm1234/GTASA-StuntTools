# 066 — Modern asset tool (perfect-map-builder → opensa native cells)

**Status: 🔒 CLOSED 2026-07-21 (user triage) — superseded by the own WebGPU engine ([074](../074-opensa-engine/readme.md)): every effect re-implemented there; remaining tails in this plan are void.**

> **The unticked boxes below are VOID with the plan, and are struck rather than deleted (2026-08-11).**
> They were left as `- [ ]` when the chain was closed, so every repo-wide scan for open work kept
> reporting them — 118 phantom tasks across the ten closed chains. Nothing here is a debt: the banner
> above is the authority. They stay readable because what these plans INTENDED is still the record of
> why the own engine does what it does.


Part of the [rendering overhaul chain](../062-rendering-overhaul/readme.md). This grew from a single "baked-channels asset
step" into a small tool chain because the bench data ([072 measurements](../072-quality-tiers-default-flip/readme.md)) showed
the real win is not more shader work — it is **moving cost offline**. We are draw-call-bound, and the modern pipeline
made it worse: CSM alone adds **+35–50 % draw calls** (caster passes), the HDR post chain is a uniform GPU tax, and the
static world still emits one small draw per cell as if it were DFF. A build-time format we fully own is the one place
that can attack all three at the source.

Starts after [065](../065-cascaded-shadows/readme.md) proved the runtime (so we bake what's actually needed). We are no longer
bound to DFF/TXD for the `opensa` target — this chain uses that freedom.

## Why this is a tool, not a tweak (the perf thesis)

Tie every claim to the 072 bench numbers (M3 Pro, "everything but volumetric"):

| Bottleneck (measured)                                           | Offline lever this tool unlocks                                                          | Sub-plan                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------- |
| Draw-call-bound; `ls-noon` 14 454 draws, night scenes CPU-bound | **Build-time batching** — atlas-merge static cell geometry → thousands of draws → dozens | [02](02-static-batching.md)             |
| CSM = +35–50 % draws **and** looks angular / jittery (user)     | **Bake static→static shadows**; CSM shrinks to dynamic-only short range                  | [03](03-baked-sun-occlusion-shadows.md) |
| SSAO half-res prepass + double-lit prelit (002 global split)    | **Baked skyVis/AO + emissiveMask** per vertex → ground SSAO, kill double-lit             | [04](04-ambient-emissive-channels.md)   |
| VRAM / upload / streaming hitches (plan 060 territory)          | **meshopt geometry + KTX2 atlas** — half the VRAM, cheap decode                          | [01](01-native-cell-format.md)          |

The headline the user asked for: **the static world's shadows should be baked, not run through CSM every frame** — they
read as angular (shadow-map stair-stepping) and jittery (cascade swim under camera motion). Baked static occlusion is
evaluated analytically per vertex/fragment → no map resolution, no cascade transitions → smooth and stable, and it drops
the static caster passes we measured. CSM stays only for cars/peds at short range where a small hi-res near cascade looks
fine and never swims against static geometry. See [03](03-baked-sun-occlusion-shadows.md).

## Ground rules (kept from the original scope)

1. **Additive pipeline stage, additive format.** A new optional pmb step for the opensa target emitting an
   opensa-native cell format **beside** (not instead of) DFF/TXD; the runtime loads native cells when present, falls
   back to DFF/TXD otherwise. No flag-day migration.
2. **Lean custom binary**, we own the writers/readers + VFS (glTF adds container overhead we don't need).
3. **Scope guard**: NO new material system, no normal maps, no PBR texture authoring — geometry batching + compression +
   baked scalar channels + baked static occlusion only. Anything more is a later chain.
4. **Determinism + budget guard**: deterministic (fixed seeds); reports per-cell byte sizes and draw counts; pmb fails
   loudly if native output exceeds a configured total (same spirit as `checkImgIdBudgets`).
5. **Graceful runtime**: every consumer degrades cleanly when an attribute/channel/baked map is absent (a cell without
   the new data renders exactly as today).

## The chain

| #   | Plan                                                                               | Delivers                                                                       | Depends on |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------- |
| 01  | [Native cell format](01-native-cell-format.md)                                     | versioned binary + meshopt buffers + KTX2 atlas; writer/reader; fallback       | 065        |
| 02  | [Static batching (draw-call reduction)](02-static-batching.md)                     | atlas-merge cell geometry → dozens of draws/cell; cull-granularity balance     | 01         |
| 03  | [Baked sun occlusion → static shadows + sunVis](03-baked-sun-occlusion-shadows.md) | smooth static shadows that track the sun (no map, no jitter); CSM→dynamic-only | 01         |
| 04  | [Baked ambient + emissive channels](04-ambient-emissive-channels.md)               | skyVis/AO (grounds SSAO, indirect) + emissiveMask (feeds 071 glow)             | 01         |
| 05  | [Runtime integration, CSM scope-down, tiers](05-runtime-csm-scopedown-tiers.md)    | world material consumes it all; CSM reconfigured; feeds 072 tiers; bench       | 02–04      |

Sequence: **01 first** (everything rides on the format + atlas). Then **03 is the priority** (the shadow complaint is
the motivation), 02 and 04 are independent and can interleave. **05 lands last** — it flips consumption on and re-scopes
CSM once the baked data exists. 03 and 04 share one offline baker (a visibility raytrace over welded cell geometry,
reusing the LOD-generator occlusion helpers).

## Verification (chain-level)

- **Perf**: draws/cell and frame ms before/after on the 6 bench scenes vs the 072 modern baselines — batching + CSM
  scope-down must move the CPU-bound night scenes (`lv-night`, `ls-rain-night`) most.
- **Shadows**: static shadows read smooth and stable under camera motion (no stair-step, no swim) vs current CSM; A/B
  screenshots in a shadow-heavy area.
- **Correctness**: baked-shadow areas no longer double-lit at noon; no cell-border seams (bake over WELDED geometry).
- **Fallback**: a DFF/TXD-only build is byte-for-byte unaffected; native + classic pipelines both green.

## Measurements

_(chain roll-up — each sub-plan records its own; copy headline numbers here)_

- draws/cell: DFF → batched: …
- frame ms (6 scenes), modern-072 → modern+native: …
- shadow GPU ms: CSM-only → baked-static + dynamic-near: …
- VRAM (KTX2), bake time (full map), bytes/cell: …
