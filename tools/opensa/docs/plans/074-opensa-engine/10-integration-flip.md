# 074·10 — Integration into the game & the flip

[← chain](readme.md) · prev: [09 post-FX](09-postfx-aa.md)

The lab proved the renderer; this plan puts the GAME on it. The boundary work is the known debt called out in
the concept: today's gameplay code touches three types in places — decouple where the seam is thin, adapt where
it is not.

## Boundary inventory (the seams, known today)

| Seam                                               | State                                                      | Plan                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| StreamingSystem                                    | three-`Object3D`-shaped (roots, containers, GpuHooks)      | superseded by the 05 driver; prod keeps its own for WebGL                          |
| Game loop / systems                                | framework-agnostic already (fixed step, SystemRegistry)    | reuse as-is                                                                        |
| Physics / collision (rapier + BVH)                 | three math types only                                      | reuse as-is                                                                        |
| Character/vehicle gameplay                         | mixes logic with three objects (mesh refs, AnimationMixer) | logic extracted in 08 (sampler, part flattening); entity handles replace mesh refs |
| Picking/debug tools (map viewer, hidden-instances) | three raycaster                                            | engine-side ray query vs cell BVH (we bake BVHs in 07 anyway — reuse)              |
| UI/HUD (React, GXT, fonts)                         | renderer-independent (DOM/canvas overlay)                  | reuse as-is                                                                        |
| Config surface (graphics.\*)                       | plain data                                                 | same config drives engine tiers/effects                                            |

## The flip — criteria agreed in advance (no vibes)

1. **60 fps ls-noon @2× retina on M3 Pro**, and ≥ WebGL-prod fps on EVERY bench scene (night included).
2. Visual parity sign-off per bench scene (noon/dusk/night screenshot sets archived).
3. Stress matrix (05) green in Chrome + Safari; 30-min soak clean.
   **Safari SMOKE TEST ✅ 2026-07-13 (the row's first visit — the chain's biggest unvisited risk retired):**
   Safari 26.5.2 on the M3, `?pak=1&stream=1&src=pak-ls`: boots, streams, full visual stack works (clouds/
   sun/godrays); `texture-compression-bc` present (Apple-silicon Metal carries BCn), `timestamp-query`
   present too (HUD showed real GPU numbers). GPU pass 2–4 ms vs Chrome's ~1.8–2.1 (WebKit's WebGPU is
   less optimized) — comfortably inside the 8.3 ms/120 Hz budget. Remaining for the criteria run: the FULL
   bench matrix + stress scenes + soak in Safari, numbers into the series.
4. ~~Prod fallback: non-WebGPU browsers keep the three-WebGL path untouched; the loader picks per
   capability.~~ **REPLACED 2026-07-17 (user decision, final): the game is WebGPU-FIRST — no dual-renderer
   support.** Non-WebGPU browsers get a clear "sorry, your hardware/browser doesn't support WebGPU"
   screen instead of a fallback renderer ("otherwise we'd have to maintain two versions — not worth it").
   This reaffirms plan 13's 2026-07-12 supersession of the old criterion; the "loader" therefore shrinks
   to a boot GATE: `navigator.gpu` + adapter → the engine host, else the message. The three-WebGL path's
   only remaining role is the post-flip comparison period until the C2 deletion command.
5. **073 flags & code disposition executed** (the promise from the 073 park): once the new engine is default,
   decide keep/fold/delete for `?webgpu/bundle/mat04/...` and the three patch — a dedicated cleanup PR with the
   user, per the agreement.

## Phase 1 — the side-by-side start (2026-07-12 audit)

Audited against code; the integration STARTS now, the flip waits for its criteria:

- **Entry point verified**: `packages/game/src/game.ts` owns the renderer via
  `core/renderer.ts#createRenderContext` (the `?webgpu=1` spike branch lives there — the precedent for a
  capability branch). `apps/web/src/standalone/webgpu-spike.ts` is the precedent for a SEPARATE boot path.
- **Phase-1 shape**: a standalone own-engine boot in `apps/web` (like the spike): game VFS → pak source →
  `@opensa/engine` + the lab's streaming driver + the game's camera/controls — NO gameplay yet. One flag
  switches the WHOLE renderer; two renderers never share a canvas.
