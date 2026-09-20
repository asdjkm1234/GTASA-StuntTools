# 011 — Per-area row budget (overflow migration to `plotr` areas)

**Status: ✅ implemented 2026-07-06 (awaiting a rebuilt 5-trees stage + in-game check).**

## Problem

An SA area's text IPL rows + ALL its binary-stream rows pass through one unbounded 4096-slot static buffer
at boot (`gpLoadedBuildings` — the "ghost barriers" corruption, see lod-procobj plan 007 for the full
post-mortem). Impostor **appends** grow the area's text IPL, and on the pmb build two areas were measured
OVER the envelope after the 5-trees stage: `countrye` **4649** (1257 text + 3392 binary) and `vegasw`
**4487** — silent memory corruption before procobj even ran.

## Fix — migrate over-budget trees to our own streamed areas

`editAreas` (place-map.ts) now takes a per-area row cap (`areaRowCap`, default **4000** — margin under
4096 for other mods' appends):

- Text-IPL HDs are processed FIRST (their appends can never migrate — the HD row must stay), so
  binary-origin appends form the suffix of the append list.
- Stream rewrites are deferred (`PendingStream` per stream: parsed instances + links + removes).
- **Budget pass** (`migrateOverBudget`): while `baseText + appends + binaryRows > cap`, pop a suffix
  (binary-origin) append and migrate the tree — the HD instance is **cut from its stock stream**
  (`rewriteBinaryStream`, header/offsets fixed up; `lod` fields index the TEXT ipl so removals never shift
  them) and re-emitted with its impostor as a linked pair. Each migration frees two rows.
- Migrated pairs go through the shared `buildLinkedAreas` (map-placement `streamed-areas.ts`, same engine
  as lod-procobj plan 007) into **`plotr<i>.ipl`** (text impostor rows) + **`plotr<i>_stream<k>.ipl`**
  (binary HD rows, `lod` → text row) — registered via gta.dat lines (`--out`) or `loader.txt` IPL lines
  (`--modloader`).

Expected scale on the pmb build: countrye excess 649 → ~325 migrations, vegasw excess 487 → ~244; ≈570
pairs total → ONE `plotr0` area (~1140 rows).

## The 40-slot text-IPL budget (shared — ENFORCED after the perfect4 incident)

Each gta.dat text IPL with inst rows takes one `IplEntityIndexArrays` slot (capacity **40**, no bounds
check). The first full pmb build (perfect4) registered **56** — power-of-two halving gave plobj **16** areas
instead of 8, and installed mods brought 9 inst IPLs of their own — overflowing the array and crashing
`CIplStore::LoadIplBoundingBox` on `plotr0_stream` (garbage `staticIdx`). Three fixes:

- `splitByMedian` (map-placement) packs into exactly `⌈N/max⌉` near-equal leaves (`AREA_MAX_PAIRS` 2000) —
  plobj = 8 areas of ~1911 pairs.
- mod-installer folds mod-added inst-only text IPLs into the **least-loaded stock host IPL**
  (`ipl-slot-merge.ts`: rows appended at the end of the host's inst section — appends never shift existing
  indexes so the host's binary-stream lod links stay valid; mods' internal lod links rebased; files with
  `_stream` companions or non-inst sections are left alone; skipped when no host fits the 4000-row area
  budget) — 9 slots → **0**.
- pmb `checkTextIplSlotBudget` fails the build loudly over 40 slots and warns at exactly 40. (**Since
  2026-08-08 it is `checkTextIplBudgets` and the slot half only REPORTS** — the target's OLA lifts that
  array; the row half still throws. The slot economy below is still good memory economy, not a ceiling fight.)

Budget after fixes: 30 stock + 8 plobj + 1 plotr = **39/40 — one slot of headroom** for a user's own
modloader IPL mod. Perfect5 postmortem: EXACTLY 40 slots crashed in-game on `plobj7_stream` — the user's
modloader carries extra mods, and any one of them adding a text-inst IPL makes it 41 → the 41st+ slot writes
land on `gbIplsNeededAtPosn`/`ms_pQuadTree`/`ms_pPool` (0x8E3FA8+) right behind the array. The escape hatch
for heavier mod setups is FLA `[IPL] Entity index array` (it patches exactly this array).

## Measurements

- Synthetic (integration test): cap 4, 3 binary HDs → 1 pair migrated, stock area 2+2 rows, `plotr0` =
  1 text + 1 stream inst with `lod = 0`.
- Real 5-trees stage: _pending rebuild_ — verify with the per-area totals script that every area ≤ 4000.

## Postscript — the FINAL root cause (2026-07-07)

The remaining full-build corruption bisected to **32,768 total text-IPL rows**: `CIplStore::IncludeEntity`
truncates building-pool indexes to int16 in `IplDef::firstBuilding/lastBuilding`, so permanent text rows
past ~32.7k wrap binary instances' recorded ranges negative and corrupt stream-out. lod-procobj plan 007 has
the full write-up; pmb now enforces a 30k text-row budget, and lod-procobj ships short species fully binary
(`linkedHeight`). Tree impostors stay text+linked — they're the layer that genuinely needs close-range LOD
suppression, and their ~9k appends fit the budget.
