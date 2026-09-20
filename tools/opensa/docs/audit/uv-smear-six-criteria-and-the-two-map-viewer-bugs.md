# Audit — the texel-smear hunt: six criteria, three world gates, one repair (2026-08-11)

What the session was asked for: two bugs the user wanted fixed before the rebuild. The first took an hour and
is closed. The second turned into the longest single investigation this repo has run, produced **six** wrong
answers before a right one, and ended with a repair pass in the build.

Branch: `025-world-visibility` (13 commits). Main: 14 commits. Plan:
[`tools/map-optimizer/docs/plans/025`](../../tools/map-optimizer/docs/plans/025-texel-smear-on-flat-surfaces.md).

## Bug 1 — the Map Viewer opened upside down

`snapTopDown` set the pitch and INHERITED the yaw, so the in-game viewer was oriented by whichever way the
player happened to face. On the default spawn that is the flipped case exactly: `SPAWN_FACING` is π, the rig
seeds at `yawBehind(π)` = 0, and at yaw 0 the top-down basis comes out a half turn round.

Not a regression — `git log -L` over the function body returns one commit, the 080/01 one that created it.
What broke was SYMMETRY: plan 094 found this same fact for the standalone `sa-map-viewer`, fixed it there with
`MAP_YAW`, and the in-game caller kept the defect. **The lesson worth carrying: when a fix lands on one of two
callers of a shared idea, nothing tells you about the other one.** `MAP_YAW` now lives in `fly-rig` beside the
constants both viewers already shared.

Shipped alongside: "Show water" (a checkbox written in 094/07 and gated on a `MapGame.setShowWater` this host
never implemented — it sat behind an `undefined` for two plans) and "Show procobj" (`Engine.clutterEnabled`).

## Bug 2 — what it cost to find out the tool was innocent

The user reported smeared textures on big flat objects, "absent before map-optimizer runs". Every plausible
cause was measured and killed, in this order:

| # | hypothesis | how it died |
|---|---|---|
| 0 | the geometry chain corrupts UVs | **0 UVs move**, at any pass, on any model — measured per-pass on the `position → {uv}` associations |
| 1 | isotropic minification (no `maxAnisotropy`) | the class appears on the `sa` target too, and `sa` is drawn by the real game's renderer |
| 2 | created normals (`addNormals` reaches real SA) | the user checked the untouched original in `sa-map-viewer`: the defects are there too |
| 3 | rank by raw anisotropy | puts CABLES first — a ribbon should map a texel off square |
| 4 | rank by disagreement with edge-neighbours | `sbseabed3_las20` scored 1 flagged face of 39 where the field calls a quarter of it wrong |
| 5 | rank by the model's own healthy median | catches the bands, puts the wires straight back on top |
| 6 | keep only up-facing faces | `road03sfn`, labelled CLEAN, still outranked the broken `road_lawn34` 4× |

Six formulations. The measurement that ended it was not a seventh: **`road03sfn` carries 42 up-facing
collapsed faces over 21 % of its visible area and the field calls it fine, because neighbouring buildings
STAND on them.** Visibility is a property of the assembled world, not of the model — no model-local criterion
can separate this class, and five of the six had been arguing about the wrong thing.

### What actually separated it

Three world gates, then the texture:

| gate | what it removes | models with any flagged face |
|---|---|---|
| — | — | 2 544 |
| water (`water.dat`, per-instance, world space) | the seabed | 2 529 |
| cover (placement AABBs, `reach` 5 u) | skirts with buildings on them | 667 |
| texture (luma spread along the smeared line) | wires, roofs | 329 |
| untextured (empty texture name) | interiors, `nwwarhus` | 317 |
| min area (10 u², per instance) | 8 u² models reaching 10 % | **127** |

Every threshold is derived from the labels, not chosen: `reach` 5 from dumping the 30 faces `road03sfn` still
carried (all covered at 5–10 u, not 2); texture 15 from broken roads at 23–26 against every clean model at
0–10; min-area 10 from the smallest real defect being 28 u² against `traincross1`'s 0.8 u².

**All nine field labels agree with the final ranking.**

## The repair

**RETIRED the next field round, 2026-08-11 — see
[`docs/postmortem/uv-stretch-repair.md`](../postmortem/uv-stretch-repair.md).** The before/after at a
repaired intersection reversed it (user: *"we only made it worse"*): every split vertex is a hard UV seam
between a repaired face and an unrepaired one, and the derived mapping satisfies the anisotropy limit while
lying where no author put it. The record below is how it was built and what its guards measured; the
diagnosis above it stands.

`repair-uv-stretch` keeps the two corners a broken face shares with a healthy neighbour and re-derives the
third by extending that neighbour's own affine world→UV map, onto a split copy so no shared UV moves.
Coverage: `cs_landbit_10` 69 %, `smallshop_16_sfs` 46 %, the three confirmed roads 16–21 %; map-wide
**3 849 faces across 104 models**.

Three defects caught by measurement before it shipped, each now a guard and each of the same family — *the
thing that looked like it worked did not*:

1. **Seam agreement.** Mixing two UV frames across a seam made `las_runsignsx_las` 10× → **1324×**.
2. **The pass checks its own work.** A face broken in the edge it KEEPS cannot be fixed by its third corner;
   unverified, the "repair" succeeded, the face stayed broken, and rounds retried it — 1 027 repairs on a
   mesh with 246 broken faces, appending a vertex each time.
3. **Unfold, don't project.** Projecting the corner onto the neighbour's plane discards the out-of-plane
   component; rotating the face about the shared edge instead took `smallshop_16_sfs` from 13 % to 46 %.

## What it cost, and what would have made it cheaper

Roughly a full day for one closed bug and one investigation. Two things account for most of the waste:

- **Five criteria were invented before a single label was asked for.** The field's first label (`road03sfn`
  is a skirt) reframed the whole problem in one sentence. The repo's own lesson — several wrong axes in a row
  means stop guessing and let the field answer — was written down and then not followed for five rounds.
- **My instruments failed more often than the thing measured, and always silently.** `water.dat`'s bowtie
  (`heightAt` null over the whole map), `material` vs `materialIndex` (every face "has no texture"), a
  denominator filtered along with the numerator (a 0 u² fence at 99.9 %), an arg parser that dropped
  `road_lawn34` because `--game`'s absence made index 0 the value slot. Each read as a finding until checked.

One user correction is worth its own line: **`road_lawn08` was mislabelled** (the picker grabbed the wrong
object), and the plan had recorded a false negative against the gates on the strength of it. A wrong label
makes a right instrument look broken, and no amount of re-measuring finds it.

## Owed

- The texture threshold rests on nine labels. `airtwer_las` is demoted (15 % → 0.5 %) rather than separated.
- The roads are the weakest repair case, and their remaining refusals are bands with no healthy edge to reach
  them from.
- The top of the ranking — `las_runsignsx_las`, the `cs_landbit_*` set, `smallshop_16_sfs` — has never been
  looked at by anyone.
- No benchmark: nothing in this session touches a frame path. The build cost is the measurable one and it is
  in `build-timings.json` (opensa 38 m 17 s).
