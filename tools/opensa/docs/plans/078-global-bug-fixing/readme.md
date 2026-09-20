# 078 — Global bug fixing (post-full-pmb-run: engine + tools)

**Status: OPEN — rounds 1–4 shipped; every ledger row fixed, awaiting ONE reconvert to confirm (2026-07-20).** It runs BEFORE [079 — viewers/lab on pmb output](../079-canonical-build-source/readme.md);
the agreed order after it closes: 079 → full migration audit → merge `webgpu-migration` into `main`.

## Context

The first FULL end-to-end perfect-map-builder run (the one thing opensa-pack plan 003 left to the
user) happened 2026-07-19: the whole modded map converted in **over an hour**, and the result has
**bugs** — both engine-side and tool-side. This plan is the single ledger where they are triaged
and fixed, instead of scattering fixes across the finished chains' docs.

Command that produced the run (for reproduction):

```
NODE_OPTIONS=--max-old-space-size=12288 npx tsx tools/perfect-map-builder/src/cli.ts \
  --game ./game-src/original --in ./mods-src --out ./build/original
```

## Bug ledger

| #   | Symptom                                                                                                                    | Surface                                     | Repro                                                                                                                                         | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                      | Status                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | The `sa` target is never built — no `sa/` in the output, no log line, no error                                             | pmb                                         | `--until pack` (or `--until opensa`)                                                                                                          | `pipeline.ts` gated the sa split on an explicit name LIST (`undefined \| 'sa' \| 'lod'`) while `STAGE_NAMES` is the pipeline ORDER and `sa` precedes `pack` — so an inclusive-sounding flag silently dropped a whole target                                                                                                                                                                                                     | **FIXED**                                               |
| 2   | `linear-txd/` in the output looks like debug junk                                                                          | —                                           | —                                                                                                                                             | NOT a bug: the gamma/linear TXD sidecar (lod-trees plan 012) that `swapLinearTxds` vets into the opensa `gta3.img` before the pack. Already self-deleting; visible only under `.work/` because `--until` keeps intermediates                                                                                                                                                                                                    | **NOT A BUG**                                           |
| 3   | `[engine-host] boot failed SyntaxError: Unexpected token '<', "<!doctype "...` when booting from a local folder            | engine                                      | boot the engine host with no pak served at `/pak-map`                                                                                         | `setup.ts` trusted `response.ok`, but a dev server answers an unknown path with its SPA `index.html` at **HTTP 200** — so the friendly "no pak" guard was skipped and `.json()` choked on markup. The pak is fetched over HTTP independently of the local-folder VFS, and root `public/` had no `pak-map`                                                                                                                       | **FIXED** (message); the two-sources split is 079's job |
| 4   | No progress inside the long pack stages; failure COUNTS with no names                                                      | opensa-pack                                 | any full run                                                                                                                                  | Each stage logged once after its loop; the per-model failure dump used `console.warn`, was uncapped, and omitted `breakables`                                                                                                                                                                                                                                                                                                   | **FIXED**                                               |
| 5   | 41 cell LODs (`lod_8_-7`, `lod_7_-7`, … the LS/SF core) fail: "past the uint16 index ceiling"                              | opensa-lod-generator / opensa-pack          | full run, see `report.json`                                                                                                                   | The SAME builder as row 6 — `packMapObjects` → `buildModelOsm` → `buildVehicleModel`. Baked cell LODs exceed 65 535 verts, so the uint16 throw dropped them and those far LODs were MISSING in the engine                                                                                                                                                                                                                       | **FIXED by round 3** — verify on the rebuild            |
| 6   | `admiral`, `comet` fail the uint16 ceiling — **AND no vehicle spawns at all, from the debugger or the road-car registrar** | opensa-pack + renderware + engine           | boot the packed dir; HUD shows `FIXED-STEP ERROR: model has 90609 vertices, past the uint16 index ceiling`, `[bench] road cars registered: 0` | ONE cause, two symptoms. The user's two custom cars (`mods-src/vehicles/`) are hi-poly (86 511 / 82 991 raw verts, ~90 609 after the builder's per-material split). `buildVehicleModel` hardcodes `Uint16Array` and THROWS; the pack therefore leaves their `.dff` in the archive; the runtime then builds that same `.dff`, hits the same throw — **inside the fixed step**, which takes the whole vehicle system down with it | **FIXED** — round 3, field-confirmed                    |
| 7   | 30 props + 11 peds + 1 anim object: "`<model>.dff` not found"                                                              | opensa-pack                                 | full run                                                                                                                                      | All 42 are benign roster rows with no model, reported as failures because three classes lacked the guard `packMapObjects` already had. Props come from `object.dat` (a physics-tuning table, not a roster); peds `null`/`special01…10` are runtime-filled slots; `oilplodbitbase` is a stock far LOD the LOD stage deliberately stripped                                                                                        | **FIXED** — round 4                                     |
| 8   | The `map objects` stage slows to ~1 model/s as it runs (100/s at the start, 754 s total)                                   | renderware / opensa-pack                    | any full run, watch the progress line                                                                                                         | `VehicleTextures` DECODED every texture of a model's whole TXD chain in its constructor. The shared world dictionaries are enormous (`lods.txd` 17 901 textures / 255 MB decoded, `lodtrees.txd` 78 MB) and the models that name them sit at the tail of the IDE order — 238 GB of redundant decode across the stage, almost all of it thrown away                                                                              | **FIXED** — round 4                                     |
| 10  | pmb dies in the `trees` / `procobj` stage when `mods-src` has no `vegetation/` or `procobj/`                               | lod-trees-generator / sa-procobj-placement | run pmb against a `--in` root without those subfolders                                                                                        | Both subfolders are an OPTIONAL HD-swap source and both generators already had a full no-`--in` path, but `pipeline.ts` passes the path unconditionally (unlike `vehicles`/`peds`, which `populated()` guards) and the adapters called bare `statSync` on it → ENOENT. The documented default was written but unreachable                                                                                                       | **FIXED** — round 4                                     |
| 11  | Ten Green Bottles (2345.5, −1704.8): no glow pool on the ground at night (prod spread the junction's green light across the pavement; the original also blinks it) | engine | stand at the junction at night | Static 2dfx lights left the light pool 2026-07-17 ("lamps igniting ahead of the car"); a smooth-admission restore was tried 2026-07-22 and REVERTED by the user ("not what we need", paraphrased). Facts so far in 085 row E: only green 2dfx source within 60 u is `trafficlight1`; the parser drops `coronaShowMode`/`range`/`shadowSize` | **DEFERRED** — user owes the precise wanted behaviour before this is touched again |
| 9   | `report.json` is not in the `--out` directory                                                                              | perfect-map-builder                         | any run with `--out ./build/original`                                                                                                          | It IS written, but three levels down (`<out>/opensa/opensa/report.json`) beside the pak it documents. Nothing mirrored it at the run root                                                                                                                                                                                                                                                                                       | **FIXED** — round 4                                     |

## Working rules

1. **Triage first, fix second**: every reported symptom gets a ledger row + a minimal repro before
   any code changes; root causes recorded even for one-line fixes (the fixed/ open-issues discipline).
2. A bug whose fix changes converter OUTPUT batches into ONE reconvert at the end — no per-fix
   full-map runs (a full run costs > 1 h).
3. Regressions get a pinned test in the owning package; the suite + the 6-scene ritual sweep close
   the plan.
4. Convert-time itself (> 1 h) is a candidate ledger row: measure where the time goes before
   deciding whether it is a bug or the honest cost (bakes were 124 s + 124 s on the map; the rest
   needs a breakdown).

## Ledger

### Round 1 (2026-07-19) — bugs 1, 3, 4 fixed; no reconvert needed

**Bug 1 — the missing `sa` target.** `pipeline.ts` gained `runsStage(stage, until)`: `STAGE_NAMES` is the
order, so the stop point is INCLUSIVE and `--until pack` builds `sa` again. The old name-list is what made
this silent — there was not even a "skipped" line, unlike the conditional chain stages. Five unit tests
pinned the gating (`pipeline.test.ts` had ZERO `until` coverage before); the CLI help, which already
implied linear semantics, now states it.

**Bug 3 — the HTML-instead-of-JSON boot failure.** `setup.ts` now sniffs the body (`<` after trim) instead
of trusting `ok`, so the actionable "no pak at …" message survives the dev server's 200-OK SPA fallback.
`apps/engine-lab/src/pak-loader.ts:19-24` is a copy of this fetch with the same gap — 079 folds it into the
shared path rather than duplicating the fix. Unblocked locally with a `public/pak-map` symlink into
`build/original/opensa/opensa` (the pak dir: `manifest.json` + `world.ospak` + `water.bin` + `report.json`).

**Bug 4 — logging.** New `progress.ts` (`createProgress(label, total, log)`, same ETA shape as the
cell-convert line in `convert.ts`, one line per 5 s) wired into the loops a full run actually waits on:
map objects, vehicles, peds, props, breakables. Map objects count UNIQUE model names as the denominator —
the loop dedups IDE rows, so row count would misreport the wait. The failure dump became `reportFailures`:
routed through the injected `log`, `breakables` added (it was missing), and grouped by failure CLASS —
the per-model name and numbers are normalised out of the message, so one cause is one line, capped at 20
names with `+N more`. `report.json` keeps every failure in full; the console is the index into it.

Measured on the user's existing run — **85 failures collapse to 5 classes**, and two of them are new bugs
(rows 5 and 6) that the old count-only output had hidden in plain sight:

```
⚠ 85 models did not convert, in 5 failure class(es) — full list in report.json:
  ⚠ vehicle — model has N vertices, past the uintN index ceiling (2): admiral, comet
  ⚠ ped — <model>.dff not found (11): null, special01, … special10
  ⚠ anim object — <model>.dff not found (1): oilplodbitbase
  ⚠ prop — <model>.dff not found (30): doublestreetlght, gardenbencha, … +10 more
  ⚠ map object — model has N vertices, past the uintN index ceiling (41): lod_8_-7, lod_7_-7, … +21 more
```

Suite green: 180 tests / 24 files across opensa-pack + perfect-map-builder + engine streaming; `tsc` and
`eslint` clean. None of these fixes changes converter OUTPUT, so round 1 costs no reconvert.

### Not a bug

`.work/` surviving a run is `--until`/`--keep-work` doing its job (`keepWork = options.keepWork || until !== undefined`).

### Round 2 investigation (2026-07-19) — bugs 1 and 6 of the user's report are ONE bug

The user reported two things: cars do not spawn from the debugger although the pack says they converted,
and the pack lost two cars they suspect are their custom merges. Both are the same defect.

**Verified the pack is NOT at fault** (Node, against the user's own `build/original/opensa/models/gta3.img`):
`alpha.dff` is gone and `alpha.osm` is present (4.4 MB); `readVehicleOsm('alpha')` decodes fully — 77
submeshes, 14 936 verts, 4 wheels, colliders, seat, half-extents; the baked 4.2 MB atlas is there and every
submesh references array 0. A first hypothesis that the runtime only asks for `.dff` was **wrong** and was
discarded: `loadOptimizedVehicle` resolves `.dff` first, `.osm` second, exactly so a surviving `.dff` means
"modloader override or unconverted".

**The real chain**, caught by booting the packed dir headlessly:

1. The two custom cars in `mods-src/vehicles/` are hi-poly — `admiral` 86 511 and `comet` 82 991 raw verts,
   ~90 609 after the builder's per-material vertex split.
2. `buildVehicleModel` built the index array as `Uint16Array` and guarded it with an `assertIndexable`
   throw past 65 536 — deliberately, so indices never wrap silently.
3. The pack therefore fails those two and, correctly, leaves their `.dff` in the archive for the legacy path.
4. The runtime then builds that same `.dff` and hits the same throw — **inside the fixed step**. The HUD
   shows `FIXED-STEP ERROR: Error: model has 90609 vertices, past the uint16 index ceiling`, and
   `[bench] road cars SKIPPED: no vehicle system` with `road cars registered: 0` (from 841).

So two unconvertible cars take down vehicle spawning **for all 201 models**. The blast radius is the worse
half of this bug.

**The fix has two independent parts** (both owed; the first rides the pending rebuild):

- **uint32 indices on the rigid path.** `buildVehicleModel` emits `Uint32Array` past the ceiling, the `.osm`
  fixture records the index width, and the RIGID draw stops hardcoding `'uint16'` in `setIndexBuffer` — the
  CELL path already does exactly this (`cell.index16 ? 'uint16' : 'uint32'`), so the pattern is established.
  (The neighbouring CLUTTER draw is deliberately left on uint16 — see round 3.) This fixes the pack failure
  and the runtime throw at once.
- **Blast radius.** One bad model must not kill the vehicle system: the fixed-step vehicle work needs
  per-model isolation, so a model that cannot build is skipped and NAMED, not fatal. Worth doing even after
  uint32 — the next unbuildable model should cost one car, not all of them.

**Also fixed this round:** the debugger's spawn button did `void actions.spawnVehicle(model)`, so every
spawn failure became an unhandled rejection and the button silently did nothing — which is why this looked
like "nothing happens" rather than an error. The vehicles screen is now its own `VehicleScreen` component
(the panel had crossed its complexity limit) and prints the failure.

**Harness note:** `tools-debug/bench-harness/game-server.js` needs an ABSOLUTE game path. With a relative
`./build/...`, `path.join` normalises the `./` away, the `file.startsWith(ROOT)` guard is then always false,
and every file 404s — the boot just times out waiting for a canvas.

### Round 3 (2026-07-19) — bug 6 FIXED, both halves

**Part A — uint32 indices on the rigid path.** `buildVehicleModel` no longer throws past 65 536 vertices; it
narrows the array to the model (`indicesFor`), and the width travels with it instead of being assumed:
`VehicleModelData.indices` is `Uint16Array | Uint32Array`, `RigidModelInit`/`VehicleModelInit` gained
`index16?` (absent = the historical uint16, so nothing pre-existing changes), the `.osm` fixture records it,
`vehicle-osm.ts` reads it AND uses it for the payload stride, and `drawVehicleModel` binds
`model.index16 ? 'uint16' : 'uint32'` — the same pattern the cell path already used.

Deliberately NOT changed: the clutter path still binds uint16 and derives its count as `byteLength / 2`.
A clutter species is one scattered plant; the assumption is the format there, and a comment now says so.

Measured on the user's own archive after the fix — both cars build, and the indices address correctly rather
than wrapping:

| model     | vertices | index width | max index |
| --------- | -------- | ----------- | --------- |
| `admiral` | 90 887   | 4 B         | 90 886    |
| `comet`   | 83 008   | 4 B         | 83 007    |

**Why `admiral` carries three different vertex counts in this ledger** — 91 208 in `report.json`, 90 609 on
the HUD, 90 887 in the table above — and none of them is wrong: the builder emits vertices PER MATERIAL
GROUP, so the split depends on how the materials resolved to texture layers. The pack resolved against the
world dictionary, the runtime against the model's real TXD chain, and the Node probe above against an EMPTY
`VehicleTextures`. `comet` reads 83 008 in all three because its materials collapse the same way either way.
All three are far past 65 536, which is the only thing the fix turns on.

**Part B — blast radius.** The parked-car loop in `engine-vehicles.ts` let a build failure escape into
`setupEngineVehicles`' caller, which catches it and leaves `vehicles` **null** — so two bad cars killed
spawning for all 201 models, from the debugger AND the road-car registrar. Each placement is now isolated:
a model that cannot be built is skipped and NAMED once (not once per placement), and the rest of the street
still parks. Worth keeping after part A — the next unbuildable model should cost one car, not all of them.

The `assertIndexable` test that asserted the old throw was replaced by two: uint32 past the ceiling with the
max index verified above 65 535, and uint16 for an ordinary model. (Use `reduce`, not `Math.max(...indices)`
— spreading tens of thousands of indices blows the call stack; it cost a probe run.)

Suite 2282/321 green, `tsc` + `eslint` clean. **Part A changes converter OUTPUT**, so the two cars only
convert to `.osm` after the user's pending rebuild; part B and the runtime uint32 read work immediately on
the existing pak, which still carries their `.dff`.

**FIELD-CONFIRMED same day** (headless, the user's own `build/original/opensa`, `?bench=ls-noon`): road cars
went **0 → 296**, the `FIXED-STEP ERROR` line is gone from the HUD, and cars render in the street. The fix
works on the EXISTING pak — no rebuild needed for the runtime half.

One honest number came out of it. Two runs, same scene, same 296 cars:

| run                                        | fps  | avg ms | p95  | draws | GPU pass |
| ------------------------------------------ | ---- | ------ | ---- | ----- | -------- |
| all models (includes `admiral`/`comet`)    | 51.5 | 19.40  | 33.3 | 1100  | 3.27     |
| `?benchcar=infernus` (one converted model) | 120  | 8.33   | 10.2 | 1129  | 2.60     |

Same car count and MORE draws in the fast run, and the GPU differs by 0.67 ms — so this is CPU and it is
model-specific. The two hi-poly cars are the only difference, and they are the only cars still built from
`.dff` at runtime: the other 199 load pre-baked `.osm`, which is the whole point of the pack. Expected to
go away when the rebuild converts them (now that part A lets it) — **verify it after the rebuild rather
than assuming it**, and do not read the 51.5 fps row as a renderer regression.

### Row 5 falls to the same fix (2026-07-19)

The 41 cell LODs go through `packMapObjects` → `buildModelOsm` → **`buildVehicleModel`** — the very builder
round 3 taught uint32. Verified against the run's own input archive
(`build/original/.work/opensa-lod/models/lods.img`), where the failures still sit as `.dff`:

| model      | vertices | index width | max index |
| ---------- | -------- | ----------- | --------- |
| `lod_8_-7` | 126 463  | 4 B         | 126 462   |
| `lod_9_-5` | 96 134   | 4 B         | 96 133    |
| `lod_7_-7` | 69 525   | 4 B         | 69 524    |

The vertex counts match `report.json` exactly, so these are the same models that failed. They build and
address correctly now, and the far LODs across the LS/SF core should return with the rebuild. **Confirm on
the rebuild — do not tick this row from a Node probe alone.**

### The rebuild landed (2026-07-20) — rows 5 and 6 confirmed

The user's full run finished. Its `report.json` clears both rows against the previous run's 85 failures:

| class       | before | after |
| ----------- | ------ | ----- |
| vehicles    | 2      | **0** |
| map objects | 41     | **0** |
| total       | 85     | 42    |

The 42 that remain are row 7 exactly. Run counters: pak 1 453 903 872 B, 1137 cells, 10 360 map models
(417 already bundled by name), 201 vehicles. **Still owed:** the in-game LOD check across LS/SF, the fps
re-measure with `admiral`/`comet` now converted, and the mapper's pak-size delta.

### Round 4 (2026-07-20) — rows 7, 8, 9; batched into ONE reconvert

**Row 7 — the 42 "not found" are roster rows with no model.** Each class was triaged separately and none is
a real miss:

- **30 props.** The roster is `data/object.dat`, SA's physics-tuning table rather than a model list. The 30
  are exactly the set whose name appears in NO `.ide` anywhere and whose `.dff` is absent from stock
  gta3/gta*int/player/cutscene too — they were never streamable in stock SA. `man1_llega`/`man1_rlega` and
  `glassfx*\*`/`des_burn_win` are leftover cutscene and effect names, not props.
- **11 peds.** `peds.ide` line 42 is the player slot (`null` — CJ is assembled at runtime from `player.img`
  components), and 290–299 are the `special01…10` mission slots `LOAD_SPECIAL_CHARACTER` fills. No
  `special0*.dff` exists in any archive or in `mods-src`.
- **1 anim object.** `oilplodbitbase` IS in vanilla `gta3.img` but not in the LOD build's — `stripOldLods`
  removed it, correctly: the `countn2_stream*` binary IPLs point their `lod` index at the 10
  `oilplodbitbase` rows in `countn2.ipl`, so it is a genuine stock far LOD whose instances were stripped
  (10 → 0) and whose DFF then went with them. IDE defs are left as-is by design, so the `anim` row outlives
  its model. Nothing places it.

The fix is the guard `packMapObjects` has had all along (`if (!fs.has(...)) continue` — "an IDE row with no
model is the map's own business, not a conversion failure"), mirrored into `pack-props.ts`, `pack-peds.ts`
and `pack-anim-objects.ts`. They count it as `absent` and say so in the stage line rather than skipping
silently, so a REAL missing model is still visible — e.g.
`props: 352 topple props converted, 30 rows with no model, 0 failed, hulls 0.8 MB (…)`. Peds say "slots with
no model", anim objects "rows". Expect the next run to report **0 failures**.

**Confirmed by the user (2026-07-20):** those DFFs really are absent from the game archives.

**Row 8 — the map-objects slowdown was a per-model decode of a shared mega-dictionary.** Not O(n²), not GC
(heap held at 125–300 MB through the collapse): `VehicleTextures`' constructor DXT-decoded every texture in
the model's whole TXD chain, with no cache. Map objects walk the IDE in load order and the LOD-built models
sit at the tail, pointing at the giant shared dictionaries:

| txd          | textures | txd MB | decoded RGBA | models | wasted decode |
| ------------ | -------- | ------ | ------------ | ------ | ------------- |
| `lods`       | 17 901   | 48.8   | 255 MB       | 564    | 140 GB        |
| `lodtrees`   | 184      | 78.7   | 236 MB       | 184    | 42 GB         |
| `vegetation` | 93       | 35.0   | 140 MB       | 136    | 19 GB         |

238 GB of redundant decode — and on the map-object path the packed RGBA is discarded outright
(`model-osm.ts` sets `ostex` empty; the arrays come from the world dictionary). Two changes, both pure
memoisation with no output change:

- **Lazy texels.** `SourceTexture` decodes on first use and caches; `pack()` picks the array size from
  `width`/`height`, which are known without decoding, so only the layers a material actually references are
  ever decoded.
- **Two caches.** Raw TXD bytes per archive in `getTxdChain` (byte-budgeted at 256 MB — TXD sizes span KB to
  80 MB), and the parsed header by buffer identity in a `WeakMap`. Consecutive models share a dictionary, so
  this collapses a per-model 78 MB read + parse to one.

Measured on the user's own `build/original/.work/opensa-lod`, same models, per `buildModelOsm` call:

| model               | before   | lazy only | + caches |
| ------------------- | -------- | --------- | -------- |
| `lod_8_-7`          | 1027 ms  | 348 ms    | 309 ms   |
| `lod_7_-7`          | 890 ms   | 223 ms    | 152 ms   |
| `lod_7_-5`          | 876 ms   | 204 ms    | 106 ms   |
| `lodaw_streettree1` | ~1059 ms | 80 ms     | 39 ms    |
| `lodbg_fir_dead`    | ~1059 ms | 125 ms    | 77 ms    |

**8–27× on the models that dominated the stage.** The 754 s stage should land in the low tens of seconds —
measure it on the reconvert.

The TXD-bytes cache had to be keyed **per archive**: keyed by name alone it served a second archive whatever
the first had cached, which the existing `txd-chain` suite caught immediately (a fixture archive that does
not contain `mytreetxd.txd` was handed one). Pinned as its own test.

**Row 9 — `report.json` at the run root.** The pack writes it beside the pak it documents
(`<out>/opensa/opensa/`), which is not where a run's summary is looked for. `pipeline.ts` now mirrors it to
`<out>/report.json` and logs the path; the nested copy stays the pak's own.

**Row 10 — the optional HD-swap folders.** `vehicles/` and `peds/` are conditional stages (`populated()`), but
`trees` and `procobj` are pushed unconditionally and handed `<mods-src>/vegetation` / `<mods-src>/procobj`
whether or not those exist. Both generators have had a complete no-`--in` path all along — every branch
(`candidates`, `modelSource`, `textureSource`, `swap`, `retxd`) handles `undefined`, and the CLI documents it —
but the adapters called bare `statSync` on the path, so the documented default was **written and unreachable**.

`swapFolder()` (procobj) and `hdFolder()` (trees) now normalise an absent path, and a directory holding no
`.dff`, to `undefined` — the same statement as "no folder to swap from" — and log which fallback they took.
The explicit CLI `--in` check stays: a typo in a hand-typed flag should still be loud, while a path a CALLER
always supplies should degrade. Five tests pin `swapFolder`.

Suite 2289/321 green, `tsc` + `eslint` clean. Rows 7 and 8 change converter OUTPUT and the stage timing, so
they batch into the user's next reconvert (working rule 2); row 10 changes nothing for a run whose `mods-src`
has both folders, which is the user's case.
