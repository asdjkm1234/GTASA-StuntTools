# 022 — Smooth groups across two-sided geometry

**Status: SHIPPED + FIELD-CONFIRMED 2026-07-15 (the airport car-park ramp check passed; sphinx turned out to be a hi-poly mod remaster with a separate, parked issue).**
Part of the 020–023 normals batch (the 0.4.0 normals-smoothing idea (graduated here, idea doc deleted)).

## Shipped design (simpler than the sketch below — no sheet flood-fill needed)

`smoothGroups` gained twin awareness (`twinFaces`: canonical DIRECTED triple key, reversed lookup, greedy
deterministic pairing). A 4-incident edge whose faces form two twin pairs (`isTwinQuad`) runs the ORDINARY
dihedral union test on **all six cross pairs** — no side bookkeeping at all, because the arithmetic decides:
a twin's normal is negated, so twin pairs (dot −1) and wrong-side pairs (dot = −same-side dot) can never
reach `cos(crease)`; only the two same-side pairs union. Mixed winding can't mis-smooth — a wrong pairing
fails the same test. 2-incident edges where the two faces ARE twins (an open sheet's border) skip as before
(dot −1). Everything else (3-incident T-junctions, 5+, un-twinned 4s) stays a hard boundary.

**Measured on the probe's worst offenders (old → new appended split vertices):** `aircarpark_02_sfse`
2 675 → 755 (−72 %) · `silicon12_sfs` 4 662 → 1 578 (−66 %, exactly 2 copies/vertex = a fully doubled
model) · `sphinx01_lvs` 2 641 → 545 (−79 %). The fix smooths the doubled shells AND cuts the vertex bloat —
pre-022, every face in a doubled region owned a group, so every corner split per face.

## Measured (vanilla map, 2026-07-15 probe)

Map-wide: **335 107 twin faces** (reversed-winding coincident pairs); of those, **72 513 faces in 947
models** sit on a non-manifold edge hiding a _curved_ smooth join (dihedral to a neighbour in 5°–45° — i.e.
grouping WOULD have smoothed it, and the flatness IS visible; coplanar cases were excluded as harmless).
Worst offenders read like the predicted class — curved two-sided shells: `aircarpark_0*_sfse` (spiral
parking ramps, 736 each), `silicon12_sfs` 1128, `lodalibur02/03_lvs` (Excalibur castle LODs), `sphinx01_lvs`
836, `newtunnelrail_sfs` 1024, `ballys01_lvs`, `csrspalace02_lvs`. Fixture picks for the field A/B: an
`aircarpark` ramp + `sphinx01_lvs`.

## Problem

`tool-kit/mesh/smooth-normals.ts#smoothGroups` treats any edge with ≠ 2 incident faces as a hard group
boundary. SA's static world is heavily two-sided (mirrored coplanar face pairs — the engine even honours
`DISABLE_BACKFACE_CULLING`; vanilla renders the world without cull). In a doubled region every edge has 4+
incident faces → **every face becomes its own smooth group** → per-face flat shading on surfaces that should
read smooth (awnings, canopy sheets, thin walls seen from both sides). Fences/flat sheets don't care; curved
doubled surfaces do.

## Design sketch (validate against fixtures first)

Pair mirrored twins before grouping:

1. Detect twin faces: same 3 canon vertices, opposite winding (the `dedupe-faces` canonical-key machinery
   already distinguishes these — reuse its key, reversed).
2. Partition faces into **front** and **back** sheets by twin orientation (flood-fill consistency, seeded per
   connected component; a component without twins is untouched).
3. Run the existing edge/dihedral grouping **per sheet** — within a sheet, shared edges are 2-incident again
   and the crease logic applies as designed. Twins get opposite group normals by construction.
4. Unpaired non-manifold edges (T-junctions, real borders) stay hard boundaries as today.

Open question for phase 0: how much of the doubled world is _curved_ (where this shows) vs flat (where
per-face == smooth anyway). If the fixture sweep finds only flat cases, close this plan as not-needed —
that outcome goes in this doc.

## Tasks

- [x] Phase 0 evidence: probe numbers above — 72 513 curved smooth-lost faces / 947 models; fixtures =
      `aircarpark_02_sfse`, `sphinx01_lvs`.
- [x] Twin detection in the tool-kit core (`twinFaces` + `isTwinQuad` + all-cross-pairs union; sheet
      partition proved unnecessary — the dihedral test self-selects the side). All six consumer suites
      green (406 tests).
- [x] Unit tests: doubled curved strip smooths per side with mirrored normals; existing double-face and
      T-junction (new test) stay hard; flat doubles are the trivial case of the curved test.
- [x] Field A/B: `aircarpark_02_sfse` ramp confirmed clean (2026-07-15). `sphinx01_lvs` in the user's
      mods is an 11,588-vert HD remaster whose facets are NOT this plan's artifact (optimizer output normals
      verified smooth; ~~parked — resume pak-side~~ **RESOLVED 2026-07-29, plan 024: the facets were never
      normals or pak — the remaster's DAY PRELIT has 4 465 black vertices / 6 033 all-black triangles, the
      Family B class; fixed engine-side by the 093 world ambient term + floor, field-confirmed**).
