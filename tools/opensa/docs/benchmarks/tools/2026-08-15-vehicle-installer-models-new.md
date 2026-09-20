# vehicle-installer — `models/` + `new/` (plan 007), and what the restructure cost

**Date:** 2026-08-15 · **Machine:** macOS 25.6 (Darwin), APFS, Node 24.15 · **Code:** before =
`64c9178e` (session-15 start), after = plan 007 as shipped.

**Inputs, named because nothing here compares without them:**

| Input | What it is |
| --- | --- |
| `game-src/gostown` | 366 MB base game, **flat** vehicles tree (2 cars) |
| `mods-src/gostown/vehicles` | 36 MB, 2 car folders, unlayered — the path that already worked |
| `mods-src/original/vehicles` | **structured**: `models/` 212 cars, `new/` empty, `screenshots/` 212 |
| `build/original/opensa` | 3.1 GB built tree, for the rebake runs |

## The flat path is byte-identical across the change

The load-bearing check: the tree shape that already worked must install exactly as it did, since the
resolver replaced the `readdirSync` every consumer used.

| Run | Wall-clock | Output |
| --- | --- | --- |
| before (`64c9178e`) | 0.82 s | 403 MB, 60 files, 8 img entries, 2 ledger slots |
| after (plan 007) | 0.90 s | 403 MB, 60 files, 8 img entries, 2 ledger slots |

`diff -rq` over the two output trees: **no difference, file for file.** The wall-clock difference is noise
at this size (one `cpSync` of a 366 MB tree on APFS, which clones rather than copies); it is recorded, not
claimed as a result.

## The structured tree, which nothing could read before

| Measure | Before | After |
| --- | --- | --- |
| `resolveVehicleSources('mods-src/original/vehicles')` | — (no resolver) | **212 cars**, strategy `structured`, 0 overrides |
| `vehicle-cutscene --inspect` over the same folder | **0 of 23** slots ready, exit 0 | **23 of 23 ready** |
| `npm run test:fixtures` | 104/120 (16 MISSING) | **120/120** |

The census number is the point of the plan: three folders called `models`, `new` and `screenshots` ship no
`.dff`, a folder with no `.dff` is a legitimate skip, and so the tool reported a clean run having converted
nothing.

## Rebake, against the 3.1 GB built tree

| Command | Result | Wall-clock |
| --- | --- | --- |
| `--rebake original --only admiral` | 1 rebaked (7.8 MB of `.osm`), 211 skipped | **3.1 s** |
| `--rebake original --only voodoo` | 1 rebaked (23.1 MB of `.osm`), 211 skipped | **2.5 s** |

`voodoo` is one of the ten cars whose recorded slot was a bodykit part before this session (`bbb_lr_slv1`):
`--only voodoo` matched nothing at all before the fix, so this run is only possible after it. 212 folders
are scanned in both runs — the per-car turnaround the plan sells is unaffected by the fleet size.

## The slot correction, over the whole fleet

212 cars scanned, **10 slots corrected** — `flash` (`exh_a_f`), `jester`, `remingtn`, `savanna`, `slamvan`,
`stratum`, `sultan`, `tornado`, `uranus`, `voodoo` (`bbb_lr_slv1`, claimed by two cars) — and **0 folders**
whose name matches no shipped `.dff`, so the fallback path fires on nothing in this tree.

## cars-server

`npm run cars` on the same tree: **212 cars in 19 sections**, page 214 KB of HTML (images are served, not
inlined), catalog rebuilt per page load. Not a build tool and not on any budget — recorded so the page size
has a starting point if it ever grows.
