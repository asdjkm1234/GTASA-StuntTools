# Changelog

## 0.4.0 (2026-08-03)

**Replaced the three.js renderer with our own WebGPU engine.** The `three` dependency is gone entirely
(plan [074](docs/plans/074-opensa-engine/readme.md)). At identical content the app got **both faster and
smaller**: a **~7× runtime speed-up** (city scenes went from 16–24 fps on three.js to a locked 120 fps) and a
**−12.8 % gzip bundle** despite the engine being a large body of added code. Full numbers +
reproduction: [`docs/audit/three-to-own-engine.md`](docs/audit/three-to-own-engine.md).

### Own file formats

The migration is built on a family of native, GPU-shaped formats (`packages/engine-formats`) — the runtime
"codec" is a header parse + `writeBuffer`/`writeTexture`, so all the offline work is done offline instead of
in a runtime costume:

- **`.osm`** — one MODEL, in named sections (`DESC`/`GEOM`/`TEXS`/`COLL`/`HULL`/`SHAT`/`SKEL`). Covers assets
  the runtime resolves BY NAME: vehicles, peds, clutter, breakables, animated objects. Each consumer reads
  only its own byte range (collision without touching geometry; nothing parsed twice).
- **`.oscell`** — one streamed world cell (HD or LOD) in the final GPU vertex layout (interleaved 36 B stride
  with baked day/night prelight, sun-visibility and wind-sway channels). Uploads verbatim.
- **`.ostex`** — one `texture2d_array` with the full mip chain baked offline (premultiplied alpha, 256-byte
  aligned rows) — the runtime never generates mips.
- **`.ospak`** — the archive: a JSON manifest + one 4 KiB-aligned binary pak, read by RANGE only (Cache API /
  HTTP Range, never whole in JS); FNV-1a entry hashes keep converter re-runs and delivery incremental.
- **`.oswire`** — meshopt-compressed transport wrapper for `.oscell` payloads; the pak worker rebuilds the
  exact `.oscell` bytes, so the engine never learns wire encodings exist.
- **`water.bin`** — baked water grid (per-vertex shore-distance + depth field) driving the animated shoreline.

### Engine

- **Own WebGPU renderer** — sky/fog/night/weather, dynamic vehicle + ped lighting, water, godrays, local
  lights, particles, shadows — no three.js, no WebGL fallback path.
- **Runtime-resolved animation** — IFP clips are parsed by name at runtime (`IfpSampler`), never baked into
  the model; adding animations needs no rebuild and does not grow a ped's `.osm`.
- **Roadsign text** (plan [076](docs/plans/076-roadsign-text/readme.md)) — 2dfx type-7 text plates are baked
  into the cutout pipeline through the `roadsignfont` glyph atlas; the boards the old renderer left blank now
  carry their words.
- **Water body classes** (plan [075](docs/plans/075-water-body-classes/readme.md)) — `water.dat` is split by
  height, so inland pools and reservoirs render calm while the ocean keeps its swell, foam and spillover.

### Vehicles

- **Driving physics rebuilt on the game's own numbers** (plan
  [081](docs/plans/081-vehicle-physics/readme.md), [audit](docs/audit/vehicle-physics-081.md) +
  [close-out](docs/audit/vehicle-physics-081-closeout.md)). `handling.cfg` went from **5 consumed fields to
  21**, each one a translation of the original's own code: the spring law, the `cTransmission` gearbox, air
  drag, tyre grip and traction loss, the steering limiter, the rear-lock handbrake, air control and camber
  from the authored axle. **Six fitted constants died** with it. A five-class sweep found the tuning
  generalises and left the class-factor table empty; a 5-car × 11-scene regression pack
  (`scripts/phys-regression.ts`) gates it.
- **License plates** (plan [082](docs/plans/082-vehicle-plates/readme.md)) — every car wears a city-correct
  plate: a plate atlas array with a per-instance slot, converter-flagged plate submeshes, a mask DSL, and
  placement-seeded determinism so a car keeps its number across LOD respawns. The plate rides the damage.
- **Appearance and dynamic-model lighting** (plan [084](docs/plans/084-vehicle-appearance/readme.md)) — wheel
  side/scale conventions read from the asset, and a flat dynamic indirect term for cars and peds.
