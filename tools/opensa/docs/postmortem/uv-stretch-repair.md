# The UV-stretch repair — retired by the field the day after it shipped

**Built 2026-08-11, retired 2026-08-11 (next field round, user's verdict).** The `repair-uv-stretch`
map-optimizer pass re-derived the UVs of faces whose authored mapping was collapsed along one axis — stock
R\* data drawing a single texel row across a whole road slab as a directional smear. It repaired **3 849
faces across 104 models** map-wide, passed every one of its own measured guards, and the first before/after
look at the real map reversed it: *"we only made it worse"* — the repair replaced a soft continuous smear
with hard-edged, visibly mis-set texture. The pass, its gate list (`data/uv-stretch-models.json`) and the
report ledger were removed the same day.

## Where the record lives

- The LIVING entry — symptom, population, exits — is
  [`docs/open-issues/texel-smear-authored-uv.md`](../open-issues/texel-smear-authored-uv.md): the problem is
  shelved, not solved, and this postmortem is only the repair attempt's grave
- Diagnosis (six failed criteria, three world gates, the scanner):
  [`tools/map-optimizer/docs/plans/025-texel-smear-on-flat-surfaces.md`](../../tools/map-optimizer/docs/plans/025-texel-smear-on-flat-surfaces.md)
- Build record of the pass and its three measured guards:
  [`docs/audit/uv-smear-six-criteria-and-the-two-map-viewer-bugs.md`](../audit/uv-smear-six-criteria-and-the-two-map-viewer-bugs.md)
- The code: branch `025-world-visibility`, `tools/map-optimizer/src/plugins/repair-uv-stretch.ts` until the
  retiring commit (`git log --diff-filter=D -- '*repair-uv-stretch*'` finds it)
- What SURVIVES: `scripts/debug/scan-model-defects.ts` family C with the world gates — the diagnosis was
  right (the defect is authored R\* data; the optimizer moves 0 UVs), only the repair died

## Why it died — two structural reasons, neither a bug

The pass was field-checked at a repaired road intersection. Before: the smear reads as a soft low-frequency
gradient. After: sharp triangular wedges of texture, each crisp but visibly not lying where the painted road
around it lies. Both halves of that are *built into the approach*:

1. **Any repair of this defect converts a continuous error into a discontinuous one.** The broken faces
   SHARE their UVs with healthy neighbours — the collapsed mapping is degenerate but continuous, which is
   why it reads as a blur and not a seam. The pass corrected a corner on a split vertex copy precisely so it
   could not move a joint the neighbouring models tile against; every split is therefore a new hard UV seam
   between a repaired face and an unrepaired (or differently-repaired) one. At the roads' 16–21 % coverage
   that is a patchwork by construction. Full coverage would only push the seams to the region border, not
   remove them: the boundary UVs are shared with healthy geometry, and they ARE the defect (two opposite
   edges carrying the same texel row). Fix continuously ⇒ move a correct joint; fix with a split ⇒ a seam.
   There is no third door.
2. **The authored intent the repair needed does not exist in the data.** A model-wide fit over the healthy
   faces leaves a ~1.8 UV-unit residual — SA's UVs restart per strip; there is no frame to restore a broken
   face INTO. The pass's acceptance test was therefore a metric (anisotropy ≤ 8 after the fix, verified per
   face), and the metric is satisfiable by mappings whose scale and orientation are invented — the corrected
   face kept two corners of its *broken* frame and derived the third from a neighbour's. Crisp, under the
   limit, and wrong to the eye. Nothing in the build can catch "helps the metric, looks worse": the
   restriction file said exactly that (*"the field labels are the gate"*), and the field gate is the one it
   failed.

The general lesson, and it is the same one plan 090 paid for: **a low-frequency defect and a high-frequency
one are not ordered by any per-face metric.** The eye forgives a smooth smear and convicts a sharp seam;
"better must be demonstrated" (`docs/project-goals.md`) means demonstrated to the eye, and there was no
offline instrument for that — the first honest test was the field round that killed it.

## What was measured on the way (so it is not re-derived)

- Guards that DID work, all three of the family "it looked like it worked and had not": seam agreement
  (mixing UV frames across a seam: 10× → 1324× anisotropy on `las_runsignsx_las`), self-verification
  (unverified repairs looped — 1 027 "repairs" on a mesh with 246 broken faces), unfold-not-project
  (`smallshop_16_sfs` 13 % → 46 % coverage).
- Coverage ceiling of local inheritance: `cs_landbit_10` 69 %, `smallshop_16_sfs` 46 %, the three
  field-confirmed roads 16–21 % — the rest of the broken faces have no healthy edge to inherit from.
- Anisotropic filtering (deferred to `docs/roadmap/0.6.0/plans/06-anisotropic-filtering/`) is **not** a
  substitute: it sharpens what the mapping still carries; a stretch authored into the UVs renders smeared at
  any sample count.

## When to revisit

- **Hand-authored UV fixes shipped as data** — open the named models in Blender, re-lay the broken strips by
  eye against the texture, ship as a mod the pipeline consumes byte-faithfully. The only agent that knows
  where the yellow line should lie is a human looking at it. The field-confirmed set is small
  (`road_lawn17`, `road_lawn34`, `road_lawn32`; spots in the plan). Parked as an idea — the user decides
  if/when.
- An automated second attempt is only worth opening if it can (a) repair whole connected broken regions in
  ONE consistent frame and (b) judge itself on sampled-texture continuity across edges rather than on
  anisotropy — and even then it is inventing intent, so it ends at the same field gate this one failed.
