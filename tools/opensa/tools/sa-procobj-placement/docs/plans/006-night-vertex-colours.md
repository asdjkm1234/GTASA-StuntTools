# 006 — Night vertex colours on procobj LODs

**Status: ✅ Implemented.** Carry the source model's night vertex-colour set through to the decimated LOD so it
darkens at night like the HD instead of staying at the bright day prelit.

## Problem

Same root cause as lod-trees-generator plan 010: SA models carry a **night** vertex-colour set (`0x253F2F9`, one
RGBA per vertex, much darker than day); with none, SA reuses the bright **day** prelit after dark. Unlike sa-lod's
verbatim HD clone (which keeps the night set), lod-procobj **decimates + re-encodes** the model, and
`buildModelMesh` read only `geometry.prelitColors` (day) — so the LOD shipped with **no night set** and was too
bright at night.

## Fix

Because a procobj LOD is a true **geometry copy** (real triangles + textures, not a day-baked billboard), it renders
`texture × nightColour` exactly like the HD — so carry the **absolute per-vertex** night colours straight through
(no ratio, unlike the tree impostors).

- `mesh-builder.ts buildModelMesh` now accumulates `nightColors` alongside `colors`: per vertex it takes the source
  geometry's night colour when present, else falls back to that geometry's day prelit (what SA itself uses at night)
  — so a model mixing night / no-night geometries keeps each part's correct dark value. The merged mesh emits
  `nightColors` only when at least one source geometry had a night set.
- The rest of the chain already preserves them: `@opensa/sa-lod` `decimateMesh` (rides night along as an
  interpolated attribute), `rebuildMeshNormals`, and `encode-dff` (writes the `0x253F2F9` plugin when present).

## Tests

- `mesh-builder.test.ts` — synthetic: carries a source night set, and omits `nightColors` when no geometry has one.
- `mesh-builder.test.ts` — real fixture (`fixtures/original/dff/night-colours/cedar1_hi.dff`, via
  `npm run test:fixtures`): the merged mesh's night set matches the source per-vertex.

Verified on real procobj species: `sand_josh1` (source night 18 → LOD 19, the small delta from decimation),
`cedar2_po` → 14. See the `lod-generator-night-vertex-colours` memory; the tree-impostor (ratio) case is
lod-trees-generator plan 010.
