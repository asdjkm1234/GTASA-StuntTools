# 094 — sa-map-viewer: a standalone map viewer over ORIGINAL SA files + model search in the debugger

**Status: IN PROGRESS — phase 0 SHIPPED 2026-07-29, phases 1–6 open.**

Born from the beach blue-strip investigation
([`docs/open-issues/fixed/mod-dff-winding-and-atomic-frame.md`](../../open-issues/fixed/mod-dff-winding-and-atomic-frame.md)): the lab loop there
A/Bs *pak builds*, which means every probe costs a repack and every camera was an orbit whose phase
drifted per run (one whole bisect was invalidated by that). What the investigation actually needs is
a viewer that renders the map **straight from a folder of original GTA SA files** — point it at
`game-src/original` (vanilla), at the merged build tree, or at any experiment folder, and see the
same area with a **deterministic camera**, no repack in the loop.

## What is being built (the spec)

1. **`apps/sa-map-viewer`** — a standalone browser app:
   - at startup the user picks the game folder to load (or passes a served dir via query param);
   - the camera hovers top-down over the map; by default only the cell under the camera renders;
     default position is the map centre, overridable by coordinates in query params;
   - a **permanent left panel** — the debugger's map-viewer UI as ONE always-open section (no
     close/toggle): the cell checkbox grid, the whole-map toggle, LOD mode, object selection;
   - **model search**: a text field with autocomplete over model names; picking a result centres
     the camera on the model and activates its cell if it is not active.
2. **The same search lands in the opensa debugger** (`apps/web`, F2 → Map): when the map viewer is
   active, a search field with autocomplete centres on the named object and activates its cell.

## Restrictions check (`docs/restrictions/`, read 2026-07-29)

