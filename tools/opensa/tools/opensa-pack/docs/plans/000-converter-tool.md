# 000 — Converter tool (the founding plan; was 074·03)

[← tool plans](readme.md) · chain context: [074 readme](../../../../docs/plans/074-opensa-engine/readme.md) ·
prev: [074/02 formats](../../../../docs/plans/074-opensa-engine/02-native-formats.md) ·
next: [074/04 lab+P0](../../../../docs/plans/074-opensa-engine/04-engine-lab-p0.md)

Moved from `docs/plans/074-opensa-engine/03-converter-tool.md` on 2026-07-17 — opensa-pack now owns its
plan folder (user decision); the 074 chain keeps the cross-cutting docs (02 formats, 07 baked channels,
12 stochastic, 14 pmb integration) because each spans the tool AND the engine.

Game-ready file set → `.ospak`. Sits AFTER the whole existing chain (map-optimizer prelight → lod-generator →
installer output); consumes the exact files the prod web app loads (gta3.img + IDE/IPL + timecyc), so the new
format inherits prelight, LODs, merges and mods automatically. Existing tools never learn about it.
Composition-first: parsing = `@opensa/renderware`; grid/cell assignment = the same IPL logic the engine uses.

## Pipeline stages (deterministic, per-cell parallelizable)

```
load game set → resolve cells (HD + LOD levels, IPL targets — existing logic)
  → per cell: gather models → mergeable predicate → weld into groups → per-vertex layer assignment
  → texture collection → CLASSIFY α → process α subset → bucket into arrays → emit .ostex
  → emit .oscell (+ object/light tables) → pak writer + manifest → budget report
```

### The mergeable predicate (from 066/02, finalized here)

Merged into groups: plain static geometry (the ~90 % single-placement world + repeated props — instances get
their transform BAKED into vertices at convert time; no runtime instancing needed for statics).
Kept as ObjectRecords: `timed` (on/off hours), `breakable` (must vanish independently), IDE-`anim`, roadsign
text, 2dfx anchors. DoubleSided (0x200000) merges into `side=double` groups — never mixed with front-side.
Implementation status: `timed` and 2dfx-light anchors are live; IDE-`anim` currently welds into the plain
STATIC groups at bind pose (2026-07-12 field fix, 06 row 17 — skipping deleted whole buildings), and moves
to ObjectRecords when plan 08 promotes them to animated entities; `breakable`/roadsign kinds land with
plan 08 (see its coverage matrix).

### The ALPHA PIPELINE (early, M0 — this is where [alpha-edge](../../../../docs/open-issues/fixed/alpha-edge.md) dies)

1. **Classification** per texture (decoded alpha histogram): `opaque` (all 255 — pass through untouched),
   `cutout` (bimodal: leaves/fences/gratings), `softBlend` (everything else). Manual override list in the
   config for the inevitable dozen weird ones.
2. **Edge dilation** on the base level: flood transparent texels' RGB from nearest opaque (full BFS — the
   capped-pass variant left gaps; both learned in the open issue, decoder already exists).
3. **Premultiply** RGB by alpha.
4. **Mip chain offline**: alpha-weighted downsample (transparent texels contribute nothing to RGB) + per-mip
   **coverage preservation** for cutouts (scale each mip's alpha so the % of texels passing `cutoutRef` matches
   the base level — the classic fix for foliage thinning out at distance).
5. **Re-encode**: BC3 in v0 (own encoder or wasm — options: `bc7enc_rdo` wasm build, `basis_universal` CLI,
   or hand-rolled BC3 [we already have the decoder; the encoder is ~200 lines]). BC7 = v1 upgrade, measured.
6. Odd-size textures (62×62 …): resample to nearest pow2 BEFORE the above (kills WebGPU BC alignment forever).

**Acceptance for this stage is VISUAL + automated**: the harness renders vgsebushes / Upt_Fence_Mesh / fence_64
against a mid-grey background and diffs edge luminance vs the known-bad baseline; plus "no black halo" manual
sign-off at M0.

### Texture-array bucketing

Group by (W, H, format, wrap-compat) → assemble arrays (cap layers at device limit margin, e.g. ≤ 256/array).
Assignment is GLOBAL (arrays shared across cells — a district reuses a handful of arrays), manifest records the
mapping; per-vertex layer indexes written during group weld. Report: array count, fill rates, orphan textures.

