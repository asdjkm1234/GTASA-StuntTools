# 004 — A build that says how long it took, and refuses to eat its own source

**SHIPPED 2026-08-09.** Unplanned — both halves came out of one session's mistake, and each is the kind of
gap that only shows up when someone asks an obvious question.

## The source-overlap guard

`<out>/.work` is wiped unconditionally at the top of every run (`pipeline.ts`), **before any stage reads
`--game` or `--in`**. So the obvious fast path for re-running one stage —
`--game <out>/.work/5-trees --out <out>` — deletes the intermediate it was about to read.

It is silent in the worst way: the run dies seconds later on a missing `gta3.img`, naming the symptom while
the cause is already gone. It cost a full rebuild on 2026-08-09 (~45 min against the ~7 min the fast path
would have taken).

`refuseSourceInsideWork(work, gamePath, inPath)` now throws before the wipe, naming the flag and the fix
(copy the intermediate out, or point `--out` elsewhere). Two tests, both verified against the reverted change
— without the guard they fail on the message AND on the intermediate being gone, which is the half that
matters.

Recorded as a rule in [`restrictions/architecture.md`](../../../../docs/restrictions/architecture.md)
(*"a build's SOURCE may not live inside its own output"*, caught: yes) and in
[`commands.md`](../../../../docs/commands.md).

## Per-stage timings

Nothing recorded how long a build took. Not the builder, not `report.json`, not `docs/benchmarks/` — so the
first time anyone asked "what did the procobj density change cost in build time?", there was no baseline and
no way to make one retroactively (the previous pak's file mtimes had already been overwritten by the run
that raised the question).

Every stage is now timed and **logged as it ends**, not only in the summary — a long build that is killed
part way still leaves its numbers in the log. At the end the run prints a table and writes
`<out>/build-timings.json`.

The file is **self-describing**: it records the `target` and the procobj knobs (`procobjDensity`,
`procobjMax`) the run was configured with, because a duration is only comparable against another run whose
configuration is known. That is the same rule the `[phys]` capture block established for A/Bs.

## What the tests pin, and the one seam they do not

`refuseSourceInsideWork` has two tests and **both were run against the reverted guard** — without it they
fail on the message AND on the intermediate being gone, which is the half that matters. `writeStageTimings`
has three (no file when nothing ran, the knobs recorded, the total taken from what it was given).

**Uncovered:** that `buildPerfectMap` actually CALLS them. The timing wrapper only fires on a real stage, and
a run with every stage excluded times nothing, so proving the wiring needs a full build. The helper is
tested; the seam is not — stated here rather than covered by a test that re-implements the loop.

## Measurements

First full `--exclude sa --keep-work` run from `game-src/original`, 2026-08-09 (before the timing code
landed, so these are read off the log and the `.work` stage mtimes — the sidecar starts with the next build):

| stage | wall clock |
| --- | --- |
| mods | ~84 s |
| vehicles | ~7 s |
| peds | ~25 s |
| optimize | ~96 s |
| trees | ~87 s |
| procobj | ~7 min |
| opensa + pack | ~37 min (pack's own log: 1 742 s at 94 % of cells, AO bake 1 273.7 s) |
| **total** | **44 m 54 s** |

**Pack is roughly three quarters of a full build**, which is where any build-time optimisation has to look.
