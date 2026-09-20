# Phase 1 — real-engine integration findings (🅿️ PARKED — see FINAL VERDICT at the bottom)

Branch `webgpu-migration`. The chronological log of the real-engine WebGPU integration (behind `?webgpu=1`):
milestones, bugs, fix attempts, and the final parked verdict with resume conditions. Historical sections below are
kept as written — read the FINAL VERDICT last section for the outcome.

## ✅ Milestones reached

1. **The engine runs under WebGPU.** `?webgpu=1` boots a `WebGPURenderer` (async), skips the GLSL/`postprocessing`
   plugins + the WebGL GPU timer, and **renders the streamed world — the player walks, streaming works.** three's
   auto-conversion of standard materials (`MeshBasicMaterial` → node) carries the world without porting shaders.
2. **WebGPU (no bundle) is already ~3× faster here than WebGL:** full world at **19.43 ms / 4597 draws** vs the
   WebGL **~65 ms** `ls-noon` baseline. **Caveat:** not apples-to-apples — WebGL runs our heavy custom shaders,
   WebGPU runs simple auto-converted materials. Porting the real materials to TSL will raise the WebGPU cost, so
   19.43 ms is optimistic. But it shows WebGPU's per-draw + submission overhead is genuinely lower.
3. **Per-cell BundleGroups are wired** into streaming (`cellContainer` factory → one `BundleGroup` per cell,
   dropped on unload; `?bundle=0` for the A/B, `?bundle=root` for one shared bundle).

## ⛔ The blocker — static bundle transform baking

A static `BundleGroup` renders the world, but **incorrectly**:

- `?bundle=root` (one shared bundle): the **far LOD ring renders correctly** (distant skyline, hills, palms), but
  the near ring shows **stretched/distorted geometry** — triangles smeared toward a point. That is the classic
  signature of **wrong model matrices**: a static bundle bakes each object's transform at record time, and some
  objects are recorded with a stale/identity matrix (not yet updated by the −90°X streaming-root chain), so their
  vertices render at the wrong place.
- `?bundle=…` per-cell: renders even less (~106–150 draws, mostly empty) — the same baking issue, worse because
  each cell's bundle records at a different (often bad) moment as it streams in.

Two things three's static bundles fight with in this engine:

- **Transforms:** cells live under a rotated (−90°X) streaming root; the bundle must record after `matrixWorld` is
  finalized for every child, or it bakes garbage.
- **Dynamic streaming:** bundles added to an already-live scene, one per frame, aren't picked up cleanly (needsUpdate
  helped little).

Also: `renderer.info.render.drawCalls` does **not** see inside `executeBundles`, so the on-screen `draws` / `render
CPU` under bundles are **unreliable** — a proper bundle measurement needs GPU-timer or a bundle-aware counter.

## Fix attempts (didn't crack it via browser rounds)

`frustumCulled = false` on bundled objects · skip the cell fade under bundles (static bundle bakes opacity) ·
`needsUpdate = true` after populating · single shared root bundle. Each improved _something_ but none produced a
correct full-world bundle render.

## Assessment

The **thesis stands** (synthetic Phase 0 + 1a proved bundles collapse submission and invalidate granularly). The
real-engine integration hit a genuine three.js `WebGPURenderer` + static-`BundleGroup` interaction around
**transform baking + dynamic scene updates**. This is solvable but needs **focused investigation, not blind
browser rounds**:

- a minimal three.js WebGPU repro (BundleGroup + a transformed/instanced mesh streamed in over time) to find the
  exact record-timing/matrix rule;
- read three's bundle recording path (`RenderBundles` / `_renderBundle`) re: when/how model matrices are captured;
- check three examples/issues for streaming-scene bundle patterns and the correct invalidation API.

## Isolated repro — what it ruled out (2026-07-11)

`apps/web/src/standalone/webgpu-bundle-repro.ts` (`/webgpu-bundle-repro.html`) renders an InstancedMesh (400
instances) in a static `BundleGroup`. Every isolated case rendered a **clean grid** — so these are NOT the cause:

