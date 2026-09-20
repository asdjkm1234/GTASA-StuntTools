# Session 22 (2026-08-17): `anim` frames in the cell LOD, and translucent clusters

**On `main`, 4 commits after `b7570246` (session 21's audit), tree clean, suite 492 files / 4 489 green /
0 skipped, tsc + eslint clean.** His order: one field bug in the OpenSA far view (the Burger Shot's sign in
the middle of the roof), then a re-report of the comet glass bug (the speakers back, from one angle). Both
reached the verdict through the one-model instruments and were **field-accepted the same afternoon**; he
then wiped `build/` and rebuilt everything fresh, so every tree on disk carries both fixes.

## What changed

| area | change | commit |
| --- | --- | --- |
| `tools/opensa-lod-generator` + `packages/game-build` | **An IDE `anim` def's atomics are placed by their DFF frame hierarchy in the cell merge.** `mergeCell` ignored every frame ("as the engine does for map atomics") — true of `objs`, false of `anim`: the engine's weld composes `frameWorldTransform` for those, so `burger01_LAw`'s sign (child frame at (7.18, −7.30, 1.01)) sat right in HD and jumped to the roof centre when the cell flipped to LOD. `ideRefs`/`ModelRef` and `CellInstance` carry `anim?` (the row's IFP name); the merge composes the atomic's frame transform ahead of the instance transform for those — the animation's rest pose, the same placement the `sa` target's `buildClumpMesh` bakes (sa-lod-generator plan 009 closed the mirror defect the same morning). Plan `tools/opensa-lod-generator/docs/plans/008`, the mirror rule in `restrictions/assets-and-data.md`, plan 002's line corrected | `11badf60` |
| `packages/renderware` (vehicle/model builder) | **A translucent material group is emitted per spatially compact CLUSTER** (`translucent-clusters.ts`: connected components by vertex position, pieces within 0.2 m merged, at most 8 per group; a connected sheet is unchanged), each its own submesh with its own AABB. The comet's `dials` was one translucent submesh of 960 tris holding the dash gauges AND the rear-shelf speakers — a 1.9 m box that no single sort key can serve: from a front-side eye its nearest point is the dash, so the whole thing drew after the rear quarter glass and the speakers read crisp (defect 3 of `open-issues/fixed/vehicle-glass-see-through.md`; the 08-04 AABB key was right for compact pieces and blind to this). `dump-vehicle-materials.ts` reads the split vehicle archives | `71674cd8` |
| docs | the issue's field verdict; the draw-cost note in `performance/deferred-optimizations/vehicle-submesh-draw-batching.md`; `debug/README.md` row | `0089a80e`, this |

## What it cost / what it bought

- **No pipeline run was spent on a verdict.** Burger: `model-repack.ts burger01_law` — rect `3,-7` (88
  models), LOD rebake 12.7 s + weld 4.0 s → lab pak. Comet: `vehicle-installer --rebake original --only comet`,
  seconds. His full rebuild came AFTER both verdicts, as the workflow rule wants.
- Burger, read straight out of the LOD cell `3,-7,lod` (a temporary oscell inspector; `verify-cell-normals.ts`
  is the pattern): vertices within 4 m of the model origin at roof height — main pak **150 → lab 0**; at the
  sign's frame spot — 116 → **351**. Field: "the burger is in place".
- Comet: translucent submeshes **69 → 86** (+17 draws per instance, blend phase only); the speakers are two
  submeshes with a shelf box (y −1.46..−1.34), the gauges theirs. Field, from the reporter's angle: "the
  speakers no longer show through". The split applies to every `.osm` the builder writes — props too (the
  ferris ring's UV-scroll strip is two clusters; its test now expects every cluster to name slot 0).
- Tests: `merge.test.ts` +1 (real burger fixture vs `buildClumpMesh`), `partition.test.ts` +1,
  `translucent-clusters.test.ts` new (5), builder +1. Suite 4 481 → 4 489.

## What the session settled

- The two targets now agree on `anim` clumps end to end: `sa` clone LOD (plan 009), OpenSA HD weld
  (`atomicFrame`), OpenSA cell LOD (plan 008). The one writer NOT touched: `collectCellEffects` — an `anim`
  model's 2dfx still ride the instance transform only (no stock `anim` model carries one on a child frame).
- A translucent sort key is a per-SUBMESH proxy; the honest fix for a scattered submesh is to make it not
  scattered. Third cause of one symptom in thirteen days — the issue file keeps all three, and the method that
  found each (read the roster out of the built `.osm`, compute the key for the user's eye).
- Two environment traps re-hit and now written where they bite: `serve:static` has to be RUNNING (a dead
  :3001 reads as "models/gta3.img not found"), and `?src=` must be ABSOLUTE (`http://localhost:3001/build/…`
  — a bare `/build/…` resolves against Vite and returns HTML).

## Left for session 23 (his order, unchanged)

1. `packages/validation` 001 → `apps/cutscene-converter` 001/002.
2. The GPU-pass regression `docs/open-issues/fixed/opensa-gpu-pass-regression-2026-08-17.md` — next step an UNCAPPED
   headless sweep on the fresh pak (his rebuild of 2026-08-17 evening).