- **Particles, marks and decals** (plan [089](docs/plans/089-vehicle-particles/readme.md),
  [audit](docs/audit/vehicle-effects-089.md)) — the engine's first one-shot particle lane and its first DECAL
  lane, then tyre smoke, severity-darkened skid marks that last 12 real seconds, impact smoke off the damage
  gate, and surface dust/sand driven by surfinfo's own `W_*` flags. **No measurable sweep cost.**
- **The map's own cars are back** (plan [059](docs/plans/059-map-car-generators/readme.md)) — the binary IPL
  `CARS` generators went out with the three.js host in the 074 teardown and nothing failed, so for six weeks
  the map had only `parked.json`'s 212 cars. Both populations are restored, registered lazily by distance,
  and each now **announces its size at boot** so an empty map can never again look like a full one.

### Camera

- **Cinematic follow camera** (plan [080](docs/plans/080-cinematic-camera/readme.md)) — per-channel springs
  and lag, auto-centre and look-ahead, collision whiskers with snap-in/ease-out and a floor guard, speed →
  distance/FOV curves, drift framing off the physics slip channel, and an additive motion layer (bob, landing
  dip, impact shake, sprint FOV kick) bounded behind a `reducedMotion` switch. Four field rounds, accepted;
  the tuning is frozen and the legacy A/B deleted.

### Peds

- **Locomotion feel** (plan [088](docs/plans/088-ped-locomotion-feel/readme.md),
  [audit](docs/audit/ped-locomotion-feel.md)) — turn-rate heading and plant, crossfades with phase carry,
  walk/run/sprint tiers with cycle-speed sync, a jump/fall FSM (coyote time, input buffer, anticipation),
  impact-tiered landings, a real slope slide, and vehicle ingress/egress with root-motion slides, passenger
  door and shuffle, a blockage-probed exit chain and the overturned crawl-out.

### World and lighting

- **The world ambient term** (plan [093](docs/plans/093-world-ambient-term/readme.md)) — SA's own building
  formula, recovered from the PS2 pipe and gta-reversed, adds `timecycle ambient × surfAmb` on top of the
  day/night-blended prelight. Without that additive floor every black-prelit vertex renders pure black, and
  the class is vanilla-wide: **2 243 models**, 125 of the worst 186 of them stock SA, where the shadow was
  AUTHORED black in the trust that the renderer had a floor.
- **Alpha classification for the cutouts that are not vegetation** (plan
  [092](docs/plans/092-alpha-cutout-classification/readme.md)) — the rule now reads the alpha histogram
  against the test vanilla actually applies instead of the asset's slot, moving **1 602 textures** out of the
  blend pass. The overlay class is gated by `NO_ZBUFFER_WRITE`, not `DRAW_LAST` — a distinction the reversed
  source later confirmed.
- **Per-channel night emissive** (plan [085](docs/plans/085-map-object-appearance/readme.md)) — the old luma
  delta systematically killed saturated neon; the Las Venturas strip's red rope lights never glowed.

### Video mode

- **`?video=1`** (plan [096](docs/plans/096-video-mode/readme.md),
  [audit](docs/audit/video-mode-096.md)) — a bounded, seeded, self-directed showcase for trailer recording. A
  car drives a route generated from the game's own `NODES*.DAT` graph while the director cuts between
  occlusion-checked tripod stations and chase/front/rear/wing shots, cycling LS → LV → SF → Country → Desert
  with region-native weather and all chrome hidden. A **32.7-minute unattended soak of 40 scenes ran with 0
  throws and no drift**, at **0.0096 ms per frame** — under 0.2 % of a 120 Hz frame.
- **It drives YOUR cars.** If the build has vehicle mods installed, every scene of the run drives one of them
  and no stock car appears; a build with none takes the stock roster. The set comes from a build-time ledger
  (`data/vehicle-mods.txt`) written by `vehicle-installer`, because nothing about a mod survives the merge.
- **The address bar names the scene now playing** — `?video=1` becomes `?video=1&seed=…&scene=6` as the reel
  advances, so a run can be resumed at the shot you were looking at. The seed is written with it: a run given
  none derives it from the clock, and a URL naming only the scene would name a different one on reload.

