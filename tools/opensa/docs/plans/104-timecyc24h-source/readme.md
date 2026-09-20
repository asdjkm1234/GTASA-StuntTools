# 104 — `timecyc24h.dat` as a third timecyc source

**Status: IN PROGRESS.** Planned 2026-08-21; second recon 2026-08-22 (see below — the two 24h
plugins read the SAME format and differ only in the file name each hardcodes); step 01 started 2026-08-22. Single-file plan; the steps are small enough to ship in one
change each.

**The built tree carries a timecyc the engine never reads.** `build/original/opensa/data/` holds THREE
timecycs: the stock `timecyc.dat` (8 keyframes per weather), our own generated `timecyc_24h.dat`, and — since
the opensa-layer mod `1. [24H] Refixed Original Timecycle` landed — `timecyc24h.dat`, the file format of the
`timecyc24h.asi` plugin (Dante) that the reference install runs through modloader
(`docs/gta-sa-original/reference-install-config.md`, the `timecyc24h` row). Every loader we have knows two
names, `timecyc_24h.dat` then `timecyc.dat`; the third is mirrored into the tree and ignored.

The user's call (2026-08-21): extend the loading order to

1. `data/timecyc_24h.dat` — as authored (24h already);
2. else `data/timecyc24h.dat` — as authored (24h already);
3. else `data/timecyc.dat` — the mandatory stock table, expanded through `convertTo24h`.

## What the recon measured (2026-08-21, against the built tree)

Read the three files with the parser we ship (`packages/renderware/src/parsers/text/timecyc.parser.ts`):

| File | Lines | Data rows | Tokens per row | Weather headers | Parse failures | Negative `FogSt` rows (min) |
| --- | --- | --- | --- | --- | --- | --- |
| `timecyc.dat` (stock) | 437 | 184 = 23 × 8 | 51 (one row 49 — the known RAINY_COUNTRYSIDE 8PM corruption) | 23 | the 2 stock quirks | 37 (−200) |
| `timecyc_24h.dat` (ours) | 1 092 | 504 = 21 × 24 | 52 | 21 | 2 (carried from stock) | 96 (−200) |
| `timecyc24h.dat` (Dante) | 1 196 | 552 = 23 × 24 | 52 | 23 | **0** | **243 (−1 700)** |
| `timecyc_24h.dat` (the copy bundled with `timecycle24.asi`) | 1 174 | **552 = 23 × 24** | 52 | 23 | 0 | 243 (−1 700) |

Three consequences, and they decide the shape of the plan:

1. **The parser needs no extension.** The Dante file is the same 27-field schema in the same order — its
   header only renames two groups (`PostFx1ARGB` / `PostFx2ARGB` for our `Alpha1 RGB1` / `Alpha2 RGB2`) and
   marks hours `00AM…23PM` instead of `0h…23h`; comments are skipped, so neither matters. It carries all 23
   weathers × 24 hours, which `ensure24h` already accepts (`WEATHER_NAMES.length * HOURS`) and `buildTimecyc`
   already trims to the 21 time weathers. **The whole gap is in the loaders**: `GtaSaWorldAdapter.loadTimecyc`
   (`packages/game/src/adapters/gta-sa-world.adapter.ts:382`), the canvas host
   (`apps/web/src/ui/engine-canvas-host.tsx:502`) and the lab (`apps/engine-lab/src/pak-source.ts:27`) each
   spell the two names by hand, and the environment driver takes an `is24h` boolean
   (`engine-environment-driver.ts:124`) instead of letting `ensure24h` decide by row count.
