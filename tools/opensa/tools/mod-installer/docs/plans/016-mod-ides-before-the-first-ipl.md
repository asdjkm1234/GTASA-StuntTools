# 016 — A mod's IDE refs are spliced BEFORE the first `IPL` line, and the order is guarded

**Status: DONE 2026-08-22 — built, and verified on the `sa` build that carries it (0 late rows of 127 384).**
Closes
[`docs/open-issues/mod-inst-rows-folded-before-their-ide.md`](../../../../docs/open-issues/fixed/mod-inst-rows-folded-before-their-ide.md).

## The defect

`CFileLoader::LoadLevel` (`0x5B9030`) walks `gta.dat` line by line: an `IDE` line loads object definitions
THERE, an `IPL` line loads placements THERE. A model defined further down does not exist yet for a row read
earlier, and the game refuses that row —
`GTA_ERROR_ATTEMPT_TO_LOAD_OBJECT_INSTANCE_WITH_UNDEFINED_ID`, which the reference install's FLA has enabled.

Two of our own decisions meet to produce it:

- `mergeGtaDat` **appended** a mod's `IDE` and `IPL` refs at the end of `gta.dat`. Self-consistent alone — the
  mod's IDE lands before the mod's own IPL.
- The IPL slot fold ([013](./013-slot-fold-across-hosts.md)) then moves the mod's `inst` rows OUT of that
  appended file into stock hosts, to stay under the 40 usable text-IPL slots. **The host is chosen by capacity;
  nothing looks at where it sits in `gta.dat`.** A row folded into `LAs.ipl` is read at line 93 while its
  definition waits at line 158.

Nothing caught it because every check we own asks whether a placed id is defined ANYWHERE — `dangling-models`,
`assertLodLinks`, the IPL census — and it always is. And the reference install hides it: modloader supplies the
same mod IDEs itself, early.

## What the tree actually carried (measured 2026-08-22, no rebuild)

`build/original/sa` of 2026-08-21, via `scripts/debug/dat-order-check.ts`:

| | |
| --- | ---: |
| text `inst` rows | 127 384 |
| rows placed before their definition | **137** |
| distinct ids | **31** |
| ids defined nowhere at all | 0 |

Across four stock IPLs — `lae` 63 rows, `las` 49, `lahills` 23, `vegase` 2 — from **six** mod IDEs, not the one
the issue had named: `reLIT.IDE` (17 ids), `lumos.IDE` (7), `churchlite.ide` (4), `barberpole.IDE`,
`tobjmodel.IDE`, `Missing Smokes Fix.ide`. The worst single id is `exteriorlit` (7394) with 51 rows; the issue's
`fxsmoke30lit` (12780) is second with **39** — exactly the number recorded there, which is the cross-check that
the instrument counts what the issue counted.

Stock reports **0** over its 9 268 rows, so any finding on a built tree is ours.

## The fix

1. **`mergeGtaDat` splices** (`tools/mod-installer/src/gta-dat-merge.ts`): the accumulated `IDE` refs go in
   before the first `IPL` line of `gta.dat`; the `IPL` refs still append. **The splice point is the first
   `IPL`, not the top of the file** — mod IDEs still land after every stock one, so which definition wins a
   shared id is unchanged.
2. **`checkDefinitionOrder`** (`tools/tool-kit/src/dat-order.ts`, exported as `@opensa/tool-kit/dat-order`)
   resolves every text `inst` row against the `gta.dat` position of the IDE defining its model, and
   **`assertDefinitionOrder`** fails the `sa` build with it, next to `assertLodLinks` on the finished tree —
   because the fold, the LOD stages and the mod merge all rewrite these files, and the order is only whole at
   the end. Without the guard the fold is free to reintroduce this the next time a host is chosen differently.
3. `scripts/debug/dat-order-check.ts` for any tree, no build required.

**Text IPLs only, deliberately**: a `<area>_streamN.ipl` inside the archives is streamed by distance, long
after level load has read every `IDE` line, so its records cannot be early. **`sa` only**: the OpenSA target
does not load `gta.dat` this way.

## Verification

- Unit: 3 negative + 3 positive cases on the checker (including *an id defined nowhere is the dangling check's
  business, not this one* and *the FIRST definition owns the position*), plus a real-tree case pinning stock at
  zero; 2 new cases on `mergeGtaDat` for the splice point and the IDE order within it.
- **Offline rehearsal of the fix on the real tree**: the built `sa` tree's `data/` copied aside, its 12 mod IDE
  lines moved before the first `IPL` — exactly what the fixed merge emits — then re-checked: **137 → 0**.
- **On the build that carries it** (2026-08-22 10:20): `checkDefinitionOrder` reports **0** over 127 384 text
  `inst` rows, against 137 / 31 ids the day before, and the guard's cost is 0.73 s wall.
- A boot with `modloader.asi` OFF was NOT re-run. It is no longer the closing evidence it was written to be:
  the guard checks the condition directly on every build, which is stronger than one launch, and the number
  above is measured on the shipped tree.

## Ledger

| Step | Date | Result | Numbers |
| --- | --- | --- | --- |
| checker + guard + splice | 2026-08-22 | built, suites green, offline rehearsal 137 → 0 | built tree 137 rows / 31 ids; stock 0 / 9 268 rows |
| first build carrying it | 2026-08-22 | clean | **0** late rows of 127 384; guard 0.73 s |
| modloader-off boot | — | not re-run, and no longer required | the guard supersedes it |
