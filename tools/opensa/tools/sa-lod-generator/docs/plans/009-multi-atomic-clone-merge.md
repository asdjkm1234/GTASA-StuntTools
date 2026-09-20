# 009 — A multi-atomic HD is merged into one atomic, never byte-copied

> **Status: CLOSED 2026-08-17 — field-confirmed on the one-model swap ("fixed").** Out of open issue
> [`sa-lod-visibility-budget.md`](../../../../docs/open-issues/fixed/sa-lod-visibility-budget.md) round 15 — vector 2,
> "the burger joint".

## What was wrong

`cloneLodDff` fell back to the **verbatim byte-copy** of the HD whenever the budgeted decimator rejected every
target (or decimation was off). For an HD that is an `anim` clump — several atomics under a frame hierarchy —
that copy landed behind an `objs` LOD row, and SA's `CAtomicModelInfo` keeps exactly ONE atomic of a clump it
reads: `SetRelatedModelInfoCB` → `SetAtomic` overwrites for every atomic, the last visited survives (RW walks the
clump list in reverse file order, so the FIRST atomic in the file), re-framed at the origin
([`gta-sa-original/atomic-model-one-atomic.md`](../../../../docs/gta-sa-original/atomic-model-one-atomic.md)).

`burger01_LAw` (LAw.ide, `anim` row): atomic 0 = the 336-triangle burger sign on child frame `burger01_LAw3` at
(7.18, −7.30, 1.01), atomic 1 = the 752-triangle building. The verbatim clone `lodger01_law` was that sign,
alone, at the building's origin — the field's "LOD absent". Same shape on 16 LOD entries of `build/original/sa`.

## Measured before the change (2026-08-17)

| tree | `lodger01_law` | atomics | tris | field |
| --- | --- | --- | --- | --- |
| stock | authored LOD, 18 432 B | 1 | 316 | — |
| `bisect-nomods-noopt` | decimated clone, 69 632 B | 1 | 870 | present |
| `bisect-nomods` / `build/original/sa` | verbatim clone (`cmp` = HD), 77 824 B | **2** | 1 088 | **absent** |

Why the two trees differ: the decimator accepted a target for the un-optimized HD and rejected every one for the
optimized HD (normals + trilist re-encode change the preview diff); only the fallback differed.

Census over stock `gta3.img` (`.tmp-multi-atomic.ts`, deleted): 34 multi-atomic models behind IDE rows, all
`anim`; 0 `objs`. Of those with a per-object clone LOD in `build/original/sa`: 16 entries verbatim multi-atomic
(`lodger01_law`, `lod_cn2ringking`, `oilderricklod01..07`, `lodbs_building_sfs`, `lodcandysign1`,
`lodboigashot10/15/23/25`, `lodckpole`, `lodprtlstation03`, `lodboigashotlawn`, `oilplodbitbase`), 1 decimated
(`lodage_sfw`).

## The change

`cloneLodDff` parses the HD first; a clump with more than one atomic takes the mesh path unconditionally —
`buildClumpMesh` (per-atomic frame transform baked = the animation's rest pose) → `encodeLodDff` — decimated
when the budget allows, **merged undecimated** otherwise (`BuildStats.mergedLods`, printed by the CLI). The
verbatim path is untouched for single-atomic HDs. `mergedLods` also covers `decimateBudget 0`.

Test: `clone-multi-atomic.test.ts` on the real `fixtures/original/dff/anim-clump/burger01_law.dff` (fixture added
to `scripts/test-fixtures.ts`): never verbatim with decimation off, never verbatim when the budget rejects
everything, 752 + 336 triangles kept, the sign's first vertex found at its frame-transformed position.

## Measured after (one-model, `model-lab.ts burger01_LAw --tree build/bisect-nomods/sa --src build/bisect-nomods-noopt/sa`)

`lodger01_law` → 68 640 B, **1 atomic, 869 triangles**, 9 splits (all 9 materials of both atomics), bbox
±11.1 × ±17.8 × ±7.4 — the building's, with the sign inside it. Patched into `build/bisect-nomods/sa` (with the
HD `chain` variant); `img-patch.ts status --game` lists 4 entries. **Field verdict (2026-08-17): fixed — the LOD is back.**

Full-tree (2026-08-17 rebuild, field-accepted): `multi-atomic-census.ts --tree build/original/sa` — 20 clone LODs of
multi-atomic HDs, **0 with more than one atomic** (16 before).

## Not decided here

`oilplodbitbase` is an `anim` LOD (the nodding donkey's arm nods at 800 m in stock); the clone — verbatim before,
merged now — is static. Recorded in `docs/edge-cases/converter-pipeline.md`; leaving `anim`-row LODs stock is
the user's call.
