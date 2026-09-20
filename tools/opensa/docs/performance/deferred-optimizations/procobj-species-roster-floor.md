# Turning the clutter species-roster floor back off

**Status: the cost is TAKEN, deliberately, 2026-08-11.** See
[`sa-procobj-placement/012`](../../../tools/sa-procobj-placement/docs/plans/012-species-representation-floor.md).

**Impact: VERY LOW — measured on both targets, and one of them measures to nothing.** On `sa` it is **312
objects of 91 379 (0.34 %)**, i.e. 312 permanent rows off a `CBuilding` pool raised to 150 000, and zero
area-IPL slots. On `opensa` there is nothing to reclaim at all: four `country-dusk` legs put `avgDrawCalls`
at 821 in every arm and triangles +0.002 % against a 0.011 % same-side spread, because the floor SWAPS a
placement rather than adding one.

**Effort: very low.** Two config values (`procObjSpeciesFloor` and the host's `procobjFloor` default), no
code, revert in one commit. **This is the entry that shows why the two ratings are separate**: trivial to do,
worth nothing to do, and it costs 17.7 % of clutter cells a species outright — terrain that simply has no
cacti, with no warning. It is recorded as a deliberate cost for LOOK, not as a candidate.

## What we do today

Both targets guarantee that a patch of ground shows its whole species roster rather than probably-most of it.
The guarantee is per 250 u cell on both, but the two paths reach it differently, because what threatens a
species differs:

- **`opensa` (runtime).** `procObjCellBudget` — every MODEL eligible under the density knob keeps at least
  `procObjSpeciesFloor` placements when `procObjLimit` binds, **paid for** with the highest-lottery survivor.
  The drawn instance count is unchanged by construction. Host default **1**, `?procobjFloor=<n>`.
- **`sa` (bake).** `selectPlacements` — every model that scattered a CANDIDATE in the cell keeps at least
  `procObjSpeciesFloor` objects, promoted from its own lowest rejected lotteries. Nothing caps this path, so
  the threat is the density lottery rather than a budget, and the floor **adds** objects instead of swapping
  them. Config default **1**, `--species-floor <n>`.

## The lever

Set both floors to 0 — `procObjSpeciesFloor` in `ProcObjLodConfig` and the host's `procobjFloor` default.

**What it would buy:**

- **On `sa`: 312 objects of 91 379 (0.34 %)**, each a permanent text IPL row, so it is 312 rows off the
  `CBuilding` pool (raised to 150 000; the layer spends 91 379). It buys **no** area-IPL slots — the layer
  holds at 10 of SA's 40 either way — and no build time worth measuring.
- **On `opensa`: nothing measurable.** Four `country-dusk` legs, two per side:
  [the run](../../benchmarks/opensa-engine/2026-08-11-headless-procobj-species-floor.json). `avgDrawCalls` 821
  in every arm, triangles +0.002 % against a 0.011 % same-side spread, `gpuMs.pass` +0.52 % between the two
  pairs' own drifts of 0.30 % and 0.14 %. There is no instance count to reclaim, because the floor swaps
  rather than adds — only the per-cell-load CPU pass in `procObjCellBudget` (one extra prefix count, a
  grouping by model, and a sort of at most `procObjLimit` entries), which no capture has ever resolved.

**What it costs, which is why the cost is taken:**

- **17.7 % of clutter cells lose at least one species outright** on the shipping rule set — worst cell 16 of
  23 models placed, seven gone at once. It reads as terrain that simply has no cacti, and nothing warns.
- The two targets stop agreeing about what a patch of ground contains: a baked static row cannot be capped,
  so `sa` behaves as if the floor were on whatever this value says.

**What would have to be true to pull it:** the clutter layer would have to be over budget somewhere it is
measurably not — P1 found no frame-time ceiling for it at all, and this lever is 0.34 % of one target's
object count and zero on the other's frame. **It is recorded because it is a deliberate cost for LOOK, not
because it is a candidate.** If the `CBuilding` pool or SA's 40-slot array ever became the binding constraint,
312 rows is the first thing to look at and the last thing worth taking.
