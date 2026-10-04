# 007 — Binary IPL streams for the static procobj placement

**Status: ✅ SHIPPED 2026-07-07 (root cause pinned and verified in-game, bridge clean at ~21k/30k text rows) —
and SUPERSEDED for this layer on 2026-08-10 by
[014](./014-permanent-rows-no-lod-twins.md).**

> **Do not implement the shape below for a layer that needs RANGE.** Binary streams solved the problem this plan
> was written for — mass instances without mass permanent rows — and they still solve it for lod-trees' overflow
> areas. What they cannot do is carry draw distance: `CIplStore` loads a stream's IPL slot only while the player is
> inside its bounding box grown by 190 units, so this layer drew to ~190 m while declared at 290, for months.
> The procobj layer is now permanent text rows at `lod = -1` with range from the stock `procobj.ide`. The
> root-cause analysis below (the 4 096 boot buffer, the big-building path, the `lod`-prefix trigger) is all still
> true and still worth reading.

## THE final root cause (found by bisecting the full pmb build)

`CIplStore::IncludeEntity` (0x404C90) truncates **building-pool indexes to int16** when recording
`IplDef::firstBuilding/lastBuilding` (and `firstDummy/lastDummy`) for every binary-streamed instance.
Permanent TEXT-IPL instances fill the pool's low indexes at boot; once they exceed 32,767, every binary
instance lands above int16 range, the recorded ranges wrap negative, and `RemoveIpl`'s range-based delete +
slot bookkeeping operate on garbage — script-gated IPLs (barriers2) ghost in, teleport-saves crash.
In-game bisection on perfect6: **31,300 total text rows clean, 33,210 buggy** — the flip is exactly 32,768.
This also explains why Junior's 57k-row mod needs ProperFixes.asi (it patches this), why standalone builds
(~25k rows) were fine, and why no FLA/OLA option ever helped (neither exposes these int16 fields).

**Budget rule: permanent text-IPL rows ≤ 30,000 map-wide** (int16 max minus headroom for runtime-resident
binary instances sharing the pool) — enforced by pmb `checkTextIplBudgets` (on the built `sa/` tree since
2026-08-08; an `--exclude sa` run never reaches it). The generator's lever is
`linkedHeight` (default 4 m): species below it ship BOTH rows unlinked in the binary streams (the decimated
LOD hides inside the HD up close — zero text rows); only tall species (trees, joshua) keep the permanent
text LOD row + lod-link suppression.

## Problem — the "ghost barriers" corruption

Emitting ~15k HD+LOD pairs as ONE text IPL (30,566 inst rows) corrupts real SA: script-gated binary IPLs
(`barriers2.ipl` bridge roadblocks) get ghost-streamed on any save, plus teleport-save crashes near the
bridge. An epic in-game bisection (2026-07-04..06) eliminated: lod-name/drawDistance big-building
classification (plo-rename + dist 290 still broke), lod links, IDs, byte size, FLA/OLA pools, and ≤4000-row
text chunking. Root mechanism (gta-reversed decomp): `CFileLoader::LoadScene` pushes **every text IPL inst
row** through `gpLoadedBuildings` — `std::array<CEntity*, 4096>` at `0xBCC0E0` — **without a bounds check**,
and `CIplStore::SetupRelatedIpls` appends the area's binary-stream instances to the same buffer at boot.
Overflow depth decides the symptom (15,283 rows looked "clean"; 30,566 visibly broke). Junior_Djjr's
CrashList documents the crash family ("Limits on .ipl files that contain objects in the inst section");
MixMods' obfuscated `ProperFixes.asi` patches it (their license forbids reuse), FLA's
`[IPL] Inst entries per file` / `Entity index array` did NOT fix it on the user's install, and FLA+OLA
double-patch the same code and crash `LinkLods`.

## Fix — ship the placement the way vanilla ships 35k+ instances

`buildStreamedIpl` (map-placement `procobj/convert.ts`) replaces the monolith (and the earlier chunk
experiment):

- **Spatial areas** via recursive median split (longest XY axis), ≤ `AREA_MAX_PAIRS = 1900` pairs each —
  one area's text rows + binary rows stay ≤ 4096 together (the shared boot buffer).
- **Per area `plobj<i>.ipl`** (short base: IMG VER2 caps entry names at 23 bytes; text, registered in gta.dat): the permanent LOD layer —
  `lodId, plo<model>, 0, transform, -1` rows only.
- **Per area `plobj<i>_stream<k>.ipl`** (binary `bnry`, inside gta3.img, ≤ `STREAM_MAX_INST = 512`
  per tile): the HD layer, each record's `lod` field indexing its LOD row in the area's text IPL —
  vanilla's exact HD↔LOD mechanism, so SA suppresses the LOD while the HD is streamed in.
- Binary writer: `map-placement/src/ipl-binary-write.ts` (`encodeBinaryIpl`) — 76-byte header mirror of the
  engine's `parseBinaryIpl`; round-tripped in tests against the engine parser and `stripBinaryIpl`.
- **`lod_procobj.models` manifest** (converted HD species names) — the HD layer is id-only binary now, so
  pmb `collectGeneratedModels` reads names from the manifest (falls back to the legacy monolith IPL).
- OpenSA needs no changes: `resolve-map` already merges `<base>.ipl` + `<base>_streamN.ipl` per gta.dat
  entry.

Why this is safe where text wasn't: binary instances stream in/out by position through `CIplStore` — they
never mass-accumulate in the boot path, and per-area boot totals (~3.8k rows) sit inside the stock 4096
envelope, like vanilla's own areas (vegasE 718 text + streams).

## Requirements that remain (documented, not code)

- `[IPL] Buildings` raise (FLA or OLA): ~15k permanent LOD buildings + stock ≈ 26k > stock pool 13,000.
- Exactly ONE limit adjuster may own the IPL-limit patches; FLA+OLA both active on the same zones crash.

## Measurements

- 15,283 pairs → 8 areas (≤1900 pairs each), ~30 binary stream tiles ≤512 inst; gta.dat gains 8 IPL lines
  (text IPLs with inst: stock 30 + 8 = 38 ≤ the 40-slot `IplEntityIndexArrays`).
- **lod-trees is over the same envelope** (measured on `build/original2/.work/5-trees`): its impostor
  text-appends push `countrye` to **4649** (1257 text + 3392 binary) and `vegasw` to **4487** — both > 4096
  BEFORE procobj even runs. That's why the full pmb build broke at a lower procobj threshold and why the
  chunking experiment "didn't help" on it. lod-trees now has a per-area append budget with overflow migration — lod-trees plan 011.
- In-game verdict: **clean** — NO_COMMIT/5 build, same save that always reproduced the barriers.
