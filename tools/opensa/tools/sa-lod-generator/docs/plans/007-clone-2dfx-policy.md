# 007 — Every clone path resolves the shared 2dfx policy

**Shipped 2026-08-08.** Came from
[100 — 2dfx survives to LOD range](../../../../docs/plans/100-2dfx-at-lod-range/readme.md) (`100/05`) and moved
here when it landed. Depended on
[`lod-common/007`](../../../lod-common/docs/plans/007-2dfx-space-and-cell-carry.md) only — this is the real-SA
half and shares no code with the OpenSA steps. Supersedes the local keep-sets that
[005](005-strip-clone-particle-fx.md) and plan `03-asi/010` left behind.

**Read the measurement before the prose: this step changed almost nothing about stock output, and the step as
planned overstated what it would fix.** It is a consolidation — three clone paths that agreed by accident now
agree by decision.

## Context

`sa-lod-generator` is a different algorithm to a different host: it clones ONE model into a far copy (byte
copy, or QEM-decimated + re-encoded) and places it as a `lod_*` model with an IPL LOD link. **Real SA reads
2dfx off whatever model it streams**, so a clone's own section is live — no consumer change is needed on this
side, which is why this step is small and independent.

Three paths decided what rode, in three shapes:

| Path | Before | Now |
| --- | --- | --- |
| verbatim byte copy (`cloneLodDff`) | `stripParticleEffects` under `--strip-particles`, otherwise untouched | `stripCloneTo(bytes, cloneKeepTypes(…))` — SUBTRACTIVE against the policy |
| decimate + re-encode | `collectClumpEffects` default (all-but-particle), then particles **appended** when `keepParticles` | one pass over `cloneKeepTypes(…)` |
| hole-fill copy (`fill-holes.ts`) | its own `stripParticleEffects` call | the same `stripCloneTo` |

## Decisions

1. **Both keep-set questions resolve through `cloneKeepTypes`** (`adapters/gta-sa/clone-2dfx.ts`). No local
   set survives in this package. It lives in its own module rather than in `finalize.ts` because `fill-holes`
   needs it too and `finalize` already imports `fill-holes` — the other direction would be a cycle.
2. **The verbatim path applies the policy SUBTRACTIVELY.** A full re-encode would throw away the plugins the
   byte copy exists to preserve (breakable, and whatever else our writers do not model), so a rejected type is
   cut out of the copy in place. `rw-codec`'s `stripParticleEffects` became a one-line wrapper over a general
   `strip2dfxEntries(bytes, keep)`.
3. **A clone's 2dfx keeps the model's own frame**, so no space branch is needed here: SA places the clone
   where the HD model was, and a world-space roadsign is world-space in both. (This is why the OpenSA side's
   cross-cell plate problem — [100/03](../../../../docs/plans/100-2dfx-at-lod-range/03-lod-bundle-reads-2dfx.md)
   decision 3 — has no counterpart on this path.)
4. **`--strip-particles` stays** as the stock-target opt-out (an install without `perfect-map.asi`'s emitter
   fix crashes on cloned emitters — `asi/perfect-map` 009), and it now expresses itself as a policy override
   rather than as a second code path.

## Verification

`cloneLodDff` is exported for its tests: the 2dfx set a clone carries is that function's decision, and nothing
else in the package can be asked what it made of a real model's entries. Nine tests against the real refinery
chimney (`refchimny01`, three coronas beside one emitter — the only stock shape that tells "carried the
emitter" apart from "carried the coronas"):

- a verbatim clone with nothing to drop is returned **byte-identical** (`toBe`, not `toEqual`) — the byte copy
  must not re-encode when the pass removes nothing;
- verbatim and decimated clones both carry the emitter by default, and both lose it (and only it) under
  `--strip-particles`;
- the decimated assertion checks `stats.decimatedLods === 1` first, so it cannot pass on a clone that quietly
  took the verbatim branch;
- `stripCloneTo` cutting a type the policy does not name is fixtured **inverted** (keep the emitter, drop the
  coronas), because nothing stock exercises it — see the measurement.

Before this, **no test in the package touched 2dfx at all**, so the green suite said nothing about any of it.

## Measurements / notes

Over the stock corpus (14 865 models, 1851 carrying 2dfx):

- **0 models carry a type outside the clone policy.** The subtractive verbatim path therefore removes nothing
  on stock; it exists for the type a mod invents, which the policy drops by default. That is also the answer
  to the step's task "confirm no stock clone gains or loses an entry the policy did not name" — none does.
- **6 models change their clone's 2dfx entry ORDER**, and here they all are — every one has its emitter
  authored before something else:

  | Model | Authored order |
  | --- | --- |
  | `refchimny01` | `1,0,0,0` |
  | `refthinchim1` | `1,0,9×8` |
  | `vgsedragon` | `1,0,0` |
  | `rcyclbank01` | `1,9×4` |
  | `venefountain02` | `3×7,1,9×4` |
  | `laxrf_refinerybase` | `0×7,1,9×11` |

  The old decimate path emitted non-particles in document order and appended the particles, so `refchimny01`
  went out as `[0,0,0,1]`; one policy pass restores the authored `[1,0,0,0]`. Order carries no meaning to SA,
  which reads the entries in sequence — it is recorded because it is the one byte-level difference a rebuild
  will show.

**What the step claimed and got wrong.** Its context table said the decimate path carried "particles added
back only under `keepParticles`", implying emitters were being lost by default. They were not: `keepParticles`
has defaulted to true since `03-asi/010`, and the old code appended them. Nothing was losing emitters, so
nothing started carrying them — the honest description of this step is "one keep-set instead of three", and
the value is that the next type-level decision has exactly one place to be taken.
