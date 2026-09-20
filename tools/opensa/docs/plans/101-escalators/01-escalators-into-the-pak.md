# 01 — The entries reach the engine

Part of [101 — Escalators in OpenSA](readme.md). Depends on [00](00-recover-sa-behaviour.md). Lands in
`packages/cell-weld`, `packages/engine-formats`, `tools/opensa-pack`.

## Context

The escalator entry is decoded by `packages/renderware` and dropped on the floor: `cell-weld` collects
lights, particles and roadsign text from a cell's models and nothing else, and `OscellObject`'s kinds are
timed / breakable / animated / roadsign / uvScroll. Nothing carries a path into the pak, so the engine could
not run an escalator even if it knew how.

## Decisions

1. **A per-cell escalator table, not an object kind.** An escalator is four points and a flag, not a mesh
   with a transform — squeezing it into `OscellObject` would mean an entry whose `groupStart`/`groupCount`
   are meaningless. It rides beside `lights` and `particles`, which are the right precedent.
2. **Cell-local ENGINE coordinates**, like every other anchor in the format — the conversion happens once, in
   the welder, not in the engine.
3. **Points are model-local, so they take the instance transform** (`lod-common`'s policy calls this
   `space: 'model'`), and every placement of a model gets its own escalator. `escl_la` is placed four times;
   they are four escalators, not one.
4. **HD level only, for now.** Whether a far escalator needs to run is [02](02-moving-steps.md)'s measurement;
   welding it into the LOD bundle is a one-line follow-up if the answer is yes.
5. **Format version bump, additive.** A pre-101 pak simply has no table and the engine runs no escalators —
   the same absent-tolerant shape the particle lane already has.

## Tasks

- [ ] `OscellEscalator` in `engine-formats` (position, bottom, top, end, direction) + encode/decode + a
      round-trip test.
- [ ] `collectEscalators` in `cell-weld`, transformed per instance; wire it into the cell record.
- [ ] `opensa-pack` reports the count (`report.json`), the way it reports `roadsigns` and `particles`.
- [ ] **Check the staircase MESH survives the LOD bake**: `escl_la` is in the HD cell (`5,-6,hd`); confirm its
      triangles are inside `lod_5_-6` and, if a cull dropped them, decide whether that is right for a prop
      you can walk onto.
- [ ] Tests: a cell with two placements of one escalator model yields two entries with distinct positions;
      a cell with none yields no table.

## Verification

- The pak carries an escalator table with 6 entries on the stock map (4 × `escl_la` + `escl_singlela` ×2, plus
  the two LV models — the exact figure is the census, not a guess).
- No other cell content moves; HD bundles are otherwise byte-identical.

## Measurements / notes

_(record after implementation)_