- InstancedMesh inside a static BundleGroup ✅
- under a −90°X rotated parent ✅
- added to an **already-live** scene after 60 frames (`?stream=60`) ✅ (dynamic add works)
- `?fix=world` / `?fix=late` made no difference (already clean)

So the bundle mechanism is fundamentally sound in this three version. The engine bug is **emergent from the full
integration**, and the isolated repro doesn't contain it. By the "stretched triangles" symptom (some vertices
collapse to origin), the leading remaining suspects are:

1. **Animated / skinned meshes in a static bundle** — their bone/animation matrices aren't captured, collapsing
   vertices (cf. the `barberpole2.quaternion` PropertyBinding warning). Static bundles must contain **static
   geometry only**; animated props must stay out.
2. **Re-record churn** — routing all cells through one shared bundle (or per-cell bundles) with `needsUpdate` on
   every stream add/remove keeps the bundle perpetually re-recording mid-stream.
3. **Auto-converted material quirks** — the world runs `MeshBasicMaterial` + dangling `onBeforeCompile` GLSL that
   WebGPU ignores; those materials in a bundle may behave differently than a clean node material.

## Recommendation (updated) — sequence bundles AFTER the TSL port

Chasing the bundle bug on the **current auto-converted-material stopgap** is fighting a hack: the materials aren't
real node materials, animated vs static geometry isn't separated, and the streaming churns the bundle. The clean
path is the plan's original order:

1. **Port materials to TSL** (Phase 1 proper) — real node materials, correct day/night/fog/shadow.
2. **Separate static world geometry from dynamic/animated objects** — only the static world goes into bundles.
3. **Then** wrap the static world in per-cell bundles — on a solid base, with the repro-proven mechanism.

Trying to bundle before (1) and (2) is premature. The spike branch + repro have de-risked the **mechanism**
thoroughly; the engine integration should resume in that order, not by bolting bundles onto the stopgap.

## Recommendation

**Bank the progress; take the bundle bug as focused follow-up.** We have: the engine running under WebGPU (big),
the thesis proven, and a promising (if not apples-to-apples) no-bundle number. The remaining work — the TSL material
port (Phase 1) and the bundle transform fix — is execution, best done deliberately with a minimal repro, not by
one-fix-per-reload. The `webgpu` spike branch + this findings doc capture exactly where to resume.

## TSL material integration (2026-07-11) — renders correctly, but a perf stall

Slices verified in isolation (`/webgpu-tsl-material.html`): the SA world material's **classic path** (texel × mix(day,
night, dnBalance) × tint) and the **modern sun N·L** term author cleanly in TSL and look right. **Integrated into the
engine** (`world-material-tsl.ts` + `setWorldMaterialTslBuilder`; canvas-host registers it + a per-frame `syncWorldTsl`
system under `?webgpu=1`): the world **renders beautifully** — prelit/night shading, detailed buildings, vegetation
(screenshot captured). **Major milestone: the world material port works and looks right.**

A first in-engine reading showed **125 ms / 4367 draws** and I wrongly blamed the TSL material's per-draw cost.
**Corrected below (see "Precise root cause"): standing still fully loaded is 30 ms — the TSL material is fine; the
125 ms was the compilation tail during load, and the real problem is WebGPU compiling pipelines on the streaming
frame.**

Also parked here: **bundles are OFF by default** (`?bundle=1`/`root` to opt in) — the frustum-culling-off workaround
for the bundle transform bug caused a no-cull perf spiral of its own.

### Resume points (deliberate, not blind rounds)

1. **Profile the ~28 µs/draw TSL submit cost — the make-or-break gate.** Compare a custom-`colorNode`
   `MeshBasicNodeMaterial` vs a plain built-in one at N draws in an isolated bench; find what three re-binds per
   draw for custom node materials (the shared uniform group? a per-material bind group?). Options: one shared
   material driven by instancing/attributes; a batched path; or `NodeMaterialObserver` to mark the graph static.
   If custom node materials can't approach the built-in per-draw cost, the whole TSL port is in question.
