# Three mod `.settings.txt` ide rows lack the model/txd comma → duplicate id rows in the built `vehicles.ide`

**Status: ✅ FIXED 2026-08-17, the same afternoon it was found (his call).** `splitRow` — the tokenizer every
IDE/IPL reader and the installer's column reads go through — now splits on commas AND whitespace, which is
`CFileLoader::LoadLine`'s reading; `mergeIde` replaces the first row of a model and DROPS any later twin, so
the rebake healed both trees: `--rebake original --only dodo,emperor,wayfarer` (opensa) and the same with
`--kind sa` — no duplicate ids left in either `vehicles.ide`, the three rows now carry the mods' numbers
(emperor 0.749, wayfarer 0.673). Regression: `text-lines.test.ts` (the real dodo row) + `merge.test.ts`
(no duplicate appended; a stale twin dropped). Still dropped, pre-existing and on the roadmap
(`docs/roadmap/0.6.0/plans/05-air-water-rail`): the `$ DODO` plane and `! WAYFARER` bike handling
sub-tables in those two `.settings.txt`.

## The symptom

`vehicle-installer --rebake original` refuses `dodo`, `emperor`, `wayfarer` with
`vehicles.ide id 593 already belongs to 'dodo<TAB><TAB>dodo'`. The built `data/vehicles.ide` carries the
stock row AND an appended duplicate for each (rows 228–230 of 230 in the opensa build):

```
206: 593,	dodo,		dodo, 		plane, …   0.56, 0.56,		-1     ← stock
228: 593,	dodo		dodo, 		plane, …   0.56, 0.56,		-1     ← the mod's row, model = "dodo\t\tdodo"
229: 585,	emperor		emperor, 	car,   …   0.749, 0.749,	0
230: 586,	wayfarer	wayfarer,	bike,  …   0.673, 0.673,	-1
```

## Root cause

The three mods' `.settings.txt` ide lines are missing the comma between the model and the txd column
(`593, dodo\t\tdodo, plane, …`). Our IDE row parser splits on commas only, so the model name reads as
`dodo\t\tdodo`, the merge sees a NEW model, and appends the row instead of replacing the stock one — the
mod's own numbers (wheel scale 0.749 vs 0.74, 0.673 vs 0.654) never reach the row the game reads.

**The real game tolerates the typo**: `CFileLoader::LoadLine` turns every comma into a space before the
section parsers `sscanf` the line, so `dodo\t\tdodo` reads as `dodo` + `dodo` there. That is what the
author tested against, and it is the reading we should honour (`docs/project-goals.md`: honour the DATA as
the author meant it).

## What is not known

Whether the duplicate id row does anything in the real game: the `sa` build with these rows booted and was
field-accepted 2026-08-17, so at worst SA re-registers the slot with the second row's numbers. In OpenSA
the text `vehicles.ide` is parsed at boot — which of the two rows wins there is not measured either.

## The fix (as built — see status)

Parse IDE rows the way `LoadLine` does — commas AND whitespace as separators — in the vehicle-installer
merge (`tools/vehicle-installer/src/merge.ts` / `mods-table.ts`) and wherever else an IDE row is split on
commas alone; add the three real rows as the negative fixture; then a `--rebake` of the three cars (both
kinds) removes the duplicates. Check `assertCarmodsModels`' neighbours for the same comma-only split.