- **Layer tags** (`architecture.md`): the app is `type:app`; `type:app` may depend on `type:app` and
  `type:engine` (`eslint.config.ts:289`) — so it may import `@opensa/renderware` / `loaders` / `vfs` /
  `engine` / `engine-formats` (all `type:engine`) and reuse `apps/web` debugger UI directly. Caught
  by ESLint. **It may NOT import a `tool:`** — `type:app → type:tool` is not in the allow list, so
  the browser weld (below) must not reach into `tools/opensa-pack`; the Node-free weld pieces it
  needs must be used via an allowed home (see Phase 1's boundary note).
- **One cell size = 250** (`architecture.md`): the viewer buckets instances itself
  (`buildWorldGrid`) — it must use the same 250 as the four agreeing places, or its cell grid stops
  matching the debugger's and every cross-tool cell coordinate conversation breaks. SILENT — pin it
  with a constant imported from the same source the web host uses.
- **Mods are installed, never overlaid** (`build-vs-runtime.md`): not violated — this is a debug
  viewer over whatever folder it is given, not a game-runtime overlay; nothing it does feeds the
  game. It is, deliberately, the "run the converter where the files are" shape the modloader
  postmortem names as the honest one — for diagnosis, not for play.
- **Vehicles exist only as `.osm`** (`build-vs-runtime.md`): irrelevant — map objects only, no
  vehicles/peds in scope.
- **A field run reads the built dir and nothing else** (CLAUDE.md): this tool's whole point is
  reading arbitrary folders, so every capture/screenshot from it must be SELF-DESCRIBING — the app
  overlays (and logs) which folder/URL it loaded, so an A/B can never silently compare two sources.

## What already exists (verified in-repo; do not rebuild)

- **Folder → filesystem**: `browserInstallSource(dir)` (File System Access picker,
  `packages/loaders/src/asset-local-loader/install-source.ts:16`) and the served-dir twin
  (`fetch-install-source.ts` + `scripts/serve-static.ts`, `?loader=http-dir&src=` pattern in
  `apps/web/src/ui/shell/use-asset-boot.ts:62`); lazy VER2 IMG reading (`img-reader.ts:37`) so a
  ~1 GB `gta3.img` costs only its directory.
- **Parsers**: every SA format parser in `packages/renderware` is env-agnostic
  (ArrayBuffer/text in, zero `node:*`) — IMG, DFF, TXD, COL, IPL text+binary, IDE, gta.dat,
  timecyc, water.
- **Map resolve at runtime, already browser-proven**: `resolveMap(fs)`
  (`packages/renderware/src/map/resolve-map.ts:51`; authoritative LOD marking via IPL lod-index
  targets, `markLodTargets:141`), `buildWorldGrid(defs, 250)` (`map/world-grid.ts:38`),
  `cellGroups` (`map/cell-groups.ts:32`) — all called today by `GtaSaWorldAdapter.prepare()`.
- **Originals → engine cell bytes, no pak**: the weld core is Node-free (`weldCellParts` /
  `assembleCell` in `tools/opensa-pack/src/weld.ts`, `TexturePlanner` in `textures.ts`), and
  `apps/engine-lab/src/synthetic.ts` proves the in-memory feed: `encodeOscell`/`encodeOstex`
  (`packages/engine-formats`) → `engine.cells.load` / `engine.textures.load` directly.
- **The debugger map-viewer UI is already a reusable component**: `MapInspector`
  (`apps/web/src/ui/debug/map-inspector.tsx`) renders the cell grid / whole-map / LOD mode /
  selection panel against a small renderer-agnostic `MapGame` interface (`map-inspector.tsx:15`) —
  implement that interface and the whole panel comes for free, styled by `debug-styles.ts`.
- **Picking**: `.oscell` minor 6 carries the per-cell placement name table
  (`weld.ts` `buildPlacementTable`); `engine.cells.debugPicking` + `cells.pick()` + the `select`
  event drive the existing selection panel.
- **The autocomplete pattern**: the Vehicles screen's filter box + list
  (`apps/web/src/ui/debug/debug-overlay.tsx`, `VehicleScreen`).
- **The full name index for the in-game search**: `GtaSaWorldAdapter` holds `MapDefinitions`
  (`catalog` by id, `defByName`, every `IplInstance` with position) — already constructed in the
  same `engine-canvas-host.tsx` closure where `mapGame` is built; nothing surfaces it yet.

## Design decisions

1. **Render path = weld in the browser**, not per-instance rigid uploads. Per-instance
   `createVehicleModel` works today but is one draw per instance — the draw-call wall
   (~4.4 µs/draw) is the very reason the pak/weld design exists, and the whole-map toggle would die
   on it. Welding also buys picking (the placement name table) and makes the viewer render through
   the SAME cell path as the game — what it shows is what the game would show for these files.
   Skips: AO/sun-vis bakes off (`ConvertOptions`), no `.oswire`/zlib (raw bytes straight to
   `cells.load`), no water pass at first.
2. **Own tiny manual-cells driver** implementing `MapGame` (weld-on-demand + cache + unload):
   `listCells()` from the world grid, `setManualCells()` welds/loads missing cells and unloads
   deselected ones. No `StreamingDriver`, no rings, no pak.
3. **UI is imported from `apps/web`, not copied**: `MapInspector` + `debug-styles` (app→app is
   legal). The shell renders it as a fixed, non-closable left panel — one section, no F2, no menu.
4. **The debugger map-viewer camera, interactively; deterministic when scripted.** The hand
   camera is EXACTLY the in-game map viewer's: open with `snapTopDown` over the focus
   (`TOP_DOWN_HEIGHT` 400, `TOP_DOWN_PITCH`), then left-drag pans, right-drag orbits/tilts, wheel
   dollies (`fly-rig.ts` — reused, not copied) — a pure vertical view makes objects impossible to
   tell apart, the tilt is what makes selection workable (user requirement). Determinism is about
   SCRIPTED shots, not about forbidding tilt: `?at=x,y` (GTA coords; default map centre `0,0`),
   `?h=` height, optional `?pitch=`/`?yaw=` fully specify the pose, and the camera NEVER moves on
   its own (no animated orbit — the blue-strip bisect was invalidated by orbit phase drift). Same
   params in → same pixels out; `?src=<url>` (served dir) makes it drivable by the headless
   harness.
5. **Search index from `MapDefinitions`**: catalog names + instances (name → placements).
   Autocomplete = case-insensitive substring over the catalog (tens of thousands of names — plain
   in-memory filter, no index structure). Centring picks the instance nearest the current camera
   (a name can be placed many times); repeated Enter cycles through the placements.
6. **Debugger half via the existing contract**: extend `MapGame` with optional
   `searchModels(query): { name, count }[]` and `focusModel(name): CellCoord | null` (centres the
   fly camera on the nearest placement, returns its cell so `MapInspector` adds it to the manual
   set). Host implementation over the adapter's `MapDefinitions`; both apps then share the same
   search UI component.

Not merged into `apps/viewer`: that app is plain-DOM, fed by the Node compare server, per-asset.
This one is React (debugger UI reuse), folder-fed, world-scale. User decision: a separate app.

## Phases (each lands with its measured numbers written back here)

- **Phase 0 — scaffold + resolve. DONE 2026-07-29.** App skeleton (root-vite input
  `sa-map-viewer.html`, excluded from `build:prod` like `viewer.html`; `nx.tags: ['type:app']`);
  source screen: FSA folder picker + `?src=` served-dir; assemble the `AssetFileSystem`; run
  `resolveMap` + `buildWorldGrid(250)`. On screen: source name, instance/cell counts. *Verify:*
  counts for `game-src/original` logged here; boundary lint green.

  **What shipped.** `apps/sa-map-viewer/` (4 source files): `source/map-source.ts` opens a source
  and resolves it, `source/use-map-source.ts` drives the phases, `ui/source-panel.tsx` +
  `app.tsx` render the readout. Both ways in reuse the GAME's own install loaders — so what the
  viewer reads is what the game reads: `AssetHttpDirLoader` for `?src=`, `AssetLocalLoader` for the
  picker (with `acquireDir`/`restoreDir` injected, so the picker never touches the game's
  remembered-install store — this tool swaps sources constantly). Only the `data` + `others` groups
  are ingested: gta.dat/IDE/IPL is all `resolveMap` needs, so opening a source costs **no model or
  texture bytes**. The panel is the debugger's own `styles` (a one-line `exports` entry added to
  `apps/web/package.json` — the sanctioned "tiny export tweak"), so phase 2's `MapInspector` will
  drop in under it unchanged. `scripts/serve-static.ts` gained a **`/game-src` mount** next to
  `/build` (both now table-driven, both with `__index`) — without it the vanilla half of the A/B was
  not reachable over `?src=` at all.

  **Measured (2026-07-29, headless Chromium 1440×900, dev server; `?src=` path):**

  | source | instances | cells @250 | hd / lod | models | resolve |
  | --- | --- | --- | --- | --- | --- |
  | `game-src/original` (vanilla) | 50 849 | 562 | 39 128 / 6 187 | 14 098 | **1 144 ms** |
  | `build/original/opensa` (merged build) | 84 344 | 570 | 62 616 / 16 159 | 14 908 | **2 806 ms** |

  The two columns ARE the blue-strip A/B pair, and they already say something: the merged tree
  carries +33 495 instances (+66 %) and 2.6× the LOD layer (the generated `lods.ipl` cell-LODs),
  over 8 more cells. `hd + lod < instances` in both rows — the remainder is interiors plus
  instances with no catalog def, which `buildWorldGrid` drops by design.
  *Not a benchmarks-folder entry:* these are tool load times, not frame cost — neither family in
  `docs/benchmarks/README.md` takes them, so the plan doc is their home.

  **Verified:** `tsc --noEmit` clean, `eslint` clean on the new app (boundary lint included — the
  app imports `type:engine` packages + `@opensa/web` only), both sources loaded end-to-end headless.
  **NOT verified:** the FSA folder-picker path — the native picker cannot be driven headlessly. Its
  loader is the game's own, but the click needs one manual run.
