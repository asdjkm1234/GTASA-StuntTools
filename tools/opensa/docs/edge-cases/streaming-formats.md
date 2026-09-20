# Native-format & streaming invariants

Versioning rules and the memory model of the `.ospak` streaming path (plans 074/02, 074/05).

- **Unknown major versions are rejected loudly**; minors only add optional sections. The v0 layouts were
  explicitly throwaway — don't try to read them.
- **Mip chains must be complete in-file** — the runtime never generates mips. Odd (non-pow2) textures are
  resampled offline, which also dodges WebGPU's BC block-alignment constraint.
- **Pak bytes never live whole in JS.** The pak worker range-reads (HTTP Range or Blob slices); JS heap
  target < 500 MB and flat. Teleport hops can queue ~257 MB transient (mitigated by stale-blob pruning +
  an in-flight cap).
- **Vite's dev server doesn't guarantee HTTP Range** for the whole-map pak — auto-detected, falls back to
  whole-pak mode. `scripts/serve-static.ts` serves Range correctly.
- **≤ 1 cell create per frame**; eviction only outside the outer ring; the old LOD level stays until its
  replacement is resident (atomic swap).
- **The rings test the manifest `aabb`, not the grid rect** (plan 087): geometry welds into the cell of
  its PIVOT and reaches past the grid rect (gostown mean 141 u, max 799 u). A pak built before `aabb`
  falls back to the grid rect — its big pivot-welded meshes (bridges) can pop inside the fog until it is
  reconverted.
- **The cell-LOD bake MUST run on the render grid (250)**: a mismatched bake (the pre-087 256) puts an
  object's HD and LOD in different streaming slots, and the swap can leave it with NEITHER level loaded
  (field-proven: the gostown bridge span at spawn, plan 087). A pak built from a 256 bake keeps this
  hole class until rebaked.
- **The placement mapper is parsed only under `debugPicking`** — a full map's mapper runs to tens of MB
  against a ~21 MB steady heap; F2 Map pick/name/hide costs that memory.
- **The http-dir dev loader buffers the world as a Blob** (~332 MB at boot) — fine for dev; the lab keeps
  URL streaming. A follow-up may move it to URL streaming.
- **VER1 IMG (GTA3/VC dir+img) is unsupported** — SA-only VER2.
- **Asset caches have no eviction** — bounded by archive content, not by an LRU (vehicle model textures do
  have an LRU).