### Budget guards + determinism (pmb spirit, non-negotiable)

Config caps: max bytes/cell, max groups/cell (HD 8 / LOD 4 to start), max arrays, max layers. Exceeding FAILS
the build with the offending cell listed. Fixed ordering everywhere (sorted inputs, no map-iteration
nondeterminism); same input ⇒ byte-identical pak (hash-tested in CI).

## CLI shape

`opensa-pack --game <dir> --out <dir> [--cells x0,y0,x1,y1] [--district ls] [--report] [--only-textures]`
— district/rect filtering is what makes M0 (one district) and incremental work cheap; `--report` emits the
measurement ledger tables (bytes, groups, arrays) the plan docs consume.

**Bake defaults (revised 2026-07-17, user decision): AO/skyVis is ON by default** — it stands in for
prod's SSAO, so a default pak must carry it; `--no-ao` skips it for fast iteration reconverts. **The
heavy SHADOW bake (sun-vis) stays opt-in behind `--bakes`**: bench-ritual,
field shadow checks and production/flip paks MUST pass it — without it the direct sun renders
unshadowed (bridges/canyons) by design. History: 2026-07-13 both bakes went opt-in for iteration speed
(bakes were ~90 % of convert wall-time); AO returned to default-on when it became the engine's only AO
story (no runtime SSAO exists).

## Tasks

**CLOSED 2026-08-11 — the list had been stale since the tool shipped.** Every box below was still unticked
while `opensa-pack` was building a 1 167 MB / 1 124-cell pak on every run, so anyone scanning the repo for
open work found ten phantom items at the top of it. Ticked against the code that satisfies each, not by
assumption; the one that is only PARTLY satisfied says so rather than being ticked.

- [x] Scaffold `tools/opensa-pack` (nx package; deps: renderware parsers + engine-formats).
      `@opensa/opensa-pack`, ~50 source modules, 22 test files.
- [x] Cell resolve + gather (reuse grid/IPL logic; unit tests against a fixture district).
      `pack-map-objects.ts` + its test; the grid is the one every tool shares.
- [x] Mergeable predicate + group weld + per-vertex layer assignment. `packages/cell-weld` is now its own
      package; `model-osm.ts` / `model-ostex.ts` carry the layer assignment.
- [x] α classification + override config + histogram tests on real textures. `model-ostex.ts`, and the class
      is baked per texture for good — the rules and their consequences are
      [`edge-cases/converter-pipeline.md`](../../../../docs/edge-cases/converter-pipeline.md); the defect it was
      written to kill is closed ([`alpha-edge`](../../../../docs/open-issues/fixed/alpha-edge.md)).
- [x] Dilation + premultiply + alpha-weighted mips + coverage preservation. In `packages/cell-weld/src/alpha.ts`
      and `model-ostex.ts`; this is the pipeline `alpha-edge` was fixed BY CONSTRUCTION with, field-confirmed
      2026-07-11.
- [x] BC encoder — decided and implemented. `packages/renderware/src/textures/dxt.ts`; BC1 is what took
      `comet.osm` 136.6 → 20.3 MB in the vehicle-array work.
- [x] Pow2 resample for odd sizes. `resampleToPow2` (`packages/cell-weld/src/alpha.ts`), with the 62×62 case
      named in its own test — "the WebGPU BC alignment killer".
- [x] Array bucketing + manifest + pak writer + `--report`. `cli.ts` writes `world.ospak`, `manifest.json`,
      `water.bin` and `report.json` to `<out>/pak`; bucketing by size is the shipped
      [texture-array policy](../../../../docs/performance/applied/vehicle-texture-array-buckets.md).
- [~] Determinism + budget-guard failure tests — **PARTLY, and the gap is named rather than ticked.** Per-baker
      determinism is tested (`ao.test.ts` "same input ⇒ identical values") and `no-data-loss.test.ts` guards the
      conversion, but there is **no whole-run double-run hash test**, and the budget guards that exist live in
      `perfect-map-builder`, not here. Whoever needs one should write it against a fixture district; nothing
      currently depends on it.
- [x] M0 run: one LS district; ledger filled. Long since superseded by whole-map runs — the current build is
      **1 124 cells / 1 167 MB**, recorded per build in `report-opensa.json`.

## Measurement ledger

(convert time, pak size vs source slice, groups/cell histogram, array fill rates, α-subset size)
