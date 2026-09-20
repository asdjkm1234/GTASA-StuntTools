# 006 — The cell bake carries lights, emitters and plates

**Shipped 2026-08-08.** Came from
[100 — 2dfx survives to LOD range](../../../../docs/plans/100-2dfx-at-lod-range/readme.md) (`100/02`) and moved
here when it landed. Landed together with
[`lod-common/007`](../../../lod-common/docs/plans/007-2dfx-space-and-cell-carry.md), which it cannot ship
without — and which cannot ship without it, since this tool reads the policy directly.

## Context

`collectCellLightEffects` (`adapters/gta-sa/merge.ts`) gathers the cell's 2dfx and hands it to
`build2dfxSection`, which writes one section into the baked cell DFF. It already read the shared policy
([005](005-adopt-2dfx-policy.md)) and already routed every entry through `transform2dfxEntry`. With
`lod-common/007` widening the set from `{0}` to `{0, 1, 7}`, two things were missing: the per-space transform
choice, and the dedup a world-space type needs.

## Decisions

1. **Transform per SPACE, not per type.** `spaceOf(type) === 'model'` → the instance transform it computes
   today; `'world'` → a translation by `−cellOrigin` only, with an identity rotation so
   `transform2dfxEntry` leaves the plate's authored facing byte-verbatim. One branch, driven by the table, so
   a future type inherits the right behaviour by declaring its space.
2. **A world-space entry is deduped by MODEL within the cell, not emitted per instance.** A roadsign's
   coordinates are the same for every placement of its model — that is why `opensa-pack` dedups by model id in
   its own pre-pass. Emitting one per instance would stack N identical plates. Stock makes this nearly moot
   (all 207 sign-carrying models are placed exactly once), but a mod is not stock, and stacking is silent.
3. **A model-local entry stays per-instance.** Two chimneys are two plumes. The per-model memoisation cache
   stays untransformed, as it was.
4. **The name stops lying**: `collectCellLightEffects` → `collectCellEffects`.
5. **No thinning here.** How far an emitter draws is
   [100/04](../../../../docs/plans/100-2dfx-at-lod-range/04-authored-cull-distance.md)'s business and how many
   a far view may run is plan 07's rate budget; this step carries what the policy says and counts what it
   carried.
6. **A plate stays with its POST, not with its own coordinates** — see the measurement below. It is baked into
   the cell holding the instance that carries it, even when its world position lands in a neighbouring cell
   (131 of 489 do). Gating a sign's text on the residency of the sign's own model is the behaviour we want;
   re-homing it by coordinate would separate the text from the object it belongs to.

## Verification

- Baked cells gain type-1 and type-7 entries; type-0 output is unchanged (its path is byte-identical — the
  same instance transform, the same memoised entries).
- A plate lands at its authored world position minus the cell origin, on a ROTATED off-centre instance, with
  its 88-byte payload returned verbatim; two placements of one sign model yield ONE plate; two placements of
  an emitter-carrying model yield TWO emitters at their own positions. `merge.test.ts`, whole suite green.
- No consumer sees any of it yet — that is
  [100/03](../../../../docs/plans/100-2dfx-at-lod-range/03-lod-bundle-reads-2dfx.md).

## Measurements / notes

**What a full bake now carries** — computed over the stock map at the engine's 250 u grid without running a
bake (no rebuild had been taken at the time; the rule that deferred it was lifted 2026-08-08 in favour of a
[capture manifest](../../../../docs/roadmap/0.5.0/readme.md#working-rules-while-this-plan-runs)):

| Type | Entries | Cells |
| --- | --- | --- |
| 0 light | 22 366 | 321 |
| 1 particle | **878** | 112 |
| 7 roadsign | **489** | 162 |

376 cells carry any effect at all, 23 733 entries in total: **+1367 entries over the 22 366 lights baked
before this step (+6.1 %)**, spread over a per-cell median of 34 and a maximum of 352. The 489 plates are the
whole authored corpus — the per-cell dedup removes nothing in stock, exactly as predicted, because each of the
207 sign-carrying models is placed once.

**131 of the 489 plates sit outside the cell of the instance carrying them** (27 %) — at a 250 u grid a plate
is authored up to a cell away from its post. This decides nothing about where the plate DRAWS (its world
position is unchanged either way); it decides which cell's residency gates it. Decision 6 keeps it with the
post. Worth re-reading if [100/03](../../../../docs/plans/100-2dfx-at-lod-range/03-lod-bundle-reads-2dfx.md)
finds a plate popping with the wrong cell.

- cell DFF size delta: not measured — no bake was run (see the standing rule above). The entry count above is
  the honest proxy; the byte delta lands with the chain's single rebuild.
