# The LOD 2dfx carry-policy

**The single source of truth for whether a 2d-effect entry rides onto a LOD.** The code is
`src/two-dfx-policy.ts` (`@opensa/lod-common/two-dfx-policy`); this page is the reasoning behind it. Shipped
by [plan 005](plans/005-2dfx-keep-policy.md).

The policy answers **carry or drop**, and states one fact a carrier cannot work without — the **coordinate
space** the type's position is authored in. It never touches a payload: rewriting an entry's position or
orientation is `transform2dfxEntry`'s job, keeping the raw bytes byte-verbatim is `@opensa/rw-codec/dff`'s,
and choosing WHICH transform to hand over is the caller's, branching on `spaceOf(type)`.

## Targets

Keyed by the **host the output feeds**, not by the generator that writes it — two generators feeding the same
host would otherwise carry the same fact in two rows.

| Target | Written by | Host |
| --- | --- | --- |
| `clone` | `sa-lod-generator` | real San Andreas: a per-object far copy of one model, verbatim or decimated |
| `cell` | `opensa-lod-generator` | the OpenSA engine: one baked mesh per map cell, many instances merged |

## The table

Counts are stock `original` (`scripts/debug/two-dfx-census.ts`, 14 865 models) — entries / models carrying at
least one.

| Type | Name | Stock | Space | `clone` | `cell` | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | light | 2203 / 327 | model | carry | **carry** | Distant night city lights are why 2dfx rides a LOD at all — and the first type a baked cell ever carried. |
| 1 | particle | 64 / 43 | model | carry-rate-scaled | **carry** | A chimney whose factory draws to 1000 u and whose plume stops at the HD boundary is the defect [plan 100](../../../docs/plans/100-2dfx-at-lod-range/readme.md) exists to fix. `--strip-particles` stays the stock-target opt-out; how MANY a far view may run is the rate budget plan 07 owns. |
| 3 | ped attractor | 916 / 266 | model | carry | drop | Carried because the clone paths carry it today. Nothing in our engine reads a ped attractor at any range — a candidate for the first MEASURED clone-side drop. |
| 6 | enter/exit | 78 / 71 | model | carry | drop | As type 3. |
| 7 | roadsign | 489 / 207 | **world** | carry | **carry** | The visible win of the chain: street-name text used to stop at the HD boundary and leave a blank plate out to 1000 u. Its world space is what makes the carry a re-base by the cell origin and never by the instance transform. |
| 8 | trigger point | 33 / 7 | model | carry | drop | As type 3, and the rarest of them. |
| 9 | cover point | 15 007 / 1210 | model | carry | drop | As type 3, and the bulk of the corpus by count — whatever it costs to carry, it costs 15 000 times. |
| 10 | escalator | 5 / 4 | model | carry | **drop** | `clone` carries it because real SA implements escalators and reads the entry off the model it streams. `cell` does not, and not for a distance reason: our engine has no escalator code at all ([plan 101](../../../docs/plans/101-escalators/readme.md) builds it). |
| *any other* | — | 0 | model | **drop** | **drop** | See below. |

## A type's coordinate SPACE is not the same question as its verdict

`scripts/debug/two-dfx-space.ts` scores every entry twice — how far it sits from its model's origin, and how
far from the NEAREST placement of that model — and the two never come close to each other, so the verdict is
a comparison rather than a threshold. Over the stock corpus (14 865 models, 2026-08-07) it is **unanimous per
type**, and its per-type totals reconcile with the census exactly:

| Type | Space | Evidence |
| --- | --- | --- |
| 0 light | model-local | 2094 judged / 2094; 109 more in models no IPL places |
| 1 particle | model-local | 57 / 57 (+7 unplaced) — `des_geysrwalk2`'s emitter is 10 u from its origin and 1879 u from its placement |
| 3 ped attractor | model-local | 916 / 916 |
| 6 enter/exit | model-local | 75 / 75 (+3 unplaced) |
| 7 **roadsign** | **WORLD** | **489 / 489**. `cen_bit_08` sits at (−487.6, 1929.9) and its plates at (−456.1, 2014.2), (−434.2, 2039.0), (−530.2, 1989.4) — city coordinates. Every one of the 207 sign-carrying models is placed EXACTLY ONCE, which is what makes baking world coords into a model work at all. |
| 8 trigger point | model-local | 33 / 33 |
| 9 cover point | model-local | 14 871 / 14 871 (+136 unplaced) |
| 10 escalator | model-local | 5 / 5. Two of the four models are placed more than once (`escl_la` ×4), so escalators genuinely need a per-instance transform. |

So a roadsign carried into a cell-relative representation moves by `world − cellOrigin` and keeps its authored
rotation; applying an instance transform to it is a bug, not a refinement. `opensa-pack` has relied on this
since plan 076, and `packages/renderware/src/roadsign/glyph-quads.ts` states it in its header.

**A world-space entry also skips the geometry FRAME**, for the same reason: the position is already a city
coordinate, so nothing model-side may move it. In stock this is moot — all 207 roadsign-carrying atomics hang
off an identity frame (measured 2026-08-07) — but a mod's need not, and the failure would be silent.

## The two rules that are easy to get wrong

**A type with no row is dropped, on every target.** The stock corpus carries only the eight types above, so
this changes nothing there — it is the rule for a type a mod invents, or one Rockstar used somewhere nobody
has looked. Dropping an unknown effect at LOD range is the conservative half of the trade, and it is a
DECISION here rather than an accident of which path happened to byte-copy.

**`carry-rate-scaled` is `carry` until the thinning exists.** `keepTypesFor` includes it: the scaling applies
to the payload, not to whether the entry rides. It is recorded now so the intent does not live only inside a
generator's CLI flag.

## What the policy deliberately does NOT decide

- **Payload transforms** — see `transform2dfxEntry`.
- **The verbatim byte-copy path.** `sa-lod-generator` clones some models by copying the DFF whole, which
  carries every type in the file including ones with no row. The policy applies there SUBTRACTIVELY (strip
  what is `drop`), and how far that goes is that generator's plan to decide and measure, not this table's.
- **Per-model exceptions.** There are none, and there should be none: a rule that names an asset stops being
  true the moment a mod replaces it.
