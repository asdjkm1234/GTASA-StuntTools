# 06·1·03 — Population data: density truth per zone and hour

[← chain](../readme.md) · prev: [02 path import](02-path-graph-import.md) · next: [04 sidecar](04-path-sidecar-and-contracts.md)

Read the population tables COMPLETELY and resolve zones to their real popcycle types. This is where
"a busy Market street at noon and an empty desert road at 4 am" comes from — authored design we
currently truncate.

## Current state (verified 2026-08-02)

- `popcycle.parser.ts` keeps only `#Cars` + the 18 car-group weights; **`#Peds`, Dealers, Gang, Cops,
  Other columns are parsed past and dropped** — the ped-density source is thrown away today.
- `cargrp.dat` parsed (34 groups); **`pedgrp.dat` (5,792 B) has no parser**; `peds.ide` is consumed
  offline by pack-peds only.
- Zone → popcycle-type resolution is a 5-entry stub: `CITY_POPCYCLE_ZONE` maps LA, SF and VEGAS all to
  `RESIDENTIAL_AVERAGE` (`gta-sa-world.adapter.ts:78`) — plan 059's recorded B1 approximation, with B2
  (a curated zone-name → type table) named there as the fidelity upgrade. `info.zon`'s type column is 0
  for every zone; SA assigns types in the executable/mission script, so a table is the honest source.
- Zones themselves are live (`ZoneNameSystem`, `CityZoneSystem`, city boxes).

## Goals gate

1. *Authored data:* popcycle/pedgrp/cargrp are the designed population character of every district ×
   hour; mods and total conversions author these tables and must see them obeyed.
2. *Original:* SA resolves zone-type per zone from hardcoded assignment; the MEANING is recoverable
   (gta-reversed + community docs); the assignment table itself is data we curate once.
3. *Better:* we expose the resolved density fields to the editor (1/05) as paintable overrides in the
   sidecar — SA never let an author see or tune this in place.
4. *Cost:* boot-only parsing; the per-frame consumer is the sim (2/01) reading precomputed fields.
5. *Contract:* stock files read as authored; the vehicle-installer's stripped `cargrp.dat` (models
   reduced to the installed set) must remain a legal input — the resolver already tolerates it, keep it so.

## Design

- Extend `popcycle.parser.ts` to the full row: `#Peds`, percentages (Dealers/Gang/Cops/Other) — all 24
  slots × 20 zone types, weekday/weekend.
- `pedgrp.dat` parser (16 peds per group × groups, `POPCYCLE_GROUP_*`-aligned like cargrp).
- **Zone-type table (B2)**: curated `zone name → popcycle type` mapping for the stock map, derived from
  gta-reversed's assignment (recover the original's real table — never fit our own guesses); shipped as
  data (not code), overridable by the sidecar for mod maps. Games with foreign `info.zon` fall back to
  the current city approximation and SAY so at boot.
- Output: a `DensityField` service — `(zone, hour, weekend) → { maxCars, maxPeds, carGroups, pedGroups,
  mixPercentages }` — the single source the sim, the editor preview and the ASI parity fixtures read.
- Register every model reachable from cargrp/pedgrp with the install-source loaders (`build-vfs.ts`,
  `procObjModelRefs` pattern) — models chosen by data files are otherwise silently absent in the browser.

## Verification

- Unit tests on real fixtures (stock popcycle/pedgrp rows with known values, negative cases first).
- Boot census: `[population] zones resolved: N typed / M fallback; groups: cars X, peds Y`.
- Sanity probe vs the original: pick 5 landmark zones (Idlewood, Downtown LS, Queens SF, The Strip,
  Bone County) and diff our resolved (type, #Cars, #Peds @ noon/midnight) against the values SA
  resolves (ASI debug dump, same rung as 1/02's parity dump).

## Tasks

- [ ] Full popcycle row parse (+ tests).
- [ ] `pedgrp.dat` parser (+ tests).
- [ ] Curated zone-type table + fallback path + boot announcement.
- [ ] `DensityField` service + editor-facing read API.
- [ ] build-vfs refs for cargrp/pedgrp-reachable models.
- [ ] ASI parity dump for the 5 landmark zones; record the diff here.
- [ ] Docs same change: `docs/contracts/` if any new file/name starts carrying behaviour; note the
      vehicle-installer cargrp interplay in `docs/features/mods.md` if behaviour is clarified.

## Measured numbers

- Zones typed vs fallback: —
- Landmark-zone parity diff: —
- Boot parse delta: —