2. **`timecyc_24h.dat` is OUR OWN OUTPUT, not a stock file, and it shadows the mod.** `npm run timecyc`
   (`tools/timecyc-builder/src/index.ts`) writes stock + a RealVision night merge straight into
   `game-src/original/data/timecyc_24h.dat` (2026-07-16 in the tree, byte-identical to the built copy), and
   the build mirrors it. Under the order above, the mod's `timecyc24h.dat` is therefore SILENTLY shadowed in
   exactly the tree we have today — the file is installed, the build exits 0, and the night is RealVision's.
   The order stays as the user set it (an explicit hand-authored 24h table outranks a mod's); what the plan
   adds is that the choice is **visible** (step 02) and that the generated file's home is decided (step 03).
   Note the builder doc (`docs/development/timecyc-builder.md`) already says the output goes to
   `timecyc-builder/merged/` — the code and the doc disagree today.
3. **The Dante table leans on negative `FogSt` six times harder than stock, and we floor it.**
   `engine-environment-driver.ts:192` clamps `fogStartDistance` to `≥ 0`. Stock authors a negative start on
   37 rows (min −200); Dante on 243 rows down to −1 700 (smog, desert, underwater nights). Loading the file
   "as authored" and then flooring a quarter of its fog rows is not honouring the data
   (`docs/project-goals.md` §1). Step 04 recovers what a negative start means in SA before anything is fitted.

## What the second recon added (2026-08-22) — the two formats are the SAME format

The first recon compared three files and read the difference as a format question. It is not. Re-run against
the binaries and against a fourth file that the first pass never opened:

**1. There are TWO 24h plugins in this repo, and each hardcodes ONE file name.** `strings` over both:

| Plugin | Bytes | Where | The only file name in the binary |
| --- | --- | --- | --- |
| `timecyc24h.asi` (Dante) | 107 008 | `mods-src/original/mods/sa/23. Timecyc 24h by Dante/modloader/timecyc24h/` | `timecyc24h.dat` |
| `timecycle24.asi` | 86 016 | `mods-src/original/debug/clean_map/` | `timecyc_24h.dat` |

**That is the whole reason a swap fails in the real game** (the user's report: install `timecyc24h.dat` and
run the asi that wants `timecyc_24h.dat` and nothing happens). The plugin does not find its file, says
nothing, and the stock 8-keyframe table stays live. It is not a parse failure and there is no error to see.
Only Dante's plugin is in the reference install (`reference-install-config.md`, the `timecyc24h` row);
`timecycle24.asi` lives in the debug install and is not shipped.

**2. `timecycle24.asi` ships its own `timecyc_24h.dat`, and it is 23 × 24 — the same shape as Dante's.**
`mods-src/original/debug/clean_map/data/timecyc_24h.dat`: 552 rows, 52 tokens each, 23 weather headers, the
header labels spelled exactly like our `FIELD_LABELS` (`Alpha1 RGB1 Alpha2 RGB2 … DirMult`). So the two
plugins read the **same 27-field, 23 × 24, 52-number schema**; what differs between the two `.dat` files is
their comment cosmetics (`00AM…23PM` + `PostFx1ARGB` for Dante, `0h…23h` + `Alpha1 RGB1` for the other) and
their authored content. **Nothing about Dante's file is a new format**, and consequence 1 above holds for a
stronger reason than it was written for.

**3. OUR generated `timecyc_24h.dat` is the odd one out — 504 rows where the format is 552.** `convertTo24h`
walks `TIME_WEATHERS = 21` and drops `EXTRACOLOURS_1` / `EXTRACOLOURS_2`; both reference files carry them at
full 24 rows, **and their 24 hourly rows are not identical to each other** (checked on the bundled file —
the extracolours are authored per hour, not one static row repeated). Our engine never reads weathers 21/22
(`buildTimecyc` keeps 21), so nothing is broken today; what is wrong is that we WRITE a file under a name
whose format is 23 weathers and put 21 in it. Feed it to either plugin and the extracolours come from
nowhere. Step 03 owns this together with the file's home.

**4. Our file carries the stock corruption; Dante's does not — that is what "Refixed" means.** Read back
with our own parser, `timecyc_24h.dat` row 404 (`RAINY_COUNTRYSIDE`, hour 20) fails **13 fields** — the
`-1000` int-read default in `LightShd`, `PoleShd`, `Alpha1`, `Alpha2`, `CloudAlpha`, `IntensityLimit`,
`WaterFogAlpha` plus the `-100` RGB default in six more — inherited from stock keyframe 6, the 49-token
line, through `convertTo24h`. Stock itself fails the same 13; Dante's 552 rows fail **zero**.

**The count above was measured twice, and the first instrument lied.** `getval`'s failure defaults are
`-1000` (int) and `-100` (RGB channel), and **Dante authors `FogSt` at exactly `-100.00` and `-1000.00`** —
a whole float weather at −100, three rows at −1000. A scan of whole parsed rows for those two numbers
therefore reports 24 "failures" in a file that has none, and it did, until the check was restricted to the
int/RGB columns that can actually produce them. The test in step 02 carries that restriction and the reason
in a comment. The class: **a sentinel that is also a legal value is not a sentinel** — the check has to know
which columns can produce it.

**5. The negative-`FogSt` census, over the 504 rows we would actually sample**: Dante 243 rows (min −1 700)
against our 96 (min −200). Dante authors it across **13 weathers, 11 of them for all 24 hours** —
`EXTRASUNNY_SMOG_LA`, `SUNNY_SMOG_LA`, `CLOUDY_LA`, `CLOUDY_SF`, `RAINY_SF`, `FOGGY_SF`,
`CLOUDY_COUNTRYSIDE`, `RAINY_COUNTRYSIDE`, `SANDSTORM_DESERT`, `UNDERWATER` (plus one hour each in
`EXTRASUNNY_LA`, `EXTRASUNNY_DESERT`, `SUNNY_DESERT`). Step 04 is load-bearing, not a tidy-up.

**6. Switching the source is a visible change of mood, not a cosmetic one.** Mean |Δ| per field over the
504 shared rows, Dante against ours: `fogStart` 220.9, `farClip` 154.4, `lowClouds` 73.9, `sunCore` 30.3,
`skyBot` 21.3, `skyTop` 20.8, `bottomClouds` 26.3. `Alpha1` and `Alpha2` differ on **all 504 rows** (Dante
writes 248 where stock and ours write 255). Whatever step 04's A/B shows, it will not be subtle.

**7. A test that does not test what its name says.** `timecyc.parser.test.ts:65` —
*"reproduces the bundled timecyc_24h.dat exactly (first 504 rows, byte-for-byte)"* — compares `convertTo24h`
against `fixtures/original/data/timecyc_24h.dat`, which `scripts/test-fixtures.ts:512` **generates by calling
`convertTo24h`**. It is circular: it asserts our expansion equals our expansion, and says nothing about
parity with the reference tool. The bundled file next to `timecycle24.asi` cannot replace it either — its
`timecyc.dat` is byte-identical to stock, but its 24h table is authored, not an expansion of it (20 416 of
26 208 values differ). So the parity claim currently has **no** evidence behind it; either a real reference
output is found, or the test is renamed to what it actually checks (a round-trip). Step 02 owns this.

**What none of this establishes**: the asi files were read for strings, not disassembled. That the plugin
only swaps the table — and does not also change how the game blends between entries — follows from its
interface, not from its code. Our engine has no 8-keyframe table to patch (`sampleTimecyc` interpolates a
fractional hour over 24 rows already), so there is no plugin logic to port; that claim is worth one
sentence of doubt if a field A/B in step 04 ever disagrees with the `sa` target.

Both copies of the mod's file were identical when this was written (`sa/24. [24H] Refixed Original Timecycle
1.6/modloader/timecyc24h/timecyc24h.dat` and `opensa/1. [24H] Refixed Original Timecycle/data/timecyc24h.dat`,
`cmp` clean), so on the `sa` target the original consumes it through Dante's asi and nothing in this plan
touches that target. **That is no longer true of the opensa copy since step 04** — see the verdict below: the
`sa` layer still ships Dante's file verbatim for his asi, the `opensa` layer now ships ours.

## Steps

| # | Step | Lands in |
| --- | --- | --- |
| 01 ✅ | ONE resolver, four call sites, `ensure24h` instead of `is24h` | `packages/renderware` (resolver), `packages/game`, `apps/web`, `apps/engine-lab` |
| 02 ✅ | the choice is visible: a boot log line naming the winner; fixture + tests | `packages/game` tests, `scripts/test-fixtures.ts` |
| 03 ✅ | docs + the generated file's home + the utility restriction | `docs/contracts/mods.md`, `docs/gta-sa-original/`, `docs/features/`, `tools/timecyc-builder` |
| 04 ◐ | negative `FogSt`: SA's meaning recovered, floor removed, A/B captured — his verdict pending | `packages/game` driver, `docs/benchmarks/` |

### 01 — one resolver, three call sites — ✅ DONE 2026-08-22

- Add `resolveTimecycSource(getText: (path: string) => string | null): TimecycSource | null` beside the parser,
  where `TimecycSource = { kind: 'authored-24h' | 'dante-24h' | 'stock', path: string, text: string }` and
  the candidate list `TIMECYC_SOURCES` is ONE readonly array in file order — the three loaders call it, none
  of them spells a file name again. The lab's reader is async (`fetch`); give the resolver a sync signature
  over a `getText` callback and let the lab pre-fetch the three candidates, or add a tiny async twin — pick
  whichever keeps `pak-source.ts` free of a second copy of the order.
- The driver's `timecyc?: { is24h: boolean; text: string }` becomes `timecyc?: { text: string }` and parses
  through `ensure24h(parseTimecyc(text))` — row count decides, as it already does for the builder. This is
  what makes Dante's 552 rows load without a special case: `buildTimecyc` keeps the first 504.
- `loadTimecyc()` in the adapter does the same through the resolver; no file present stays a thrown error
  (`requireText`'s message names all three candidates).

**Done when** the adapter, the host and the lab have no string literal `timecyc_24h.dat` left except inside
`TIMECYC_SOURCES`, and the existing suite is green (the 24h fixture path and the stock path are unchanged in
behaviour).

**What shipped**, and the three things the step did not foresee:

- `packages/renderware/src/parsers/text/timecyc-source.ts` — `TIMECYC_SOURCES` (the order, once),
  `resolveTimecycSource` and an async twin over the same array for the lab's `fetch`. Both are six lines;
  neither restates the order. Exported from the package index alongside `ensure24h`, which the driver now
  needs.
- **There were FOUR call sites, not three.** `apps/engine-lab/src/environment.ts` takes `is24h` as a
  positional parameter and `main.ts` passes `timecyc.is24h` into it — the flag travelled one hop further
  than the recon said. `LabTimecyc` is now simply `TimecycSource`, so the lab carries `kind`/`path` for
  free when step 02 logs the winner.
- **Letting the row count decide is STRICTER than the flag was, and it caught two of our own tests.**
  `engine-environment-driver.test.ts` built synthetic tables of 24 identical rows and passed `is24h: true`,
  which made the old code skip `ensure24h` entirely. They are whole 21 × 24 tables now (`wholeTable(row)`);
  weather 0 reads the same row, and `ensure24h` keeps rejecting a truncated file instead of being loosened
  to "any multiple of 24".
- The adapter's "table is mandatory" throw now names all three candidates
  (`asset not found: data/timecyc_24h.dat / data/timecyc24h.dat / data/timecyc.dat`), which is the only
  place a missing table is loud; the silent fall-through between present names is what step 02's log line
  is for.
- Measured at the close: suite **4 923 green** (526 files, +7 — the resolver's own unit test), `tsc -b` and
  eslint clean. No fixture and no build were needed: nothing in this step reads a Dante file yet, which is
  step 02.

### 02 — the choice is visible; fixture + tests — ✅ DONE 2026-08-22

- The boot log gets one line: `[timecyc] data/timecyc24h.dat (dante-24h, 552 rows)` — the same place the
  sampled entry is logged on the `'time'` event today. A shadowed mod file is then one `grep` away instead of
  a session.
- Fixture: `data/timecyc24h.dat` by the manifest rule — ONE line,
  `modFile('[24H] Refixed Original Timecycle/data/timecyc24h.dat', 'data/timecyc24h.dat')` (found by NAME
  across layers; the opensa-layer folder is the exact-name match), regenerated with `npm run test:fixtures`,
  never dropped in by hand. **Repointed in step 04** at the `sa` layer's verbatim copy, because the opensa
  folder was renamed and its file is ours now.
- Tests (negative first, positive after, per the project's test structure):
  - `timecyc.parser.test.ts`: the Dante fixture parses to 23 × 24 rows of 52 numbers with no sentinel
    defaults; `ensure24h` passes it through; `buildTimecyc` keeps 21 weathers.
  - `gta-sa-world.adapter.integration.test.ts`: none of the three → throws naming all three; only stock →
    converted; Dante + stock → Dante wins; all three → `timecyc_24h.dat` wins (the order, as a table).
  - the resolver's own unit test for `kind`/`path`.

**Done when** the order is asserted by a test, not by a comment.

**What shipped:**

- `describeTimecycSource` beside the resolver, and the line `[timecyc] data/timecyc24h.dat (dante-24h, 552
  rows)` printed once at boot by **both** live readers — the game host and the lab. It costs a second parse
  of ~500 lines, once; that is cheaper than re-deriving the "which lines are data" rule in a counter of its
  own. `loadTimecyc` on the adapter has no production caller (only tests), so those two are the whole live
  surface.
- Fixture `data/timecyc24h.dat` by the manifest rule — one `modFile` line, resolved by NAME to the
  opensa-layer folder, byte-identical to the mod (md5 `8a000cfd…`). Verified by **deleting
  `fixtures/original` and regenerating**: 136/136 written, suite green against the rebuilt tree.
- Tests: the Dante table parses to 552 × 52 with **0 read failures**; both 24h files are ONE schema (52
  tokens on every data line of each — the finding the plan turns on, pinned so a split would fail);
  `ensure24h` passes 552 through; `buildTimecyc` keeps 21 weathers of it ending at `UNDERWATER`; the
  candidate order as an `it.each` table on the adapter; and `describeTimecycSource` for both the winner and
  the nothing-found line.
- **Our own table's 13 read failures are now PINNED** (stock 13, our generated 24h 13, Dante 0) so step 03
  cannot change the generated file without saying so.
- **The circular test is retired.** `reproduces the bundled timecyc_24h.dat exactly (byte-for-byte)` claimed
  parity with the reference tool while comparing `convertTo24h` against a fixture that
  `scripts/test-fixtures.ts` generates by calling `convertTo24h`. It is now named for what it checks — the
  generator and the parser have not drifted apart — and both it and `parseTimecyc`'s own doc comment say
  plainly that byte-for-byte parity with the original tool is **not** claimed and has no evidence here.
- Measured at the close: suite **4 934 green** (526 files, +11), `tsc -b` and eslint clean, fixtures
  regenerated from an empty tree.

**Not done here, deliberately**: the negative-`FogSt` A/B and the contract/feature docs are steps 04 and 03.
Nothing in this step changes what any build produces.

### 03 — docs, and the generated file's home — ✅ DONE 2026-08-22

Same change as 01/02 where possible:

- `docs/contracts/mods.md` §2 gains the rule: the three data-file names, the order, and **what happens when
  one is misspelled — nothing; the loader falls through to the next name with no error** (the boot log line
  from 02 is the only tell). A mod shipping `data/timecyc24h.dat` in the `opensa` layer is the supported way
  to ship a 24h table.
- `docs/gta-sa-original/timecyc24h.md` + README row: the `timecyc24h.asi` format as measured (23 × 24, the
  renamed header groups, the hour labels, the negative-`FogSt` census above, and that the asi reads the
  name `timecyc24h.dat` — the only string in the binary).
- `docs/features/weather-environment.md`: "or a shipped `timecyc_24h.dat`" becomes the three-name order.
- **The generated file's home — DECIDED 2026-08-22 (the user): nowhere. `timecyc-builder` is a utility, and
  a utility does not write into the game source.** `npm run timecyc` writes to
  `tools/timecyc-builder/src/merged/` as its own doc has always claimed; putting an output into
  `game-src/<game>/data/` is a deliberate, separate act by whoever wants that table shipped. **Done** — the
  destination in `tools/timecyc-builder/src/index.ts` is `merged/`, the tool prints the path it wrote, and a
  run reproduced the committed `merged/timecyc_24h.dat` byte for byte.
- **`npm run timecyc` is not part of `pmb` or any other build** (the user, 2026-08-22). Checked the same
  day and it already holds — `tools/pmb/src` has zero `timecyc` hits and the only non-doc references to the
  builder are its own files; `scripts/test-fixtures.ts` imports the PARSER, not the builder. A rule to KEEP
  rather than a defect to fix, and it is now `docs/restrictions/timecyc-builder-is-a-utility.md`, because a
  violation is **silent**: a build stage that regenerated the table would produce a different sky and exit 0.
- **`game-src/original/data/timecyc_24h.dat` — deleted by the user, 2026-08-22.** Correcting this plan's own
  earlier claim: that file was **not committed**. `game-src/` is gitignored whole, so it existed only on the
  machine, appeared in no diff, and the build mirrored it into the tree without comment — which is precisely
  why the tool writing there was invisible. With it gone, `data/timecyc24h.dat` is the winner on the `opensa`
  target from the next build, and the shadowing of finding 2 is over for `original`.
  **Still carrying one**: `game-src/{anderius,carcer,gostown}/data/timecyc_24h.dat`. Those are other game
  trees and are nobody's call but his; nothing in this plan touches them.
  **Stale in the current builds**: `build/original/{sa,opensa}/data/timecyc_24h.dat` are from the 2026-08-22
  build and still there. The next build drops them; until then the built opensa tree still resolves to the
  old table, and the boot line from step 02 is how to tell.

**What shipped:**

- `docs/contracts/mods.md` §2 — the three names as a table, that a mod shipping `data/timecyc24h.dat` in the
  `opensa` layer is the supported way to ship a 24h table, that both 24h names are ONE format, and **what
  happens when a name is misspelled: nothing** — plus the boot line as the only tell.
- `docs/gta-sa-original/timecyc24h.md` + a README row — the plugins as measured: two of them, one hardcoded
  file name each, the same 23 × 24 × 52 schema, `DirMult` as the 52nd column stock does not have, the
  negative-`FogSt` census, and that Dante's file repairs stock's corrupt keyframe. Carries its own limit:
  the binaries were read for strings, not disassembled.
- `docs/restrictions/timecyc-builder-is-a-utility.md` + a README row — the rule, and that it is **silent
  twice** (a regenerating build exits 0 with a different sky; a tool writing into gitignored `game-src`
  shows in no diff).
- `docs/features/weather-environment.md`, `docs/development/timecyc-builder.md` and `docs/commands.md`
  brought in line; the builder doc's long-standing disagreement with its own code is now the code's
  behaviour, and the doc says which name outranks which if the output is ever copied into a game.
- Measured at the close: suite **4 934 green**, `tsc -b` + eslint clean, 0 broken links across the ten docs
  touched, and `npm run timecyc` reproduces its committed output byte for byte from the new destination.

### 04 — negative `FogSt`: SA's meaning first, then the field — code + A/B DONE 2026-08-22, VERDICT PENDING

- Recover from the reversed source (`docs/links.md` → gta-reversed, `CTimeCycle::Update` /
  `CRenderer::RenderFadingInEntities` / `RwCameraSetFogDistance` callers) what a negative fog start does in
  the original — fog that has already reached some density AT the camera, or a clamp of its own. Write the
  formula down before touching the driver; if the honest path is not reachable this plan, the current
  `max(0, …)` floor gets its card in `docs/hacks/` (it is a hack today and has none).
- Field A/B through the one-build instruments, no rebuild: boot the opensa build with each source winning in
  turn (move the higher-priority file aside in `build/original/opensa/data/`, restore after — ledger the
  moves), headless screenshots at 00:00 / 06:00 / 12:00 / 21:00 in EXTRASUNNY_LA and EXTRASUNNY_SMOG_LA
  (the weather Dante authors −100 fog starts on), `docs/development/benchmarks.md` harness. Record the boot
  parse time of the 552-row table next to the 504-row one (expected: unmeasurable; say so with the number).
- Numbers into `docs/benchmarks/` before they are read; the user's field verdict closes the step.

**Done when** the three sources have been seen side by side, the verdict is recorded, and the floor is either
replaced by the recovered rule or carded.

**What shipped:**

- **The rule, recovered, not fitted** — `docs/gta-sa-original/timecyc-fog.md`. SA has exactly ONE consumer of
  the column: `Scene.m_pRwCamera->fogPlane = CTimeCycle::GetFogStart()` beside
  `RwCameraSetFarClipPlane(farClip)`, and the pair becomes `D3DRS_FOGSTART` / `D3DRS_FOGEND` with the fog
  type set to LINEAR once at startup. **No clamp anywhere.** So a negative start is a haze already partly
  opaque at the camera — `−FogSt / (FarClp − FogSt)` of it — which is how a weather says it has no clear
  near zone. No hack card was needed; the honest path was reachable.
- **The floor is gone** (`f1ae2c5c`). Our exp² curve reads the value the same way — the shader clamps the
  DISTANCE, not the start — so passing it through is the whole fix. `fogCap` stays a ceiling and leaves a
  negative start alone. Two tests pin it, and a third pins that the cap does not floor.
- **It was never only a Dante problem.** The floor discarded stock's own near haze on **112 of its 504**
  expanded rows, which is why FOGGY_SF has never looked foggy from the ground.
- **The A/B is captured and recorded**: `docs/benchmarks/opensa-engine/2026-08-22-timecyc-fog-ab.md`. Nine
  headless shots on the existing build, no rebuild, one pose in SF, three arms (floored / authored /
  Dante). At-camera fog by hour 12·18·21: **0 % · 0 % · 0 %** floored, **4 % · 27 % · 43 %** as stock
  authored it, **83 % · 91 % · 15 %** as Dante authored it. Hour 21 is the control — Dante is LIGHTER there,
  so the arms track the table and not a bias. Boot parse 0.859 / 1.698 / **2.016** ms for 184 / 504 / 552
  rows: **+0.32 ms once** for the bigger table, measurable and irrelevant, said with the number as the plan
  asked.
- **The step-02 boot line proved itself in the field**: every capture printed the winner, and it agreed with
  the arm every time — which is how the A/B knows which table it photographed.
- **Also learned, worth not re-paying for**: `weather=` and the player's CITY have to be chosen together —
  the zone remap rewrites a weather that has no variant for the region, so a FOGGY_SF forced in LS is
  SUNNY_LA before the first frame.

**HIS VERDICT, 2026-08-22: arm C is rejected — "вариант Dante нам не подходит".** The five shots he named
as the good ones are `A-floored-h12`, `A-floored-h21`, `B-unfloored-stock-h12`, `B-unfloored-stock-h21` and
`probe3` (the same configuration as `B-…-h12`, a different frame). **No arm-C shot is in the list.**

Two things that verdict does and does not settle:

- **It settles the TABLE, not the code.** He named arm A and arm B shots side by side at both hours,
  including h21 where they differ most (0 % vs 43 % at the camera) — so the unfloored fog start is accepted,
  and what is rejected is Dante's authored table. The fix stays.
- **It rejects the WHOLE Dante table, not only its fog.** The two tables also differ by a mean |Δ| of 73.9
  on `lowClouds`, ~21 on `skyTop`/`skyBot` and on `Alpha1`/`Alpha2` in every one of the 504 rows. Nothing in
  our loader can take one column from one table and the rest from another, and nothing should.

**The verdict does NOT touch the support, and the two must not be confused.** This plan's deliverable is
that a world can CARRY a `timecyc24h.dat` and that our engine reads it — the resolver, the order, the
contract and the tests are unconditional and stay exactly as built. A mod author shipping that file in the
`opensa` layer is supported, today and after this verdict. What he judged is the VALUES in one particular
table, which is a content question about our own tree and nothing else. (I framed it as "what should win
instead" when recording the verdict; that was wrong and is corrected here — a rejected table replaces
nothing in the support.)

**SETTLED 2026-08-22, and shipped**: he refined the verdict to *"только туман нам не нужен такой,
остальное хорошо"* — Dante's table everywhere, his fog nowhere. That is a column mix, which is exactly what
`timecyc-builder` is for, so it needed no new code:

- **base** = Dante's `timecyc24h.dat`, **donor** = the stock `timecyc.dat`, **props** = `['FarClp', 'FogSt']`.
  Verified before it was shipped: exactly two columns moved — 27 `farClip` (286 rows) and 28 `fogStart`
  (256). Every other column is Dante's, value for value. The stock donor expands to 21 weathers, so
  `EXTRACOLOURS_1/2` keep his fog, which is correct — they are not time weathers.
- Shipped as `mods-src/original/mods/opensa/1. [24H] Refixed Original Timecycle (default FarClp + FogSt)/
  data/timecyc24h.dat` — his name for the folder, which says what was changed.
- **The recipe is a TEST, not a note** (`tools/timecyc-builder/src/core/merge.test.ts`): the shipped fixture
  must equal `mergeTimecyc(dante, [{ props: ['FarClp','FogSt'], rows: stock }])`, and a second test pins that
  the ONLY columns differing from Dante are that pair. Re-copying his file over ours would otherwise be
  silent — nothing else in the repo compares the two.
- **Two fixtures now**, because they are two different claims: `data/timecyc24h.dat` is Dante VERBATIM, taken
  from the `sa` layer (which still ships it for his asi), and `mods/timecyc24h-shipped.dat` is what the
  opensa target ships. The manifest line had to move in the same change — it resolves a mod by FOLDER NAME,
  and the rename would have made it fail to find anything.
- Field check on arm D (same pose, same hours, no rebuild): fog at the camera 4 / 27 / 43 % at 12 / 18 / 21
  in FOGGY_SF — identical to the arm he approved, with Dante's sky, clouds and PostFX above it.

**Still his call, not acted on**: `tools/timecyc-builder/src/index.ts` still holds the OLD recipe (RealVision
night merge onto stock) and would overwrite `merged/timecyc_24h.dat` with it on the next `npm run timecyc`.
The shipped table's recipe lives in the test, so it is reproducible either way — but if this mix is now the
project's default table, the builder's config should say so instead.

**The content question that IS open, and it is his**: `game-src/original/data/timecyc_24h.dat` was deleted
today and `timecyc-builder` no longer writes there, so with the opensa-layer mod installed the next build
resolves to Dante's table. If our tree should ship a different 24h table, it needs one put somewhere the
order will pick — a mod in the `opensa` layer, or a deliberate copy into `game-src` — and if it should ship
none, the stock `timecyc.dat` is expanded on load and that is a complete, valid configuration. **The plan
does not act on this and does not need to**: it is finished either way.

## Out of scope, deliberately

- **A `?timecyc=` URL override** to pick a source by hand. The field A/B above moves files aside instead; a
  knob is cheap to add later and would widen this plan past its one sentence.
- **Teaching `timecyc-builder` the name.** It already reads either shape through `ensure24h`; only the path
  in its config names a file.
- **The `sa` target.** Dante's asi consumes the same file there already; the reference install is the
  control, not the subject.
- **Reading the 2 extracolour weathers.** Both reference files carry them at full 24 hourly rows;
  `buildTimecyc` keeps 21 weathers and nothing in the engine asks for `EXTRACOLOURS_*`. Whether the engine
  should read them is a different plan. **Not out of scope**: that our own generated file omits them while
  claiming the name of a format that has them — finding 3, step 03.
