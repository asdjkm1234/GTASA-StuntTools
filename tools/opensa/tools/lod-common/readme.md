# lod-common

The shared **HD → LOD core** every LOD tool routes through, so a fix or feature lands once and applies to
`opensa-lod-generator` (merged cell LODs), `sa-lod-generator` (per-object clones) and `sa-procobj-placement`
identically. Design of record: [`docs/plans/002`](./docs/plans/002-shared-hd-to-lod-core.md) (the core) and
[`docs/plans/003`](./docs/plans/003-visibility-first-simplification.md) (the simplification chain + all
measurements).

## Modules

**Core**

- `mesh` — the `MergedMesh` interchange type (per-texture(+tint) groups, prelit + night colours, per-face
  `twoSided` masks).
- `build-mesh` — `MeshBuilder` (accumulate transformed geometries) + `buildClumpMesh` / `clumpFrameTransforms`.
- `hd-to-lod` — `hdToLod` (verbatim fast-path vs mesh path), `LodModifier`/`LodContext`, `applyModifiers`.
- `model-source` / `texture-source` / `texture-stats` / `opaque-coverage` — cached archive readers + per-texture
  stats (mean colour, opaque coverage).
- `view` — the screen-error model (`unitsPerPixel`, `subtendsAtLeast`) all pixel thresholds derive from.
- `bounds` — `clumpBoundingRadius` for the screen-size cull.

**Modifiers (plan 003 — "remove what can't be seen before deforming what can")**

- `drop-degenerate-faces` — zero-area triangles.
- `drop-transparent-groups` — groups whose texture is almost fully transparent.
- `budgeted-decimate` — QEM decimation self-checked by a render diff against a pixel budget.
- `visibility-cull` — sampled camera raycasts; drops unseen faces, single-sides front-only ones (never flips a
  winding), see-through textures don't occlude.
- `coplanar-remesh` — flat clusters re-triangulated from their byte-exact boundary.
- `compact` — orphan-vertex compaction (used by the modifiers).
- `decimate` — the raw QEM wrapper (used by `budgeted-decimate` and lod-procobj). Collapses are edge-length
  capped (anti-spike), group-floored (no vanishing surfaces) and **UV-drift guarded** (`MAX_UV_DRIFT` 0.1 —
  GTA surfaces are UV patchwork, roads reset their tiled V per segment; unguarded collapses smear them into
  lengthwise stripes — see plan 003 "Road-stripes bug").

**Encode / effects**

- `encode-dff` / `encode-txd` / `encode-col` — RenderWare writers (per-face two-sided masks, material tints,
  night plugin, 2dfx section, 65 535-vertex atomic splits).
- `clump-effects` — lift a model's raw 2dfx entries, each carried through its geometry's frame by
  `two-dfx-transform` (pairs with rw-codec `extract2dfxEntries`/`build2dfxSection`).
- `two-dfx-policy` — the ONE declared carry-policy: which 2dfx types ride onto which LOD target, and why.
  The living write-up is [`docs/2dfx-policy.md`](./docs/2dfx-policy.md).
- `two-dfx-transform` — `transform2dfxEntry`: position for an opaque payload, plus orientation for the ones
  that carry it (a plate's rotation, an escalator's step path). Refuses a scaled or mirrored basis.
- `prelight` / `normals` — prelit conditioning + smooth-normal rebuild.

**Measurement**

- `preview` — deterministic CPU rasterizer + `previewDiff`; the eye of the Phase-4 harness
  (`opensa-lod-generator/src/harness.ts`) and of `budgeted-decimate`'s self-check. Caveat: it paints per-group
  **mean texture colour**, not UV-sampled texels — it validates geometry, and is blind to UV damage (that's what
  `decimate`'s UV-drift guard covers at the source).
