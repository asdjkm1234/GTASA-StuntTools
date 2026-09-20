# 2026-08-20 — mod-installer: what "follow the raster you replace" costs a build

**Tool:** `tools/mod-installer` ([plan 015](../../../tools/mod-installer/docs/plans/015-replacement-png-follows-its-raster.md)).
**Inputs:** `game-src/original` + `mods-src/original` (61 mods, the 2026-08-20 set), full `sa` build via
`npm run build:game:original:sa`. **Machine:** the session's mac, no other build running.

## The rule being measured

A PNG in a mod's texture folder that REPLACES an existing texture is now encoded in the compression class of
the raster it replaces (uncompressed stays uncompressed); one that ADDS a texture keeps the DXT5/DXT1-by-alpha
policy. The mip chain stays ours in both cases.

## The exposure — every PNG texture folder in the mod set

`scripts/debug/png-folder-census.ts --game original`:

| | count |
| --- | ---: |
| PNG texture folders | 33 |
| PNGs total | 80 |
| … that ADD a texture (policy unchanged) | 56 |
| … that REPLACE one | 24 |
| … of those, replacing an UNCOMPRESSED raster (the rule's whole reach) | **18** |

All 18 land in `models/generic/vehicle.txd` or `models/particle.txd` — the two dictionaries stock keeps
uncompressed end to end. Every map dictionary a texture folder patches is DXT in stock and is untouched.

## The cost, mip chains included

| | as DXT (before) | as they now ship |
| --- | ---: | ---: |
| the 18 replaced rasters | 2 673 KB | **18 264 KB** |

Largest single items: `coronamoon` 683 → 5 461 KB, `vehicletyres128` 341 → 2 731 KB, `vehiclescratch64`
341 → 1 365 KB, `plateback1..3` 85 → 683 KB each, `platecharset` 5 → 43 KB.

Dictionary sizes in the built tree:

| file | before | after |
| --- | ---: | ---: |
| `models/generic/vehicle.txd` | 11 274 188 B | **22 237 184 B** (+10.46 MB) |
| `models/particle.txd` | — (overwritten before capture) | 6 331 956 B |

The vehicle delta matches the census prediction for that dictionary (10 705 KB) to within a rounding step,
which is the check that the census and the build agree.

**Fidelity, the other half of the trade:** the mod's pixels now reach the game byte for byte — worst channel
difference against the source PNG **0** on `platecharset`, `plateback1` and `carplate`, where DXT1 was
quantising them.

## Build wall-clock (unchanged by the rule)

Full `sa` run, 2026-08-20: **11 m 27 s** end to end.

| stage | s |
| --- | ---: |
| mods | 90.7 |
| vehicles | 8.3 |
| peds | 10.8 |
| optimize | 90.2 |
| trees | 83.4 |
| procobj | 2.9 |

The encoder change is not visible in the mods stage: 18 rasters re-encoded uncompressed instead of DXT is
strictly LESS work (no block compression), and the stage is dominated by archive IO either way.

## Delivery to the reference install

`rsync -rlt --itemize-changes` with **no `--delete`** (`docs/gta-sa-original/reference-install.md`):
`models/` 102 files in **21.9 s**, `data/` 317 files in 0.3 s. Only three files changed CONTENT —
`models/generic/vehicle.txd`, `models/particle.txd`, `data/cargrp.dat` — the rest were mtime-only rows
(`>f..t`), which is the byte-determinism of the build showing up as a delivery property.

Neighbour: the alternative not taken, with what it would give back —
[`compress-sampled-png-replacements.md`](../../performance/deferred-optimizations/compress-sampled-png-replacements.md).