- **Flip blockers (assessed 2026-07-12)**: full-map pak (BC-encode of the processed α-subset gates size —
  measurement running), M3 dynamics (own IFP sampler — plan 08's early probe), water v1 (user-deferred,
  idea 0.5.0/01), production range-read pak delivery (05's noted follow-up).

## Tasks

- [x] Boundary inventory verified against code (2026-07-12: StreamingSystem three-shaped ✓ superseded by 05;
      game loop framework-agnostic ✓; physics = three math only ✓; character/vehicle three-refs ✓ awaits 08;
      UI/config renderer-independent ✓; picking = three raycaster ✓ needs the 07 BVH reuse).
- [x] **Entity-handle adapter for vehicle gameplay — DONE 2026-07-14 (B5 steps 3-4, ledger in [08](08-dynamics.md)).**
      `VehicleHandle` (game/src/vehicle/vehicle-handle.ts) is the renderer-agnostic contract; `ThreeVehicleHandle`
      and `EngineVehicleHandle` implement it. A grep for `from 'three'` across `game/src/vehicle/` now returns
      only `Vector3`/`Quaternion` MATH — no `Object3D`, no `.visible`, no `.attach`, no `.traverse`. The one
      exception is `VehicleHeadlightSystem` (sprites/materials/uniform arrays: three-only by nature; the
      DECISION half of it was extracted to the shared `vehicle-lamps.ts` in step 5). The CHARACTER half of this
      task was already served by the B3 host (ECS Transform + the ped probe — no mesh ref in the loop).
- [x] **Engine-side picking — DONE 2026-07-19, but NOT as a general ray query.** Batched cell geometry has
      no per-vertex id, so neither an ID-buffer readback nor a triangle walk was possible. Instead the
      `.oscell` gained a per-placement MAPPER (minor 6) and `CellStore.pick()` is a ray/AABB test over it,
      gated by `debugPicking`. That serves the map inspector (name / position / hide); a TRIANGLE-accurate
      ray query still does not exist, and would need the mapper's ranges plus retained index data. See
      [22 debug tools](22-debug-tools.md) phase 8.
- [x] **Config-API parity audit — DONE 2026-07-13 (same day):** ONE shared driver
      `@opensa/game/adapters/engine-environment-driver` (renderware allowed there by the layer rule) maps
      config→`Engine.environment` for BOTH hosts: sun/moon arcs build DYNAMICALLY from `night.litFade`
      (prod's own `sunElevationAt`, now three-free, extended past the window so the disc sinks below the
      sea horizon), timecyc colours when the pak carries them (parametric fallback else), per-weather
      cloud profile, and the prod tunables live on: `sky.mood` (now actually fed to the LUT),
      `clouds.opacity`→cloudAlpha, `moon.brightness`, `sun.godrays`→`env.godrayStrength` (new engine
      field gating the post pass), `night.emissiveBoost`, `fog.timecycScale` (× the lab's `?fogscale=`).
      The game host dropped its parametric `applyHour` — REAL timecyc in `?engine=opensa`; the lab's
      drivers are thin wrappers. 8 driver unit tests. Original inventory kept below for reference:
      externally-tunable graphics config that the new-engine hosts currently hardcode. Inventory everything
      configurable that touches the new engine and design one config API so the flip preserves tunability.
      Known surface (from `game-runtime-config.ts` / prod plugins): `night.litFade`
      (dawnStart/dawnEnd/duskStart/duskEnd — prod builds the SUN ARC dynamically from these; our hosts
      hardcode 6:00→18:00 in `sunArc()` and the moon window 20:00→5:00 in `applyMoon`), `sun`
      (godrays/godraysSize/sunSize — our GODRAY_INTENSITY/DECAY/THRESHOLD are engine consts), `moon`
      (brightness/elevationDeg/size), `sky` (mood/exposure/weight — env.skyMood exists but isn't fed),
      `clouds` (coverage/opacity — plus our cloudSpeed/cloudFadeSeconds/cloudAlpha env defaults), `fog`
      (distance/timecycScale — the lab's `?fogscale=`), `bloom` (plan 09), `lights` night hours,
      `night.emissiveBoost`. Engine `Environment` is already the right sink — the API maps config → env +
      a small engine-consts block (godrays); hosts share the mapping like they share game-runtime-config.
- [x] Phase-1 standalone boot in the web app (2026-07-12): `opensa-engine.html` +
      `apps/web/src/standalone/opensa-engine.ts` — `@opensa/engine` + the (now package-level) streaming
      driver + a free-fly camera over the FULL-LS pak (`?src=pak-ls`; root `public/pak-ls` symlinks the
      lab's). The streaming modules moved `apps/engine-lab/src/stream/*` → `packages/engine/src/stream/*`
      (exported: `setupStreaming`, `StreamingDriver`) — both apps consume the same driver now.
- [x] **Phase 2 — the game boots on the engine (B3 v1, 2026-07-13, FIELD ✅ same day — walk/run/jump around Grove Street, feet data-exact on the road):** `?engine=opensa` on
      the REAL app. The branch lives at the shell's code-split boundary (`app.tsx` — lazy-selects
      `EngineCanvasHost` instead of `CanvasHost`; the two hosts never share a canvas). REUSED unchanged:
      the runtime Config (extracted from canvas-host into `game-runtime-config.ts` — one source of truth,
      both paths consume it), Rapier `PhysicsWorld` + `CharacterControllerSystem` (its only three seam —
      `camera.getWorldDirection` — is fed by a shim over the host's follow camera) + `PhysicsSystem` +
      `CollisionStreamingSystem` (COL cells stream around the player on the game's 256 grid, independent
      of the pak's 250 render grid), keyboard input, the ECS player entity (mirrors setup-character minus
      the three mesh). NEW: follow-orbit camera producing a `CameraState` (drag = look, wheel = zoom,
      config's followDistance/zoom bounds), the render-streaming driver follows the PLAYER (`?src=pak-map`
      default), the player body = the B1 ped probe driven by gameplay state (position from Transform,
      heading from planar velocity, idle↔walk by speed; `/ped` root symlink). Parametric day arc v1;
      timecyc driver + zones/HUD adapter + pointer-lock look are follow-ups. KNOWN LIMIT: the pak is the
      original conversion while the VFS may be a modded profile — collision and render can disagree
      where mods move geometry; parity testing wants the matching profile. Field-round fixes that closed
      it: canvas sizing (no wrapper — the shell's .sa-game sizes it, + ResizeObserver for the hidden
      warmup mount), FULL bitECS field init (plain-array stores: an unwritten Velocity field NaN-poisons
      the whole controller chain — no movement AND no gravity), run clip + speed thresholds, and the
      data-driven feet placement (fixture minZ from the IDLE-POSED mesh — the bind pose lies along an
      axis and is useless — plus a centre-origin ground ray excluding the own capsule: rays started under
      the capsule slip beneath thin road COL shells into basements).
- [x] **WebGPU boot GATE in the web app — DONE 2026-07-17** (rescope of the old capability-gated loader —
      criterion 4 above): `apps/web/src/ui/shell/webgpu-gate.ts` probes adapter + `texture-compression-bc`
      (mirrors `initDevice`'s hard requirements so passing the gate means the engine actually boots), and
      `app.tsx` flips the lazy-host default — the ENGINE host is now THE game; no WebGPU → the sorry
      screen (logo + message, menu never shows). NO three-WebGL fallback branch (WebGPU-first, user
      decision); `?engine=three` is the manual comparison override only and dies at C2 (`?engine=opensa`
      still accepted — harness URLs unchanged). All three branches verified in the headless harness:
      default boot → webgpu canvas (world renders, 120 fps HUD), `?engine=three` → webgl2 canvas,
      `--disable-features=WebGPU` → sorry screen with the menu hidden (the null-adapter path — navigator.gpu
      existed). 5 unit tests (probe: absent gpu / null adapter / throw / no BC / ok).
- [x] **Soak MODE built — DONE 2026-07-17** (pre-flip ③; the criteria-3 instrument): `?soak=<minutes>`
      cycles the 6 bench scenes until the deadline reusing the SAME leg mechanics as the bench (extracted
      to `engine-perf-runs.ts`; the bench `[bench]` report verified unchanged after the refactor). One
      `[soak] {json}` line per leg (frames/avg/p95/slow, heap MB, residency+texture MB, cells, late
      creates, long tasks) + a final SELF-JUDGED verdict — 8 checks relative to the run itself
      (display-independent): coverage, heapFlat (first→last quarter mean), residencyFlat + textureFlat
      (peak-in-last-quarter = the leak signature), lateBounded, longTasksBounded (budget minutes/5),
      frameStable (p95 median drift ≤1.5×), slowBounded (≤0.5 %). Heap/longtask probes are
      Chromium-only — the judge marks them skipped elsewhere (the Safari flow: open the tab with
      `?soak=30`, read the verdict off the HUD `soakStatus` line). Judge = pure `soak.ts` + 8 unit tests.
      Mechanism check (4-min headless): 15 legs, PASS, heap flat 2661 MB, texture plateau 1253 MB,
      late 0, longTasks 0, slow 3/27010. The FORMAL 30-min Chrome+Safari runs are the C1 item below.
- [x] **Bench + soak + parity sweeps; the flip decision doc — DONE 2026-07-18: the FLIP IS DECIDED.**
      See [10-flip-decision.md](10-flip-decision.md). Criteria 1 (PASS by 2× — engine 119.6–120.3 fps
      vsync-locked vs prod 16.2–37.8 on land), 2 (PASS — user's parity round, "parity ok", on the build
      carrying the 07-18 fog/night fix batch), 3 (PASS rescoped — 30-min Chrome soak all 8 checks green;
      Safari declared not relevant), 4 (PASS — the WebGPU boot gate replaced the fallback criterion).
      Criterion 5 rides C2 by construction. C2 ([13](13-cleanup.md)) STAYS GATED — `?engine=three`
      remains the comparison rollback until the user's explicit deletion command.
- [ ] Post-flip cleanup: 073 flags/patch disposition PR (discussed with the user first — standing agreement).

## Measurement ledger

| Date       | What                                                                                                    | Numbers                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-12 | FULL-LS convert (rect −1,−12…11,1 = 182 rect cells → 345 entries, HD-vegetation overlay on, both bakes) | **pak 1.15 GB — geometry 939 MB (82 %!), textures 212 MB (18 %)**; 20.5 M verts, 82 arrays, 66 timed objects; convert 833 s of which bakes 760 s (AO 418 + sunVis 342, 423 M rays vs 13.9 M occluder tris); 16 GB node heap survived. GOTCHA fixed en route: the global bake dedup cache exceeded V8's Map size cap (~16.7 M) — caches are per-cell now |

| 2026-07-12 | A1 stage 1: per-entry deflate-raw wire compression | measured on real cells first: deflate 2.18× / brotli-q6 3.06×; SHIPPED deflate-raw (native `DecompressionStream` in the worker, zero deps): bench rects 246.5 → 93.8 MB and 135.3 → 52.5 MB (**2.6×** — textures compress too); inflation worker-side, main thread still receives GPU-ready bytes. meshopt (vertex/index reorder+quantize) = A1 stage 2, multiplies ON TOP of deflate. FULL-LS reconverted: **1.15 GB → 500 MB (2.3×)**; full-map projection ≈ 1.6 GB wire before meshopt |

**What the numbers mean for the flip (assessment 2026-07-12):**

- The texture-side BC-encode is NOT the first lever (212 MB total; halving it saves ~100 MB). **Geometry
  dominates**: 20.5 M verts × 36 B ≈ 740 MB + indexes. Levers in order: (1) WIRE compression — meshopt
  vertex/index encoding + HTTP brotli (the 066 concept named meshopt for exactly this), pak stays GPU-layout
  after a worker-side decode; (2) the HD-vegetation overlay is ~3× the stock vert count (measured on the
  bench rect) — a stock-vegetation profile would put full-map geometry near ~1 GB before compression;
  (3) BC for the α-subset comes after both.
- Full map ≈ 3.2× LS ⇒ ~3.5 GB uncompressed pak, ~45 min single-threaded convert. Bakes are 91 % of the
  time and embarrassingly parallel per cell → a worker pool is the convert-time lever. The full-map
  convert will also need CHUNKED welding (16 GB heap held for LS; 3.2× the scratch will not).
- Runtime residency is ring-bounded regardless of pak size (360 MB on the bench rect) — pak size is a
  HOSTING/DOWNLOAD concern, solved by range-reads (users stream what they visit) + wire compression.

(final matrix: every bench scene × both engines × fps/CPU/GPU; the flip verdict)
