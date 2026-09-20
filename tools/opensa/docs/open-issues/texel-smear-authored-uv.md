# Texel smear on flat surfaces — R\*'s own UV data, shipping as authored

**Status: 🟡 open, deliberately shelved 2026-08-11.** The one repair that was built shipped for less than a
day and was retired by the field — the full record is
[`docs/postmortem/uv-stretch-repair.md`](../postmortem/uv-stretch-repair.md). No replacement approach is
designed yet; the honest exits are listed at the bottom, and none is scheduled.

**The retirement is field-verified (2026-08-11).** On the clean rebuild of both targets — the first build
with no repaired models in it — the user confirms the smears are back exactly as authored. That is the
intended state, not a regression: this issue's defect is R\*'s data, and the build now ships it untouched
rather than shipping our correction of it. It also confirms the retirement was complete — no repaired
geometry survived in the stage caches.

## Symptom

Large and/or flat map objects (roads above all) render with long directional smears: one row of texels
dragged across a whole face, up to 284× longer than wide. Visible on BOTH targets — `sa` is drawn by the
real game's renderer — and confirmed by the user in `sa-map-viewer` against the untouched original: **the
defect is in stock R\* data, and the map-optimizer is innocent** (0 UVs move at any pass, measured per-pass).

Field-confirmed spots:

| model | position |
|---|---|
| `road_lawn17` | 1149.7, −1040.0, 31.0 |
| `road_lawn34` | 1124.6, −951.4, 40.9 |
| `cs_landbit_10` | −2872.8, −1321.3, 42.4 |
| `smallshop_16_sfs` | −2234.1, 182.2, 46.1 |

## Root cause

A face's UV triangle is collapsed (or nearly so) while its position triangle is healthy — the mapping
crushes one axis, so the rasterizer correctly draws a stretched texel band. Population, after three world
gates and the texture/area filters: **127 models / 134 placements** map-wide (scanner:
`scripts/debug/scan-model-defects.ts`, family C; the six failed ranking criteria and the gates that finally
separated the class are in
[`tools/map-optimizer/docs/plans/025-texel-smear-on-flat-surfaces.md`](../../tools/map-optimizer/docs/plans/025-texel-smear-on-flat-surfaces.md)
and [`docs/audit/uv-smear-six-criteria-and-the-two-map-viewer-bugs.md`](../audit/uv-smear-six-criteria-and-the-two-map-viewer-bugs.md)).

## What was tried, and why it fell short

`repair-uv-stretch` (plan 025): re-derive a broken face's third corner from a healthy edge-neighbour's
affine world→UV map, on a split vertex so no shared UV moves. It repaired 3 849 faces across 104 models,
passed every measured guard, and the first before/after retired it — see the
[postmortem](../postmortem/uv-stretch-repair.md) for the two structural reasons it cannot work:

1. every split is a hard UV seam, so a partial repair of a CONTINUOUS defect turns a soft smear into
   sharp-edged patchwork (roads repaired 16–21 % — a patchwork by construction);
2. the authored intent is not in the data — there is no model frame to restore into (fit residual ~1.8 UV),
   so a metric-approved correction is an invented mapping that reads, in the user's words, as a
   mis-set/knocked-off texture.

**Not a fix, recorded so nobody reaches for it**: anisotropic filtering
(`docs/roadmap/0.6.0/plans/06-anisotropic-filtering/`) sharpens sampling; a stretch authored into the UVs
renders smeared at any sample count.

## For whoever picks it up

- The known-viable exit is **hand-authored UV fixes shipped as data** (Blender, per model, eyes on the
  texture) — a "map fixes" mod the pipeline carries byte-faithfully. The field-confirmed set is small
  (the three roads above). Not opened as an idea yet — the right shape for doing this is undecided
  (user, 2026-08-11: there is no idea yet for how to do this properly, possibly later).
- An automated second attempt only clears the bar if it repairs whole connected regions in ONE frame AND
  judges itself on sampled-texture continuity, not anisotropy — and it still invents intent, so it ends at
  the same field gate. Conditions spelled out in the postmortem.
- The scanner and its gate thresholds are alive and rerunnable; the rule they left behind is
  `docs/restrictions/assets-and-data.md` § "Repairing authored data is allowed, and it still has to be
  demonstrated — to the EYE".