- **Phase 1 — first cell renders.** Browser weld of one cell (planner → `encodeOstex`, weld →
  `encodeOscell`) → `engine.cells.load`; the map-viewer camera (decision 4: `snapTopDown` opening
  pose, pan/orbit/dolly by hand, `?at`/`?h`/`?pitch`/`?yaw` for scripted poses; the source-folder
  caption baked into the canvas overlay). **Boundary note:** the weld core sits in
  `tools/opensa-pack` (`type:tool`) which an app may not import — moving the Node-free weld/planner
  modules into an engine-tagged package (or an `engine-formats` sibling) is part of THIS phase, as
  a move-only refactor with opensa-pack re-importing from the new home. *Verify:* screenshot of a
  known cell vs the same cell in-game; weld time + texture bytes for one cell recorded here.

  **DONE 2026-07-29.** The cell under the camera renders, welded in the browser.

  **The move.** `weld.ts`, `textures.ts`, `alpha.ts`, `ostex-payload.ts` + their four test files went
  from `tools/opensa-pack/src/` to the new **`packages/cell-weld`** (`type:engine`, code unchanged);
  opensa-pack imports them back through `@opensa/cell-weld/*`. `CELL_SIZE` moved with them into
  `cell-size.ts` — it now has ONE declaration that both the tool and the app import, which is what the
  restriction asked for (`docs/restrictions/architecture.md` updated). Nothing else changed: 375 test
  files / 3 137 tests pass, and coverage came out **90.97 / 81.81 / 92.42 / 90.94** against floors of
  86 / 77 / 88 / 86 — it ROSE, because 2 000 lines of well-tested code joined the `packages/**`
  coverage set.

  **The loading design changed under the phase, and it matters.** Phase 0 ingested only the world
  files; welding needs the actual DFFs and TXDs, and reading the whole placed set (≈13 000 models over
  Range requests) would have put minutes between picking a folder and seeing it. So `AssetStore`
  resolves a cell's model names (`cellModelNames`) → the install's archive entries → reads only those,
  plus each model's TXD **and its whole `txdp` parent chain**. One cell costs ~11 MB, not a gigabyte.
  This needed four exports opened up on `@opensa/loaders` (`browserInstallSource`,
  `selectInstallEntries`, `readEntry`, `InstallPlan`) — no logic moved.

  **Measured** (headless Chromium 1440×900, `game-src/original`, cell **9,−7** = Grove Street):

  | step | number |
  | --- | --- |
  | model + texture bytes read for the cell | **11.5 MB in 82 ms** |
  | weld (browser) | **179–201 ms** |
  | texture arrays built + uploaded | **21 arrays / 11.5 MB in 8 ms** |
  | cell geometry | 92 194 verts / **58 118 tris**, `.oscell` 3 970 KB |
  | steady frame rate | 120 fps (vsync) |

  **The browser weld IS the converter's weld** — the same cell welded offline through
  `openGameDir` + `weldCell` gives **58 118 tris / 21 arrays / 11.5 MB / 226 ms**, matching the
  browser exactly. That is the phase's real verification: not "it looks right", but "this tool's
  geometry is the converter's geometry, on the same inputs".

  **Determinism, proven not asserted.** Two runs of the same URL were first compared and did NOT
  match — mean Δ 0.02/255, but max Δ 114/255, and the difference map showed the deltas sitting
  exactly on the trees. Vegetation **wind sway** is the only thing in a noon frame that moves on its
  own. Wind is now **off by default** (`?wind=N` brings it back), and two runs of the same URL are
  now **byte-identical PNGs**. `?panel=0` hides the live-fps chrome for captures while keeping the
  source caption, so the A/B compares pixels, not a frame counter.

  **Two deviations from the written plan, both deliberate:**
  - **Default `?at` is the loaded map's own occupied-cell centre, not GTA `0,0`.** GTA 0,0 is open
    water; more importantly a total conversion's world need not sit near the origin, and a hardcoded
    centre is exactly the kind of asset-specific constant the standing rules forbid.
  - **The camera orbits the ground point, not the eye.** Verbatim eye-centric fly-rig tilt swings a
    400 u eye to the horizon and drops the inspected cell off screen, which would have made
    selection (phase 3) unusable — the user's stated reason for wanting the tilt at all. Pan, dolly
    and the top-down opening pose are still fly-rig's own functions. Default yaw is 180°, which is
    what puts north up and east right; at yaw 0 the top-down basis reads as a half-turn of every map
    anyone would compare against.

  **Which trees this viewer is FOR (user directive, confirmed here by measurement).** It reads
  **SA-native** dirs — `game-src/<game>`, pmb's `sa` target (`build/<game>/sa`, `pipeline.ts:221`),
  `build/salod` — because the OpenSA target already has a map viewer: the in-game debugger's.
  Measured: `build/original/opensa` carries **8 779 `.osm` and only 538 `.dff`** (vanilla:
  **12 964 `.dff`**, 0 `.osm`), so a converted dir resolves its map fine (phase 0's 84 344
  instances) and then welds empty — the geometry the welder reads is not there any more. That is
  scope, not a defect; the app now SAYS so instead of showing an empty screen.

  So the A/B pairs are SA-format against SA-format. `build/<game>/sa` does not exist on this machine
  yet (`npm run build:game:original:sa` produces it); what does exist is **`build/salod`** —
  vanilla plus the generated cell LODs (`lods.img`/`lodsn.img`, `lods.ide`/`lods.ipl` appended to
  `gta.dat`) with map-optimizer's `smooth-normals` applied. It welds: 51 412 instances, and cell
  9,−7 comes out **114 395 verts / 56 744 tris** against vanilla's **92 194 / 58 118** — a real
  content difference the tool surfaced on its first A/B, worth a look of its own.

  The pairing also sharpens what a bisect can conclude, because the viewer runs the pack's own weld
  but NOT its bakes:
  - strip visible from `game-src/original` ⇒ it is in vanilla data, the weld, or the engine;
  - visible from the merged SA tree but not vanilla ⇒ a mod or a map-optimizer pass put it there;
  - visible in the game but in NEITHER viewer source ⇒ it comes from what the viewer skips — the
    AO / sun-vis bakes, the `.oswire` layer, or streaming — which is itself a strong narrowing.
