# Tools

One-paragraph architecture of everything under `tools/` and `tools-debug/`. All tools are offline Node CLIs
(`src/cli.ts` unless noted) exposing a library entry the pipeline calls; they may read engine packages but
never the app. The dependency picture is the tools cluster of
[assets/packages.svg](./assets/packages.svg).

## Pipeline stages (chained by [perfect-map-builder](./perfect-map-builder.md))

- **perfect-map-builder** — the orchestrator; `buildPerfectMap` in `src/pipeline.ts` chains every stage,
  guards SA runtime ceilings, and splits into the `sa/` (RenderWare) + `opensa/` (native pak) targets. A run
  that dies is RESUMED, not restarted (plan 006, 2026-08-17): `.work-<target>/resume.json` records the run's
  identity (git HEAD, config hash, source fingerprints) and every finished step, the pack journals each weld
  chunk under `pack-checkpoints/`, and `--resume` re-enters at the last finished step — refusing, naming the
  difference, if the inputs changed. `src/resume.ts`.
- **mod-installer** — layers GTA-SA mod folders onto a base game: plain file overlays plus a Modloader
  `loader.txt` bake into `gta.dat`/`gta3.img`; cumulative, alphabetical. Lib `src/install.ts`. Its `--in`
  has two shapes (plan 011): FLAT — every subfolder a mod — or LAYERED `common/` + `sa/` + `opensa/`, where
  `common` applies first and then the layer of `--target`, which makes the stage target-dependent and a
  both-target run over it a config-time refusal. Resolution lives in `@opensa/tool-kit/layers` (moved out of
  the tool 2026-08-17 — vehicle-installer plan 010 and ped-installer plan 005 read their `--in` through the
  SAME planner, so a layered vehicles/peds folder behaves exactly like a layered mods folder).
- **vehicle-installer** — vehicle mod folders → `gta3.img` + merged `handling.cfg` / `vehicles.ide` /
  `carcols.dat` / `carmods.dat`. A mod's settings file is decoded by its own encoding (UTF-16 is what most
  authors ship) and every block it cannot classify is reported. A mod's `features.txt` (Modloader/IVF) is
  copied into `data/vehicle-features.txt`, which opensa-pack reads while baking that car; on the **`sa`
  target** the same declaration is ALSO mapped onto a stock carrier model in fastman92's
  `data/model_special_features.dat` (plan 011), because the real game hardcodes every special ability to a
  model id. It also writes
  the two files a mod's own plugins read: `model-variations-extra.txt`'s section into
  `modloader/Model_Variations/ModelVariations_Vehicles.ini` (mod 11, `sa` only — `{{name}}` resolved to that
  model's id in the tree's IDEs) and `text.txt` into `cleo/cleo_text/<model>.fxt`, the GXT names its new tuning parts
  show in the shop (plan 012); `audio.txt` into FLA's `gtasa_vehicleAudioSettings.cfg` and `parked.txt` into
  Parked Maker's `[Cars]`, counted against the car-generator array (plan 013). And
  `data/vehicle-mods.txt`, the mod-car ledger (096/06): once the rows are merged, a mod car is
  indistinguishable from a stock one anywhere downstream, so the set the installer knows while it works is
  written down — the ONE vehicle data file read at runtime, and a SWITCH: name one drivable slot and every video-mode
  scene drives a mod car, name none and every scene takes a stock one. A
  `--rebake` merges into it rather than rewriting it from its own selection.
  **`--rebake <game>`** runs the same work against a game that is ALREADY BUILT, in place — merging settings
  into the built `data/*` and re-converting each model into the archive's `<model>.osm` through opensa-pack's
  own `buildVehicleOsm`. It is the one place a tool reaches ACROSS the pipeline (installer → converter) and it
  exists because a vehicle round is otherwise a full build to see one row: one car 3.6 s, twelve 26 s. It can
  add a car too, on the id the mod declares for itself
  ([plan 006](../../tools/vehicle-installer/docs/plans/006-rebake.md)). **`--kind sa`** does the same against
  the real-SA tree (`build/<game>/sa`): nothing converted, the raw `.dff`/`.txd`s replaced by name in the
  vehicles archive FAMILY opened as one (`openImgFamily`) — one car 4.2 s against a ~12 min `sa` build; each
  kind refuses the other's tree by what the archive holds
  ([plan 008](../../tools/vehicle-installer/docs/plans/008-rebake-sa.md)).
