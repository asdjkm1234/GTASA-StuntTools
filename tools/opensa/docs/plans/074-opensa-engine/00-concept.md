# Concept: OpenSA engine — own framework, own formats, 60 fps

**Question:** can a purpose-built engine (own WebGPU renderer + own texture/model formats + offline tools) deliver
**60 fps with the FULL current WebGL effect set** on the same world data?

**Status: 🎓 GRADUATED — this is the research record behind [the 074 chain](readme.md) (2026-07-11); moved here
from `docs/concepts/opensa-engine/`.** Born from the failed
[073 three-WebGPU migration](../073-webgpu-migration-threejs/readme.md):
the campaign proved the browser is NOT the limit — the framework and the data shape are. Every number below is a
field measurement from that campaign, not an estimate.

---

## Why this is credible (measured foundations)

| Claim                                            | Evidence (ours, this hardware — M3 Pro)                                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser WebGPU submits a full SA scene for ~free | Babylon Snapshot FAST: **0.12 ms** CPU @ 15k draws; our patched three bundles: 4–5 ms _while fighting the framework_                                                                                                      |
| The GPU cost of the PICTURE is small             | vanilla SA runs 100+ fps on this class of hardware; our 31 ms WebGL GPU is state-churn + unbatched draws + retina post — not the pixels                                                                                   |
| The pathologies were three's, not the platform's | per-object pipelines (uuid cache key), naga uniform-array occupancy collapse (~250 ms), unexplained Metal present overhead — all located INSIDE the framework (073/08 forensic log)                                       |
| The data half is already designed                | the [066 tool chain](../066-pmb-modern-tool/readme.md) specs the native cell format, batching, baked shadows/AO/emissive — it was parked because it fed _three-WebGL_; it is exactly the asset pipeline this engine needs |

**Why 066 batching "didn't work" before and will now:** the tooling experiment measured −23 % against the 65 ms
draw-submission wall — batching couldn't pay while every draw cost 4.4 µs of three-WebGL overhead. In an engine
whose submission is ~free and whose draws are _designed_ to be few, batching is not an optimization — it is the
data model.

---

## The three pillars

### 1. Data: everything expensive happens offline (extends the 066 chain)

- **Cells, pre-batched at build time.** One cell = a handful of draws (opaque groups by texture-array page ×
  blend class × side flags, plus separate timed/breakable/animated objects). Interleaved vertex buffers,
  meshopt-compressed, GPU-ready (worker → transferable → `queue.writeBuffer`, zero main-thread parsing).
  Vertex channels: position, normal, uv, day prelit, night prelit, AO/skyVis, emissive mask, sway weight —
  the whole current lighting model rides vertex data we already know how to bake.
- **Textures: texture ARRAYS, not atlas pages.** The 066 experiment measured atlases losing (−7 %) because GTA
  UVs TILE (repeat wrapping) — atlasing breaks tiling. `texture2d_array` layers keep native per-layer tiling
  while letting one bind group cover a whole batch group. Same-size-class textures pack into shared arrays;
  odd sizes get padded or bucketed.
