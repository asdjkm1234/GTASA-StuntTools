# 013 — the IPL slot fold uses EVERY host, not one

**Status: DONE 2026-08-16.** The `sa` build went from refusing to finish (62 inst-bearing text IPLs against
SA's 40-slot `IplEntityIndexArrays`) to 39, which is every slot the field has proved usable. Numbers below.

## Why

`mods-src/original/mods` was split into `common/sa/opensa` layers and a map pack arrived with it:
`common/66. Urbanize only MAP (12.2025)` ships **13 text IPLs carrying 16 172 inst rows** (its own
`Loader.txt` says as much — *"increase the .ipl file limit … or merge the files"*). With the other packs the
install carried **23 mod IPLs / 16 806 rows**, one `IplEntityIndexArrays` slot each.

`mergeModInstIpls` existed for exactly this and folded NOTHING, because it was **all-or-nothing into ONE
host**: it picked the least-loaded stock area and gave up if the whole set did not fit under the 4 000-row
area cap. 16 806 rows fit no single area, so 23 slots stayed spent — and the failure was **silent**, since
the installer only logged the fold when it succeeded. The build died 6 stages later on the slot guard.

## What changed

1. **Fold across every host, biggest file first.** Hosts are the stock areas that already carry inst rows;
   each keeps its own remaining room. Placing the big files first is what makes the packing work — smallest
   first leaves room everywhere and nowhere.
2. **A file with no internal `lod` link may be SPLIT across hosts.** Nothing in such a file addresses its own
   row order, so its rows are independent (all 13 Urbanize files are like this — every row is `lod -1`). A
   file that DOES link goes into one host whole, or stays put: splitting it would repoint every link.
3. **Reserve `AREA_LATER_APPENDS = 900` rows per host.** The tree impostor LODs and the sa hole fill append
   to these same files AFTER the fold — measured over the 2026-08-16 build, the worst single area grew by
   **812** rows after the mods stage. Without the reserve the fold would spend room they need.
4. **Compaction runs FIRST.** `compactStockInstIpls` is a fixed 214-row job that frees two slots outright and
   needs one host with room; the fold behind it is opportunistic and takes everything. Run second, it lost
   both slots — measured, in the first run of the new fold: 23 slots won, 2 given back.
5. **What is left standing is now WARNED about**, by file and row count. A fold that quietly does less than it
   could reads exactly like one with nothing to do, which is how this reached the guard in the first place.

## Numbers

| stage of the `sa` build | inst-bearing text IPLs |
| --- | --- |
| stock `game-src/original` | 30 |
| after the mods stage, before this change | 51 (28 stock + 23 mod) |
| after the mods stage, after it | **28** (23 folded, 2 stock blocks compacted) |
| finished `sa` tree, before | **62** — the build threw here |
| finished `sa` tree, after | **39** (28 + 10 procobj areas + 1 tree overflow) |

Rows folded: 16 806 into stock hosts, of a measured 66 608 rows of free capacity (42 458 with the reserve
applied). The map itself is unchanged — 127 384 permanent rows before and after, the same placements in fewer
files (a folded Urbanize bin now lives in `leveldes/seabed.ipl`, the emptiest host). Every LOD link still
resolves onto its owner afterwards: **15 648 checked, 0 findings** by `assertLodLinks` on the finished tree
([plan 012](./012-stream-merge-lod-space.md)). Build time 11m 26s, mods stage 1m 25s — the fold itself is not
measurable against it. Tests: +3.

**Also found, and fixed straight after (the user's call):** `sa-lod-generator`'s finalize copied the game tree
into `<out>/sa` with `cpSync` and no wipe, so a file an earlier build produced and this one does not
**survived**. The 23 folded mod IPLs were still sitting in `build/original/sa/data/maps` from the failed run,
unreferenced by `gta.dat` — dead weight that time, and the same mechanism keeps a stale model alive the next.
Both LOD generators now mirror through `copyGameDir` (wipe, then copy) behind `guardOut`; the rule is in
[`docs/restrictions/architecture.md`](../../../../docs/restrictions/architecture.md).

## The margin, stated plainly

**39 of 39.** The field crash of 2026-08-10 loaded 39 inst-bearing IPLs and died on the 40th
([`docs/restrictions/sa-target.md`](../../../../docs/restrictions/sa-target.md)), so the build now sits on the
last usable slot with nothing spare. Where the next one would have to come from, in order of cheapness:

- **procobj's 10 areas are not compressible**: 91 419 rows against the 9 600-row-per-file cap
  (`AREA_MAX_ROWS`, itself sized under ProperFixes' field-proven 9 627) needs 10 files.
- **The tree layer's 1 overflow area** could be folded the same way if its rows were emitted before this
  stage; they are not, and the ordering is deliberate.
- **A mod's own IPL count** is the honest lever: `66. Urbanize only MAP` is 13 files whose rows this fold now
  absorbs entirely, so it costs 0 slots — but a pack that ships LINKED rows cannot be folded and would cost
  one slot per file.
