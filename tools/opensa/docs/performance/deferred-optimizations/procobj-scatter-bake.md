# Bake the procobj scatter, the way collision is now baked

**Status:** in reserve — opened 2026-08-05 by [200/3-01's runtime read](../../plans/200-platform-reach/3-off-main-thread/readme.md),
which took the COL bind off the map-collision path and left this one standing.

## What we do today

A cell's clutter (grass, rocks, cacti) is scattered **at runtime**, per cell, on the main thread:
`cellProcObjBatches` binds the cell's COL regions (`buildCollisionIndex` + `buildCellColliders`) and
`scatterProcObjects` walks every triangle of every placement, seeded by the cell coordinates, to decide what
grows where. The result is memoized per cell and drives BOTH the rendered clutter and its colliders, which is
what keeps them from diverging (the divergence that once cost 17 ms/step).

Since the collision bake landed, this is the reason a baked cell still touches the archive at all: the map
colliders come from `.oscol`, but the scatter re-derives its own from COL.

## The lever

Bake the scatter per GAME-grid cell into the pak, next to `.oscol` — the placements are deterministic from
(cell, rules, surfaces), so the converter can produce exactly what the runtime would.

## What it would win

The last per-cell COL work on the collision path, and with it `buildCollisionIndex` — a whole-archive COL
parse paid once on the first cell (part of the 78.3 ms `cell-collision-read` the boot frame measured before
the span was removed). Unmeasured in isolation: nobody has yet timed the scatter apart from the bind it
needs, which is exactly the number this entry is waiting for.

## What it would cost

- **The density knobs must stay live.** The cutoff (`procObjDensityOf`, `procObjLimit`) is applied AFTER the
  scatter, per category, and the debugger changes it at runtime. A bake must therefore store the full
  lottery-sorted placement list and keep the cutoff at runtime — bake the scatter, not the selection.
- A second per-cell payload in the pak, on the same grid, with the same trap (`docs/restrictions/architecture.md`).
- The render/collision single-source-of-truth has to survive the move: today ONE memoized scatter feeds both;
  a baked one must feed both as well, or the 17 ms/step divergence comes back through a different door.
- A re-pack — it is converter work, not a runtime switch.

## What would have to be true to pull it

- A capture showing the scatter (not the bind) on slow frames of a cold district entry, on a device that
  cares — i.e. the phone, once chain 2 lets it load a real district.
- The breakable-gate bake landed the same day (`.oscol` v2), so on a streamed run **this entry is already the
  only thing keeping an archive-wide COL parse alive**. Turning clutter colliders off is the A/B that would
  size it.

## Cheaper things to try first

- Turn the clutter colliders off (`clutterColliders: false`) — the config already allows it, and a renderer
  that draws no clutter must not collide it.
- ~~Bake the BREAKABLE decision into `.oscol`~~ — **done 2026-08-05** (v2): it removed the per-model DFF
  parse on the same path without a new payload or a new grid key. This lever is what is left.
