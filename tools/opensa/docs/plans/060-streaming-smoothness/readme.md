# 060 — Streaming smoothness (cell-swap freeze)

**Status: ✅ Phases 0–5 shipped; round 7 confirmed subjectively smooth (no lag visible to the eye).
Residual polish levers in Deferred.** Crossing a cell boundary (LOD↔HD swap or a new LOD ring cell) produces
a visible frame hitch. The streaming _policy_ is already right (hysteresis dead-band, old level kept until the
new one is in, cell cache); the hitch is _work placement_: `adapter.loadCell` is async only by signature — the
whole `buildCell` (parse every DFF/TXD of the cell, build three.js meshes, procobj scatter) runs synchronously
on the main thread in the request frame, and the first render of the added objects then uploads buffers +
compiles shaders in one more frame.

## Phases

- **Phase 0 — measure.** Instrument the two humps so tuning is data-driven and regressions visible:
  - CPU hump: time the cache-miss `buildCell` path in `gta-sa-world.adapter.loadCell` — log
    `[stream] built <cx,cy,level> in <ms> (<n> objects)` for builds over a threshold.
  - GPU hump: after the streaming system adds a cell, watch the NEXT frame's delta — log
    `[stream] post-add frame <ms> (<key>)` when it spikes. Attribution without renderer surgery.
- **Phase 1 — velocity lookahead.** `streamKeys` is computed from the current view position, so a cell is
  first requested exactly at the boundary. Add a second key-collection pass around a predicted point
  (`view + normalize(velocity) × lookahead`, capped at one cell) that only ADDS keys (never flips a level the
  view-pass already chose). First-visit builds then start seconds before the boundary and land in the cell
  cache; by the crossing the swap is a cache hit.
- **Phase 2 — budgeted ingest.** Don't add a whole cell's meshes in one frame: the load handler queues the
  built objects and `update()` drains the queue per frame. The seamless-swap invariant is preserved — the old
  detail level is removed (and the cell marked loaded) only after its whole batch is in; removal logic treats
  queued cells as still loading. _(Historical: started as a ~4 ms add-time budget, then a 24-obj add cap —
  both spread the visible appearance; rounds 3–4 replaced them with invisible time-budgeted WARMING +
  atomic appearance, the shipped form.)_

- **Phase 3 — sliced cell build.** Round 1 measured `built … 100–234 ms` — one synchronous main-thread block
  per first-visit cell, regardless of when the lookahead started it. `buildCellSteps` (renderware) exposes the
  build as a generator (one step per model group + the tail passes); the adapter drives it cooperatively with
  a 5 ms per-slice budget, yielding a macrotask between slices — the same total work now interleaves with
  rendered frames. The `built` log line reports wall time (spanning slices), no longer a freeze length.
- **Phase 4 — precompile before appearance.** Round 1 measured `post-add frame 33–75 ms` — shader compilation
  - texture upload landing in the frame a cell first renders. `game.precompile(objects)` runs
    `renderer.compileAsync` (KHR_parallel_shader_compile) against the live scene between build and ingest;
    the streaming system awaits it before queueing the batch.

- **Phase 5 — worker parse (round 7).** Rounds 5–6 proved the remaining stalls are single indivisible CPU
  units — `parseDff` of a baked cell-LOD plus the per-vertex geometry work — which no main-thread scheduling
  can split. `buildClumpParts` is now two halves: `prepareClumpAtomics` (renderware `mesh/prepare-clump.ts`,
  PURE — sanitizing, normal computation, prelit/sway conversion, per-material index buffers, bounding
  sphere; results cached by model name) and `wrapClumpParts` (three side — BufferGeometry/material wrapping
  only). A dedicated Web Worker (`game/adapters/dff-parse.worker.ts`) runs parse+prepare off-thread: the
  adapter's `loadCell` collects the cell's uncached model names (`cellModelNames`), ships their raw DFF
  buffers to the worker (transferred, `archive.get` returns fresh slices), and primes the renderware caches
  (`primeClump`/`primePreparedAtomics`) with the transferable-typed-array results; in-flight models are
  awaited, not re-sent. The sliced build then runs on cache hits. No Worker (node tests) → the old
  synchronous path, unchanged. NOTE: TXD parse stays on the main thread — measured cheap (textures upload
  as compressed S3TC, no CPU DXT decode; checked round 6).

