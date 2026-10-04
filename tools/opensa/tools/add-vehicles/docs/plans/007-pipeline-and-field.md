# 007 — Pipeline stage, cars-server, the field round

**Status: BUILT 2026-08-19** — the pipeline stage, cars-server and the budgets. **The field round is the
one thing outstanding, and it waits on the link ceiling** (see below).

## Steps

1. **pmb stage `add-vehicles`** — after `vehicles` (and `cutscene`, which reads the installed REPLACEMENT
   fleet and must not see added cars), before `peds`; `sa` target only (refused for `opensa` with the
   standard message); source `mods-src/<game>/add-vehicles` through the resolver; `--until`/`--only` as every
   stage; `resume.json` records it. The stage runs the guards that already exist on the built tree:
   `checkImgIdBudgets` (FLA TXD pool: 115 cars × ≤ 5 TXDs), `assertCarmodsModels`, and the vehicles.img
   spill cap (the writer's), and writes its counts into `report-sa.json`.
2. **Budgets priced BEFORE the first field run** (the project rule): ids (161 of 999), TXD pool (≤ 575 of the
   6 000 − used), `Car generators` (parked rows), `link` pairs (the 8 wing pairs vs 7 free → 005's guard
   WILL refuse one until `perfect-vehicle` 002 ships; decide with the user which car waits).
3. **cars-server** — the added fleet's pictures from `add-vehicles/screenshots/` by slot, in its own
   section, through the same resolver; the car's page shows its id and base.
4. **Field round** — one full `pmb … --until sa`, delivery to the bottle, and the acceptance list of the
   umbrella plan: traffic, a parked car, the HUD name, the engine sound, the shop parts with names, the two
   `vehicles/` gaps closed. Eight world entries (the 011 ladder) to confirm nothing regressed in the pools.
5. **Audit + numbers** — `docs/audit/` entry for the chain, build time delta, archive sizes, pool counts
   into the plan's Measured and `docs/benchmarks/` where a runtime number moved.

## Measured

**Built 2026-08-19.**

**Where it runs, and why not where the plan said.** Not a common-chain stage between `cutscene` and `peds`:
**inside the `sa` branch, on the finished tree**, after the plugin is shipped and before the budget guards.
That is the placement `procobj` established (plan 014) for content belonging to ONE target — in the common
chain an `opensa` pak would have carried 115 cars nothing can spawn, and the ordering would have put the
`carmods.dat` guard before the plugin that lifts its ceiling. Tests: three in `pipeline.test.ts` (runs once,
into `<out>/sa`, never when the sa branch does not run, never without cars).

**cars-server.** The added fleet is its own section, `Added vehicles`, resolved through the same
`resolveVehicleSources` and the same screenshot rules (a missing picture is reported the way a replacement
car's is). Its cards carry the `(base)` the car varies. Three tests in `catalog.test.ts`.

**The budgets, priced BEFORE any field run** (the project rule), on an APFS clone of `build/original/sa`:

| budget | spend | ceiling | left |
| --- | --- | --- | --- |
| model ids | **161** (115 cars + 46 parts), 19 001–19 161 | 999 in the window | 838 |
| FLA `TXD` pool | 5 177 → **5 338** | 6 000 (configured) | 662 |
| FLA `DFF` pool | 15 596 → **15 711** | 20 000 (its range) | — |
| vehicles archive family | 3.10 → **4.47 GB**, 2 → 3 members | the writer's spill cap | fits |
| `carcols.dat` palette | 140 → **145** | **256** since today (was 128) | 111 |
| Parked Maker `[Cars]` | **1** | 500 car generators, shared with the streamed map | see the measurement |
| `carmods.dat` parts per car | worst **15** | 16 | 1 |
| **`carmods.dat` link pairs** | **31** | **30** | **−1** |

**That last row is why `asi/perfect-vehicle` 002 was built the same day.** With `perfect-vehicle.asi` in the
tree the ceiling is 256 and the full fleet installs — **115 cars + 46 tuning parts, 6.6 s, 225 link pairs of
headroom left**. The pipeline ships the plugin into the `sa` tree before the cars go in, so a build either
has the lift or refuses; there is no middle state where 31 pairs are written against an array of 30.

**The field verdicts are collected in one round** at the end of the chain:
[`tools/add-vehicles/docs/plans/102-add-vehicles/field-checks.md`](102-add-vehicles/field-checks.md),
16 rows as of today.

## What is left of this plan

- The **field round** itself (step 4) and the **audit + benchmark numbers** (step 5) — both after the
  ceiling is lifted, because both want the full 115.