### Diagnostics

- **Frame-time attribution** (plan [091](docs/plans/091-frame-time-attribution/readme.md)) — the `[slow]`
  line's `other` was a residual holding two different things, and **no in-loop timer can see** the half that
  the browser spends BETWEEN frames, which is where a resolved spawn is paid. A frame-span recorder now lets
  that work report itself. Two defects in the line itself were fixed on the way: it mixed two intervals, and
  it printed the 250 ms `dt` clamp — so the worst frame on record read 250.0 when it was **576.1**.

### Tools

- **One build, consistent names, pak-based fetch** (plan
  [086](docs/plans/086-unified-build-naming-fetch/readme.md)) — `game-src/<id>` · `mods-src/<id>` ·
  `build/<id>` naming unification, pak manifest identity, and the `fetch-pack` finishing tool replacing
  `build-game.ts`. Every dev surface — lab, bench harness, viewers — reads ONE canonical build, served in
  place (plan [079](docs/plans/079-canonical-build-source/readme.md)).
- **`fetch-pack` now ships what the runtime can actually read.** The web-delivery build expands the
  `models/*.img` archives into their entries under bare, lowercased names — the only form the fetch loader's
  VFS can resolve, and the same key space the folder loader produces. Packed as containers (and under their
  on-disk spelling) a self-hosted total conversion lost its player model, its collision and most of its map
  while still rendering. The pack also prunes the chunks a re-pack replaced, instead of leaving every chunk
  set ever built in the deploy folder, and skips `*.bak` / `.DS_Store`. A parity test now compares the two
  loaders' key sets, which nothing did before.
- **`sa-map-viewer`** (plan [094](docs/plans/094-sa-map-viewer/readme.md),
  [audit](docs/audit/sa-map-viewer-094.md)) — a standalone app that renders the map straight from a folder of
  ORIGINAL SA files, with the debugger's `MapInspector` as a permanent panel, a hand camera, click-to-pick
  and model search. Its first field use bisected the issue it was born from down to a single placement.
- **Unit coverage back up** (plan [077](docs/plans/077-unit-coverage/readme.md)) — the 074 teardown deleted
  heavily unit-tested WebGL code and sank coverage 88.9 → 72.3 %. Recovered to **88.18 %** with a
  device-independent seam: a recording `GPUDevice` stand-in that boots the whole engine headlessly, with no
  engine source touched.

### Fixes

- **A car was born massless, which poisoned the whole physics world**
  ([forensics](docs/open-issues/fixed/map-car-generators-poison-physics.md)). Rapier folds a body's mass
  properties in only at the next `world.step`, and our step updates the raycast vehicle controllers _before_
  stepping the world — so every car spawned between two steps had its first suspension solved against mass 0
  and zero inertia, came back all-NaN, and panicked Rapier inside wasm. A Rust panic never releases
  wasm-bindgen's borrow, so the session then died in whichever innocent reader touched the body set next.
- **Two DFF converter bugs behind one field report** (plan
  [095](docs/plans/095-dff-geometry-parity/readme.md)) — we built triangles from the Geometry Struct face
  array while RenderWare draws the BinMeshPLG index data, and we applied the atomic's own frame transform,
  which `LoadAtomicFile` throws away for a simple map model. Measured over all **13 003 archive DFFs**.
- **Parked cars did not respawn after you left and returned**
  ([forensics](docs/open-issues/fixed/parked-cars-do-not-respawn.md)) — three defects behind one empty lot: a
  car was created past the collision radius and free-fell, its unload distance was then measured from where
  it fell rather than from its placement, and a swallowed `catch` meant none of it could be seen.
- **A total conversion's map was being clipped, striped and deforested** (plan
  [087](docs/plans/087-gostown-field-round/readme.md), the first TC to boot end to end). Three independent
  causes behind three field reports: the pack rect was hardcoded to SA's own extent, so a map that reaches
  further had **95 of its 374 LOD impostors and every HD cell past the edge silently dropped**; the baked
  water depth came out striped, because a TC's lakes sit far above the height grid's cap and the shoreline
  detector read every T-junction in its water grid as a shore; and whole forests vanished at range, because
  they use a stub-HD model whose LOD link IS the content — which the LOD strip deleted as a stand-in
  (`lod-always.json` now names that class per game).
