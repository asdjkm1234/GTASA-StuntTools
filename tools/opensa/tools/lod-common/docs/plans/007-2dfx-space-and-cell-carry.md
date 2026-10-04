# 007 — The policy learns coordinate space, and cells carry 1 + 7

**Shipped 2026-08-08.** Came from
[100 — 2dfx survives to LOD range](../../../../docs/plans/100-2dfx-at-lod-range/readme.md) (`100/01`) and moved
here when it landed. Depended on [005](005-2dfx-keep-policy.md) (the keep-policy) and
[006](006-2dfx-entry-transform.md) (`transform2dfxEntry`). Landed together with
[`opensa-lod-generator/006`](../../../opensa-lod-generator/docs/plans/006-cell-bake-carries-effects.md) — see
_Verification_ for why the two could not ship apart.

## Context

[005](005-2dfx-keep-policy.md) made the carry decision one table, and its `cell` column read `{0}` because a
raw transplant could not re-orient a plate. [006](006-2dfx-entry-transform.md) removed that reason —
`transform2dfxEntry` re-orients. What the table still did not carry is the fact that decides which transform
is even correct: **a type's coordinate space.** It lived in prose in `docs/2dfx-policy.md` and in nothing a
caller could read.

That matters here because the three carried types disagree:

| Type | Space | What a cell bake must do with it |
| --- | --- | --- |
| 0 light | model-local | instance transform (what it does today) |
| 1 particle | model-local | instance transform |
| 7 roadsign | **WORLD** (489/489) | subtract the cell origin, **do not** apply instance rotation or position |

## Decisions

1. **`space: 'model' | 'world'` became a field on the policy row**, not a comment. A carry decision without it
   is a plate a kilometre from its post — the failure the dead plan would have shipped.
2. **The `cell` column becomes `carry` for 1 and 7.** Type 10 stays `drop`: nothing consumes an escalator at
   any range, and a LOD cannot carry what nothing draws.
3. **The `clone` column does not change.** SA reads 2dfx off the model itself, so a clone's carry is already
   correct — step 05 is about the decimate path, not about the table.
4. **A world-space entry skips the geometry FRAME too**, which the step as written had not foreseen. The
   position is already a city coordinate, so nothing model-side may move it — `collectClumpEffects` now hands
   such an entry the identity transform. Stock never notices (all 207 roadsign-carrying atomics hang off an
   identity frame, measured), and a mod's frame would have moved a plate silently.
5. **The unlisted-type space is `model`.** Moot — an unlisted type is dropped on every target — but it keeps
   an unknown entry attached to the instance it was authored on rather than loose in the world.

## What shipped

- `Lod2dfxRule.space`, the `Lod2dfxSpace` type, `LOD_2DFX_UNLISTED_SPACE` and `spaceOf(type)` in
  `src/two-dfx-policy.ts`; `cell` flipped to `carry` for types 1 and 7.
- `collectClumpEffects` branches on `spaceOf` before applying a frame.
- `docs/2dfx-policy.md`: the space column moved into the main table, its evidence table now covers all eight
  types, and the stale "cell drops 7 until something re-rotates it" reasoning is gone.
- **`scripts/debug/two-dfx-space.ts`** — the script that measures the column, kept per the debug-script rule
  and registered in `docs/debug/README.md`. The space fact had been measured twice by throwaway probes
  already; a table column deserves a re-runnable denominator.

## Verification

- `keepTypesFor('cell')` = `{0, 1, 7}`; `keepTypesFor('clone')` unchanged; `spaceOf(7) === 'world'` and every
  other carried type `'model'`. 10 tests in `two-dfx-policy.test.ts`, whole suite green.
- **The step's own claim that "no generator output moves on this step alone" was WRONG**, and that is why it
  did not ship alone. `opensa-lod-generator`'s `merge.ts` reads `keepTypesFor('cell')` directly (that was the
  point of `opensa-lod-generator/005`), so flipping the table changes bake output in the same commit —
  including routing a world-space plate through the instance transform, the exact kilometre bug. The
  consumer-side branch therefore landed with it. _A plan's assumption about code it has not read is a
  hypothesis._

## Measurements / notes

**The space column, measured** (`scripts/debug/two-dfx-space.ts --game original`, 14 865 models, 0
unreadable). Each entry is scored twice — distance from its model's origin, distance from the nearest
placement of that model — and the verdict is which is smaller, so it is a comparison rather than a threshold.
**Unanimous per type**, and every per-type total reconciles with `two-dfx-census.ts`:

| Type | model-local | world | unplaced | verdict |
| --- | --- | --- | --- | --- |
| 0 light | 2094 | 0 | 109 | model |
| 1 particle | 57 | 0 | 7 | model |
| 3 ped attractor | 916 | 0 | 0 | model |
| 6 enter/exit | 75 | 0 | 3 | model |
| 7 roadsign | 0 | **489** | 0 | **world** |
| 8 trigger point | 33 | 0 | 0 | model |
| 9 cover point | 14 871 | 0 | 136 | model |
| 10 escalator | 5 | 0 | 0 | model |

The margins are not marginal: `des_geysrwalk2`'s emitter is 10.0 u from its model origin and 1879.2 u from its
placement; `cen_bit_08`'s first plate is 2066.1 u from its origin and 90.2 u from its placement.

**Roadsign-carrying atomics with a non-identity frame: 0 of 207** — the measurement behind decision 4.
