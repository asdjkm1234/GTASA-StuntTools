# Session 39 (2026-08-22) — two plugins, one format, and a floor that was throwing away stock's own fog

One plan closed end to end ([104](../plans/104-timecyc24h-source/readme.md)), 11 commits, 35 files. No build
was run and none was needed: every verdict this session came from the one-model/one-pose instruments against
the pak that already existed.

Checked at the close: **4 938 tests green (526 files)**, `tsc -b` and `eslint` clean, fixtures regenerated
from an empty tree (137/137), 0 broken links across the docs touched.

## What it was supposed to be, and what it turned out to be

The plan was written as *"support a second 24h timecyc format"*. **There is no second format.** Two 24h
plugins exist in this project's mod tree — `timecyc24h.asi` (Dante) and `timecycle24.asi` — and `strings`
over each returns **exactly one `.dat` file name and no other**. The file shipped with the second one is the
same 23 × 24 × 52 schema as Dante's, down to `DirMult` as the 52nd column stock does not have. Installing one
plugin's data and running the other does nothing because the plugin never finds its name, reports nothing,
and the stock 8-keyframe table stays live. It reads as a format incompatibility and is a file-name one.

The first recon had compared three files and inferred a format question; the second opened a fourth file the
first had never looked at (`debug/clean_map/data/timecyc_24h.dat`, bundled WITH the other plugin) and the
framing collapsed in one command. **The cost of the wrong framing was zero** only because the recon ran
before the code did — which is the argument for the recon step, not for the plan.

Recorded as a fact about the original game: [`gta-sa-original/timecyc24h.md`](../gta-sa-original/timecyc24h.md).

## What changed

| # | Change | Where |
| --- | --- | --- |
| 01 | `TIMECYC_SOURCES` holds the candidate order once; `resolveTimecycSource` + an async twin | `packages/renderware/…/timecyc-source.ts` |
| 01 | the driver takes `{ text }` and parses through `ensure24h` — the ROW COUNT decides, not a flag | `engine-environment-driver.ts` |
| 02 | `describeTimecycSource` + one boot line in both live readers | game host, engine-lab |
| 02 | two fixtures, the candidate order as an `it.each` table, the circular golden test retired | `scripts/test-fixtures.ts`, 3 suites |
| 03 | the three names as a CONTRACT; the builder as a RESTRICTION | `contracts/mods.md` §2, `restrictions/` |
| 03 | `npm run timecyc` writes one file into `merged/` and nowhere else | `tools/timecyc-builder/src/index.ts` |
| 04 | the fog start is passed through as authored — the floor is gone | `engine-environment-driver.ts` |
| 04 | the opensa target ships Dante's table with stock's `FarClp`/`FogSt` | `mods-src/…/opensa/1. […] (default FarClp + FogSt)` |

## What it cost, and what it bought

**Cost: nothing measurable.** The user's own `?bench=all` sweep on the SAME pak, engine-only A/B against the
sweep taken before this session — mean frame **12.788 ms against 12.767, +0.17 %**, every scene within ±1.7 %,
triangles within 0.3 %, slow frames 24 → 21
([record](../benchmarks/opensa-engine/2026-08-22-ingame-plan-104-engine-ab.json)). The 552-row table costs
**+0.32 ms** over the 504-row one, once, at boot. The one scene with a mechanism behind it was isolated in
six alternated runs: unflooring the fog costs **+1.53 % of the world pass on a fog scene** and nothing at the
frame ([write-up](../benchmarks/opensa-engine/2026-08-22-sf-fog-dawn-floored-vs-unfloored.md)).

**Bought:**

- A world can carry its 24h table under the name either plugin uses, and a mod shipping
  `data/timecyc24h.dat` in the `opensa` layer is supported and documented.
- **Stock's own near haze, on 112 of its 504 expanded rows.** The `Math.max(0, …)` floor was never a Dante
  problem: it had been discarding the fog mood the original authors on every fog and smog weather, which is
  why FOGGY_SF never looked foggy from the ground. Recovered from the reversed source before anything was
  fitted — SA hands the pair straight to D3D9 LINEAR fog with **no clamp anywhere**, so a negative start is a
  haze already partly opaque at the camera ([`timecyc-fog.md`](../gta-sa-original/timecyc-fog.md)).
- A table the field actually wants: Dante's everywhere, his fog nowhere.

## The three things that were nearly recorded wrong

Kept because each is a class, not an incident.

1. **A sentinel that is also a legal value.** The parser's read-failure defaults are `-1000` (int) and `-100`
   (RGB channel). Dante authors `FogSt` — a FLOAT column — at exactly `-100.00` for a whole weather and
   `-1000.00` on three rows. A scan of parsed rows for those two numbers reported **24 corrupt rows in a file
   that has none**, and it took printing the offending raw lines to see 52/52 tokens and a perfectly readable
   row. The check now walks the FIELDS layout and only tests the columns that can produce the value.
2. **A column offset asserted from memory.** The first check that "only the fog pair moved" used offsets
   34/35 when `farClip`/`fogStart` are **27/28**, and returned a self-contradictory answer — *542 cells
   changed, and all 542 are outside the fog columns* — which was nearly written down as a finding.
3. **A golden test that named an external reference and tested itself.**
   `reproduces the bundled timecyc_24h.dat exactly (byte-for-byte)` compared `convertTo24h` against a fixture
   that `scripts/test-fixtures.ts` generates by calling `convertTo24h`. Green for months, evidence of
   nothing. Renamed to what it checks, and `parseTimecyc`'s own doc no longer claims the parity.

## One framing error, corrected in the same session

Asked *"what should win INSTEAD of Dante's table"* after the field rejected its values. Wrong: the format
SUPPORT is this plan's deliverable and is unconditional — a rejected table replaces nothing in it, and the
question was only ever about which content our own tree ships. He said so in three words and the docs were
corrected in `48db4e03`.

## Covered afterwards, because the session had left it uncovered

- **`scripts/debug/game-shot.ts`** — the headless GAME-host capture used 12 times today existed only as a
  throwaway, twice written and twice deleted. Promoted with a row in [`debug/README.md`](../debug/README.md),
  carrying the three traps that each cost a round: a guessed spawn `z` drops the player into the void,
  `weather` and the player's CITY must be chosen together, and aim is not sight.
- **The fixture-rename trap** — `modFile` resolves a mod by FOLDER NAME, so this session's rename would have
  left the manifest line finding nothing. Now a rule in
  [`development/scripts.md`](../development/scripts.md), with the reason two fixtures may point at two copies
  of one mod.
- **`architecture/tools.md`** still described `timecyc-builder` as precomputing data "consumed by the
  engine". It is a utility whose output no build reads; corrected.

## State at the close

`main` = origin + 48, tree clean, **nothing pushed**. `build/original/{sa,opensa}` are from this morning and
do NOT carry `vehicle-installer` 015, the nitro filter, or the new opensa timecyc table — the next build is
what turns those from committed into testable. The bottle still runs a hand-edited
`ModelVariations_Vehicles.ini`; that same build replaces it properly.
