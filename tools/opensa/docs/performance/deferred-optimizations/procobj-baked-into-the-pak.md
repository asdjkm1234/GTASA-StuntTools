# Baking the procobj clutter into the OpenSA pak

**Status: DEFERRED 2026-08-10** — the runtime path was chosen deliberately, so this is the lever we gave up and
what it would cost to take back. See
[`sa-procobj-placement/014`](../../../tools/sa-procobj-placement/docs/plans/014-permanent-rows-no-lod-twins.md).

**Impact: VERY LOW on frame time — this lever is about LOOKS, and it costs performance rather than buying
it.** The two named wins are contact AO on clutter (a visual term the instanced path has nowhere to keep) and
no per-cell scatter at stream-in, which has never been measured and has never appeared in a `hitch` column.
Against that, taking it back means **91 092 vertex-duplicated instances** in a pak already carrying 105.8 M
HD vertices, whose AO bake ran **1.01 G rays / 21 minutes** — and density stops being a runtime knob, which
is exactly what made the layer unmeasurable last time. **The only reason to pull it is a field verdict about
the missing contact darkening**, not a frame.

**Effort: medium to reinstate, high to do PROPERLY.** The bake path existed and was removed, so emitting
placements into the common build again is the smaller half. The larger half is condition 3 at the bottom — a
density knob that survives the species strip. Without it this is a straight revert to the state where clutter
density could not be measured in the field at all, which is the thing that made the last attempt unmeasurable
rather than merely expensive. **The honest cheaper alternative — a per-instance AO byte on the instanced path,
sampled from the cell's own baked field — is low effort** and buys the visible half without any of this.

## What we do today

The build-time bake runs **only for the `sa` target**. On `opensa` the stage does not run at all, so
`procobj.dat` reaches our engine with all 95 rules and `GtaSaWorldAdapter.cellClutter` scatters them per streamed
cell — the same memoized scatter the colliders read, drawn instanced (one geometry upload per model TYPE, ~48 of
them) through `engine-clutter.ts`.

Before this, the same 91 092 objects were baked into the pak as ordinary instances, and the bake **stripped the
baked species out of `procobj.dat`** — which is why the shipped runtime scatter had been down to 9 rules of 96,
all underwater, and why clutter density stopped being measurable in the field at all (plan 013's perf budget had
to invent a two-pak A/B to get any load step).

## The lever

Bake the layer into the pak for `opensa` too, as before: emit the placements into the common build so
`packGameDir` welds them into cells.

**What it would buy:**

- **Baked AO.** `ao.ts` hemisphere-raycasts every HD vertex (12 samples, 60 u max) and writes the fraction into
  the `.oscell` `aoSkyVis` byte. Runtime clutter is instanced and has nowhere to keep a per-instance value, so it
  loses the contact darkening under trees and against walls. In the open — where most clutter is — sky visibility
  is ~1.0 anyway, so the visible difference is confined to shaded ground.
- **No per-cell scatter cost at stream-in.** The scatter walks collision faces per cell; baked placements arrive
  already positioned.

**What it costs, which is why it is deferred:**

- **The pak welds per instance.** `ao.ts`' own note: welding duplicates verts per instance/part. 91 092 baked
  clutter objects are 91 092 copies of geometry, against a pak already carrying 105 815 501 HD vertices, and the
  AO bake over that took **1 012 669 128 rays / 21 minutes**. The runtime path uploads ~48 geometries.
- **Density stops being a runtime knob**, which is the thing that made it unmeasurable last time.
- **The strip comes back.** A baked layer must remove its species from `procobj.dat`, or the runtime scatterer
  doubles them — and that strip is what silently reduced the shipped rule set to 9.

## What would have to be true to pull it

1. A measured frame-time cost for the runtime scatter at stream-in that is worse than the pak's size and bake
   time — measured with the `hitch` columns, not asserted.
2. A field verdict that the missing contact AO on clutter is visible enough to matter. The honest cheaper
   alternative first: give the instanced path a per-instance AO term (one byte per instance, sampled from the
   cell's own baked field), which keeps the geometry sharing.
3. A density knob that survives the strip — e.g. baking at build time while leaving `procobj.dat` intact and
   suppressing the runtime scatter by species at runtime instead.

Until then the runtime path is the cheaper side of both trades, and it is the one that keeps the measurement
possible.
