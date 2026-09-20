# A LOD link that no longer points at its own LOD (`gaz9_law`), and two reports it does NOT explain

**Status: ✅ FIXED 2026-08-16 — one cause, two effects, 11 broken links map-wide, now 0 and guarded.**
The fix is [mod-installer plan 012](../../../tools/mod-installer/docs/plans/012-stream-merge-lod-space.md).
**Two of the three original field reports stay unexplained**: `laehospital1` and `road_lawn33` resolve their
links cleanly and always did, so if the field still sees them without LODs it is a different defect.

> **Corrected twice, and both corrections are kept — they are the point of this file.**
>
> 1. **2026-08-11 (same evening).** The first version blamed all three reports on a shifted row index and named
>    `laehospital1` as the proof. It compared STOCK's link value against the BUILT file. Read from one tree,
>    `laehospital1`'s link is 132 and lands on `LODxhospital1`, its own footprint: the merge's rebase held.
> 2. **2026-08-16.** The version after that called `LAw.ipl`'s misaligned tail a SECOND, separate defect —
>    "no mod ships `LAw.ipl` or a `LAw.ipl.merge`; this is ours". Both halves were wrong.
>    `0. Map Fixes Pack` ships `data/maps/la/LAw.IPL.merge`, and the misaligned tail is not a pass of ours
>    losing a column: it is `sa-lod-generator` faithfully copying transforms through a link that was already
>    one row off. **One cause, two symptoms** — and the second symptom is the one that made the first look
>    impossible to explain.

## Symptom

Buildings and roads on the `sa` build render with **no LOD at all**. Field-confirmed by the user (his words:
only the ones he happened to see, not the full set):

| model | txd | position | verdict |
| --- | --- | --- | --- |
| `gaz9_law` | `venice_law` | 721.4, −1458.8, 18.7 | **CONFIRMED, root cause found, FIXED** |
| `laehospital1` | `hospital_lae` | 2050.1, −1401.2, 41.7 | chain intact — still unexplained |
| `road_lawn33` | `roads_lawn` | 797.5, −1234.4, 17.7 | chain intact — still unexplained |

## The mechanism

**A SA text IPL's LOD link is a ROW INDEX into the `inst` section, not a name.** Change the row order and
every index at or after the change points at a different object — silently, because the new target is a valid
row. The binary stream IPLs inside `gta3.img` carry indices into the area's TEXT file, so a text row that
moves also breaks LODs for objects that are not in that file at all.

The build handles the mod-merge case correctly, and it was measured to: `removeInstWithRebase` decrements
every surviving `lod > removed` and `patchAreaStreams` rewrites the `lod` field of every 40-byte INST record
in each `<area>_streamN.ipl`. `5. SA Xbox Map Features` removes `LODroadbnj` from `LAe.ipl` at index 93 and
`laehospital1`'s stream link comes out **133 → 132**, landing on `LODxhospital1` exactly as it should.

## The cause: a stream `.merge` writes the AUTHOR's row index over that rebase

`0. Map Fixes Pack` removes inst row 150 of `LAw.IPL` (`LODcanhou01_LAx`). The installer rebases the text
links and the area's streams — `gaz9_law`'s link 158 → 157, correct. Then the SAME pack's
`gta3_img/law_stream2.ipl.merge` runs (stream merges apply last, by design) and writes:

```
- 6133, 0, 721.4375, -1450.9453125, 10.1953125, …, 157       ← the entry as the installer has it: correct
+ 6133, 0, 721.4375, -1450.9453125, 10.19530963897705, …, 158    ← the author's index, never re-expressed
```

The author's own file also gained a row before that point, so THEIR `LODgaz9_law` sits at 158 while ours sits
at 157 — we append added rows at the end. 158 in the built file is a stock tree the same pack exiles to
z = −300. The game asked for a LOD and got a sunken tree.

**The second symptom follows from the same number.** `sa-lod-generator`'s `retargetLodTransforms` reads these
links to copy an HD instance's transform onto its cloned LOD's row. One row off, it wrote three `LAw.ipl` rows
with a neighbour's transform (in float64, with a re-derived quaternion — the "signature" the earlier version
of this file went hunting for). `LODgaz9_law` ended up 398.7 u from its building. Nothing rewrote a column;
one bad index was read twice.

