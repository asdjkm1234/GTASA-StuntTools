# Audit — 07/04's first two tasks, and the density lever that turned out not to be one (2026-08-08)

The session shipped the target selector and the guard move, then tried to take 07/04's `opensa` perf budget
and could not — because the knob it built for the measurement proved that the plan's density lever does not
move anything. This is the record of what changed, what it cost, what it bought, and what it left open.

## What changed

| Commit | Subject |
| --- | --- |
| `e9582cfe` | **The target selector.** `BuildTarget` (`sa` \| `opensa`) + `parseBuildTarget` in `@opensa/tool-kit/target`; pmb `--target`, DERIVED from `--exclude` when omitted; refused when an `opensa` profile would ride a run that still builds `sa/`. Threaded pmb → sa-procobj-placement. Its first job: the layer's price per host (`buildStreamedIpl` returns the permanent `rows`; the generator prints objects · rows · rows/object). |
| `a5b393b1` | **The guard move.** `checkTextIplSlotBudget` → `checkTextIplBudgets`, off the common baked build onto the built `sa/` tree beside `checkImgIdBudgets`, with its two ceilings split: int16 rows THROW, the 39 stock slots REPORT. `opensa/` runs neither and announces that it has no ceiling of its own (`OPENSA_BUDGET_NOTICE`). |
| (this change) | **The density knob + the measurement record.** `--procobj-density` / `--procobj-max` / `CAP DROPPED`, the two benchmark files, the open issue, and the plan rewrites the measurement forced. |

## What it bought

1. **A build now says which host it is for, and cannot lie about it.** The gate is a build INPUT derived from
   what the build scripts already declare, so `build:game:original:opensa` resolves to `opensa` with no script
   change and no flag for an operator to forget — which was the failure mode the plan named.
2. **The `opensa` target stopped being rationed by SA's ceilings** (lesson 28's silent under-build), and the
   move fixed a false PASS in the other direction nobody was looking for: the sa LOD stage appends hole-fill
   instances to the text IPLs *after* the split, so the shared-build row count was never the count SA loads.
3. **The layer's price is read off the run** (15 286 objects · 6 487 permanent rows · 0.424 rows/object)
   instead of taking a script to recover — and it matched the independently derived census exactly, which is
   what validated the measurement rig before anything was concluded from it.
4. **The density premise of plan 07 is now measured rather than assumed** — see below. That is the session's
   real product, and it was bought by building an instrument that then reported a null result.

## What it cost

- Two full opensa builds (≈ 35 min each, ~6 GB) to compare arms that turned out to be 3.6 % apart.
- A headless bench sweep that was killed after 5 of 6 scenes — which then, unexpectedly, became the third
  measurement that identified WHICH of the user's two arms had drifted. Recording an interrupted run paid.
- One defect introduced and caught in this audit, not in review: the density guard let **NaN** through
  (`NaN <= 0` and `NaN > 3` are both false, and then every `lottery < NaN` is false) — a mistyped flag would
  have emptied the clutter layer in silence. Fixed with `Number.isFinite` + a test.

## The findings, in the order they landed

1. **The density cutoff is not the density lever.** 3× the cutoff yields **+3.6 % objects** (15 840 vs
   15 286), with `procObjMax` unable to bind. `cullByMinDistance` is at its packing limit.
2. **Because MINDIST is almost certainly not a spacing rule.** The column takes four values map-wide (50, 60,
   70, 80) clustered by surface family; the per-species number is `spacing`; and our own parser documents the
   field as *the draw/creation distance*. Its only consumer uses it as a 50–80 m exclusion radius.
   **Not concluded** — `CPlantMgr` has not been read, and the repo rule is to recover the original's meaning
   first. Full evidence in [02 decision 5](../../tools/sa-procobj-placement/docs/plans/010-density-model.md).
3. **+3.6 % clutter costs nothing measurable**: six scenes identical to ±0.0 % triangles with `gpuMs.pass`
   within ±0.03 ms; `country-dusk` +0.3 % triangles for +0.013 ms.
4. **The bench harness drifts more than the content does.** Three of nine scenes disagreed by amounts no
   3.6 % change can produce (control scene `ocean-horizon` **+107 %** triangles), `lateCreates` 0 throughout.
   Cause filed: [collision is missing across a scene teleport](../open-issues/bench-scene-transition-collision.md).
   **This blocks the perf budgets**, which are 07/04's remaining work.

## What is still open, and why

- **07/04's two perf budgets** — blocked on the harness defect above, then on a density lever that works.
- **Decision 5's `opensa` budget guard** — the branch announces that it has no ceiling; the number has to be
  measured, and a cap taken from SA's numbers would be a guess wearing a measurement's clothes.
- **The int16 THROW** — the user's call is that it goes: pmb ships the generated asi and every ceiling becomes
  a warning naming the ini knob (OLA `EntitiesPerIpl`/`EntityIpl`/`Buildings`, FLA `FILE_TYPE_*`). Recorded as
  [04 decision 5b](../../tools/sa-procobj-placement/docs/plans/013-density-budgets-per-target.md),
  ordered AFTER the perf budgets, and gated on the build actually shipping the asi — until then the throw is
  the stand-in for a dependency nothing checks.
- **No test drives `buildPerfectMap`**, so the guard's PLACEMENT on the `sa/` branch is verified by a build
  run and by reading, not by a test. Named on purpose: the honest cover for that seam is the field, not a
  test that re-implements the pipeline.

## What this audit changed

Everything below was missing when the session called itself done, and was added by the audit rather than by
review:

- the NaN hole in the density guard (+ test);
- a test that the shipped density default is 1 in BOTH configs — a silent change there moves every build;
- tests for `CAP DROPPED` and for the density appearing in the cost line (a capture that does not state its
  own configuration is the trap the standing rule exists for);
- `docs/commands.md` rows for `--procobj-density` / `--procobj-max` / the generator's `--density`;
- the comparability rule in `docs/benchmarks/readme.md`: **check `avgTriangles` before reading any
  `gpuMs.pass` delta**;
- 02's decision 5 struck and replaced with the evidence, and its task list re-ordered so the MINDIST question
  runs first.