## Deferred (next levers, in effect order)

- **GPU-ready cell format** — perfect-map-builder emits transcoded cells (raw vertex/index buffers +
  KTX2/compressed textures): runtime parse becomes memcpy, uploads shrink. Confirmed already-S3TC for
  textures (round 6); the remaining win would be pre-flattened vertex buffers (skip prepare entirely).
- **Split oversized baked LODs at bake time** (opensa-lod-generator) — if a single LOD mesh's GPU upload
  (~17 ms warm on one object) still drops a frame, emit the merged cell LOD as 2–4 sub-meshes so the
  per-object warm unit shrinks. Asset-side fix; engine code is done.

## Measurements

**Round 1 (after Phases 0–2, user drive):** `built` 19–234 ms (LOD cells 89–237 objects), `post-add frame`
33–75 ms — both humps confirmed on the main thread; lookahead/ingest rescheduled but could not shrink them →
Phases 3–4.

**Round 2 (after Phases 3–4, user drive):** noticeably smoother subjectively; `built` wall times DOWN
(140–175 ms vs 234, now interleaved slices — Phase 3 works); but `post-add frame` 50–100 ms remained on
almost every cell. Root cause: the ingest TIME budget measures `root.add()` (microseconds), so a whole
237-object cell entered in ONE ingest frame — and every object's FIRST DRAW uploaded its geometry in that one
frame, which `compileAsync` does not cover (it compiles programs + uploads textures, not vertex buffers).
Fix: **hard count cap, 24 objects/frame** on top of the time budget — first-draw uploads now spread across
~10 frames per cell.

**Round 3 (after the count cap, user drive):** `built` 48–249 ms wall (sliced, unchanged), `post-add frame`
33–58 ms — DOWN from 50–100 (spreading works), but jerks remain AND the cap created a new, worse artifact:
cells now assemble piece-by-piece on screen (objects visibly build up one by one) because the 24-obj/frame
budget spread the VISIBLE adds. Root cause of the whole round-2/3 tension: `root.add()` is free, the cost is
the first DRAW of each object (geometry/instance-buffer upload) — so any scheme that spreads real adds spreads
the appearance too. Fix: decouple them. `game.warmUp(objects)` renders a slice into a 1×1 scissored viewport
(frustumCulled forced off, viewport/scissor restored) — forcing the uploads invisibly; the streaming system
warms each queued cell at ≤24 objects/frame (`WARM_PER_FRAME`) and only when the whole batch is warm does the
cell `root.add()` ALL objects + finish the swap in one step. Appearance is atomic again (like pre-round-2),
uploads never land on the appearance frame. The ingest time budget + injected clock were removed (nothing
timed anymore — warming is count-driven).

**Round 4 (after the invisible warm-up, user drive):** pop-in gone, but `post-add frame` UNCHANGED at
41–58 ms (`built` 57–181 ms wall). Diagnosis: warming 24 objects in one frame costs the same ~40–58 ms of
synchronous uploads as 24 first-draws did — the fixed count slice only MOVED the stall from the appearance
frame into the warm frame (and the post-add log then attributes the next cell's warm frame to the
just-swapped key). The insight the count cap missed: warming is INVISIBLE, so spreading it thinner is free —
no pop-in trade-off exists anymore. Fix: warm object-by-object under a per-frame TIME budget
(`WARM_BUDGET_MS = 3`, measured after every upload, ≥1 object/frame guaranteed; `WARM_PER_FRAME = 24` kept
as a determinism cap), `game.warmUp` holder scene/viewport hoisted to reused fields to keep the per-object
render-call overhead out of the budget. New log line `[stream] warm frame <ms> (<n> objects)` (>8 ms)
attributes warm cost explicitly, so post-add numbers stop double-counting it.

