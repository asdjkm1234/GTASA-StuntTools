# 2026-08-22 — both targets rebuilt on lod-trees 013 + the `gta.dat` order fix

**Tool:** `perfect-map-builder`, both targets, one after the other into `./build/original`.
**Inputs:** `game-src/original` + `mods-src/original`, unchanged since the 2026-08-21 runs; repo at `efe28767`
(lod-trees 013 steps 01/02/03/06, `mod-installer` 016, the `lod-common` blended-last rule).
**Machine:** the same one every earlier run in this family was measured on.

Recorded before being read, per the standing rule. Sources: `build/original/build-timings.json` (the `sa` run)
and `build/original/report-opensa.json` → `timings` (the `opensa` run — **one `build-timings.json` per `--out`,
so the second run replaces the first's; the per-target reports are what survives**).

## `opensa` — 3 420.0 s (57 m 00 s), finished 09:57 local

| stage | s |
| --- | ---: |
| split | 2.2 |
| mods | 96.4 |
| vehicles | 5.8 |
| cutscene | 5.1 |
| peds | 12.3 |
| optimize | 85.7 |
| **trees** | **683.0** |
| **opensa** (cell bake + convert + pack) | **2 529.5** |
| total | **3 420.0** |

Against the last full `opensa` run, 2026-08-17 (`2026-08-17-model-repack-lod-half.md`): **2 804 s total with
the `opensa` stage at 2 532 s**. So:

- **The `opensa` stage is unchanged: 2 532 → 2 529.5 s (−0.1 %).** Nothing in plan 013 touches it, and the
  measurement says so rather than the argument.
- **The whole +616 s is the `trees` stage** (~83 s before this plan → 683 s), which is the two-cages-per-tree
  bake plus the per-tree alpha solve. The rest of the chain lands within ~20 s of the earlier run.

## `sa` — 1 298.6 s (21 m 39 s), finished 10:20 local

| stage | 2026-08-20 (before 013) | 2026-08-21 (01–06) | **2026-08-22** |
| --- | ---: | ---: | ---: |
| split | 2.2 | — | 1.4 |
| mods | 90.7 | 101.6 | 89.6 |
| vehicles | 8.3 | — | 5.3 |
| cutscene | 14.6 | — | 9.8 |
| peds | 10.8 | — | 8.1 |
| optimize | 90.2 | 90.4 | 91.7 |
| **trees** | **83.4** | **684.4** | **711.4** |
| **sa** | **373.0** | **365.0** | **377.6** |
| procobj | 2.9 | 3.3 | 3.7 |
| total | **676.1** | **1 285.7** | **1 298.6** |

- **+1.0 % on yesterday's build of the same steps** (1 285.7 → 1 298.6). `trees` +3.9 %, the `sa` stage
  +3.5 %, everything else flat or lower — run-to-run variance, not a change.
- ×1.92 on the pre-013 baseline, and `trees` accounts for all of it, exactly as the step-06 run measured.
- Wall clock `startedAt` → `finishedAt`: 07:58:23 → 08:20:14 UTC = **1 311 s**, so 12.4 s of the run sits
  outside the timed stages (copies, the report write).

## The new build guard's cost: under half a second

`assertDefinitionOrder` runs inside the `sa` stage on the finished tree, and the +12.6 s that stage shows is
NOT it: the same work standalone over the same tree is **0.73 s wall including the `tsx` start** — it parses
69 IDEs once and 127 384 `inst` rows once.

```
$ npx tsx scripts/debug/dat-order-check.ts build/original/sa
build/original/sa: 127384 text inst rows — 0 placed before their definition (0 ids)
```

**0 findings against 137 rows / 31 ids on the 2026-08-21 tree** — the `mod-installer` 016 splice, on a real
build rather than on the offline rehearsal.

## Notes for the next comparison

- Two targets built into one `--out` leave only the LAST run's `build-timings.json`. Both runs' stage tables
  are always recoverable from `report-sa.json` / `report-opensa.json`, which carry the same `timings` array.
- Since 2026-08-22 a run that DIES also writes `build-timings.json` (`status: "failed"`, the step that threw,
  the stages that finished), and clears the previous file on entry — so a stage table found in `build/<game>/`
  now always belongs to the run that produced the tree beside it.
