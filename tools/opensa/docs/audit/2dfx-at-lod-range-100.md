# Audit — plan 100: 2dfx survives to LOD range (2026-08-08)

Five steps, one day, 11 commits. Chain and per-step ledgers:
[`docs/plans/100-2dfx-at-lod-range/`](../plans/100-2dfx-at-lod-range/readme.md), with 01/02/05 moved into
[`lod-common/007`](../../tools/lod-common/docs/plans/007-2dfx-space-and-cell-carry.md),
[`opensa-lod-generator/006`](../../tools/opensa-lod-generator/docs/plans/006-cell-bake-carries-effects.md) and
[`sa-lod-generator/007`](../../tools/sa-lod-generator/docs/plans/007-clone-2dfx-policy.md).

**The defect:** the three 2d-effect types our engine consumes — 0 light, 1 particle, 7 roadsign — were
gathered from HD models only, so between the HD ring (~440 u with hysteresis) and the LOD ring (1000 u) a
district drew dark, smokeless and with blank street-name plates while its baked LOD kept rendering. On top of
it, one flat `DRAW_DISTANCE = 300` overrode every fx system's authored `cullDist`.

## What it cost

| | Lines |
| --- | --- |
| Product code (`.ts`, excluding tests) | +437 / −105 |
| Tests | +427 / −37 |
| Docs | +579 / −264 |
| **Total** | **+1522 / −406**, 38 files |

One new module (`sa-lod-generator/clone-2dfx.ts`, 35 lines) and one new kept debug script
(`scripts/debug/two-dfx-space.ts`, 132 lines). Test count 3848 → 3871 (+23); suite, tsc and lint clean
throughout.

## What it bought

- **Lights, emitters and plates now ride a cell LOD.** Projected over the stock map from twelve real cells
  baked in-process: 22 366 lights, **878 emitters**, **489 plates**, the last two new. Per entry — light
  100 B, emitter 44 B, plate 108 B — about **89 KB** of new 2dfx payload in the cell DFFs.
- **Every fx system draws for the distance it authors.** 836 of 878 anchors got 3–12× TIGHTER (`vent` 300 →
  25, `fire` 300 → 35, `insects` 300 → 100); 42 smoke anchors got the host's LOD radius. Two departures, two
  `docs/hacks/` files.
- **One 2dfx keep-set instead of five.** The policy is now the single answer for both LOD generators and all
  three of `sa-lod-generator`'s clone paths, and it carries the coordinate SPACE a carrier cannot work
  without.

## What it did NOT buy, and the honest gaps

- **No measurable frame win**, and the claim cannot be made in either direction. A positive control —
  `fxDrawDistance` forced to 0, every emitter quad collapsed — gives `country-dusk` a GPU pass of 3.880 ms
  against the A/B's 3.867 (before) and 3.875 (after). The bench cannot see the particle system at all, so
  "no regression" would have measured nothing. Only `avgTriangles` moves: `lv-night` −2890 of 2 049 828
  (−0.14 %). Rows:
  [`2026-08-08-ingame-fx-cull-distance.json`](../benchmarks/opensa-engine/2026-08-08-ingame-fx-cull-distance.json).
- **The FIELD CHECK is owed to the chain's single rebuild.** The pack's LOD input is a `.work` intermediate
  the pipeline deletes as it consumes it (the built `lods.img` holds `.osm`, the pack's OUTPUT), so no built
  tree can be asked whether a chimney smokes at 600 u. Three things ride on that one run: the visual check,
  the look verdict for both hack files, and confirmation that nothing doubles at the transition distance.
- **Step 05 fixed nothing that was broken.** Its premise — the decimate path loses emitters — was already
  false: `keepParticles` has defaulted to true since `03-asi/010` and the old code appended them. Its real
  value is consolidation; its measurable output change is entry ORDER, for 6 of 1851 fx-carrying models.

## Three things the plan did not know, all found by measuring

1. **A plate's world position lands outside its instance's own cell 131 times in 489.** The plan said a LOD's
   effects come from the LOD model; for roadsigns that would have filed the same plate under two cell keys
   (the LOD bake's cell vs the HD pre-pass's world cell), which the streamer's one-level-per-slot rule does
   not cover — a doubled plate at any ordinary standing position. LOD roadsigns therefore keep coming from
   the world-keyed pre-pass. Now a [restriction](../restrictions/assets-and-data.md).
2. **Steps 01 and 02 could not ship apart.** `opensa-lod-generator` reads `keepTypesFor('cell')` directly, so
   flipping the policy table changes bake output in the same commit — including routing a world-space plate
   through the instance transform, the exact kilometre bug the chain's research had found. The step doc
   claiming "no generator output moves on this step alone" was a hypothesis about code it had not read.
3. **All four `prt_*` systems author `cullDist` 50**, so honouring the table cut the vehicle-effect lane's
   reach from 300 u to 50 u. Authored, and the step's own rule — but it means another car's tyre smoke now
   stops at 50 m, and that wants a field look. **Closed 2026-08-08 (the user's call): 300 is back as a floor
   on the dynamic LANE — [hack](../hacks/vehicle-fx-lane-reach.md).**

## What the audit itself turned up

- **`graphics.effects.drawDistance` is dead config.** It is defined in `game-runtime-config.ts` (150) and has
  a debugger slider, and **nothing on the own engine reads it** — a leftover of the plan-044 three-renderer
  lane. `docs/features/world-effects.md` claimed it "REPLACES each system's authored CULLDIST", which was
  false before this chain and is doubly misleading after it. The doc is corrected; the knob is left for the
  user to decide between wiring and deleting. **Decided 2026-08-08: wired.** It is now
  `graphics.effects.drawDistanceScale` (default 1) — a multiplier over each system's shipped distance,
  applied last inside `fxDrawDistance` and carried in on `rebuild(scale)`, so the authored table still
  decides the SHAPE and the knob only stretches it.
- **`sa-map-viewer` is the second `weld.ts` consumer** and the doubling argument had only been checked
  against the engine's streamer. It holds: `CellRenderer.setCells(coords, lod)` makes exactly one level
  resident and unloads everything outside the wanted set, so the viewer cannot mix levels either.
- Three feature docs carried claims this chain falsified (`map-pipeline.md`'s "2dfx corona collection (HD
  only)", `roadsign-text.md`'s "the HD cell its world position falls in", `world-effects.md` above).

## Method notes worth keeping

- **The positive control is the finding.** Two A/B arms 0.2 % apart look like "no cost"; only culling
  everything proves the instrument is blind. Any A/B whose arms land inside noise needs one.
- **Doubt the rig.** The first offline weld reported zero LOD effects — not a defect in the change but two rig
  faults in a row: `loadMapDefsAt` does not run `markCellLods`, and the built `lods.img` holds `.osm` rather
  than the DFFs the weld reads. Both were found by dumping what the probe was reading, not by reasoning.
- **A green suite can be silent.** `sa-lod-generator` had no test touching 2dfx at all, so nothing it did with
  entries had ever been asserted. Check whether the counted thing could happen before reading a pass as
  evidence.
