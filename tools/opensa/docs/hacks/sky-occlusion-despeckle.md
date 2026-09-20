# The sky-occlusion despeckle (a median lift with a slack)

**What it is.** Two passes of a neighbour-median lift over a vehicle's baked per-vertex sky occlusion, with
`DESPECKLE_SLACK = 25` (unorm8) and `DESPECKLE_PASSES = 2` —
`packages/renderware/src/vehicle/sky-occlusion.ts`. A vertex more than the slack below its triangle
neighbours' median is lifted to that median; bright vertices are never pulled down.

**What it stands in for.** A height field that does not know what a thin ornament is. The bake marches a
32×32 height grid, so a bonnet star, a wiper or an aerial rasterizes as a WALL in whichever cell it occupies,
and only the handful of vertices whose march crosses that cell at close range see it. The honest fix is to
march against the mesh (or to exclude thin geometry from the field), not to clean up after the field.

**What it was judged on.** The field: admiral speckles and comet door artefacts, 2026-07-23 (plan 085). The
two-pass count has a stated reason — one pass clears lone vertices, the second the 2–3-vertex clusters — and
the slack has one too: real cavities darken in PATCHES, so the neighbours are dark as well and the median
follows them, which is what leaves genuine gradients alone. Neither number was swept.

**What would retire it.** Marching against the actual triangles instead of a height field, or classifying
thin geometry out of the field before the march. Both are more expensive; the bake already costs seconds per
car.

**Blast radius.** Every vehicle's night indirect and its 090-era reflection gate. It is also load-bearing for
a lesson learned the hard way: the remaining noise is what made "tag the cabin by thresholding occlusion"
produce speckle — **the despeckle does not make the bake clean enough to threshold**. 23 % of the previon's
seat vertices still sit at 0.8–1.0 while the rest are at 0.2–0.5. See
[`postmortem/090-vehicle-cabin-at-night.md`](../postmortem/090-vehicle-cabin-at-night.md).
