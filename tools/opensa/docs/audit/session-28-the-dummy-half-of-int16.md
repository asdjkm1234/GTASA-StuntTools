# Session 28 (2026-08-19): the dummy half of the int16 lift, and the added-vehicles chain planned

**On `main`, 15 commits after `bf151d4a` (session 27), tree clean, NOT pushed. Touched: `asi/perfect-map`
(`src/patches/int16.hpp`, `src/config.hpp`, `gen/catalogue.ts`, `gen/generate.test.ts`), `asi/sdk`
(`log.hpp`, `patch_table.hpp`), `tools/perfect-map-builder/src/entity-pools.ts`, and the docs that carried
the open issue. No pak, no pmb run, no benchmark — the fix lives on an unload path and costs a frame nothing.**

Session 27 ended with plan 011 written and its step 1 declared a GATE: the diagnosis that the LOAD GAME crash
is an int16 wrap in `IplDef.firstDummy/lastDummy` was inferred from a crash dump and load arithmetic, never
watched. This session watched it, then built the fix, then walked the field ladder. Seven steps, every one
with its numbers in the plan.

## What changed

| area | change | commit |
| --- | --- | --- |
| `int16.hpp` `PM_INT16_LOG` diagnostic | widened for the gate: own cap for `incDUMMY`, a per-slot dummy range compared against the engine's int16 pair at `RemoveIpl`, a pool high-water trace per 8 192 ids | `ae621820` |
| `gen/catalogue.ts` (+ `docs/patch-catalogue.md`), `asi/sdk` `VerifyAllSites` / `Log::KeyBytes` | four 011 sites (`0x404C0F` 8 bytes, `0x404C4E`, continuations `0x404C17`/`0x404C53`) enter the catalogue; the SDK prints the LIVE bytes of a differing site, so a coexistence probe is the debug build's own verification block instead of a hand dump | `0bfcfd8c` |
| `int16.hpp`, `config.hpp` | **the fix**: `gFirstDummy/gLastDummy[256]` + a second snapshot pair, type 5 observed by the same `IncludeEntity` hook, two detours overlaid on FLA's jmps, `PM_FIX_INT16_DUMMY` (default on), applied only after the building hooks took and the two continuations verified | `61d2e6d4` |
| docs: open issue → `fixed/`, `restrictions/sa-target.md`, `gta-sa-original/reference-install*.md`, `edge-cases/sa-runtime-limits.md`, `open-issues/README.md`, `entity-pools.ts` warn retired | step 7 — every doc that said NOT LIFTED says LIFTED; the pmb guard's "not released between entries" warning retired, its blind spot recorded beside it | `af1018cb`, `d78776b4` |
| `docs/plans/assets/011-*.txt` | the five field records (`*.log` is gitignored — caught when the first one never entered the repo) | `3304089a` |
| `gen/generate.test.ts` (+1 test) | **every catalogue site's declared bytes are read back off the `gta_sa.exe` fixture** — the check 004 and 011 both paid for in field rounds, now on macOS in 7 ms | `7329e8d9` |

## The numbers

- **Gate (step 1)**: `incDUMMY slot/id 35 32768` on the FIRST world entry; from slot 35 on the engine's
  `lastDummy` reads negative (`-32718` for a true `32818`) while `firstDummy` stays positive, so `RemoveIpl`'s
  `cmp edi,ecx; jg` sees an empty range and skips the slot's whole dummy pass. Pool high-water 40 960 →
  98 304 across two entries at `Dummys = 100000`.
- **Completeness (step 2)**: 184 word accesses to `+0x26/+0x28` in the exe, 31 in IplDef context, every one
  classified — the three `RemoveIpl` reads are the ONLY readers; gta-reversed agrees (two functions name the
  pair). Both `RemoveIpl` loops are INCLUSIVE (`jle`); the engine never resets the pair on unload (stale
  `first`, wrapped `last`); `CColAccel`'s cache path is dead on PC (no `CINFO.BIN`, nothing enters LOADING).
- **Coexistence (step 3)**: FLA jmp-hooks `0x404C0F` (`e9 94 12 ec 01`, spans BOTH adjacent reads) and
  `0x404C4E` (`e9 66 12 ec 01`, spans `movsx` + `inc edi`) — same shape as its building hooks, and the leak
  was measured WITH those hooks live, so overlaying them is not a regression. Continuations pristine.
- **Ladder (step 6)**: 8 entries at `Dummys = 100000` (the 6th used to die), 5 at 50 000 (the 3rd used
  to die), the high-water FROZEN at 40 960 after entry 1 both times. The 40 000 rung crashed DURING the
  first entry — which measured something the plan had assumed away: **the first entry alone occupies
  [40 960, 49 151] slots against 33 043 rows in the whole map** (SA's `CPool::Delete` rewinds the cursor, so
  the high-water is occupancy, not a cursor artefact). Regression on the shipping build: ghost barriers
  stay gone (his verdict), FLA healthy, no dump.

