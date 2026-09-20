# Translucent cluster agglomeration: O(n³) → O(n²)

**Date:** 2026-08-19 · **Tool:** `@opensa/renderware` (`vehicle/translucent-clusters.ts`), used by
`opensa-pack`'s model bake · **Machine:** the dev Mac (darwin 25.6.0, node 24.15.0) · **Inputs:** the
committed fixtures, `fixtures/original/mods/ferriswheel_lights.{dff,txd}` (3.70 MB / 3.02 MB).

## Why this run exists

`tools/opensa-pack/src/model-osm-uv-anim.test.ts` had been the suite's only red for four sessions: 3.7 s
alone, over vitest's 5 000 ms default under full-suite load. Profiling it (`node:inspector` in-process,
because the vitest CLI does not take `--cpu-prof`) put **3 317 ms of 3 628 ms — 91 % — in one function**,
`closestPair`. Not a test problem: the agglomeration re-scanned every cluster pair before every merge, and
the Pacific Park ferris ring is **1 440 separate bulbs (50 400 triangles) in ONE material group**, so it ran
~1 430 merges over a shrinking O(n²) scan.

## The measurement

Same input set, both implementations in one process, synthetic rings of `n` disjoint pieces:

| pieces | before (naive re-scan) | after (cached nearest) | ratio |
| ---: | ---: | ---: | ---: |
| 100 | 4 ms | 1.9 ms | ×2 |
| 200 | 8 ms | 2.3 ms | ×3 |
| 400 | 54 ms | 3.6 ms | ×15 |
| 800 | 462 ms | 9.2 ms | ×50 |
| 1 440 | 3 238 ms | 24.9 ms | ×130 |

The curve is the point, not any single row: `before` grows ×8.6 for a doubling (400→800) and ×7.0 for a
1.8× (800→1440) — cubic. `after` grows ×2.6 and ×2.7 for the same steps — quadratic.

On the real asset, through the whole model bake:

| | before | after |
| --- | ---: | ---: |
| `buildModelOsm(ferriswheel_lights)` | 3 700 ms | ~370 ms |
| the test's positive case, alone | 3 745 ms | **412 ms** |
| the same under full-suite load | 7 800 ms (timed out at 5 000) | comfortably inside the default |

`readModelOsm` was 0 ms before and after — the round trip was never the cost.

## What was NOT measured

**The effect on a full pak build.** A `sa` stage is ~10 min and an `opensa` chain far longer, and the gain
depends entirely on how many models carry many-component translucent groups — which nobody has counted. The
honest claim is the one above: this model, and the complexity class. No pipeline figure is claimed.

## Verification that the output did not move

The pre-change implementation was run BESIDE the new one on every call, asserting the cluster grouping
byte-for-byte (group count, order, and each group's triangle indices), across the **whole suite: 503 files /
4 605 tests, zero mismatches**. The merge order is preserved deliberately — ties fall to the lowest row then
its lowest partner, which is exactly what the plain `i < j` double scan picked.

Suite after the change, A/B removed: **503 files / 4 605 tests green** — the first fully green full run since
session 22. `tsc --noEmit` and `eslint` clean.
