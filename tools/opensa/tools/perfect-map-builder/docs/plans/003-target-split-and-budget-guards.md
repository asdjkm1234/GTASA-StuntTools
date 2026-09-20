# 003 — The target split, and every guard on the branch that owns it

**SHIPPED 2026-08-08.** Landed from [013 — density budgets](../../../sa-procobj-placement/docs/plans/013-density-budgets-per-target.md),
whose first two tasks these were (it was `07/04` in the roadmap chain that has since been dissolved into the
tools). The rest of 013 — the two perf budgets, the `opensa` streaming guard, the stock report — stays with
that plan, because none of it is a builder change until a measurement exists.

## Why

`sa/` and `opensa/` are independent targets of the same source tree, and the stages before the split are
SHARED. So a guard written for SA's ceilings ran on the common build and rationed a host that has none of
them: `checkTextIplSlotBudget` threw past 30 000 permanent text rows and warned at 39 IPL slots
(`pipeline.ts:206`), before either target existed. Our engine has no building pool, no int16 `IplDef` index
and no `IplEntityIndexArrays` — so an opensa-only build was refusing to carry content for a limit it does
not have, and refusing SILENTLY, because an under-built map looks exactly like a successful one
([project-goals directive 3](../../../../docs/project-goals.md)).

The escape was a manual `--allow-text-row-overflow`, i.e. an operator decision taken build by build, which
is precisely how a ceiling stays enforced by accident.

## What shipped

### The target selector

`BuildTarget` + `parseBuildTarget` live in `@opensa/tool-kit/target` — the one package every tool can reach
without a new dependency edge. pmb takes `--target`, and `resolveBuildTarget` **derives** it from `--exclude`
when it is omitted, because the exclusion set is what already declares a target in practice:
`build:game:original:opensa` resolves to `opensa` with no script change, and an operator cannot forget the
flag.

- A run that still builds `sa/` resolves to `sa` — the common chain is shared, so an `opensa` profile on it
  would price the real game's content against a host with neither int16 nor a building pool.
- `--target opensa` alongside a `sa/` build is **REFUSED at config time**, with a test per pair. The
  conservative reverse (an opensa-only build carrying the `sa` profile) is allowed and logged as leaving
  headroom on the table.

The selector's first real job is the layer's **price report**: `buildStreamedIpl` counts the permanent text
`rows` where the link is decided and `convertProcObj` returns it, so the generator prints
`procobj cost (target <t>): N objects · R permanent text rows · R/N rows/object`, naming int16 on `sa` and no
row ceiling on `opensa`. A cost read off the run, never derived from a diff.

### The guards, split by whether the target still has the ceiling

`checkTextIplSlotBudget` became `checkTextIplBudgets` (the old name gated slots; it no longer does) and runs
on the **BUILT `sa/` tree**, beside `checkImgIdBudgets`:

| Ceiling | On `sa/` | Why |
| --- | --- | --- |
| int16 permanent text rows (32 767) | **THROW** | the one ceiling no adjuster lifts — `0x404B4A` is byte-stock in OLA on the reference install. It is `perfect-map.asi`'s gate |
| 39 `IplEntityIndexArrays` slots | **REPORT** | OLA sets `EntityIpl = unlimited` on the install we ship to; the array is not there to overflow |
| both | `opensa/` runs **neither** | it has neither structure. It prints `OPENSA_BUDGET_NOTICE` instead — see below |

**Re-basing onto the built tree found a false PASS the move was not looking for**: the sa LOD stage appends
hole-fill instances to the copied text IPLs *after* the split, so the shared-build count was never the count
SA loads.

### Two things did NOT go as the plan wrote them, both deliberate

1. **`--allow-text-row-overflow` stays.** Its problem was that it escaped a ceiling the opensa target does not
   have; after the split it cannot do that, because opensa never runs the gate. What is left is the
   deliberate over-int16 `sa` build that `tools-debug/sa-int16-repro` documents — a named consumer with open
   work against it. Deleting the flag would have removed the only way to build that repro.
2. **`opensa/` got an ANNOUNCEMENT, not a guard.** The plan's decision 5 asks for a streamable-object budget,
   and that needs a number measured in OUR engine; the plan's own standard forbids the alternative ("a cap
   set from the wrong host's number is a guess wearing a measurement's clothes"). So the branch says on every
   run that it carries no ceiling and why, which turns a silent absence into a loud one. **The real guard is
   still open** and is [013](../../../sa-procobj-placement/docs/plans/013-density-budgets-per-target.md)'s line.

## Verification

- The `text-IPL slots:` line is gone from the common chain and the opensa branch prints its notice —
  confirmed with a run that excludes every stage.
- `resolveBuildTarget` has a test per (target, exclusion-set) pair, including the refused mismatch.
- `checkTextIplBudgets` has tests for the int16 throw, the slot report, and the `--allow-text-row-overflow`
  downgrade.

## What this made a rule

[`restrictions/architecture.md`](../../../../docs/restrictions/architecture.md) — *"a build asks for a
target, not for the whole pipeline"*, and its companion added 2026-08-09 after a source pointed into
`<out>/.work` (see [004](004-build-timings-and-source-overlap-guard.md)).

## Measurements / notes

- 2026-08-08, canonical `build/original/opensa`: 20 146 / 32 767 permanent rows, 38 / 40 slots — the
  measurement that showed slots binding first, before the reference install turned out to lift them.
- The procobj layer's own price at the time: 15 286 objects / 6 487 rows / 0.424 rows per object. Both
  numbers moved on 2026-08-09 when `procobj.dat` turned out to be misread
  ([sa-procobj-placement/009](../../../sa-procobj-placement/docs/plans/009-procobj-dat-columns-as-the-game-reads-them.md));
  the layer now costs 91 092 objects / 25 560 rows / 0.281 rows per object, and its map-wide total crosses
  int16 — so the `sa/` throw this plan installed now fires on a full build, exactly as designed.
- **2026-08-10 — `checkImgIdBudgets` earned its keep, and its TXD number turned out to be wrong.** The first
  `sa` build since the int16 guard was deleted completed every stage and then failed here on **522 binary
  IPL files of 280** (FLA `FILE_TYPE_IPL`): the procobj layer's `plobj*_stream*` tiles went 50 → 331 across
  the density fix. Answered by raising the install's pools (`TXD 6000 / COL 400 / IPL 1024`) rather than
  shaping the build — the full record, including why `STREAM_MAX_INST` was left alone, is in
  [sa-procobj-placement/013](../../../sa-procobj-placement/docs/plans/013-density-budgets-per-target.md).
  **The lesson is the other pool.** `IMG_ID_BUDGETS` had carried `TXD 6000` since it was written, while the
  install leaves `#FILE_TYPE_TXD` commented at FLA's default 5000 — the build measures 4999. A guard whose
  limit is HIGHER than the install's cannot fire, so the pool with one slot of real headroom was the one
  reporting comfortable headroom. **Take a pool from `fastman92limitAdjuster.log`, never from the ini** — a
  disabled line still prints a value, which is exactly how this survived a verbatim capture that quoted the
  `#` two paragraphs above its own summary.
