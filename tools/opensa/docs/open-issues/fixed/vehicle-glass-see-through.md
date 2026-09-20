# Cabin elements draw OVER the car's glass (comet) — two defects, one symptom

**Status: ✅ FIXED 2026-08-04, field-verified the same day from the reporting user's own angles.** The car:
the gostown comet (a 1984 Porsche 911 Targa mod with a fully modelled interior). Reported as "the speakers
show through the rear glass; the gauge cluster shows through the side glass" — the interior read CRISP,
un-dimmed, as if painted on top of the window.

The lighting half of the modelled-interior story ([vehicle-cabin-lighting.md](../vehicle-cabin-lighting.md),
the previon symptoms) is a different family and stays open.

## Why it took two fixes — the second defect masked the first

The first fix alone changed nothing visible, and the user's re-report after a rebake is what surfaced the
second defect. Recorded because the shape is general: when a symptom survives a correct fix, the next
hypothesis should include "a SECOND cause with the same symptom", not only "the fix is wrong".

### Defect 1 — classification: an opaque part on an alpha ATLAS landed in the blend phase

The mod maps its parcel shelf, gauge housings and lamp bodies onto `911_lights`, whose only transparent
texels are the lamp glass. Our `translucent = color[3] < 250 || textures.hasAlpha(material)` asked the
question per TEXTURE, so every one of those opaque parts joined the no-depth blend phase (the world showed
through the shelf; 9 submeshes on this car). SA never asks: it draws one pass with z-write on and an alpha
ref, so an opaque texel occludes whatever texture it sits on.

**Fix:** translucency is judged over the submesh's own UV region — `VehicleTextures.hasAlphaIn` rasterises
the submesh's triangles in texture space (REPEAT wrap; a triangle tiling a full period takes the
whole-texture answer) and only a region that actually samples transparent texels blends. Unit-tested as the
pure `regionHasTransparency` (opaque region / transparent region / wrap / full-period / degenerate).
Residual: one MATERIAL mixing opaque and transparent texels stays blend — the narrowing is per submesh.
Recorded in [`edge-cases/converter-pipeline.md`](../../edge-cases/converter-pipeline.md).

### Defect 2 — ordering: the `centroid − radius` sort key over-reaches on scattered submeshes

The translucent sort keyed on `distance(centroid) − boundingRadius` (the 074/16 windscreen fix: a large
sheet counts by its nearest extent). The comet's gauge cluster spans the whole dash — centroid mid-dash,
**radius 1.80** — so at EQUAL distance (4.56 m, computed from the user's angle) it beat the window sheet
in front of it (radius 0.51, key 4.06 vs 2.76) and drew crisp over the glass from every close angle.

**Fix:** where the fixture carries the submesh's part-local AABB (`VehicleModelSubmesh.bounds`, written by
the builder since this fix), the key is the eye's EXACT distance to that box — the eye transformed into the
part's local frame (affine inverse; parts carry at most a uniform scale) and clamped into the box. That is
the same "nearest extent" idea 074/16 wanted, in its honest form: a sheet close to the eye keys near, a
scattered cluster keys at its true nearest face, and neither over-reaches. Old fixtures without `bounds`
keep the sphere fallback, so nothing changes for a build until it is rebaked.

### Defect 3 (re-report 2026-08-17) — a SCATTERED translucent submesh has no honest sort key at all

The user's re-report, thirteen days on: from an angle near the FRONT of the car the rear-shelf speakers read
crisp through the rear quarter glass again; from the rear they were fine. The roster (read out of the built
`.osm`) said why: the comet's `dials` material was ONE translucent submesh of 960 triangles holding the gauge
cluster on the dash (y ≈ +0.38), the two speakers on the rear shelf (y −1.46..−1.34) and pieces between —
AABB spanning 1.9 m of the car. Defect 2's exact eye-to-AABB key is right for a compact piece and wrong for
this by construction: from a front-side eye the box's nearest point is the dash, nearer than the rear quarter
glass, so the whole submesh — speakers included — drew after it. From the rear the nearest point is the
shelf, behind the glass, and the order came out right. No single per-submesh key can serve two pieces two
metres apart.

**Fix:** the builder emits a translucent material group per spatially compact CLUSTER
(`packages/renderware/src/vehicle/translucent-clusters.ts` — connected components by shared vertex
position, pieces within 0.2 m merged, at most 8 clusters per group; a connected sheet such as a windscreen
is unchanged), each with its own AABB. Rebaked comet: the speakers are their own two submeshes with a shelf
box, the gauges theirs; the car's translucent submesh count 69 → 86 (+17 draws per instance, blend phase
only). Whole-fleet rebake is `vehicle-installer --rebake original`; a fixture built before this keeps the
old shape until it is rebaked. **Field verdict (2026-08-17, the reporter's own angle): the speakers no longer show through.**

## How it was diagnosed (the method that worked)

- The blend-phase ROSTER, offline: every translucent submesh with part, texture layer, alpha class,
  centroid, radius — read straight out of the built `.osm`. This is what showed opaque interior parts
  sitting in the blend list (defect 1) and the 1.80 radius (defect 2).
- The sort ORDER, computed: `dist − radius` evaluated for the user's camera position over that roster —
  the inversion (dash later than the window at equal distance) fell out as two numbers, no theory needed.
- The field check that settled "fixed": the same close-up angle re-shot — cabin elements read DIMMED
  through the glass, exactly what a correct compositing order looks like.

## Pointers

- Classification: `packages/renderware/src/vehicle/textures.ts` (`hasAlphaIn`, `regionHasTransparency`),
  consumed in `build-vehicle-model.ts#appendGeometry`.
- Ordering: `packages/engine/src/engine.ts#submeshSortDistance`; the AABB is baked in
  `build-vehicle-model.ts` beside the 074/16 radius.
- The related door fix from the same day (a mod's separate door-glass atomic must SWING with the door —
  frame-subtree membership, `VehicleDoor.parts`): [`contracts/vehicles.md`](../../contracts/vehicles.md).
