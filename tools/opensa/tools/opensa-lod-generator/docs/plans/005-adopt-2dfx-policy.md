# 005 — The cell bake adopts the 2dfx policy

**Shipped 2026-08-07.** Came from
[07 — LOD generators, extended](../../../../docs/roadmap/0.5.0/readme.md)
(`opensa-lod-generator/01`) and moved here when it landed. Depended on
[lod-common/005](../../../lod-common/docs/plans/005-2dfx-keep-policy.md).

The smallest possible step: delete this generator's private keep-set and read the shared one instead. Nothing
about WHICH types are carried changes here.

## Context

`merge.ts` held the whole of this generator's 2dfx policy in a leaf-file literal:

```ts
/** 2dfx entry type 0 — light/corona. Cells carry only these (rotation-bearing types can't ride a raw transplant). */
const LIGHT_2DFX = new Set([0]);
```

Correct, and unreadable from anywhere else: the REASON for it lived in a comment, not in anything a second
generator could consult.

**Worth stating once, because the old plan got it wrong:** this generator's output is loaded by the OpenSA
engine only — [`restrictions/sa-target.md`](../../../../docs/restrictions/sa-target.md) records that real SA
cannot load an uncapped per-cell LOD. So nothing in this chain is gated on `asi/perfect-map`, and the "asi
target" framing the old A2 carried was a mistake.

## Decisions

1. **Replace the literal with `keepTypesFor('cell')`.** The resolved set is `{0}`, so the output does not move.
2. **Keep the reasoning WITH the policy** — the comment about rotation-bearing types now lives in lod-common's
   table, where the other generator's reader also finds it.
3. **No widening here.** A step that both refactors and changes behaviour can prove neither half.

## Tasks

- [x] `merge.ts`: drop `LIGHT_2DFX`, resolve the keep-set from the policy; the explanatory comment moved into
      lod-common's policy table.
- [x] Golden compare — see the note below on what form it took.
- [x] Grep guard: no residual private keep-set in this package.

## Verification

`npx vitest run tools/opensa-lod-generator tools/lod-common` — green; **31 files, 171 tests** re-measured
after the chain landed (170 at the time of this step, before its own negative test).

- A new negative test bakes a cell containing a model whose only 2dfx entry is a **roadsign**, through the real
  path (a real DFF, no pre-seeded cache), and asserts nothing is carried — plus that the set it read is `{0}`.
  Both halves matter: the first says the policy is obeyed, the second says which policy.
- `grep` over `tools/opensa-lod-generator/src`: the only 2dfx keep-set left in the package is the
  `keepTypesFor('cell')` call.

## Measurements / notes

**The golden compare is a set equality, not a bake.** Plan 07's working rule freezes full pmb rebuilds for the
duration of the chain, and this step does not need one: `keepTypesFor('cell')` resolves to exactly `{0}`, the
literal it replaced, asserted in the test above. Every byte the bake would emit is a function of that set and
of `transform2dfxEntry`, which was already in place and unchanged here.

**A finding from the step that follows this one, recorded here because it changes what this file's output is
FOR.** While scoping the widening
([`opensa-lod-generator/02`](../../../../docs/plans/100-2dfx-at-lod-range/00-research-and-findings.md), which died and was revived as plan 100),
the consumer turned out not to read this section at all in the shipping pipeline: `packages/cell-weld` gathers
2dfx **from HD models only** (`if (!lod)`, "LOD duplicates would double every lamp"), and `resolveMap`'s
`markCellLods` flags every instance in this generator's `lods.ipl` as `isLod`. So in the pak the cell DFF's
2dfx section is dead weight. It is still read by the direct (`loader=http-dir`) path, which is what the dev
harness boots. That does not change anything this plan did — one shared policy is right either way — but it
does mean the row that decides whether cells carry 2dfx at all is now a live question rather than a settled
one. See 02 for the evidence.
