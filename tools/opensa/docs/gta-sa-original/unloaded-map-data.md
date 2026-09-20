# Stock map data the game never loads

**Measured 2026-08-15 on `game-src/original` (clean 1.0 tree).** `data/gta.dat` declares **106** `IDE`/`IPL`
files; **112** exist on disk. The six-file gap matters to every tool that finds data by globbing `data/`
rather than by reading `gta.dat`, because those files are content the game does not have.

## The eight files `gta.dat` does not declare

| File | Loaded anyway? |
| --- | --- |
| `data/default.ide` · `data/vehicles.ide` · `data/peds.ide` | **Yes** — the exe loads these three on a hardcoded path, they were never gta.dat's to declare |
| `data/maps/txd.ide` | No declared load path in this install |
| `data/maps/occlu.ipl` | No — the occlusion the game loads is the four regional files (`occluSF`, `occluveg`, `occluLA`, `occluint`) |
| `data/maps/vegas/vegaxref.ipl` | No — `vegaxref.IDE` is declared, the `.ipl` is not |
| `data/maps/leveldes/leveldes.ide` · `leveldes.ipl` | No — and `leveldes/` has three other files that ARE declared (`levelmap.IDE`, `levelxre.IDE`, `seabed.IDE`), so the folder looks live |

A map `.ide`/`.ipl` has no load path other than `gta.dat`, so "not declared" is "not loaded" for everything
below the first row.

## What it costs a tool: seven model ids that look like a conflict

`leveldes.ide` defines **16700, 16701, 16702, 16705, 16706, 16707, 16708** — and so does `countn2.ide`,
with entirely different models:

| id | `countn2.ide` (LOADED) | `leveldes.ide` (dead) |
| --- | --- | --- |
| 16700 | `lod_rockgp1_12` | `androm_des_obj` |
| 16701 | `lod_rockgp1_05` | `china_town_gateb` |
| 16702 | `lod_rockgp2_17` | `cargo_stuff` |
| 16705 | `lod_rockgp1_09` | `cargo_test` |
| 16706 | `lod_rockgp1_07` | `carge_barrels` |
| 16707 | `lod_rockgp1_13` | `cargo_netting` |
| 16708 | `lod_rockgp2_11` | `cargo_store` |

**In the game this is not a conflict at all** — only one of each pair is ever loaded. It is a conflict only
in a tool's view of the folder, and `scripts/debug/mod-id-collisions.ts` reports exactly these seven on a
clean `original` for that reason. Read them as the baseline: what that scan is looking for is an eighth.

The general rule this is an instance of: **the load list is `gta.dat`, not the directory.** A tool that
budgets ids, counts rows or hunts duplicates over a glob is measuring more than the game will ever read.
