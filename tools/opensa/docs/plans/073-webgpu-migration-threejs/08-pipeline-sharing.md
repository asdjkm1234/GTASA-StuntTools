# 073/08 — Pipeline sharing (lighter cell appearances)

**Priority: RE-RANKED P0 (2026-07-11).** Field verdict after the 03/04 slices: steady render CPU is fine
(~6-13 ms) but the EXPERIENCE is compile-bound — every WGSL change (each new material slice!) triggers a
cold-start storm of per-object pipeline compiles (1.5 s frames, 20-30 s cell builds, occasional GPU
device-lost), and driving keeps paying per-appearance compiles. Chrome's Dawn disk cache masks it on repeat
runs of identical WGSL — which is what made the slowdown look random. THIS plan gates the whole migration.

## Context

- Root: the render-object cache key includes `object.uuid` for `isInstancedMesh || count > 1`
  (`getMaterialCacheKey`, PR 29066 TODO) because `createInstanceMatrixNode` captures the SPECIFIC
  `instanceMatrix` array into a `buffer()` bind group — sharing programs across InstancedMeshes would bind the
  first mesh's matrices for all. The upstream fix = `referenceBuffer()` refactor (no timeline).
- KEY FINDING: `getGeometryCacheKey` hashes the attribute LAYOUT only (names/itemSize/stride), not geometry
  identity — so **plain `Mesh` objects share pipelines per (material × layout)**. Our world is ~90%
  single-placement groups built as count-1 InstancedMesh — the uuid tax bought nothing there.

## Tasks

- [x] Read `InstanceNode` (r185): confirm capture mechanism. _Done: `buffer(instanceMatrix.array,'mat4',N)`
      uniform-buffer capture for small counts (our count-1 world) — genuine per-object bind data._
- [x] **Engine-side fix (no three patch): single-placement groups build as plain `Mesh`** — placement in the
      object matrix. `setSingleInstanceMeshes` (build-region), ON under `?webgpu=1` (`?mesh1=0` disables;
      WebGL keeps InstancedMesh — the wind-sway GLSL anchors on `instanceMatrix`). Consumers adapted:
      `game.pick` (accepts region hits without instanceId), `adapter.describe` (single-instance fallback),
      `HiddenInstances` (visible-toggle branch), `breakBreakable` (visible-toggle branch). Multi-placement
      groups (repeated props, procobj, escalators) stay instanced — there real instancing amortizes the uuid
      pipeline. Tests: build-region 3 new cases; 946 renderware+game tests green.
- [x] **Physics death spiral (found via the field 3 fps):** the loop's fixed-step catch-up was unbounded — a
      long load frame (compile storm, up to 4 s) pushed the accumulator into a self-sustaining 3 fps equilibrium
      at 4 ms render CPU. Capped at `MAX_CATCHUP_STEPS = 5` (game.ts); the webgpu HUD now splits the frame
      (render/fixed/update/unaccounted) — that split found everything below.
- [x] **GPU killer #1 — the local-light pool loop: ~250 ms/frame at night** (field: 312→60 ms from `?pool=0`).
      Every world fragment iterated the 12-slot UBO loop. Fixed with a bounding-sphere early-out over all
      active lamps (`uPoolCenter/uPoolRadiusSq`, synced per frame): one compare per fragment gates the loop;
      day (count 0) skips it everywhere by construction.
- [x] **GPU killer #2 — no frustum culling under bundles: ~50 ms/frame day AND night.** Recording a static
      bundle needs per-object culling off, so the GPU rasterized every loaded cell all around, every frame.
      Fixed with BUNDLE-LEVEL culling: `GpuHooks.viewFrustum` (canvas-host builds the camera frustum,
      `?cellcull=0` disables) + `StreamingSystem.cullContainers` — per-cell world bounding sphere (cached by
      child count) toggles `container.visible`; a hidden container's bundle isn't replayed (no re-record).
- [x] **GPU killer #1b — the pool as uniform arrays:** the bounding-sphere gate wasn't enough (at night the
      player IS inside the lamp cluster) and `?dpr=1` proved the cost resolution-INDEPENDENT → the dynamically
      indexed uniform arrays in the fragment loop are a naga/Metal occupancy antipattern. Re-ported the pool
      to a 12×3 float DataTexture read with `textureLoad` (data re-uploads never touch bind groups — bundle-safe).
- [x] **THE architectural finding — unbounded asset memory (field: js heap 3.4–6.2 GB, long tasks 0):** every
      parsed DFF/TXD/prepared-atomic ever streamed stayed in the JS heap forever; on Apple Silicon's unified
      memory the pressure collapses GPU timings (resolution-independent "unaccounted", session-to-session
      variance, device-losts, "barely managed to load"). Fixes: (a) `setTextureDataFreeing` — texture CPU payloads
      (mipmaps + image.data) freed on `texture.onUpdate` after GPU upload; Texture identity survives →
      material/pipeline sharing intact; webgpu-gated (`?texfree=0` off; WebGL keeps data for context restore);
      (b) clump + prepared-atomics caches LRU-capped at 512 (re-parse on revisit). FOLLOW-UP: the IMG archive
      ArrayBuffer (~1 GB) still lives in memory — range reads from Cache API/OPFS is the next lever.
- [x] Field-measure (2026-07-11 evening): heap starts ~2 GB, climbs to ~3.5 GB (the IMG ArrayBuffer + live
      geometries remain), and the lags persist — the "unaccounted" GPU remainder did not move. **Gate taken:
      PARKED.** The remainder sits in the three-WebGPU backend on Metal (present/submission side), below our
      reach without owning the backend. See the umbrella readme for the park summary + revive conditions.
- [~] IF multi-placement props still storm: the three-patch referenceBuffer prototype for the instanced rest.
- [~] Fold findings into the upstream issue (plan 01) — the Mesh workaround + capture analysis strengthen it.

## Done

Cell appearance no longer compile-bound (new-texture compiles only); `?appear` default raised without frame spikes.
