# 2026-08-15 — vehicle-installer: the batched gta3.img write

**What this measures:** the vehicles stage after the batch fix (one archive open, one `writeImgFile` per
RUN, entries staged by path via `EditableImg.setFile`) — replacing a full `writeFileSync(img.build())`
rebuild per car.

**Why it exists:** the stage could not complete at all before. The `sa` build died mid-stage on
`ERR_OUT_OF_RANGE` at 2 168 825 856 B — `writeFileSync` caps at 2 GiB and the archive crossed it partway
through the alphabet.

## Conditions

| | |
| --- | --- |
| Machine | this workstation, macOS 25.6.0 (Darwin), APFS |
| Node | v24.15.0 |
| `--game` | `build/original/.work-sa/1-mods` — the tree the `mods` stage produced this day (1.8 GB, `gta3.img` 1 242 236 928 B) |
| `--in` | `mods-src/original/vehicles` — 212 folders, 752 dff/txd, 3 077 354 628 B |
| Command | `tsx tools/vehicle-installer/src/cli.ts --game … --in … --out …`, standalone (not through pmb) |
| Commit | `a1a1217c` |

**APFS caveat, and it matters for comparison:** `install()` starts with `cpSync(gamePath, outPath)` of the
whole 1.8 GB tree, which macOS serves by copy-on-write and effectively for free. The same run on NTFS pays
that copy in full. Do not read the wall clock below as portable.

## Run

| | Before (2026-08-11 set) | Before (this set) | After |
| --- | --- | --- | --- |
| Outcome | completed | **FAILED mid-stage** | **completed** |
| Wall clock | 26.8 s (pmb stage timing) | — (died) | **6.13 s** (`/usr/bin/time -l` real) |
| Archive rebuilds | 1 per car | 1 per car | **1 per run** |
| Peak RSS | not measured | — | **3 105 882 112 B (3.11 GB)** |
| `models/gta3.img` out | not recorded | — | **4 268 185 600 B (4.27 GB)** |
| Entries written | not recorded | — | 743 img entries, 212 vehicles, 211 mod-ledger slots |

`user 1.44 s / sys 2.33 s` against `real 6.13 s` — the stage is I/O bound, as a 4.27 GB write should be.

## The result this run is really about

The stage now produces an archive **nothing in the repo can read back**:

```
readFileSync FAILS: ERR_FS_FILE_TOO_LARGE File size (4268185600) is greater than 2 GiB
```

That is the predicted state, not a surprise — the fix removes the WRITE ceiling and Node's READ ceiling is
untouched at 2 GiB. So the vehicles stage is unblocked and the pipeline behind it is not: `sa-lod-generator`
and `opensa-lod-generator` open every `models/*.img` whole, and `vehicle-cutscene` reads `gta3.img` whole to
resolve txdp parents. The archive split is what answers that; this run is the measurement it starts from.

Peak RSS is worth watching rather than celebrating: 3.11 GB against a 1.24 GB source archive. Staging costs
paths, so the residue is the base buffer plus per-entry copies awaiting collection — a number that should
fall on its own once the base archive is read through an fd rather than `readFileSync`.

See [`edge-cases/converter-pipeline.md`](../../edge-cases/converter-pipeline.md) for the limits as measured
and [`restrictions/assets-and-data.md`](../../restrictions/assets-and-data.md) for the rule.

## Follow-up the same day: split first, then install as a family

Same machine and same mod set, with `img-splitter` run over `game-src/original` first and the installer
writing the `vehicles.img` family (`writeImgFamily`, cap **1 879 048 192 B** = 1.75 GiB):

| | |
| --- | --- |
| split | 2.0 s → `vehicles.img` 50.5 MB, `peds.img` 55.6 MB, `weapons.img` 1.3 MB, `gta3.img` 832.6 MB |
| install, 212 vehicles | **5.0 s** |
| `vehicles.img` | 458 entries, **1 872.6 MB** — under cap |
| `vehicles2.img` | 332 entries, **1 205.2 MB** — under cap |
| peak RSS | 2 481 192 960 B (2.48 GB) |

The two members sum to 3 077.8 MB, which is the vehicle payload — nothing was lost to the spill. **No output
file is over the cap**, so the 4.27 GB archive that no reader could open is now two that every reader can.

Peak RSS fell from 3.11 GB to 2.48 GB as a side effect: the installer's base archive is `vehicles.img`
(50.5 MB) instead of the whole map (1.24 GB).

What the run does NOT yet do is register `vehicles2.img` in `gta.dat` — the installer warns about exactly
that, and it is img-splitter plan 001 step 4. Counting it, the tree wants 10 registered archives against the
target's 8.

## The whole `sa` build, split included (2026-08-15, third run)

The first end-to-end `sa` build with `splitBuckets: ['vehicles']`, the archive index and both asis. **638.9 s
total**, exit 0.

| Stage | Wall clock |
| --- | --- |
| split | 1.6 s |
| mods | 82.7 s |
| vehicles | 7.1 s → `vehicles.img` + `vehicles2.img` |
| **cutscene** | **7.5 s** — 23 converted, 0 skipped, 21 plates baked |
| peds | 11.1 s |
| optimize | 78.7 s |
| trees | 82.4 s |
| sa | 363.6 s |
| procobj | 4.2 s |

The finished `sa/models`:

| Archive | Entries | Bytes |
| --- | --- | --- |
| gta3.img | 16 990 | 1 635 813 376 (1.64 GB) |
| vehicles.img | 458 | 1 872 623 616 (1.87 GB) |
| vehicles2.img | 332 | 1 205 186 560 (1.21 GB) |
| cutscene.img | 634 | 199 106 560 |
| gta_int.img | 2 485 | 222 642 176 |
| player.img | 542 | 66 738 176 |

`gta.dat` registers CARREC, SCRIPT, CUTSCENE, VEHICLES, VEHICLES2 — **5 lines + 3 hardcoded = 8 of 8**, the
stock table exactly full. FLA id pools with every archive now counted: TXD 5171/6000, COL 263/400, IPL
191/1024. Both asis shipped (`perfect-map` c6b87f95…, `perfect-cutscene` 8cbd40db…), hashed into
`build-timings.json`.

**The number worth reading twice is the cutscene stage's output: 199.1 MB against the CLI route's 321.5 MB**
for the same 23 slots. That is the empty-TXD route running as designed for the first time — txdp parents
resolved out of the installed archives instead of `--self-contained-txd` embedding a copy per slot
(11 102 360 B of cs TXDs in total). It is also the run that `asi/perfect-cutscene` plan 001 step 7 was waiting
for.

**And one gap the run exposed** — `gta3.img` grew 889 MB → 1.64 GB across mods and the LOD stages with
nothing capping it — **closed the same day**: the cap moved inside `writeImgFile`, which every archive writer
goes through, and eleven writers that still built the whole archive in one buffer were moved onto it.

## The re-run with every writer streaming and capped

Same inputs, same machine: **655.9 s** (against 638.9 s), exit 0, and **every archive byte-for-byte the same
size as the run above** — `gta3` 1 635 813 376, `vehicles` 1 872 623 616, `vehicles2` 1 205 186 560,
`cutscene` 199 106 560, `gta_int` 222 642 176, `player` 66 738 176. The sweep changed how the archives are
written, not what is in them. Stage times: split 3.2 s · mods 74.1 · vehicles 4.9 · cutscene 5.4 · peds 5.8 ·
optimize 87.1 · trees 87.2 · sa 385.4 · procobj 2.8. The 17 s difference sits in `sa`/`optimize`/`trees` and
is machine noise — the suite was running against the same disk during part of it.
