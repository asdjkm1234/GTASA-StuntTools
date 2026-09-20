# 008 — An `anim` def's atomics are placed by their DFF frames in the cell merge

**Status: ✅ DONE 2026-08-17 (one-model lab, offline-verified; his field verdict on the lab pending).**
Field find (session 22, `burger01_law` in `build/original/opensa`): the OpenSA far view drew the Burger Shot's
rotating burger sign in the MIDDLE of the roof, not on its pole at the corner. The `sa` target had the same
defect from the other side and closed it in `sa-lod-generator` plan 009 (2026-08-17); the cell bake had its own
copy of the mistake.

## What was wrong

`mergeCell` (`adapters/gta-sa/merge.ts`) placed every atomic by the IPL instance transform ONLY — "the DFF
frame transform is ignored, as the engine does for map atomics" (plan 002, 1a). That is true of a plain `objs`
clump: SA re-frames the one atomic it keeps at the origin, and the engine's weld does the same. It is NOT true
of an IDE **`anim`** def: SA draws the whole clump with its frame hierarchy (that is what animates), and the
engine's weld composes `frameWorldTransform` for every atomic of an `anim` def
(`packages/cell-weld/src/weld.ts` `atomicFrame`). `burger01_LAw` (`LAw.ide`, `anim` row) carries the sign on
child frame `burger01_LAw3` at (7.18, −7.30, 1.01) — the HD placed it right, the cell LOD baked it at the
model origin, so the sign JUMPED to the roof centre the moment the cell flipped to LOD.

## The change

- `ModelRef` (`packages/game-build/src/partition.ts`, `ideRefs`) carries `anim?: string` — the row's IFP name,
  set for `anim` defs only.
- `CellInstance` (`core/types.ts`) carries the same `anim?` — the adapter's `resolve.ts` threads it through
  `buildIdMap` → `collectInstances`.
- `mergeCell` composes, for an `anim` instance, the atomic's `frameWorldTransform` (the SAME walk the weld
  uses — root→leaf, root matrix excluded) AHEAD of the instance transform: the animation's rest pose, exactly as
  the sa target's `buildClumpMesh` bakes it. `objs` clumps are untouched.

Test: `merge.test.ts` on the real `fixtures/original/dff/anim-clump/burger01_law.dff` — the sign's first
vertex lands where lod-common's `buildClumpMesh` (plan 009's field-accepted placement) puts it, and stays at its
local position without `anim`. `partition.test.ts` covers the new field of `ideRefs`.

## Measured (2026-08-17)

`model-repack.ts burger01_law` — rect `3,-7` (88 models), cell LOD rebake **12.7 s**, weld 4.0 s, lab pak
6.3 MB / 2 cell entries. Read straight out of the LOD cell `3,-7,lod` (a temporary oscell inspector, deleted —
`verify-cell-normals.ts` is the pattern): vertices within 4 m of the model origin at roof height — main pak
**150**, lab **0**; vertices at the sign's frame spot (+7.18, −7.30 model-local) — main 116, lab **351**. The
sign moved from the roof centre to its pole; nothing else in the cell changed by more than the lab's own known
LOD delta (96 483 vs 84 590 verts, the un-decimated lab bake — plan 007's caveat).

Not changed: `collectCellEffects` (2dfx of an `anim` model still ride the instance transform only — no `anim`
model in the stock corpus carries a 2dfx entry on a child frame; check before relying on it) and lod-common's
`clumpBoundingRadius` (direct frame, no hierarchy — the same one-level rule `buildClumpMesh` uses).