## What it decided

- **`Dummys` stays 100 000.** The stopgap became the value, for a different reason: the leak is gone, but the
  first entry needs 41–49k and the pool costs 56 B × 100 000 = 5.6 MB. 50 000 holds with a margin that is
  somewhere between 2 % and 22 % — not a margin to ship on.
- **The pmb entity-pool guard has a recorded blind spot.** It gates permanent rows (17 644) and the first
  entry's peak is not derivable from rows — `Dummys = 40000` passes it and crashes at the same `0x00538103`.
  Recorded in `restrictions/sa-target.md`, the edge-case file and beside the guard; not fixable from a row
  census, so it is a rule ("keep the ini at 100 000"), not a gate.
- **Why the boot places more dummies than the map has rows is NOT pinned** — the plan's Risks entry
  ("the boot places the permanent set more than once", `LoadIplBoundingBox` as a second path into
  `LoadObjectInstance`) is now a measured fact with an unmeasured cause. It did not block the plan; it
  becomes work only if the first-entry peak ever approaches the pool.

## What it cost / what it bought

One session, no rebuild, five field rounds of ~15 s each (he ran them; I dropped each build into the bottle
myself — his call this session). Bought: the crash that made LOAD GAME a countdown is gone on the install
we ship to, and the instrument that would have made 004 one round shorter (live bytes on a differing site,
the exe byte-accuracy test) now exists for the next patch.

## Second half — the census, a parked annoyance, and plan 102

| area | change | commit |
| --- | --- | --- |
| `scripts/debug/exe-field-access-scan.ts` (+ `docs/debug/README.md` row) | the completeness scan behind an engine patch as a kept script (192 / 34 on 011's question — the hand filter had skipped 8 `fldcw`) | `99915d89` |
| `docs/improvements/fla-quiet-startup.md` | FLA's monthly "main window" code — designed (`!fla-quiet.asi`, WH_CBT → Continue, never in the pmb tree), parked, says plainly it circumvents a donation reminder. **Original SA only** | `534766fe` |
| the 212-folder census of `mods-src/original/vehicles` | every file KIND against `applyVehicle`: two are unread — `model-variations-extra.txt` (8 trucks' trailers silently dropped; the built ModelVariations ini is byte-identical to the mod's) and `text.txt` (slamvan's part names absent from the built GXT); plus the settings-fallback trap | → vehicle-installer 012 |
| `tools/add-vehicles/docs/plans/102-add-vehicles/` (umbrella + `recon.md`), `tools/add-vehicles/docs/plans/001–007`, `tools/vehicle-installer/docs/plans/012–013`, `asi/perfect-vehicle/{README,docs/plans/001–002}` | the added-cars chain, from the recon of his old tool (`NO_COMMIT/1`, read-only) and the 115-car `add-vehicles` data to plans; the shared layer decided ONCE in the umbrella | `beaccffa` … `e0116763` |
| `docs/gta-sa-original/carmods-upgrade-ceilings.md`, `docs/restrictions/sa-target.md` (+3 rows) | the two `carmods.dat` ceilings nobody checks — 30 `link` pairs game-wide (`CLinkedUpgradeList` @0xB4E6D8; stock 23, **his old build exactly 30**), 16 parts per car (`m_anUpgrades[18]`; stock `jester` full) — and the part-name rules (prefix = behaviour, ≤ 19) | `e0116763` |

### The numbers of the second half

- `vehicles/`: 368 dff, 388 txd, 225 txt (205 settings, 9 features, 8 variations-extra, 2 tuning, 1 text),
  7 `cleo/`, 5 `.DS_Store`; 7 cars ship dff+txd only.
- `add-vehicles/`: 115 cars, 574 files — 115 × (dff, txd, settings), 45 extra TXDs, 14 features, 4 audio,
  1 parked, ~46 re-modelled part dffs under stock names.
- Id window 19 001–19 999 on the built tree: **0 used, 999 free in one run**; demand 161. Highest used id
  18 656; 26 in the map window 18 631–19 000.
- `link` pairs: stock 23, our build 23, his old build 30; `add-vehicles` ships 8 wing pairs → 31 without
  `perfect-vehicle`.

### Decisions he took (not to be re-derived)

Source root `mods-src/original/add-vehicles/` (same shape as `vehicles/`; `reserved/` temporary, unread);
id window 19 001–19 999; tuned traffic YES; trains LATER in the same tool; the ceilings lifted by a SEPARATE
asi (named `perfect-vehicle`); item 3's second bug deferred by him; FLA window bypass parked.
