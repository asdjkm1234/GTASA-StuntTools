# Session 18 (2026-08-17): the last two vectors of the LOD issue — one atomic per `objs` row, and DXT block alignment

**Branch `fix/map-optimizer-normals-skygfx`, 18 commits over `main`, merged into `main` 2026-08-17 after the acceptance.** What closed: vectors 2 ("the
burger joint") and 1 ("mods" — the hospital group) of
[`open-issues/fixed/sa-lod-visibility-budget.md`](../open-issues/fixed/sa-lod-visibility-budget.md), rounds 15–16, both
diagnosed with the session-17 one-model instruments and NO rebuild, both field-confirmed by one-entry swaps.
The issue's three vectors are now all fixed in code; the whole-tree rebuild + field acceptance is the user's
next step, and then the file moves to `fixed/`. Neither vector was what its label said.

## What changed

| area | change | commit |
| --- | --- | --- |
| `tools/sa-lod-generator` (`cloneLodDff`) | a multi-atomic HD is NEVER byte-copied into its LOD slot: merged to one atomic (frame transforms baked) even when the budget keeps every triangle — `mergedLods` stat. SA's `CAtomicModelInfo::SetAtomic` keeps ONE atomic of a clump read through an `objs` row, re-framed at the origin; the verbatim clone of the `anim` clump `burger01_LAw` (building + burger sign on a child frame) was the 5 m sign at the origin | `977a2c1d` |
| `tools/lod-common` (`encodeHalvedTxd`/`encodeLodTxd`) | every clone/cell/procobj texture is a power of two per side (`resampleToPow2` reused from `cell-weld` — the same 62×62 case WebGPU had) | `875cd8ed` |
| `tools/map-optimizer` (`optimizeTxd`) | any DXT texture in ANY dictionary of the tree (mods included) whose top level is not a multiple of 4 is decoded, resampled to the power of two rounded UP, re-mipped, written back in the same format — `resized` in the run summary | `875cd8ed` |
| `packages/cell-weld` (`resampleToPow2`) | `round: 'nearest' \| 'up'` parameter (default unchanged) | `875cd8ed` |
| fixtures + tests | `dff/anim-clump/burger01_law.dff` (manifest line); `clone-multi-atomic.test.ts` (4), `encode-txd.test.ts` (+1, one updated: floor is one DXT block), `textures.test.ts` (+1) | `977a2c1d`, `875cd8ed` |
| `scripts/debug` | `multi-atomic-census.ts`, `txd-dimension-census.ts`, `col-splice.ts`; `model-lab.ts` prints `merged multi-atomic` | `366b7272`, `875cd8ed`, `16eb1243` |
| `docs/gta-sa-original` | `atomic-model-one-atomic.md` — the loader read out of gta-reversed + the census (34 multi-atomic map models in stock, all `anim`, 0 `objs`) | `977a2c1d` |
| `docs/restrictions` | `assets-and-data.md`: "an `objs` LOD is ONE atomic"; **`dxt-raster-dimensions.md`** (its own file, the user's call) with the field measurement table — the fatal property is a side not divisible by 4, NOT non-power-of-two (896×828, 700×52, 128×48 load) | `977a2c1d`, `875cd8ed` |
| `docs/contracts/mods.md` | the quiet half of the `.col` rule: a whole library cut from STOCK reverts an earlier mod's fixes with no warning (mod 65 vs `0. Map Fixes Pack`, three models) — `col-splice.ts` repairs it | `16eb1243` |
| `docs/edge-cases/converter-pipeline.md` | `oilplodbitbase` is an `anim` LOD (the nodding donkey nods at 800 m in stock); our clone is static — his call | `977a2c1d` |
| `tools/sa-lod-generator/docs/plans/009` | the burger fix with its before/after numbers, CLOSED on the field | `977a2c1d`, `3bafbd53` |
| `docs/architecture/tools.md` | the two tool lines carry both rules | this audit's commit |
| data (`mods-src`, gitignored) | `65. Watts towers GTA V to SA/gta3_img/lae2_5.col` = mod 0's library + mod 65's `wattspark1_LAe2` block | — |

## What it cost, what it bought

- **Cost:** zero rebuilds. Burger joint: `model-lab --dry`, three `img-patch get`, `dump-binmesh`, one 20-line
  census, one field look. Hospital group: `img-patch get` × 8, one texture-by-texture diff of two dictionaries,
  a census, and TWO field looks (the second on the wrong tree — the capture said `bisect-nomods` when the swap
  was in `build/original/sa`; the CLAUDE.md "read `build/<game>/opensa` and nothing else" rule, in reverse).
  ~15 min of field time for both, against the two full days rounds 1–10 spent on the same models.
- **Bought:** the "~6 objects missing all over the city" scale explained exactly (five clone dictionaries + one
  mod TXD); the round-4/6 "contradiction" resolved (round 6 was an unreliable helicopter judgement of a LOD under
  another LOD); a fix that also repairs a MOD's own broken texture (the SFSE airport sign was invisible in every
  build so far); a loader fact about the original that no census had ever asked (multi-atomic + `objs` = one part
  at the origin); and two more instruments that answer in seconds.
- **Numbers:** `lodger01_law` verbatim 77 824 B / 2 atomics → 68 640 B / 1 atomic / 869 tris; stock multi-atomic
  map models 34 (all `anim`); verbatim multi-atomic clones in the old `sa` build 16; stock textures 26 004 / NPOT
  0; clone dictionaries with a non-aligned DXT texture 5 of 995 + 1 mod TXD; `bisect-nomods` after the fix
  0 fatal / 0 NPOT over 6 454 clone textures.

## Verified

- Full suite `npx vitest run`: **485 files / 4 396 tests, green**. `tsc --noEmit` clean; eslint clean on every
  touched file; prettier clean on every touched doc.
- Field, one swap at a time (his eye, 2026-08-17): burger LOD back (`bisect-nomods`); hospital + ground,
  `lod711block02`, container cranes, SFSE airport sign back (`build/original/sa`, dictionaries only); the two
  predictions (cranes, sign absent before their swap) held; the HD cranes with a 4-aligned 896×828 DXT1 render.
- Both trees carry those swaps (`img-patch.ts status --game`): `bisect-nomods` 4 entries, `build/original/sa`
  was 4 entries and is being rebuilt at the close of the session.

## Not done (deliberately, recorded)

- ~~Whole-tree rebuild + acceptance~~ — **DONE 2026-08-17: full `sa` rebuild field-accepted on every point;
  the rebuilt tree measures 0 non-block-aligned DXT textures (39 720 checked) and 0 multi-atomic clone LODs (20
  checked); the issue moved to `open-issues/fixed/`.** The build's console summary was not captured (the
  report JSON does not carry those counters), so the two census scripts are the record.
- `oilplodbitbase` (an `anim` LOD, now static) — user's call, edge-case entry.
- `encodeLodDff` blended-groups-last (session 17's follow-up) — unchanged, SILENT.
- Mod 64's collision meshes (13 312 / 17 050 / 27 671 faces per crane, against stock's 2–18 boxes) — noted to
  the user, not a pipeline defect; no measurement taken.
- No benchmark row: nothing in the frame changed; both fixes are bytes the game refused or drew wrong.
