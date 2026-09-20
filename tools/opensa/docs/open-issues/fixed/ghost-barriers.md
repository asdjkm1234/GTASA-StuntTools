# "Ghost barriers" — mass map instances corrupt real SA (int16 building-pool indexes)

> **✅ ROOT-FIXED BY OUR OWN ASI (2026-07-09) — the int16 ceiling is LIFTED, not just budgeted.** The
> script-gated `barriers2.ipl` roadblocks ("DANGER NO ACCESS ACROSS BRIDGE", STOP signs, cones at the
> Hampton Barns bridge) that appeared permanently on any save past **32,767 permanent text-IPL instances
> map-wide** — root cause an **int16 truncation of building-pool indexes inside `IplDef`** — are now
> **removed by our own engine patch**: **[`asi/perfect-map`](../../../asi/perfect-map)** (a from-scratch
> Win32 `.asi`, MinGW-cross-compiled, no injector/plugin-sdk). It observes `CIplStore::IncludeEntity` into
> an int32 sidecar and redirects `CIplStore::RemoveIpl`'s three building-bound reads (incl. the loop
> back-edge re-read at 0x404BA8) to it. **Confirmed in-game on the 33k-row repro with BOTH FLA and OLA**
> (it overlays FLA's incomplete int16 patch), and — **2026-08-07 — on a THIRD-PARTY map at 70 212 permanent
> rows (2.14× the ceiling)**: with FLA+OLA held constant in both arms, ProperFixes 2.2.1 + its vegetation optional
> shows the barriers as soon as `ProperFixes.asi` is removed, and `perfect-map.asi` in its place removes them
> again (the 2dfx new-game crash with it). One variable, so it also settles what OLA does here — **nothing for
> int16**: the mod needs a dedicated patch, ours or its own, exactly as 004's source study of OLA predicted.
> The old placement work-around (binary streams + budgets +
> `checkTextIplSlotBudget`) still ships for the stock target; the ASI is what LIFTS the limit for the
> opensa-asi target. Full write-up: [`asi/perfect-map/docs/patch-catalogue.md`](../../../asi/perfect-map/docs/patch-catalogue.md)
> (#1) + the repro dial [`tools-debug/sa-int16-repro`](../../../tools-debug/sa-int16-repro). **Remaining (004b):**
> the other unbounded structures (`gpLoadedBuildings` 4096, `IplEntityIndexArrays` 40) still rely on
> FLA/OLA; our ASI only widens the int16 ceiling so far. Kept as the reference for SA's four unbounded
> placement structures + the epic of eliminated wrong theories.

## Symptom

- Real SA (1.0 US + FLA): after installing the `sa-procobj-placement` output, `barriers2.ipl` props
  ghost-streamed in at the bridge on every save — even full-progress saves where all bridges are open.
- Teleport-then-save near the bridge crashed the game.
- OpenSA (browser engine): the same roadblocks appeared baked into far-LOD cells (`lod_2_1`,
  txd `lods`) — same symptom, **different cause** (see [OpenSA side](#opensa-side) below).

## The final root cause (real SA)

`CIplStore::IncludeEntity` (0x404C90) records, for every **binary-streamed** instance, which slice of
the building pool its IPL group owns — and truncates the pool index to **int16**:

```cpp
const auto buildingId = GetBuildingPool()->GetIndex(entity->AsBuilding());
ipldef->firstBuilding = std::min(ipldef->firstBuilding, (int16)buildingId);   // int16!
ipldef->lastBuilding  = std::max(..., (int16)buildingId);                     // int16!
```

`CIplStore::RemoveIpl` later **deletes entities by that `[firstBuilding..lastBuilding]` range** when a
stream unloads. Permanent (text-IPL) instances are created first at boot and occupy the pool's low
indexes; once there are more than 32,767 of them, every binary instance lands above int16 range, the
recorded ranges wrap negative, and stream-out deletes/keeps arbitrary entities — CIplStore slot state
degrades until script-gated groups (barriers2) stream in as if requested. Raising pools (FLA/OLA)
cannot help: the int16 lives in the `IplDef` struct itself and **no limit adjuster exposes it**.

Proven by in-game bisection on the full build (probe script toggled generated areas atomically):
**31,300 total text rows → clean; 33,210 → bug.** The flip is exactly 2^15.

## Three more real (but secondary) unbounded structures found on the way

Each of these was hit for real during the investigation; fixing them was necessary but not sufficient:

| Structure                                                 | Capacity                                                                                                                   | Overflow effect                                                                        | Our guard                                                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `gpLoadedBuildings` (0xBCC0E0, `CFileLoader::LoadScene`)  | **4096 rows per text IPL + its boot-loaded streams**                                                                       | writes past a static array (~26k pointers for our 30k monolith) → trashed statics      | ≤ 2000 pairs per generated area (text+binary ≤ 4096 at boot)                                                                   |
| `IplEntityIndexArrays` (0x8E3F08)                         | **40 slots** (one per gta.dat text IPL with inst rows); slots 41+ overwrite `gbIplsNeededAtPosn`/`ms_pQuadTree`/`ms_pPool` | boot crash in `LoadIplBoundingBox` (garbage `staticIdx`) — hit at 56 files on perfect4 | ≤ 39 files (empirical: a 40-file build crashed); installer folds mod IPLs + `int_cont`/`gen_int1` inst blocks into stock hosts |
| `IplDef::firstBuilding/lastBuilding/firstDummy/lastDummy` | **int16 pool indexes**                                                                                                     | THE root cause above                                                                   | ≤ 30,000 permanent text rows (headroom for runtime-resident binary sharing the pool)                                           |
| FLA×OLA double-patching of the same LoadScene/IPL zones   | —                                                                                                                          | boot crash in `LinkLods` when both adjusters relocate the same arrays                  | exactly ONE adjuster may own IPL limits; our layout fits stock limits anyway                                                   |

## What ultimately shipped (the fix)

> **Read this first, added 2026-08-11.** Items 1, 2 and 5 below describe the WORK-AROUND era and are kept as
> the record of it — the ceiling they fought is lifted now, and two of them no longer exist in the code.
> **The procobj layer has carried no binary streams and no `linkedHeight` since
> [014](../../../tools/sa-procobj-placement/docs/plans/014-permanent-rows-no-lod-twins.md)** (2026-08-10): a
> stream's IPL slot is only resident within 190 units, so it could never carry the draw distance the layer
> needed, and every object is a permanent text row at `lod = -1` instead. Streams survive only for lod-trees'
> overflow areas (item 3), which want streaming and not range.
>
> **What the asi unlocks, in numbers.** The map ships **110 055 permanent text-IPL rows** map-wide — 3.4× the
> 32 767 int16 ceiling this issue is about, and 3.7× the 30 000-row build guard that used to fail it. That
> density exists BECAUSE the root cause is fixed rather than budgeted: the guard was deleted 2026-08-09, and
> since 2026-08-11 the `sa` build both **states every stock ceiling it crosses** (`reportInstallRequirements`)
> and **ships `perfect-map.asi` into the built game root** with its sha256 in `build-timings.json`. The
> work-arounds below are what the same problem cost when it could only be dodged.

1. **Binary-stream placement** (lod-procobj plan 007): vanilla-style per-area layout — small text
   `plobj<i>.ipl` (LOD layer) + `plobj<i>_stream<k>.ipl` binary tiles in gta3.img, HD `lod` fields
   indexing the area's text rows. `encodeBinaryIpl` + `buildLinkedAreas` in `@opensa/map-placement`.
2. **`linkedHeight` (default 4 m)**: only tall species (trees, joshua) keep a permanent text LOD row +
   lod-link (close-range suppression); short species ship BOTH rows unlinked inside the binary streams —
   the decimated LOD hides inside the HD bush and costs **zero** text rows.
3. **lod-trees per-area budget** (plan 011): impostor appends stop at 4000 boot rows per area;
   over-budget trees migrate (HD cut from the stock stream + impostor) into `plotr<i>` areas.
4. **Slot/row economy in mod-installer**: mod-added inst-only IPLs and the stream-less stock
   `int_cont`/`gen_int1` inst blocks are appended into the least-loaded stock host IPL (appends never
   shift binary lod indexes; internal links rebased).
5. **Build guards in perfect-map-builder** (`checkTextIplBudgets`, `checkTextIplSlotBudget` until
   2026-08-08): fails the build over 30,000 total text rows — loud error instead of silent in-game
   corruption. Full build then ran ~21–22k/30k rows, ~37/39 slots. **The slot half is a REPORT since
   2026-08-08** (the target's OLA lifts that array), and both ceilings moved onto the built `sa/` tree —
   an `--exclude sa` run checks neither (07/04).

## The ProperFixes.asi influence (MixMods)

`ProperFixes.asi` (Junior_Djjr / MixMods) was the investigation's Rosetta stone **and** its biggest
red herring:

- With the asi installed, even our worst 30,566-row text monolith worked — it patches the int16/array
  problems at the code level (their own map add-ons need it: Junior's "Increased Vegetation Distance"
  alone is 57k text rows, which is why that mod always worked on the user's install and confused the
  volume theory).
- The asi is **obfuscated** (no cleartext patch addresses) and its license forbids use in other
  projects — so it told us the bugs were code-patchable, but not _what_ they were. Junior's public
  `CrashList.txt` was the actual map ("Limits on .ipl files that contain objects in the inst
  section" → the crash-address family that led to `gpLoadedBuildings`/`IplEntityIndexArrays`).
- Our builds intentionally do **not** depend on it: everything fits stock SA 1.0 limits. For users who
  stack heavy IPL mods on top, PF (or FLA `[IPL] Entity index array`) remains the escape hatch — as a
  user-installed dependency only.

## Eliminated theories (each disproven by a dedicated in-game test)

Big-building classification (`lod*` name / drawDistance ≥ 300 — renames kept as hygiene), lod links
per se, IDE id ranges/collisions, file byte size, per-file chunking alone, every FLA/OLA pool
(Buildings/Dummies/QuadTreeNodes/PtrNodes/Matrices/…), FLA `Inst entries per file`/`Entity index
array` relocations (made things worse when combined with OLA), `CINFO.BIN`/`CColAccel` stale cache
(disabled by modloader on this install), save contamination, modloader-added IPLs. Test hygiene
lessons: an IDE whose ids don't match the IPL silently skips all instances (false "clean"); probe
tooling must toggle text lines AND their binary streams atomically (orphan streams with `lod ≥ 0`
crash at boot: NULL `staticIdx` array).

## OpenSA side

Same visual symptom, unrelated cause: `opensa-lod-generator` baked **all** binary IPL groups from the
IMGs into cell LODs, including script-gated ones the engine never loads. Fixed by skipping binary
areas that have no companion text IPL, except renderware's `OPEN_SCRIPT_IPL` (`truthsfarm`) — the
single source of truth the engine's `extraIpl` (canvas-host) must match. Verified in the map viewer
after a rebake (`lod_2_1` clean); the generator logs the excluded groups so a regression is visible in
the build output.

## Pointers

- `tools/sa-procobj-placement/docs/plans/007-binary-ipl-streams.md` — layout + full post-mortem.
- `tools/lod-trees-generator/docs/plans/011-area-row-budget.md` — area budgets, migration, slot economy.
- `tools/map-placement/src/streamed-areas.ts` / `ipl-binary-write.ts` — the shared machinery.
- `tools/mod-installer/src/ipl-slot-merge.ts` — mod-IPL folding + stock inst-block compaction.
- `tools/perfect-map-builder/src/pipeline.ts` — `reportTextIplCensus` (a cost census since 2026-08-09; the
  int16 throw and the slot report were deleted once the target's always-present `perfect-map.asi` + OLA made
  both ceilings inapplicable).
- gta-reversed: `IplStore.cpp` (`IncludeEntity`, `LoadIplBoundingBox`), `FileLoader.cpp` (`LoadScene`,
  `LinkLods`) — the decompiled ground truth all of this was read from.