- **Short-fog nights rendered pure black** — SA authors negative timecyc cloud colours, and a NaN in the
  frame UBO poisons WGSL `mix()` even at factor 0.
- **Carcer City's D3D9 texture formats** — a 2026 total conversion ships DXT4 (mis-classed as 16-bit →
  rainbow) and X8R8G8B8 (the unused `X` byte copied as alpha 0 → invisible models).
- **The pre-launch notice is shown every launch**, not once per browser. It is a legal notice, not an
  onboarding step to get past, so the remembered-acceptance flag is gone.

### Documentation

- **[`docs/project-goals.md`](docs/project-goals.md)** — what the project is FOR, written as a gate every
  plan is checked against: honour the authored DATA, do not port the LOGIC, and demonstrate "better" rather
  than assume it.
- New rubrics that keep the record honest: [`docs/restrictions/`](docs/restrictions/README.md) (what a design
  may not do, and whether a violation is caught or silent), [`docs/hacks/`](docs/hacks/README.md) (every
  expedient we knowingly took and what would retire it), [`docs/audit/`](docs/audit/README.md) (what a big
  rework changed, cost and bought), and [`docs/performance/`](docs/performance/README.md) (levers we chose
  NOT to pull, with their price).

## 0.3.0 (2026-07-06)

### Engine (brief, since the Nx migration)

- **Nx monorepo** — the engine split into workspace packages (`renderware`, `game`, `loaders`, `vfs`,
  `viewer`, `web`, `modloader`) + the `tools/` workspace for the pipeline above.
- **Streaming smoothness** — DFF parsing moved to a **worker**, cells are GPU-warmed invisibly and appear
  **atomically** (no more objects assembling on screen); worst frame slices went from ~65–81 ms to ~5–7 ms.
- **World-ready state** — a `streaming` game state freezes the clock/physics behind an opaque loading veil
  (`Loading world… N/M`) on boot and far teleports, revealing only a fully settled world.
- **Fully-open world** — script-gated placement groups are a configured world state (Truth's farm on,
  unlock roadblocks off) instead of leftovers, in parity with the LOD bake.
- **Two-sided world rendering** — honors SA's disable-backface-culling material flag (fixes see-through
  walls/holes on single-sided geometry).
- **Map-baked parked cars** — the binary IPL `CARS` section and CLEO car-generator scripts both feed the
  parked-vehicle spawner.

### Tooling

#### Mod / content installers

- **`mod-installer`** — bakes a numbered Modloader-style mod set into the game copy: file overlays,
  `gta3_img/`/`gta_int_img/` IMG merges, PNG→TXD folders, a **`.merge` data-edit format** (`remove from
"objs":` / `add to "anim":` line edits instead of whole-file overrides), loader-path re-homing, IDE id
  dedupe, and **IPL slot economy** (mod-added instance IPLs fold into a stock host file; internal LOD links
  rebased) so mods never eat SA's 40 IPL slots.
- **`vehicle-installer` / `ped-installer`** — drop-in vehicle packs and ped replacements as pipeline stages.
- **`map-optimizer`** — whole-map **prelight correction**: statistical day/night vertex-colour repair with
  per-neighbourhood verdicts (fixes stock and mod models that are too bright/black at night).

#### Vegetation LOD generators

- **`lod-trees-generator`** — billboard impostors as real far-LODs for every placed tree: baked from the HD
  models (aspect-aware textures, stock prelight + night-colour transfer), attached by editing the stock
  streams/IPLs (repoint or append + link), with a per-area row budget that migrates overflow into its own
  streamed areas.
- **`sa-procobj-placement`** — converts procobj scatter species (bushes, rocks) into **static placements
  with decimated-copy LODs**: QEM-decimated meshes, per-species scoped textures, trunk prelight transfer,
  and the runtime scatter stripped for converted species.
- **Vanilla-style binary-stream placement** (shared `@opensa/map-placement`) — generated placements ship as
  per-area text LOD layers + binary `_stream` IPLs inside `gta3.img`, exactly how the stock map ships 35k+
  instances; short species ship fully binary (zero permanent rows), only tall species keep a text LOD row +
  lod-link for close-range suppression (`linkedHeight`).