- **Phase 2 — the permanent panel.** `MapGame` driver (manual cells, weld cache, unload);
  `MapInspector` mounted as the fixed left panel; whole-map toggle and LOD mode working. Whole-map
  HD is allowed to be slow/heavy — it logs progress and its cost gets measured, not hidden.
  *Verify:* toggling cells loads/unloads; numbers: per-cell weld ms (median/worst), whole-map
  LOD-mode total time + memory.

  **DONE 2026-07-29.** `MapInspector` is imported from `apps/web` and mounted as one always-open
  section of the panel — the cell grid with its region colours, "Whole map", "Show LODs" and the
  SELECTED block, none of it re-written. `ViewerMapGame` implements the `MapGame` interface
  (`cellSize`/`listCells`/`setManualCells`/`setMapViewer`/`viewCell` + an `EventBus`) and queues
  sets so one arriving mid-weld replaces the queued one instead of interleaving.

  **The inspector OWNS the cell set — phase 1's camera-follow is gone.** It seeds itself from
  `viewCell()` at mount, so the viewer still opens on exactly the cell `?at` names, and after that
  the grid is the control. Two owners of one cell set is how a debug tool starts lying about what it
  is showing.

  **Weld cache + the array-growth rule.** One `TexturePlanner` lives for the session, and welded
  `.oscell` bytes are cached per cell: the plan is append-only and deterministic, so a texture keeps
  the layer index its first use gave it and older bytes stay valid as later cells extend the plan.
  What is NOT stable is the GPU side — a texture array that gains layers must be re-uploaded, and
  every render bundle recorded against the old one dies with it. So `syncTextures` reports whether
  any array grew and, when one did, every resident cell is re-created **from the cache, not
  re-welded**. That is the difference between a 10 ms re-upload and a 200 ms re-weld per cell.

  **Measured** (headless Chromium 1440×900, `game-src/original`, `?at=0,0&h=4000`):

  | action | wall | welds | source read | textures | geometry |
  | --- | --- | --- | --- | --- | --- |
  | Whole map, **LOD** | **3.0 s** | 561 in 539 ms — median **1 ms**, worst **17 ms** | 55.2 MB in 2.2 s | 59 arrays / 21.0 MB | 559 cells · 622 926 tris |
  | Whole map, **HD** | **15.3 s** | 561 in 8 327 ms — median **10 ms**, worst **149 ms** | 648.0 MB in 6.5 s | 81 arrays / 227.4 MB | 562 cells · 8 264 544 tris |
  | Whole map **off** | 0.0–0.2 s | — | — | arrays stay resident | **0 cells** |
  | one cell (9,−7) HD | 0.3 s | 1 — 188 ms | 11.5 MB in 124 ms | 21 arrays / 11.5 MB | 58 118 tris |

  So the whole of San Andreas welds in the browser in **15 s** and draws at 57–62 fps; the median
  cell is 10 ms and the worst is 149 ms, i.e. the 188 ms Grove Street cell of phase 1 is near the top
  of the distribution, not typical. Unloading returns residency to zero (the texture plan and the
  weld cache deliberately survive — re-selecting a cell is then instant). **`performance.memory` is
  useless here**: it read a flat 386 MB before, during and after the whole-map load in every run, so
  the residency numbers above (source bytes, `.ostex` bytes, vertex counts) are the memory record.

  **A fog finding, and the second knob turned off by default.** The first whole-map capture came back
  as an EMPTY canvas at 53 fps. The engine culls any cell lying entirely past `fogCutDistance`
  (2 400 by default) — and a whole-map pose puts the eye ~4 km up, so every cell was culled. Fog is
  now pushed out to the far plane by default (`?fog=1` restores the game's noon fog). Same principle
  as wind: an inspector may not hide its subject.

  `scripts/debug/map-viewer-shot.ts` is now a KEPT script (row in `docs/debug/README.md`): one
  scripted pose captured headless, `panel=0` added automatically, the viewer's own load lines echoed.
- **Phase 3 — picking.** Weld writes the placement table; `debugPicking` on; click → `select` →
  the existing info panel (model/txd/pos); hide/restore via `CellStore.hidePlacement` if free.
  *Verify:* clicking a named blue-strip neighbour (`bealantr02_law2`) reports the right name.

  **DONE 2026-07-29, and the verification landed on the nose.** `engine.cells.debugPicking` is on
  from boot — in the game it is viewer-only because the mapper plus retained index bytes cost tens of
  MB on a full map, but this app IS that viewer, and the flag only takes effect on the NEXT cell
  load, so it has to be set before the first one. `ViewerMapGame` gained `pickAt(ndc, aspect)`
  (cursor ray → `CellStore.pick` → `select` with the position converted back to GTA coords),
  `hideSelectedObject` and `restoreHiddenObjects`; the inspector's SELECTED block and its two buttons
  were already wired to exactly those, so no UI was written.

  Two details that decide whether it feels right:
  - **The cursor is the aim, not the view forward.** `cursorRay` (the debugger's own) is fed the NDC
    of the click. A forward-vector pick would report whatever sits at screen centre — wrong in a
    tool where you point at things.
  - **The same left button pans AND picks**, so a press is a click only if it travelled ≤ 4 px
    (`CLICK_SLOP`). Without that, every pan would end by deselecting.

  Restoring is a `CellRenderer.reload()`: `hidePlacement` degenerates indices in the GPU buffer in
  place and has no inverse, so the way back is a fresh load of the same cached bytes — the upload,
  not the weld.

  **Measured** (headless, `game-src/original`, `?at=136,-1715&h=120` — the blue-strip spot; cell
  0,−7 welds in 51 ms, 11 543 tris):

  | click | reported |
  | --- | --- |
  | centre | **`bealantr02_law2`** · txd `beacliff_law2` · pos **136.0, −1714.6, 10.9** |
  | +0.05, −0.05 | `tree_hipoly11` · `gtatreesh` · 155.6, −1717.3, 21.0 |
  | −0.1, −0.1 | `tree_hipoly19` · `gtatreesh` · 111.6, −1719.1, 24.8 |
  | −0, −0.15 | `veg_palm04` · `gta_tree_palm` · 131.9, −1698.9, 37.1 |

  The plan asked for `bealantr02_law2` at that spot and that is what the centre click reports, with a
  position 0.4 m off the requested `at` — i.e. the ray, the mapper bounds and the GTA↔engine
  conversion all agree. `Hide object` then removed the palm's crown (trunk still standing in the
  capture — the placement's triangles, nothing else), the panel showed `hidden: 1`, and
  `Restore all` brought it back.
- **Phase 4 — model search in sa-map-viewer.** Search field + autocomplete + centre&activate
  (decision 5); the search UI built as a shared component ready for the debugger half.
  *Verify:* searching `bealantr02` centres on (136,-1715) and activates its cell.

  **DONE 2026-07-30.** Three pieces, split exactly along the line phase 5 will need:
  `ModelIndex` (`packages/renderware/src/map/model-search.ts`) is the pure half — build over the map's
  PLACED instances, substring search, and the focus cursor; `ModelSearch`
  (`apps/web/src/ui/debug/model-search.tsx`) is the shared UI; `MapGame` gained the two optional members
  from decision 6 (`searchModels` / `focusModel`), and `MapInspector` renders the FIND MODEL block only
  when a host implements both — so the in-game debugger is unchanged until phase 5 fills them in. The
  viewer host implements them over `map.defs` (index built lazily on the first search) plus one new
  camera method, `lookAtGta`.

  Three decisions the field run settled:
  - **The index is built over PLACED instances, not the IDE catalog.** A catalog name with no instance
    cannot be centred on, so offering it would fill the autocomplete with rows that do nothing. Counts
    come free from the same map (`tree_hipoly11 · 30`), and the row shows the CATALOG's spelling —
    typing `bealantr02` answers `BeaLanTr02_LAw2`, which is how the IDE writes it and how every other
    tool will print it.
  - **A jump does not touch the pose.** Only the looked-at point moves; height, pitch and yaw stay. A
    search from the whole-map height therefore lands you 4 km above the model rather than diving —
    deliberate: the alternative (descend to a "good" height) is a magic constant, and this tool's whole
    contract is that `?at`/`?h` describe the pixels. The focus also stays on the y = 0 plane rather than
    lifting to the placement's z, or the printed `h` would stop meaning the height it round-trips as.
  - **Repeated Enter cycles the placements, and the order is FROZEN at the first jump.** Ordering by
    distance from the camera on every press would rank the placement you just flew to as nearest and
    never move again.

  **Measured** (headless Chromium 1440×900, `game-src/original` — 50 849 instances, 14 098 catalog
  names, resolve 851–945 ms):

  | action | result |
  | --- | --- |
  | type `bealantr02` | **22 ms** keystroke→rows, 1 row: `BeaLanTr02_LAw2 · 1` |
  | Enter | camera **137, −1712**, note `centred · cell 0, −7`, that cell welded in **54 ms** |
  | type `a` / `lod_` | **30 / 24 ms** keystroke→rows, 20 rows + the `first 20 matches — refine` line |
  | `tree_hipoly11` (30 placements) ×3 Enter | 350,−772 (cell 1,−4) → 355,−827 (same cell, no weld) → 587,−1300 (cell 2,−6, welded 73 ms) |

  So the plan's verify lands: `bealantr02` centres on the placement the blue-strip work names (137, −1712
  — the instance's own position, 0.4 m from the `?at` phase 3 used) and activates cell 0,−7. A plain scan
  over 14 098 names costs **under 30 ms including the React render and the first-search index build**,
  which is decision 5's "no index structure" answered with a number. Cells ACCUMULATE across jumps (the
  inspector's checkbox set is still the owner — the third jump left 3 cells resident); unchecking is how
  they go, and that is the same rule the grid has always had.

  Tests: 13 over `ModelIndex` (both empty-query and unplaced-name paths, the cap, prefix-before-substring
  ranking, catalog spelling, cycling incl. the frozen order and the wrap) + one over `lookAtGta` (the
  pose is untouched).
- **Phase 5 — model search in the opensa debugger.** `MapGame.searchModels`/`focusModel` host
  implementation over `GtaSaWorldAdapter`'s defs; the shared search field rendered in the Map
  screen when the viewer is active. *Verify:* in-game F2 → Map → search a model → camera centres,
  cell activates. Docs: `docs/development/in-game-tools.md` updated in the same change.

  **DONE 2026-07-30, and it cost three edits.** `GtaSaWorldAdapter.modelIndex()` builds the SAME
  `ModelIndex` phase 4 defined, over the `MapDefinitions` the adapter already resolved — so a name the
  debugger finds is a name this world places, mods included. The host implements the two `MapGame`
  members over it, and no UI was written: `MapInspector` already renders FIND MODEL for any host that
  has both. **The engine build carries the full IDE/IPL defs at runtime** (the pak did not have to be
  taught anything), which is the only reason this phase is small.

  **The jump had to be re-expressed for the game's rig.** The standalone viewer orbits a focus POINT, so
  centring is one assignment; the game's map camera is a detached EYE with a yaw/pitch. `lookAtStep`
  (in `fly-rig.ts`, next to `panStep`/`dollyStep`) intersects the view with the target's height plane and
  slides the eye by exactly the miss — height and orientation untouched, which is the same rule phase 4
  set. It returns `null` for a level or upward view, where the caller falls back to `snapTopDown`: there
  is no sane sideways slide then, and the alternative would fling the eye kilometres away to satisfy a
  nearly-parallel ray.

  **Measured** (headless Chromium 1440×900, the real game on `build/original/opensa`, `?loader=http-dir`,
  player at Ganton 2492,−1678, night 22:14):

  | action | result |
  | --- | --- |
  | type `bealantr02` | **8–34 ms** keystroke→rows over four runs (one 447 ms outlier while cells were still streaming), 1 row `BeaLanTr02_LAw2 · 1` |
  | Enter | `centred · cell 0, −7`, that section pinned and rendered |
  | **centre pick after the jump** | **`bealantr02_law2`** · txd `beacliff_law2` · pos **136.0, −1714.6, 10.9** |
  | `tree_hipoly11` (30 placements) | rows `tree_hipoly11 · 30` + `lodtree_hipoly11 · 30`; Enter → cell 8,−1 (the nearest to Ganton), Enter again → cell 3,−5, centre pick reports `tree_hipoly11` at 777.1, −1207.3, 37.7 (cell 3,−5 ✓) |

  The centre pick is the proof, and it is the same triple phase 3 recorded in the standalone viewer:
  after the jump the object under the crosshair IS the searched model, so the eye slide, the GTA↔engine
  conversion and the cell arithmetic all agree in the game too. Ordering is by distance from the CAMERA
  (the fly eye when detached), which is why a search for a countryside tree from Ganton opens on cell
  8,−1 rather than on the first one in the file.

  Verification trap worth keeping: the pointer-lock prompt ("CLICK TO PLAY") sits on the centre pixel and
  React puts it straight back when removed, so a scripted centre click can never reach the canvas — the
  check had to dispatch synthetic pointer events at the canvas instead.

  Tests: `lookAtStep` (refuses level/upward views and a target above the eye; a straight-down view lands
  exactly over the target; a 45° view slides by the miss and keeps its height) + `modelIndex()` (null
  before `prepare`, searches the resolved defs after, and is built once).
- **Phase 6 — field use + close-out.** Apply to the blue strip: load vanilla `game-src` vs the
  merged tree at `?at=150,-1700` and pixel-A/B the strip area — the first real bisect this tool
  exists for. Docs in the same change: `docs/commands.md` (launch), `docs/architecture` module map
  (new app), this plan's numbers complete.

  **DONE 2026-07-30.** The A/B needed a merged tree in SA format, which no build on this machine had
  (`build/original/opensa` is converted, `build/salod` is `game: non-modified`), so one was made with
  `pmb --game ./game-src/original --in ./mods-src/original --out ./build/strip-ab --until mods` — the
  mods stage alone, 59 mods, ~4 min, 1.8 GB, moved out of `.work/1-mods` to `build/strip-ab/mods`
  because sirv will not serve a dot-directory.

  **The first thing the field use found was a defect in the tool.** `?panel=0` hides the panel, and
  since phase 2 the panel's inspector OWNS the cell set — so every scripted capture rendered an EMPTY
  world (the phase 2/3 numbers were taken with the panel up, which is why it had not shown). Capture
  mode now seeds the set itself: `?cells=1` (default, the cell under `?at`), `?cells=all`, `?lod=1`.

  **The bisect** (both trees, `?at=150,-1700&h=150`, one cell each — vanilla 11 543 tris / merged
  10 019):

  | probe | result |
  | --- | --- |
  | click on the strip area, vanilla | `roads32_law2` · `law2_roadsb` · 245.2, −1736.7, 3.6 |
  | **`Hide object` on it, vanilla** | the picture becomes the MERGED one — same flat blue, same sharp polygon edge, props still floating |
  | `Hide object` on it, merged | crop diff **mean 0.013** — it was contributing no pixels at all |
  | instance/def both trees | id 6428, HD, same position, draw 150, flags 1, txd `law2_roadsb` |
  | DFF both trees | 146 verts / 93 tris / same bbox / same 2 textures (the mod file adds normals) |
  | node-side weld of cell 0,−7 | both: 93 tris, bucket `0000\|0\|0` (array 0, opaque), welded box identical to 2 decimals |
  | its `.oscell` group | both: #0 offset 0 count 2106, identical bounds; the road's 65 triangles identical, 0 degenerate |
  | its textures through the planner | both: opaque, array 0/1, layer 0, mean pixel within 2/255 |

  So the strip IS `roads32_law2` failing to draw, and every piece of DATA behind it — instance,
  definition, geometry, texture, weld, group — is equivalent between the trees. Two side findings from
  the same probes: a mod moved `sm_bushvbig` to **z = −300**, which blows the merged cell's bounds out
  to `59.6, −115.5, −0.1, 290.9` (vanilla: `59.6, 9.7, −0.1, 232.4`), and 11 props (palms, benches)
  were removed from the cell. **The user then reported the case as resolved on their side** — their
  own explanation lands in `docs/open-issues/fixed/mod-dff-winding-and-atomic-frame.md` when it arrives; the measurements
  above stay as the record of what the tool could prove on its own.
- **Phase 7 — water (user request, 2026-07-30).** The scope cut ("no water pass at first") reversed:
  the viewer draws the sea, with a toggle to hide it.

  **DONE 2026-07-30.** The flat `water.dat` build the game already falls back to (no bake exists for a
  source folder) moved into `@opensa/renderware/map/water-mesh` as `flatWaterMesh`, so both apps build
  their sea from ONE function; the game host kept its axis flip, now shared by both of its paths.
  The viewer installs it once at boot — `data/water.dat` is already in the VFS with gta.dat and the
  IPLs, so it costs one parse and one upload, and it renders where no cell is resident, which is what
  separates a hole in the map from a hole in the sea. Ripple/foam come from `models/particle.txd`,
  which this app does not ingest; the engine's 1×1 stubs stand in (flat normal, no foam).

  The toggle is a DRAW gate on the engine (`waterEnabled`, next to `particlesEnabled`) rather than an
  unload: an inspector looks under the sheet and back a dozen times, and re-uploading the mesh each
  time would be the wrong price. `MapGame.setShowWater` is optional exactly like `setShowCollision`,
  so the in-game debugger gains the checkbox the day its host implements it.

  **Measured** (`game-src/original`, `?at=150,-1700&h=150`): the sea welds to **616 triangles**, no
  measurable frame cost at this pose. Water on vs off: crop diff mean **13.8**. And the determinism
  check that decided the default: two runs of one URL with water are **not** identical (mean 0.006,
  max 14.6 — the Gerstner waves ride the frame clock), so `map-viewer-shot.ts` now adds `water=0` the
  way it adds `panel=0`. With that, two runs are **byte-identical again (mean 0, max 0)**;
  interactively the sea is on, and `water=1` shoots it deliberately.

## Test coverage of the app (state at close, phase 7)

`apps/sa-map-viewer/**/*.test.ts` is in the vitest `include` (it was not — tests written there would simply
never have run). **51 tests in the app** — 31 over its pure logic and 20 against the recording fake
`GPUDevice` — plus 13 (`ModelIndex`), 6 (`flatWaterMesh`), 4 (`lookAtStep`), 3 (the water draw gate) and 2
(`GtaSaWorldAdapter.modelIndex`) where the shared halves live. Repo total: **3 216**.

| File | What is pinned |
| --- | --- |
| `packages/renderware/src/map/model-search.test.ts` | the model index: an empty/blank query answers nothing, an unplaced name answers nothing (catalog-only names are not offered at all), the row cap, case-insensitive substring with prefix matches first, the catalog's spelling in the row, and the focus cursor — nearest first, cycling outwards, WRAPPING, order frozen while cycling, re-ordered when the name changes |
| `camera/viewer-camera.test.ts` | `poseFromQuery` defaults + degree parsing + every malformed input falling back instead of yielding NaN; the pitch clamp at BOTH ends; the pose round-trip; and the four gestures as behaviour — orbit leaves the looked-at point still, pan moves it and keeps the height, dolly changes height and not the point, `lookAtGta` (the search jump) moves the point and changes nothing else |
| `world/cell-renderer.test.ts` | `cellAt` FLOORS negatives (truncation would shift the whole south/west map one cell and silently disagree with the pack); `mapCenterGta` centres on the occupied cells, answers the origin for an empty grid, does not follow ONE exiled placement, and never answers a cell with nothing in it |
| `source/map-source.test.ts` | `sourceFromQuery` (trailing slash, absent ⇒ picker); `isConverted` on the real measured censuses; `mapStats` incl. the hd+lod < instances invariant |
| `source/asset-store.test.ts` | the whole txdp parent chain is pulled; a **cycle does not hang**; `.dff` wins over `.osm`; a missing model is skipped not thrown; a second `ensure` for the same model reads nothing; the bytes land under the name the welder looks up (case-insensitively) |

| `world/cell-renderer.device.test.ts` | residency DECISIONS on the recording fake `GPUDevice`: a missing grid cell welds nothing; a cached cell is not re-welded; a deselected cell is unloaded (residency is the TARGET set, not the union); **a grown texture array re-creates the resident cells FROM CACHE and never re-welds**; `reload()` (the undo of hiding) and `clear()` are the upload, not the weld |
| `world/map-game.device.test.ts` | `ViewerMapGame` on the same fake: a click picks the placement under the CURSOR and reports it in GTA coords; a miss clears the panel; hide/restore (restore costs no weld); a set arriving mid-weld REPLACES the queued one, so two sets never interleave; the search jump centres and answers the cell without touching the pose; the water gate; `viewCell` |
| `world/viewer-host.test.ts` | `captureCells`: nothing is seeded while the panel is up (its inspector owns the set), the cell under `?at` is the capture default, `?cells=all` / `?lod=1` |

**What is NOT unit-tested, and why:** the three `.tsx` files and `bootViewer` itself — DOM glue
(`ResizeObserver`, `requestAnimationFrame`, pointer events) that the fake device does not stand in for. Its
one real decision, what a capture pins, is extracted as `captureCells` and tested. The UI half stays where
`apps/web`'s UI stays: excluded from unit coverage, exercised on the real thing (`map-viewer-shot.ts`).
`apps/sa-map-viewer` is deliberately NOT in `coverage.include`, matching `apps/viewer` and
`apps/engine-lab` — adding it would count the untested host/UI without adding any signal.

## Scope cuts (deliberate)

- ~~No water~~ — **reversed in phase 7** (user request): the sea is drawn, with a toggle.
- No vehicles/peds, no collision overlay, no timed/night variants — static noon lighting, deterministic.
  Each is a later phase if the tool earns it.
- Interiors dropped (world-grid drops them already).
- No streaming rings — manual cells only; this is an inspector, not a game.

## Close-out (2026-07-30)

**SHIPPED, phases 0–7.** Commits: `3d2d1c8` (plan) · `03a4673` (0) · `f228536` (1) · `195d789` (2–3) ·
`ddb2053` (the first test/docs pass) · `57ddb12` (4) · `d371b9d` (5) · `429f747` (6–7) · plus this
close-out. Both owed items are done: the fake-`GPUDevice` batch over `CellRenderer` / `ViewerMapGame` /
the host's capture decision (20 tests), and the audit —
[`docs/audit/sa-map-viewer-094.md`](../../audit/sa-map-viewer-094.md), which carries the cost/gain summary
and the rules the chain taught.

Docs kept in sync in the same changes: `commands.md` (launch + the sea), `development/query-parameters.md`
(the full param table), `development/in-game-tools.md` (FIND MODEL in the debugger), `debug/README.md`
(driving the viewer + the capture rules), `features/weather-environment.md` (the flat water build + the
gate), `edge-cases/engine-rendering.md` (the fog cull, wind, and now the sea as the second moving thing),
`restrictions/gpu-and-shaders.md` (the texture-array growth rule), `architecture/README.md` (the app + the
`cell-weld` package), `open-issues/fixed/mod-dff-winding-and-atomic-frame.md` (what the bisect proved).

**Left open on purpose:** the blue strip's own root CAUSE — the user reports it resolved on their side and
will record it in the open-issues doc. `build/strip-ab/mods` (1.8 GB) is the merged tree phase 6 built; it
is disposable, and re-creatable with the `pmb --until mods` line in phase 6.

## Field fix — the blank open on a modded tree (2026-08-01)

Field report: on a merged SA-format build the viewer opened on an empty canvas, and ticking **Whole map**
did not change it. Reproduced headlessly against the same tree; the panel told the whole story once it was
read as numbers rather than looked at:

| | vanilla `game-src/original` | the merged build |
| --- | --- | --- |
| instances / cells | 50 849 / 562 | 89 649 / **570** |
| occupied extent | `[-12,-12,11,11]` | `[-12,`**`-81`**`,11,11]` |
| default `at` | `0,0` — cell (0,0) | `0,-8625` — cell **(0,-35)**, open sea |
| cells resident at open | 1 | **0** |
| SECTIONS grid | 24 × 24 | 24 × **93** |

Cause, in the DATA: one mod removed a lamppost by moving it to `y = -20 101` instead of deleting its row
(id 1226, in the binary `las2_stream1.ipl` — 326 of its 362 rows differ from vanilla). Cause, in the TOOL:
`mapCenterGta` was the midpoint of the min/max cell box, so that one placement moved the default camera
17 km off the map. "Whole map" then welded all 570 cells (28.2 s, 52.6 M tris, 609.7 MB of textures) into a
frame the camera was nowhere near — the blank screen was correct, and silent.

Fixed by making the default the **median occupied cell, snapped to a cell that has content** — outlier-proof
and, since the inspector seeds its resident set from that cell, guaranteed to weld something. After: the
merged build and vanilla both open at `-125,125` (cell −1, 0); the merged build welds 43 495 tris there,
vanilla 13 189. The rule is now `docs/restrictions/assets-and-data.md`; the data fact and what it does to a
`--rect`-less convert are in `docs/edge-cases/converter-pipeline.md`; `scripts/debug/grid-extent.ts` names
the stragglers so the next such tree is one command away. Nothing catches this class in CI — `apps/**/ui` is
off the unit lane and the arithmetic was never wrong.

## Field fix — LODs rendering white, though their textures are in the tree (2026-08-01)

Field report, with two named examples (`lodntry_law2` / `salod0189`, `lodntclub01_law2` / `salod0164`):
many LODs draw untextured. Both dictionaries are present in the tree, and both models resolve completely —
`lodntry_law2` wants 10 textures, 6 sit in `salod0189` and **4 only in `salodpar`**; `lodntclub01_law2`
wants 7, 5 own and 2 in the parent. Nothing was missing from the DATA.

`salodpar` is a `txdp` PARENT (`data/maps/salod-txdp.ide`, 995 rows, all pointing at it). A parent is named
by no IDE row, and `selectInstallEntries` built its texture list from IDE rows alone — so the file was never
read into the VFS, `TexturePlanner.rawTexture` walked the chain to a dictionary that was not there, and the
material fell back to its flat colour. White material ⇒ white building. The runtime walk and the offline
weld had both been made to follow `txdp` (opensa-pack plan 003); the SELECTION had not.

Fixed in `packages/loaders/.../build-vfs.ts`: the install plan now takes each referenced dictionary's whole
ancestor chain (`withTxdParents`, cycle-safe) — ancestors of the wanted set only, not every parent in the
file.

| | vanilla `game-src/original` | the merged build |
| --- | --- | --- |
| `txdp` links | 37 | 1 053 |
| parents named by no IDE row | **0** | **2** — `salodpar`, `neonobj` |
| bytes the fix adds | 0.00 MB | **6.72 MB** |

That first column is why nobody saw this: every stock `txdp` parent is also some placed model's own
dictionary, so vanilla was already complete by accident. Field-verified at `at=703,-1278&h=220&lod=1` on the
merged build — the cell reads 80.5 → 83.1 MB (`salodpar.txd` is 2.72 MB), pixel diff mean 11.4 / max 226.9,
and the white blocks come back as concrete and terracotta. The rule is now in
`docs/restrictions/assets-and-data.md`; three tests pin the chain, the cycle and the unreferenced parent.