**Why it was never caught.** `generateStreamMerge` has always taken the area's author→final index map, and the
text path is measured correct — but **nothing in the repo ever called it**. The shipped stream merges came
from an ad-hoc script that no longer exists, with the remap left at its identity default.

## Measured, before and after

| tree | lod links | not resolving onto their owner |
| --- | --- | --- |
| `game-src/original` (stock) | 6 103 | 0 |
| `build/original/sa` before (2026-08-15) | 14 818 | **11** |
| `build/original/sa` after (2026-08-16) | 14 818 | **0** |

The 11: `gaz9_law` → an exiled tree 282.3 u away; `vencanhou01_LAx` ×3 in `law_stream2/3/4` (20.3–140.4 u);
`BillBd1`/`BillBd2` ×7 in `law2_stream1` (23.7–60.7 u, shifted the other way). 15 `.merge` pairs carried a
shifted index in total; all 15 resolve onto their owner at 0.0 u once the shift is dropped.

## What now catches it

`npx tsx scripts/debug/lod-link-check.ts <game-dir>` resolves every link of a tree — text and binary stream —
and reports the ones whose target does not stand where its owner stands. The same check is a **hard build
guard** on the finished `sa` tree, so a fresh break fails the build instead of reaching the field. Stock
reports zero, which is what makes any finding ours.

Its limit, stated because a guard read as more than it is becomes the next silent failure: **it does not see a
shift that lands within 20 u of the owner.** Three of the 15 repaired pairs were inside that radius.

## Still open

- **`laehospital1` and `road_lawn33`.** Both resolve their links cleanly, before and after. The one edit
  common to all three original reports is that every stock LOD is repointed from the shared stock atlases to a
  generated per-LOD dictionary (`LODxhospital1` `lod2lae1` → `salod0424`, `LODroad30` `lawnlodbig` →
  `salod0645`). Sampled offline they are fine — `inspect-area` reports `dff ok` / `txd ok` for every LOD in
  the crossroads area — so it is a suspect, not a finding, and it is where the next round should start.
- **The repair lives only in this working tree.** `mods-src/` is gitignored; anyone else's copy of
  `0. Map Fixes Pack` still carries the off-by-one until it is re-converted with `merge-gen-mod`.
- **Design rule, unchanged: appending is safe, removing is not.** Retire a placement by exiling the row (the
  trees layer's z = −300/−1000 is the established shape) rather than deleting it. Stated in
  [`docs/restrictions/assets-and-data.md`](../../restrictions/assets-and-data.md).

## Reproducing the forensics

Read both ends of a link from the SAME tree — reading one end from each is what made the first version of
this file wrong:

```sh
# first row index where the built file stops agreeing with stock
paste <(awk '/^inst/{f=1;next}/^end/{f=0}f' game-src/original/data/maps/LA/LAw.ipl | cut -d, -f1-2 | tr -d '\r') \
      <(awk '/^inst/{f=1;next}/^end/{f=0}f' build/original/sa/data/maps/LA/LAw.ipl | cut -d, -f1-2 | tr -d '\r') \
  | awk -F'\t' '$1!=$2{print NR-1": "$1"  ->  "$2; exit}'

# what a given lod-link resolves to, in ONE tree (read the link from the same tree!)
awk -v k=158 '/^inst/{f=1;n=0;next}/^end/{f=0}f{if(n==k)print;n++}' build/original/sa/data/maps/LA/LAw.ipl
```

`scripts/debug/find-instances.ts <model>` prints a model's placement and its `lod-link`, and
`inspect-area.ts <x> <y> [r]` prints everything around a point with DFF/TXD resolution — **both read
`game-src/`**. To point them at a build, symlink it in (`ln -s "$PWD/build/original/sa" game-src/.tmp-built-sa`,
then `--game .tmp-built-sa`) and remove the link afterwards. `lod-link-check.ts` takes a tree path directly.
