# Commands cheat sheet

The everyday commands with all their params, in one place. Canonical folders:
**source game** `./game-src/original` · **mods** `./mods-src` · **canonical build** `./build/original`
(see [architecture/perfect-map-builder.md](./architecture/perfect-map-builder.md)).
Rule (also in `CLAUDE.md`): when a command or param is added/changed, update this file.

## The one build, per TARGET

A build is asked for by target, not as a whole — the two are independent and the opensa one is rebuilt far
more often, so it does not pay for the real game's LOD pass:

```bash
npm run build:game:original:opensa     # our target only  (pmb --exclude sa) + fetch-pack
npm run build:game:original:sa         # the real game    (pmb --exclude opensa — every stage, both asis)
npm run build:game:gostown:opensa      # TCs are opensa-only (also :carcer :anderius)
```

Both write into the same `./build/<id>`: `:opensa` fills `opensa/` + `opensa-pack/`, `:sa` fills `sa/`, and
neither touches the other's directory (the builder only clears its own `<out>/.work-<target>`, plus a legacy
shared `.work` if one is left from a pre-005 build).

**`<out>/.work-<target>` is wiped before any stage reads `--game`** (pmb plan 005: one work dir per target,
so building one target keeps the other's intermediates), so re-running one stage off an intermediate
(`--game <out>/.work-sa/5-trees`) inside the SAME target's dir deletes the intermediate first. Copy it out,
point `--out` elsewhere, or read the OTHER target's kept dir — the builder refuses the overlap rather than
wiping it. Every run writes `<out>/build-timings.json` — per-stage wall clock plus the target and procobj
knobs it was built with, so two durations are comparable, plus `startedAt`/`finishedAt` and a `status`. **A run
that DIES writes it too**, with `status: "failed"`, the step that threw and the stages that had finished; both
it and this run's `report-<target>.json` are cleared on entry, so nothing an earlier run left can be read as
this one's. Each target that runs writes
`<out>/report-<target>.json` (`report-sa.json`, `report-opensa.json`): the target, the fetch game id, the
timings and one typed fragment per stage that produced one (optimize totals; the sa census/FLA pools/lift
requirements/asi sha; the pack summary with a POINTER to `opensa/pak/report.json` — there is no root
`report.json` any more). Standalone:

```bash
NODE_OPTIONS=--max-old-space-size=12288 npx tsx tools/perfect-map-builder/src/cli.ts \
  --game ./game-src/original --in ./mods-src --exclude sa
```

Params: `--out <dir>` (default `./build/original`) · `--until <split|mods|vehicles|cutscene|add-vehicles|peds|optimize|trees|sa|procobj|opensa|pack|lod>` (that IS the run order — `procobj` is baked inside the `sa` branch since plan 014, so `--until sa` stops BEFORE the clutter; `cutscene` is the vehicles stage's shadow and drops out with `--exclude vehicles`)
(inclusive, keeps `.work-<target>/`) · **`--exclude <stage,stage>`** · **`--target <sa|opensa>`** ·
`--procobj-density <n>` · `--procobj-max <n>` · `--keep-work` · `--no-weld-seams` · `--no-textures` ·
**`--bake-collision`** (write every cell's collision into the pak — plan
200/3-01; off by default, and the same tree built with and without it is the A/B the claim is read on: the
runtime reads a bake when the pak has one and parses COL when it does not).

**`--resume`** — re-enter a FAILED run at its last finished step (`<out>/.work-<target>/resume.json`; the pack
re-enters at its last finished weld chunk); refused if the sources, flags or code changed since that run
(pmb plan 006).

`--exclude` says WHICH STAGES run where `--until` is the stop point: it drops the named stages and keeps
everything after them (repeatable, comma-separated, same names as `--until` minus the `lod` alias; an unknown
name is an error, never a silent skip). Excluding `opensa` drops `pack` with it; excluding `pack` alone leaves
`opensa/` in GAME format; excluding `sa` also drops its `checkImgIdBudgets` guard, which reads the `sa/` tree.
**`:sa` builds everything but the opensa target** since 2026-08-15 — it stopped excluding `vehicles,peds` when the
cutscene stage began shipping a plugin paired with its fleet: a "real game" build that silently carried neither is
the trap. Measured end to end at 638.9 s.

`--target` says which HOST the build is for, and it picks every knob whose right value is a fact about the
host rather than about the source data (limits, particle policy, procobj density). Omit it and it is DERIVED
from `--exclude` — `--exclude sa` builds for `opensa`, anything that still builds `sa/` is `sa`, because the
common chain is shared and its content has to satisfy the host that still has ceilings. `--target opensa`
without `--exclude sa` is refused for the same reason. The run prints the target it resolved, and the procobj
stage prints that layer's price against it (objects · permanent text rows · rows/object).
NB `--target` means a DIRECTORY in `vehicle-installer --rebake` — same word, unrelated meaning; there the
layer of a LAYERED vehicles folder is picked by `--kind`. `vehicle-installer`/`ped-installer`/`vehicle-cutscene`
`--target sa|opensa` and `cars-server --target` (default `sa`) pick the layer of a layered `--in`
(`common/sa/opensa`, same planner as mods — 2026-08-17).

`--procobj-density` is the scatter density cutoff for the procobj stage — **1 = vanilla, max 3** (the
scatter's candidate ceiling; above it there are no candidates left to keep and the build refuses). The run
prints the density it built at, so a capture states its own configuration. **The flag is the whole-map
number; a PROFILE** — per category and per category×surface, plus a `maxDensity` that raises the candidate
ceiling — **is a config value, not a flag** (`BuilderConfig.procobjDensity` / `ProcObjLodConfig.density`
accept `number | ProcObjDensityConfig`). The build then prints every key (`base=1 rocks=2`) and a
per-category `objects / candidates / taken by the cap` breakdown. One density for both targets: it is not
keyed by host. `--procobj-max` raises the placed
-object safety cap with it; without that a high-density run measures the CAP, and the build says so with a
`CAP DROPPED n` line. **The 2026-08-08 finding that "the cutoff is not the density lever" is retired**: it was
true only because `cullByMinDistance` was deleting 99 % of the candidates with a column that is a camera
distance. Since [009](../tools/sa-procobj-placement/docs/plans/009-procobj-dat-columns-as-the-game-reads-them.md)
density 1 IS the authored density (91 092 objects) and `procObjMax` defaults to 100 000 so it does not bind.

An `sa` build also **ships `perfect-map.asi` into the built game root** (sha256 recorded in
`build-timings.json`, so a map is paired with the exact asi that lifts its ceilings). The artifact comes from
`asi/perfect-map/dist/` — build it with `npm run build:asi` in that workspace, which needs MinGW; `dist/` is
gitignored, so a fresh checkout has none and the build **warns loudly** instead of quietly emitting a tree
that corrupts a plain install.

On the built `sa/` tree the build also prints its **install requirements** — every stock ceiling the artifact
crosses and the setting that lifts it (int16 rows → `perfect-map.asi`, which no adjuster provides; the
`CBuilding` pool → OLA `Buildings`; rows in one IPL → OLA `EntitiesPerIpl`; the three FLA id pools). A LINE,
never a throw: the ceilings that are REAL on the target are guarded beside it, and this one states the ones we
deliberately design past, so the install a build needs is read off the artifact rather than remembered.

On the built `sa/` tree the build prints a **map-cost census** (`reportTextIplCensus`: permanent text-IPL rows,
inst-bearing IPLs, and how many of the IPLs listed in `gta.dat` it could actually read) and enforces the **FLA
ID pools** (`checkImgIdBudgets` — the one set of ceilings the target really has). An `--exclude sa` run does
neither. There is no int16 row guard any more: the target always runs `perfect-map.asi` + OLA + FLA, so that
ceiling is lifted where our data lands — `--allow-text-row-overflow` was deleted with it (2026-08-09).

The chain opens with **`split`** (img-splitter): `models/gta3.img` is divided into typed archives BEFORE
anything installs, so every entry name lives in exactly one of them. `BuilderConfig.splitBuckets` picks which
buckets get their own file and defaults to `['vehicles']` — the shape that fits a stock archive table exactly
(SA registers 8, the target already spends 6, and the mod car set spills `vehicles.img` into one sibling).
Whoever writes an archive registers it in `gta.dat`, and the finished `sa/` tree is gated against the 8:
past it the game does not warn, it crashes at load. A tool asks **where** a file lives through
`openArchiveIndex` rather than opening `gta3.img` by name; `data/img-layout.json` beside it is a REPORT for
readers outside the build, never the lookup. See
[architecture/img-archive-layout.md](./architecture/img-archive-layout.md).

The `sa/` tree carries **the asis its content requires**, into the game root: `perfect-map.asi` always, and
`perfect-cutscene.asi` when the cutscene stage ran (the fleet and the plugin are coupled — panes on every
slot with no plugin is the draw-order roulette back). Both are pre-built artifacts under a gitignored
`dist/` (`npm run build:asi` in `asi/perfect-map` / `asi/perfect-cutscene`, MinGW); a missing one WARNS and
does not fail the build, and each shipped one is hashed into `report-sa.json` and `build-timings.json` so a
tree states which plugin build it is paired with.

### One model changed: swap it in place instead of rebuilding

```bash
# REAL-SA tree: HD through the optimizer chain + its clone LOD cut from the result, patched into the tree's IMGs
npx tsx scripts/debug/model-lab.ts <model> --tree build/original/sa [--dff f.dff --txd f.txd] [--dry]
npx tsx scripts/debug/img-patch.ts restore <model>.dff --game build/original/sa      # undo, per entry
# OPENSA tree: the model re-optimized, its rect's CELL LODs re-baked from the swapped HD, the rect re-welded
# into a servable LAB pak (never the shipping pak) — 17 s for an 88-model rect on original
NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/debug/model-repack.ts <model> --game original [--dff f.dff [--txd f.txd]] [--no-lod]
npm run serve:static   # then the app with ?src=/build/original/opensa-lab
```

The full pipeline is the LAST resort — to confirm a fix on the whole tree after the one-model verdict, or for a
change with no one-model form. Rows and levers: [`docs/debug/README.md`](debug/README.md).

### A build that died: resume it

```bash
# same flags as the run that died, plus --resume — re-enters at the last finished step (a dead pack at its
# last finished weld chunk); refused, naming the difference, if sources / flags / git HEAD changed since that
# run (a DIRTY tree at the same HEAD is allowed — fix the bug that killed it, resume). The pack's model classes
# after the weld re-run (~9 min on original — docs/in-reserve/opensa-pack-model-class-checkpoints.md).
# Field-exercised 2026-08-17: killed at weld chunk 6/21, resumed at 7/21, byte-identical to an unbroken run.
NODE_OPTIONS=--max-old-space-size=12288 npx tsx tools/perfect-map-builder/src/cli.ts \
  --game ./game-src/original --in ./mods-src/original --out ./build/original --exclude sa --resume
```

### Added vehicles — new model ids on a built `sa` tree

```bash
# Everything mods-src/<game>/add-vehicles holds, into a BUILT sa tree, in place
npx tsx tools/add-vehicles/src/cli.ts --game build/original/sa
npx tsx tools/add-vehicles/src/cli.ts --game build/original/sa --only 001veh,059veh
npx tsx tools/add-vehicles/src/cli.ts --game build/original/sa --plan     # resolve and report, write nothing
```

`sa` only — every part of an added car is a plugin of the real game (ModelVariations for traffic, FLA's
audio loader, Parked Maker, CLEO's FXT loader). Ids come from **19 001–19 999** and are pinned by
`data/vehicle-adds.txt`, so a rebuild never renumbers the fleet (a parked spot and a variation land in the
SAVE). Also a pmb stage (`--until add-vehicles`), after `cutscene`. Central plan
[102](../tools/add-vehicles/docs/plans/102-add-vehicles/readme.md); tuning rate and exclusions live in an optional
`mods-src/<game>/add-vehicles/add-vehicles.json`.

### Vehicle round: rebake instead of rebuilding

```bash
# Re-install + re-convert the mod cars of an ALREADY BUILT game, in place (one car ≈ 3.6 s)
npx tsx tools/vehicle-installer/src/cli.ts --rebake gostown --only previon
npx tsx tools/vehicle-installer/src/cli.ts --rebake gostown            # every mod car of that game
# The same against the REAL-SA tree: raw dff/txd replaced by name in vehicles.img + vehicles2.img (one car ≈ 4 s)
npx tsx tools/vehicle-installer/src/cli.ts --rebake original --kind sa --only cabbie
```

Defaults: `--kind opensa` · `--target build/<game>/<kind>` · `--in mods-src/<game>/vehicles` (all
overridable). `--kind sa` installs instead of converting ([plan 008](../tools/vehicle-installer/docs/plans/008-rebake-sa.md));
each kind refuses the other's tree by what the archive holds. **Which cars
that folder holds**: every subfolder of a flat tree, or `models/` overridden per SLOT by `new/` in a
structured one — drop a candidate into `new/` and every vehicle command takes it instead of the incumbent,
with nothing renamed or deleted ([plan 007](../tools/vehicle-installer/docs/plans/007-models-and-new.md),
contract `docs/contracts/vehicles.md` §1). Per car it
merges its `*.settings.txt` into the BUILT `data/*`, merges its `features.txt` line into
`data/vehicle-features.txt`, re-converts its `dff`/`txd` and REPLACES `<model>.osm` in whichever
`models/*.img` holds it. Idempotent, and it touches nothing else in the tree.
It can also **ADD a car the built game never had**, when the mod declares its own `vehicles.ide` row: the
roster is text and a spawn resolves `<model>.osm` by name, so nothing about a car is baked into the pak. The
tool never allocates an id (it must match what a full build would write) and refuses one that already belongs
to another model. An added car has no traffic or parked presence until a full build writes the placements —
spawn it by name to look at it ([plan 006](../tools/vehicle-installer/docs/plans/006-rebake.md)).

### What the fleet replaced, in a browser

```bash
npm run cars                                # http://localhost:5178, game `original`, target `sa`
npm run cars:sa                             # a LAYERED vehicles folder: common + sa (cars AND screenshots)
npm run cars:opensa                         # … common + opensa
npm run cars -- --game gostown --port 5200 [--target sa|opensa]
```

One local page per game: every installed car with its model id, `<slot> replaced to: <car>`, the author,
what the mod brings (paint jobs · tuning · new colours · car4 · a CLEO script), and the stock picture beside
the field screenshot. Rendered per request off `mods-src/<game>/vehicles`, so a reload shows the tree as it
is now; a `new/` candidate appears marked `from new/`. The header names the TARGET; on a layered tree each car's
screenshot comes from its OWN layer's `screenshots/` (`common/` or `<target>/`, `.png`/`.jpg`/`.webp` alike —
never the other layer's picture under the same slot), on a flat/structured one from `screenshots/` and the
target does not apply; a car with no screenshot is a warning at the top of the page naming the file to save
([readme](../scripts/cars-server/readme.md), [plan](../scripts/cars-server/docs/plans/001-cars-server.md),
[plan 002](../scripts/cars-server/docs/plans/002-layered-screenshots.md)).

### Cutscene vehicles: census / conversion

```bash
# which cutscene models exist, which mod is the donor, is everything in place (writes nothing):
npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in mods-src/original/vehicles --inspect
# convert the fleet into an output game (base copied; cutscene.img rebuilt; txdcut.ide patched;
# anim/cuts.img re-emitted when two SCENE-VALUE passes find work — the wheel-stash sink and the seat
# retarget, both reported per row in the summary):
npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in mods-src/original/vehicles --out <dir>
# emit ONLY the three files the tool writes, into a folder of your own (--out is NOT wiped, and must
# not be the game itself). The field-delivery shape: 579 MiB instead of a 1.72 GiB game tree, and the
# three files are byte-identical to the copy run (plan 006):
npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in mods-src/original/vehicles --out <dir> --no-base-copy
# --only bobcat,cszr350 restricts slots; --self-contained-txd embeds each MOD's TXD (for a target whose
# gameplay stays stock, e.g. the reference bottle). All three branches convert (car/bike/boat) —
# the full 23-model fleet; ~3.5 s wall-clock, ~2.4 s with --no-base-copy (docs/benchmarks/tools/).
# Plated slots get a READABLE license plate baked into the cs TXD (vanilla cutscenes show blanks):
# --plate <text> overrides the per-slot deterministic text, --plate-town <ls|sf|lv> picks the background
```

Field delivery to the reference bottle = drop `models/cutscene.img` + `data/txdcut.ide` in (originals
renamed to `.vanilla` beside them) — the bottle streams cutscene.img directly, no modloader override
([gta-sa-original/cutscenes.md](gta-sa-original/cutscenes.md)).

23 cutscene vehicle models / 21 donor slots; the census derives from `models/cutscene.img` +
`data/txdcut.ide` + `data/vehicles.ide`, never a hardcoded list
([plans](../tools/vehicle-cutscene/docs/plans/)).

### The same conversion as a Windows app (apps/cutscene-converter)

```bash
npm run dev -w @opensa/cutscene-converter        # vite + esbuild + Electron, window on macOS
npm run build -w @opensa/cutscene-converter      # asi resource, main bundle, renderer; FAILS with no asi
npm run pack:win -w @opensa/cutscene-converter   # the portable exe into apps/cutscene-converter/release/
```

A facade over the tool above — it forks the very same CLI with `--no-base-copy --self-contained-txd`, so
its output is byte-identical to the command line's. `perfect-cutscene.asi` is embedded at build time and
the build refuses to run without it ([README](../apps/cutscene-converter/README.md)).

## Serving & running

```bash
npm run dev                 # Vite dev server → http://localhost:5173
npm run serve:static        # static origin :3001 — mounts /build + /game-src (Range + /__index), static/ archives
npm run phone:setup         # ONCE per device: deps, tsx, the prebuilt app, and what is still missing
npm run phone               # the whole phone run in ONE command (convert if needed → check the pak → serve → print the URL)
npm run build:embed:dispatch # → dist-embed/ — the dispatch MAP as one ES module, for an external host
npm run build:share:dispatch # → dist-share/dispatch.html — the whole console as ONE file, real pak included
```

**Two commands is the whole phone workflow**: `npm run phone:setup` once, then `npm run phone` for every run
after. Setup is idempotent — re-running it after a failure, a pulled commit or a reboot costs seconds and
repeats nothing — and it installs only; the pak is `npm run phone`'s business because that is the expensive
half. It uses `HUSKY=0` rather than editing `package.json` to get past the `prepare` hook, so the worktree
stays clean on the one machine where `git status` is hardest to read.

`npm run phone` (`scripts/phone.sh`, plan 200 chain 4) is the field-run ritual for a device, written so the
command never changes and every knob is an env var: `REBUILD=1` re-converts, `BAKE=0` builds the other side of
the collision A/B, `TEXTURES=` picks the texture format (default `astc`; `rgba8` is the A/B's other side),
`MODELS=0` skips the model convert (fast, but then only `dispatch.html` is usable — it runs
no physics), `VEHICLES=` / `PEDS=` set the model SUBSET (default `admiral,infernus,comet` + `bmycg,wmycr`;
`all` converts the roster — hours on a phone), `ASTC_THREADS=` caps astcenc's worker pool (default 2 — the library's one-per-core is what OOMs a phone), `DISTRICT=` picks the measurement district — its rect, its
spawn and the map's opening point at once, from the table the console reads (`npx tsx scripts/district.ts`
lists them; the default is the one 201/1-01 pinned), `RECT=` / `SPAWN=` / `OUT=` / `GAME=` / `APP_PORT=` /
`STATIC_PORT=` move the rest, and `MAPOBJ=0` turns off the district lever (`--map-objects-in-rect`, on by
default here: convert only the map objects the rect PLACES instead of all ~14 000 the IDEs name — the slowest
stage of a district convert). It converts
only when there is no pak (a phone convert is minutes to hours), prints what the pak actually carries — the
collision GRID first, then what its textures cost — and reuses a server that is already up. **When it reuses a
pak it first asks that pak whether it is the one being requested** (`scripts/debug/pak-recipe.ts` against
`report.json`'s `build` block) and refuses to serve a mismatch, naming both sides: before that check,
`RECT=… npm run phone` over an existing pak served the OLD district in silence, because the knobs are read
only on the convert branch. Ctrl+C (or closing the Termux session) stops
the servers it started. A prebuilt app in `build/webapp` (or `WEBAPP=<dir>`) is served as static files and
vite is not started at all — which is the only way in on a device whose rolldown binding crashes
([edge-cases/browser-runtime.md](./edge-cases/browser-runtime.md)). A ready archive is committed:
`tar -xzf prebuilt/opensa-webapp.tar.gz -C build/webapp` ([prebuilt/](../prebuilt/README.md)). Full phone recipe: [development/mobile-pak.md](./development/mobile-pak.md).

| Surface                  | URL                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Game on the served build | `http://localhost:5173/?loader=http-dir&src=http://localhost:3001/build/original/opensa`                            |
| Bench sweep (8 scenes)   | `http://localhost:5173/?bench=all` (one scene: `?bench=country-dusk`)                                              |
| Soak (minutes)           | `http://localhost:5173/?soak=30`                                                                                   |
| Clutter A/B              | `&procobj=<×density, 0=off, saturates at 3>` · `&procobjLimit=<per-cell, saturates at 300>` · `&procobjRange=<units, overrides every category's draw distance — 150 = the pre-2026-08-10 ring, 100 = SA's own flat PLANTS_MAX_DISTANCE>` · `&procobjSampler=<area|corner — corner is the original's in-triangle routine, one sqrt apart>` · `&procobjSlope=<steep>,<flat> — ROCK candidate multipliers on steep vs flat faces; re-rolls the scatter>` · `&procobjFloor=<n, DEFAULT 1 since 2026-08-11 — keep at least n of every species the cell is eligible for; 0 is the A/B and brings back the 17.7 % species loss>`. Full table: [query-parameters.md](development/query-parameters.md) |
| Physics lap (081/01)     | `http://localhost:5173/?phys=all&car=infernus` (one scene: `?phys=brake-strip`) → `[phys]` JSON per lap            |
| Video mode (096)         | `http://localhost:5173/?video=1&seed=47` (`&car=` pins the car, `&at=x,y` pins the start, `&scenes=N` shortens the sequence, `&scene=N` starts at scene N — `&scene=57&scenes=1` plays exactly scene 57, `&diag=1` adds the per-frame camera capture) → a seeded SEQUENCE of drive scenes, scenes 1…100 of the seed (`&scenes=N` for a shorter one), one per region (LA→VEGAS→SF→COUNTRYSIDE→DESERT), `[video]` JSON per scene. **The URL rewrites itself as the reel plays** — `&seed=` and `&scene=` name the scene on screen, so the bar always points at what you are watching and can be copied to come back to it. `&car=` pins the car, else each scene picks one off the MOD-CAR roster when the build has any (`data/vehicle-mods.txt`), and off the stock road-car roster when it has none |
| Lab                      | `npx vite --config apps/engine-lab/vite.config.ts` → `http://localhost:4300/`                                      |
| Lab: streaming LS        | `http://localhost:4300/?pak=1&src=http://localhost:3001/build/original/opensa&at=2495,-1687,13&orbit=300&draw=1500` |
| Lab: vehicle probe       | `http://localhost:4300/?pak=1&stream=1&src=…&vehicle=1&vmodel=vehicle-comet&at=2495,-1675,13.3&orbit=26&hour=12`   |
| Viewers                  | `npm run dev` → `http://localhost:5173/viewer.html?tab=<object,vehicle,character,compare>`                         |
| sa-map-viewer (094)      | `http://localhost:5173/sa-map-viewer.html?src=http://localhost:3001/game-src/original` (no `?src=` → folder picker) |
| sa-map-viewer: a pose    | `…&at=2375,-1625&h=400&pitch=-89&yaw=180` (GTA x,y · height · degrees) · `&panel=0` capture mode · `&wind=1` unfreeze |
| sa-map-viewer: the sea   | on by default; `&water=0` hides it (the panel has "Show water") — scripted shots add `water=0` themselves |
| dispatch console         | `npm run dev` → `http://localhost:5173/dispatch.html` (defaults to `?src=build/original`) — the CAD surface: top-down map, live units, call queue, click-to-inspect |
| dispatch: no build       | `…/dispatch.html?demo=1` — a synthetic block city, no pak needed (and no model names on click) |
| dispatch: a PHONE pak    | `npx tsx tools/opensa-pack/src/cli.ts --game ./game-src/original --out ./build/district --textures astc --max-texture 256 --rect 8,-8,11,-5 --no-ao --no-models` → serve it and open `dispatch.html?src=build/district&at=2495,-1687`. `--textures astc` is what makes the pak loadable on a GPU without BC (every mobile one) at one byte per texel; `--textures rgba8` is the portable-but-4x fallback and `--max-texture N` takes back three quarters of ITS cost; `--rect` keeps the rest affordable. Full recipe, including building on the phone in Termux: [development/mobile-pak.md](./development/mobile-pak.md). Cells are `floor(worldXY / 250)` and **Los Santos sits at NEGATIVE GTA y** — `8,-8,11,-5` is x 2000…3000, y −2000…−1250 (Ganton/Idlewood); the whole of LS is about `1,-10,11,-3` |
| dispatch: a pose         | `…&at=1700,-1500&h=900&pitch=-66&yaw=180` (GTA x,y · height · degrees) — same convention as sa-map-viewer |
| dispatch: world knobs    | `&src=<built game>` · `&hd=450&lod=2200` streaming rings · `&hour=10` · `&weather=0` · `&fogscale=2.5` · `&fog=1` restores the game's fog (off by default, or a city view culls every cell) |
| dispatch: board size     | `&units=150&calls=40` — seed the board at 201's declared worst case instead of the nine-car demo shift, which is how the symbology numbers 201/5-02 owes get taken (pair with `&inventory=1`; the report's `symbology` block says what actually reached the screen). Deterministic — the generated roster is a hash of its index, so two runs of the same size are the same board |
| dispatch: shareable      | `npm run build:share:dispatch` → **one `dist-share/dispatch.html`** (655 kB raw / 217 kB gzip), which streams a real `&src=` as well as `?demo=1` — the pak worker is carried inline rather than fetched (201/2-02). The build REFUSES to emit an artifact that would load anything beside itself, so the old failure (manifest fetched, worker 404, reads as a hang) cannot come back quietly |
| dispatch: embedded       | `npm run build:embed:dispatch` → `dist-embed/dispatch.js` **plus `assets/pak-worker-*.js`, which must be served beside it at the path the entry names**. A host imports the module, calls `bootDispatch` / `bootPlanMode`, and configures it through `window.__opensaDispatch` — NOT the address bar, which belongs to the host. `&src=` accepts an absolute URL, so a hosted pak needs no local game files: [features/dispatch-console.md](./features/dispatch-console.md#embedding-it) |

| what a reused pak IS      | `npm run phone` prints it on the reuse line: game, rect, **textures**, **models**, bake-collision, build time, commit. A pak that predates the recipe block has none to print, and the check reports without failing — so an old folder can keep a name it stopped deserving (2026-08-25). `npx tsx scripts/debug/pak-recipe.ts <pakDir>` prints it on demand. **A key the pak does not record is DERIVED, never a mismatch** — `textures` from `rgba8`, `lodOnly` as `false` — because `phone.sh` expects every key on every reuse, so a key the table cannot answer refuses every pak rather than none: `lodOnly` did exactly that from 2026-08-27 (when 201/6-01 added the recipe field) until 2026-08-28, and `npm run phone` served nothing in between |
| a killed convert          | `npm run phone` again — it resumes from `<out>/.pack-checkpoints` (the pack journals every weld chunk) when the recipe beside it still matches, and refuses with both recipes printed when a knob moved. `REBUILD=1` deletes the journal and starts over; a successful convert deletes it too. Android kills Termux on this device even with the screen on: [termux.md](development/termux.md) has the EMUI settings and the Android 12+ phantom-process limit |
| the baked 3D city map     | `LODONLY=1 OUT=./build/phone-map3d npm run phone` — or the panel's **Baked 3D city map** button (201/6-01). The cell LOD tier as the world's ONLY tier: `opensa-pack --lod-only` skips the HD weld, the recipe records it (`lodOnly`), and the reuse check asks for it by name. Its own folder, because a pak with one tier and a pak with two are different builds |
| the phone panel as MCP    | `npm run panel:tunnel` — the MCP server plus a tunnel in one command, printing the two values to paste (`OPENSA_PHONE_URL`, `OPENSA_PHONE_TOKEN`) and keeping the token in `build/.phone/mcp-token` so a restart re-pastes one value, not two. It tries **ngrok → localhost.run → pinggy → serveo → cloudflared**, in that order and by name (`localhost.run` is the one that came up on this phone), because a carrier that allows 443 blocks cloudflared's only port (**7844**), measured on this phone 2026-08-28; `TUNNEL=<name>` forces one. An address is announced only once the provider says it is CONNECTED — cloudflared prints its `trycloudflare.com` address before it has dialled the edge, and that address was dead. `.mcp.json` runs `mcp-bridge.mjs` rather than naming the URL, because an unset `${VAR}` in that config is refused at load (`INVALID_CONFIG`) and only a new session clears it. `npm run panel:mcp` is the stdio transport, for a Claude running ON the phone. Either way it exposes the panel's own capabilities as tools — state/preflight, the job allowlist, run, log, stop, commit — so an agent drives a field run without a person relaying the screen. A CLIENT of the running panel (one job runner per phone); `phone_exec` is a real shell and is OFF unless `PANEL_MCP_EXEC=1`. **`map_open` opens the console on the phone's own screen** (`termux-open-url`, so `pkg install termux-tools`; Android also needs Termux allowed to **display over other apps**, or it discards the launch and says nothing) and waits for it to reach the panel — the one refusal no other tool could clear, since every `map_` tool talks to a page that is already open; it takes any of the panel's six links by name (`map`, `inventory`, `field`, `flat`, `bake`, `share`), leaves an attached console alone, and hands back the URL when it cannot launch one. **`map_release` hands the phone back** when the run is done — the console's band says so and the device buzzes (`termux-vibrate -f` plus a notification, from the Termux:API add-on; without it the band still says it), which matters because a console that is not the foreground tab is frozen and the operator has to sit still until told otherwise. **Restart it after a pull** — a running server serves the code it started with, so the tunnel keeps handing out the old handshake. Since 2026-08-28 it speaks both protocol eras (it answers `initialize` in the CLIENT's revision and `server/discover` for a modern one), and a malformed line no longer kills it. `OPENSA_PHONE_TIMEOUT_MS` (default 120000) is how long the bridge waits on a phone that has gone quiet rather than refused. **The tunnel keeps itself up**: one request a minute through it (localhost.run closed the first measurement session's with `tunnel inactivity timeout`, and an agent's tunnel is idle by nature), and a provider that dies after being announced is reconnected instead of going silent. **Make the address stop moving** — `ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519` (localhost.run keeps a keyed subdomain) or `NGROK_DOMAIN=https://<yours>.ngrok-free.app` — because the address is read at session START, so one that moves costs a session. [plan](../tools-debug/phone-console/docs/plans/002-mcp.md) |
| the phone panel           | `npm run panel` → `http://localhost:8787` on the phone, then add it to the home screen. Preflight (why a run will not start), the rituals as buttons — including **Map only**, which converts the ground with no models and no collision bake into its own `-map` folder — a live log, and the capture inbox that writes `docs/benchmarks/opensa-engine/<date>-<name>.json` and commits it. **The map files its own capture** since 2026-08-27: `file to the panel` in the console's readout POSTs the report with the district, the mode, the unit count and its own query, and the panel stamps the pak recipe and the device on it — so a field run is one button in the map and one here, with nothing copied or typed. The page's links carry the query too, including **THE FIELD RUN** (`units=150&calls=40&inventory=1`, the declared worst case) and the one-file shareable console — and since 2026-08-28 an agent can open any of them without a person holding the phone (`phone_run open`, `LINK=field|inventory|flat|bake|share|map`), which needs `pkg install termux-api` plus the Termux:API app. Binds `127.0.0.1`; `PANEL_HOST=0.0.0.0` opts into the LAN and says so. [tools-debug/phone-console](../tools-debug/phone-console/README.md) |
| dispatch: the FLAT map    | `…/dispatch.html?mode=flat` — the 2D mode (201/6-02): no WebGPU, no pak, one `tiles.pmtiles` read beside the built game by HTTP range requests. `&tiles=<url>` points at an archive anywhere; with no archive the mode keeps its projected grid and the status bar says why |
| dispatch: SWITCHING modes | **`m`**, or the `2D`/`3D` key in the map's nav cluster (201/6-03). The camera pose comes across; the selection and the moment never move, because they live outside the mode. `?mode=` follows the choice (`replaceState`, so Back still means the page you came from) and is not written at all by an embedded map. A device that cannot carry the 3D map comes up flat and says why — the same banner as the automatic floor, because a mode you CHOSE raises none. The switch cost is logged as `[mode] live → flat in N ms` |
| dispatch: BAKE the tiles  | `…/dispatch.html?src=build/original&bake=tiles&zmin=0&zmax=4` — renders the pyramid with the console's own orthographic pass (one tile at a time, waiting for the streamer) and downloads `tiles.pmtiles`; copy it beside the pak. `&tilesize=256` per side, and the run is refused past 4096 tiles with the count in the message (z8 alone is 65 536). Progress and the final numbers are `[tilebake]` console lines |

Full query-param reference: [development/query-parameters.md](./development/query-parameters.md).

## Individual tools (run standalone when bisecting the chain)

```bash
# Mods → game dir. Two shapes of --in (docs/contracts/mods.md §1): FLAT (every subfolder is a mod, today's
# shape) or LAYERED (common/ + sa/ + opensa/, all optional) — a layered folder applies `common` first, then
# the layer named by --target, and REQUIRES that flag; a flat one ignores it.
npx tsx tools/mod-installer/src/cli.ts --in ./mods-src/original/mods --game ./game-src/original --out <dir>
npx tsx tools/mod-installer/src/cli.ts --in ./mods-src/<game>/mods --game <dir> --out <dir> --target sa

# Lossless map conditioning (normals/prelit/dedupe)
npx tsx tools/map-optimizer/src/cli.ts --game <dir> --out <dir>

# Tree LOD impostors
npx tsx tools/lod-trees-generator/src/cli.ts --in ./mods-src/vegetation --game <dir> --out <dir> \
  --prelight ./mods-src/vegetation/prelight/info.json --tex 512
#   --blend-cards <n>  cards for the REAL-SA set (default 3), which composites them in its sorted pass; the
#   --cards <n> set (default 4) is baked beside it for OpenSA, whose weld unions them. Each SA card's alpha is
#   then solved per tree so the composite covers what that tree's own HD covers (plan 013 step 06).
#   --ss <n>  sub-samples per atlas texel on each axis, a power of two (default 2, 1 = off). The card bake
#   has no MSAA, so a thin leaf quad takes a texel whole or misses it — the atlas speckle plan 013 measured.
#   Bake-time only, and it grows with the SQUARE: ×7.1 at 2, ×25 at 4 (docs/benchmarks/tools/2026-08-21-…).

# Procobj → static IPL + LODs ([--target sa|opensa]: the host the layer's cost is reported against; pmb passes
# its own. [--density n]: scatter cutoff, 1 = vanilla, max 3 — the run prints the density + rows/object it built)
npx tsx tools/sa-procobj-placement/src/cli.ts --in ./mods-src/procobj --game <dir> --out <dir> --prelight --draw 299
#   --sampler <area|corner>  where in a triangle a placement lands; corner is the original's recovered routine
#   --species-floor <n>  objects every species with a candidate is guaranteed per 250 u cell (default 1, 0 = off).
#   Its own gate, WIDER than the runtime's: nothing caps this path, so what empties a species locally is the
#   density lottery, and the floor ADDS objects rather than swapping them (+312 of 91 067 measured, +0.34 %).

# OpenSA cell LODs ([--holes <json>]: hole-fill models merged verbatim past the reduction tracks)
npx tsx tools/opensa-lod-generator/src/cli.ts --game <dir> --out <dir> --cell 250
#   --cell MUST equal the pak's 250 render grid: a mismatched bake puts an object's HD and LOD in different
#   streaming slots — field-proven holes (plan 087). NOT the 256 game grid (collision/procobj keep that).

# Real-SA per-object LOD clones ([--holes <json>]: per-game hole-fill list, e.g. mods-src/original/lod-holes.json)
NODE_OPTIONS=--max-old-space-size=8192 npx tsx tools/sa-lod-generator/src/cli.ts --game <dir> --out <dir>

# One loose vehicle DFF: report / uniform scale / reflection transfer (paths resolve from the CWD)
npx tsx tools/vehicle-optimizer/src/cli.ts --model ./mods-src/original/1/yankee.dff
npx tsx tools/vehicle-optimizer/src/cli.ts --model ./path/to/car.dff --scale 1.02 --prototype ./path/to/ref.dff
#   --coefficient <n> / --reflection <n> / --specular <n>: set the env-map coefficient / reflection intensity /
#     specular level outright
#     (with or without a donor — they win over it). The coefficient is the mirror-the-world strength AND the
#     author's marking of which surfaces reflect; only the marked ones are retuned.
#   no operation at all = a structure report, nothing written
#   the finished DFF lands in an `out/` folder BESIDE the model; --out <dir> puts it elsewhere
#   what moved: npx tsx scripts/debug/dff-reflection.ts <before.dff> <after.dff> --diff

# Game dir → native pak (the pack stage standalone)
NODE_OPTIONS=--max-old-space-size=12288 \
  npx tsx tools/opensa-pack/src/cli.ts --game <dir> --out <dir> --in ./mods-src
#   [--rect x0,y0,x1,y1] [--pak-out <dir>] [--game-id <id>] [--no-ao] [--bakes --clouds mods-src/clouds] [--no-models] [--bake-workers N] [--stochastic <file…>] [--platforms desktop|mobile[,…]] [--textures astc|bc|rgba8] [--max-texture N] [--vehicles a,b] [--peds a,b]
#   --rect: optional SUBSET override (bench districts); default auto-fits every cell with content — the old
#     hardcoded ±12 silently dropped gostown's far islands (plan 087)
#   --pak-out: where the pak products land (default: <out>/pak — the game dir is self-contained, 086 phase 8)
#   --checkpoints <dir> [--resume]: per-chunk weld checkpoints; --resume continues from them (pmb plan 006)
#   --game-id: fetch game id stamped into the pak manifest (default: basename of --game; pmb passes its own)
#   --bake-collision: write every cell's collision into the pak (.oscol v2, on the GAME grid 256 -- NOT the
#     render grid 250) so the browser never parses a COL, and resolve the breakable gate here too (the
#     per-placement instance keys ride along, so the runtime opens no DFF either). The runtime READS this
#     since 200/3-01; a cell without an entry falls back to parsing COL. Off by default: it costs build time
#   --platforms: ASSERT the build runs on the named GPU families, and fail the pack when it does not. Every
#     run reports the demand anyway (report.json `platforms`, and one log line): world arrays ∪ model
#     dictionaries, because a car is NOT in the pak — an --rgba8 world can still be unspawnable on a phone
#   --textures: the format the build WRITES, for the world AND every model dictionary (200/2-02).
#     bc (default) passes SA's DXT through untouched, desktop-only. astc re-encodes to ASTC 4x4 — one byte
#     per texel (the same as BC3, a QUARTER of rgba8) on the GPUs that have no BC; it costs build time and
#     one generation of loss. rgba8 leaves the pixels uncompressed: portable, 4x an astc payload.
#     `--rgba8` is the older spelling of `--textures rgba8`; passing both when they DISAGREE is an error
```

## Viewers' compare server

```bash
# BEFORE = any game dir (.dff), AFTER = a converted build (.osm); port 3002 (--port)
npx tsx tools/map-optimizer/src/compare-serve.ts --before ./game-src/original --after ./build/original/opensa
```

## Headless field checks (tools-debug/bench-harness)

```bash
SRC=http://localhost:3001/build/original/opensa
# Boot + bench/soak. Env: DPR=2 · TAG='[soak]' · DRAG=<dy>. A screenshot lands at ./<outPrefix>.png in the
# REPO ROOT on exit — delete it before committing, nothing ignores it
NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&bench=all" <outPrefix> <timeoutMs> <expectReports>
# WebGPU boot gate: 'canvas' reports the context type, 'sorry' expects the no-WebGPU screen
NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/gate-check.js canvas \
  "http://localhost:5173/?loader=http-dir&src=$SRC" <outPrefix>
# Scripted physics laps (081/01) — TAG switches the protocol the harness collects
TAG='[phys]' NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&phys=all&car=infernus" phys 900000 7
# Video mode (096/02) — the run ends after <expectReports> scenes have reported, or at the sequence's own end
# ALSO='[cam]' echoes a second protocol without counting it as a report (096/03 reads the jump watchdog)
TAG='[video]' ALSO='[cam]' NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&video=1&seed=47" video 600000 8
# Pick a corner-heavy route to look at first (offline, no boot): scripts/debug/video-routes.ts --worst
#   …then drive THAT street: append &at=<x>,<y> from the line it printed
# Camera-motion diagnosis (096, field round 1) — &diag=1 adds a [diag] line per scene, one row per FRAME;
#   ALSO='[diag]' to collect it, then: npx tsx scripts/debug/video-shiver.ts <harness.log>
# The acceptance exam off the same log: npx tsx scripts/debug/video-accept.ts <harness.log>…
# Is the CHROME out of the shot (096/08)? A DOM probe INSIDE a fragment — the one thing no log can answer.
#   Run the control first (no ?video=), or all-false proves nothing but a wrong selector:
npx tsx scripts/debug/video-chrome.ts "http://localhost:5173/?loader=http-dir&src=$SRC" 90000 --control
npx tsx scripts/debug/video-chrome.ts \
  "http://localhost:5173/?loader=http-dir&src=$SRC&video=1&seed=47&scene=1&scenes=1" 180000
# Do the MOBILE on-screen controls reach the game (055)? Boots with hasTouch and drives the overlay's own
#   pixels; needs `npm run dev` (it reads the dev HUD) and an OPEN spawn — a wall fails a healthy build
npx tsx scripts/debug/touch-controls-check.ts \
  "http://localhost:5173/?loader=http-dir&src=$SRC&hour=12&weather=0&spawn=342,-1803,4.8"
# Speed-grip dials (081/09) — session overrides for the lateral assist; captures record the active values
#   ?gripVd=<m/s>  boost reference speed (default 12)  ·  ?gripCap=<x>  boost ceiling (default 3)
# Surface grip (081/10) — ?surfGrip=0 puts every wheel back on tarmac, the A/B for reading surface.dat
# Dynamic particle probe (089/01) — ?fxprobe=<fxp system, e.g. prt_collisionsmoke> parks a one-shot
#   emitter beside the player (burst 1/fixed step = 60/s); the system must be in DYNAMIC_SYSTEMS
# Tyre smoke dials (089/02) — ?smokeStart=<m/s> ?smokeFull=<m/s> ?smokeRate=<n/wheel/s>
#   equivalent-slide thresholds + spawn rate (defaults 4 / 12 / 6); the fit: docs/hacks/tyre-smoke-intensity-fit.md
# Air control (081/06 §1) — ?airCtl=<x> scales the in-air pitch/roll/yaw authority; 0 = off (the jump A/B)
# CLEO (200) — ON by default since 2026-08-06; ?cleo=0 opts a session out, ?cleo=1 force-enables
#   (census line `[cleo] N script(s)`; atlas misses print as `[cleo] atlas miss:` lines) ·
#   ?osmspike=<model> renders one map-object .osm beside the player (the 04 phase-0 spike hook) ·
#   F2 → CLEO (097/07): runner/trace toggles, thread list with per-tick cost, unimplemented/atlas
#   coverage with tiers, per-thread trace, step-one
# HUD `signs N` — roadsign glyph quads in the cells drawn this frame (.oscell minor 8). The instrument for
#   "do plates survive to LOD range", which a screenshot cannot answer (~8 px at 440 u). 0 on a pre-minor-8
#   pak means UNKNOWN, not none — check the pak manifest's buildTime first (canonical: 13:19 08-08-2026 on)
# Effect draw distance — ?fx=N scales EVERY fx system's shipped distance (its authored cullDist with the
#   recorded departures and the dynamic lane's 300 u floor applied). 1 = as the data says; the debugger's
#   Graphics → EFFECTS DISTANCE slider is the same knob live. A tiny value (?fx=0.02) is the POSITIVE
#   CONTROL a distance capture needs: it culls the emitters, which is the only way a shot can prove the
#   specks in it are particles. Find something to aim at with scripts/debug/fx-anchor-census.ts
# Camera aim (100 field checks) — ?look=x,y,z points the boot camera at a GTA world point and turns the
#   ped with it (auto-centre then holds the aim). Without it every headless probe stares SOUTH, since
#   look is pointer-only and the harness has no mouse. Pair with ?spawn: `?spawn=2033,2832,80&look=2632,2832,127`
# Vehicle field checks (097/05) — ?spawncar=model[,x,y,z[,heading]] spawns one car (retries until the
#   ground streams in; default spot 8 m north of spawn; heading is RADIANS — 0 faces north, the boot
#   camera looks SOUTH, so put a car you want in frame at y − 10) · ?autoseat=1 seats the player once
#   it exists
# Warning catcher (bug rounds) — collects every console warning/error + WebGPU validation message from a
#   live headless run into JSON (deduped, with counts) + screenshot; KEYS holds keys, TAGS echoes info
#   lines like [spawncar]. See tools-debug/bench-harness/README.md
NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/warnings.js \
  "http://localhost:5173/?loader=http-dir&src=http://localhost:3001/build/original/opensa&cleo=1&spawn=X,Y,Z" out 30000
# Diff two capture sets (raw harness logs are accepted as-is); --determinism gates a replay check
npx tsx scripts/phys-compare.ts before.log after.log [--determinism]
# The regression pack (081/07): a fresh 5-car sweep against the committed accepted-feel matrix
npx tsx scripts/phys-regression.ts sweep-*.log
```

Guides: [development/benchmarks.md](./development/benchmarks.md) (perf) ·
[development/physics-laps.md](./development/physics-laps.md) (`?phys=` laps).

## ASI plugins (real SA, cross-compiled — needs `brew install mingw-w64`)

```bash
# Build a plugin. Every plugin gets these three via asi/sdk's Makefile fragment.
npm run build:asi    -w @opensa/perfect-map-asi   # shipping: APPLY, both fixes → dist/perfect-map.asi
npm run build:verify -w @opensa/perfect-map-asi   # DRY RUN: patches nothing, logs every site's verdict
npm run build:debug  -w @opensa/perfect-map-asi   # APPLY + verbose site dump + the plugin's own traces
npm run gen          -w @opensa/perfect-map-asi   # catalogue.ts → src/generated/patches.hpp only

# The second plugin: deferred cutscene alpha (glass over scene actors) → dist/perfect-cutscene.asi
npm run build:asi    -w @opensa/perfect-cutscene-asi
npm run build:verify -w @opensa/perfect-cutscene-asi   # what a bring-up step installs: verifies, writes nothing

# Per-fix bisection (the flags are the plugin's; EXTRA_CXXFLAGS is the SDK's knob)
make -C asi/perfect-map APPLY=1 EXTRA_CXXFLAGS='-DPM_FIX_INT16=1 -DPM_FIX_FX2DFX=0'
# DEBUG=1 without APPLY=1 is refused: every debug switch is read inside an APPLY build.

# Reproducible artifact for an A/B — pin BOTH the PE timestamps (already in the link line) and the
# banner's __DATE__/__TIME__, or two builds a second apart differ:
SOURCE_DATE_EPOCH=315532800 make -C asi/perfect-map clean && \
  SOURCE_DATE_EPOCH=315532800 make -C asi/perfect-map APPLY=1
```

The verdict lives in `perfect-map-asi.log` next to `gta_sa.exe`. **Read its first line before anything
else** — `built <date> <time> (APPLY|verify-only)` is the only thing identifying which artifact the game
actually loaded, and a verify-only build patches nothing.

## Debug & repro

```bash
# Ghost-barriers int16 repro dial (33k rows = buggy, 32k = clean)
npx tsx tools-debug/sa-int16-repro/src/cli.ts --game ./game-src/original --out <dir> --rows 33000

# One-off inspectors (scripts/debug/) — catalog + the triage playbook: docs/debug/README.md
npx tsx scripts/debug/<name>.ts --help

# crossTxd ledger → reviewable PNG fixes per owning mod (the /crosstxd-fix skill; installer plan 009)
npx tsx scripts/crosstxd-fix.ts   # → NO_COMMIT/crossTxdFix/<mod>/gta3_img/<txd>/<texture>.png
```

## Repo chores

```bash
npm test / npm run test:coverage     # vitest (+ coverage floors)
npm run test:fixtures                # real-GTA fixtures + viewer e2e assets (+ the CLEO corpus from mods-src/original)
npm run cleo:opcodes                 # regenerate packages/cleo opcode table from the vendored Sanny sa.json (pin: packages/cleo/vendor/README.md)
npm run build:cleo-scripts           # CLEO authoring SDK: compile cleo/scripts/* to cleo/sdk/dist/*.cs (cleo/sdk plan 001: discovery+report; assembly lands with 002-004)
npm run cleo:whitelist               # regenerate the SDK's dual-target whitelist (real CLEO 4 x VM registry; drift test guards staleness)
npx tsx scripts/debug/scm-disasm.ts <file.cs|dir> [--census|--strings|--json] [--out <dir>]   # disassemble compiled CLEO scripts (097/02)
npx tsx scripts/debug/cleo-census.ts [paths…] [--json]                                        # opcode frequency/coverage table over a CLEO corpus (097/02; status column = VM registry join)
npx tsx scripts/debug/cleo-run.ts <file.cs> [--ticks 60] [--fps 60] [--calls 60]              # run a CLEO script headless on the VM, print the host-call trace (097/02+03)
npx tsx scripts/debug/cleo-trace-fixtures.ts                                                  # regenerate the corpus trace snapshots (fixtures-src/cleo-traces/ + the fixtures/custom mirror, 097/07; review the diff — it IS the change)
npm run e2e / e2e:ui / e2e:update    # playwright
npm run lint / format                # tsc --noEmit + eslint / prettier+eslint --fix
npm run arch / arch:render           # package graph to stdout / regenerate docs/architecture/assets
npm run build:game:original:opensa   # pmb (--exclude sa) + fetch-pack → the opensa game dir + the fetch build (also :gostown :carcer :anderius)
npm run build:game:original:sa       # pmb (--exclude opensa) → the real-game sa/ target only, split + vehicles + cutscene fleet + both asis
npx tsx tools/fetch-pack/src/cli.ts     # fetch build standalone (chained in build:game:*; --build ./build/<id>; --out ./static/games stages a local fetch test)
                                        #   expands models/*.img into bare-named entries (fetch mode cannot open a container), prunes chunks a re-pack replaced, skips *.bak/.DS_Store
npm run timecyc                      # UTILITY: merge donors onto a base timecyc → tools/timecyc-builder/src/merged/timecyc_24h.dat
                                        #   writes NOTHING else and is not part of pmb or any build (docs/restrictions/timecyc-builder-is-a-utility.md);
                                        #   copying its output into a game dir is a deliberate act — that name outranks a mod's timecyc24h.dat
```

## Claude Code plugins

**Superpowers is not installed out of the box** — a fresh web container has no marketplace and no plugin,
and `~/.claude` does not survive it. What it ships, what it costs and the trust caveat:
[development/superpowers.md](development/superpowers.md).

```bash
claude plugin marketplace list        # what is configured (a fresh container: "No marketplaces configured")
claude plugin list                    # what is installed
claude plugin marketplace add obra/superpowers        # ~20 s, clones from GitHub
claude plugin install superpowers@superpowers-dev     # 14 skills, live in the SAME session
claude plugin details superpowers     # component inventory + projected token cost (~688 tok always-on)
claude plugin uninstall superpowers@superpowers-dev   # and: claude plugin marketplace remove superpowers-dev
```

The install writes `extraKnownMarketplaces` + `enabledPlugins` into `~/.claude/settings.json` (ephemeral);
the same two keys are committed in `.claude/settings.json` so a trusted workspace picks them up on its own.
