# Real-SA runtime pool ceilings

Limits of the _original_ game engine that the `sa/` build target must respect. The perfect-map-builder
guards them (`tools/perfect-map-builder/src/pipeline.ts`); `asi/perfect-map` lifts the int16 ceiling at
runtime, but the converter guards stand for any build not running that ASI.

- **int16 building-pool → 32,767 permanent text-IPL rows map-wide, and our asi lifts it.**
  `CIplStore::IncludeEntity` truncates building-pool indexes to int16; past index 32,767 the ranges wrap
  negative and stream-out corrupts memory (the "ghost barriers" bug, field-bisected to exactly 2^15 — 31,300
  rows clean, 33,210 corrupt). **`perfect-map.asi` patch #1 is what lifts it, and the target always runs it**
  (the reference install carries 72,914 rows). The build therefore does NOT guard this: since 2026-08-09 it
  only counts, via `reportTextIplCensus` on the built `sa/` tree. The invented 30,000-row `TEXT_ROW_CAP` and
  `--allow-text-row-overflow` are gone; nothing ever culled to fit them. Repro dial:
  `tools-debug/sa-int16-repro`.
- **Per-area row budget — the buffer is lifted, but it counts text rows AND stream records TOGETHER.** An area's
  text rows plus its binary-stream rows pass through SA's `gpLoadedBuildings` buffer (stock 4 096; OLA's
  `EntitiesPerIpl = unlimited` lifts it, and the install runs a **9 627-row** text IPL). **CLOSED 2026-08-10, by a
  crash:** raising `AREA_MAX_PAIRS` 2 000 → 4 800 on the strength of that 9 627 put 4 260 rows + 9 stream tiles
  (~8 520 entries) into one area and the game died on it. PF's 9 627 is a **text-only** file; it is not a budget
  for the mixed path. Live numbers: `AREA_ROW_CAP = 4000` (lod-trees + mod-installer), `AREA_MAX_PAIRS = **2000**`
  (`map-placement`; a pair is 2 entries, so 4 000 — put BACK after the crash, and its only caller now is
  lod-trees' overflow areas), and `AREA_MAX_ROWS = 9600` for the text-only procobj layer, which is the one path
  PF's number actually covers.
- **Text-IPL slot cap 40** (`IplEntityIndexArrays`; stock uses ~28-30). Only a file carrying `inst` rows takes
  a slot. **REAL on the target and NOT lifted by anything** — measured twice on 2026-08-10: a build shipping 75
  inst-bearing IPLs died loading the 40th (`plobj10.ipl`), with OLA's `EntityIpl = unlimited` set, and again with
  an `-DPM_FIX_INT16=0` probe of our own asi, so nothing of ours is the cause. The reference install carries 36,
  which is why the setting looked like it worked for months. `checkInstBearingIplSlots` FAILS the build on it.
- **The per-file row budget IS lifted; the slot cap is NOT.** They were documented as one pair of stock numbers
  both raised by OLA — they are not. The install runs a 9 627-row text IPL, so the row lift is real, but that
  proof covers a file with **zero binary streams**: an area's text rows and its stream records share the same
  buffer, and 8 520 mixed entries crashed on the first area. Which set applies is a property of the install for
  the row cap and of the game for the slot cap:
  [`gta-sa-original/reference-install.md`](../gta-sa-original/reference-install.md). Count either with
  `scripts/debug/ipl-row-census.ts`.
- **A binary IPL stream is only resident within 190 units of the player** — so it cannot carry draw distance.
  `CIplStore` loads a stream's slot only while the player is inside its bounding box grown by 190
  (`if (!def->bb.IsPointInside(posn, -190.f) || CStreaming::IsModelLoaded(IPLToModelId(slot))) continue;`,
  `gta-reversed-modern/source/game_sa/IplStore.cpp`). With 512-instance tiles the boxes are small, so the gate
  binds long before any IDE draw distance does — a clutter layer in streams was capped at ~190 m no matter what
  it was declared at. A PERMANENT text row has no such gate, which is why ProperFixes' whole vegetation layer is
  text rows at `lod = -1` and gets the IDE's 299. **Streams buy streaming, never range.**
- **FLA ID-pool budgets: TXD 6000 / COL 400 / IPL 1024** (stock 5000/255/256), raised in the install's ini
  2026-08-10. Archive-file counts are ID slots; exhausting a pool corrupts the heap during data load (crash
  right after `shopping.dat`). pmb's `IMG_ID_BUDGETS` guards the operative FLA ini values. **Measured on the
  first `sa` build at 91 092 procobj objects:** TXD 4999, COL 264, **binary IPL 522** — the last one 242 over
  the old 280-slot pool, because the layer's `plobj*_stream*` tiles went 50 → 331 across the column fix
  (`STREAM_MAX_INST = 512` instances per tile, ~156 600 stream records). **Read a pool off
  `fastman92limitAdjuster.log`, not off the ini**: a `#`-disabled line still prints its value, which is how
  the guard carried TXD 6000 against a real 5000 for months.
- **drawDistance ≥ 300 OR a `lod`-prefixed name = "big building" path.** Mass text-IPL instances of
  big-building defs corrupt streaming (ghost-loaded script-gated IPLs). Generated LODs keep draw distance
  below 300 and use non-`lod` aliases (`plo…`).
- **Only one limit adjuster may patch IPL/pool limits** — FLA and OLA active on the same zones crash at
  load.
- **Permanent LOD layers need a Buildings-pool raise** (~15k procobj + ~9.9k tree LOD instances exceed
  stock `CPool<CBuilding>`).
- **An `inst` row spends `CPool<CDummy>`, not `CPool<CBuilding>`, when `object.dat` tunes its model** —
  `CFileLoader::LoadObjectInstance` branches on `mi->m_nObjectInfoIndex == -1`. Measured on the built `sa`
  tree 2026-08-19: **109 740 permanent buildings + 17 644 permanent dummies** (17 311 of the dummies are the
  procobj bake), plus 24 801 / 15 399 in the streamed binary IPLs, so the never-reached peak is
  134 541 / 33 043. Stock for comparison: **9 209 permanent buildings, 59 permanent dummies.** Counted by
  `checkEntityPoolBudgets`, which reads `Buildings`/`Dummys` off the OLA ini the build ships and gates on
  the PERMANENT half only — the streamed rows are never all resident (stock's hold 25 624 building rows
  against its 13 000 pool and the game runs).
- **`Dummys` must cover the FIRST world entry's peak, and that peak is not derivable from the rows.** On
  this build the first entry occupies [40 960, 49 151] dummy slots (perfect-map 011 trace, 2026-08-19)
  against 33 043 rows in the whole map — the boot places more dummies than the map has rows — so
  `Dummys = 40000` crashes at `0x00538103` during the first entry although the pmb guard (permanent rows,
  17 644) passes it. `Dummys = 32767` does not boot at all. Kept at 100 000 (5.6 MB). The per-entry LEAK
  that used to sit on top of this (the int16 `IplDef.firstDummy/lastDummy`) is LIFTED by
  [perfect-map 011](../../asi/perfect-map/docs/plans/011-ipldef-dummy-range.md) —
  [fixed issue](../open-issues/fixed/sa-load-game-crash-dummy-pool.md).
- **IDE id cannot be defined twice.** A baked IDE that redefines a stock id must strip the older definition
  everywhere — duplicate model-info ids corrupt SA's heap during data load.
- **IPL row order is data.** Binary IPL streams reference text rows by index (`lod` columns); removals
  require rebasing every surviving lod-index across text + binary in lockstep.
- **opensa-lod-generator output is for OpenSA only** — uncapped per-cell LODs (hundreds of materials,
  MB-scale models) crash the real-SA streamer.
- **`gta.dat` is loaded top-down — an IDE line must precede the first IPL line that uses its ids.**
  mod-installer appends mod IDE/IPL blocks at the end (self-contained, fine), but a tool injecting new ids
  into STOCK IPLs must insert its IDE before the first `IPL`/`ZON` line (`patchGtaDat` does), or the first
  stock IPL crashes with undefined-id.
- **In-game bisection of pool-exhaustion heap corruption gives FALSE NEGATIVES.** Removing ANY img entry
  reshuffles the heap so the crash lands somewhere silent — a boot that "flips" on ±1 entry with no content
  diff implicates nothing. Suspect a `FILE_TYPE_*` pool first and check/raise the FLA ini before bisecting
  generators (this cost two debugging days once).
