# 012 — a stream merge's `lod` lives in the AUTHOR's layout, and ours is a different one

**Status: DONE 2026-08-16**, steps 1–3. The field defect in
[`docs/open-issues/ipl-row-removal-breaks-lod-links.md`](../../../../docs/open-issues/fixed/ipl-row-removal-breaks-lod-links.md)
is explained, repaired and now guarded. Numbers below.

## What was wrong

`0. Map Fixes Pack` edits `LAw.IPL` through a `.merge` that REMOVES inst row 150 (`LODcanhou01_LAx`). The
installer handles that correctly: `removeInstWithRebase` decrements every surviving text link past the removed
row, and `patchAreaStreams` mirrors the same shift into the area's `law_streamN.ipl` entries (158 → 157 for
`gaz9_law`'s link).

Then the pack's own `gta3_img/law_stream2.ipl.merge` runs — stream merges apply LAST, by design, "so their
rows live in the final (post-rebase) index space" — and writes:

```
- 6133, 0, 721.4375, -1450.9453125, 10.1953125, …, 157      ← the entry as the installer has it: correct
+ 6133, 0, 721.4375, -1450.9453125, 10.19530963897705, …, 158   ← the AUTHOR's index, never re-expressed
```

The author's file also gained a row before that point, so THEIR `LODgaz9_law` sits at 158 while OURS sits at
157 (we append added rows at the end). The merge faithfully wrote 158, and built row 158 is a stock tree the
same pack exiles to z = −300. The game asked for a LOD and got a sunken tree.

**Two things follow from that one number, and the second is why the first read as two separate defects.**
`sa-lod-generator`'s `retargetLodTransforms` reads these very links to copy an HD's transform onto its cloned
LOD's row. Fed a link that is one row off, it wrote three LOD rows in `LAw.ipl` with a NEIGHBOUR's transform —
`LODgaz9_law` landed 398.7 u from its building. The open-issue file recorded that as an unexplained second
defect ("some pass rewrote rows 155–157"); it is the same wrong index, one stage later.

**Where it came from.** `generateStreamMerge` has always taken a `remapLod` — the area's author→final index
map, which `generateMerge` returns as `authorToFinal` — and today's text path is measured correct: fed a
reconstruction of the author's `LAw.IPL`, it emits `156`, our index, not the author's `157`. But **nothing in
the repo ever called `generateStreamMerge`**: the shipped stream merges came from an ad-hoc script that is
gone, and it left `remapLod` at its identity default. The single-file CLI could not have done better — it
takes one file and has no area map to hand.

## What was done

### 1. The guard (`feat(pmb)`, `3155a77f`)

`checkLodLinks` (`@opensa/tool-kit/lod-links`) resolves every `lod` field of a tree — text IPLs and the binary
streams inside `models/*.img` — and reports the links whose target does not stand where its owner stands. It
runs as `assertLodLinks(sa)` at the end of the `sa` build, next to the row/slot ceilings, and as
`scripts/debug/lod-link-check.ts` for diagnosis.

Positional because a LOD stands on its owner: no baseline tree, no naming convention. Stock holds it for 6 095
of 6 103 links to within a metre; the eight it breaks are shared cluster LODs, named in an allowlist rather
than hidden behind a bigger radius. **What it does not catch**: a shift that lands within 20 u. That is stated
in the code and in `docs/debug/README.md`, because a guard whose limits are not written down gets read as
proof of the whole class.

### 2. The repair (data, not code — `mods-src/` is gitignored)

Every `.merge` replace pair whose two rows differ in the lod cell was re-judged against the merged TEXT
layout, rebuilt from vanilla + the text merges in install order. **Not from `build/`** — the built rows had
already been moved by `retargetLodTransforms` using the very links under repair, and against that tree three
of the pairs read as correct.

The verdict was unanimous: in all 15 pairs the `-` value (the installer's own rebase) lands exactly on the
owner and the `+` value is 16.7–530.8 u away. Repaired in place:

| file | pairs | shift |
| --- | --- | --- |
| `0. Map Fixes Pack/data/maps/la/LAw.IPL.merge` | 1 | +1 |
| `0. Map Fixes Pack/gta3_img/law_stream1..4.ipl.merge` | 7 | +1 |
| `0. Map Fixes Pack/gta3_img/law2_stream1.ipl.merge` | 7 | −1 |

Three further pairs change a link from `-1` to a row (`sfs_stream2`, `sfn_stream1`, `vegasn_stream7`): those
are the authors ADDING a LOD link, each resolves onto its owner at 0.0 u, and they were left alone.

### 3. Folder-mode conversion (`feat(mod-installer)`, `036db4ea`)

`src/merge-gen-mod.ts` converts a whole mod — text files first, then the streams that index them, with the
area's `authorToFinal` in hand. Two things it does that the lost script could not:

- it diffs each stream against **the entry the installer will actually have** (the text merge's removals
  already mirrored in), so a link the installer's own rebase already lands correctly produces NO directive.
  That is why the repair above is a deletion of numbers rather than a correction of them;
- it **gates every stream end to end**: apply the generated merge, then require each instance's link to
  resolve, in our merged text, to the same row the author's link resolved to in theirs. A link into a row that
  does not exist in the author's own file is refused rather than carried.

The single-file CLI now refuses a `*_streamN.ipl` target and points at folder mode — the trap that produced
this bug is closed at the entrance.

## Numbers

| tree | lod links | broken (> 20 u or out of range) |
| --- | --- | --- |
| `game-src/original` (stock) | 6 103 | 0 |
| `build/original/sa`, before the repair (2026-08-15 build) | 14 818 | **11** |
| `build/original/sa`, after the repair (2026-08-16 build) | 14 818 | **0** |

The 11: `gaz9_law` → an exiled tree 282.3 u away, `vencanhou01_LAx` ×3 (20.3–140.4 u), `BillBd1`/`BillBd2` ×7
in `law2_stream1` (23.7–60.7 u). Tests: +5 (`merge-gen-mod`), +4 (`lod-links`), +3 (`assertLodLinks`).

## What is still open

- **The repair does not travel.** `mods-src/` is gitignored, so the corrected `.merge` files exist only in
  this working tree. Anyone else's copy of `0. Map Fixes Pack` still carries the off-by-one until it is
  re-converted with folder mode.
- **The originals are gone.** Both packs ship only their `.merge` files now, so folder mode cannot be run over
  them to prove itself on real data; it is proven on the shape, in tests.
- **The two unexplained field reports stay unexplained** — `laehospital1` and `road_lawn33` resolve their
  links cleanly and always did. See the open-issue file.
