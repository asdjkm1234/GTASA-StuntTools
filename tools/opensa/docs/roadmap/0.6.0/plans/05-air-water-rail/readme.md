# 05 — Air, water and rail vehicles (IDEA — recon facts parked from 098)

**Status: IDEA, 2026-08-04.** Not planned work — this file parks what the 098 all-land-vehicles recon
learned about the OUT-of-scope classes, so the next cycle starts from facts instead of re-discovering
them. Trains' scheduled/traffic half belongs to city-life's `4-trains` chain; this note is about the
VEHICLE side (drivable/simulated craft).

## What the 2026-08-04 recon established

- **Boats never even parse.** All 10 `boat` rows of `vehicles.ide` have 11-12 columns and are dropped by
  the parser's column-count guard (`vehicle-defs.parser.ts:32-34` drops rows with <= 13 columns) — the
  first boat task is a parser decision, not physics. One 11-column `plane` row (of 12) is dropped the
  same way; the other planes, all helis and trains parse and even get `.osm` baked today
  (`pack-vehicles.ts` is unfiltered), so they SPAWN as dead-weight cars from the F2 spawner.
- **Their handling sub-tables are unread.** `handling.cfg` carries a `%` boat table (12 rows,
  `handling.cfg:332-343`) and a `$` flying table (24 rows) — `parseHandling` keeps only letter-leading
  lines. 098/01 adds the `!` bike table with the same mechanism; `$`/`%` would follow that pattern.
  `percentSubmerged` (main-row col 6) is parsed but consumed by nothing.
- **Their animation data is on the same path 098/04 opens.** `anim/anim.img` ingestion (built for the
  bike ride sets) also carries the boat/plane sets; `ped.ifp` already holds `DRIVE_BOAT*`; the
  `handlingFlags` bit `SIT_IN_BOAT` and the `^` anim-group rows cover their enter/exit pairing.
- **`PLANE_SMOKE`** is one of the VSA Editor's 15 hardcoded ability classes (corpus:
  `NO_COMMIT/all-veh/1/VSAConfig.ini`, stock IDs 512/513 stunt + cropdust) — if the 098 features module
  ships, this becomes a registry token + an effects driver, not new architecture.
- **Water is its own dependency**: drivable boats need the water surface/physics story
  ([02-water-realism](../02-water-realism/readme.md)) before a hull solver means anything — sequencing
  argument for why boats stayed out of 098.
- Trains: 6 rows (5-6 with carriages), `tracks*.dat` import is already decided data work in city-life
  `1-preparation/02-path-graph-import.md`; a drivable train is gameplay on top of that graph.

## When this becomes work

Graduate per class, in whatever order the cycle wants; each class inherits 098's machinery (class
registry, anim-group resolution, features module, joint framework for e.g. towed banners/carriages)
rather than growing its own.
