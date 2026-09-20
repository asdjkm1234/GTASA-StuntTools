# Convert only the map objects a district actually places

**Status:** in reserve — opened 2026-08-06, from a phone convert where this stage owned the wait.

## What we do today

`packMapObjects` walks **every unique model name in the IDEs** — 14 269 on stock SA — regardless of the
`--rect` the run was given. On the 2026-08-06 phone convert of a 2×2-cell district it was the single longest
stage by a wide margin: after ~28 minutes it stood at 35 % with an ETA of another ~52. Everything before it
(breakables 197+55, clutter 56 species, props 352, anim objects 54, peds 2 of 299 with `--peds`) finished in
minutes.

The other per-class subsets already exist: `--vehicles` and `--peds` (plan 097, 2026-08-06). Map objects are
the class that still has none, and on a district build most of what it converts is somewhere else on the map.

## The lever

Pass `packMapObjects` the models the converted rect actually places — walk the world grid for the rect (plus a
one-cell margin, since an instance welds into the cell of its PIVOT and its geometry reaches past it) and
convert that set.

## What it would win

The dominant share of a district convert's wall time. Unmeasured as a ratio — nobody has run the same rect
with and without — but the stage is ~90 % of the run's tail on the phone, and the placed set for a 2×2
district is a small fraction of 14 269.

## What it would cost

- **The failure mode is not "slower", it is a crash on the target device.** A map object with no `.osm` in the
  pak falls back to the archive's `.dff`/`.txd` — in their ORIGINAL format. On an `--rgba8` pak for a GPU
  without BC, a model missed by the subset is a model that cannot be displayed at all. The same trap the
  `--vehicles` subset has, except here the runtime reaches for the model by itself rather than a spawner
  doing it, so no URL flag can gate it.
- Therefore the selection has to be provably complete: pivot-cell membership is NOT enough (geometry reaches
  past the grid rect by a measured mean 141 u / max 799 u on gostown — plan 087), interiors and script-loaded
  IPL groups place models too, and the debugger resolves models by name on demand.
- A district pak built this way is district-only by construction — reusing it for a wider rect silently
  misses models.

## What would have to be true to pull it

- A completeness test with teeth: convert a rect with the subset and without, then diff the pak's model set
  against every model the rect's cells (plus margin, plus `extraIpl`) reference. The subset may only ship
  when that diff is empty on a real game dir.
- Or the runtime stops being able to fall back silently: if a missing `.osm` on an `--rgba8` pak reported
  itself instead of loading a BC dictionary, the cost of an incomplete subset would be a message rather than
  a crash — which is the cheaper half to build first, and useful on its own.

## Cheaper things to try first

- `--no-models` when the run only needs the world (the phone workflow already offers it, and then only the
  map surface is usable).
- The pack's existing worker pool — this stage is per-model and embarrassingly parallel; whether it already
  uses the pool for map objects has not been checked.
