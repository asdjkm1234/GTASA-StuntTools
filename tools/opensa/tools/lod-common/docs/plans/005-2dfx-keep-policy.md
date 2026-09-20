# 005 — One declared 2dfx keep-policy

**Shipped 2026-08-07.** Came from
[07 — LOD generators, extended](../../../../docs/roadmap/0.5.0/readme.md)
(`lod-common/01`) and moved here when it landed. Gated on nothing. The foundation of the whole 2dfx line:
make the carry policy ONE thing before adding types
([opensa-lod-generator/02](../../../../docs/plans/100-2dfx-at-lod-range/readme.md), which died and came back as plan 100)
or emitters
([sa-lod-generator/02](../../../sa-lod-generator/docs/plans/008-far-view-emitter-budget.md)).

The adoption tasks live with the generators that own them
([sa-lod-generator/007](../../../sa-lod-generator/docs/plans/007-clone-2dfx-policy.md) — scoped in the
roadmap as `sa-lod-generator/01` and superseded there by plan 100/05,
[opensa-lod-generator/01](../../../opensa-lod-generator/docs/plans/005-adopt-2dfx-policy.md))
so each generator's change is its own reviewable, byte-compared diff. What was left here is the policy itself
and the correctness bar it has to meet.

## Context

The keep-set was spelled three times, in three shapes, in three packages:

- **sa-lod verbatim** (`finalize.ts`): byte-copies HD, drops only particles → keeps coronas, roadsigns,
  escalators and every undecoded type **implicitly**.
- **sa-lod decimate** (`finalize.ts`): `build2dfxSection(collectClumpEffects(hdDff, clump))` — the function's
  default keep is all-but-particle, positions mapped through frame transforms.
- **opensa-lod cells** (`merge.ts:12`): `LIGHT_2DFX = new Set([0])` — type-0 only; roadsigns and escalators
  dropped, because a raw transplant repositions but does not re-rotate.

So a corona survived all three; a roadsign two of three; an undecoded type one of them by accident. None of
that was decided — it was three local answers to a question nobody asked globally.

## Decisions

1. **`LOD_2DFX_POLICY` in `@opensa/lod-common`: one table, one verdict per entry type** — carry /
   carry-rate-scaled / drop — plus `keepTypesFor(target)` and `verdictFor(type, target)` that resolve it.
2. **The default reproduces today exactly.** Resolving for the current targets yields `{0}` for cells and
   every type the stock corpus carries for clones. New capability arrives dormant.
3. **Undecoded types get an explicit entry too**, and a type with NO row is dropped on every target.
4. **The policy decides carry, never payload.** Transforming a payload is
   [006](006-2dfx-entry-transform.md)'s job.
5. **The policy is per-TARGET, not per-generator** (`clone` = real SA per-object copy, `cell` = the OpenSA
   engine's baked cell).

## What shipped

- `tools/lod-common/src/two-dfx-policy.ts` — the table (8 rows, each with the stock counts and a stated
  reason), `LOD_2DFX_UNLISTED = 'drop'`, `keepTypesFor(target)`, `verdictFor(type, target)`. Exported as
  `@opensa/lod-common/two-dfx-policy`.
- [`docs/2dfx-policy.md`](../2dfx-policy.md) — the living write-up: targets, the table, the two rules that
  are easy to get wrong, and what the policy deliberately does not decide.
- No call site changed. The three keep-sets above are still in place; replacing them is the two adoption
  plans' work, and they are compared against this table.

## Tasks

- [x] `LOD_2DFX_POLICY` (type → verdict, per target) + `keepTypesFor(target)` in lod-common.
- [x] Unit-test that the policy resolves to today's sets — the contract the two adoption plans are compared
      against.
- [x] Corona/light correctness fixtures on the decimate path AND the cell path.
- [x] Document the policy as the single source of truth in the lod-common docs.

## Verification

`npx vitest run tools/lod-common tools/opensa-lod-generator` — green, 7 new tests in
`two-dfx-policy.test.ts` + 1 in `opensa-lod-generator/.../merge.test.ts`. Re-measured after the whole chain
landed: **31 files, 171 tests** (the count at the time of this step was 170 — `opensa-lod-generator/005`
added the extra one).

- `keepTypesFor('cell')` = `{0}`; `keepTypesFor('clone')` = `{0,1,3,6,7,8,9,10}`, exactly the types the stock
  census found. An unlisted type (4, sun glare) resolves to `drop` on both.
- **Decimate path corona check** (`refchimny01`, 3 coronas): every carried entry's position matches the
  position the RUNTIME parser reads for the same light, mapped through its atomic's frame **by an independent
  implementation in the test** — two different readers of the same bytes agreeing, not one reader agreeing
  with itself.
- **Cell path corona check**, and this is the sharper one: a model whose light entry sits at the same
  model-local point as a triangle vertex, placed on a **rotated, off-centre instance**. The carried effect is
  asserted against the merged MESH's vertex, not against a second copy of the transform maths — so it tests
  the property the plan actually wants ("a corona is in the same place on every representation") rather than
  restating `instanceTransform`.
- No generator output moved: this plan adds a table and tests and changes no call site.

## Measurements / notes

**The policy table as shipped** is in [`docs/2dfx-policy.md`](../2dfx-policy.md) — reproduced there rather
than here because it is a living document and this is a record.

**Corona position error, HD vs both carried paths: 0** (asserted to 1e-4 on the decimate path against the
independent expectation, and to 1e-5 on the cell path against the merged vertex). Expected, and never
asserted before this plan.

Two things the plan assumed that the code did not say:

1. **Particles are KEPT on the clone by default today, not dropped.** `lod.config.ts` has
   `keepParticles: true` and the CLI opt-out is `--strip-particles` (03-asi/010 flipped it). Two doc comments
   in `sa-lod-generator` still claimed "default false strips them" — corrected in this change, because the
   next plan in the chain would have been read against them.
2. **The three keep-sets are not three targets.** Verbatim and decimate are two PATHS to the same host, so
   the table has two targets, not three, and the verbatim path is a subtractive application of the `clone`
   column rather than a column of its own. Said explicitly in the policy doc, since the plan's framing
   invited the third row.
