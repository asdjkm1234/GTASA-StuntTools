# 01 — Baked directional sun shadows, second attempt (deferred from 074/07)

**STATUS: DRAFT** — part of the [04-graphic-improvements](readme.md) idea bundle (0.6.0). Moved here from
roadmap/0.5.0/plans/03 on 2026-07-17; to be thought through properly later — nothing scheduled.

Deferred on 2026-07-12 (user decision after a same-day build → field-test → revert cycle). The own engine
ships the SCALAR baked sun-visibility (074/07 v1, field-accepted); the DIRECTIONAL version — static shadows
that track the moving sun — was built, produced unacceptable noon artifacts, and was reverted.
**The prerequisite that must be solved first is written in bold below; everything else already exists.**

Related 2026-07-17 context: the plan-16 SSR + contact-shadow build was also rolled back the same cycle
("different approach for the next iteration") — vehicle/dynamic-entity shadows are an OPEN question this bundle
should answer together with the static ones (prod grounds its cars via CSM; we deleted CSM by design).

## What was tried (the full 2026-07-12 record)

1. **v1 scalar (SHIPPED, still the shipping consumer).** Per-vertex elevation-weighted average visibility
   over the day arc, stored in `normal.w`, gating the direct N·L term. Soft static darkening under
   bridges/canyons. Field-accepted twice; does not track the sun.
2. **v2 directional (BUILT AND REVERTED).** Insight: with the arc's azimuth fixed per elevation, per-vertex
   visibility is (almost always) a THRESHOLD function of sun elevation. The bake scanned 8 ascending
   elevations (×2 sun-disc jitter) for the first-lit crossing + a penumbra spread; runtime =
   `smoothstep(threshold ± softness, currentElevation)` — one ALU op, no shadow map, no jitter.
   Storage without a format bump: threshold → `normal.w` (/1.1 encoding, 1.1 = never lit), softness →
   layer-u16 bits 8–14, current elevation → spare `sunDir.w`. The full design + encoding survive in
   [074/07](../../../../plans/074-opensa-engine/07-baked-channels.md).
3. **Fixes that landed during the field rounds and STAY shipped:**
   - sliver-occluder filter (triangle area < 1 % of longestEdge²) — power lines / cables / railing bars
     no longer cast (they inflated into zigzag blotches across ground polys);
   - LOD cells bake both channels against the HD BVH with a 0.6-unit ray push-off — kills the
     "sidewalk shadowed, road not" HD/LOD seams;
   - the sun arc's azimuth converges to zenith as it climbs (`azimuthScale = 1 − 0.75e`, bake and
     environment drivers MIRRORED — change one, change both) so noon shadows sit under their casters.

## Why v2 failed: the receiver mesh, not the math

Five noon field screens, one root cause: **per-vertex baking samples occlusion only AT VERTICES, and SA's
ground meshes place vertices metres — often tens of metres — apart.** Consequences observed:

- a bridge narrower than the road's vertex spacing casts NO shadow at all (every receiver vertex sees the
  sun, the deck "falls between" them);
- where some verts are shadowed and neighbours are not, interpolation across giant polys produces
  hole-shaped artifacts, diagonal smears and blobs instead of a crisp band;
- LOD meshes (coarser still, and offset from the HD surfaces) self-darken.

The scalar v1 survives on the same meshes only because averaging is forgiving; a threshold flips hard.
The 066/03 spec itself assumed baking over map-optimizer WELDED meshes — i.e. it never promised to work
on raw SA tessellation.

## **The prerequisite: densify the receiver mesh in the converter**

**Before un-parking this, `opensa-pack` (or its pmb successor) must SUBDIVIDE large receiver polygons so
shadow-relevant surfaces carry vertices on a ~2–4 m grid.** Formulated precisely:

- subdivision happens at WELD time (scratch rows), before the bakes — bakes and formats need no changes;
- target: no ground/road/wall triangle with an edge longer than ~4 m in the horizontal plane (walls: ~4 m
  vertically too); steep-slope and interior faces can keep coarser grids;
- vertex growth is the cost to measure: LS rect ≈ 3.1 M verts today; a naive 4 m grid on ground planes is
  a ×2–4 multiplier — needs the bench ritual + streaming re-check (cell sizes grow);
- prelit/night/AO channels interpolate today anyway, so subdivided verts inherit by interpolation — only
  the sun-vis threshold NEEDS the density; consider densifying ONLY horizontal-ish receivers first.

## Alternatives considered (recorded, not chosen)

- **Texel-space baking (lightmaps):** solves density per-texel, but is a whole new pipeline (UV2 atlas,
  lightmap textures, format bump) — the heaviest option; revisit if subdivision proves insufficient.
- **Dynamic near cascade (074/08):** renders real-time shadows near the camera for dynamics anyway; could
  cover statics near-field, and is the ONLY answer for small casters (lamp posts, sign gantries — a 30 cm
  post needs ~20 cm receiver spacing; vanilla SA statics don't cast these either).
- **Tuning v2 thresholds/softness:** tried in the field rounds; does not address the sampling gap.

## When picked up

1. Land converter-side receiver subdivision behind a flag + bench (vertex growth vs streaming/GPU budget).
2. Re-enable the v2 consumer (code is one commit away; design in 074/07) and re-run the same noon field
   scenes that killed it: bridge over canal, wide freeway bridge, building side-streets, LOD ring.
3. Only then consider the near cascade for small casters.