- **The alpha pipeline — kills [alpha-edge](../../open-issues/fixed/alpha-edge.md) BY CONSTRUCTION:**
  1. **Offline classification** per texture: `opaque` / `cutout` / `soft-blend` (analysis of real alpha
     content — no runtime `hasAlpha` heuristics).
  2. **Premultiplied alpha everywhere.** The black fringe exists because we filter NON-premultiplied data with
     black transparent texels; filtering premultiplied data is mathematically correct — transparent texels
     contribute exactly nothing. This is the complete fix the issue doc reaches for, plus:
  3. **Offline mips**: edge dilation at the base level (already prototyped in the issue) + alpha-weighted
     downsampling for the chain — three's straight-average `generateMipmaps` (the second half of the root
     cause) simply doesn't exist here.
  4. **Alpha-to-coverage for cutouts** — our renderer owns MSAA (the current post-FX path couldn't), which is
     exactly the soft-foliage-edge tool the issue's approach #1 lacked.
  - Encode: BC7 (quality alpha, universal desktop WebGPU support) with BC1 for opaque; own container or KTX2 —
    either way WE generate the mip chain.
- **Own pak with range reads** (replaces holding the ~1 GB IMG ArrayBuffer in JS — the memory-pressure lesson).

### 2. Renderer: small, owned, WebGPU-native

- **Draw model:** ~50 visible cells × 2–6 draws = **100–300 draws/frame** (vs 14 454). At that count native
  bundles are almost optional — but we record per-cell bundles anyway (proven granularity from Phase 1a) and
  keep pipelines in the DOZENS (we own every cache key; the entire pipeline set compiles behind the load veil —
  cold-start storms are impossible by design).
- **Bind scheme:** per-frame UBO (camera/sun/fog/time) · per-pass · per-batch-group (texture array + params) ·
  per-draw (object/cell transform). Local-light pool as a data texture (the trick field-proven in 073).
- **Frame graph:** opaque (front-to-back, A2C cutouts) → sky → transparents (per-cell sorted, premultiplied) →
  water → particles/coronas → post (bloom → god-rays → ACES; MSAA resolve replaces SMAA).
- **Memory:** GPU-resident everything; JS holds handles, not payloads (the 3.5 GB lesson).
- **Diagnosability:** the frame-segment HUD + GPU timestamp queries from day one — the 073 campaign's core
  process lesson (render CPU is not the frame).

### 3. Runtime: gameplay stays, the renderer is swapped under it

Streaming (cells/rings/hysteresis/workers), physics (rapier), character/vehicles logic, zones/time/weather —
all framework-agnostic today and stay as-is. The engine boundary is narrow: "here are GPU-ready cell blobs,
here are dynamic entities with transforms/skins". The existing three-WebGL prod path REMAINS INTACT during the
whole build-out (additive, no flag day — 066 ground rule).

---

## Effect parity map (current WebGL modern set → new engine)

| Effect (shipped today)                    | New home                                                              | Note                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Prelit day↔night blend                    | vertex channels                                                       | unchanged model, already baked                                              |
| Hybrid sun (prelit indirect + N·L direct) | WGSL                                                                  | math ported already (073/04)                                                |
| CSM static shadows                        | **BAKED static occlusion** (066/03) + small dynamic-only near cascade | fixes the "angular/jittery" complaint AND deletes the +35–50 % caster draws |
| SSAO                                      | **baked AO/skyVis channel** (066/04)                                  | ground-truth AO, no prepass                                                 |
| PBR sky + horizon LUT                     | compute-generated LUT                                                 | no ShaderMaterial constraint                                                |
| Unified LUT fog                           | WGSL (ported in 073/04)                                               |                                                                             |
| Local light pool (headlights/lamps)       | data texture (073-proven) → clustered later                           |                                                                             |
| Night emissives / window glow             | vertex channel + emissive mask                                        |                                                                             |
| Bloom + ACES                              | post passes                                                           | trivial WGSL                                                                |
| God-rays                                  | post (radial blur from sun)                                           | moderate port                                                               |
| SMAA                                      | **MSAA native**                                                       | simpler AND enables A2C                                                     |
| Water (waves/shore/glint)                 | WGSL port                                                             | shader exists                                                               |
| Particles / coronas                       | instanced billboards                                                  | simple                                                                      |
| Wind sway                                 | vertex anim (swayWeight channel)                                      | data exists                                                                 |
| Skinned player + IFP                      | storage-buffer skinning                                               | standard technique; the grind is anim plumbing                              |
| Vehicles + SA env reflection              | WGSL port (sphere-map logic exists)                                   |                                                                             |
| Procobj clutter                           | true instancing                                                       | natural fit                                                                 |

## 60 fps budget (16.6 ms, M3-class, 2× retina)

| Slice                              | Target                       | Basis                                                    |
| ---------------------------------- | ---------------------------- | -------------------------------------------------------- |
| CPU sim (physics/streaming/game)   | 3–4 ms                       | measured today (fixed 2–3 + update <1)                   |
| CPU submit                         | <1 ms                        | 100–300 draws + bundles (Babylon datum: 0.12 ms)         |
| GPU opaque world                   | 3–5 ms                       | batched, A2C, no static caster passes                    |
| GPU dynamics + near shadow         | 1–2 ms                       |                                                          |
| GPU transparents/water/sky         | 2–3 ms                       |                                                          |
| GPU post (bloom/rays/ACES/resolve) | 2–3 ms                       |                                                          |
| **Total**                          | **~10–13 ms GPU, ~5 ms CPU** | 60 fps with margin; tiers (dpr/post) for lesser hardware |

## Risks — honest

1. **Scope:** 2–4 focused months (comparable to the abandoned three-WebGPU full port, but with zero black boxes —
   the decisive difference, as 073 proved).
2. **Dynamics parity is the grind** (skinning/IFP/vehicle damage states) — schedule it early, not last.
3. **Safari/iOS WebGPU** maturity; BC7 + A2C are fine on Apple GPUs, but test early. Fallback = the intact
   three-WebGL path (which can ALSO consume the batched cells for a free interim win).
4. **Bake times/tooling** — mitigated by existing pmb/map-optimizer infrastructure and the 066 specs.
5. **The unknown unknowns of owning a renderer** — mitigated by the 073 instrumentation discipline: every phase
   gates on measured numbers, never on vibes.

## Phasing (each phase gates on a number)

- **P0 — spike (1–2 wks):** hand-written mini-renderer + minimal cell converter for one district; bundles +
  texture arrays + A2C. **Gate: that district at 2× retina in <5 ms GPU, <1 ms submit.** Also the alpha-edge
  visual check (vgsebushes / fences) — the premultiplied pipeline should kill the fringe in P0 already.
- **P1 — formats + tools:** execute the 066 chain (01 format, 02 batching, 03 baked shadows, 04 channels) against
  the new target; full alpha pipeline; pak + range reads.
- **P2 — world parity:** streaming feeds the new renderer; sky/fog/sun/baked shadows/local lights/emissives.
- **P3 — dynamics:** character skinning + IFP, vehicles, particles, water.
- **P4 — post + tiers + A/B vs WebGL prod;** flip the default only when better on every bench scene.