2. Then the material slices (CSM shadows → fog → emissive) + dynamic-object materials (player/cars are black
   silhouettes — lit/skinned materials, not the world material).
3. Bundles (transform bug) after static/dynamic separation, as before.

## Precise root cause (2026-07-11) — WebGPU pipeline compilation on the streaming frame

Corrected by testing: standing still fully loaded, render CPU is **30 ms** (~33 fps) — the TSL material is fine.
The earlier 125 ms was the **compilation tail** during load. The real problem: **moving the camera near-freezes**
the tab. Standing still = no new cells = smooth; moving = new cells stream = freeze. So the stall is
**WebGPU compiling pipelines synchronously on the cell-appearance frame** — material-agnostic (would hit the
auto-converted path too), NOT the TSL material and NOT bundles.

`game.precompile` DOES call `renderer.compileAsync(holder, camera, scene)` and `WebGPURenderer` supports it, yet the
stall persists → the pre-compiled pipeline (compiled in a plain `holder` group) **doesn't match the real render
pipeline key** (real objects render under the −90°X `streamingRoot`, as `InstancedMesh`, in a different bind-group /
render-pass state) → cache miss → resync-compile on appearance → freeze.

### THE gate (resume point #1, corrected)

Make WebGPU pre-compile the pipeline that the REAL render will use, off the appearance frame. Investigate:

- does `compileAsync` need the objects compiled in their real parent (rotated root) / as InstancedMesh, not a bare
  holder? Compile against a matching context.
- what does three key the WebGPU pipeline by — confirm the holder-compile and the real-render produce the same key.
- fallback: pre-warm each world-material variant at boot with representative geometry/instancing so streaming never
  compiles live.

This is material-agnostic and the single make-or-break issue for WebGPU streaming. Everything else (TSL slices,
dynamic materials, bundles) is downstream of it.

## Compile gate — direction proven in isolation, engine fix still open (2026-07-11)

The `webgpu-stream-compile.ts` repro **cracked the mechanism**: `compileAsync` only pre-warms the pipeline the real
render uses if the objects are **in the scene graph (real render context)** during compile — measured max spike:

- `ctx=bare` (detached holder, what `game.precompile` does): **~5 ms/cell** — barely pre-warms.
- `ctx=holder` (holder parented under the rotated root, compile only that subtree): **~1 ms** — pre-warms, and O(cell).
- `ctx=scene` (compile the whole scene): ~1 ms but O(scene). `variant=new` (different material structure): ~5 ms —
  distinct structures each compile a pipeline; same-structure cells share (so the world's few variants matter, not
  every cell).

**But applying it to the engine did NOT fix the freeze — and made it worse.** Two engine factors the single-cell
repro doesn't contain:

1. **Concurrent streaming.** Several cells precompile at once; parenting each batch under `streamingRoot` during its
   async compile puts many (visible) holders in the scene at once → the whole loaded map renders during the compile
   window → "loads the whole map, slowly". The repro (one cell, tiny scene) never showed this.
2. **`warmUp` uses a SEPARATE context.** It renders each object scissored into `this.warmHolder` (a different Scene),
   so even a fixed precompile is undone — the warm draw compiles/uses a warmHolder-context pipeline, still not the
   real `this.scene` one.

Reverted the precompile experiments (back to the known 30 ms-steady / freeze-on-move state — no whole-map flash).

### The engine fix (focused, next session)

Apply "compile/warm in the REAL render context" **consistently across BOTH `precompile` and `warmUp`**, and solve
"in the scene graph for the pipeline context, but NOT rendered during the async window" (concurrency-safe):

- render `warmUp` against `this.scene` (objects temporarily parented under `streamingRoot`), scissored 1×1, instead
  of the detached `warmHolder` — that single pass both compiles the right pipeline AND uploads geometry, invisibly;
