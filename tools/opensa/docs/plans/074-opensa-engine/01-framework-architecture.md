# 074·01 — Framework architecture

[← chain](readme.md) · next: [02 formats](02-native-formats.md)

The renderer framework: small, WebGPU-only, built to be extended and supported by us. Every decision below is
either a lesson borrowed from three.js/Babylon or a 073 wound designed out. **This is a design doc + task list;
no code until the chain is approved.**

## Lessons ledger — what we borrow, what we refuse

| Source                | Borrow                                                                                                                                                                                                         | Refuse (and why — 073 evidence)                                                                                                                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| three.js              | material-as-data mental model; render-list sort keys; small-math library conventions (we keep using three's `Vector3/Matrix4` as a MATH-ONLY dependency — battle-tested, tree-shakeable, no renderer imported) | scene-graph-driven rendering with per-object dynamic observers (`needsRefresh` magic); cache keys derived from MUTABLE object state (`object.uuid` → per-object pipelines); lazy first-draw compilation (compile storms); `onBeforeCompile` string patching (unversionable shader surgery); CPU copies retained for every GPU resource (3.5 GB heap) |
| Babylon               | **record/freeze as a first-class concept** (snapshot mode proved 0.12 ms submission); shader store with named includes; explicit `freezeWorldMatrix` semantics                                                 | engine-GLOBAL modes (their snapshot reset re-records the world — 50 ms/swap measured); god-object `Engine`/`Scene` coupling                                                                                                                                                                                                                          |
| id/UE-style renderers | frame graph (passes declare resources; graph owns barriers/lifetimes); bind-frequency-ordered descriptor spaces; handle-based resources                                                                        | full generality — ours is a FIXED graph re-built only on settings change, not a per-frame DAG solver                                                                                                                                                                                                                                                 |

## Module map (`packages/engine`, no imports from three's renderer or `packages/game`)

```
engine/
  core/       device.ts        — adapter/device init, feature+limit checks (BC, timestamp-query, A2C)
              resources.ts     — handle-based create/destroy: buffers, textures, samplers; debug names;
                                 residency ledger (bytes per category — the 3.5 GB lesson as an API)
              upload.ts        — staging ring; ALL writes go queue.writeBuffer/writeTexture at frame start
              pipelines.ts     — pipeline registry: OUR hash keys (shader-variant × state × pass-format);
                                 compileAll() behind the veil; misses in steady state are an ASSERTION
              shaders.ts       — WGSL module store: named includes + feature flags resolved at boot;
                                 variants ENUMERATED in code, snapshot-tested (no runtime string surgery)
  frame/      graph.ts         — fixed frame graph: pass list + transient target pool; rebuilt on settings
              passes/*.ts      — opaque, sky, transparent, water, particles, post/* — each a Pass impl
              submit.ts        — encoder orchestration; per-cell GPURenderBundle record/replay for statics
  world/      cells.ts         — cell registry: load(blob)→CellHandle (buffers+bundle), unload=destroy
              culling.ts       — cell-sphere frustum culling (bundle-level — 073-proven), group culling
              lights.ts        — local-light pool → data texture (073-proven mechanism)
  dynamics/   entities.ts      — flat entity list: transform + mesh + material ref (NO general scene graph;
                                 hierarchies — vehicle parts, bones — flatten CPU-side into a transform UBO)
              skinning.ts      — storage-buffer palettes; sampler for IFP clips (own, three-mixer-free)
  fx/         registry per 06/09 — each effect = WGSL module + optional pass + uniform slice
  debug/      hud.ts, gpu-timers.ts, capture.ts — the 073 instrumentation, core not afterthought
```

Math: `three/src/math/*` only (Vector3/Matrix4/Quaternion/Frustum/Sphere/Color) — imported from three as a
math lib, nothing else. If nx boundary policing gets awkward, vendor the six files.

## Binding model (WebGPU's 4 bind group spaces, ordered by change frequency)

| Group           | Contents                                                                               | Update cadence                                                                                  |
| --------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0 — frame       | camera (view/proj/pos), sun/moon/fog/time/dn uniforms, light-pool texture, horizon LUT | once per frame, one UBO write                                                                   |
| 1 — pass        | pass-specific (shadow matrices, post source targets, depth)                            | per pass                                                                                        |
| 2 — batch group | texture array view + sampler + group params UBO (blend class, flags)                   | per draw group (bound inside bundles for statics)                                               |
| 3 — draw        | dynamic-offset slice of a big transform/skin storage buffer                            | per draw (dynamics only; statics bake transforms into vertices or per-cell UBO at CONVERT time) |

Consequences: a static cell's bundle binds groups 2–3 once per group at RECORD; frame-level animation reaches
frozen bundles exclusively through group 0 — the exact heartbeat semantics we had to PATCH INTO three, native
here by construction.

## Pipeline & shader system

- **Pipeline key = (shaderVariantId, passFormatId, stateId)** — three small enums we own. Target counts:
  world opaque, world cutout (A2C), world blend, sky, water, particle, skinned, vehicle, ~8 post = **< 40
  pipelines total**, all compiled in `compileAll()` behind the load veil. A steady-state cache miss throws in
  dev — cold-start storms become impossible, not unlikely.
- **WGSL composition**: `shaders.ts` resolves `#include <module>` from a typed registry at boot; feature toggles
  are `const` overrides (WGSL `override`) or uniform-gated branches (the `uPipelineMix` pattern — measured fine),
  NOT preprocessor variant explosions. Every resolved variant snapshot-tested (golden WGSL files in the repo —
  shader diffs become reviewable).
- **naga/Metal guardrails as lint rules** (073 scars): no dynamically-indexed uniform-space arrays in fragment
  loops (use textures/storage); no unbounded loops; document each guardrail with its measurement.

## Frame graph (fixed, explicit)

```
[frame start] upload ring flush → group-0 UBO write
depth+opaque (MSAA 4×, A2C cutouts, front-to-back cells) → sky (depth-tested quad/dome)
→ transparents (per-cell bundles, back-to-front cell order, premultiplied) → water → particles/coronas
→ resolve MSAA → post: bloom(dual-filter) → god-rays → ACES+output
```

- Transient targets from a pooled allocator keyed by (size, format, samples); graph rebuild only on
  settings/resize.
- Every pass wraps in a GPU timestamp pair; the HUD shows per-pass ms — "unaccounted" can never happen again.

## Static world path (the 60 fps core)

1. Cell blob arrives GPU-ready (02/05) → create buffers, build group draw records, **record one
   GPURenderBundle per cell** (opaque+cutout; transparents recorded separately for ordering).
2. Per frame: frustum-cull cell spheres (CPU, ~hundreds of tests — 073-proven) → replay visible bundles.
   Draw count target: ~50 cells × 2–6 groups = **100–300 draws**.
3. Cell unload: destroy buffers + bundle — residency ledger goes down or it's a leak assertion.
4. Timed/breakable/animated objects live OUTSIDE bundles as mini-draw-lists toggled per frame (the 066/02
   mergeable predicate decides at CONVERT time).

## Extension points (the "easy to supplement" requirement, made concrete)

- **New post effect** = one file: `Pass` impl (declare inputs/outputs) + WGSL module + registration in the
  graph order table. No other file changes.
- **New material feature** = WGSL module + uniform slice in group 0/2 + (only if unavoidable) a new
  shaderVariantId. PR must state the pipeline-count delta.
- **New debug view** = HUD panel or capture hook; debug module has stable APIs.
- **A worked example of each** ships with M2 so contributors copy a known-good pattern.

## Tasks

- [~] Write `packages/engine` skeleton per the module map (empty impls, types + nx tags enforcing the import
      boundary) — after chain approval.
- [~] `device.ts`: init + feature matrix check (BC textures, timestamp-query, A2C w/ MSAA4) with explicit
      Safari/Chrome notes; hard-fail messaging for unsupported browsers (prod keeps three-WebGL).
- [~] `resources.ts` handles + residency ledger + leak assertions on cell unload.
- [~] `shaders.ts` include resolver + variant snapshot tests + the naga guardrail lint (a unit test that greps
      resolved WGSL for banned patterns).
- [~] `pipelines.ts` registry + `compileAll()` + steady-state-miss assertion.
- [~] Frame graph with transient pool + per-pass timestamps; HUD port from 073.
- [~] Static path: cells.ts + bundle record/replay + sphere culling.
- [~] Dynamics path: flat entities + transform storage buffer + dynamic offsets.
- [~] API review checkpoint at M0: one page of "how you add an effect/material/pass" — if it takes more than a
      page, the architecture failed the supportability requirement; iterate before M1.

## Measurement ledger

(append per milestone — submit ms, per-pass GPU ms, pipeline count, residency bytes)