**Round 5 (after time-budgeted warming, user drive):** `warm frame` lines appeared but exposed the real cost:
`warm frame 28ms (1 objects)`, `warm frame 78ms (11 objects)` — a SINGLE object cannot cost 28 ms of pure
buffer upload. Diagnosis: the warm holder was a bare `new Scene()` — no fog/environment/lights — and those are
part of three.js's shader program cache key, so the warm draw SYNC-COMPILED a no-light/no-fog program variant
per material that no real frame ever uses (precompile built the correct live-scene variants; the warm was
compiling a second, wasted set). `post-add` 42–67 ms also persisted, clustering around `built` lines —
suspicion: single build-generator steps (one model group each) overrun the 5 ms slice deadline unobserved,
since the deadline is only checked BETWEEN steps. Fixes: (1) `game.warmUp` now mirrors the live scene's
context — borrows `scene.fog`/`scene.environment` and temporarily reparents the scene's lights into the warm
holder (restored after), plus `shadowMap.autoUpdate` off for the warm draw — so warming resolves to the exact
precompiled programs and pays uploads only; (2) the `built` log now reports `max slice <ms>` (longest single
generator step) to confirm/refute the slice-overrun attribution with data.

**Round 6 (after the warm-context fix, user drive):** `warm frame` DOWN 78→17–18 ms worst (the wasted variant
compile is gone; the residual 17 ms on 1 object is plausibly a genuine big LOD geometry+atlas upload — watch
next round). `max slice` data landed and confirmed the attribution: **LOD cells hit 65–79 ms single steps**
(`3,-5,lod` built 113 ms with max slice 79 ms) while a 361-object HD cell peaked at 5 ms — one baked cell-LOD
group folds a big DFF parse + TXD parse (CPU DXT decode) + geometry build into ONE generator step, invisible
to the between-steps deadline. The persistent `post-add` 33–50 ms lines are vsync-quantized (2–3 × 16.7 ms)
and cluster around those builds — largely the same slices attributed to whichever cell swapped last. Fix:
`buildCellSteps` warms the parse caches as separate steps (`getTextures` → yield, `getClump` → yield, then
`buildGroupInstancedMeshes` runs on cache hits) — a 79 ms monolith becomes ~3 slices of parse/decode/build.

**Round 6b (after the parse-step split, user drive):** partial — cells whose weight was spread across sub-steps
dropped (`10,-8,lod` max slice 79→50, `5,-3,lod` →8) but the worst cells didn't move (`3,-5,lod` 81 ms,
`3,-6,lod` 78 ms): their whole cost is ONE indivisible unit (a big baked-LOD `parseDff` + per-vertex prepare).
`post-add` values are vsync-quantized (33/42/50 = 2–3 × 16.7 ms) and cluster around `built` lines — they are
those same slices landing in frames attributed to whichever cell swapped last. Texture check done: TXD DXT is
NOT CPU-decoded (uploads as compressed S3TC), so textures are off the suspect list. Conclusion → Phase 5
(worker parse): indivisible main-thread units can only be MOVED off the main thread, not sliced.

**Round 7 (after the worker parse, user drive): SMOOTH — no lag visible to the eye, works well.**
The numbers agree on the CPU side: `built` 47–54 ms wall with **max slice 5–7 ms** (was 100–250 ms wall with
65–81 ms indivisible steps) — even 381-object HD cells and baked LOD cells now build in sub-frame slices on
worker-primed caches. Remaining signals, for the record:

- `warm frame 92 ms (9 objects)` / `32 ms (1 object)` — occasional oversized baked-LOD geometry uploads;
  a single `bufferData` cannot be sliced from the engine. This is the bake-time LOD split lever (Deferred)
  if it ever reads as a visible micro-stutter.
- `post-add frame ~42–58 ms` lines still appear on most swaps, yet the drive FEELS smooth — consistent with
  the established attribution caveat (these deltas absorb concurrent warm/build slices of OTHER cells and
  vsync quantization; isolated single longer frames during motion are hard to perceive). If this is ever
  chased further, the honest instrument is a per-frame profiler around the appearance frame, not this log.

The plan's core goal — no visible freeze on cell swaps, no pop-in — is met: policy (hysteresis, lookahead,
atomic appearance) + work placement (worker parse+prepare, sliced wrap, invisible time-budgeted warming,
precompile) each removed a distinct hump the measurements attributed round by round.
