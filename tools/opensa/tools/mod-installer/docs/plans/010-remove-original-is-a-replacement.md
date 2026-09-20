# 010 — mod-installer: `Remove original/` replaces, and a placed model must be loadable

**SHIPPED 2026-08-10, FIELD-CONFIRMED the same day** — he rebuilt `sa` with the fix, installed it, and the game
plays as it should: no slowdowns, the world loads. Closes the field defect written up in
[`docs/open-issues/fixed/sa-world-loads-only-lods.md`](../../../../docs/open-issues/fixed/sa-world-loads-only-lods.md):
installing our build made the real game render the world as LODs only, with permanent hitching. One mod caused
it, and the cause was our reading of a folder name.

## The repro the user brought

Every mod up to `60. Pacific Park Rotating Ferris Wheel` installs and plays perfectly; adding that one mod
produces the symptom. Two complete installs were handed over for the diff — `NO_COMMIT/gta_sa` (working) and
`NO_COMMIT/gta_sa_bug` (broken) — which is what made the rest of this measurable rather than argued.

## What the two installs differ by

One file appears on disk (`data/maps/ferriswheel.ide`) and `gta3.img` changes by 11 entries: **+4 wheel models,
+3 TXDs, +1 col, and −5 stock DFFs** — `ferris01_LAw2`, `ferris01Tr_LAw2`, `ferseat01_LAx`, `LODris01_LAw2`,
`LODseat01_LAx`. The five removed ones are exactly the contents of the mod's `gta3_img/Remove original/`.

Their `.ide` rows (stock `LAw2.IDE`, `LAxref.IDE`) and their inst rows survive, because the mod ships no IDE or
IPL edit — it cannot, they are stock files. So the built map declares and places five models with no archive
entry:

| | working install | broken install |
| --- | --- | --- |
| declared but absent | 1 | **6** |
| of those, PLACED | **0** | **5** (23 inst rows: 21 in `law2_stream3.ipl`, 2 in `LAw2.ipl`) |

The pre-existing one is stock's `carupg_int_rays` (id 14769), **placed nowhere** — which is why one dangling
declaration had never hurt anything, and why "placed" is part of the test below rather than a detail.

## `Remove original/` names the files that REMOVE the original

We read the folder as a delete list. It is not one, and three independent measurements say so:

1. **The payloads are stubs, not backups.** All five files are the same 653-byte RW clump (type `0x10`,
   version `0x1803FFFF`) padded to one 2048-byte sector. Stock is 4 341 / 8 413 / 16 789 / 17 811 / 66 357 B of
   payload, all different. Five copies of one empty clump is a replacement set, not a reference copy.
2. **Modloader cannot delete anything.** Its own readme: it never replaces an original file, it shadows one at
   runtime, and it picks files up by bare name at any depth (`modloader/nsx/another folder/infernus.dff` is
   documented as valid). The folder sits INSIDE `gta3_img/`, i.e. in the injection path. A mod distributed for
   Modloader therefore cannot be expressing deletion — and this one works in the field.
3. **The author removed the two stubs' COLLISION.** The untouched copy of the mod carries `laxref.col` with
   **147** of stock's 148 models, missing exactly `ferseat01_LAx` and `lodseat01_LAx` — the two seat models
   whose geometry the stubs blank. Dropping the collision of an entry you delete is meaningless; dropping it
   for a model that stays declared and placed 10 times but now draws nothing is REQUIRED, or you leave an
   invisible wall.

Only one mod in the whole corpus uses the convention, so it was written for this mod alone and read backwards.

## As built

- `img-merge.ts` — `REMOVE_ORIGINAL_DIR`, `isRemoveOriginalDir` and `injectImgEntries`' `removals` parameter are
  **deleted**. The folder falls through to plan 009's organisational recursion, so its files inject by bare name.
- `bake-mod.ts` — `ModScan.removals` deleted with its special case; a `Remove original/` file is an ordinary
  asset.
- `dangling-models.ts` (new) — `findDanglingModels(gameDir)` / `checkDanglingModels(gameDir)`, called at the end
  of `install()`. Walks `gta.dat` → IDEs (`objs`/`tobj`/`anim`) for declarations, text IPLs **and** binary `.ipl`
  entries inside every archive for placements, every archive plus loose files for `.dff` availability, and
  **throws** naming each model, id, placement count and declaring IDE.
  It errs DOWNWARD: a section the IDE parser does not read is not checked, so a clean result means "none in
  `objs`/`tobj`/`anim`", never "none exist".

**Why a gate and not a warning.** The failure is global and does not point at its cause: the streaming request
cannot complete, so the world renders as LODs everywhere and hitches, which reads as a performance regression or
a map-layer bug. Four wrong axes and a day of bisection went into it. Stock passes the gate, so it can only fire
on a mod that retires a model the map still places.

## Verified

- **In the field, by the reporter, the same day.** `sa` rebuilt with the fix, installed over his game: the world
  loads and the slowdowns are gone. That is the arm the whole diagnosis was for.
- **End to end on the real corpus.** A standalone `mod-installer` run over all 60 mods (`--game
  game-src/original`) completes, and the gate at the end of `install()` does not fire — so the tree carries **0**
  declared-and-placed models it cannot stream. `gta3.img`: **16 387 entries** (the broken install had 16 382 —
  exactly the five back). All five entries are present at **1 sector each, byte-identical to the mod's stub**,
  while the mod's own `ferriswheel_wheel.dff` lands at its full 569 sectors.
- The guard on the two real installs: **0 dangling on the working one, 5 on the broken one**, reproducing the
  placement counts (`10, 10, 1, 1, 1`) independently of the analysis that found them.
- `tools/mod-installer` suite: **128 tests, 16 files, green.** The two tests that pinned the delete semantics now
  pin replacement; `dangling-models.test.ts` covers the text path, the binary-stream path, the throw, the
  declared-but-unplaced case, a stubbed entry and a loose `.dff`.

## Left open, deliberately

**The two seat models keep their collision.** On 2026-08-10 the mod's `laxref.col` was restored to a full library
(a fix for the container-replacement loss in `col-replace.ts`), which undid the author's removal. With the stub
injected, those 10 seats are now invisible obstacles on Santa Maria beach.

Honouring the author's removal instead re-triggers the thing that first exposed the mod:
`GTA_ERROR_MODEL_DOES_NOT_HAVE_COLLISION_LOADED`, which FLA has enabled on the target. So the two readings trade
an invisible obstacle against an error box, and picking between them needs a field run — not a build. Restoring
the author's 147-model file also loses `lodce_radarmast3`, which mod 25 adds to the same library.

If it is worth closing, the coherent rule is already declared by the mod's own data: `Remove original/<model>.dff`
means "this model is retired", so the installer could drop that model from col libraries as well as stub its
geometry — one declaration, both halves, no per-asset special case.
