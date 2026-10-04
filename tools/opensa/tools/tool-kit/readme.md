# tool-kit

Shared building blocks for the offline tools (`map-optimizer`, `opensa-lod-generator`, `vehicle-optimizer`), decoupled
from any single tool so they don't reach into each other. Read-only over the engine's RenderWare primitives
(`../packages/renderware/src/...`); all mutation/convenience lives here.

Today a plain folder of relative-imported modules; on the eventual monorepo move it becomes a real package
(`@opensa/tool-kit`) — see [plan 057](../../docs/plans/057-nx-monorepo-migration/readme.md).

## Modules

- **`mesh/smooth-normals`** — smooth-group normal rebuild (map-optimizer plan 015), decoupled to operate on raw
  `positions` + flat triangle index-triples → `{ normals, indices, splitSources }`. Each caller re-expands its
  own attributes via `appendSplitsF32` / `appendSplitsU8`. Used by map-optimizer (SubMesh) + opensa-lod-generator
  (merged cell mesh).
- **`mesh/simplify`** — QEM edge-collapse simplification (Garland–Heckbert) with boundary/material-seam pinning,
  interpolated attribute streams, and opt-in collapse guards: `maxEdgeFactor` (anti-spike), `minFacesPerGroup`
  (no vanishing surfaces), `maxUvDrift` (rejects collapses that disagree with an incident face's own position→UV
  map — GTA's patchwork-mapped tiled surfaces smear without it; lod-common plan 003 "Road-stripes bug"). Used by
  `@opensa/lod-common/decimate` (opensa cell LODs + lod-procobj clones).
- **`mesh/bvh`** — triangle BVH raycaster backing lod-common's `visibility-cull`.
- **`vehicles-dir`** — what a `mods-src/<game>/vehicles` folder holds: every subfolder of a flat tree, or
  `models/` overridden per SLOT by `new/` in a structured one (vehicle-installer plan 007). Shared because
  `vehicle-installer` and `vehicle-cutscene` read the SAME folder and must not disagree about which cars are
  in the build; the slot is the folder name's first field (`<slot> - <car> - <author>`).
- **`archive/img`** — an editable GTA IMG (VER2): `openImg(bytes)` / `editArchive(archive)` →
  open · get · set (add/replace) · delete · `build()` a fresh `.img`. Wraps the engine's `openArchive` +
  `buildVer2Buffer`. Used by map-optimizer (swap optimized entries) + opensa-lod-generator (emit the cell-LOD build).

## Principles

- **Never modify `../src`** — read-only reuse of the engine's parsers/writers; the toolkit adds the editing layer.
- **Tool-neutral** — no imports from `map-optimizer` / `opensa-lod-generator` / `vehicle-optimizer`; the dependency
  arrow points only inward (tools → tool-kit → engine).
