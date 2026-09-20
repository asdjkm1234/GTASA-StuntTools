# Audit — the density model, and three guards that guarded nothing (2026-08-09, evening)

Commits `971b33c6..d33577cc` (10), 36 files, +1305 −268. Full suite after: **446 files / 3953 tests**, `tsc`
and `eslint` clean repo-wide. **No build was run** (the user's call) — every claim below is from the suite,
from a read of the code, or from a bench sweep on the pak already on disk.

The session was asked for one small task (P0: turn the int16 throw into a warning). It became four, because
each one's PREMISE turned out to be wrong when checked. That is the theme, and it is the reason to write this
down: **four separate documents described a state the code was not in.**

## What shipped

| # | Change | Where |
| --- | --- | --- |
| 1 | The int16 guard is DELETED, not downgraded; the census names its own scope | `perfect-map-builder/src/pipeline.ts` |
| 2 | A scatter batch is one model on one SURFACE (a live mis-categorisation bug) | `renderware/src/map/procobj-scatter.ts` |
| 3 | Build-time density becomes a per-category / per-surface PROFILE | `map-placement/src/procobj/density.ts` + `convert.ts` |
| 4 | The scatter's candidate ceiling becomes a parameter | `renderware/src/map/procobj-scatter.ts` |
| 5 | P1 unblocked: three stale docs re-scoped, the A/A floor re-taken on the current pak | `docs/`, `docs/benchmarks/` |

## The four wrong premises

1. **"Turn the int16 throw into a warning."** A warning that fires on every build is a throw one severity
   down. After the column fix the layer alone costs 39 219 permanent rows, so the condition was CONSTANT —
   and a constant condition is a print statement wearing a guard's clothes. The user's call went further
   ("we will always have our asi, OLA, FLA"), and the guard, the invented `TEXT_ROW_CAP = 30000`, the
   `TEXT_IPL_SLOT_CAP = 39` line and `--allow-text-row-overflow` all went with it.
2. **"Category is already on the placement, thread surface through"** (plan 010). Category is on the BATCH,
   and the batch was keyed by MODEL alone while `procobj.dat` keys its rules by surface+model. **19 of 56
   models scatter on several surfaces**, so six `p_rubble*` took the category of whichever surface the
   collision walk reached first — and category drives runtime draw distance.
3. **"Past a binding cap, boosting bushes displaces rocks"** (plan 010 decision 8). It does not, in the
   common case. The slice keeps the globally lowest lotteries and a boost only adds placements ABOVE the old
   cutoff, so from a uniform base the boost sorts last and is exactly what the cap eats: it buys nothing and
   costs nobody anything. Displacement needs an UNEVEN profile.
4. **"P1 is blocked by the bench."** It was not. Plan 102 had shipped, merged (`ed6b90ba`) and been audited
   (`6202503e`); its own readme, the plans README row and the open issue all still said otherwise.

## What it cost, what it bought

**Cost.** No content moved. The deleted row cap never culled anything, so removing it changed no output; the
batch-key split leaves the RNG untouched, so the scatter is bit-identical; the density default is the empty
profile, which is 1.0 everywhere. The only behaviour change in the whole session is the corrected CATEGORY on
six rubble models, which alters their runtime draw distance — a fix, and one no count could have shown.

**Bought.** A `sa` build can exist again (the throw failed every one). A density profile is expressible per
category and per surface, with cutoffs above 3 reachable. The row census stops lying by omission. And P1 has
a measurement floor per COLUMN instead of a single number.

## The instrument, measured rather than assumed

Two back-to-back sweeps of the same pak (91 092 clutter objects; plan 102's floor was taken on the lighter
08-08 pak). `legStart.ok` on all nine scenes in both arms, `lateCreates` 0.
[`2026-08-09-headless-aa-floor-current-pak.json`](../benchmarks/opensa-engine/2026-08-09-headless-aa-floor-current-pak.json).

| column | worst A/A | usable? |
| --- | --- | --- |
| `avgTriangles` | 0.094 % | yes |
| `avgDrawCalls` | 0.52 % | yes |
| `avgMs` | saturated at the 120 fps cap on 7 of 9 scenes | **no** |
| `gpuMs.pass` | 13.37 % | only for effects above that, or with repeats |

That is the finding P1 actually needed: **the harness holds still on content and not on cost**, so the perf
budget must come from hitching plus repeated GPU samples, or from the user's uncapped display lane.

## Tests — what is covered, and what is not

Added: the batch split (fails against the model-only key), the candidate ceiling (three properties: meaning
preserved, count scaled, scatter re-rolled from the second face), the census scope (missing IPL → lower-bound
warning; missing `gta.dat` → warning not silence), profile resolution and key-naming validation, and
`selectPlacements` — profile → cutoff → cap, including both cap shapes.

**Run against the reverted change**, per the standing rule: re-adding the throw and the silent zero fails
exactly those two tests; the model-only key fails exactly the split test.

**Not covered, deliberately:** no whole-pipeline count test (it would need a game dir, and the two halves —
"the scatter's lottery is uniform" and "the profile is applied per batch" — are each tested where they live).
No test asserts the runtime draw distance actually changed for the six rubble models; the fix is at the
source and the consumers read `batch.category` unchanged.

## Docs touched in the same change

`CLAUDE.md` (a standing rule: the `sa` target always carries OLA + FLA + our asi — delete museum pieces, keep
gates), `restrictions/{README,sa-target}.md`, `edge-cases/{sa-runtime-limits,converter-pipeline}.md`,
`commands.md`, `architecture/perfect-map-builder.md` + its rendered diagram, `open-issues/fixed/ghost-barriers.md`,
`open-issues/bench-scene-transition-collision.md`, `plans/README.md`, `plans/102-…/readme.md`,
`gta-sa-original/procedural-objects.md`, `features/procobj.md`, `benchmarks/index.md`, and the plans
`sa-procobj-placement/{010,012,013}`, `asi/perfect-map/{readme,006}`, `tools-debug/sa-int16-repro/*`.

## What this leaves open

- **`AREA_ROW_CAP = 4000` and `AREA_MAX_PAIRS = 2000`** guard `gpLoadedBuildings`, which OLA sets to
  `unlimited` on the target. Unlike the deleted row cap **these SHAPE OUTPUT** — they split areas and migrate
  instances. Nobody has measured whether they still bind at the shipped density. Flagged OPEN in
  `edge-cases/sa-runtime-limits.md`; this is the one case where "delete the museum piece" could cost real
  behaviour.
- **No shipped density profile** — it waits on the `opensa` perf budget.
- **No `sa` build since the throw was removed.** The throw was the only KNOWN blocker; whether the rest of
  the chain completes at 91 092 objects is unmeasured.
- The **corner-biased sampler A/B** (plan 010's last task) is a LOOK question and needs the user.
