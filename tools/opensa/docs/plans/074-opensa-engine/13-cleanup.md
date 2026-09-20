# 074·13 — Post-flip cleanup (drop the old graphics stack)

[← chain](readme.md) · prev: [10 integration](10-integration-flip.md) · gate:
[the flip decision](10-flip-decision.md) — **PASSED 2026-07-18**

**STATUS: COMPLETE — all 8 phases shipped 2026-07-18. `three` no longer exists in this repository**
(importers 122 → 0 · `node_modules` 512 → 455 MB · prod JS 5.4 → 2.88 MB · suite 289/1 815 green ·
lint green · bench ritual PASS). Two items were left OPEN **on purpose** rather than silently resolved:
the coverage floors (red for a structural reason — see 6.6/8.3) and the `flags.ts` question (decided
against, 2.4). **The coverage item was RESOLVED the same day by [plan 077](../077-unit-coverage/readme.md)** —
a device-independent seam (a recording `GPUDevice` stand-in), 72.29 → 88.18 %, floors re-armed, no engine
source touched.

Once the own engine is the shipping renderer (plan 10's criteria signed off), the old stack becomes dead
weight: two renderers to maintain, a debug-flag zoo, and heavyweight dependencies. This plan deletes them.
**User decision (2026-07-12): after a successful integration the old graphics DROP — including the
three-WebGL fallback**; the shipped app's minimum requirement becomes WebGPU (this supersedes flip
criterion 4's "keep three-WebGL for non-WebGPU browsers" — revisit ONLY if usage data demands it).

**GATE STATUS: OPENED by the user 2026-07-18** ("now we must fully cut out the whole old engine").
The comparison period declared on 2026-07-13 is over; `?engine=three` and everything behind it may now be
deleted. This is the **C2** command the chain has been referring to.

## What drops (the original four, unchanged in intent)

1. **The old graphics path** — the three-WebGL render pipeline in `packages/game`/`packages/renderware`:
   world materials (GLSL + TSL twins), post-processing chain (SMAA et al.), CSM, SSAO, the
   sky/water/grading plugins, `build-region`/`build-cell` three-object producers, InstancedMesh streaming.
   The game logic (systems, physics, zones, time) stays — it is renderer-agnostic (verified in the plan-10
   audit) and rebinds to engine entity handles (plan 08).
2. **Debug parameters** — the whole 073 flag zoo (`?webgpu`, `?bundle`, `?mat04`, `?pool`, …). Full
   disposition table in [phase 2](#phase-2--query-parameter-disposition).
3. **Libraries**: `three`, `three/webgpu`, `postprocessing`, `@babylonjs/core`, `@types/three`, **and our
   three patch** — plus the spike HTML entries.
4. **Docs**: mark the 073 chain's "flags stay in-tree for debug" note as executed; open-issues that were
   WebGL-specific get re-verified against the new engine and closed or re-filed.

---

## Phase 0 — INVENTORY (done 2026-07-18, three parallel sweeps)

The numbers this plan is scoped against. Everything below traces to these.

| Fact                                                       | Number                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Source files importing `three` or a three-adjacent package | **122**                                                                                              |
| — bucket (a) the WebGL render path                         | ~52 files, ~12 000 src lines                                                                         |
| — bucket (b) three used ONLY as a math library             | **20 files, ~4 200 src lines** → the `@opensa/math` job, [phase 1](#phase-1--opensamath-the-enabler) |
| — bucket (c) tests                                         | **50 test files**                                                                                    |
| — bucket (d) tools / tools-debug / node CLIs               | **ZERO** — tools only deep-import the three-free parser layer                                        |
| Declared three-adjacent deps                               | root `package.json` only: `three`, `postprocessing`, `@babylonjs/core`, `@types/three`               |
| Our three patch                                            | `patches/three+0.185.1.patch`, 207 lines, patches ONLY `three.webgpu.js`                             |
| Callers of the old public entry `createRenderContext`      | **exactly one** — `packages/game/src/game.ts:319`                                                    |
| URL query parameters read in code                          | **~60**, no central flags module — every one read inline at its use site                             |
| Documented-but-dead params                                 | **10** (`msaa`, `bloomq`, `ssr`, `carshadow`, `panorama`, `cloudcover`, …)                           |

### The three findings that shape the plan

1. **`packages/renderware/src/three/` (43 files, ~4 360 src + ~3 000 test lines) is kept alive ONLY by
   `apps/viewer`.** Once the game host flips, the four asset viewers are the sole consumers. So the viewer
   question is **on the critical path of the teardown, not a follow-up** — see
   [phase 4](#phase-4--the-viewers-the-critical-path).
2. **Our three patch is WebGPU-only** (`three.webgpu.js` — the 073 bundle/observer/heartbeat hacks). It
   was never load-bearing for the shipping WebGL path; it dies with the dependency, and nothing needs to
   be re-implemented on our side.
3. **Tools are already clean.** No file under `tools/`, `tools-debug/`, `asi/`, `scripts/`, `e2e/` imports
   three — they consume `@opensa/renderware` through deep subpath imports of the parser/archive layer.
   The teardown cannot break the tool chain, which removes the scariest class of risk up front.

   **CORRECTION (found during phase 4, 2026-07-18):** that sweep looked for `from 'three'` and so missed
   DEEP imports into `renderware/src/three/`. Two real ones exist and are phase-5 work:
   `tools/opensa-pack/src/water.ts` imports `oceanFrame` from `three/build-water`, and
   `renderware/src/archive/asset-cache.ts` imports `buildTextureMap` from `three/build-texture`.
   Neither is actually three-COUPLED — `oceanFrame` is pure `WaterQuad` math that merely lives in a
   three file — but both must be moved out before that directory can be deleted. The conclusion holds
   (no tool depends on three itself); the file count does not.

---

## Order of operations (and why)

**Delete before you rewrite.** Every phase that removes code comes before the phase that would have had
to port it. Concretely: kill the spikes and the WebGL host first, so the viewer port and the math
extraction are sized against what actually survives — not against 122 files, most of which are about to
stop existing.

| Phase | What                                            | Unblocks                                  |
| ----- | ----------------------------------------------- | ----------------------------------------- |
| 0     | Inventory                                       | (done)                                    |
| 1     | `@opensa/math` — the enabler package            | phases 5, 6, 7                            |
| 2     | Query-parameter disposition + the canonical doc | phase 3 (some params die with their host) |
| 3     | Spike/standalone deletion (cheapest, zero risk) | shrinks phase 5's surface                 |
| 4     | The viewers decision + execution                | phase 5's `renderware/src/three` deletion |
| 5     | WebGL render-path deletion, package by package  | phase 7                                   |
| 6     | Test rework                                     | rides along with 3/4/5                    |
| 7     | Dependency prune + patch removal + size ledger  | the finish line                           |
| 8     | Close-out: bench ritual, docs, arch-graph       | —                                         |

**Every deletion PR runs the full suite + the bench ritual. Numbers must NOT move — by phase 5 this is all
dead code, and a moving number means we deleted something live.**

---

## Phase 1 — `@opensa/math`, the enabler

The blocker for dropping the dependency: 20 files use three purely as a math library. The engine
(`packages/engine`) is already three-free, so this package is what lets `packages/game` and
`packages/renderware` join it.

**Measured surface — the ENTIRE set of three symbols used as math across the repo:**
`Vector2`, `Vector3`, `Vector4`, `Matrix4`, `Quaternion`, `Box3`, `Sphere`, `MathUtils`.
(No `Euler` anywhere — a real simplification. `Matrix3` unused.)

Three harder cases that are NOT math and need their own answer:

- **`Object3D` as an opaque scene-node handle** — 7 files, type-only in all but
  `character/orient-character.ts`. Replacement = the engine's entity handle (plan 08's design), not a
  math type.
- **The animation triple** — `AnimationMixer` / `AnimationClip` / `VectorKeyframeTrack` /
  `QuaternionKeyframeTrack` in `character/animation-controller.ts`, `three/build-anim-clip.ts`,
  `three/animated-objects.ts`. **`packages/engine/src/anim/ifp-sampler.ts` already exists three-free** and
  is the intended replacement — this is a rebind, not a rewrite.
- **`three/addons` `OrbitControls`** in `core/camera-controller.ts` and all four viewers — small, and the
  engine-lab already has its own orbit camera to lift from.

### Tasks

- [x] **1.1 DONE 2026-07-18** — `packages/math` (`@opensa/math`) created: nx tags `type:engine` +
      `scope:osengine` (so engine/game/renderware may all consume it), zero runtime deps, added to the
      root `workspaces`.
- [x] **1.2 DONE 2026-07-18** — the measured surface implemented three-compatibly: `Vector2/3/4`,
      `Quaternion`, `Matrix4`, `Box3`, `Sphere`, `MathUtils`. **Compatible signatures are a deliberate
      choice**: the migration becomes an import-path rewrite in ~20 files instead of a logic rewrite in
      ~4 200 lines. Design note: the modules are acyclic because cross-type arguments are STRUCTURAL
      (`Vector3Like`/`QuaternionLike`/`Matrix4Like` in `types.ts`) rather than class imports — which also
      lets the engine's own math types be passed in without conversion. Column-major `Matrix4.elements`
      with row-major `set()` args, exactly as three, so buffers and fixtures transfer verbatim.
- [x] **1.3 DONE 2026-07-18** — parity suite green **against three itself**: `capture-three-fixtures.ts`
      is a one-shot CLI that recorded what three@0.185.1 actually returns for every subtle operation
      (compose/decompose, invert, extractRotation, lookAt, slerp, setFromUnitVectors incl. the opposite-
      vector branch, applyQuaternion, transformDirection, Box3.applyMatrix4, Sphere.applyMatrix4), and
      `three-parity.test.ts` asserts our implementation against that committed JSON to 8 decimals.
      12 tests, negative cases first. **This is the whole safety net for the teardown: after the
      dependency is gone the fixture is the only remaining witness of what three did.**
      Two capture lessons worth keeping: (a) the first sample vector was collinear with the rotation
      axis, so `applyQuaternion`/`applyAxisAngle` returned it unchanged and would have passed against any
      implementation — the sample is now deliberately off-axis; (b) the fixture pins that three moves a
      mirrored axis onto **X** in `decompose` (input scale `(2, 0.5, -1.5)` comes back `(-2, 0.5, 1.5)`),
      which is exactly the kind of silent disagreement a hand-rolled port produces.
      Suite after the phase: **331 files / 2171 tests green** (from 330/2159), tsc + eslint clean.
- [x] **1.4 DECIDED — the engine KEEPS its own math** (`packages/engine/src/core/math.ts`; it imports
      `@opensa/math` nowhere, verified 2026-07-18). They are different shapes for different jobs: the
      engine works on `Float32Array` column-major `Mat4` and readonly tuples it can hand straight to
      `writeBuffer`, while `@opensa/math` is a three-compatible OBJECT api (`.x/.y/.z`, mutable, chainable)
      whose whole purpose is that the teardown could be an import swap. Merging them would force one of
      those two callers into the other's allocation model. Both are ~100 % covered (plan 077).
      (Engine currently has its own; do NOT churn it just for symmetry — record the reason either way.)
- [x] **1.5 PART 1 DONE 2026-07-18 — the pure-math files are off three (122 → 109 importers).**
      Migrated: `physics-world`, `enter-vehicle.system`, `vehicle-damage.system`,
      `vehicle-physics.system`, `build-colliders`, `procobj-colliders`, `procobj-scatter`,
      `collider.interface`, `world-adapter.interface` (its `Matrix4` only) + the matching tests.
      Suite 331/2171 green, tsc + eslint clean.

      **The `placementMatrix` extraction (unplanned, and it unblocked the collider cluster):**
      `procobj-colliders` could not migrate because it imports `placementMatrix` from
      `build-procobj.ts` — a RENDER-PATH file scheduled to die in 5c. The function is pure math and its
      own doc comment says it is shared by the render meshes and the clutter colliders, so it moved into
      the SURVIVING `procobj-scatter.ts` (re-exported through the map barrel). `build-procobj` now
      imports it back and carries a two-line bridge (`matrix.fromArray(...elements)`) into three's
      `InstancedMesh`, commented as temporary and dying with the file. Net effect: phase 5c gets smaller,
      not bigger.

- [x] **1.5 PART 2 — RESOLVED by phases 4–6, exactly as predicted.** Every one of the seven was a scene-graph problem, so every one was settled by its three object GOING AWAY rather than by a bridge: `camera-controller`, `setup-character`, `hidden-instances` and `procobj`'s render path were DELETED; `streaming.system` and `character-controller.system` survived on `@opensa/math` (the latter needed only a structural `LookDirectionSource`, phase 6). `@opensa/math` never grew `Box3.setFromObject` or `Sphere` interop. **Original analysis, kept because it was right:** Seven files were migrated, hit type errors
      at the seam with three OBJECTS, and were deliberately REVERTED rather than bridged:
      `camera-controller` (`OrbitControls`, `Box3.expandByObject`), `setup-character`
      (`Box3.setFromObject`), `hidden-instances` + test (`InstancedMesh.setMatrixAt`),
      `streaming.system` + test (copies a three geometry's `boundingSphere`),
      `character-controller.system` (`camera.getWorldDirection`), `procobj-runtime.test`.
      **These are not math problems — they are scene-graph problems**, and the missing methods
      (`Box3.setFromObject`/`expandByObject`, `Sphere` interop) are ones `@opensa/math` must NOT grow:
      they need an Object3D. They migrate when their three objects go away, which is exactly what
      phases 4 and 5 do. Reverting was the cheaper honest move over scattering bridge code through
      files that are about to be rewritten anyway.
- [x] **1.6 DISCHARGED IN PHASE 6 (2026-07-18)** — no rebinding was needed: the engine host already runs
      on `IfpSampler` (`engine-player.ts`), so the animation triple was dead code and was DELETED rather
      than ported. `build-anim-clip.ts` / `animated-objects.ts` went with phase 5.

**Gate for this phase:** `packages/game` and `packages/renderware` have zero `from 'three'` imports
outside `renderware/src/three/` and the files scheduled for deletion in phase 5.

---

## Phase 2 — Query-parameter disposition

No central flags module exists — ~60 params are read inline via `new URLSearchParams(...)` at their use
sites, and there is **no canonical reference doc**. This phase both cuts and organizes.

**Bucket A — DIE with the old renderer (17):** `webgpu`, `aa`, `dpr`, `bundle`, `bundledebug`, `texfree`,
`mesh1`, `warm`, `appear`, `cellcull`, `fog`, `nocull`, `shadowdebug`, `mat04`, `matcache`, `pool`, and
`engine` itself (the `three` override loses its target). These discharge the standing 073 agreement.

**Bucket B — KEEP (our engine's knobs):** `src`, `scale`, `aces`, `bloom`, `probe`, `probeview`, `draw`,
`spawn`, `weather`, `hour`, `sky`, `clouds`, `fogscale`, `ao`, `sunvis`, `wind`, `stoch`, `daycycle`.

**Bucket C — KEEP, these are HARNESS CONTRACTS:** `bench`, `soak`, `benchcar`, `test=leak`. Note the real
contract is the **console protocol** (`[bench]`/`[soak]` tags, `sweep complete`) which `drive.js` and
`gate-check.js` scrape — but the documented URLs in `docs/development/benchmarks.md` use these params, so
breaking them silently breaks the ritual.

**Bucket D — die with their host** (spike params: `count`, `mode`, `swap`, `dn`, `pipeline`, `snapshot`,
`rot`, `fix`, `precompile`, `ctx`, `variant`) or **survive with the viewers** (`tab` — asserted by
`e2e/viewer-tabs.spec.ts`, so it is an e2e contract).

**Bucket E — KEEP (lab scene setup, renderer-independent):** `pak`, `boxes`, `freeze`, `at`, `orbit`,
`az`, `el`, `ped`, `pedy`, `vehicle`, `vmodel`, `drive`, `cells`, `stream`.

**DEAD — documented but read nowhere (purge from DOCS):** `msaa`, `bloomq`, `ssr`, `carshadow`,
`panorama`, `cloudcover`, `lighting`, `path`, `speed`, plus `engine=opensa` (a no-op alias — the code only
tests `engine === 'three'`) and engine-lab's advertised `?soak=` (only `engine-perf-runs.ts` implements
soak, the lab does not).

### Tasks

**DONE 2026-07-18 (with phase 8).** A fresh sweep of every param-reading idiom found that only
**four browser files** read query params at all, and **every bucket-A name is already dead** — they went
with their code in phases 3 and 5, exactly as 2.1 predicted.

- [x] **2.1 DONE (in phases 3/5)** — verified by sweep: `webgpu`, `engine`, `aa`, `dpr`, `bundle`,
      `bundledebug`, `texfree`, `mesh1`, `warm`, `appear`, `cellcull`, `fog`, `nocull`, `shadowdebug`,
      `mat04`, `matcache`, `pool` are read NOWHERE. Same for every bucket-D spike param and every name
      on the DEAD list (`msaa`, `bloomq`, `ssr`, `carshadow`, `panorama`, `cloudcover`, `lighting`,
      `path`, `speed`).
- [x] **2.2 DONE** — the docs sweep in phase 8 covered this; retired features are described as retired
      (the "Retired parameters" section of the new doc) rather than silently dropped.
- [x] **2.3 DONE** — [`docs/development/query-parameters.md`](../../development/query-parameters.md):
      every live param with default, values, read site and subsystem; the harness-contract params
      (`bench`/`soak`/`benchcar`/`tab`) called out as contracts; the retired list preserved so an old
      bookmark can be recognised; and the two cross-host inconsistencies documented rather than
      silently "fixed" (`src` defaults differ per host; `hour=0` means midnight only in the game host).
- [x] **2.4 DECIDED — NO `flags.ts`, against the plan's own recommendation.** The count fell from ~60 to
      **22 distinct names**, most read exactly once, and the two hosts read overlapping-but-differently-
      defaulted sets — a shared reader would have to model that difference rather than remove it. The
      zoo grew because nothing was written down, not because reads were inline. Revisit if the count
      climbs again; the reasoning is recorded in the doc itself so the next person can re-decide.
- [x] **2.5 DONE (in phase 5a)** — `?engine=three` died with the WebGL host; there is no A/B left to
      revert to, which is what the flip decision ratified.

---

## Phase 3 — Spike & standalone deletion (cheapest first, zero risk)

All self-labelled throwaways from the 073 era. Nothing imports them; each has a root HTML entry listed in
`vite.config.ts:86-92`.

### Tasks

- [x] **3.1 DONE 2026-07-18** — `babylon-spike.{ts,html}` deleted, and since it was the **only**
      `@babylonjs/core` importer the dependency went with it immediately rather than waiting for phase 7:
      **`node_modules` 604 → 512 MB (−92 MB)**. Its finding (Babylon's snapshot = 0.12 ms at 15k draws,
      but engine-GLOBAL granularity, so migration was not justified) is preserved in
      [`073/concept/07-babylon-spike.md`](../073-webgpu-migration-threejs/concept/07-babylon-spike.md).
- [x] **3.2 DONE 2026-07-18** — the four three-WebGPU repros deleted after an explicit
      **findings-preservation audit** (the gate this task set): every conclusion each harness produced was
      traced to prose before its code was removed —
      `webgpu-spike` → [`concept/phase-0-spike-checklist.md`](../073-webgpu-migration-threejs/concept/phase-0-spike-checklist.md)
      lines 88–139 (the whole result table, the GO verdict, the cell-size sweep that had only ever existed
      as HUD output);
      `webgpu-bundle-repro`, `webgpu-stream-compile`, `webgpu-tsl-material` →
      [`concept/phase-1-findings.md`](../073-webgpu-migration-threejs/concept/phase-1-findings.md)
      lines 59–79, 154–175, 103–112.
      Two audit notes worth keeping: (a) for `webgpu-stream-compile` the DOC is richer than the deleted
      file — the winning `ctx=holder` configuration is recorded only in the prose, the file's own header
      never mentioned it; (b) `webgpu-tsl-material` is superseded by shipped code
      (`world-material-tsl.ts`), so only its throwaway `pipelineMix` blend construction is gone, which is
      a code artifact and not a finding.
- [x] **3.3 DONE** — the five `viewerInputs` entries removed from `vite.config.ts`; the build's HTML
      entries are now `index` + `viewer` + `controls-harness` only. Production build verified green.
- [x] **3.4 DECIDED — KEEP `opensa-engine.{ts,html}`** for now (it is the cleanest minimal-repro boot for
      engine bugs, and it is dev-served only — it was never in `viewerInputs`, so it costs the production
      build nothing). Revisit at phase 8.
- [x] **3.5** `controls-harness.{tsx,html}` — KEPT untouched (React + `@opensa/game/input`, zero renderer;
      driven by `e2e/touch-controls.spec.ts`).
- [x] **3.6 (found during the audit)** Two 073 docs referenced the harnesses as FORWARD-LOOKING assets,
      not history — `readme.md`'s revive conditions ("re-run `/webgpu-spike.html` first") and
      `01-upstream-contribution.md`'s open tasks ("re-run the harnesses after any three bump", "the
      `webgpu-stream-compile` harness is a good seed" for an upstream example). Both now carry a
      superseded/moot banner pointing at the preserved measurements, so the instructions are not left
      unfollowable.

---

## Phase 4 — The viewers (THE CRITICAL PATH)

`apps/viewer` (four viewers, ~1 635 lines) is the last consumer of `packages/renderware/src/three/`
(43 files). Phase 5 cannot finish until this is resolved. **This needs a user decision** — the options
are genuinely different amounts of work:

| Option                                              | Cost                                                                 | Consequence                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **(1) Port the viewers onto `@opensa/engine`**      | Largest. Needs an engine-side "load one DFF/TXD and orbit it" path   | Viewers keep working; `renderware/src/three` dies; `e2e/viewer-tabs` + `object-viewer` specs survive   |
| **(2) Retire the viewers into `engine-lab` probes** | Medium. `engine-lab/src/{ped,vehicle}.ts` already cover a good slice | Fewer apps to maintain; loses the tab shell and the compare viewer; e2e specs get rewritten or dropped |
| **(3) Freeze the viewers on a pinned three**        | Smallest now                                                         | REJECTED unless the user insists — it keeps `three` in the tree, i.e. defeats the whole plan           |

**USER DECISION 2026-07-18: option (1) — PORT ALL FOUR onto `@opensa/engine`.** The viewers are kept
capability, not legacy: nothing is lost, the `?tab=` + e2e contracts survive unchanged, and
`renderware/src/three/` still dies in full. Cost accepted: the engine needs a "load one DFF/TXD and orbit
it" path (object + compare), and the character viewer needs an IFP player on `ifp-sampler`.

### Tasks

- [x] **4.1** USER DECISION — option (1), port all four (recorded above).
- [x] **4.1a DONE 2026-07-18 — the single-asset path exists**, three new modules under
      `apps/viewer/src/engine/`: `viewer-engine.ts` (canvas + engine + neutral studio environment + frame
      loop), `orbit.ts` (the orbit rig, lifted out of the lab's inline `let`s in `main.ts` so it is
      finally reusable), `model-view.ts` (bytes → `parseDff` → `buildVehicleModel` → the engine's rigid
      upload, plus bounds for auto-framing).
      **No new engine code was needed** — the rigid path (`createVehicleModel`/`createVehicle`) is
      renderer-level, not vehicle-level, exactly as `engine-props.ts` already assumed; a viewed map
      object is a model with no paint. `engine.frame()` is happy with zero cells, so a viewer needs no
      pak and no streaming.
      Reuse-first side effect: the `buildVehicleModel → createVehicleModel` adapter was duplicated
      verbatim in `engine-props.ts` and `engine-anim-objects.ts`; it is now
      `packages/game/src/adapters/vehicle-model-init.ts` (`toRigidModelInit`) with both hosts and the
      viewer on it.
      **Two lessons paid for in debugging:** (1) `engine.updateVehicles()` must run every frame or the
      models exist on the GPU and are never placed — the symptom is an empty scene with a CORRECT
      triangle count, which reads like a camera bug; (2) the canvas must be created and appended
      SYNCHRONOUSLY before `engine.init` is awaited, or `e2e/viewer-tabs.spec.ts` fails on all four tabs.
- [x] **4.1b DONE 2026-07-18 — `object-viewer` ported and verified in a real browser.** Every
      non-render capability survives verbatim (HD/LOD split lists, compare-server autocomplete + URL
      field, companion-LOD listing, Add/Frame all/Clear all, multi-model overlay, triangle count, status
      line, e2e fixture path). Field check: `wattspark1_LAe2` renders textured and correctly oriented
      (1 399 triangles, zero console errors); the speckled tree canopies were verified against the OLD
      three baseline and look identical there — that is the model's alpha, not a port artefact.
      **e2e lane changed (necessary, not incidental):** headless Chromium had no WebGPU, so
      `playwright.config.ts` now launches with the bench harness's flags
      (`--enable-unsafe-webgpu --enable-features=WebGPU --use-angle=metal`). The consequence is recorded
      in the config: SwiftShader has no WebGPU, so the old "software renderer ⇒ deterministic
      screenshots" premise is gone and canvas baselines are now MACHINE-SPECIFIC. Acceptable only
      because this lane does not run in CI (it needs a local GTA copy for fixtures). Baseline
      regenerated; all 3 object-viewer + 4 viewer-tabs specs green.
      **Capability DROPPED, needs a decision (see 4.6):** the Lit / Prelit / Prelit ×2 / Wireframe /
      Collision toggles. The first four were three-material switches with no engine equivalent; COL
      wireframe needs a line pipeline the engine does not have. Note their original PURPOSE is partly
      obsolete: they existed to bisect a discrepancy between the viewer's three materials and the game's
      — with one renderer there is no discrepancy to bisect. What is NOT obsolete is inspecting the
      DATA (is this DFF's prelit too dark? does it have night colours?) and seeing collision.
- [x] **4.1c DONE 2026-07-18 — `vehicle-viewer` ported, every capability kept.** Part selector, door
      open/close (button + `E`), damage/repair, `chassis_vlo` LOD, collision, wireframe, triangle count,
      server autocomplete. The port made three of them ENGINE-native rather than viewer-side scene-graph
      surgery: damage twins and the LOD are `setSubmeshVisible` over the model's own
      `kind: body|dam|lod` + `damageGroup` metadata (one `applyVisibility` recomputed from scratch, so
      the two toggles can never disagree about who owns a submesh), and the door is
      `entity.setPartRotation(part, axisAngle(Z))` — byte-identical to what `engine-vehicle-handle`
      does in the game.
      Selection highlight = a debug-line box, so no new engine feature was needed.

      **Three lessons paid for here:**
      1. **`setPaint` is 0..1, not 0..255.** The three viewer's `[200, 40, 40]` saturates every paint
         slot to white, which reads as "the carcols markers were not found" — a trap, because the car
         still renders and looks plausible. Noted in the constant.
      2. **Part vertices live in the PART's frame, not model space.** Bounds taken straight off
         `positions` box the model ORIGIN. `partBounds` now runs them through the part's bind matrix
         (a copy of `RigidEntity.flatten` minus the root), and optionally through the live animation
         rotation so the box follows an opened door.
      3. **Do not judge a depth-tested debug overlay from one camera angle.** Two "bugs" here — a door
         that appeared to fly above the roof and a highlight box floating in the sky — were both the
         far-side view of a CORRECT overlay, mostly occluded by the car with only its top edge showing.
         The numbers said the bounds were right; orbiting to the other side confirmed it. Log the
         geometry before believing a screenshot.

      **Open observation (NOT a port artefact, needs a look in-game):** vehicle bodies carry a fine
      pink/blue speckle along silhouette edges and top surfaces, on stock `infernus` as well as modded
      `admiral`. It is the engine's own vehicle shading (probe off + noon sun in the viewer's neutral
      studio), so it should be checked against the game before anyone blames the port.

- [x] **4.1d DONE 2026-07-18 — `character-viewer` ported, and the browser gained a skinned builder.**
      The engine had NO browser-side skinned path (`setPedProbe` was fed only by the offline `ped-probe`
      fixture), so ~300 lines moved out of that CLI into
      `packages/renderware/src/ped/build-ped-model.ts`: `buildPedModel` + `pedClip` (HAnim skin-bone
      order, inverse binds with the root anchored to the skin bind, joint/weight quantization, posed
      `minZ`, IFP tracks matched by bone id then trimmed name). Shaped like `VehicleModelData` for the
      same reason that one is — ONE runtime builder shared by the game, the viewers and the lab's
      fixture baker. 11 tests on the REAL `bmypol1`/`army` fixtures.
      Viewer: clip picker over all 294 `ped.ifp` animations, loop toggle, click-to-replay, skeleton,
      collision capsule, wireframe, triangle count, "not skinned" path. Animation runs through the
      engine's own `IfpSampler` into the ped probe's palette.

      **Engine additions, both forced by animation and both small:**
      - `updateDebugLines(id, positions)` — rewrite a line set in place. The skeleton and the mesh
        wireframe DEFORM every frame; re-creating buffers per frame would churn GPU allocations.
      - a **through-depth** variant of the line pipeline (`debug-line-through`, `depthCompare: always`,
        selected by `createDebugLines(..., { throughDepth: true })`). A skeleton drawn INSIDE a body is
        invisible under a depth test — three's `SkeletonHelper` disables depth for exactly this reason.
        Found by looking at the first screenshot and seeing nothing.

      **Two findings worth keeping:**
      1. **`player.dff` is a 6-vertex, 2-triangle PLACEHOLDER in stock SA** — CJ's body is assembled at
         runtime from clothing components. A probe run against it looked like a builder bug (32 bones, a
         correct 32-track clip, and 2 triangles); real peds (`wmyst`, `bfyst`) carry ~1 150 vertices.
         Pick a real ped when smoke-testing the skinned path.
      2. **The bone palette is MODEL space, not world space.** The ped shader applies slot 0 last
         (`world = pedMatrices[0] * skinned`), so debug overlays derived from the palette must be pushed
         through slot 0 themselves or they render in GTA axes.

- [x] **4.1e DONE 2026-07-18 — `compare-viewer` ported. PHASE 4's viewer work is COMPLETE:
      `apps/viewer` has ZERO three imports.**

      **The layout deliberately changed, and this is the one place the port is not a like-for-like.**
      three's split screen was `setScissorTest` + two `render()` calls into half-viewports. Our engine
      has no equivalent: `frame()` owns the whole canvas AND the whole post chain, so a true split would
      run MSAA resolve, bloom and tonemap twice per frame — a real engine feature for a dev tool. Both
      sides now live in one scene instead:
      - **Side by side** (default) — BEFORE left, AFTER right, one orbit camera, both visible at once.
      - **Stack (blink)** — both at the SAME origin with one hidden; `B` or the button flips them. Exact
        pixel overlap, which is strictly BETTER than a split screen for spotting small differences (the
        blink comparator has beaten side-by-side at this since astronomers used it on photographic
        plates).

      Everything else survives: the both-sides model list, rebuild-from-cached-clump on every toggle (no
      refetch), Lit / Prelit / Prelit ×2, and the tab's unique **night colours** view — a shallow clump
      copy with each geometry's `nightColors` swapped in as `prelitColors`, exactly the data the
      prelight passes correct. `model-view` gained `loadModelFromClump`, `setOffset` and `setVisible` to
      support it.

      Field-checked against two REAL trees (`original` vs `anderius`): both sides build, the labels
      dim to show which side the blink is on, and a missing TXD on one side degrades to an untextured
      model — the same graceful failure the three version had, worth knowing before reading a white
      model as a difference.

- [x] **4.2 DONE** — all four tabs survive, so `shell.ts` stays (pure DOM, no renderer).
- [x] **4.3 DONE 2026-07-18 (verified by a real run).** `e2e/object-viewer.spec.ts` needed only honesty
      fixes — its baseline test was still titled "WebGL via SwiftShader" when the page is WebGPU and the
      snapshot is machine-specific. `e2e/viewer-tabs.spec.ts` had a REAL GAP: it looped over three tabs
      and its own comment said "three viewers", but phase 4.1e ported a fourth. That gap mattered —
      `apps/viewer/src/**` is EXCLUDED from unit coverage on the stated grounds that the e2e lane covers
      it, so the compare tab was covered by nothing. Added; it asserts the tab boots the engine and mounts
      a canvas WITHOUT the compare server (which is a separate process serving model bytes).
      **Full lane re-run: 24 passed / 2 skipped.**
- [x] **4.4 DONE — no change needed.** `tools/map-optimizer/src/compare-serve.ts` points at
      `viewer.html?tab=compare`, which still exists and now has e2e coverage.
- [x] **4.6 RESOLVED 2026-07-18 — USER CHOSE (c): make them real ENGINE features. SHIPPED.**
      All five toggles are back, and they are now better than what three had: every view is the shipping
      renderer with exactly ONE term changed, instead of a second material stack that could disagree
      with the game. - **`engine.debugPrelitScale`** (1 authored / 0 off / 2 MODULATE2X) and **`engine.debugUnlit`** —
      applied in `rigidShade` AND `worldShade`, so they work for the viewers and for any future
      in-game debug UI. Semantics note: "off" is a NEUTRAL (white) multiplier, not a zero one — the
      point is to see the texture without the baked light, not to black the model out. ×2 saturates,
      as MODULATE2X does on hardware. - **They ride SPARE frame-uniform lanes** (`params3.y`, `moonColor.w`) rather than growing the struct.
      `moonColor.w` was later WIDENED by 074/22 from a boolean unlit flag into a debug VIEW mode (0 normal ·
      1 unlit · 2 normals), so only one of the two views is active at a time rather than growing the
      struct. Growing it would mint a new buffer + bind group, and that bind group is recorded into
      every cell render bundle — every bundle in the world would go stale. Recorded in the shader. - **`debug-line` pipeline** — a line-list, depth-tested but never depth-writing, drawn after the
      coronas inside the existing world pass (so it costs no extra pass and lands in the same GPU
      timer bucket). API: `createDebugLines(positions, color)` / `setDebugLinesVisible` /
      `destroyDebugLines`, world-space vertices by contract. - **`packages/renderware/src/collision/col-lines.ts`** — the COL→segments geometry extracted from
      the doomed three `build-col-wireframe.ts` as pure data, plus `meshEdgeLines` (deduplicated
      triangle edges; WebGPU has no polygon-mode line, so wireframe IS a line list). 9 unit tests.
      Field-verified in a real browser: collision hull draws green over the model, wireframe shows the
      polygon structure, ×2 visibly brightens. e2e 23 passed, suite 332/2179.
      Gotcha re-paid: **no backticks in WGSL comments** — the shader modules are JS template literals
      and a stray backtick ends the string (the whole file then fails to parse).

- [~] ~~**4.6 DECISION OWED — the dropped viewer toggles.**~~ Options as offered, kept for the record:
      (a) accept the loss (the viewer becomes "see exactly what the game draws", nothing more);
      (b) rebuild them as DATA readouts rather than shading modes — e.g. a panel that reports a model's
      prelit min/avg/max and whether it carries night colours, which answers the "too dark?" question
      without a second shading path;
      (c) add real engine features: a debug uniform for prelit off/×2 + an unlit mode, and a line
      pipeline for COL wireframes (also unblocks the vehicle viewer's collision toggle and any future
      debug-line need in the game).
      Note (c) is the only option that keeps the vehicle viewer's Collision toggle, so this decision is
      coupled to 4.1c.

---

## Phase 5 — WebGL render-path deletion, package by package

Order chosen so the tree compiles after every step.

### 5a — the host (`apps/web`)

- [x] **5a.1 DONE** (commit a312f0d) Delete `apps/web/src/ui/canvas-host.tsx` (1 570 lines) and the `?engine=three` branch in
      `apps/web/src/ui/shell/app.tsx`. The `engine-*.ts` siblings (camera/debris/perf-runs/particles/
      player/vehicles/breakables/clutter/props/anim-objects) all STAY — they are the engine host's wiring.
- [x] **5a.2 DONE (in phase 7.6)** `tools-debug/bench-harness/gate-check.js` — its `webgl2 = three prod` branch becomes dead;
      simplify to assert `webgpu` only.

### 5b — the render path in `packages/game`

- [x] **5b.1 DONE** (commit a312f0d) Delete `core/renderer.ts` (the old public entry — **one caller**, `game.ts:319`) and unwind
      that destructure.
- [x] **5b.2 DONE** (commit a312f0d) Delete `plugins/` render members: `postfx.plugin.ts` (the only `postprocessing` importer),
      `sky.plugin.ts` (864), `water.plugin.ts`, `csm.plugin.ts`, `fog.plugin.ts`, `sky-lite.system.ts`,
      `render-pipeline.ts`, `plugin.ts`, `ambient-light.plugin.ts`, `directional-light.plugin.ts`,
      `vehicle-reflection/`.
- [x] **5b.3 DONE** (commit a312f0d) Delete `mods/wind.mod.ts` (raw `onBeforeCompile` GLSL injection),
      `lights/street-light.system.ts`, `vehicle/vehicle-headlight.system.ts`, `streaming/fade.ts`,
      `perf/perf-monitor.ts` (GL timer queries — the engine has its own timestamp HUD),
      ~~`adapters/gta-sa-world.adapter.ts`~~ (**NOT deleted — it is the live engine host's world source**; only `three-vehicle-handle.ts` died) + `adapters/three-vehicle-handle.ts`.
      **Each of these has an engine-side equivalent already shipped — verify the equivalent exists before
      deleting, and note it in the commit** (that note is what makes this reviewable a year from now).
- [x] **5b.4 DONE** — `game.ts` deleted outright rather than reworked; the engine host is the seam. Rework `game.ts` (949 lines) — it is the seam between the two eras. Strip the three
      objects; what remains is the renderer-agnostic loop the plan-10 audit already verified.
- [x] **5b.5 DONE** — deleted with the render path; the engine host owns its camera. `core/camera-controller.ts` — drop `OrbitControls`, keep the math on `@opensa/math`.

### 5c — `packages/renderware`

- [x] **5c.1 DONE** (commit 2c104e3) Delete `src/three/` (43 files) — **gated on phase 4**.
- [x] **5c.2 DONE** — the block is gone; one line of PROVENANCE remains at `index.ts:44`, deliberately. Remove the barrel re-export block `src/index.ts:44–134`.
- [x] **5c.3 DONE** (commit 2c104e3) Delete/port the three-object producers in `src/map/`: `build-region.ts` (491),
      `build-cell.ts`, `build-procobj.ts`, and check `procobj-runtime.ts` (type-only `InstancedMesh`).
      **Careful — `procobj-scatter.ts` and `procobj-colliders.ts` are bucket (b)**: they are live logic
      the engine host uses (the memoized scatter drives BOTH render and colliders), so they migrate to
      `@opensa/math`, they do NOT die.
- [x] **5c.4 DONE** — `build-colliders.ts` survives on `@opensa/math` (`Matrix4`/`Quaternion`/`Vector3`). `src/collision/build-colliders.ts` — bucket (b), migrates.
- [x] **5c.5 DONE in phase 8** — description now reads "renderer-agnostic mesh preparation". Update the package description ("RenderWare format parsers + three.js builders…").

---

## Phase 6 — Test rework

50 test files import three. They split cleanly:

- **Die with their subject** — the `renderware/src/three/*.test.ts` set (20), the plugin tests
  (`csm.plugin`, `fog.plugin`, `render-pipeline`, `sky-lite.system`), `wind.mod.test.ts`,
  `perf-monitor.test.ts`, `fade.test.ts`, the adapter tests.
- **Survive, need an import swap only** — the bucket-(b) tests: `physics-world.test.ts`,
  `vehicle-physics.system.test.ts`, `build-colliders.test.ts`, `procobj-*.test.ts`,
  `streaming.system.test.ts`, `timed-object.system.test.ts`, `hidden-instances.test.ts`.
- **Need real thought** — the character tests (`animation-controller`, `character-animation.system`,
  `character-controller.system`, `orient-character`, `render-sync.system`): they test logic we KEEP
  against three types we DROP.

### 6.1 — the RESIDUAL classification (done 2026-07-18)

Phases 3–5 already deleted ~41 of the 50 alongside their subjects. What survived into this phase was
**17 files** (7 sources + 9 tests + one CLI), classified against the live code rather than the plan's
forecast — three forecast entries turned out differently and are marked:

| File(s)                                              | Group           | Disposition                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `character/animation-controller.{ts,test.ts}`        | 1 — die         | Whole class was a `THREE.AnimationMixer` wrapper. Superseded by the engine's `IfpSampler` (`engine-player.ts` satisfies the same `VehicleAnimator` surface). **Discharges task 1.6.**                                                                                                    |
| `character/character-animation.system.{ts,test.ts}`  | 1 — die         | Only consumer was the deleted mixer path; the host never imported it.                                                                                                                                                                                                                    |
| `character/orient-character.{ts,test.ts}`            | 1 — die         | Orphan: imported by nothing but its own test (three `Group`/`Object3D`).                                                                                                                                                                                                                 |
| `character/render-sync.system.{ts,test.ts}`          | 1 — die         | Orphan: synced ECS transforms onto three `Object3D`s. The engine writes its own entity handles.                                                                                                                                                                                          |
| `debug/hidden-instances.{ts,test.ts}`                | 1 — die         | Orphan (`InstancedMesh.setMatrixAt`). **Plan forecast said group 2** — nothing in the ported F2 debugger (074/22) references it.                                                                                                                                                         |
| `time/timed-object.system.{ts,test.ts}`              | 1 — die         | Walked a three scene root setting `.visible`. **Forecast said group 2**; superseded by `engine.ts` `timedActive()` on the objectTable (074/06 row 9).                                                                                                                                    |
| `time/hour-window.{ts,test.ts}`                      | 1 — die         | Fell dead with the line above (its only importer); the engine carries its own gate.                                                                                                                                                                                                      |
| `character/character-controller.system.{ts,test.ts}` | 3 — rewritten   | KEPT (the host's player controller). `three.Vector3` → `@opensa/math`; the `PerspectiveCamera` dependency was only `getWorldDirection`, now the structural `LookDirectionSource` — which also **deletes the host's `as unknown as` camera shim cast**. Test drives a 3-line fake camera. |
| `adapters/gta-sa-world.adapter.test.ts`              | 2 — import swap | `Matrix4` → `@opensa/math`. **Forecast said "the adapter tests" die** — this adapter is the live engine host's world source.                                                                                                                                                             |
| `vehicle/enter-vehicle.system.test.ts`               | 2 — import swap | Its animator stub was cast to the deleted `CharacterAnimationSystem`; now `satisfies VehicleAnimator` (the real seam, and no longer a cast).                                                                                                                                             |
| `renderware/mesh/prepare-clump.test.ts`              | 3 — rewritten   | Used three as a live **oracle** for `computeVertexNormals` / `computeBoundingSphere`. Values captured from three@0.185.1 and frozen inline — same technique as `@opensa/math`'s parity fixtures.                                                                                         |
| `math/capture-three-fixtures.ts`                     | deferred        | The last three importer in the repo by design: it regenerates the parity fixtures. Dies in **phase 7** with the dependency.                                                                                                                                                              |

### Tasks

- [x] **6.1 DONE 2026-07-18** — table above (residual 17, not 50; three forecast corrections recorded).
- [x] **6.2 DONE** — group 1 deleted with its subjects, 7 modules + 7 tests, one commit.
- [x] **6.3 DONE** — group 2 swapped.
- [x] **6.4 DONE** — group 3 rewritten (`LookDirectionSource`, frozen three oracle values).
- [x] **6.5 DONE** — the coverage exclusion list was pruned: `postfx.plugin.ts` **and 11 more** entries
      pointed at files phases 4/5 already deleted (`game.ts`, `core/renderer.ts`, `camera-controller.ts`,
      the five other plugins, `vehicle-headlight.system.ts`, `setup-character.ts`). Survivors:
      `keyboard.ts`, `dff-parse.worker.ts`, `capture-three-fixtures.ts`, the two asset-loader files,
      `apps/web/src/ui/**`.
- [x] **6.6 DONE — coverage flat**: 72.02 → 71.89 % statements (−0.13 pp), 66.98 → 66.89 branches,
      71.95 → 71.75 functions, 71.86 → 71.72 lines. The dip is the deleted modules having been
      _well_-covered (`hour-window` was 100 %) — no surviving code lost coverage.
      **Flagged for phase 8: the global thresholds (85 / 77) have been RED since phase 5** — the tested
      three code left, `packages/engine` arrived largely unit-untested. That is a threshold decision the
      close-out must make explicitly, not a phase-6 regression. **RESOLVED by
      [plan 077](../077-unit-coverage/readme.md)** (device-independent seam → 88.18 %, floors re-armed).
      NOTE on the numbers: this row's 71.89 % and 077's 72.29 % baseline are DIFFERENT measurements, not
      a discrepancy — phases 7 and 8 deleted more untested code between them, which moved the denominator.

---

## Phase 7 — Dependency prune + the patch + the size ledger

**DONE 2026-07-18. `three` no longer exists anywhere in the repo.**

- [x] **7.1 DONE** — `three` + `postprocessing` dropped from `dependencies`, `@types/three` from
      `devDependencies` (`@babylonjs/core` had already gone in phase 3). The last importer,
      `packages/math/src/capture-three-fixtures.ts`, was DELETED with them: it is the one-shot generator
      for the parity fixtures and cannot run without the library. `three-fixtures.json` + the parity
      suite survive as the record — a note in `three-parity.test.ts` says the fixtures are now
      un-regenerable, so nobody edits them casually.
- [x] **7.2 DONE** — `patches/three+0.185.1.patch` deleted; it was the **only** patch, so the
      `patch-package` postinstall hook and the devDependency went with it and `patches/` is gone.
      (Checked first, as the task demanded — the mechanism was not shared.)
- [x] **7.3 DONE** — keywords `three.js` + `webgl` → `webgpu`.
- [x] **7.4 DONE** — `scripts/arch-graph.ts`: `ext_three` node, the `three(/…)?` alternation in
      `TARGET_RE`, its `resolveTarget` branch and both doc-comment mentions removed. The graph now
      shows exactly one external — Rapier.
- [x] **7.5 DONE — size ledger below.** Honest attribution: **the bundle drop belongs to phases 4–6,
      not to this one.** Nothing had imported three since phase 6, so it was already tree-shaken out of
      the build; phase 7 removes it from `node_modules`, CI installs and the lockfile. Measuring both
      is the point — a dependency you stopped importing still costs every developer and every CI run.
- [x] **7.6 (found here)** — discharges **task 5a.2**: `gate-check.js` probed `webgl2` alongside
      `webgpu` to tell the two renderers apart. There is only one now, so the probe is a single
      boolean (and the dead `let webgl2` was the only lint error outside the pre-existing
      bench-harness `.js` set).

---

## Phase 8 — Close-out

- [x] **8.1 DONE 2026-07-18.** Suite **289 files / 1 815 tests green**, `tsc --noEmit` clean, and
      `npm run lint` **green for the first time in a while**: the 32 errors it was carrying were the
      committed `tools-debug/bench-harness/*.js` Node scripts, which no eslint block gave Node globals
      (`require`/`process` undefined) — they now ride the existing `scriptsConfig` list. 17 warnings
      remain (missing return types, mostly in the phase-4 viewer port); warnings do not fail the lane.
      **Bench ritual re-run: PASS — 119.9–120.0 fps on all six, `lateCreates` 0, draws within ±4 of the
      reference**, which is the measurement that actually proves no live subsystem was deleted. The
      `gpuMs.pass` column read uniformly high on a non-quiescent machine; recorded honestly rather than
      tidied away in [series § 13·post-teardown ritual](../../benchmarks/opensa-engine/2026-07-18-series.md).
- [x] **8.2 DONE 2026-07-18** — the 073 readme's "Code/flags disposition (temporary)" note is marked
      **EXECUTED, the answer was DELETE**, pointing at the new query-parameter reference.
      **Open-issues re-verified: NEITHER is renderer-dependent, so nothing to close or re-file** —
      `locked-dff.md` is a pure DFF/TXD parser problem and `vehicle-enter-null-body.md` is a
      streaming/physics handle-pool race. The four `fixed/` entries were already closed.
      Also swept OUTSIDE the plan's list, because they described the project as three.js-based and were
      simply false: `README.md`'s one-line "What's inside" (the repo's highest-visibility wrong line),
      `docs/architecture.md` (package map + BOTH Mermaid diagrams — they also predated
      `@opensa/engine`, `@opensa/math`, `@opensa/engine-formats` and `@opensa/modloader` existing at
      all), and the `renderware` + `game` package.json descriptions (**this discharges task 5c.5**).
- [x] **8.3 DONE 2026-07-18.** `benchmarks.md` (the `?engine=three` A/B framing, "both renderers",
      the gate-check `→webgl2` branch) + `e2e.md` ("WebGL boot", "renders WebGL via SwiftShader") +
      `scripts.md` + a link to the new reference from `benchmarks.md`. `in-game-tools.md` and
      `engine-lab.md` needed nothing — they already document the own engine.
      **`test-coverage.md` needed more than a reword**: its scope paragraph listed a dozen files phases
      4/5 deleted, and its headline numbers were the pre-teardown 88.8 %. Rewritten with the current
      71.9 % AND the structural reason — see the coverage-floor note in 6.6, which this makes public.
- [x] **8.4 DONE — the 3.4 decision STANDS: KEEP.** `opensa-engine.{ts,html}` is the only boot of
      `@opensa/engine` with no React, no gameplay and no host, which makes it the cheapest place to
      reproduce an engine bug; it is dev-served only (never in `viewerInputs`), so it costs the
      production build nothing. Its docstring described it as "the side-by-side path the flip criteria
      measure against — the three-WebGL game stays untouched", which is no longer true; reworded to
      state its actual surviving purpose.
- [x] **8.5 DONE 2026-07-18** — chain readme carries a new handoff snapshot (teardown complete + the
      two deliberately-open decisions), and [10-flip-decision.md](10-flip-decision.md) criterion 5 flips
      from DEFERRED to **PASS**, with the note that there is no longer a WebGL path to roll back to.

---

## Measurement ledger

| Date       | What                                                     | Numbers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-18 | Phase-0 inventory (3 parallel sweeps)                    | 122 three-importing source files (52 render-path / 20 math-only / 50 tests / **0 tools**); 43 files in `renderware/src/three`; ~60 URL params, 10 of them dead; patch = 207 lines, `three.webgpu.js` only; `createRenderContext` has exactly 1 caller                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-07-18 | Phase 1.1–1.3: `@opensa/math` built + three-parity suite | 9 source files, ~1 000 lines, zero deps; 12 parity tests vs captured three@0.185.1 fixtures @ 8 decimals, all green first run; suite 330/2159 → **331/2171**, tsc + eslint clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-07-18 | Phase 1.5 part 1: pure-math files migrated               | three importers **122 → 109** (13 files freed); `placementMatrix` extracted from the doomed `build-procobj` into the surviving `procobj-scatter`; 7 files deliberately reverted (scene-graph seams, ride phases 4/5); suite 331/2171 green, tsc + eslint clean                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-07-18 | Phase 3: spikes deleted + babylon dropped                | 5 spike TS + 5 HTML entries gone (findings audited into 073 prose FIRST); `@babylonjs/core` removed — **node_modules 604 → 512 MB (−92 MB)**; build HTML entries 8 → 3; prod build green, suite 331/2171                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-07-18 | Phase 6: test rework                                     | three importers **17 → 1** (`capture-three-fixtures.ts`, deferred to phase 7); 7 dead modules + 7 tests deleted; suite 299/1874 → **292/1840** green, tsc + eslint clean; coverage 72.02 → **71.89 %** statements (−0.13 pp, flat); 12 stale coverage exclusions pruned                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-07-18 | **Phase 7: the dependency is GONE — the size ledger**    | `node_modules` **512 → 455 MB (−57 MB)** (measured on a freshly installed tree — a re-measure after dev/build runs reads ~7 MB higher because `node_modules/.vite` caches into it); prod build JS **5.4 → 2.88 MB (−46 %)**, biggest chunk `engine-canvas-host` 2.40 MB (gzip 900 kB), HTML entries 3 (unchanged); `npm install` 4.5 s warm-cache from a wiped `node_modules` (no cold-cache baseline was taken before, so this number stands alone); repo-wide `from 'three'` importers **1 → 0**; suite 292/1840 green, tsc clean, build green. Bundle share attributed to phases 4–6 (already unimported); `node_modules` + lockfile + install share is this phase's |
| 2026-07-18 | Phase 8: close-out (+ phase 2, done alongside)           | Suite **289 files / 1 815 green**, tsc clean, **`npm run lint` green** (32 pre-existing bench-harness errors fixed by giving those Node scripts globals); bench ritual **PASS** — 119.9–120.0 fps ×6, late 0, draws ±4 of reference; 4 MORE orphaned three-era modules found and deleted (`webgpu-hud`, `csm-math`, `sky-params`, `wave-params` + 3 tests); docs swept (README, architecture ×2 diagrams + package map, benchmarks, e2e, test-coverage, 2 package.json descriptions); **`query-parameters.md` written** — ~60 params → 22 documented                                                                                                                    |
