# 00 — Research: what a LOD can carry, and what actually reads it

**The record of one killed plan and the reversal that revived it, kept as this chain's step 0.** This was
roadmap 0.5.0 plan 07's `opensa-lod-generator/02`, the item its own plan called "the visible win of the whole
2dfx line". Two measurements knocked out both of its premises and it died into `docs/postmortem/` the same
day — then, hours later, the user reversed the decision that had closed its last route and widened the scope
to both generators. It comes back here as research rather than as a plan: everything below is measured, and
the plan it feeds is [the chain readme](readme.md).

**Read this before touching any step.** It is the reason the chain has a consumer step at all.

## The goal

Carry rotation-bearing 2dfx types — roadsign (7) and escalator (10) — into `opensa-lod-generator`'s baked cell
LODs, so distant street-name plates read correctly instead of being dropped by a keep-set that only ever
carried type-0 lights.

## What killed it

**1. Roadsign positions are WORLD coordinates, not model-local.** Measured over the stock corpus
(14 865 models, `scripts/debug/two-dfx-census.ts`):

| Type | Entries | Space | Instancing |
| --- | --- | --- | --- |
| 7 roadsign | 489 in 207 models | **world, 489 / 489** | each of the 207 models is placed EXACTLY ONCE; 28 on a rotated instance |
| 10 escalator | 5 in 4 models | model-local, 5 / 5 | 2 of the 4 placed more than once (`escl_la` ×4) |
| 0 light | 2203 | model-local | — |

`cen_bit_08` sits at (−487.6, 1929.9, 67.0) with its plates at (−456.1, 2014.2), (−434.2, 2039.0),
(−530.2, 1989.4) — city coordinates. The plan's central instruction, "route each entry through
`transform2dfxEntry` with the transform it already computes", would therefore have thrown every plate about a
kilometre from where it belongs. `opensa-pack` has relied on the world-space fact since plan 076.

**2. Nothing reads a cell LOD's 2dfx section.** In every path we ship, 2dfx is gathered from HD models only:

- `packages/cell-weld/src/weld.ts` — `if (!lod) { collectLights(...); collectParticles(...) }`, and the
  roadsign weld sits in the same HD-only branch ("LOD duplicates would double every lamp");
- `tools/opensa-pack/src/convert.ts` → `collectRoadsigns` skips `instance.isLod`;
- `packages/renderware/src/map/resolve-map.ts` → `markCellLods` flags **every** instance in
  `opensa-lod-generator`'s `lods.ipl` as `isLod`, on purpose;
- both map consumers go through that welder — the pak and the in-browser `sa-map-viewer`.

So widening the cell keep-set to `{0, 7, 10}` would have produced a larger DFF and no visible change at all.

**3. The gap the plan was named for is real, and it is not in this tool.** Field run 2026-08-07 against
`build/original/opensa` (no rebuild): the pak carries **481 welded roadsigns** and plates render normally
close up, while `packages/engine/src/stream/streaming.ts` sets `HD_RADIUS 380`, `LOD_RADIUS 1000`,
`HYSTERESIS 60`. A cell drops to its LOD bundle at ~440 u and keeps drawing to 1000 u, and the text is welded
HD-only — so **between ~440 u and 1000 u a sign area draws with no text**, a 560-unit band. The defect is in
`packages/cell-weld`, not in `opensa-lod-generator`.

**4. That route was closed by decision, and then reopened.** 2026-08-07, first call: glyphs are not to be
welded into the LOD level, so the 560-unit band stood as an accepted property — which is what killed this
plan. Later the same day the user reversed it and widened the scope: **0 light, 1 particle and 7 roadsign are
all to be baked, by BOTH LOD generators.** The band is a defect again, and the fix is the chain this file now
opens. What does NOT come back is the shape the dead plan had: it aimed at `opensa-lod-generator` alone, and
findings 1 and 2 still say that alone would change nothing.

**5. Escalators never had a consumer at all.** Nothing in `packages/engine`, `packages/cell-weld` or
`opensa-pack` mentions type 10; `OscellObject`'s kinds are timed / breakable / animated / roadsign / uvScroll.
Moving steps on a baked cell is a new engine feature, not a LOD carry.

## What survives it

- [`rw-codec/001`](../../../tools/rw-codec/docs/plans/001-typed-2dfx-payload-codecs.md) — typed 2dfx payload
  codecs, shipped and byte-identical on round trip.
- [`lod-common/005`](../../../tools/lod-common/docs/plans/005-2dfx-keep-policy.md) +
  [`006`](../../../tools/lod-common/docs/plans/006-2dfx-entry-transform.md) — the declared carry-policy and
  `transform2dfxEntry`, both shipped. `006` handles rotation correctly for anything that ever needs it.
- [`opensa-lod-generator/005`](../../../tools/opensa-lod-generator/docs/plans/005-adopt-2dfx-policy.md) — the
  cell bake reads the shared policy instead of a private literal.
- The per-type coordinate-space table, now in
  [`lod-common/docs/2dfx-policy.md`](../../../tools/lod-common/docs/2dfx-policy.md), where no future carry
  decision can be taken without it.
- `scripts/debug/two-dfx-census.ts [--frames]` — the corpus denominator, kept.

## The residue, and what the chain does with it

**The cell LOD's 2dfx section is dead weight today** — `opensa-lod-generator` writes type-0 lights into every
baked cell DFF and no consumer we ship reads them. The dead plan left that as an open question ("delete the
section?"). This chain answers it the other way: [step 03](03-lod-bundle-reads-2dfx.md) makes `cell-weld`
read it, so the section stops being dead instead of being deleted.

**Escalators (10) stay out of the OpenSA line, and the reason is not distance.** `packages/engine`,
`packages/cell-weld` and `packages/engine-formats` contain no escalator code at all: the steps have never
moved in our engine, at any range. `packages/renderware` decodes the entry (plan 044) and
`apps/web/src/game-config.tsx` has a debug waypoint labelled `LS - Escalators`; that is the whole of it. The
staircase MESH draws normally — it is ordinary geometry — so what is missing is the moving-step behaviour, an
engine feature nobody has built.

**On the SA side they are a different story**, and the policy already says so: real SA implements escalators
natively and reads the entry off whatever model it streams, so the `clone` column carries type 10 and
[step 05](../../../tools/sa-lod-generator/docs/plans/007-clone-2dfx-policy.md) keeps it. "No consumer" is true of OUR engine, not of the game.
