# 002 — Exclude sibling-generated LODs from sa/opensa

**Status: ✅ Implemented.** Stop the final sa-lod / opensa-lod stages from re-processing the LODs that lod-trees /
lod-procobj already produced earlier in the pipeline.

## Problem

In the perfect-map chain, lod-trees and lod-procobj run **before** sa-lod / opensa-lod and emit their own finished
LODs/impostors (`lodtrees.ide`, `lod_procobj.ide` + `lod_procobj.ipl`). Because sa-lod resolves HD→LOD links from
**every** IDE/IPL under `data/`, and opensa-lod bakes/strips every `lod*`, they would re-clone or re-bake that
sibling content — double far-view geometry (z-fighting, streaming pressure) and, in one case, an in-game crash from
a `lod_procobj` LOD whose TXD got repointed to a `salod*` atlas it wasn't in.

## Fix

A shared `excludeItems: readonly string[]` (lowercased model names, HD **and** LOD) on both generators' `LodConfig`,
supplied by the pipeline:

- **sa-lod** (`resolve.ts`): skip any HD→LOD link whose HD or LOD is in `excludeItems` (new `excludedGenerated`
  count); drop excluded models from the hole-fill set too. (A txd-name heuristic — `lod_procobj`/`lodtrees` — also
  guards resolve as a fallback.)
- **opensa-lod**: `resolveCells` doesn't bake excluded models into cells; `stripOldLods` doesn't strip them (they're
  `lod*`-named, so it would otherwise delete `lodsand_josh1` etc.).
- **pipeline** (`collectGeneratedModels`): after the common chain, reads `lodtrees.ide` (+ the SA tree roster),
  `lod_procobj.ide` and `lod_procobj.ipl` from the baked build and passes the union to `buildSaLods` /
  `buildOpensaLods` as `excludeItems`.

## Scope note (measured)

For the **sa build** this is mainly correctness/hygiene: sa-lod already excludes trees (`SA_TREE_MODELS`) and the
procobj LODs (txd), so the explicit list changed the clone count by ~0 (4257 → 4257). The real-game load cost is
dominated elsewhere (sa-lod's HD-clone footprint; the ~30k materialised procobj instances). For the **opensa build**
it's a genuine fix (no re-bake, no wrongful strip). See the `lod-detection-name-vs-target` memory.

## Tests

`sa-lod-generator/resolve.test.ts` — excludes a link whose LOD txd is a sibling atlas (`lod_procobj`/`lodtrees`) and
one supplied via `excludeItems`.