- OR pre-warm the handful of world-material variants ONCE at boot with representative in-scene geometry.
  This is the make-or-break gate; everything downstream (material slices, dynamic materials, bundles) waits on it.

## FINAL VERDICT (2026-07-11) — parked: three's WebGPU renderer is not ready for this workload

Field test after every fix (r185 upgrade, TSL material + cache, skipWarm, budgeted appearance): **in practice the
WebGPU path is WORSE than WebGL** — long world loads, constant stutter (camera/walking), heavy lag at LOD swaps
while driving. The user's read is correct and the mechanism is understood:

1. **The win lived in render bundles** (Phase 0: ~6×) — and bundles never worked in-engine (static-bundle
   transform baking). Without bundles WebGPU submission is _more_ expensive than WebGL (27 vs 10 ms synthetic).
2. **Pipeline compilation dominates streaming**: three builds shaders per-InstancedMesh (uuid in the render-object
   cache key — their own TODO, PR 29066), in-engine pre-warm doesn't match the real context, and spreading the
   appearance only smears the cost across frames (permanent stutter + slow loads) instead of removing it.
3. Everything else (plugins, post-FX, dynamic materials) is still unported — months of work on top of an
   immature foundation.

**Decision: bank.** WebGL stays the shipping path (and came out IMPROVED: three 0.185 upgrade, the r185
shadow-binding fix for invisible dynamics, PCF). All WebGPU code stays behind `?webgpu=1`, harmless.

**Resume conditions:** three fixes per-InstancedMesh pipeline caching (watch PR 29066) and static-bundle transform
capture for streamed scenes — re-run the Phase-0/1a spikes on that version first. The alternative road to AAA is a
custom WebGPU renderer outside three (a separate, months-scale decision).

## Bundle bug hunt round 2 (2026-07-11, patched three) — the freeze WORKS, one problem left, and it has a name

Instrumented three 0.185.1 via `patch-package` (`patches/three+0.185.1.patch`; `?bundledebug=1` logs RECORD/REPLAY/
PROJECT). Chronology of findings — each one measured in the real engine:

1. **The transform-baking garbage is GONE on r185** + our fixes: per-cell bundles render the world correctly
   (`badMatrix=0` across all recorded objects; visual confirmed). Bug #1 of the hunt died with the upgrade.
2. **Found why static bundles never froze:** `NodeMaterialObserver.needsRefresh` returns `true` unconditionally
   for any material with custom nodes (`hasNode`) — BEFORE the static/bundle checks — and ALSO refreshes the first
   renderObject of every observer per frame. Our world = custom-`colorNode` TSL materials → every bundled object
   refreshed every frame (`REPLAY refreshed=N/N`) → the 30 ms steady cost.
3. **Patched order** (`firstInitialization` → bundle-freeze → `hasNode`): freeze engaged, world renders,
   **render CPU 30 ms → 5 ms** — the Phase-0 synthetic prediction (~6×) reproduced in the REAL engine. Shared
   world uniforms moved to `renderGroup` (`world-material-tsl.ts`) so lighting values flow per-render.
4. **The remaining problem: the frozen world GLUES to the camera.** Camera matrices (`cameraViewMatrix`,
   renderGroup) upload through `Bindings._update` — which only runs for REFRESHED objects. All world objects
   frozen → their programs' shared camera buffers never re-upload → static picture; dynamics (unfrozen programs)
   move fine. **This is why stock three's once-per-observer refresh is LOAD-BEARING**: in their render-bundle
   example (8k meshes / 2 materials) it refreshes ~2 objects/frame and keeps shared buffers alive ~free. Our
   workload degenerates because **observers are per-OBJECT** — the r185 render-object cache key includes the
   InstancedMesh uuid (the PR 29066 workaround) → program/observer per object → O(N) refreshes.
5. Attempted fix (write shared uniform buffers in place for frozen objects, no bind-group recreation) **silently
   kills rendering** (no JS error — GPU-process validation, presumably) — reverted to the working freeze state.