- **vehicle-cutscene** — the vehicles stage's shadow: converts the installed vehicle mods into their `cs*`
  cutscene counterparts (flattened rig with the vanilla model's HAnim bone ids, baked carcols paint,
  readable plates, `txdp`-resolved TXD). It writes THREE outputs — `models/cutscene.img`,
  `data/txdcut.ide` and `anim/cuts.img`, the last because two defects live in the SCENE rather than in any
  model (a wheel stash and the actor's seat). `--no-base-copy` emits only those three instead of a game
  tree (plan 006) — the shape the standalone converter app needs, byte-identical to the copy run. Lib
  `src/install.ts`.
- **ped-installer** — ped mod folders → `gta3.img` + merged `peds.ide`. Its `--in` may be layered
  `common/sa/opensa` like a mods folder (plan 005, `@opensa/tool-kit/layers`, `--target`).
- **img-splitter** — divides `models/gta3.img` into TYPED archives (`vehicles.img`, `peds.img`,
  `weapons.img`) before anything installs, so every entry name lives in exactly one of them; writes the
  `IMG` lines into `gta.dat` and gates the tree against SA's 8-archive table. The bucket comes from the IDE
  section a model's row sits in, plus `carmods.dat` for mod-shop parts. pmb's FIRST stage. Lib
  `src/split.ts`, classifier `src/classify.ts`; the design is
  [img-archive-layout.md](./img-archive-layout.md).
- **map-optimizer** — lossless DFF/TXD conditioning (smooth-group normals, prelit sync, dedupe, mips; a DXT
  texture that is not block-aligned is resampled to a power of two, since the real game refuses it and its whole
  dictionary — `restrictions/dxt-raster-dimensions.md`) that yields a drop-in game dir; refuses geometry it
  can't provably remap. Lib `src/run.ts`.
- **lod-trees-generator** — tree LOD impostors: crossed billboard cards + a baked DXT5 alpha atlas, placed
  via the IPL lod-index.
- **sa-procobj-placement** — bakes procobj scatter species into **permanent static IPL rows at `lod = -1`**, with
  range from the stock `data/maps/generic/procobj.ide` raised 59 → 299. **`sa` only** — OpenSA scatters the same
  species at runtime, where draw distance is a setting. No LODs and no binary streams since plan 014: a stream's
  IPL slot is only resident within 190 units of the player, so it cannot carry range, and a generated LOD for a
  hand-modelled bush recovered ~0.2 % of its geometry for the price of a whole entity.
- **sa-lod-generator** — regenerates per-object LODs as HD clones (geometry clone — verbatim, budget-decimated,
  or MERGED to one atomic when the HD is a multi-atomic `anim` clump, since an `objs` row keeps one atomic —
  + empty COL + halved textures, every level a power of two) for the **real game** target.
- **opensa-lod-generator** — the OpenSA cell-LOD bake: merge per 250-cell (= the render grid, plan 087) → budgeted QEM decimate →
  per-cell TXD; output is not tuned for the real-SA streamer (uncapped). Its adapter takes `deps.archives`
  and bakes per cell, which is how `scripts/debug/model-repack.ts` re-bakes ONE rect's cells from a swapped
  HD for the lab pak (opensa-lod-generator plan 007) — the tool itself has no per-cell output path (`writeBuild` wipes + mirrors).
- **opensa-pack** — game-ready dir → native build (`.osm` per model inside the IMGs + the `opensa/` pak);
  see [perfect-map-builder.md](./perfect-map-builder.md#opensa-pack-the-pack-stage-also-standalone).
  **A pack output is never re-packed or read as a source** (its `.dff`s are gone — the weld silently yields
  a quarter of the world; `restrictions/build-vs-runtime.md`); the one-model swap for this target is the
  lab pak (`model-repack.ts`), and in-place surgery on `world.ospak` is researched and in reserve
  (`in-reserve/ospak-in-place-cell-patch.md`: the container permits it, the texture plan is not persisted).
- **fetch-pack** — the build finisher (plan 086): re-homes a build into the fetch-serveable
  `build/<id>/opensa-pack/<game>-<version>/` layout the fetch-mode loader streams by range. Chained after the
  pack in every `build:game:<id>:opensa`; see
  [perfect-map-builder.md](./perfect-map-builder.md).
  **It EXPANDS `models/*.img` into their entries under bare names** rather than packing the archives as
  files — the fetch loader pushes chunk bytes into the VFS verbatim and has no archive step, so a packed
  container is one opaque key and every name inside it is unreachable (`expand-img.ts`). Entry precedence is
  the local loader's: `gta3.img`, then `gta_int.img`, then the rest alphabetically, first owner winning.
  **Every packed name is LOWERCASED** (the read keeps the on-disk spelling), matching the local loader — a
  TC is free to ship `data/maps/Gostown6/Gp_City.IPL` and the runtime asks for it lowercased.
  A parity test (`loader-parity.test.ts`) pins both rules against the local loader's own selection.
  It also **prunes the chunks a re-pack replaced** — chunk names carry a content hash, so old files would
  otherwise pile up in the deploy dir — and skips `*.bak` / `.DS_Store`.

## Standalone tools

- **vehicle-optimizer** — loose-DFF vehicle conditioning: uniform scale (+ ground lift) and
  reflection-strength transfer from a prototype.
- **timecyc-builder** — a UTILITY that merges donor timecyc columns onto a base and writes ONE file into
  its own `src/merged/` (entry `src/index.ts`; `npm run timecyc`). **Not a build stage and not consumed by
  one**: no `pmb` stage runs it, and getting an output into a game is a deliberate copy by whoever wants it
  shipped — see [`restrictions/timecyc-builder-is-a-utility.md`](../restrictions/timecyc-builder-is-a-utility.md),
  where a violation is silent twice over. The engine reads whichever of three timecyc names a world carries
  (`docs/contracts/mods.md` §2), not this tool's output.

## Libraries (no CLI)

- **lod-common** — the shared HD→LOD mesh pipeline: `MeshBuilder`, budgeted QEM decimation with UV-drift
  guards, smooth-normal rebuild, RW DFF/TXD/COL encoders, prelight transfer.
- **map-placement** — shared SA map-placement workflows: object-id allocation inside the stock id gap,
  IDE/`gta.dat` editing, streamed-area budgeting, procobj scatter conversion, the tree-model roster.
- **rw-codec** — pure byte-level RenderWare codec (chunk walker, geometry struct, DXT, texture natives,
  mips, typed 2dfx payloads) used by every tool that rewrites DFF/TXD bytes.
- **tool-kit** — shared building blocks: CLI arg helpers, smooth-group normals, QEM simplify, editable IMG
  archive (`openImg` / `writeImgFamily`, and since 2026-08-17 `openImgFamily` — a spilled family read as
  one archive, the read half of the writer), `copyGameDir`/`guardOut`, `registerImgArchives` /
  `unregisterImgArchives`, the ONE layer planner every installer reads a `common/sa/opensa` folder through
  (`layers.ts`), and the ONE resolver of a vehicles folder (`vehicles-dir.ts`).

## tools-debug/ (investigation harnesses, not shipped)

- **bench-harness** — the headless field-check rig: boots the real game via
  `?loader=http-dir&src=<served build>` under Playwright WebGPU; bench sweeps (`?bench=all`), soak runs,
  boot-gate screenshots. Guide: [docs/development/benchmarks.md](../development/benchmarks.md).
- **sa-int16-repro** — the ghost-barriers dial: inflates a built game dir's permanent text-IPL rows across
  2^15 to reproduce SA's int16 building-pool truncation; the pass/fail oracle for the `asi/perfect-map`
  limit-adjuster.

## asi/

The root category for `.asi` plugins that patch the real SA exe: an SDK plus its consumers, mirroring
`cleo/`'s sdk-plus-scripts split. C++ sidecars, not part of the web build.

- **sdk** (`@opensa/asi-sdk`) — the common base every plugin builds on: the `asi::` C++ framework (exe
  fingerprint gate read from disk, byte-verify, adjuster coexistence, hook shapes, logging, the
  reopen-append runtime logger, `VerifySitesOrDefer`), the catalogue codegen library (`gen/`, emitting a
  plugin's generated header) and the MinGW-w64 build rules (`mk/asi-plugin.mk`). A plugin supplies only its
  catalogue, its payloads, its config knobs and a thin Makefile.
  [`asi/sdk/docs/`](../../asi/sdk/docs/architecture.md) — chain 001–005.
- **perfect-map** — the first consumer: the limit-adjuster ASI lifting the int16 building-pool ceiling and
  guarding the 2dfx fx-system use-after-free.
- **perfect-cutscene** — the second consumer, written straight onto the SDK with no framework change: it
  repoints ONE call in `CRenderer::RenderEverythingBarRoads` so a cutscene car joins the sorted entity pass
  gameplay vehicles already use, instead of rendering inline in sector-scan order where its window glass
  z-writes over scene actors. **The converted cutscene fleet depends on it** — see
  [`restrictions/sa-target.md`](../restrictions/sa-target.md).
  [`asi/perfect-cutscene/docs/plans/`](../../asi/perfect-cutscene/docs/plans/readme.md) — plan 001.
