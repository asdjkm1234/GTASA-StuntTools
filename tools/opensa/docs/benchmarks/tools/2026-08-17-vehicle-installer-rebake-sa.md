# vehicle-installer — `--rebake --kind sa` (plan 008): one car into the real-SA tree

**Date:** 2026-08-17 · **Machine:** macOS 25.6 (Darwin), APFS, Node 24 · **Code:** plan 008 as shipped
(on top of `550e6a3a`).

**Inputs:**

| Input | What it is |
| --- | --- |
| `build/original/sa` | the accepted session-18 rebuild (16 Aug 22:45Z); `models/vehicles.img` 1 869 164 544 B (456 entries) + `vehicles2.img` 1 231 806 464 B (338 entries) |
| `mods-src/original/vehicles` | structured, `models/` 212, `new/` 1 (`cabbie - 1982 Checker Taxicab - alfamodding`: dff 11.8 MB, txd 8.3 MB, 4 paint-job txds 2.8 MB each) |

## The run

```
npx tsx tools/vehicle-installer/src/cli.ts --rebake original --kind sa --only cabbie
vehicle-installer: new/cabbie - 1982 Checker Taxicab - alfamodding replaces models/cabbie - 1989 Chevrolet Caprice Taxi - 533
vehicle-installer: rebaked 1 vehicle(s) into …/build/original/sa (29.9 MB of dff/txd), 211 skipped
        4.22 real         1.38 user         1.71 sys
maximum resident set size  3 718 430 720
```

| Measure | Value |
| --- | --- |
| Wall-clock, one car | **4.2 s** (the full `sa` build that would otherwise show it: 707 s, `build-timings.json`) |
| Peak RSS | **3.7 GB** — the two family members read into memory (`openImgFamily`), which is what makes the in-place write safe |
| `vehicles.img` md5 before / after | `d2d5909fe2fcc2c3f9a8b44e7b473a6d` / same |
| `vehicles2.img` md5 before / after | `28d4e443ad9c008ba729702f12e5d4f8` / same |
| `data/gta.dat` | unchanged (two members before, two after — nothing new to register) |

The archives are byte-identical because the tree already carried this car (the build had installed it — the
"not installed" field report was a stale bottle, see plan 008's field note); the run therefore measures the
instrument's cost and its idempotence, not a content change. A second run reproduced both numbers.
