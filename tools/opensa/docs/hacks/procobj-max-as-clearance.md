# `procObjMax = 100000` — a cap set so it cannot bind

**Taken 2026-08-09**, in `tools/sa-procobj-placement/src/config.ts`.

## What it stands in for

A **measured streaming/perf budget for the clutter layer**, which does not exist yet. The number that belongs
here is the one [`013 — density budgets, per target`](../../tools/sa-procobj-placement/docs/plans/013-density-budgets-per-target.md)
has to measure in our own engine (and separately in real SA); until it does, any value would be a guess
wearing a measurement's clothes.

So the cap was set to a number chosen for one property only: **it must not bind.** The layer places 91 092
objects at the authored density, and 100 000 is 1.10× that.

## Why not just leave it at 20 000

Because 20 000 was itself a number from the same missing measurement, and after the `procobj.dat` column fix
it silently became the thing every experiment would measure: it dropped **78 %** of the layer, and the cut is
global and lowest-lottery, so a per-category profile below it would have DISPLACED other categories instead
of adding to its own. A field verdict taken there would have been a verdict on the cap.

## What it was judged on

Nothing but arithmetic — it is deliberately not a judgement. The one thing it was checked against is the
build's own `CAP DROPPED n` line, which reads 0 on the shipping build, i.e. the cap is provably inert.

## What retires it

`013`'s `opensa` perf budget: a measured count the engine streams without hitching, per cell and map-wide,
with `procObjMax`, the candidate ceiling and the per-cell `procObjLimit` all set from it. `country-dusk` is
the bench scene that moves when clutter does (+12.6 % frame at the recovered density), so it is the scene the
budget is taken on.

## What else moves if it changes

- **The per-category density model** ([010](../../tools/sa-procobj-placement/docs/plans/010-density-model.md)
  decision 8): a knob is only LOCAL below this cut. Lower the cap and boosting bushes starts displacing rocks.
- **The `sa/` int16 gate.** Objects drive permanent text rows (currently 0.281 rows/object), and the map is
  already over int16 — so lowering this cap is also, accidentally, the crudest way to get a full `sa/` build
  to complete. That is not what it is for, and a profile that needs it should say so instead.