**Everything traces to the same upstream root: uuid-in-cacheKey → per-object programs → per-object observers +
per-object shared-buffer copies.** With the upstream `referenceBuffer()` refactor (the PR 29066 discussion), programs
would be shared per material, the stock refresh would keep cameras alive at ~#materials cost, and bundles would
work out of the box.

### State banked

- `patches/three+0.185.1.patch` = debug logs + the needsRefresh reorder (freeze works; **camera frozen** — not
  shippable yet, gated behind `?webgpu=1&bundle=1` anyway).
- Next-session options: (a) study backend `NodeUniformsGroup` sharing to make the in-place shared-buffer write
  safe (find why it kills the frame); (b) neutralize the uuid key for statically-bundled objects and solve the
  instanceMatrix-capture (the actual referenceBuffer problem) locally; (c) file the upstream issue with our
  measurements — we now hold a complete, minimal, measured diagnosis worth a three.js issue/PR.

## Round 3 (2026-07-11 evening) — HEARTBEAT WORKS: world + live camera + 5 ms; the last root named

- **Camera unglued via heartbeat** (patch r8): shared bind groups are cached ACROSS programs by uniform node ids
  (`_getBindGroup`), so refreshing the FIRST renderObject of each bundle per frame re-uploads camera/shared
  uniforms for everyone. Field-confirmed: **world renders, camera live, render CPU ~5 ms** (was 30–65).
- **Streaming smoothing shipped:** budgeted appearance now composes with bundles — objects appear N/frame
  (culling disabled AT appearance, or first-draw compiles hide behind the frustum and explode on camera turns),
  then wrap into CHUNKED BundleGroups (≤64 objects, one chunk/frame) so each record's full-update pass stays
  small. Cell-hole fill confirmed fixed.
- **WebGPU DXT strictness fixed:** SA ships non-block-aligned DXT (62×62); WebGPU rejects them (BC needs
  multiples of 4) → `GPUValidationError` + missing textures. `build-texture.ts` now decodes those to RGBA
  (decoder moved `tools/rw-codec` → `packages/renderware/src/textures/dxt.ts`, re-exported for tools).
- **Remaining stutter root (named, next session):** ~100 ms appearance frames = per-object PIPELINE COMPILES —
  the uuid-in-cacheKey makes every InstancedMesh compile its own pipeline even with shared materials, so the
  appear budget only trades fill speed vs frame weight (16/frame ≈ 100 ms, 8 = compromise, tunable `?appear=N`).
  The fix is pipeline sharing: neutralize the uuid key for statically-bundled instanced meshes + solve the
  instanceMatrix capture (the actual `referenceBuffer()` problem from PR 29066). That is the LAST lever between
  the current state and a smooth drive.

## ✅ FIELD-CONFIRMED WORKING STATE (2026-07-11, end of the hunt)

Round-4 fixes (r9): version-sync for objects first seen unbundled (staged wrap left them permanently refreshing —
CPU crept back to 30 ms), and the appear budget bypassed behind the initial streaming veil (it throttled the
initial fill to minutes).

**Final field result (`?webgpu=1&bundle=1`, appear=8 default):**

- fast initial load ✓ · world + textures correct (incl. the DXT fix) ✓ · **live camera** ✓ · smooth driving, no
  freezes ✓ · **render CPU ~13 ms** (vs 65 ms WebGL baseline — **5×**; pure-frozen floor is ~5 ms, the delta is
  heartbeat across ~200 chunked bundles + live streaming work + unbundled dynamics/vegetation).

The full patch lives in `patches/three+0.185.1.patch` (needsRefresh reorder + version-sync + heartbeat + debug
logs) — upstream-candidate material, see [upstream-issue-draft.md](upstream-issue-draft.md). Bundles remain
opt-in (`?bundle=1`) pending soak. Remaining known lever: per-object pipeline compiles at appearance (uuid cache
key → `referenceBuffer()` problem) — would lighten cell appearances further; a separate focused session.