- **Scoped texture resolution** (`lod-common`) — LOD textures resolve through each model's own TXD and land
  in shared dictionaries under `<txd>_<name>` scoped names (SA reuses texture names across TXDs with
  different pixels — the global index used to paint the wrong species), plus **alpha-weighted mip
  downsampling** (`rw-codec`) so cutout foliage keeps its silhouette colour.
- **Script-gated group parity** (`opensa-lod-generator`) — the cell bake now includes exactly the binary IPL
  groups the engine loads (`OPEN_SCRIPT_IPL`, single source of truth): mission-locked props (bridge
  roadblocks) no longer get painted into the far LODs.

#### LOD generator

**Added**

- **Visibility-first simplification** (`@opensa/lod-common` shared core, used by `opensa-lod-generator` cell
  bakes and `sa-lod-generator` per-object clones): screen-size / degenerate / transparent-group culls, sampled
  **visibility culling** (deterministic camera raycasts; per-face sidedness, windings never flipped,
  see-through textures don't occlude rays), coplanar remesh with byte-exact boundaries, and **budget-checked
  QEM decimation** — every cell/model proves its own reduction with a render diff or stays verbatim.
- **Measurement harness** — a deterministic CPU rasterizer + pixel diff renders every simplification stage
  against the HD reference from independent cameras: every knob is tuned by number, not by eye; the same
  self-check gates the decimation.
- **LOD texture packaging** — one shared `lods.txd` for all OpenSA cell LODs; SA clone TXDs at 0.25 scale
  (32 px floor) partitioned into a native `txdp` **parent dictionary** (`salodpar.txd` + slim children).
- **Distant night city** — cell LODs carry the source models' 2dfx corona lights (street lamps, casino glow),
  and hour-gated `tobj` objects render correctly at LOD range (lit windows no longer glow at noon).

**Changed**

- **Ground-truth LOD classification** — the cell resolver and the old-LOD strip use the IPL `lod` index
  (per instance) instead of name matching, eliminating coplanar double surfaces (map-wide z-fighting) from
  renamed/underscored LOD twins.
- Engine streaming cell size aligned to the generator grid (250 → 256).

**Effect** (vs the previous verbatim LOD builds, measured on an unmodified map)

- Geometry: **−23 % triangles / −43 % encoded indices** at ≈ 0.2 % mean visual diff.
- Textures: **−82 %** for OpenSA cells (~88 MB → 16 MB) and **−91 %** for SA clones (114.8 MB → 10.4 MB).
- Plus distant corona lights the stock far view never had, correct day/night `tobj` windows, and LOD
  z-fighting cleaned up at its source.

#### Perfect-map builder (new)

- **`perfect-map-builder`** — one command turns a clean game copy + a curated `mods-src/` into two complete
  builds: **`sa/`** (drop-in for the real game) and **`opensa/`** (engine target with baked cell LODs). It
  chains every map tool as pipeline stages (mods → vehicles → peds → optimize → trees → procobj → sa/opensa),
  each stage producing a full bootable game dir (`--until <stage>` keeps intermediates for in-game bisection).
- **SA-limit guards baked into the build** — the pipeline fails loudly (instead of corrupting the game
  silently) when the output exceeds stock SA 1.0 placement limits: ≤ 4096 rows per area at boot, ≤ 39 text
  IPLs with instances, **≤ 30,000 permanent text instances map-wide** (SA stores building-pool indexes as
  `int16` — the "ghost barriers" corruption, bisected in-game to exactly 32,768; see
  `docs/open-issues/ghost-barriers.md` for the full post-mortem).

## 0.2.0 (2026-06-23)

### Added

- **Multi-game runtime catalogue** — `GAME_CONFIG` (`src/game-config.tsx`) replaces the single-game `.env`
  setup: the menu lists every game and you pick one at runtime, each with its own loader, world/player setup,
  parked vehicles, teleports, and a disclaimer remembered per game.
- **Pluggable asset loaders** — a `fetch` loader (download content-hashed chunk archives) and a new **local
  raw-install loader**: point the app at your own GTA install folder via the File System Access API; nothing
  is uploaded, files are read locally in the browser (bring-your-own-files).
- **Locked / anti-rip model support** — recover protected (encrypted) DFF/TXD so community mod models load.
- **Mobile / touch controls** — on-screen move & look joysticks, jump, and pinch-zoom.
- **Branding** — new OpenSA logo, a full favicon set + web manifest, and a social-share (`og.jpg`) image.

### Changed

- **Repositioned as a RenderWare-compatible game engine** — README, blog, docs, package metadata and the
  in-app tagline now lead with the engine (compatible with RenderWare; runs GTA San Andreas and its mods)
  rather than "GTA San Andreas in the browser".
- **Boot flow is menu-first** — nothing downloads until a game is picked; a single loading screen pulls all
  groups; removed the eager pre-menu core download and the first-visit intro animation.
- **Cache management reworked** — per-build-version Cache Storage with a fallback strategy; a revoked build
  (a missing `data` probe **or** `manifest.json`) wipes the client cache.
- **Unified player spawn** — a single `playerSpawn` per game seeds both the capsule and the initial collision
  zone.
- **Input refactored** into pluggable sources (keyboard / pointer / touch).
- **Debugger** — the Position tab (live coords + city) is always available; teleport lists are per-game.

### Fixed

- Custom-ped **root-bone offset** — peds whose `Root` frame is authored off-origin (some mods) no longer
  render off-centre or orbit the pivot when turning.
- Character **material issues** and animation retargeting on custom / renamed-skeleton models.

### Removed

- **All bundled game assets** — dropped the committed player model and other assets; the project ships **no
  game files**, you supply your own copy. Test fixtures use local, gitignored real assets.

### Legal & safety

- Added a **Legal & takedowns** section (README) and an in-app disclaimer with a rights-holder contact.

## 0.1.0 (2026-06-18)

### Added

- **Engine / renderer** — from-scratch RenderWare pipeline: DFF (models) and TXD (textures) parsers, COL
  collision, IMG archive reader, and IPL/IDE world streaming with LOD swap, frustum culling, and fog-tied
  draw distance.
- **Physics & player** — Rapier-backed player controller (walk / run / jump, grounded state), follow camera
  with mouse look, and a K+M free-fly screenshot camera.
- **Character** — skinned ped with `ped.ifp` animations driven by a movement state machine.
- **Vehicles** — loader with embedded collision, full dummy framework (doors / headlights / seats), enter &
  exit with door animation, physics + basic controls, damage (ramming + struck), VLO, and car2/car4 carcols.
- **World content** — water surface + shader, game time and timecyc (sunny, normalized to 24h), weather
  manager with `map.zon` zone detection, districts via `info.zon` + GXT, teleports, animated map objects
  (UV + DFF), procedural ground clutter (procobj), road-sign text (2dfx), basic world effects, particles,
  and breakable objects, night-time objects (tobj), and vehicle headlights + reflections.
- **Graphics** — lighting, shadows, sky/skybox with volumetric clouds, fog, god rays, bloom, SSAO, and ACES
  tone mapping.
- **Build & delivery** — game-build archives split into priority / models / textures, repacked into ~50 MB
  content-hashed chunks; an asset **loader** (on-demand download, Cache Storage caching, invalidation,
  progress events) and a **Virtual File System** (unzip + serve) that the game reads everything through.
- **UI shell** — instant-loading React shell with a branded intro animation, menu, disclaimer, error/retry,
  Esc pause menu, lazy-loaded game, an in-game F2 tip, fullscreen + mouse capture (pointer lock), and opt-in
  analytics.
- **Tooling** — F2 in-game debugger (map viewer, spawn / flip / teleport, live tuning), standalone
  object/vehicle/character viewers, a logger, and offline debug scripts.
- **Project** — docs (getting-started, dev docs, per-feature reference), a repo blog, and contribution guide.

### Changed

- Renamed the project to **OpenSA**.
- Assets are sourced from `game-src/<game>/` and shipped as built archives under `static/`; at runtime the
  game reads from the VFS instead of fetching loose files.

### Fixed

- Truth's Farm (Countryside) rendering.
- Vehicle windscreen alpha-channel bug.
- Water flooding tunnels across the map.
- Shadow acne on small objects.
- Streaming "blinking" during LOD <-> HD swaps.
