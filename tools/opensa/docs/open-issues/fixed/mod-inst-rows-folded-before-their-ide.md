**Status: ✅ FIXED 2026-08-22, verified on the build that carries it** (`mod-installer`
[plan 016](../../../tools/mod-installer/docs/plans/016-mod-ides-before-the-first-ipl.md)). `mergeGtaDat`
splices a mod's `IDE` refs before the first `IPL` line instead of appending them, and `assertDefinitionOrder`
fails the `sa` build on any recurrence. **The build of 2026-08-22 10:20 reports 0 late rows over its 127 384
text `inst` rows**, against 137 rows / 31 ids on the tree of the day before.

**What was NOT re-run, said plainly**: the boot with `modloader.asi` OFF — the only configuration in which the
game itself reports the fault. It is no longer the closing evidence it was written to be: the guard checks the
condition directly on every build, which is strictly stronger than one boot, and the number above is measured
on the shipped tree rather than inferred. If a modloader-off boot ever happens for another reason, an
undefined-id error at load would reopen this.

## Symptom

With `modloader.asi` disabled (a diagnostic arm on 2026-08-18), the reference install refuses to boot with
the game's undefined-id error naming **model 12780**. With modloader on, no error appears at all.

## What the data says

| Fact | Value |
| --- | --- |
| id 12780 | `fxsmoke30lit`, defined in `data/maps/missing smokes fix.ide` |
| that IDE in `gta.dat` | **line 158** — IDE #65 of 69, in the block the installer APPENDS |
| placements of 12780 | **39**, all in `las` |
| `IPL DATA\MAPS\LA\LAs.IPL` in `gta.dat` | **line 93** — 65 lines EARLIER |

`gta.dat` interleaves the two directives: stock IDEs (lines 16–80), stock IPLs (81–149), then the mods' IDEs
(150–161) and the mods' IPLs (162+).

## Why it happens

- `CFileLoader::LoadLevel` (`0x5B9030`, gta-reversed `FileLoader.cpp`) walks the file line by line: an `IDE`
  line loads object definitions **there**, an `IPL` line loads placements **there** (`MatchAllModelStrings()`
  runs once, before the first IPL). A definition that arrives later does not exist yet for a row read earlier.
- `mergeGtaDat` (`tools/mod-installer/src/gta-dat-merge.ts`) **appends** a mod's `IDE`/`IPL` refs to the end of
  `gta.dat`. Self-consistent on its own: the mod's IDE lands before the mod's own IPL.
- The IPL SLOT FOLD (`mergeModInstIpls`, [mod-installer plan 013](../../../tools/mod-installer/docs/plans/013-slot-fold-across-hosts.md))
  then moves mod `inst` rows OUT of that appended file and into stock hosts, to stay under the 40 usable
  text-IPL slots. The host is chosen by capacity — nothing considers WHERE that host sits in `gta.dat`. A row
  folded into `LAs.ipl` is therefore read at line 93 while its definition waits at line 158.

The reference install's FLA has `GTA_ERROR_ATTEMPT_TO_LOAD_OBJECT_INSTANCE_WITH_UNDEFINED_ID` enabled, so the
real game says so out loud — as long as nothing defines the id behind our back.

## Why nothing in our toolchain catches it

Every check we have looks at the SET, never at the ORDER: `dangling-models` asks whether a placed id is
defined and streamable anywhere in the tree, `assertLodLinks` / `lod-link-check.ts` resolve row indexes,
`ipl-row-census.ts` counts rows and slots. All of them pass on this tree. The one thing that would have
failed is a check that compares two positions in `gta.dat`.

## What the tree really carried — measured 2026-08-22, no rebuild

`scripts/debug/dat-order-check.ts` on `build/original/sa` (2026-08-21): **137 rows / 31 ids**, across `lae`
(63), `las` (49), `lahills` (23) and `vegase` (2), from **six** mod IDEs — `reLIT.IDE` (17 ids), `lumos.IDE`
(7), `churchlite.ide` (4), `barberpole.IDE`, `tobjmodel.IDE`, `Missing Smokes Fix.ide`. Worst is `exteriorlit`
(7394) with 51 rows; the 12780 above is second with exactly the 39 recorded here. **0 ids are undefined
anywhere**, so it is purely order. Stock: 0 findings over 9 268 rows.

## The fix, taken 2026-08-22

1. **Splice, do not append** ✅ — `mergeGtaDat` puts the mod `IDE` refs before the first `IPL` line; the `IPL`
   refs still append. The splice point is the first `IPL`, not the top of the file, so mod IDEs still land
   after every stock one and which definition wins a shared id is unchanged.
2. **Then guard it** ✅ — `checkDefinitionOrder` (`@opensa/tool-kit/dat-order`) + `assertDefinitionOrder`,
   failing the `sa` build beside `assertLodLinks` on the finished tree. Without it the fold is free to
   reintroduce this the next time a host is chosen differently. Text IPLs only: a `<area>_streamN.ipl` streams
   by distance, long after every `IDE` line has been read.
3. **Re-check with modloader OFF** — still to do, and it is what closes this file.

**Rehearsed offline instead of by a build**: the built tree's `data/` copied aside, its 12 mod IDE lines moved
before the first `IPL` — exactly what the fixed merge emits — then re-checked: **137 → 0**.

## What this is NOT

It is not the 2026-08-18 boot crash (heap corruption inside `_rpMaterialListStreamRead`, `0x74E600`): with
modloader on, the ids ARE defined and no undefined-id error appears, yet the game still dies. That hunt is
separate.
